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
// Core Types
// =============================================================================

export type {
  // SONA Mode Types
  SONAMode,
  SONAModeConfig,
  ModeOptimizations,

  // Trajectory Types
  Trajectory,
  TrajectoryStep,
  TrajectoryVerdict,
  DistilledMemory,

  // Pattern Types
  Pattern,
  PatternMatch,
  PatternEvolution,

  // RL Algorithm Types
  RLAlgorithm,
  RLConfig,
  PPOConfig,
  DQNConfig,
  DecisionTransformerConfig,
  CuriosityConfig,

  // LoRA Types
  LoRAConfig,
  LoRAWeights,

  // EWC Types
  EWCConfig,
  EWCState,

  // Statistics
  NeuralStats,

  // Events
  NeuralEvent,
  NeuralEventListener,
} from './types.js';

// =============================================================================
// SONA Manager
// =============================================================================

export {
  SONAManager,
  createSONAManager,
  getModeConfig,
  getModeOptimizations,
} from './sona-manager.js';

// =============================================================================
// Learning Modes
// =============================================================================

export type { ModeImplementation } from './modes/index.js';

export {
  BaseModeImplementation,
  RealTimeMode,
  BalancedMode,
  ResearchMode,
  EdgeMode,
  BatchMode,
} from './modes/index.js';

// =============================================================================
// SONA Integration (@ruvector/sona)
// =============================================================================

export {
  SONALearningEngine,
  createSONALearningEngine,
} from './sona-integration.js';

export type {
  Context,
  AdaptedBehavior,
  SONAStats,
  JsLearnedPattern,
  JsSonaConfig,
} from './sona-integration.js';

// =============================================================================
// ReasoningBank
// =============================================================================

export {
  ReasoningBank,
  createReasoningBank,
  createInitializedReasoningBank,
} from './reasoning-bank.js';

export type {
  ReasoningBankConfig,
  RetrievalResult,
  ConsolidationResult,
} from './reasoning-bank.js';

// =============================================================================
// Pattern Learner
// =============================================================================

export {
  PatternLearner,
  createPatternLearner,
} from './pattern-learner.js';

export type { PatternLearnerConfig } from './pattern-learner.js';

// =============================================================================
// RL Algorithms
// =============================================================================

export {
  // PPO
  PPOAlgorithm,
  createPPO,
  DEFAULT_PPO_CONFIG,

  // DQN
  DQNAlgorithm,
  createDQN,
  DEFAULT_DQN_CONFIG,

  // A2C
  A2CAlgorithm,
  createA2C,
  DEFAULT_A2C_CONFIG,

  // Decision Transformer
  DecisionTransformer,
  createDecisionTransformer,
  DEFAULT_DT_CONFIG,

  // Q-Learning
  QLearning,
  createQLearning,
  DEFAULT_QLEARNING_CONFIG,

  // SARSA
  SARSAAlgorithm,
  createSARSA,
  DEFAULT_SARSA_CONFIG,

  // Curiosity
  CuriosityModule,
  createCuriosity,
  DEFAULT_CURIOSITY_CONFIG,

  // Factory functions
  createAlgorithm,
  getDefaultConfig,
} from './algorithms/index.js';

export type {
  A2CConfig,
  QLearningConfig,
  SARSAConfig,
} from './algorithms/index.js';

// =============================================================================
// Convenience Factory
// =============================================================================

import { SONAManager, createSONAManager } from './sona-manager.js';
import { ReasoningBank, createReasoningBank } from './reasoning-bank.js';
import { PatternLearner, createPatternLearner } from './pattern-learner.js';
import { SONALearningEngine, createSONALearningEngine } from './sona-integration.js';
import type { SONAMode, NeuralEventListener } from './types.js';

/**
 * Neural Learning System - Complete integrated learning module
 */
export class NeuralLearningSystem {
  private sona: SONAManager;
  private reasoningBank: ReasoningBank;
  private patternLearner: PatternLearner;
  private initialized = false;

  constructor(mode: SONAMode = 'balanced') {
    this.sona = createSONAManager(mode);
    this.reasoningBank = createReasoningBank();
    this.patternLearner = createPatternLearner();
  }

  /**
   * Initialize the learning system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.sona.initialize();
    this.initialized = true;
  }

  /**
   * Get SONA manager
   */
  getSONAManager(): SONAManager {
    return this.sona;
  }

  /**
   * Get ReasoningBank
   */
  getReasoningBank(): ReasoningBank {
    return this.reasoningBank;
  }

  /**
   * Get Pattern Learner
   */
  getPatternLearner(): PatternLearner {
    return this.patternLearner;
  }

  /**
   * Change learning mode
   */
  async setMode(mode: SONAMode): Promise<void> {
    await this.sona.setMode(mode);
  }

  /**
   * Begin tracking a task
   */
  beginTask(context: string, domain: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general' = 'general'): string {
    return this.sona.beginTrajectory(context, domain);
  }

  /**
   * Record a step in the current task
   */
  recordStep(
    trajectoryId: string,
    action: string,
    reward: number,
    stateEmbedding: Float32Array
  ): void {
    this.sona.recordStep(trajectoryId, action, reward, stateEmbedding);
  }

  /**
   * Complete a task and trigger learning
   */
  async completeTask(trajectoryId: string, quality?: number): Promise<void> {
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
  async findPatterns(queryEmbedding: Float32Array, k: number = 3): Promise<import('./types.js').PatternMatch[]> {
    return this.patternLearner.findMatches(queryEmbedding, k);
  }

  /**
   * Retrieve relevant memories
   */
  async retrieveMemories(queryEmbedding: Float32Array, k: number = 3): Promise<import('./reasoning-bank.js').RetrievalResult[]> {
    return this.reasoningBank.retrieve(queryEmbedding, k);
  }

  /**
   * Trigger learning cycle
   */
  async triggerLearning(): Promise<void> {
    await this.sona.triggerLearning('manual');
    await this.reasoningBank.consolidate();
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): {
    sona: import('./types.js').NeuralStats;
    reasoningBank: Record<string, number>;
    patternLearner: Record<string, number>;
  } {
    return {
      sona: this.sona.getStats(),
      reasoningBank: this.reasoningBank.getStats(),
      patternLearner: this.patternLearner.getStats(),
    };
  }

  /**
   * Add event listener
   */
  addEventListener(listener: NeuralEventListener): void {
    this.sona.addEventListener(listener);
    this.reasoningBank.addEventListener(listener);
    this.patternLearner.addEventListener(listener);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.sona.cleanup();
    this.initialized = false;
  }
}

/**
 * Create a complete neural learning system
 */
export function createNeuralLearningSystem(mode: SONAMode = 'balanced'): NeuralLearningSystem {
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
