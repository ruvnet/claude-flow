/**
 * RuVector Training Service
 * Real WASM-accelerated neural training using @ruvector packages
 *
 * Features:
 * - MicroLoRA: <1µs adaptation with rank-2 LoRA (2.3M ops/s)
 * - SONA: Self-Optimizing Neural Architecture (624k learn/s, 60k search/s)
 * - Flash Attention: 2.49x-7.47x speedup (9k ops/s)
 * - Trajectory Buffer: Learning from success/failure
 * - Contrastive Learning: InfoNCE loss
 *
 * Backward Compatible: All v1 APIs preserved, SONA adds new capabilities
 *
 * Created with ❤️ by ruv.io
 */

// Optional dependency — `@ruvector/learning-wasm` is not always installed in
// CI (install-safety / Build V3 configurations). A literal `import type … from
// '@ruvector/learning-wasm'` triggers TS2307 at build time when absent, even
// though every runtime callsite is behind try/catch. Alias the exported types
// to `any` locally — matches the pattern already used a few lines below for
// `@ruvector/attention` and preserves the runtime behaviour that the wasm
// bridge lazy-loads via dynamic import (#2586 / #2608 pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional-dep type aliases
type WasmMicroLoRA = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional-dep type aliases
type WasmScopedLoRA = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional-dep type aliases
type WasmTrajectoryBuffer = any;

// @ruvector/attention types — use any since the NAPI exports vary across versions
type FlashAttention = any;
type MoEAttention = any;
type HyperbolicAttention = any;
type AdamWOptimizer = any;
type InfoNceLoss = any;
type CurriculumScheduler = any;
type HardNegativeMiner = any;
type BenchmarkResult = any;

// SONA Engine type (from @ruvector/sona)
interface SonaEngineInstance {
  forceLearn(embedding: Float32Array, reward: number): void;
  findPatterns(embedding: number[], k: number): unknown[];
  tick(): void;
  getStats(): string;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  flush(): void;
}


/**
 * ESM/CJS interop helper — handles `.default` for CJS modules.
 * Uses `'default' in mod` check which is safer than `mod.default || mod`.
 */
async function importWithInterop<T = any>(packageName: string): Promise<T> {
  const mod = await import(packageName);
  return ('default' in mod) ? (mod as any).default : mod;
}
// Lazy-loaded WASM modules
let microLoRA: WasmMicroLoRA | null = null;
let scopedLoRA: WasmScopedLoRA | null = null;
let trajectoryBuffer: WasmTrajectoryBuffer | null = null;
let flashAttention: FlashAttention | null = null;
let moeAttention: MoEAttention | null = null;
let hyperbolicAttention: HyperbolicAttention | null = null;
let optimizer: AdamWOptimizer | null = null;
let contrastiveLoss: InfoNceLoss | null = null;
let curriculum: CurriculumScheduler | null = null;
let hardMiner: HardNegativeMiner | null = null;

// SONA engine (optional enhancement)
let sonaEngine: SonaEngineInstance | null = null;
let sonaAvailable = false;

// Training state
let initialized = false;
let totalAdaptations = 0;
let totalForwards = 0;
let totalSonaLearns = 0;
let totalSonaSearches = 0;
let lastBenchmark: BenchmarkResult[] | null = null;

// Backend tracking
let activeBackend: 'wasm' | 'js-fallback' = 'js-fallback';

/**
 * Get which backend is active for training
 */
export function getActiveBackend(): 'wasm' | 'js-fallback' {
  return activeBackend;
}

export interface TrainingConfig {
  dim?: number;           // Embedding dimension (max 256)
  learningRate?: number;  // Learning rate
  alpha?: number;         // LoRA scaling factor
  trajectoryCapacity?: number;
  useFlashAttention?: boolean;
  useMoE?: boolean;
  useHyperbolic?: boolean;
  totalSteps?: number;    // For curriculum
  warmupSteps?: number;
  // SONA options (v2 enhancement)
  useSona?: boolean;      // Enable SONA self-optimizing neural architecture
  sonaRank?: number;      // SONA LoRA rank (default: 4)
}

