/**
 * Deep Q-Network (DQN)
 *
 * Implements DQN with enhancements:
 * - Experience replay
 * - Target network
 * - Double DQN (optional)
 * - Dueling architecture (optional)
 * - Epsilon-greedy exploration
 *
 * Performance Target: <10ms per update step
 */

import type {
  DQNConfig,
  Trajectory,
  TrajectoryStep,
} from '../types.js';

/**
 * Default DQN configuration
 */
export const DEFAULT_DQN_CONFIG: DQNConfig = {
  algorithm: 'dqn',
  learningRate: 0.0001,
  gamma: 0.99,
  entropyCoef: 0,
  valueLossCoef: 1,
  maxGradNorm: 10,
  epochs: 1,
  miniBatchSize: 32,
  bufferSize: 10000,
  explorationInitial: 1.0,
  explorationFinal: 0.01,
  explorationDecay: 10000,
  targetUpdateFreq: 100,
  doubleDQN: true,
  duelingNetwork: false,
};

/**
 * Experience for replay buffer
 */
interface DQNExperience {
  state: Float32Array;
  action: number;
  reward: number;
  nextState: Float32Array;
  done: boolean;
}

/**
 * DQN Algorithm Implementation
 */
export class DQNAlgorithm {
  private config: DQNConfig;

  // Q-network weights
  private qWeights: Float32Array[];
  private targetWeights: Float32Array[];

  // Optimizer state
  private qMomentum: Float32Array[];

  // Replay buffer (circular)
  private buffer: DQNExperience[] = [];
  private bufferIdx = 0;

  // Exploration
  private epsilon: number;
  private stepCount = 0;

  // Number of actions
  private numActions = 4;
  private inputDim = 768;

  // Statistics
  private updateCount = 0;
  private avgLoss = 0;

  constructor(config: Partial<DQNConfig> = {}) {
    this.config = { ...DEFAULT_DQN_CONFIG, ...config };
    this.epsilon = this.config.explorationInitial;

    // Initialize Q-network (2 hidden layers)
    this.qWeights = this.initializeNetwork();
    this.targetWeights = this.copyNetwork(this.qWeights);
    this.qMomentum = this.qWeights.map(w => new Float32Array(w.length));
  }

  /**
   * Add experience from trajectory
   */
  addExperience(trajectory: Trajectory): void {
    for (let i = 0; i < trajectory.steps.length; i++) {
      const step = trajectory.steps[i];
      const nextStep = i < trajectory.steps.length - 1
        ? trajectory.steps[i + 1]
        : null;

      const experience: DQNExperience = {
        state: step.stateBefore,
        action: this.hashAction(step.action),
        reward: step.reward,
        nextState: step.stateAfter,
        done: nextStep === null,
      };

      // Add to circular buffer
      if (this.buffer.length < this.config.bufferSize) {
        this.buffer.push(experience);
      } else {
        this.buffer[this.bufferIdx] = experience;
      }
      this.bufferIdx = (this.bufferIdx + 1) % this.config.bufferSize;
    }
  }

  /**
   * Perform DQN update
   * Target: <10ms
   */
  update(): { loss: number; epsilon: number } {
    const startTime = performance.now();

    if (this.buffer.length < this.config.miniBatchSize) {
      return { loss: 0, epsilon: this.epsilon };
    }

    // Sample mini-batch
    const batch = this.sampleBatch();

    // Compute TD targets
    let totalLoss = 0;
    const gradients = this.qWeights.map(w => new Float32Array(w.length));

    for (const exp of batch) {
      // Current Q-values
      const qValues = this.forward(exp.state, this.qWeights);
      const currentQ = qValues[exp.action];

      // Target Q-value
      let targetQ: number;
      if (exp.done) {
        targetQ = exp.reward;
      } else {
        if (this.config.doubleDQN) {
          // Double DQN: use online network to select action, target to evaluate
          const nextQOnline = this.forward(exp.nextState, this.qWeights);
          const bestAction = this.argmax(nextQOnline);
          const nextQTarget = this.forward(exp.nextState, this.targetWeights);
          targetQ = exp.reward + this.config.gamma * nextQTarget[bestAction];
        } else {
          // Standard DQN
          const nextQ = this.forward(exp.nextState, this.targetWeights);
          targetQ = exp.reward + this.config.gamma * Math.max(...nextQ);
        }
      }

      // TD error
      const tdError = targetQ - currentQ;
      const loss = tdError * tdError;
      totalLoss += loss;

      // Accumulate gradients
      this.accumulateGradients(gradients, exp.state, exp.action, tdError);
    }

    // Apply gradients
    this.applyGradients(gradients, batch.length);

    // Update target network periodically
    this.stepCount++;
    if (this.stepCount % this.config.targetUpdateFreq === 0) {
      this.targetWeights = this.copyNetwork(this.qWeights);
    }

    // Decay exploration
    this.epsilon = Math.max(
      this.config.explorationFinal,
      this.config.explorationInitial - this.stepCount / this.config.explorationDecay
    );

    this.updateCount++;
    this.avgLoss = totalLoss / batch.length;

    const elapsed = performance.now() - startTime;
    if (elapsed > 10) {
      console.warn(`DQN update exceeded target: ${elapsed.toFixed(2)}ms > 10ms`);
    }

    return {
      loss: this.avgLoss,
      epsilon: this.epsilon,
    };
  }

