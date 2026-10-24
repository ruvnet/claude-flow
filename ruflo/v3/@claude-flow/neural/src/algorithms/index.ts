/**
 * RL Algorithms Index
 *
 * Exports all reinforcement learning algorithm implementations.
 */

// PPO - Proximal Policy Optimization
export {
  PPOAlgorithm,
  createPPO,
  DEFAULT_PPO_CONFIG,
} from './ppo.js';
export type { PPOConfig } from '../types.js';

// DQN - Deep Q-Network
export {
  DQNAlgorithm,
  createDQN,
  DEFAULT_DQN_CONFIG,
} from './dqn.js';
export type { DQNConfig } from '../types.js';

// A2C - Advantage Actor-Critic
export {
  A2CAlgorithm,
  createA2C,
  DEFAULT_A2C_CONFIG,
} from './a2c.js';
export type { A2CConfig } from './a2c.js';

// Decision Transformer
export {
  DecisionTransformer,
  createDecisionTransformer,
  DEFAULT_DT_CONFIG,
} from './decision-transformer.js';
export type { DecisionTransformerConfig } from '../types.js';

// Q-Learning (Tabular)
export {
  QLearning,
  createQLearning,
  DEFAULT_QLEARNING_CONFIG,
} from './q-learning.js';
export type { QLearningConfig } from './q-learning.js';

// SARSA
export {
  SARSAAlgorithm,
  createSARSA,
  DEFAULT_SARSA_CONFIG,
} from './sarsa.js';
export type { SARSAConfig } from './sarsa.js';

// Curiosity-Driven Exploration
export {
  CuriosityModule,
  createCuriosity,
  DEFAULT_CURIOSITY_CONFIG,
} from './curiosity.js';
export type { CuriosityConfig } from '../types.js';

/**
 * Algorithm factory
 */
import type { RLAlgorithm, RLConfig } from '../types.js';
import { createPPO, DEFAULT_PPO_CONFIG } from './ppo.js';
import { createDQN, DEFAULT_DQN_CONFIG } from './dqn.js';
import { createA2C, DEFAULT_A2C_CONFIG } from './a2c.js';
import { createDecisionTransformer, DEFAULT_DT_CONFIG } from './decision-transformer.js';
import { createQLearning, DEFAULT_QLEARNING_CONFIG } from './q-learning.js';
import { createSARSA, DEFAULT_SARSA_CONFIG } from './sarsa.js';
import { createCuriosity, DEFAULT_CURIOSITY_CONFIG } from './curiosity.js';

/**
 * Create an RL algorithm by name
 */
export function createAlgorithm(algorithm: RLAlgorithm, config?: Partial<RLConfig>): unknown {
  // Use type assertions since config is validated by algorithm switch
  switch (algorithm) {
    case 'ppo':
      return createPPO(config as Parameters<typeof createPPO>[0]);
    case 'dqn':
      return createDQN(config as Parameters<typeof createDQN>[0]);
    case 'a2c':
      return createA2C(config as Parameters<typeof createA2C>[0]);
    case 'decision-transformer':
      return createDecisionTransformer(config as Parameters<typeof createDecisionTransformer>[0]);
    case 'q-learning':
      return createQLearning(config as Parameters<typeof createQLearning>[0]);
    case 'sarsa':
      return createSARSA(config as Parameters<typeof createSARSA>[0]);
    case 'curiosity':
      return createCuriosity(config as Parameters<typeof createCuriosity>[0]);
    default:
      throw new Error(`Unknown algorithm: ${algorithm}`);
  }
}

/**
 * Get default configuration for an algorithm
 */
export function getDefaultConfig(algorithm: RLAlgorithm): RLConfig {
  switch (algorithm) {
    case 'ppo':
      return { ...DEFAULT_PPO_CONFIG };
    case 'dqn':
      return { ...DEFAULT_DQN_CONFIG };
    case 'a2c':
      return { ...DEFAULT_A2C_CONFIG };
    case 'decision-transformer':
      return { ...DEFAULT_DT_CONFIG };
    case 'q-learning':
      return { ...DEFAULT_QLEARNING_CONFIG };
    case 'sarsa':
      return { ...DEFAULT_SARSA_CONFIG };
    case 'curiosity':
      return { ...DEFAULT_CURIOSITY_CONFIG };
    default:
      throw new Error(`Unknown algorithm: ${algorithm}`);
  }
}
