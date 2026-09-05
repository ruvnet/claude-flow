/**
 * LoRA (Low-Rank Adaptation) Implementation
 *
 * Enables efficient fine-tuning by decomposing weight updates into low-rank matrices.
 * Dramatically reduces memory requirements while maintaining adaptation quality.
 *
 * Features:
 * - Rank decomposition (r << d) for memory efficiency
 * - Additive weight updates: W' = W + BA (where B ∈ R^{d×r}, A ∈ R^{r×k})
 * - Support for multiple adaptation heads
 * - Persistence to .swarm/lora-weights.json
 *
 * Memory savings:
 * - Original: d × k parameters
 * - LoRA: r × (d + k) parameters
 * - For d=384, k=384, r=8: 786,432 → 6,144 (128x reduction)
 *
 * @module lora-adapter
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createRequire } from 'module';

// ============================================================================
// Types & Constants
// ============================================================================

/**
 * Default LoRA rank (determines memory/quality tradeoff)
 */
export const DEFAULT_RANK = 8;

/**
 * Input dimension (384 from ONNX MiniLM-L6-v2)
 */
export const INPUT_DIM = 384;

/**
 * Default output dimension (same as input for adapter)
 */
export const OUTPUT_DIM = 384;

/**
 * Default alpha scaling factor
 */
export const DEFAULT_ALPHA = 16;

/**
 * LoRA configuration
 */
export interface LoRAConfig {
  /** Rank of decomposition (lower = more compression) */
  rank: number;
  /** Alpha scaling factor for output */
  alpha: number;
  /** Input dimension */
  inputDim: number;
  /** Output dimension */
  outputDim: number;
  /** Learning rate for updates */
  learningRate: number;
  /** Path for weight persistence */
  weightsPath: string;
  /** Enable dropout for regularization */
  enableDropout: boolean;
  /** Dropout probability */
  dropoutProb: number;
  /** Auto-save interval in updates */
  autoSaveInterval: number;
}

/**
 * LoRA adapter weights
 */
export interface LoRAWeights {
  /** A matrix (rank × inputDim) - down projection */
  A: Float32Array;
  /** B matrix (outputDim × rank) - up projection */
  B: Float32Array;
  /** Scaling factor (alpha / rank) */
  scaling: number;
}

/**
 * Adaptation result
 */
export interface AdaptationResult {
  /** Adapted embedding */
  adapted: Float32Array;
  /** Magnitude of adaptation */
  adaptationNorm: number;
  /** Time taken in ms */
  timeMs: number;
}

/**
 * LoRA statistics
 */
export interface LoRAStats {
  /** Total adaptations performed */
  totalAdaptations: number;
  /** Total training updates */
  totalUpdates: number;
  /** Current rank */
  rank: number;
  /** Memory savings ratio */
  compressionRatio: number;
  /** Average adaptation norm */
  avgAdaptationNorm: number;
  /** Last update timestamp */
  lastUpdate: number | null;
  /** Training backend in use ('ruvllm' | 'js-fallback') */
  _trainingBackend?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: LoRAConfig = {
  rank: DEFAULT_RANK,
  alpha: DEFAULT_ALPHA,
  inputDim: INPUT_DIM,
  outputDim: OUTPUT_DIM,
  learningRate: 0.001,
  weightsPath: join(process.cwd(), '.swarm', 'lora-weights.json'),
  enableDropout: true,
  dropoutProb: 0.1,
  autoSaveInterval: 50,
};

// ============================================================================
// @ruvector/ruvllm TrainingPipeline (lazy-loaded)
// ============================================================================

let ruvllmPipeline: any = null;
let pipelineLoaded = false;

/**
 * Which training backend a train call would use — WITHOUT loading the
 * pipeline (#2549). Before this existed, status surfaces read module state
 * that only a prior in-process train populates, so a fresh read-only
 * process always reported 'js-fallback'/'unavailable' even with
 * @ruvector/ruvllm installed. The pipeline stays lazy: this only probes
 * module resolution.
 */
export function resolveTrainingBackend(): 'ruvllm' | 'js-fallback' {
  if (pipelineLoaded) return ruvllmPipeline ? 'ruvllm' : 'js-fallback';
  try {
    createRequire(import.meta.url).resolve('@ruvector/ruvllm');
    return 'ruvllm';
  } catch {
    return 'js-fallback';
  }
}

/**
 * Whether the resolved @ruvector/ruvllm persists checkpoints to disk.
 * saveCheckpoint(path) was a silent no-op (private, void, wrote 0 bytes)
 * before 2.5.7 — status surfaces must not advertise checkpoints against
 * older versions. Reads the resolved package's version; the package does
 * not export ./package.json, so walk up from the resolved entry instead.
 */
export function nativeCheckpointsSupported(): boolean {
  try {
    const req = createRequire(import.meta.url);
    let dir = dirname(req.resolve('@ruvector/ruvllm'));
    for (let i = 0; i < 5; i++) {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name !== '@ruvector/ruvllm') { dir = dirname(dir); continue; }
        const [maj, min, pat] = String(pkg.version).split('.').map(Number);
        return maj > 2 || (maj === 2 && (min > 5 || (min === 5 && pat >= 7)));
      }
      dir = dirname(dir);
    }
  } catch { /* unresolved — no native checkpoints */ }
  return false;
}

