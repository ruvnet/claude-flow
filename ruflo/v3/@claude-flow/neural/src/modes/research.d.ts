/**
 * Research Mode Implementation
 *
 * Optimized for maximum quality with:
 * - +55% quality improvement target
 * - Learning rate 0.002 (sweet spot)
 * - Rank-16 LoRA
 * - Gradient checkpointing
 * - Full learning pipeline
 */
import type { SONAModeConfig, Trajectory, Pattern, PatternMatch, LoRAWeights, EWCState } from '../types.js';
import { BaseModeImplementation } from './index.js';
/**
 * Research mode for maximum quality learning
 */
export declare class ResearchMode extends BaseModeImplementation {
    readonly mode = "research";
    private patternIndex;
    private clusterCentroids;
    private gradientHistory;
    private checkpoints;
    private adamM;
    private adamV;
    private adamStep;
    private totalPatternMatches;
    private totalPatternTime;
    private totalLearnTime;
    private learnIterations;
    private qualityHistory;
    private explorationRewards;
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    /**
     * Find patterns using cluster-based search
     */
    findPatterns(embedding: Float32Array, k: number, patterns: Pattern[]): Promise<PatternMatch[]>;
    /**
     * Learn using full Adam optimizer with gradient checkpointing
     */
    learn(trajectories: Trajectory[], config: SONAModeConfig, ewcState: EWCState): Promise<number>;
    /**
     * Apply LoRA with rank-16 for maximum expressivity
     */
    applyLoRA(input: Float32Array, weights?: LoRAWeights): Promise<Float32Array>;
    getStats(): Record<string, number>;
    /**
     * Rebuild cluster centroids using k-means
     */
    private rebuildClusters;
    /**
     * Get nearest clusters to embedding
     */
    private getNearestClusters;
    /**
     * Compute confidence for pattern match
     */
    private computeConfidence;
    /**
     * Create learning checkpoint
     */
    private createCheckpoint;
    /**
     * Process a mini-batch with Adam optimizer
     */
    private processBatch;
    /**
     * Compute gradient from trajectory
     */
    private computeTrajectoryGradient;
    /**
     * Compute advantages using GAE
     */
    private computeAdvantages;
    /**
     * Compute EWC loss for continual learning
     */
    private computeEWCLoss;
}
//# sourceMappingURL=research.d.ts.map