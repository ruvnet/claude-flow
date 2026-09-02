/**
 * RL Algorithms Index
 *
 * Exports all reinforcement learning algorithm implementations.
 */
export { PPOAlgorithm, createPPO, DEFAULT_PPO_CONFIG, } from './ppo.js';
export type { PPOConfig } from '../types.js';
export { DQNAlgorithm, createDQN, DEFAULT_DQN_CONFIG, } from './dqn.js';
export type { DQNConfig } from '../types.js';
export { A2CAlgorithm, createA2C, DEFAULT_A2C_CONFIG, } from './a2c.js';
export type { A2CConfig } from './a2c.js';
export { DecisionTransformer, createDecisionTransformer, DEFAULT_DT_CONFIG, } from './decision-transformer.js';
export type { DecisionTransformerConfig } from '../types.js';
export { QLearning, createQLearning, DEFAULT_QLEARNING_CONFIG, } from './q-learning.js';
export type { QLearningConfig } from './q-learning.js';
export { SARSAAlgorithm, createSARSA, DEFAULT_SARSA_CONFIG, } from './sarsa.js';
export type { SARSAConfig } from './sarsa.js';
export { CuriosityModule, createCuriosity, DEFAULT_CURIOSITY_CONFIG, } from './curiosity.js';
export type { CuriosityConfig } from '../types.js';
/**
 * Algorithm factory
 */
import type { RLAlgorithm, RLConfig } from '../types.js';
/**
 * Create an RL algorithm by name
 */
export declare function createAlgorithm(algorithm: RLAlgorithm, config?: Partial<RLConfig>): unknown;
/**
 * Get default configuration for an algorithm
 */
export declare function getDefaultConfig(algorithm: RLAlgorithm): RLConfig;
//# sourceMappingURL=index.d.ts.map