export interface TrainingResult {
  success: boolean;
  adaptationCount: bigint;
  forwardCount: bigint;
  deltaNorm: number;
  trajectoryStats?: {
    successRate: number;
    meanImprovement: number;
    bestImprovement: number;
    totalCount: bigint;
  };
  benchmark?: BenchmarkResult[];
}

/**
 * Pure-JS fallback implementations for when WASM is unavailable.
 * These provide the same API surface with basic linear algebra.
 */
class JsMicroLoRA implements Pick<WasmMicroLoRA, 'adapt_array' | 'adapt_count' | 'param_count' | 'forward_array' | 'forward_count' | 'adapt_with_reward' | 'delta_norm' | 'dim' | 'reset' | 'free'> {
  private _dim: number;
  private _alpha: number;
  private _lr: number;
  private _adaptCount = 0n;
  private _forwardCount = 0n;
  private _deltaNorm = 0;
  private _A: Float32Array; // Low-rank A (rank x dim)
  private _B: Float32Array; // Low-rank B (dim x rank)
  private readonly RANK = 2;

  constructor(dim: number, alpha: number, lr: number) {
    this._dim = dim;
    this._alpha = alpha;
    this._lr = lr;
    this._A = new Float32Array(this.RANK * dim);
    this._B = new Float32Array(dim * this.RANK);
    // Xavier initialization
    const scale = Math.sqrt(2 / (dim + this.RANK));
    for (let i = 0; i < this._A.length; i++) this._A[i] = (Math.random() - 0.5) * scale;
    for (let i = 0; i < this._B.length; i++) this._B[i] = (Math.random() - 0.5) * scale;
  }

  adapt_array(gradient: Float32Array): void {
    // Simple gradient update on low-rank matrices
    let norm = 0;
    for (let i = 0; i < Math.min(gradient.length, this._A.length); i++) {
      const delta = -this._lr * gradient[i % gradient.length] * this._alpha;
      this._A[i] += delta;
      norm += delta * delta;
    }
    this._deltaNorm = Math.sqrt(norm);
    this._adaptCount++;
  }

  adapt_count(): bigint { return this._adaptCount; }
  param_count(): number { return this._A.length + this._B.length; }

  forward_array(input: Float32Array): Float32Array {
    const output = new Float32Array(this._dim);
    // y = x + alpha * B @ A @ x  (simplified low-rank)
    for (let i = 0; i < this._dim; i++) {
      output[i] = input[i];
      let sum = 0;
      for (let r = 0; r < this.RANK; r++) {
        let dot = 0;
        for (let j = 0; j < this._dim; j++) {
          dot += this._A[r * this._dim + j] * input[j];
        }
        sum += this._B[i * this.RANK + r] * dot;
      }
      output[i] += this._alpha * sum;
    }
    this._forwardCount++;
    return output;
  }

  forward_count(): bigint { return this._forwardCount; }

  adapt_with_reward(improvement: number): void {
    const scale = improvement * this._lr * this._alpha;
    let norm = 0;
    for (let i = 0; i < this._A.length; i++) {
      const delta = scale * (Math.random() - 0.5);
      this._A[i] += delta;
      norm += delta * delta;
    }
    this._deltaNorm = Math.sqrt(norm);
    this._adaptCount++;
  }

  delta_norm(): number { return this._deltaNorm; }
  dim(): number { return this._dim; }
  reset(): void {
    this._A.fill(0);
    this._B.fill(0);
    this._adaptCount = 0n;
    this._forwardCount = 0n;
    this._deltaNorm = 0;
  }
  free(): void { /* no-op for JS */ }
}

class JsScopedLoRA implements Pick<WasmScopedLoRA, 'adapt_array' | 'adapt_count' | 'forward_array' | 'forward_count' | 'adapt_with_reward' | 'delta_norm' | 'total_adapt_count' | 'total_forward_count' | 'set_category_fallback' | 'reset_all' | 'reset_scope' | 'free'> {
  private adapters: Map<number, JsMicroLoRA> = new Map();
  private _dim: number;
  private _alpha: number;
  private _lr: number;
  private _fallback = false;

  constructor(dim: number, alpha: number, lr: number) {
    this._dim = dim;
    this._alpha = alpha;
    this._lr = lr;
  }