async function loadTrainingPipeline(adapter: LoRAAdapter): Promise<any> {
  if (pipelineLoaded) return ruvllmPipeline;
  pipelineLoaded = true;
  try {
    const { createRequire } = await import('module');
    const requireCjs = createRequire(import.meta.url);
    const ruvllm = requireCjs('@ruvector/ruvllm');
    const config = adapter.getConfig();
    // Create a ruvllm LoraAdapter that mirrors our JS adapter's config
    const nativeAdapter = new (ruvllm as any).LoraAdapter(config.inputDim, config.outputDim, config.rank);
    ruvllmPipeline = new (ruvllm as any).TrainingPipeline({
      adapter: nativeAdapter,
      learningRate: 0.001,
      batchSize: 8,
    });
    return ruvllmPipeline;
  } catch {
    return null;
  }
}

// ============================================================================
// LoRA Adapter Class
// ============================================================================

/**
 * Low-Rank Adaptation module for efficient embedding fine-tuning
 */
export class LoRAAdapter {
  private config: LoRAConfig;
  private weights: LoRAWeights;
  private totalAdaptations = 0;
  private totalUpdates = 0;
  private adaptationNormSum = 0;
  private lastUpdate: number | null = null;
  private updatesSinceLastSave = 0;

  constructor(config?: Partial<LoRAConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.weights = this.initializeWeights();
  }

  /**
   * Eagerly load the ruvllm TrainingPipeline backend.
   * Called automatically during first checkpoint operation,
   * or call explicitly to make getStats() report backend status.
   */
  async initBackend(): Promise<void> {
    await loadTrainingPipeline(this);
  }

  /**
   * Get a readonly copy of the adapter configuration
   */
  getConfig(): Readonly<LoRAConfig> {
    return this.config;
  }

  /**
   * Initialize weights with Kaiming/He initialization
   */
  private initializeWeights(): LoRAWeights {
    const { rank, inputDim, outputDim, alpha } = this.config;

    // A: rank × inputDim, initialized with Kaiming normal
    const A = new Float32Array(rank * inputDim);
    const stdA = Math.sqrt(2.0 / inputDim);
    for (let i = 0; i < A.length; i++) {
      A[i] = this.gaussianRandom() * stdA;
    }

    // B: outputDim × rank, initialized to zero (standard LoRA init)
    const B = new Float32Array(outputDim * rank);
    // B starts at zero so initial adaptation is zero

    return {
      A,
      B,
      scaling: alpha / rank,
    };
  }

  /**
   * Box-Muller transform for Gaussian random numbers
   */
  private gaussianRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /**
   * Initialize adapter and load persisted weights
   */
  async initialize(): Promise<{ success: boolean; weightsLoaded: boolean }> {
    const loaded = this.loadWeights();
    return { success: true, weightsLoaded: loaded };
  }

