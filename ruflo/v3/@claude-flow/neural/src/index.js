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
// =============================================================================
// SONA Manager
// =============================================================================
export { SONAManager, createSONAManager, getModeConfig, getModeOptimizations, } from './sona-manager.js';
export { BaseModeImplementation, RealTimeMode, BalancedMode, ResearchMode, EdgeMode, BatchMode, } from './modes/index.js';
// =============================================================================
// SONA Integration (@ruvector/sona)
// =============================================================================
export { SONALearningEngine, createSONALearningEngine, } from './sona-integration.js';
// =============================================================================
// ReasoningBank
// =============================================================================
export { ReasoningBank, createReasoningBank, createInitializedReasoningBank, } from './reasoning-bank.js';
// =============================================================================
// Pattern Learner
// =============================================================================
export { PatternLearner, createPatternLearner, } from './pattern-learner.js';
// =============================================================================
// RL Algorithms
// =============================================================================
export { 
// PPO
PPOAlgorithm, createPPO, DEFAULT_PPO_CONFIG, 
// DQN
DQNAlgorithm, createDQN, DEFAULT_DQN_CONFIG, 
// A2C
A2CAlgorithm, createA2C, DEFAULT_A2C_CONFIG, 
// Decision Transformer
DecisionTransformer, createDecisionTransformer, DEFAULT_DT_CONFIG, 
// Q-Learning
QLearning, createQLearning, DEFAULT_QLEARNING_CONFIG, 
// SARSA
SARSAAlgorithm, createSARSA, DEFAULT_SARSA_CONFIG, 
// Curiosity
CuriosityModule, createCuriosity, DEFAULT_CURIOSITY_CONFIG, 
// Factory functions
createAlgorithm, getDefaultConfig, } from './algorithms/index.js';
// =============================================================================
// Convenience Factory
// =============================================================================
import { SONAManager, createSONAManager } from './sona-manager.js';
import { ReasoningBank, createReasoningBank } from './reasoning-bank.js';
import { PatternLearner, createPatternLearner } from './pattern-learner.js';
import { SONALearningEngine, createSONALearningEngine } from './sona-integration.js';
/**
 * Neural Learning System - Complete integrated learning module
 */
export class NeuralLearningSystem {
    sona;
    reasoningBank;
    patternLearner;
    initialized = false;
    constructor(mode = 'balanced') {
        this.sona = createSONAManager(mode);
        this.reasoningBank = createReasoningBank();
        this.patternLearner = createPatternLearner();
    }
    /**
     * Initialize the learning system
     */
    async initialize() {
        if (this.initialized)
            return;
        await this.sona.initialize();
        this.initialized = true;
    }
    /**
     * Get SONA manager
     */
    getSONAManager() {
        return this.sona;
    }
    /**
     * Get ReasoningBank
     */
    getReasoningBank() {
        return this.reasoningBank;
    }
    /**
     * Get Pattern Learner
     */
    getPatternLearner() {
        return this.patternLearner;
    }
    /**
     * Change learning mode
     */
    async setMode(mode) {
        await this.sona.setMode(mode);
    }
    /**
     * Begin tracking a task
     */
    beginTask(context, domain = 'general') {
        return this.sona.beginTrajectory(context, domain);
    }
    /**
     * Record a step in the current task
     */
    recordStep(trajectoryId, action, reward, stateEmbedding) {
        this.sona.recordStep(trajectoryId, action, reward, stateEmbedding);
    }
    /**
     * Complete a task and trigger learning
     */
    async completeTask(trajectoryId, quality) {
        const trajectory = this.sona.completeTrajectory(trajectoryId, quality);
        if (trajectory) {
            // Store in reasoning bank
            this.reasoningBank.storeTrajectory(trajectory);
            // Judge and potentially distill
            await this.reasoningBank.judge(trajectory);
            const memory = await this.reasoningBank.distill(trajectory);
            // Extract pattern if successful
            if (memory) {
                this.patternLearner.extractPattern(trajectory, memory);
            }
        }
    }
    /**
     * Find similar patterns for a task
     */
    async findPatterns(queryEmbedding, k = 3) {
        return this.patternLearner.findMatches(queryEmbedding, k);
    }
    /**
     * Retrieve relevant memories
     */
    async retrieveMemories(queryEmbedding, k = 3) {
        return this.reasoningBank.retrieve(queryEmbedding, k);
    }
    /**
     * Trigger learning cycle
     */
    async triggerLearning() {
        await this.sona.triggerLearning('manual');
        await this.reasoningBank.consolidate();
    }
    /**
     * Get comprehensive statistics
     */
    getStats() {
        return {
            sona: this.sona.getStats(),
            reasoningBank: this.reasoningBank.getStats(),
            patternLearner: this.patternLearner.getStats(),
        };
    }
    /**
     * Add event listener
     */
    addEventListener(listener) {
        this.sona.addEventListener(listener);
        this.reasoningBank.addEventListener(listener);
        this.patternLearner.addEventListener(listener);
    }
    /**
     * Cleanup resources
     */
    async cleanup() {
        await this.sona.cleanup();
        this.initialized = false;
    }
}
/**
 * Create a complete neural learning system
 */
export function createNeuralLearningSystem(mode = 'balanced') {
    return new NeuralLearningSystem(mode);
}
// =============================================================================
// Default Export
// =============================================================================
export default {
    // Factories
    createSONAManager,
    createReasoningBank,
    createPatternLearner,
    createNeuralLearningSystem,
    createSONALearningEngine,
    // Classes
    SONAManager,
    ReasoningBank,
    PatternLearner,
    NeuralLearningSystem,
    SONALearningEngine,
};
//# sourceMappingURL=index.js.map