  private getAdapter(opType: number): JsMicroLoRA {
    if (!this.adapters.has(opType)) {
      if (this._fallback && opType > 0 && this.adapters.has(0)) {
        return this.adapters.get(0)!;
      }
      this.adapters.set(opType, new JsMicroLoRA(this._dim, this._alpha, this._lr));
    }
    return this.adapters.get(opType)!;
  }

  adapt_array(opType: number, gradient: Float32Array): void { this.getAdapter(opType).adapt_array(gradient); }
  adapt_count(opType: number): bigint { return this.getAdapter(opType).adapt_count(); }
  forward_array(opType: number, input: Float32Array): Float32Array { return this.getAdapter(opType).forward_array(input); }
  forward_count(opType: number): bigint { return this.getAdapter(opType).forward_count(); }
  adapt_with_reward(opType: number, improvement: number): void { this.getAdapter(opType).adapt_with_reward(improvement); }
  delta_norm(opType: number): number { return this.getAdapter(opType).delta_norm(); }
  set_category_fallback(enabled: boolean): void { this._fallback = enabled; }

  total_adapt_count(): bigint {
    let total = 0n;
    for (const a of this.adapters.values()) total += a.adapt_count();
    return total;
  }

  total_forward_count(): bigint {
    let total = 0n;
    for (const a of this.adapters.values()) total += a.forward_count();
    return total;
  }

  reset_all(): void { this.adapters.clear(); }
  reset_scope(opType: number): void { this.adapters.delete(opType); }
  free(): void { this.adapters.clear(); }
}

class JsTrajectoryBuffer implements Pick<WasmTrajectoryBuffer, 'record' | 'is_empty' | 'total_count' | 'success_rate' | 'mean_improvement' | 'best_improvement' | 'high_quality_count' | 'variance' | 'reset' | 'free'> {
  private entries: { improvement: number }[] = [];
  private capacity: number;

  constructor(capacity: number, _dim: number) {
    this.capacity = capacity;
  }

  record(_embedding: Float32Array, _opType: number, _attType: number, executionMs: number, baselineMs: number): void {
    const improvement = baselineMs > 0 ? (baselineMs - executionMs) / baselineMs : 0;
    if (this.entries.length >= this.capacity) this.entries.shift();
    this.entries.push({ improvement });
  }

  is_empty(): boolean { return this.entries.length === 0; }
  total_count(): bigint { return BigInt(this.entries.length); }

  success_rate(): number {
    if (this.entries.length === 0) return 0;
    return this.entries.filter(e => e.improvement > 0).length / this.entries.length;
  }

  mean_improvement(): number {
    if (this.entries.length === 0) return 0;
    return this.entries.reduce((s, e) => s + e.improvement, 0) / this.entries.length;
  }

  best_improvement(): number {
    if (this.entries.length === 0) return 0;
    return Math.max(...this.entries.map(e => e.improvement));
  }

  high_quality_count(threshold: number): number {
    return this.entries.filter(e => e.improvement > threshold).length;
  }

  variance(): number {
    if (this.entries.length < 2) return 0;
    const mean = this.mean_improvement();
    return this.entries.reduce((s, e) => s + (e.improvement - mean) ** 2, 0) / (this.entries.length - 1);
  }

  reset(): void { this.entries = []; }
  free(): void { this.entries = []; }
}

/**
 * Initialize the RuVector training system.
 * Attempts to load @ruvector/learning-wasm for WASM-accelerated training.
 * Falls back to a pure-JS implementation if WASM is unavailable.
 */
