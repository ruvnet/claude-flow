/**
 * Proximal Policy Optimization (PPO)
 *
 * Implements PPO algorithm for stable policy learning with:
 * - Clipped surrogate objective
 * - GAE (Generalized Advantage Estimation)
 * - Value function clipping
 * - Entropy bonus
 *
 * Performance Target: <10ms per update step
 */
import type { PPOConfig, Trajectory } from '../types.js';
/**
 * Default PPO configuration
 */
export declare const DEFAULT_PPO_CONFIG: PPOConfig;
/**
 * PPO Algorithm Implementation
 */
export declare class PPOAlgorithm {
    private config;
    private policyWeights;
    private valueWeights;
    private policyMomentum;
    private valueMomentum;
    private buffer;
    private updateCount;
    private totalLoss;
    private approxKL;
    private clipFraction;
    constructor(config?: Partial<PPOConfig>);
    /**
     * Add experience from trajectory
     */
    addExperience(trajectory: Trajectory): void;
    /**
     * Perform PPO update
     * Target: <10ms
     */
    update(): {
        policyLoss: number;
        valueLoss: number;
        entropy: number;
    };
    /**
     * Get action from policy
     */
    getAction(state: Float32Array): {
        action: number;
        logProb: number;
        value: number;
    };
    /**
     * Get statistics
     */
    getStats(): Record<string, number>;
    private computeValue;
    private computeLogits;
    private computeLogProb;
    private hashAction;
    private softmax;
    private sampleAction;
    private computeGAE;
    private computeReturns;
    private shuffleBuffer;
    private updateMiniBatch;
}
/**
 * Factory function
 */
export declare function createPPO(config?: Partial<PPOConfig>): PPOAlgorithm;
//# sourceMappingURL=ppo.d.ts.map