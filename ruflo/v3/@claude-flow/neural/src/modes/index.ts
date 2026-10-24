/**
 * SONA Learning Modes Index
 *
 * Exports all learning mode implementations and the common interface.
 */

import type {
  SONAModeConfig,
  ModeOptimizations,
  Trajectory,
  Pattern,
  PatternMatch,
  LoRAWeights,
  EWCState,
} from '../types.js';

/**
 * Common interface for all mode implementations
 */
export interface ModeImplementation {
  /** Mode identifier */
  readonly mode: string;

  /** Initialize the mode */
  initialize(): Promise<void>;

  /** Cleanup resources */
  cleanup(): Promise<void>;

  /** Find similar patterns (k-nearest) */
  findPatterns(
    embedding: Float32Array,
    k: number,
    patterns: Pattern[]
  ): Promise<PatternMatch[]>;

  /** Perform a learning step */
  learn(
    trajectories: Trajectory[],
    config: SONAModeConfig,
    ewcState: EWCState
  ): Promise<number>;

  /** Apply LoRA adaptations */
  applyLoRA(
    input: Float32Array,
    weights?: LoRAWeights
  ): Promise<Float32Array>;

  /** Get mode-specific stats */
  getStats(): Record<string, number>;
}

/**
 * Base class for mode implementations
 */
export abstract class BaseModeImplementation implements ModeImplementation {
  abstract readonly mode: string;

  protected config: SONAModeConfig;
  protected optimizations: ModeOptimizations;
  protected isInitialized = false;

  constructor(config: SONAModeConfig, optimizations: ModeOptimizations) {
    this.config = config;
    this.optimizations = optimizations;
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  async cleanup(): Promise<void> {
    this.isInitialized = false;
  }

  /**
   * Compute cosine similarity between two vectors (SIMD-optimized)
   */
  protected cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    // Process 4 elements at a time for SIMD-like behavior
    const len = a.length;
    const simdLen = len - (len % 4);

    for (let i = 0; i < simdLen; i += 4) {
      dotProduct += a[i] * b[i] + a[i+1] * b[i+1] + a[i+2] * b[i+2] + a[i+3] * b[i+3];
      normA += a[i] * a[i] + a[i+1] * a[i+1] + a[i+2] * a[i+2] + a[i+3] * a[i+3];
      normB += b[i] * b[i] + b[i+1] * b[i+1] + b[i+2] * b[i+2] + b[i+3] * b[i+3];
    }

    // Handle remaining elements
    for (let i = simdLen; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dotProduct / denom : 0;
  }

  /**
   * Apply LoRA: output = input + BA * input (simplified)
   */
  protected applyLoRATransform(
    input: Float32Array,
    A: Float32Array,
    B: Float32Array,
    rank: number
  ): Float32Array {
    const dim = input.length;
    const output = new Float32Array(dim);

    // Copy input to output
    output.set(input);

    // Compute A * input -> intermediate (rank dimensions)
    const intermediate = new Float32Array(rank);
    for (let r = 0; r < rank; r++) {
      let sum = 0;
      for (let d = 0; d < dim; d++) {
        sum += A[d * rank + r] * input[d];
      }
      intermediate[r] = sum;
    }

    // Compute B * intermediate -> delta (dim dimensions)
    for (let d = 0; d < dim; d++) {
      let sum = 0;
      for (let r = 0; r < rank; r++) {
        sum += B[r * dim + d] * intermediate[r];
      }
      output[d] += sum;
    }

    return output;
  }

  abstract findPatterns(
    embedding: Float32Array,
    k: number,
    patterns: Pattern[]
  ): Promise<PatternMatch[]>;

  abstract learn(
    trajectories: Trajectory[],
    config: SONAModeConfig,
    ewcState: EWCState
  ): Promise<number>;

  abstract applyLoRA(
    input: Float32Array,
    weights?: LoRAWeights
  ): Promise<Float32Array>;

  abstract getStats(): Record<string, number>;
}

// Export mode implementations
export { RealTimeMode } from './real-time.js';
export { BalancedMode } from './balanced.js';
export { ResearchMode } from './research.js';
export { EdgeMode } from './edge.js';
export { BatchMode } from './batch.js';
