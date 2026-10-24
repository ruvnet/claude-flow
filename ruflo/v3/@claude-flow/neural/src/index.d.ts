/**
 * V3 Neural/Learning System
 *
 * Complete neural learning module with SONA learning modes,
 * ReasoningBank integration, pattern learning, and RL algorithms.
 *
 * Performance Targets:
 * - SONA adaptation: <0.05ms
 * - Pattern matching: <1ms
 * - Learning step: <10ms
 *
 * @module @claude-flow/neural
 */
export type { SONAMode, SONAModeConfig, ModeOptimizations, Trajectory, TrajectoryStep, TrajectoryVerdict, DistilledMemory, Pattern, PatternMatch, PatternEvolution, RLAlgorithm, RLConfig, PPOConfig, DQNConfig, DecisionTransformerConfig, CuriosityConfig, LoRAConfig, LoRAWeights, EWCConfig, EWCState, NeuralStats, NeuralEvent, NeuralEventListener, } from './types.js';
export { SONAManager, createSONAManager, getModeConfig, getModeOptimizations, } from './sona-manager.js';
export type { ModeImplementation } from './modes/index.js';
export { BaseModeImplementation, RealTimeMode, BalancedMode, ResearchMode, EdgeMode, BatchMode, } from './modes/index.js';
export { SONALearningEngine, createSONALearningEngine, } from './sona-integration.js';
export type { Context, AdaptedBehavior, SONAStats, JsLearnedPattern, JsSonaConfig, } from './sona-integration.js';
export { ReasoningBank, createReasoningBank, createInitializedReasoningBank, } from './reasoning-bank.js';
export type { ReasoningBankConfig, RetrievalResult, ConsolidationResult, } from './reasoning-bank.js';
export { PatternLearner, createPatternLearner, } from './pattern-learner.js';
export type { PatternLearnerConfig } from './pattern-learner.js';
export { PPOAlgorithm, createPPO, DEFAULT_PPO_CONFIG, DQNAlgorithm, createDQN, DEFAULT_DQN_CONFIG, A2CAlgorithm, createA2C, DEFAULT_A2C_CONFIG, DecisionTransformer, createDecisionTransformer, DEFAULT_DT_CONFIG, QLearning, createQLearning, DEFAULT_QLEARNING_CONFIG, SARSAAlgorithm, createSARSA, DEFAULT_SARSA_CONFIG, CuriosityModule, createCuriosity, DEFAULT_CURIOSITY_CONFIG, createAlgorithm, getDefaultConfig, } from './algorithms/index.js';
export type { A2CConfig, QLearningConfig, SARSAConfig, } from './algorithms/index.js';
import { SONAManager, createSONAManager } from './sona-manager.js';
import { ReasoningBank, createReasoningBank } from './reasoning-bank.js';
import { PatternLearner, createPatternLearner } from './pattern-learner.js';
import { SONALearningEngine, createSONALearningEngine } from './sona-integration.js';
import type { SONAMode, NeuralEventListener } from './types.js';
/**
 * Neural Learning System - Complete integrated learning module
 */
export declare class NeuralLearningSystem {
    private sona;
    private reasoningBank;
    private patternLearner;
    private initialized;
    constructor(mode?: SONAMode);
    /**
     * Initialize the learning system
     */
    initialize(): Promise<void>;
    /**
     * Get SONA manager
     */
    getSONAManager(): SONAManager;
    /**
     * Get ReasoningBank
     */
    getReasoningBank(): ReasoningBank;
    /**
     * Get Pattern Learner
     */
    getPatternLearner(): PatternLearner;
    /**
     * Change learning mode
     */
    setMode(mode: SONAMode): Promise<void>;
    /**
     * Begin tracking a task
     */
    beginTask(context: string, domain?: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general'): string;
    /**
     * Record a step in the current task
     */
    recordStep(trajectoryId: string, action: string, reward: number, stateEmbedding: Float32Array): void;
    /**
     * Complete a task and trigger learning
     */
    completeTask(trajectoryId: string, quality?: number): Promise<void>;
    /**
     * Find similar patterns for a task
     */
    findPatterns(queryEmbedding: Float32Array, k?: number): Promise<import('./types.js').PatternMatch[]>;
    /**
     * Retrieve relevant memories
     */
    retrieveMemories(queryEmbedding: Float32Array, k?: number): Promise<import('./reasoning-bank.js').RetrievalResult[]>;
    /**
     * Trigger learning cycle
     */
    triggerLearning(): Promise<void>;
    /**
     * Get comprehensive statistics
     */
    getStats(): {
        sona: import('./types.js').NeuralStats;
        reasoningBank: Record<string, number>;
        patternLearner: Record<string, number>;
    };
    /**
     * Add event listener
     */
    addEventListener(listener: NeuralEventListener): void;
    /**
     * Cleanup resources
     */
    cleanup(): Promise<void>;
}
/**
 * Create a complete neural learning system
 */
export declare function createNeuralLearningSystem(mode?: SONAMode): NeuralLearningSystem;
declare const _default: {
    createSONAManager: typeof createSONAManager;
    createReasoningBank: typeof createReasoningBank;
    createPatternLearner: typeof createPatternLearner;
    createNeuralLearningSystem: typeof createNeuralLearningSystem;
    createSONALearningEngine: typeof createSONALearningEngine;
    SONAManager: typeof SONAManager;
    ReasoningBank: typeof ReasoningBank;
    PatternLearner: typeof PatternLearner;
    NeuralLearningSystem: typeof NeuralLearningSystem;
    SONALearningEngine: typeof SONALearningEngine;
};
export default _default;
//# sourceMappingURL=index.d.ts.map