/**
 * Balanced Mode Implementation
 *
 * General-purpose mode with:
 * - +25% quality improvement
 * - 18ms overhead
 * - Rank-4 LoRA
 * - Pattern caching
 * - Standard learning pipeline
 */
import type { SONAModeConfig, Trajectory, Pattern, PatternMatch, LoRAWeights, EWCState } from '../types.js';
import { BaseModeImplementation } from './index.js';
/**
 * Balanced mode for general-purpose learning
 */
export declare class BalancedMode extends BaseModeImplementation {
    readonly mode = "balanced";
    private patternCache;
    private cacheHits;
    private cacheMisses;
    private gradientAccumulator;
    private momentumBuffers;
    private totalPatternMatches;
    private totalPatternTime;
    private totalLearnTime;
    private learnIterations;
    private qualityImprovements;
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    /**
     * Find patterns using similarity search with caching
     */
    findPatterns(embedding: Float32Array, k: number, patterns: Pattern[]): Promise<PatternMatch[]>;
    /**
     * Learn from trajectories using standard gradient descent
     */
    learn(trajectories: Trajectory[], config: SONAModeConfig, ewcState: EWCState): Promise<number>;
    /**
     * Apply LoRA adaptations with rank-4
     */
    applyLoRA(input: Float32Array, weights?: LoRAWeights): Promise<Float32Array>;
    getStats(): Record<string, number>;
    /**
     * Compute cache key from embedding
     */
    private computeCacheKey;
    /**
     * Compute gradient from state and reward
     */
    private computeGradient;
    /**
     * Accumulate gradient with momentum
     */
    private accumulateGradient;
    /**
     * Compute EWC penalty for continual learning
     */
    private computeEWCPenalty;
}
//# sourceMappingURL=balanced.d.ts.map