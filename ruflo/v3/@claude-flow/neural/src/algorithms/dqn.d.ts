/**
 * Deep Q-Network (DQN)
 *
 * Implements DQN with enhancements:
 * - Experience replay
 * - Target network
 * - Double DQN (optional)
 * - Dueling architecture (optional)
 * - Epsilon-greedy exploration
 *
 * Performance Target: <10ms per update step
 */
import type { DQNConfig, Trajectory } from '../types.js';
/**
 * Default DQN configuration
 */
export declare const DEFAULT_DQN_CONFIG: DQNConfig;
/**
 * DQN Algorithm Implementation
 */
export declare class DQNAlgorithm {
    private config;
    private qWeights;
    private targetWeights;
    private qMomentum;
    private buffer;
    private bufferIdx;
    private epsilon;
    private stepCount;
    private numActions;
    private inputDim;
    private updateCount;
    private avgLoss;
    constructor(config?: Partial<DQNConfig>);
    /**
     * Add experience from trajectory
     */
    addExperience(trajectory: Trajectory): void;
    /**
     * Perform DQN update
     * Target: <10ms
     */
    update(): {
        loss: number;
        epsilon: number;
    };
    /**
     * Get action using epsilon-greedy
     */
    getAction(state: Float32Array, explore?: boolean): number;
    /**
     * Get Q-values for a state
     */
    getQValues(state: Float32Array): Float32Array;
    /**
     * Get statistics
     */
    getStats(): Record<string, number>;
    private initializeNetwork;
    private copyNetwork;
    private forward;
    private accumulateGradients;
    private applyGradients;
    private sampleBatch;
    private hashAction;
    private argmax;
}
/**
 * Factory function
 */
export declare function createDQN(config?: Partial<DQNConfig>): DQNAlgorithm;
//# sourceMappingURL=dqn.d.ts.map