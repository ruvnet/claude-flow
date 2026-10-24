/**
 * Tabular Q-Learning
 *
 * Classic Q-learning algorithm with:
 * - Epsilon-greedy exploration
 * - State hashing for continuous states
 * - Eligibility traces (optional)
 * - Experience replay
 *
 * Suitable for smaller state spaces or discretized environments.
 * Performance Target: <1ms per update
 */
import type { Trajectory, RLConfig } from '../types.js';
/**
 * Q-Learning configuration
 */
export interface QLearningConfig extends RLConfig {
    algorithm: 'q-learning';
    explorationInitial: number;
    explorationFinal: number;
    explorationDecay: number;
    maxStates: number;
    useEligibilityTraces: boolean;
    traceDecay: number;
}
/**
 * Default Q-Learning configuration
 */
export declare const DEFAULT_QLEARNING_CONFIG: QLearningConfig;
/**
 * Q-Learning Algorithm Implementation
 */
export declare class QLearning {
    private config;
    private qTable;
    private epsilon;
    private stepCount;
    private numActions;
    private traces;
    private updateCount;
    private avgTDError;
    constructor(config?: Partial<QLearningConfig>);
    /**
     * Update Q-values from trajectory
     */
    update(trajectory: Trajectory): {
        tdError: number;
    };
    /**
     * Get action using epsilon-greedy policy
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
    /**
     * Reset Q-table
     */
    reset(): void;
    private hashState;
    private hashAction;
    private getOrCreateEntry;
    private updateTrace;
    private updateWithTraces;
    private pruneQTable;
    private argmax;
}
/**
 * Factory function
 */
export declare function createQLearning(config?: Partial<QLearningConfig>): QLearning;
//# sourceMappingURL=q-learning.d.ts.map