export async function initializeTraining(config: TrainingConfig = {}): Promise<{
  success: boolean;
  features: string[];
  backend: 'wasm' | 'js-fallback';
  error?: string;
}> {
  const features: string[] = [];
  const dim = Math.min(config.dim || 256, 256); // Max 256 for WASM
  const lr = config.learningRate || 0.01;
  const alpha = config.alpha || 0.1;

  // --- Attempt WASM backend first ---
  let wasmLoaded = false;
  try {
    const fs = await import('fs');
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);

    // Indirect the optional-dep specifier through a string variable so tsc
    // doesn't statically resolve `@ruvector/learning-wasm` at build time
    // (TS2307 when the optional dep is absent — #2586 pattern).
    const learningWasmPkg: string = '@ruvector/learning-wasm';
    const wasmPath = require.resolve(`${learningWasmPkg}/ruvector_learning_wasm_bg.wasm`);
    const wasmBuffer = fs.readFileSync(wasmPath);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional-dep dynamic import
    const learningWasm: any = await import(learningWasmPkg);
    learningWasm.initSync({ module: wasmBuffer });

    microLoRA = new learningWasm.WasmMicroLoRA(dim, alpha, lr);
    features.push(`MicroLoRA/WASM (${dim}-dim, <1μs adaptation)`);

    scopedLoRA = new learningWasm.WasmScopedLoRA(dim, alpha, lr);
    scopedLoRA.set_category_fallback(true);
    features.push('ScopedLoRA/WASM (17 operators)');

    trajectoryBuffer = new learningWasm.WasmTrajectoryBuffer(
      config.trajectoryCapacity || 10000,
      dim
    );
    features.push('TrajectoryBuffer/WASM');

    activeBackend = 'wasm';
    wasmLoaded = true;
  } catch (wasmError) {
    // WASM not available - fall back to JS implementation
    const reason = wasmError instanceof Error ? wasmError.message : String(wasmError);
    console.warn(`[ruvector] WASM backend unavailable (${reason}), using JS fallback`);

    microLoRA = new JsMicroLoRA(dim, alpha, lr) as unknown as WasmMicroLoRA;
    features.push(`MicroLoRA/JS (${dim}-dim, JS fallback)`);

    scopedLoRA = new JsScopedLoRA(dim, alpha, lr) as unknown as WasmScopedLoRA;
    (scopedLoRA as any).set_category_fallback(true);
    features.push('ScopedLoRA/JS (17 operators)');

    trajectoryBuffer = new JsTrajectoryBuffer(
      config.trajectoryCapacity || 10000,
      dim
    ) as unknown as WasmTrajectoryBuffer;
    features.push('TrajectoryBuffer/JS');

    activeBackend = 'js-fallback';
  }

  // --- Attention mechanisms (optional, independent of WASM) ---
  try {
    const attention: any = await importWithInterop('@ruvector/attention');

    if (config.useFlashAttention !== false) {
      flashAttention = new attention.FlashAttention(dim, 64);
      features.push('FlashAttention');
    }

    if (config.useMoE) {
      moeAttention = attention.MoEAttention.simple(dim, 8, 2);
      features.push('MoE (8 experts, top-2)');
    }

    if (config.useHyperbolic) {
      hyperbolicAttention = new attention.HyperbolicAttention(dim, 1.0);
      features.push('HyperbolicAttention');
    }

    optimizer = new attention.AdamWOptimizer(lr, 0.9, 0.999, 1e-8, 0.01);
    features.push('AdamW Optimizer');

    contrastiveLoss = new attention.InfoNceLoss(0.07);
    features.push('InfoNCE Loss');

    if (config.totalSteps) {
      curriculum = new attention.CurriculumScheduler(
        config.totalSteps,
        config.warmupSteps || Math.floor(config.totalSteps * 0.1)
      );
      features.push('Curriculum Learning');
    }

    try {
      hardMiner = new attention.HardNegativeMiner(5, 'semi_hard');
      features.push('Hard Negative Mining');
    } catch {
      // Mining not available, continue without it
    }
  } catch (attentionError) {
    // @ruvector/attention not available - attention features skipped
    const reason = attentionError instanceof Error ? attentionError.message : String(attentionError);
    console.warn(`[ruvector] @ruvector/attention unavailable (${reason}), attention features disabled`);
  }

  // --- SONA (optional, backward compatible) ---
  if (config.useSona !== false) {
    try {
      const sona = await importWithInterop('@ruvector/sona');
      const sonaRank = config.sonaRank || 4;
      sonaEngine = new sona.SonaEngine(dim, sonaRank, alpha, lr) as SonaEngineInstance;
      sonaAvailable = true;
      features.push(`SONA (${dim}-dim, rank-${sonaRank}, 624k learn/s)`);
    } catch (sonaError) {
      sonaAvailable = false;
      if (config.useSona === true) {
        console.warn('SONA requested but not available:', sonaError);
      }
    }
  }

  initialized = true;
  return { success: true, features, backend: activeBackend };
}

/**
 * Operator types for scoped LoRA (0-16)
 */
