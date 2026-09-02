/**
 * Edge Mode Implementation
 *
 * Optimized for resource-constrained environments with:
 * - <5MB memory footprint
 * - Minimal latency (<1ms)
 * - Micro-LoRA (rank-1)
 * - Aggressive pruning
 * - Async updates
 */
import type { SONAModeConfig, Trajectory, Pattern, PatternMatch, LoRAWeights, EWCState } from '../types.js';
import { BaseModeImplementation } from './index.js';
/**
 * Edge mode for resource-constrained devices
 */
export declare class EdgeMode extends BaseModeImplementation {
    readonly mode = "edge";
    private compressedPatterns;
    private quantizedWeights;
    private quantizationScale;
    private pendingUpdates;
    private updateTimer;
    private totalOps;
    private totalTime;
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    /**
     * Find patterns using compressed embeddings
     */
    findPatterns(embedding: Float32Array, k: number, patterns: Pattern[]): Promise<PatternMatch[]>;
    /**
     * Lightweight learning with async updates
     */
    learn(trajectories: Trajectory[], config: SONAModeConfig, ewcState: EWCState): Promise<number>;
    /**
     * Apply quantized LoRA
     */
    applyLoRA(input: Float32Array, weights?: LoRAWeights): Promise<Float32Array>;
    getStats(): Record<string, number>;
    /**
     * Compress embedding to 8-bit representation
     */
    private compressEmbedding;
    /**
     * Create compressed pattern representation
     */
    private createCompressedPattern;
    /**
     * Fast similarity on compressed embeddings
     */
    private compressedSimilarity;
    /**
     * Get or create quantized weights
     */
    private getOrQuantize;
    /**
     * Quantize float weights to int8
     */
    private quantizeWeights;
    /**
     * Apply LoRA with quantized weights
     */
    private applyQuantizedLoRA;
    /**
     * Queue an async update
     */
    private queueAsyncUpdate;
    /**
     * Process pending async updates
     */
    private processAsyncUpdates;
    /**
     * Perform lightweight parameter update
     */
    private performLightweightUpdate;
    /**
     * Find most similar compressed pattern
     */
    private findSimilarCompressedPattern;
    /**
     * Estimate memory usage in MB
     */
    private estimateMemoryUsage;
}
//# sourceMappingURL=edge.d.ts.map