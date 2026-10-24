/**
 * SONA Learning Modes Index
 *
 * Exports all learning mode implementations and the common interface.
 */
import type { SONAModeConfig, ModeOptimizations, Trajectory, Pattern, PatternMatch, LoRAWeights, EWCState } from '../types.js';
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
    findPatterns(embedding: Float32Array, k: number, patterns: Pattern[]): Promise<PatternMatch[]>;
    /** Perform a learning step */
    learn(trajectories: Trajectory[], config: SONAModeConfig, ewcState: EWCState): Promise<number>;
    /** Apply LoRA adaptations */
    applyLoRA(input: Float32Array, weights?: LoRAWeights): Promise<Float32Array>;
    /** Get mode-specific stats */
    getStats(): Record<string, number>;
}
/**
 * Base class for mode implementations
 */
export declare abstract class BaseModeImplementation implements ModeImplementation {
    abstract readonly mode: string;
    protected config: SONAModeConfig;
    protected optimizations: ModeOptimizations;
    protected isInitialized: boolean;
    constructor(config: SONAModeConfig, optimizations: ModeOptimizations);
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    /**
     * Compute cosine similarity between two vectors (SIMD-optimized)
     */
    protected cosineSimilarity(a: Float32Array, b: Float32Array): number;
    /**
     * Apply LoRA: output = input + BA * input (simplified)
     */
    protected applyLoRATransform(input: Float32Array, A: Float32Array, B: Float32Array, rank: number): Float32Array;
    abstract findPatterns(embedding: Float32Array, k: number, patterns: Pattern[]): Promise<PatternMatch[]>;
    abstract learn(trajectories: Trajectory[], config: SONAModeConfig, ewcState: EWCState): Promise<number>;
    abstract applyLoRA(input: Float32Array, weights?: LoRAWeights): Promise<Float32Array>;
    abstract getStats(): Record<string, number>;
}
export { RealTimeMode } from './real-time.js';
export { BalancedMode } from './balanced.js';
export { ResearchMode } from './research.js';
export { EdgeMode } from './edge.js';
export { BatchMode } from './batch.js';
//# sourceMappingURL=index.d.ts.map