export const OperatorType = {
  GENERAL: 0,
  ATTENTION: 1,
  MLP: 2,
  EMBEDDING: 3,
  NORMALIZATION: 4,
  PROJECTION: 5,
  POOLING: 6,
  CONVOLUTION: 7,
  RECURRENT: 8,
  ROUTING: 9,
  MEMORY: 10,
  REASONING: 11,
  COORDINATION: 12,
  OPTIMIZATION: 13,
  SECURITY: 14,
  TESTING: 15,
  DEBUGGING: 16,
} as const;

/**
 * Train a pattern with MicroLoRA
 */
export async function trainPattern(
  embedding: Float32Array,
  gradient: Float32Array,
  operatorType?: number
): Promise<{ deltaNorm: number; adaptCount: bigint }> {
  if (!initialized || !microLoRA) {
    throw new Error('Training system not initialized');
  }

  // Use scoped LoRA if operator type specified
  if (operatorType !== undefined && scopedLoRA) {
    scopedLoRA.adapt_array(operatorType, gradient);
    return {
      deltaNorm: scopedLoRA.delta_norm(operatorType),
      adaptCount: scopedLoRA.adapt_count(operatorType),
    };
  }

  // Standard MicroLoRA adaptation
  microLoRA.adapt_array(gradient);
  totalAdaptations++;

  return {
    deltaNorm: microLoRA.delta_norm(),
    adaptCount: microLoRA.adapt_count(),
  };
}

/**
 * Forward pass through LoRA
 */
export function forward(
  input: Float32Array,
  operatorType?: number
): Float32Array {
  if (!initialized || !microLoRA) {
    throw new Error('Training system not initialized');
  }

  totalForwards++;

  if (operatorType !== undefined && scopedLoRA) {
    return scopedLoRA.forward_array(operatorType, input);
  }

  return microLoRA.forward_array(input);
}

/**
 * Reward-based adaptation (reinforcement learning)
 */
export function adaptWithReward(
  improvement: number,
  operatorType?: number
): void {
  if (!initialized) {
    throw new Error('Training system not initialized');
  }

  if (operatorType !== undefined && scopedLoRA) {
    scopedLoRA.adapt_with_reward(operatorType, improvement);
  } else if (microLoRA) {
    microLoRA.adapt_with_reward(improvement);
  }

  totalAdaptations++;
}

/**
 * Record a learning trajectory
 */
export function recordTrajectory(
  embedding: Float32Array,
  operatorType: number,
  attentionType: number,
  executionMs: number,
  baselineMs: number
): void {
  if (!trajectoryBuffer) {
    throw new Error('Trajectory buffer not initialized');
  }

  trajectoryBuffer.record(
    embedding,
    operatorType,
    attentionType,
    executionMs,
    baselineMs
  );
}

/**
 * Get trajectory statistics
 */
export function getTrajectoryStats(): {
  successRate: number;
  meanImprovement: number;
  bestImprovement: number;
  totalCount: bigint;
  highQualityCount: number;
  variance: number;
} | null {
  if (!trajectoryBuffer || trajectoryBuffer.is_empty()) {
    return null;
  }

  return {
    successRate: trajectoryBuffer.success_rate(),
    meanImprovement: trajectoryBuffer.mean_improvement(),
    bestImprovement: trajectoryBuffer.best_improvement(),
    totalCount: trajectoryBuffer.total_count(),
    highQualityCount: trajectoryBuffer.high_quality_count(0.1),
    variance: trajectoryBuffer.variance(),
  };
}

/**
 * Compute attention with Flash Attention (2.49x-7.47x faster)
 */
export function computeFlashAttention(
  query: Float32Array,
  keys: Float32Array[],
  values: Float32Array[]
): Float32Array {
  if (!flashAttention) {
    throw new Error('Flash attention not initialized');
  }

  return flashAttention.computeRaw(query, keys, values);
}

/**
 * Compute MoE routing
 */
export function computeMoEAttention(
  query: Float32Array,
  keys: Float32Array[],
  values: Float32Array[]
): Float32Array {
  if (!moeAttention) {
    throw new Error('MoE attention not initialized');
  }

  return moeAttention.computeRaw(query, keys, values);
}

/**
 * Compute hyperbolic attention (for hierarchical patterns)
 */