  /**
   * Get action using epsilon-greedy
   */
  getAction(state: Float32Array, explore: boolean = true): number {
    if (explore && Math.random() < this.epsilon) {
      return Math.floor(Math.random() * this.numActions);
    }

    const qValues = this.forward(state, this.qWeights);
    return this.argmax(qValues);
  }

  /**
   * Get Q-values for a state
   */
  getQValues(state: Float32Array): Float32Array {
    return this.forward(state, this.qWeights);
  }

  /**
   * Get statistics
   */
  getStats(): Record<string, number> {
    return {
      updateCount: this.updateCount,
      bufferSize: this.buffer.length,
      epsilon: this.epsilon,
      avgLoss: this.avgLoss,
      stepCount: this.stepCount,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private initializeNetwork(): Float32Array[] {
    // Simple 2-layer network: input -> hidden -> output
    const hiddenDim = 64;
    const weights: Float32Array[] = [];

    // Layer 1: input_dim -> hidden
    const w1 = new Float32Array(this.inputDim * hiddenDim);
    const scale1 = Math.sqrt(2 / this.inputDim);
    for (let i = 0; i < w1.length; i++) {
      w1[i] = (Math.random() - 0.5) * scale1;
    }
    weights.push(w1);

    // Layer 2: hidden -> num_actions
    const w2 = new Float32Array(hiddenDim * this.numActions);
    const scale2 = Math.sqrt(2 / hiddenDim);
    for (let i = 0; i < w2.length; i++) {
      w2[i] = (Math.random() - 0.5) * scale2;
    }
    weights.push(w2);

    return weights;
  }

  private copyNetwork(weights: Float32Array[]): Float32Array[] {
    return weights.map(w => new Float32Array(w));
  }

  private forward(state: Float32Array, weights: Float32Array[]): Float32Array {
    const hiddenDim = 64;

    // Layer 1: ReLU(W1 * x)
    const hidden = new Float32Array(hiddenDim);
    for (let h = 0; h < hiddenDim; h++) {
      let sum = 0;
      for (let i = 0; i < Math.min(state.length, this.inputDim); i++) {
        sum += state[i] * weights[0][i * hiddenDim + h];
      }
      hidden[h] = Math.max(0, sum); // ReLU
    }

    // Layer 2: W2 * hidden (no activation for Q-values)
    const output = new Float32Array(this.numActions);
    for (let a = 0; a < this.numActions; a++) {
      let sum = 0;
      for (let h = 0; h < hiddenDim; h++) {
        sum += hidden[h] * weights[1][h * this.numActions + a];
      }
      output[a] = sum;
    }

    return output;
  }

  private accumulateGradients(
    gradients: Float32Array[],
    state: Float32Array,
    action: number,
    tdError: number
  ): void {
    const hiddenDim = 64;

    // Forward pass to get hidden activations
    const hidden = new Float32Array(hiddenDim);
    for (let h = 0; h < hiddenDim; h++) {
      let sum = 0;
      for (let i = 0; i < Math.min(state.length, this.inputDim); i++) {
        sum += state[i] * this.qWeights[0][i * hiddenDim + h];
      }
      hidden[h] = Math.max(0, sum);
    }

    // Gradient for layer 2 (only for selected action)
    for (let h = 0; h < hiddenDim; h++) {
      gradients[1][h * this.numActions + action] += hidden[h] * tdError;
    }

    // Gradient for layer 1 (backprop through ReLU)
    for (let h = 0; h < hiddenDim; h++) {
      if (hidden[h] > 0) { // ReLU gradient
        const grad = tdError * this.qWeights[1][h * this.numActions + action];
        for (let i = 0; i < Math.min(state.length, this.inputDim); i++) {
          gradients[0][i * hiddenDim + h] += state[i] * grad;
        }
      }
    }
  }

  private applyGradients(gradients: Float32Array[], batchSize: number): void {
    const lr = this.config.learningRate / batchSize;
    const beta = 0.9;

    for (let layer = 0; layer < gradients.length; layer++) {
      for (let i = 0; i < gradients[layer].length; i++) {
        // Gradient clipping
        const grad = Math.max(
          Math.min(gradients[layer][i], this.config.maxGradNorm),
          -this.config.maxGradNorm
        );

        // Momentum update
        this.qMomentum[layer][i] = beta * this.qMomentum[layer][i] + (1 - beta) * grad;
        this.qWeights[layer][i] += lr * this.qMomentum[layer][i];
      }
    }
  }

  private sampleBatch(): DQNExperience[] {
    const batch: DQNExperience[] = [];
    const indices = new Set<number>();

    while (indices.size < this.config.miniBatchSize && indices.size < this.buffer.length) {
      indices.add(Math.floor(Math.random() * this.buffer.length));
    }

    for (const idx of indices) {
      batch.push(this.buffer[idx]);
    }

    return batch;
  }

  private hashAction(action: string): number {
    let hash = 0;
    for (let i = 0; i < action.length; i++) {
      hash = (hash * 31 + action.charCodeAt(i)) % this.numActions;
    }
    return hash;
  }

  private argmax(values: Float32Array): number {
    let maxIdx = 0;
    let maxVal = values[0];
    for (let i = 1; i < values.length; i++) {
      if (values[i] > maxVal) {
        maxVal = values[i];
        maxIdx = i;
      }
    }
    return maxIdx;
  }
}

/**
 * Factory function
 */
export function createDQN(config?: Partial<DQNConfig>): DQNAlgorithm {
  return new DQNAlgorithm(config);
}
