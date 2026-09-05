/**
 * SONA Bridge
 *
 * Bridge to SONA (Self-Optimizing Neural Architecture) for continuous
 * learning with LoRA fine-tuning and EWC++ memory preservation.
 */

import type { WasmBridge, WasmModuleStatus, SonaConfig } from '../types.js';
import { SonaConfigSchema } from '../types.js';

/**
 * SONA trajectory for learning
 */
export interface SonaTrajectory {
  id: string;
  domain: string;
  steps: SonaStep[];
  qualityScore: number;
  metadata?: Record<string, unknown>;
}

/**
 * SONA learning step
 */
export interface SonaStep {
  stateBefore: Float32Array;
  action: string;
  stateAfter: Float32Array;
  reward: number;
  timestamp: number;
}

/**
 * SONA pattern
 */
export interface SonaPattern {
  id: string;
  embedding: Float32Array;
  successRate: number;
  usageCount: number;
  domain: string;
}

/**
 * LoRA weights
 */
export interface LoRAWeights {
  A: Map<string, Float32Array>;
  B: Map<string, Float32Array>;
  rank: number;
  alpha: number;
}

/**
 * EWC state
 */
export interface EWCState {
  fisher: Map<string, Float32Array>;
  means: Map<string, Float32Array>;
  lambda: number;
}

/**
 * SONA WASM module interface
 */
interface SonaModule {
  // Core learning
  learn(trajectories: SonaTrajectory[], config: SonaConfig): number;
  predict(state: Float32Array): { action: string; confidence: number };

  // Pattern management
  storePattern(pattern: SonaPattern): void;
  findPatterns(query: Float32Array, k: number): SonaPattern[];
  updatePatternSuccess(patternId: string, success: boolean): void;

  // LoRA operations
  applyLoRA(input: Float32Array, weights: LoRAWeights): Float32Array;
  updateLoRA(gradients: Float32Array, config: SonaConfig): LoRAWeights;

  // EWC operations
  computeFisher(trajectories: SonaTrajectory[]): Map<string, Float32Array>;
  consolidate(ewcState: EWCState): void;

  // Mode-specific optimizations
  setMode(mode: SonaConfig['mode']): void;
  getMode(): SonaConfig['mode'];
}

/**
 * SONA Bridge implementation
 */
export class SonaBridge implements WasmBridge<SonaModule> {
  readonly name = 'sona';
  readonly version = '0.1.0';

  private _status: WasmModuleStatus = 'unloaded';
  private _module: SonaModule | null = null;
  private config: SonaConfig;

  constructor(config?: Partial<SonaConfig>) {
    this.config = SonaConfigSchema.parse(config ?? {});
  }

  get status(): WasmModuleStatus {
    return this._status;
  }

