/**
 * SARSA (State-Action-Reward-State-Action)
 *
 * On-policy TD learning algorithm with:
 * - Epsilon-greedy exploration
 * - State hashing for continuous states
 * - Expected SARSA variant (optional)
 * - Eligibility traces (SARSA-lambda)
 *
 * Performance Target: <1ms per update
 */
import type { Trajectory, RLConfig } from '../types.js';
/**
 * SARSA configuration
 */
export interface SARSAConfig extends RLConfig {
    algorithm: 'sarsa';
    explorationInitial: number;
    explorationFinal: number;
    explorationDecay: number;
    maxStates: number;
    useExpectedSARSA: boolean;
    useEligibilityTraces: boolean;
    traceDecay: number;
}
/**
 * Default SARSA configuration
 */
export declare const DEFAULT_SARSA_CONFIG: SARSAConfig;
/**
 * SARSA Algorithm Implementation
 */
export declare class SARSAAlgorithm {
    private config;
    private qTable;
    private epsilon;
    private stepCount;
    private numActions;
    private traces;
    private updateCount;
    private avgTDError;
    constructor(config?: Partial<SARSAConfig>);
    /**
     * Update Q-values from trajectory using SARSA
     */
    update(trajectory: Trajectory): {
        tdError: number;
    };
    /**
     * Get action using epsilon-greedy policy
     */
    getAction(state: Float32Array, explore?: boolean): number;
    /**
     * Get action probabilities for a state
     */
    getActionProbabilities(state: Float32Array): Float32Array;
    /**
     * Get Q-values for a state
     */
    getQValues(state: Float32Array): Float32Array;
    /**
     * Get statistics
     */
    getStats(): Record<string, number>;
    /**
     * Reset algorithm state
     */
    reset(): void;
    private hashState;
    private hashAction;
    private getOrCreateEntry;
    private expectedValue;
    private updateTrace;
    private updateWithTraces;
    private pruneQTable;
    private argmax;
}
/**
 * Factory function
 */
export declare function createSARSA(config?: Partial<SARSAConfig>): SARSAAlgorithm;
//# sourceMappingURL=sarsa.d.ts.map