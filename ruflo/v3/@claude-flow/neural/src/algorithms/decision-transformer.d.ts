/**
 * Decision Transformer
 *
 * Implements sequence modeling approach for RL:
 * - Trajectory as sequence: (s, a, R, s, a, R, ...)
 * - Return-conditioned generation
 * - Causal transformer attention
 * - Offline RL from trajectories
 *
 * Performance Target: <10ms per forward pass
 */
import type { DecisionTransformerConfig, Trajectory } from '../types.js';
/**
 * Default Decision Transformer configuration
 */
export declare const DEFAULT_DT_CONFIG: DecisionTransformerConfig;
/**
 * Sequence entry for transformer
 */
interface SequenceEntry {
    returnToGo: number;
    state: Float32Array;
    action: number;
    timestep: number;
}
/**
 * Decision Transformer Implementation
 */
export declare class DecisionTransformer {
    private config;
    private stateEmbed;
    private actionEmbed;
    private returnEmbed;
    private posEmbed;
    private attentionWeights;
    private ffnWeights;
    private actionHead;
    private trajectoryBuffer;
    private stateDim;
    private numActions;
    private updateCount;
    private avgLoss;
    constructor(config?: Partial<DecisionTransformerConfig>);
    /**
     * Add trajectory for training
     */
    addTrajectory(trajectory: Trajectory): void;
    /**
     * Train on buffered trajectories
     * Target: <10ms per batch
     */
    train(): {
        loss: number;
        accuracy: number;
    };
    /**
     * Get action conditioned on target return
     */
    getAction(states: Float32Array[], actions: number[], targetReturn: number): number;
    /**
     * Forward pass through transformer
     */
    forward(sequence: SequenceEntry[]): Float32Array;
    /**
     * Get statistics
     */
    getStats(): Record<string, number>;
    private initEmbedding;
    private initWeight;
    private createSequence;
    private transformerLayer;
    private updateWeights;
    private softmax;
    private argmax;
    private hashAction;
}
/**
 * Factory function
 */
export declare function createDecisionTransformer(config?: Partial<DecisionTransformerConfig>): DecisionTransformer;
export {};
//# sourceMappingURL=decision-transformer.d.ts.map