  /**
   * Apply LoRA adaptation to an embedding
   * output = input + scaling * (B @ A @ input)
   */
  adapt(input: Float32Array): AdaptationResult {
    const startTime = performance.now();
    const { rank, inputDim, outputDim } = this.config;
    const { A, B, scaling } = this.weights;

    // Step 1: Compute A @ input (rank-dimensional)
    const hidden = new Float32Array(rank);
    for (let r = 0; r < rank; r++) {
      let sum = 0;
      const rowOffset = r * inputDim;
      // Unroll by 4 for SIMD-friendly access
      let i = 0;
      for (; i + 3 < inputDim; i += 4) {
        sum += A[rowOffset + i] * input[i];
        sum += A[rowOffset + i + 1] * input[i + 1];
        sum += A[rowOffset + i + 2] * input[i + 2];
        sum += A[rowOffset + i + 3] * input[i + 3];
      }
      for (; i < inputDim; i++) {
        sum += A[rowOffset + i] * input[i];
      }
      hidden[r] = sum;
    }

    // Optional dropout (during training inference, skip)
    // In LoRA inference, we don't apply dropout

    // Step 2: Compute B @ hidden (outputDim-dimensional)
    const delta = new Float32Array(outputDim);
    for (let o = 0; o < outputDim; o++) {
      let sum = 0;
      const rowOffset = o * rank;
      for (let r = 0; r < rank; r++) {
        sum += B[rowOffset + r] * hidden[r];
      }
      delta[o] = sum * scaling;
    }

    // Step 3: Add adaptation to input
    const adapted = new Float32Array(outputDim);
    let adaptationNorm = 0;
    for (let i = 0; i < outputDim; i++) {
      adapted[i] = input[i] + delta[i];
      adaptationNorm += delta[i] * delta[i];
    }
    adaptationNorm = Math.sqrt(adaptationNorm);

    // Update stats
    this.totalAdaptations++;
    this.adaptationNormSum += adaptationNorm;

    const timeMs = performance.now() - startTime;
    return { adapted, adaptationNorm, timeMs };
  }

  /**
   * Train the adapter with a gradient signal
   * Uses simplified update: A += lr * hidden^T @ grad, B += lr * grad @ hidden^T
   */
  train(
    input: Float32Array,
    gradOutput: Float32Array,
    reward: number = 1.0
  ): { updated: boolean; loss: number } {
    const { rank, inputDim, outputDim, learningRate } = this.config;
    const { A, B, scaling } = this.weights;

    // Forward pass to get hidden states
    const hidden = new Float32Array(rank);
    for (let r = 0; r < rank; r++) {
      let sum = 0;
      const rowOffset = r * inputDim;
      for (let i = 0; i < inputDim; i++) {
        sum += A[rowOffset + i] * input[i];
      }
      hidden[r] = sum;
    }

    // Compute gradient for B: grad_B = gradOutput @ hidden^T
    const scaledLr = learningRate * reward * scaling;
    for (let o = 0; o < outputDim; o++) {
      const rowOffset = o * rank;
      for (let r = 0; r < rank; r++) {
        B[rowOffset + r] += scaledLr * gradOutput[o] * hidden[r];
      }
    }

    // Compute gradient for hidden: grad_hidden = B^T @ gradOutput
    const gradHidden = new Float32Array(rank);
    for (let r = 0; r < rank; r++) {
      let sum = 0;
      for (let o = 0; o < outputDim; o++) {
        sum += B[o * rank + r] * gradOutput[o];
      }
      gradHidden[r] = sum;
    }

    // Compute gradient for A: grad_A = gradHidden @ input^T
    for (let r = 0; r < rank; r++) {
      const rowOffset = r * inputDim;
      for (let i = 0; i < inputDim; i++) {
        A[rowOffset + i] += scaledLr * gradHidden[r] * input[i];
      }
    }

    // Compute loss (L2 norm of gradient)
    let loss = 0;
    for (let i = 0; i < gradOutput.length; i++) {
      loss += gradOutput[i] * gradOutput[i];
    }
    loss = Math.sqrt(loss);

    // Update counters
    this.totalUpdates++;
    this.lastUpdate = Date.now();
    this.updatesSinceLastSave++;

    // Auto-save if needed
    if (this.updatesSinceLastSave >= this.config.autoSaveInterval) {
      this.saveWeights();
      this.updatesSinceLastSave = 0;
    }

    return { updated: true, loss };
  }

