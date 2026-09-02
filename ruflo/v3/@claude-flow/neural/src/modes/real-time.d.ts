/**
 * Real-Time Mode Implementation
 *
 * Optimized for sub-millisecond adaptation with:
 * - 2200 ops/sec target
 * - <0.5ms latency
 * - Micro-LoRA (rank-2)
 * - SIMD vectorization
 * - Aggressive caching
 */
import type { SONAModeConfig, Trajectory, Pattern, PatternMatch, LoRAWeights, EWCState } from '../types.js';
import { BaseModeImplementation } from './index.js';
/**
 * Real-Time mode for sub-millisecond adaptation
 */
export declare class RealTimeMode extends BaseModeImplementation {
    readonly mode = "real-time";
    private patternCache;
    private cacheHits;
    private cacheMisses;
    private patternEmbeddings;
    private patternIds;
    private totalPatternMatches;
    private totalPatternTime;
    private totalLearnTime;
    private learnIterations;
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    /**
     * Find patterns using cached similarity search
     * Target: <1ms for k=3
     */
    findPatterns(embedding: Float32Array, k: number, patterns: Pattern[]): Promise<PatternMatch[]>;
    /**
     * Fast learning using Micro-LoRA updates
     * Target: <10ms per batch
     */
    learn(trajectories: Trajectory[], config: SONAModeConfig, ewcState: EWCState): Promise<number>;
    /**
     * Apply LoRA with minimal overhead
     * Target: <0.05ms
     */
    applyLoRA(input: Float32Array, weights?: LoRAWeights): Promise<Float32Array>;
    getStats(): Record<string, number>;
    /**
     * Compute cache key from embedding
     */
    private computeCacheKey;
    /**
     * Update pattern index for fast similarity search
     */
    private updatePatternIndex;
    /**
     * Partial sort to get top-k elements (faster than full sort)
     */
    private partialSort;
}
//# sourceMappingURL=real-time.d.ts.map