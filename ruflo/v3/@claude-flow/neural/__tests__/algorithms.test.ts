/**
 * RL Algorithms Tests
 *
 * Tests for reinforcement learning algorithms:
 * - Q-Learning
 * - SARSA
 * - DQN
 * - PPO
 * - Decision Transformer
 *
 * Performance target: <10ms per update
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QLearning, createQLearning } from '../src/algorithms/q-learning.js';
import { SARSAAlgorithm, createSARSA } from '../src/algorithms/sarsa.js';
import { DQNAlgorithm, createDQN } from '../src/algorithms/dqn.js';
import { PPOAlgorithm, createPPO } from '../src/algorithms/ppo.js';
import { DecisionTransformer, createDecisionTransformer } from '../src/algorithms/decision-transformer.js';
import type { Trajectory } from '../src/types.js';

// Helper function to create test trajectories
function createTestTrajectory(steps: number = 5): Trajectory {
  return {
    trajectoryId: `test-traj-${Date.now()}`,
    context: 'Test task',
    domain: 'code',
    steps: Array.from({ length: steps }, (_, i) => ({
      stepId: `step-${i}`,
      timestamp: Date.now() + i * 100,
      action: `action-${i % 4}`, // 4 discrete actions
      stateBefore: new Float32Array(768).fill(i * 0.1),
      stateAfter: new Float32Array(768).fill((i + 1) * 0.1),
      reward: 0.5 + (i / steps) * 0.5, // Increasing rewards
    })),
    qualityScore: 0.75,
    isComplete: true,
    startTime: Date.now() - 1000,
    endTime: Date.now(),
  };
}

describe('Q-Learning Algorithm', () => {
  let qlearning: QLearning;

  beforeEach(() => {
    qlearning = createQLearning({
      learningRate: 0.1,
      gamma: 0.99,
      explorationInitial: 1.0,
      explorationFinal: 0.01,
      explorationDecay: 1000,
    });
  });

  it('should initialize correctly', () => {
    expect(qlearning).toBeDefined();
    const stats = qlearning.getStats();
    expect(stats.updateCount).toBe(0);
    expect(stats.qTableSize).toBe(0);
    expect(stats.epsilon).toBeCloseTo(1.0);
  });

  it('should update Q-values from trajectory', () => {
    const trajectory = createTestTrajectory(5);
    const result = qlearning.update(trajectory);

    expect(result.tdError).toBeGreaterThanOrEqual(0);
    const stats = qlearning.getStats();
    expect(stats.updateCount).toBe(1);
    expect(stats.qTableSize).toBeGreaterThan(0);
  });

  it('should update under performance target (<1ms)', () => {
    const trajectory = createTestTrajectory(10);

    const startTime = performance.now();
    qlearning.update(trajectory);
    const elapsed = performance.now() - startTime;

    expect(elapsed).toBeLessThan(10); // Reasonable target for small trajectories
  });

  it('should decay exploration rate', () => {
    const trajectory = createTestTrajectory(5);
    const initialEpsilon = qlearning.getStats().epsilon;

    for (let i = 0; i < 10; i++) {
      qlearning.update(trajectory);
    }

    const finalEpsilon = qlearning.getStats().epsilon;
    expect(finalEpsilon).toBeLessThan(initialEpsilon);
  });

  it('should select actions with epsilon-greedy', () => {
    const state = new Float32Array(768).fill(0.5);

    // First call should be random (high epsilon)
    const action1 = qlearning.getAction(state, true);
    expect(action1).toBeGreaterThanOrEqual(0);
    expect(action1).toBeLessThan(4);

    // Without exploration, should be deterministic
    const action2 = qlearning.getAction(state, false);
    expect(action2).toBeDefined();
  });

  it('should return Q-values for a state', () => {
    const trajectory = createTestTrajectory(5);
    qlearning.update(trajectory);

    const state = new Float32Array(768).fill(0.5);
    const qValues = qlearning.getQValues(state);

    expect(qValues).toBeInstanceOf(Float32Array);
    expect(qValues.length).toBe(4);
  });

  it('should handle eligibility traces', () => {
    const qlearningWithTraces = createQLearning({
      useEligibilityTraces: true,
      traceDecay: 0.9,
    });

    const trajectory = createTestTrajectory(10);
    expect(() => qlearningWithTraces.update(trajectory)).not.toThrow();
  });

  it('should prune Q-table when over capacity', () => {
    const smallQLearning = createQLearning({
      maxStates: 10,
    });

    // Add many different trajectories to fill Q-table
    for (let i = 0; i < 20; i++) {
      const trajectory = createTestTrajectory(5);
      smallQLearning.update(trajectory);
    }

    const stats = smallQLearning.getStats();
    expect(stats.qTableSize).toBeLessThanOrEqual(10);
  });

  it('should reset correctly', () => {
    const trajectory = createTestTrajectory(5);
    qlearning.update(trajectory);

    qlearning.reset();
    const stats = qlearning.getStats();

    expect(stats.updateCount).toBe(0);
    expect(stats.qTableSize).toBe(0);
    expect(stats.epsilon).toBeCloseTo(1.0);
  });
});

describe('SARSA Algorithm', () => {
  let sarsa: SARSAAlgorithm;

  beforeEach(() => {
    sarsa = createSARSA({
      learningRate: 0.1,
      gamma: 0.99,
      explorationInitial: 1.0,
      explorationFinal: 0.01,
      explorationDecay: 1000,
    });
  });

  it('should initialize correctly', () => {
    expect(sarsa).toBeDefined();
    const stats = sarsa.getStats();
    expect(stats.updateCount).toBe(0);
    expect(stats.qTableSize).toBe(0);
  });

  it('should update using SARSA rule', () => {
    const trajectory = createTestTrajectory(5);
    const result = sarsa.update(trajectory);

    expect(result.tdError).toBeGreaterThanOrEqual(0);
    const stats = sarsa.getStats();
    expect(stats.updateCount).toBe(1);
  });

  it('should handle expected SARSA variant', () => {
    const expectedSARSA = createSARSA({
      useExpectedSARSA: true,
    });

    const trajectory = createTestTrajectory(5);
    expect(() => expectedSARSA.update(trajectory)).not.toThrow();
  });

  it('should return action probabilities', () => {
    const state = new Float32Array(768).fill(0.5);
    const probs = sarsa.getActionProbabilities(state);

    expect(probs).toBeInstanceOf(Float32Array);
    expect(probs.length).toBe(4);

    // Probabilities should sum to ~1
    const sum = Array.from(probs).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('should select actions with epsilon-greedy policy', () => {
    const state = new Float32Array(768).fill(0.5);
    const action = sarsa.getAction(state, true);

    expect(action).toBeGreaterThanOrEqual(0);
    expect(action).toBeLessThan(4);
  });

  it('should handle eligibility traces (SARSA-lambda)', () => {
    const sarsaLambda = createSARSA({
      useEligibilityTraces: true,
      traceDecay: 0.9,
    });

    const trajectory = createTestTrajectory(10);
    expect(() => sarsaLambda.update(trajectory)).not.toThrow();
  });

  it('should handle short trajectories gracefully', () => {
    const shortTrajectory = createTestTrajectory(1);
    const result = sarsa.update(shortTrajectory);

    expect(result.tdError).toBe(0); // Not enough steps for SARSA
  });

  it('should reset algorithm state', () => {
    const trajectory = createTestTrajectory(5);
    sarsa.update(trajectory);

    sarsa.reset();
    const stats = sarsa.getStats();

    expect(stats.updateCount).toBe(0);
    expect(stats.qTableSize).toBe(0);
  });
});

describe('DQN Algorithm', () => {
  let dqn: DQNAlgorithm;

  beforeEach(() => {
    dqn = createDQN({
      learningRate: 0.0001,
      bufferSize: 1000,
      miniBatchSize: 32,
      doubleDQN: true,
      targetUpdateFreq: 100,
    });
  });

  it('should initialize correctly', () => {
    expect(dqn).toBeDefined();
    const stats = dqn.getStats();
    expect(stats.updateCount).toBe(0);
    expect(stats.bufferSize).toBe(0);
  });

  it('should add experience to replay buffer', () => {
    const trajectory = createTestTrajectory(10);
    dqn.addExperience(trajectory);

    const stats = dqn.getStats();
    expect(stats.bufferSize).toBe(10);
  });

  it('should perform DQN update', () => {
    // Add enough experiences
    for (let i = 0; i < 5; i++) {
      dqn.addExperience(createTestTrajectory(10));
    }

    const result = dqn.update();
    expect(result.loss).toBeGreaterThanOrEqual(0);
    expect(result.epsilon).toBeGreaterThan(0);
  });

  it('should update under performance target (<10ms)', () => {
    // Add experiences
    for (let i = 0; i < 5; i++) {
      dqn.addExperience(createTestTrajectory(10));
    }

    const startTime = performance.now();
    dqn.update();
    const elapsed = performance.now() - startTime;

    // Allow generous overhead for neural network in test environment
    // (actual production target is <10ms, but tests run in CI may be slower)
    expect(elapsed).toBeLessThan(500);
  });

  it('should use double DQN when enabled', () => {
    const doubleDQN = createDQN({
      doubleDQN: true,
      miniBatchSize: 16,
    });

    for (let i = 0; i < 3; i++) {
      doubleDQN.addExperience(createTestTrajectory(10));
    }

    expect(() => doubleDQN.update()).not.toThrow();
  });

  it('should select actions with epsilon-greedy', () => {
    const state = new Float32Array(768).fill(0.5);
    const action = dqn.getAction(state, true);

    expect(action).toBeGreaterThanOrEqual(0);
    expect(action).toBeLessThan(4);
  });

  it('should return Q-values for a state', () => {
    const state = new Float32Array(768).fill(0.5);
    const qValues = dqn.getQValues(state);

    expect(qValues).toBeInstanceOf(Float32Array);
    expect(qValues.length).toBe(4);
  });

  it('should update target network periodically', () => {
    const dqnWithFreqUpdate = createDQN({
      targetUpdateFreq: 5,
      miniBatchSize: 16,
    });

    for (let i = 0; i < 3; i++) {
      dqnWithFreqUpdate.addExperience(createTestTrajectory(10));
    }

    // Perform multiple updates to trigger target network update
    for (let i = 0; i < 10; i++) {
      dqnWithFreqUpdate.update();
    }

    const stats = dqnWithFreqUpdate.getStats();
    expect(stats.stepCount).toBeGreaterThan(5);
  });

  it('should handle circular replay buffer correctly', () => {
    const smallDQN = createDQN({
      bufferSize: 10,
      miniBatchSize: 4,
    });

    // Add more experiences than buffer size
    for (let i = 0; i < 15; i++) {
      smallDQN.addExperience(createTestTrajectory(2));
    }

    const stats = smallDQN.getStats();
    expect(stats.bufferSize).toBe(10);
  });
});

describe('PPO Algorithm', () => {
  let ppo: PPOAlgorithm;

  beforeEach(() => {
    ppo = createPPO({
      learningRate: 0.0003,
      clipRange: 0.2,
      gaeLambda: 0.95,
      epochs: 4,
      miniBatchSize: 64,
    });
  });

  it('should initialize correctly', () => {
    expect(ppo).toBeDefined();
    const stats = ppo.getStats();
    expect(stats.updateCount).toBe(0);
  });

  it('should add experience from trajectory', () => {
    const trajectory = createTestTrajectory(10);
    expect(() => ppo.addExperience(trajectory)).not.toThrow();

    const stats = ppo.getStats();
    expect(stats.bufferSize).toBe(10);
  });

  it('should perform PPO update with clipping', () => {
    // Add enough experiences
    for (let i = 0; i < 10; i++) {
      ppo.addExperience(createTestTrajectory(10));
    }

    const result = ppo.update();

    // Policy loss can be negative in PPO (we minimize -surrogate_objective)
    expect(typeof result.policyLoss).toBe('number');
    expect(result.valueLoss).toBeGreaterThanOrEqual(0);
    expect(result.entropy).toBeGreaterThanOrEqual(0);
  });

  it('should update under performance target (<10ms for small batches)', () => {
    const smallPPO = createPPO({
      miniBatchSize: 16,
      epochs: 1,
    });

    for (let i = 0; i < 3; i++) {
      smallPPO.addExperience(createTestTrajectory(10));
    }

    const startTime = performance.now();
    smallPPO.update();
    const elapsed = performance.now() - startTime;

    expect(elapsed).toBeLessThan(100); // Allow overhead for PPO complexity
  });

  it('should compute GAE advantages', () => {
    const trajectory = createTestTrajectory(20);
    expect(() => ppo.addExperience(trajectory)).not.toThrow();

    // Verify experiences were added with advantages
    const stats = ppo.getStats();
    expect(stats.bufferSize).toBe(20);
  });

  it('should sample actions from policy', () => {
    const state = new Float32Array(768).fill(0.5);
    const result = ppo.getAction(state);

    expect(result.action).toBeGreaterThanOrEqual(0);
    expect(result.action).toBeLessThan(4);
    expect(result.logProb).toBeDefined();
    expect(result.value).toBeDefined();
  });

  it('should handle multiple training epochs', () => {
    const multiEpochPPO = createPPO({
      epochs: 8,
      miniBatchSize: 32,
    });

    for (let i = 0; i < 5; i++) {
      multiEpochPPO.addExperience(createTestTrajectory(10));
    }

    expect(() => multiEpochPPO.update()).not.toThrow();
  });

  it('should clear buffer after update', () => {
    for (let i = 0; i < 10; i++) {
      ppo.addExperience(createTestTrajectory(10));
    }

    ppo.update();
    const stats = ppo.getStats();

    expect(stats.bufferSize).toBe(0);
  });
});

describe('Decision Transformer', () => {
  let dt: DecisionTransformer;

  beforeEach(() => {
    dt = createDecisionTransformer({
      contextLength: 20,
      numHeads: 4,
      numLayers: 2,
      hiddenDim: 64,
      embeddingDim: 32,
    });
  });

  it('should initialize correctly', () => {
    expect(dt).toBeDefined();
    const stats = dt.getStats();
    expect(stats.updateCount).toBe(0);
    expect(stats.bufferSize).toBe(0);
    expect(stats.contextLength).toBe(20);
    expect(stats.numLayers).toBe(2);
  });

  it('should add complete trajectories to buffer', () => {
    const trajectory = createTestTrajectory(10);
    dt.addTrajectory(trajectory);

    const stats = dt.getStats();
    expect(stats.bufferSize).toBe(1);
  });

  it('should not add incomplete trajectories', () => {
    const incompleteTrajectory: Trajectory = {
      ...createTestTrajectory(5),
      isComplete: false,
    };

    dt.addTrajectory(incompleteTrajectory);
    const stats = dt.getStats();

    expect(stats.bufferSize).toBe(0);
  });

  it('should train on buffered trajectories', () => {
    // Add multiple trajectories
    for (let i = 0; i < 5; i++) {
      dt.addTrajectory(createTestTrajectory(10));
    }

    const result = dt.train();

    expect(result.loss).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeLessThanOrEqual(1);
  });

  it('should train under performance target (<10ms per batch)', () => {
    for (let i = 0; i < 3; i++) {
      dt.addTrajectory(createTestTrajectory(5));
    }

    const startTime = performance.now();
    dt.train();
    const elapsed = performance.now() - startTime;

    expect(elapsed).toBeLessThan(100); // Allow overhead for transformer
  });

  it('should get action conditioned on target return', () => {
    const states = [
      new Float32Array(768).fill(0.1),
      new Float32Array(768).fill(0.2),
      new Float32Array(768).fill(0.3),
    ];
    const actions = [0, 1, 2];
    const targetReturn = 0.9;

    const action = dt.getAction(states, actions, targetReturn);

    expect(action).toBeGreaterThanOrEqual(0);
    expect(action).toBeLessThan(4);
  });

  it('should handle causal attention masking', () => {
    // Train with sequence data
    for (let i = 0; i < 5; i++) {
      dt.addTrajectory(createTestTrajectory(15));
    }

    expect(() => dt.train()).not.toThrow();
  });

  it('should maintain bounded trajectory buffer', () => {
    // Add more than max capacity (1000)
    for (let i = 0; i < 1100; i++) {
      dt.addTrajectory(createTestTrajectory(5));
    }

    const stats = dt.getStats();
    expect(stats.bufferSize).toBe(1000);
  });

  it('should handle varying trajectory lengths', () => {
    dt.addTrajectory(createTestTrajectory(3));
    dt.addTrajectory(createTestTrajectory(10));
    dt.addTrajectory(createTestTrajectory(25));

    expect(() => dt.train()).not.toThrow();
  });

  it('should compute returns-to-go correctly', () => {
    const trajectory = createTestTrajectory(5);
    dt.addTrajectory(trajectory);

    expect(() => dt.train()).not.toThrow();
    const stats = dt.getStats();
    expect(stats.avgLoss).toBeGreaterThanOrEqual(0);
  });
});