  /**
   * Merge LoRA weights into base weights (for deployment)
   * Returns: W' = W + scaling * B @ A
   */
  merge(baseWeights: Float32Array): Float32Array {
    const { rank, inputDim, outputDim } = this.config;
    const { A, B, scaling } = this.weights;

    // Compute BA product
    const merged = new Float32Array(baseWeights);

    for (let o = 0; o < outputDim; o++) {
      for (let i = 0; i < inputDim; i++) {
        let sum = 0;
        for (let r = 0; r < rank; r++) {
          sum += B[o * rank + r] * A[r * inputDim + i];
        }
        merged[o * inputDim + i] += scaling * sum;
      }
    }

    return merged;
  }

  /**
   * Get current statistics
   */
  getStats(): LoRAStats {
    const { rank, inputDim, outputDim } = this.config;
    const originalParams = inputDim * outputDim;
    const loraParams = rank * (inputDim + outputDim);

    return {
      totalAdaptations: this.totalAdaptations,
      totalUpdates: this.totalUpdates,
      rank: this.config.rank,
      compressionRatio: originalParams / loraParams,
      avgAdaptationNorm: this.totalAdaptations > 0
        ? this.adaptationNormSum / this.totalAdaptations
        : 0,
      lastUpdate: this.lastUpdate,
      _trainingBackend: resolveTrainingBackend(),
    };
  }

  /**
   * Reset adapter to initial state
   */
  reset(): void {
    this.weights = this.initializeWeights();
    this.totalAdaptations = 0;
    this.totalUpdates = 0;
    this.adaptationNormSum = 0;
    this.lastUpdate = null;
    this.updatesSinceLastSave = 0;
  }

