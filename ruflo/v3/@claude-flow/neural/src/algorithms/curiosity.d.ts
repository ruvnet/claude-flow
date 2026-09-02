/**
 * Curiosity-Driven Exploration
 *
 * Implements intrinsic motivation for exploration:
 * - Intrinsic Curiosity Module (ICM)
 * - Random Network Distillation (RND)
 * - Forward and inverse dynamics models
 * - Exploration bonus generation
 *
 * Performance Target: <5ms per forward pass
 */
import type { CuriosityConfig, Trajectory } from '../types.js';
/**
 * Default Curiosity configuration
 */
export declare const DEFAULT_CURIOSITY_CONFIG: CuriosityConfig;
/**
 * Curiosity-Driven Exploration Module
 */
export declare class CuriosityModule {
    private config;
    private featureEncoder;
    private forwardModel;
    private inverseModel;
    private rndTarget;
    private rndPredictor;
    private forwardMomentum;
    private inverseMomentum;
    private rndMomentum;
    private stateDim;
    private numActions;
    private intrinsicMean;
    private intrinsicVar;
    private updateCount;
    private avgForwardLoss;
    private avgInverseLoss;
    private avgIntrinsicReward;
    constructor(config?: Partial<CuriosityConfig>);
    /**
     * Compute intrinsic reward for a transition
     */
    computeIntrinsicReward(state: Float32Array, action: string, nextState: Float32Array): number;
    /**
     * Compute ICM-based intrinsic reward (prediction error)
     */
    computeICMReward(state: Float32Array, action: string, nextState: Float32Array): number;
    /**
     * Compute RND-based intrinsic reward
     */
    computeRNDReward(state: Float32Array): number;
    /**
     * Update curiosity models from trajectory
     */
    update(trajectory: Trajectory): {
        forwardLoss: number;
        inverseLoss: number;
    };
    /**
     * Add intrinsic rewards to trajectory
     */
    augmentTrajectory(trajectory: Trajectory): Trajectory;
    /**
     * Get statistics
     */
    getStats(): Record<string, number>;
    private initWeight;
    private encodeState;
    private forwardPredict;
    private inversePredict;
    private rndForward;
    private updateForwardModel;
    private updateInverseModel;
    private updateRNDPredictor;
    private normalizeIntrinsic;
    private softmax;
    private hashAction;
}
/**
 * Factory function
 */
export declare function createCuriosity(config?: Partial<CuriosityConfig>): CuriosityModule;
//# sourceMappingURL=curiosity.d.ts.map