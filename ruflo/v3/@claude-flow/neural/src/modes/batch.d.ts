/**
 * Batch Mode Implementation
 *
 * Optimized for high-throughput processing with:
 * - Large batch sizes (128)
 * - Rank-8 LoRA
 * - Gradient accumulation
 * - Async batch processing
 * - 50ms latency budget
 */
import type { SONAModeConfig, Trajectory, Pattern, PatternMatch, LoRAWeights, EWCState } from '../types.js';
import { BaseModeImplementation } from './index.js';
/**
 * Batch mode for high-throughput processing
 */
export declare class BatchMode extends BaseModeImplementation {
    readonly mode = "batch";
    private patternQueue;
    private learningQueue;
    private embeddingBuffer;
    private batchEmbeddings;
    private accumulatedGradients;
    private gradientSteps;
    private isBatchProcessing;
    private batchTimer;
    private totalBatches;
    private totalItems;
    private totalBatchTime;
    private learnIterations;
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    /**
     * Find patterns - queues for batch processing
     */
    findPatterns(embedding: Float32Array, k: number, patterns: Pattern[]): Promise<PatternMatch[]>;
    /**
     * Learn from trajectories - accumulates for batch
     */
    learn(trajectories: Trajectory[], config: SONAModeConfig, ewcState: EWCState): Promise<number>;
    /**
     * Apply LoRA with rank-8
     */
    applyLoRA(input: Float32Array, weights?: LoRAWeights): Promise<Float32Array>;
    getStats(): Record<string, number>;
    /**
     * Direct pattern matching without batching
     */
    private findPatternsDirect;
    /**
     * Direct LoRA application
     */
    private applyLoRADirect;
    /**
     * Schedule batch processing
     */
    private scheduleBatchProcessing;
    /**
     * Process pattern requests in batch
     */
    private processBatchPatterns;
    /**
     * Batch similarity search
     */
    private batchSimilaritySearch;
    /**
     * Process batch learning
     */
    private processBatchLearning;
    /**
     * Accumulate gradient from trajectory
     */
    private accumulateTrajectoryGradient;
    /**
     * Apply accumulated gradients with EWC
     */
    private applyAccumulatedGradients;
    /**
     * Apply LoRA to batch of inputs
     */
    private applyLoRABatch;
}
//# sourceMappingURL=batch.d.ts.map