  /**
   * Save weights to disk
   */
  saveWeights(): boolean {
    try {
      const dir = dirname(this.config.weightsPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data = {
        version: 1,
        config: {
          rank: this.config.rank,
          alpha: this.config.alpha,
          inputDim: this.config.inputDim,
          outputDim: this.config.outputDim,
        },
        weights: {
          A: Array.from(this.weights.A),
          B: Array.from(this.weights.B),
          scaling: this.weights.scaling,
        },
        stats: {
          totalAdaptations: this.totalAdaptations,
          totalUpdates: this.totalUpdates,
          adaptationNormSum: this.adaptationNormSum,
          lastUpdate: this.lastUpdate,
        },
        savedAt: new Date().toISOString(),
      };

      writeFileSync(this.config.weightsPath, JSON.stringify(data, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load weights from disk
   */
  loadWeights(): boolean {
    try {
      if (!existsSync(this.config.weightsPath)) {
        return false;
      }

      const content = readFileSync(this.config.weightsPath, 'utf-8');
      const data = JSON.parse(content);

      if (data.version !== 1) {
        return false;
      }

      // Verify dimensions match
      const { rank, inputDim, outputDim } = data.config;
      if (rank !== this.config.rank ||
          inputDim !== this.config.inputDim ||
          outputDim !== this.config.outputDim) {
        return false;
      }

      // Load weights
      this.weights = {
        A: new Float32Array(data.weights.A),
        B: new Float32Array(data.weights.B),
        scaling: data.weights.scaling,
      };

      // Load stats
      this.totalAdaptations = data.stats.totalAdaptations || 0;
      this.totalUpdates = data.stats.totalUpdates || 0;
      this.adaptationNormSum = data.stats.adaptationNormSum || 0;
      this.lastUpdate = data.stats.lastUpdate || null;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save a training checkpoint via ruvllm TrainingPipeline.
   * Falls back to writing our own weight JSON if ruvllm is unavailable.
   */
  async saveCheckpoint(path: string): Promise<boolean> {
    // Parent dir must exist for BOTH paths: ruvllm <2.5.7 never wrote a
    // file at all, and the JS fallback's writeFileSync throws ENOENT on a
    // missing dir — which the catch silently converted to `false` (#2549).
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch { /* fs errors surface on write below */ }
    const pipeline = await loadTrainingPipeline(this);
    if (pipeline) {
      try {
        pipeline.saveCheckpoint(path);
        // Verify ruvllm actually wrote the file (<2.5.7 is a silent no-op)
        const fs = await import('fs');
        if (fs.existsSync(path)) return true;
      } catch { /* fall through to JS fallback */ }
    }
    // Fallback: save our own weights as JSON
    try {
      const fs = await import('fs');
      const data = JSON.stringify(this.exportWeights());
      fs.writeFileSync(path, data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load a training checkpoint via ruvllm TrainingPipeline.
   * Falls back to reading our own weight JSON if ruvllm is unavailable.
   */
  async loadCheckpoint(path: string): Promise<boolean> {
    const pipeline = await loadTrainingPipeline(this);
    if (pipeline) {
      try {
        pipeline.loadCheckpoint(path);
        return true;
      } catch { /* fall through to JS fallback */ }
    }
    // Fallback: load from our JSON format
    try {
      const fs = await import('fs');
      if (fs.existsSync(path)) {
        const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
        return this.importWeights(data);
      }
    } catch { /* return false below */ }
    return false;
  }

  /**
   * Export weights as JSON
   */
  exportWeights(): {
    A: number[];
    B: number[];
    scaling: number;
    config: Partial<LoRAConfig>;
  } {
    return {
      A: Array.from(this.weights.A),
      B: Array.from(this.weights.B),
      scaling: this.weights.scaling,
      config: {
        rank: this.config.rank,
        alpha: this.config.alpha,
        inputDim: this.config.inputDim,
        outputDim: this.config.outputDim,
      },
    };
  }

  /**
   * Import weights from JSON
   */
  importWeights(data: {
    A: number[];
    B: number[];
    scaling: number;
  }): boolean {
    try {
      const { rank, inputDim, outputDim } = this.config;

      if (data.A.length !== rank * inputDim ||
          data.B.length !== outputDim * rank) {
        return false;
      }

      this.weights = {
        A: new Float32Array(data.A),
        B: new Float32Array(data.B),
        scaling: data.scaling,
      };

      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Checkpoint auto-load (the training flywheel)
// ============================================================================

/**
 * Info about the newest on-disk training checkpoint.
 */
export interface CheckpointInfo {
  /** Absolute path to the checkpoint file */
  path: string;
  /** Basename, e.g. lora-checkpoint-1712345678901.json */
  filename: string;
  /** Age in ms derived from the filename timestamp (falls back to mtime) */
  ageMs: number;
  /** Human-friendly age, e.g. "2h ago" */
  ageLabel: string;
}

/**
 * Directories `neural train` writes checkpoints to. It only ever writes to
 * `<cwd>/.claude-flow/neural` (see commands/neural.ts + services/native-training.ts),
 * so that is the single source of truth — kept in a helper so the discovery
 * and status surfaces stay consistent.
 */
function checkpointDirs(): string[] {
  return [join(process.cwd(), '.claude-flow', 'neural')];
}

/** Compact relative-age label. Most-significant unit only. */
export function formatCheckpointAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Find the newest `lora-checkpoint-<ts>.json` without loading it. Pure disk
 * scan — safe to call from read-only status surfaces. Returns null when no
 * checkpoint exists or the directory is unreadable.
 */
export function latestCheckpointInfo(): CheckpointInfo | null {
  try {
    let best: { path: string; filename: string; ts: number } | null = null;
    for (const dir of checkpointDirs()) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        const match = /^lora-checkpoint-(\d+)\.json$/.exec(f);
        if (!match) continue;
        const ts = Number(match[1]);
        if (!Number.isFinite(ts)) continue;
        if (!best || ts > best.ts) best = { path: join(dir, f), filename: f, ts };
      }
    }
    if (!best) return null;
    const ageMs = Math.max(0, Date.now() - best.ts);
    return { path: best.path, filename: best.filename, ageMs, ageLabel: formatCheckpointAge(ageMs) };
  } catch {
    return null;
  }
}

/**
 * Validate a file looks like a ruvllm training checkpoint before loading it,
 * so a stray/corrupt JSON in the neural dir can't poison routing weights.
 * Accepts both the JS-fallback envelope ({A,B,scaling}) and native ruvllm
 * checkpoint shapes (weights/adapter/epoch/step/loss/version/index markers).
 */
function isCheckpointEnvelope(path: string): boolean {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.A) && Array.isArray(obj.B)) return true;
    return ['weights', 'adapter', 'epoch', 'step', 'loss', 'version', 'index'].some((k) => k in obj);
  } catch {
    return false;
  }
}

/**
 * Flywheel entry point: locate the newest trained checkpoint and load it into
 * `adapter` via the adapter's existing loadCheckpoint path, so routing /
 * adaptation benefits from prior `neural train` runs.
 *
 * Contract: lazy (call on first adaptation use, never at CLI startup),
 * non-fatal on any failure, and kill-switchable via
 * CLAUDE_FLOW_NO_CHECKPOINT_AUTOLOAD=1.
 */
export async function loadLatestCheckpoint(
  adapter: LoRAAdapter,
): Promise<{ loaded: boolean; path?: string; ageMs?: number }> {
  if (process.env.CLAUDE_FLOW_NO_CHECKPOINT_AUTOLOAD === '1') return { loaded: false };
  try {
    const info = latestCheckpointInfo();
    if (!info) return { loaded: false };
    if (!isCheckpointEnvelope(info.path)) return { loaded: false, path: info.path, ageMs: info.ageMs };
    const loaded = await adapter.loadCheckpoint(info.path);
    return { loaded, path: info.path, ageMs: info.ageMs };
  } catch {
    return { loaded: false };
  }
}

// ============================================================================
// Singleton & Factory Functions
// ============================================================================

let loraInstance: LoRAAdapter | null = null;
let initPromise: Promise<LoRAAdapter> | null = null;

/**
 * Get or create singleton LoRA adapter instance
 */
export async function getLoRAAdapter(): Promise<LoRAAdapter> {
  if (loraInstance) {
    return loraInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const adapter = new LoRAAdapter();
    await adapter.initialize();
    // Flywheel: fold in the newest trained checkpoint so routing/adaptation
    // benefits from prior `neural train` runs. This singleton is constructed
    // lazily on first adaptation use (NOT at CLI startup), so the checkpoint
    // scan + ruvllm load stay off the hot `--help` path. Non-fatal.
    try {
      await loadLatestCheckpoint(adapter);
    } catch { /* auto-load is best-effort — never block adaptation */ }
    loraInstance = adapter;
    return adapter;
  })();

  return initPromise;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetLoRAAdapter(): void {
  if (loraInstance) {
    loraInstance.reset();
  }
  loraInstance = null;
  initPromise = null;
}

/**
 * Create new LoRA adapter instance (factory)
 */
export function createLoRAAdapter(config?: Partial<LoRAConfig>): LoRAAdapter {
  return new LoRAAdapter(config);
}

/**
 * Quick adaptation (convenience function)
 */
export async function adaptEmbedding(input: Float32Array): Promise<AdaptationResult> {
  const adapter = await getLoRAAdapter();
  return adapter.adapt(input);
}

/**
 * Quick training (convenience function)
 */
export async function trainLoRA(
  input: Float32Array,
  gradOutput: Float32Array,
  reward?: number
): Promise<{ updated: boolean; loss: number }> {
  const adapter = await getLoRAAdapter();
  return adapter.train(input, gradOutput, reward);
}

/**
 * Get LoRA statistics (convenience function)
 */
export async function getLoRAStats(): Promise<LoRAStats> {
  const adapter = await getLoRAAdapter();
  return adapter.getStats();
}

export default {
  LoRAAdapter,
  getLoRAAdapter,
  resetLoRAAdapter,
  createLoRAAdapter,
  adaptEmbedding,
  trainLoRA,
  getLoRAStats,
  DEFAULT_RANK,
  DEFAULT_ALPHA,
  INPUT_DIM,
  OUTPUT_DIM,
};