export function computeHyperbolicAttention(
  query: Float32Array,
  keys: Float32Array[],
  values: Float32Array[]
): Float32Array {
  if (!hyperbolicAttention) {
    throw new Error('Hyperbolic attention not initialized');
  }

  return hyperbolicAttention.computeRaw(query, keys, values);
}

/**
 * Compute contrastive loss for training
 */
export function computeContrastiveLoss(
  anchor: Float32Array,
  positives: Float32Array[],
  negatives: Float32Array[]
): { loss: number; gradient: Float32Array } {
  if (!contrastiveLoss) {
    throw new Error('Contrastive loss not initialized');
  }

  const loss = contrastiveLoss.compute(anchor, positives, negatives);
  const gradient = contrastiveLoss.backward(anchor, positives, negatives);

  return { loss, gradient };
}

/**
 * Optimizer step
 */
export function optimizerStep(
  params: Float32Array,
  gradients: Float32Array
): Float32Array {
  if (!optimizer) {
    throw new Error('Optimizer not initialized');
  }

  return optimizer.step(params, gradients);
}

/**
 * Get curriculum difficulty for current step
 */
export function getCurriculumDifficulty(step: number): number {
  if (!curriculum) {
    return 1.0; // Full difficulty if no curriculum
  }

  return curriculum.getDifficulty(step);
}

/**
 * Mine hard negatives for better training
 */
export function mineHardNegatives(
  anchor: Float32Array,
  candidates: Float32Array[]
): number[] {
  if (!hardMiner) {
    throw new Error('Hard negative miner not initialized');
  }

  return hardMiner.mine(anchor, candidates);
}

/**
 * Benchmark the training system
 */
export async function benchmarkTraining(
  dim?: number,
  iterations?: number
): Promise<BenchmarkResult[]> {
  const attention: any = await importWithInterop('@ruvector/attention');
  lastBenchmark = attention.benchmarkAttention(dim || 256, 100, iterations || 1000);
  return lastBenchmark ?? [];
}

// ============================================
// SONA Functions (v2 enhancement, optional)
// ============================================

/**
 * Check if SONA is available
 */
export function isSonaAvailable(): boolean {
  return sonaAvailable && sonaEngine !== null;
}

/**
 * Force-learn a pattern with SONA (1.6μs, 624k ops/s)
 * This is a one-shot learning mechanism for immediate pattern storage
 */
export function sonaForceLearn(
  embedding: Float32Array,
  reward: number
): void {
  if (!sonaEngine) {
    throw new Error('SONA not initialized. Call initializeTraining with useSona: true');
  }

  sonaEngine.forceLearn(embedding, reward);
  totalSonaLearns++;
}

/**
 * Search for similar patterns with SONA (16.7μs, 60k searches/s)
 * Returns the k most similar patterns from the pattern bank
 */
export function sonaFindPatterns(
  embedding: Float32Array,
  k: number = 5
): unknown[] {
  if (!sonaEngine) {
    throw new Error('SONA not initialized. Call initializeTraining with useSona: true');
  }

  // SONA requires Array, not Float32Array
  const embeddingArray = Array.from(embedding);
  totalSonaSearches++;
  return sonaEngine.findPatterns(embeddingArray, k);
}

/**
 * Process SONA background tasks (0.13μs, 7.5M ticks/s)
 * Call periodically to process background learning and consolidation
 */
export function sonaTick(): void {
  if (!sonaEngine) {
    return; // Silent no-op if SONA not available
  }

  sonaEngine.tick();
}

/**
 * Get SONA statistics
 */
export function getSonaStats(): {
  available: boolean;
  enabled: boolean;
  stats: Record<string, unknown> | null;
  totalLearns: number;
  totalSearches: number;
} {
  if (!sonaEngine) {
    return {
      available: false,
      enabled: false,
      stats: null,
      totalLearns: totalSonaLearns,
      totalSearches: totalSonaSearches,
    };
  }

  try {
    const statsJson = sonaEngine.getStats();
    const stats = JSON.parse(statsJson);
    return {
      available: true,
      enabled: sonaEngine.isEnabled(),
      stats,
      totalLearns: totalSonaLearns,
      totalSearches: totalSonaSearches,
    };
  } catch {
    return {
      available: true,
      enabled: false,
      stats: null,
      totalLearns: totalSonaLearns,
      totalSearches: totalSonaSearches,
    };
  }
}