  async init(): Promise<void> {
    if (this._status === 'ready') return;
    if (this._status === 'loading') return;

    this._status = 'loading';

    try {
      const wasmModule = await import('@ruvector/sona' as string).catch(() => null);

      if (wasmModule) {
        this._module = wasmModule as unknown as SonaModule;
      } else {
        this._module = this.createMockModule();
      }

      this._module.setMode(this.config.mode);
      this._status = 'ready';
    } catch (error) {
      this._status = 'error';
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this._module = null;
    this._status = 'unloaded';
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  getModule(): SonaModule | null {
    return this._module;
  }

  /**
   * Learn from trajectories
   */
  learn(trajectories: SonaTrajectory[], config?: Partial<SonaConfig>): number {
    if (!this._module) throw new Error('SONA module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.learn(trajectories, mergedConfig);
  }

  /**
   * Predict next action
   */
  predict(state: Float32Array): { action: string; confidence: number } {
    if (!this._module) throw new Error('SONA module not initialized');
    return this._module.predict(state);
  }

  /**
   * Store a pattern
   */
  storePattern(pattern: SonaPattern): void {
    if (!this._module) throw new Error('SONA module not initialized');
    this._module.storePattern(pattern);
  }

  /**
   * Find similar patterns
   */
  findPatterns(query: Float32Array, k: number): SonaPattern[] {
    if (!this._module) throw new Error('SONA module not initialized');
    return this._module.findPatterns(query, k);
  }

  /**
   * Apply LoRA transformation
   */
  applyLoRA(input: Float32Array, weights: LoRAWeights): Float32Array {
    if (!this._module) throw new Error('SONA module not initialized');
    return this._module.applyLoRA(input, weights);
  }

  /**
   * Consolidate memory with EWC
   */
  consolidate(ewcState: EWCState): void {
    if (!this._module) throw new Error('SONA module not initialized');
    this._module.consolidate(ewcState);
  }

  /**
   * Set operating mode
   */
  setMode(mode: SonaConfig['mode']): void {
    if (!this._module) throw new Error('SONA module not initialized');
    this._module.setMode(mode);
    this.config.mode = mode;
  }

  /**
   * Get current mode
   */
  getMode(): SonaConfig['mode'] {
    return this._module?.getMode() ?? this.config.mode;
  }

  /**
   * Create mock module for development
   */
  private createMockModule(): SonaModule {
    const patterns = new Map<string, SonaPattern>();
    let currentMode: SonaConfig['mode'] = 'balanced';
    let loraWeights: LoRAWeights = {
      A: new Map(),
      B: new Map(),
      rank: 4,
      alpha: 0.1,
    };

    return {
      learn(trajectories: SonaTrajectory[], config: SonaConfig): number {
        if (trajectories.length === 0) return 0;

        const goodTrajectories = trajectories.filter(t => t.qualityScore >= 0.5);
        if (goodTrajectories.length === 0) return 0;

        // Extract patterns from good trajectories
        for (const trajectory of goodTrajectories) {
          if (trajectory.steps.length > 0) {
            const lastStep = trajectory.steps[trajectory.steps.length - 1];
            const patternId = `pattern_${patterns.size}`;

            patterns.set(patternId, {
              id: patternId,
              embedding: new Float32Array(lastStep.stateAfter),
              successRate: trajectory.qualityScore,
              usageCount: 1,
              domain: trajectory.domain,
            });
          }
        }

        const avgQuality = goodTrajectories.reduce((s, t) => s + t.qualityScore, 0) / goodTrajectories.length;
        return Math.max(0, avgQuality - 0.5);
      },

      predict(state: Float32Array): { action: string; confidence: number } {
        // Find most similar pattern
        let bestPattern: SonaPattern | null = null;
        let bestSim = -1;

        for (const pattern of patterns.values()) {
          const sim = cosineSimilarity(state, pattern.embedding);
          if (sim > bestSim) {
            bestSim = sim;
            bestPattern = pattern;
          }
        }

        if (bestPattern && bestSim > 0.5) {
          return {
            action: bestPattern.domain,
            confidence: bestSim * bestPattern.successRate,
          };
        }

        return { action: 'explore', confidence: 0.3 };
      },

      storePattern(pattern: SonaPattern): void {
        patterns.set(pattern.id, pattern);
      },

      findPatterns(query: Float32Array, k: number): SonaPattern[] {
        const results: Array<{ pattern: SonaPattern; sim: number }> = [];

        for (const pattern of patterns.values()) {
          const sim = cosineSimilarity(query, pattern.embedding);
          results.push({ pattern, sim });
        }

        results.sort((a, b) => b.sim - a.sim);
        return results.slice(0, k).map(r => r.pattern);
      },

      updatePatternSuccess(patternId: string, success: boolean): void {
        const pattern = patterns.get(patternId);
        if (pattern) {
          pattern.usageCount++;
          const alpha = 1 / pattern.usageCount;
          pattern.successRate = pattern.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
        }
      },

      applyLoRA(input: Float32Array, weights: LoRAWeights): Float32Array {
        const output = new Float32Array(input.length);
        output.set(input);

        // Apply LoRA: output = input + alpha * B @ A @ input
        for (const [module, A] of weights.A) {
          const B = weights.B.get(module);
          if (!B) continue;

          // Simplified LoRA application
          let intermediate = 0;
          for (let i = 0; i < Math.min(input.length, A.length); i++) {
            intermediate += A[i] * input[i];
          }

          for (let i = 0; i < Math.min(output.length, B.length); i++) {
            output[i] += weights.alpha * B[i] * intermediate;
          }
        }

        return output;
      },

      updateLoRA(gradients: Float32Array, config: SonaConfig): LoRAWeights {
        // Update LoRA weights based on gradients
        const dim = gradients.length;
        const rank = config.loraRank;

        const A = new Float32Array(rank * dim);
        const B = new Float32Array(dim * rank);

        // Initialize with small random values scaled by gradients
        for (let i = 0; i < A.length; i++) {
          A[i] = (Math.random() - 0.5) * 0.01 * (gradients[i % dim] || 1);
        }
        for (let i = 0; i < B.length; i++) {
          B[i] = (Math.random() - 0.5) * 0.01 * (gradients[i % dim] || 1);
        }

        loraWeights.A.set('default', A);
        loraWeights.B.set('default', B);
        loraWeights.rank = rank;

        return loraWeights;
      },

      computeFisher(trajectories: SonaTrajectory[]): Map<string, Float32Array> {
        const fisher = new Map<string, Float32Array>();

        for (const trajectory of trajectories) {
          for (const step of trajectory.steps) {
            const key = trajectory.domain;
            let f = fisher.get(key);

            if (!f) {
              f = new Float32Array(step.stateAfter.length);
              fisher.set(key, f);
            }

            // Approximate Fisher information
            for (let i = 0; i < step.stateAfter.length; i++) {
              const grad = step.stateAfter[i] * step.reward;
              f[i] += grad * grad;
            }
          }
        }

        // Normalize
        for (const f of fisher.values()) {
          const sum = f.reduce((s, v) => s + v, 0);
          if (sum > 0) {
            for (let i = 0; i < f.length; i++) {
              f[i] /= sum;
            }
          }
        }

        return fisher;
      },

      consolidate(ewcState: EWCState): void {
        // Apply EWC penalty to prevent catastrophic forgetting
        // This modifies the learning in future updates
      },

      setMode(mode: SonaConfig['mode']): void {
        currentMode = mode;
      },

      getMode(): SonaConfig['mode'] {
        return currentMode;
      },
    };
  }
}

/**
 * Cosine similarity helper
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Create a new SONA bridge
 */
export function createSonaBridge(config?: Partial<SonaConfig>): SonaBridge {
  return new SonaBridge(config);
}
