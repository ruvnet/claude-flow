/**
 * RL Algorithms Index
 *
 * Exports all reinforcement learning algorithm implementations.
 */
// PPO - Proximal Policy Optimization
export { PPOAlgorithm, createPPO, DEFAULT_PPO_CONFIG, } from './ppo.js';
// DQN - Deep Q-Network
export { DQNAlgorithm, createDQN, DEFAULT_DQN_CONFIG, } from './dqn.js';
// A2C - Advantage Actor-Critic
export { A2CAlgorithm, createA2C, DEFAULT_A2C_CONFIG, } from './a2c.js';
// Decision Transformer
export { DecisionTransformer, createDecisionTransformer, DEFAULT_DT_CONFIG, } from './decision-transformer.js';
// Q-Learning (Tabular)
export { QLearning, createQLearning, DEFAULT_QLEARNING_CONFIG, } from './q-learning.js';
// SARSA
export { SARSAAlgorithm, createSARSA, DEFAULT_SARSA_CONFIG, } from './sarsa.js';
// Curiosity-Driven Exploration
export { CuriosityModule, createCuriosity, DEFAULT_CURIOSITY_CONFIG, } from './curiosity.js';
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
export function createAlgorithm(algorithm, config) {
    // Use type assertions since config is validated by algorithm switch
    switch (algorithm) {
        case 'ppo':
            return createPPO(config);
        case 'dqn':
            return createDQN(config);
        case 'a2c':
            return createA2C(config);
        case 'decision-transformer':
            return createDecisionTransformer(config);
        case 'q-learning':
            return createQLearning(config);
        case 'sarsa':
            return createSARSA(config);
        case 'curiosity':
            return createCuriosity(config);
        default:
            throw new Error(`Unknown algorithm: ${algorithm}`);
    }
}
/**
 * Get default configuration for an algorithm
 */
export function getDefaultConfig(algorithm) {
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
//# sourceMappingURL=index.js.map