/**
 * Enable/disable SONA learning
 */
export function setSonaEnabled(enabled: boolean): void {
  if (!sonaEngine) {
    return;
  }

  sonaEngine.setEnabled(enabled);
}

/**
 * Flush SONA buffers (persist any pending patterns)
 */
export function sonaFlush(): void {
  if (!sonaEngine) {
    return;
  }

  sonaEngine.flush();
}

/**
 * Get training statistics
 */
export function getTrainingStats(): {
  initialized: boolean;
  backend: 'wasm' | 'js-fallback';
  totalAdaptations: number;
  totalForwards: number;
  microLoraStats?: {
    paramCount: number;
    adaptCount: bigint;
    forwardCount: bigint;
    deltaNorm: number;
  };
  scopedLoraStats?: {
    totalAdaptCount: bigint;
    totalForwardCount: bigint;
  };
  trajectoryStats?: ReturnType<typeof getTrajectoryStats>;
  sonaStats?: ReturnType<typeof getSonaStats>;
  lastBenchmark?: BenchmarkResult[];
} {
  const stats: ReturnType<typeof getTrainingStats> = {
    initialized,
    backend: activeBackend,
    totalAdaptations,
    totalForwards,
  };

  if (microLoRA) {
    stats.microLoraStats = {
      paramCount: microLoRA.param_count(),
      adaptCount: microLoRA.adapt_count(),
      forwardCount: microLoRA.forward_count(),
      deltaNorm: microLoRA.delta_norm(),
    };
  }

  if (scopedLoRA) {
    stats.scopedLoraStats = {
      totalAdaptCount: scopedLoRA.total_adapt_count(),
      totalForwardCount: scopedLoRA.total_forward_count(),
    };
  }

  if (trajectoryBuffer && !trajectoryBuffer.is_empty()) {
    stats.trajectoryStats = getTrajectoryStats();
  }

  // Include SONA stats if available
  if (sonaAvailable) {
    stats.sonaStats = getSonaStats();
  }

  if (lastBenchmark) {
    stats.lastBenchmark = lastBenchmark;
  }

  return stats;
}

/**
 * Reset the training system
 */
export function resetTraining(): void {
  if (microLoRA) microLoRA.reset();
  if (scopedLoRA) scopedLoRA.reset_all();
  if (trajectoryBuffer) trajectoryBuffer.reset();

  // Reset SONA stats (engine doesn't have reset, just flush)
  if (sonaEngine) {
    sonaEngine.flush();
  }

  totalAdaptations = 0;
  totalForwards = 0;
  totalSonaLearns = 0;
  totalSonaSearches = 0;
  activeBackend = 'js-fallback';
}

/**
 * Export trained weights
 */
export function exportWeights(): {
  dim: number;
  deltaNorm: number;
  adaptCount: bigint;
  trajectoryStats: ReturnType<typeof getTrajectoryStats>;
} | null {
  if (!initialized || !microLoRA) {
    return null;
  }

  return {
    dim: microLoRA.dim(),
    deltaNorm: microLoRA.delta_norm(),
    adaptCount: microLoRA.adapt_count(),
    trajectoryStats: getTrajectoryStats(),
  };
}

/**
 * Cleanup resources
 */
export function cleanup(): void {
  if (microLoRA) {
    microLoRA.free();
    microLoRA = null;
  }
  if (scopedLoRA) {
    scopedLoRA.free();
    scopedLoRA = null;
  }
  if (trajectoryBuffer) {
    trajectoryBuffer.free();
    trajectoryBuffer = null;
  }

  // Cleanup SONA
  if (sonaEngine) {
    sonaEngine.flush();
    sonaEngine = null;
    sonaAvailable = false;
  }

  flashAttention = null;
  moeAttention = null;
  hyperbolicAttention = null;
  optimizer = null;
  contrastiveLoss = null;
  curriculum = null;
  hardMiner = null;

  initialized = false;
  totalAdaptations = 0;
  totalForwards = 0;
  totalSonaLearns = 0;
  totalSonaSearches = 0;
  lastBenchmark = null;
}
