/**
 * Advantage Actor-Critic (A2C)
 *
 * Implements synchronous A2C algorithm with:
 * - Shared actor-critic network
 * - N-step returns
 * - Entropy regularization
 * - Advantage normalization
 *
 * Performance Target: <10ms per update step
 */
import type { RLConfig, Trajectory } from '../types.js';
/**
 * A2C configuration
 */
export interface A2CConfig extends RLConfig {
    algorithm: 'a2c';
    nSteps: number;
    useGAE: boolean;
    gaeLambda: number;
}
/**
 * Default A2C configuration
 */
export declare const DEFAULT_A2C_CONFIG: A2CConfig;
/**
 * A2C Algorithm Implementation
 */
export declare class A2CAlgorithm {
    private config;
    private sharedWeights;
    private policyHead;
    private valueHead;
    private sharedMomentum;
    private policyMomentum;
    private valueMomentum;
    private buffer;
    private inputDim;
    private hiddenDim;
    private numActions;
    private updateCount;
    private avgPolicyLoss;
    private avgValueLoss;
    private avgEntropy;
    constructor(config?: Partial<A2CConfig>);
    /**
     * Add experience from trajectory
     */
    addExperience(trajectory: Trajectory): void;
    /**
     * Perform A2C update
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
        value: number;
    };
    /**
     * Get statistics
     */
    getStats(): Record<string, number>;
    private evaluate;
    private forward;
    private forwardWithHidden;
    private computeReturns;
    private computeAdvantages;
    private computeGAE;
    private accumulateGradients;
    private applyGradients;
    private softmax;
    private sampleAction;
    private hashAction;
}
/**
 * Factory function
 */
export declare function createA2C(config?: Partial<A2CConfig>): A2CAlgorithm;
//# sourceMappingURL=a2c.d.ts.map