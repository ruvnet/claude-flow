/**
 * Advantage Actor-Critic (A2C)
 *
 * Implements synchronous A2C algorithm with:
 * - Shared actor-critic network
 * - N-step returns
 * - Entropy regularization
 * - Advantage normalization
 *
 * Performance Target: <10ms per update step
 */

import type {
  RLConfig,
  Trajectory,
  TrajectoryStep,
} from '../types.js';

/**
 * A2C configuration
 */
export interface A2CConfig extends RLConfig {
  algorithm: 'a2c';
  nSteps: number;
  useGAE: boolean;
  gaeLambda: number;
}

/**
 * Default A2C configuration
 */
export const DEFAULT_A2C_CONFIG: A2CConfig = {
  algorithm: 'a2c',
  learningRate: 0.0007,
  gamma: 0.99,
  entropyCoef: 0.01,
  valueLossCoef: 0.5,
  maxGradNorm: 0.5,
  epochs: 1,
  miniBatchSize: 32,
  nSteps: 5,
  useGAE: true,
  gaeLambda: 0.95,
};

/**
 * A2C experience entry
 */
interface A2CExperience {
  state: Float32Array;
  action: number;
  reward: number;
  value: number;
  logProb: number;
  entropy: number;
}

/**
 * A2C Algorithm Implementation
 */
export class A2CAlgorithm {
  private config: A2CConfig;

  // Shared network weights
  private sharedWeights: Float32Array;
  private policyHead: Float32Array;
  private valueHead: Float32Array;

  // Optimizer state
  private sharedMomentum: Float32Array;
  private policyMomentum: Float32Array;
  private valueMomentum: Float32Array;

  // Experience buffer for n-step
  private buffer: A2CExperience[] = [];

  // Dimensions
  private inputDim = 768;
  private hiddenDim = 64;
  private numActions = 4;

  // Statistics
  private updateCount = 0;
  private avgPolicyLoss = 0;
  private avgValueLoss = 0;
  private avgEntropy = 0;

  constructor(config: Partial<A2CConfig> = {}) {
    this.config = { ...DEFAULT_A2C_CONFIG, ...config };

    // Initialize network
    const scale = Math.sqrt(2 / this.inputDim);
    this.sharedWeights = new Float32Array(this.inputDim * this.hiddenDim);
    this.policyHead = new Float32Array(this.hiddenDim * this.numActions);
    this.valueHead = new Float32Array(this.hiddenDim);

    for (let i = 0; i < this.sharedWeights.length; i++) {
      this.sharedWeights[i] = (Math.random() - 0.5) * scale;
    }
    for (let i = 0; i < this.policyHead.length; i++) {
      this.policyHead[i] = (Math.random() - 0.5) * 0.1;
    }
    for (let i = 0; i < this.valueHead.length; i++) {
      this.valueHead[i] = (Math.random() - 0.5) * 0.1;
    }

    // Initialize momentum
    this.sharedMomentum = new Float32Array(this.sharedWeights.length);
    this.policyMomentum = new Float32Array(this.policyHead.length);
    this.valueMomentum = new Float32Array(this.valueHead.length);
  }

  /**
   * Add experience from trajectory
   */
  addExperience(trajectory: Trajectory): void {
    for (const step of trajectory.steps) {
      const { probs, value, entropy } = this.evaluate(step.stateAfter);
      const action = this.hashAction(step.action);

      this.buffer.push({
        state: step.stateAfter,
        action,
        reward: step.reward,
        value,
        logProb: Math.log(probs[action] + 1e-8),
        entropy,
      });
    }
  }

  /**
   * Perform A2C update
   * Target: <10ms
   */
  update(): { policyLoss: number; valueLoss: number; entropy: number } {
    const startTime = performance.now();

    if (this.buffer.length < this.config.nSteps) {
      return { policyLoss: 0, valueLoss: 0, entropy: 0 };
    }

    // Compute returns and advantages
    const returns = this.computeReturns();
    const advantages = this.computeAdvantages(returns);

    // Initialize gradients
    const sharedGrad = new Float32Array(this.sharedWeights.length);
    const policyGrad = new Float32Array(this.policyHead.length);
    const valueGrad = new Float32Array(this.valueHead.length);

    let totalPolicyLoss = 0;
    let totalValueLoss = 0;
    let totalEntropy = 0;

    // Process all experiences
    for (let i = 0; i < this.buffer.length; i++) {
      const exp = this.buffer[i];
      const advantage = advantages[i];
      const return_ = returns[i];

      // Get current policy and value
      const { probs, value, hidden } = this.forwardWithHidden(exp.state);
      const logProb = Math.log(probs[exp.action] + 1e-8);

      // Policy loss
      const policyLoss = -logProb * advantage;
      totalPolicyLoss += policyLoss;

      // Value loss
      const valueLoss = (value - return_) ** 2;
      totalValueLoss += valueLoss;

      // Entropy
      let entropy = 0;
      for (const p of probs) {
        if (p > 0) entropy -= p * Math.log(p);
      }
      totalEntropy += entropy;

      // Accumulate gradients
      this.accumulateGradients(
        sharedGrad, policyGrad, valueGrad,
        exp.state, hidden, exp.action,
        advantage, value - return_
      );
    }

    // Add entropy bonus to policy gradient
    for (let i = 0; i < policyGrad.length; i++) {
      policyGrad[i] -= this.config.entropyCoef * totalEntropy / this.buffer.length;
    }

    // Apply gradients
    this.applyGradients(sharedGrad, policyGrad, valueGrad, this.buffer.length);

    // Clear buffer
    this.buffer = [];
    this.updateCount++;

    this.avgPolicyLoss = totalPolicyLoss / this.buffer.length || 0;
    this.avgValueLoss = totalValueLoss / this.buffer.length || 0;
    this.avgEntropy = totalEntropy / this.buffer.length || 0;

    const elapsed = performance.now() - startTime;
    if (elapsed > 10) {
      console.warn(`A2C update exceeded target: ${elapsed.toFixed(2)}ms > 10ms`);
    }

    return {
      policyLoss: this.avgPolicyLoss,
      valueLoss: this.avgValueLoss,
      entropy: this.avgEntropy,
    };
  }

  /**
   * Get action from policy
   */
  getAction(state: Float32Array): { action: number; value: number } {
    const { probs, value } = this.evaluate(state);
    const action = this.sampleAction(probs);
    return { action, value };
  }

  /**
   * Get statistics
   */
  getStats(): Record<string, number> {
    return {
      updateCount: this.updateCount,
      bufferSize: this.buffer.length,
      avgPolicyLoss: this.avgPolicyLoss,
      avgValueLoss: this.avgValueLoss,
      avgEntropy: this.avgEntropy,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private evaluate(state: Float32Array): { probs: Float32Array; value: number; entropy: number } {
    const { probs, value } = this.forward(state);

    let entropy = 0;
    for (const p of probs) {
      if (p > 0) entropy -= p * Math.log(p);
    }

    return { probs, value, entropy };
  }

  private forward(state: Float32Array): { probs: Float32Array; value: number } {
    // Shared hidden layer
    const hidden = new Float32Array(this.hiddenDim);
    for (let h = 0; h < this.hiddenDim; h++) {
      let sum = 0;
      for (let i = 0; i < Math.min(state.length, this.inputDim); i++) {
        sum += state[i] * this.sharedWeights[i * this.hiddenDim + h];
      }
      hidden[h] = Math.max(0, sum); // ReLU
    }

    // Policy head
    const logits = new Float32Array(this.numActions);
    for (let a = 0; a < this.numActions; a++) {
      let sum = 0;
      for (let h = 0; h < this.hiddenDim; h++) {
        sum += hidden[h] * this.policyHead[h * this.numActions + a];
      }
      logits[a] = sum;
    }
    const probs = this.softmax(logits);

    // Value head
    let value = 0;
    for (let h = 0; h < this.hiddenDim; h++) {
      value += hidden[h] * this.valueHead[h];
    }

    return { probs, value };
  }

  private forwardWithHidden(state: Float32Array): { probs: Float32Array; value: number; hidden: Float32Array } {
    const hidden = new Float32Array(this.hiddenDim);
    for (let h = 0; h < this.hiddenDim; h++) {
      let sum = 0;
      for (let i = 0; i < Math.min(state.length, this.inputDim); i++) {
        sum += state[i] * this.sharedWeights[i * this.hiddenDim + h];
      }
      hidden[h] = Math.max(0, sum);
    }

    const logits = new Float32Array(this.numActions);
    for (let a = 0; a < this.numActions; a++) {
      let sum = 0;
      for (let h = 0; h < this.hiddenDim; h++) {
        sum += hidden[h] * this.policyHead[h * this.numActions + a];
      }
      logits[a] = sum;
    }
    const probs = this.softmax(logits);

    let value = 0;
    for (let h = 0; h < this.hiddenDim; h++) {
      value += hidden[h] * this.valueHead[h];
    }

    return { probs, value, hidden };
  }

  private computeReturns(): number[] {
    const returns = new Array(this.buffer.length).fill(0);
    let cumReturn = 0;

    // Bootstrap from last value if not terminal
    if (this.buffer.length > 0) {
      cumReturn = this.buffer[this.buffer.length - 1].value;
    }

    for (let t = this.buffer.length - 1; t >= 0; t--) {
      cumReturn = this.buffer[t].reward + this.config.gamma * cumReturn;
      returns[t] = cumReturn;
    }

    return returns;
  }

  private computeAdvantages(returns: number[]): number[] {
    if (this.config.useGAE) {
      return this.computeGAE();
    }

    // Simple advantage: return - value
    const advantages = new Array(this.buffer.length).fill(0);
    for (let i = 0; i < this.buffer.length; i++) {
      advantages[i] = returns[i] - this.buffer[i].value;
    }

    // Normalize
    const mean = advantages.reduce((a, b) => a + b, 0) / advantages.length;
    const std = Math.sqrt(
      advantages.reduce((a, b) => a + (b - mean) ** 2, 0) / advantages.length
    ) + 1e-8;

    return advantages.map(a => (a - mean) / std);
  }

  private computeGAE(): number[] {
    const advantages = new Array(this.buffer.length).fill(0);
    let lastGae = 0;

    for (let t = this.buffer.length - 1; t >= 0; t--) {
      const nextValue = t < this.buffer.length - 1
        ? this.buffer[t + 1].value
        : 0;
      const delta = this.buffer[t].reward + this.config.gamma * nextValue - this.buffer[t].value;
      lastGae = delta + this.config.gamma * this.config.gaeLambda * lastGae;
      advantages[t] = lastGae;
    }

    // Normalize
    const mean = advantages.reduce((a, b) => a + b, 0) / advantages.length;
    const std = Math.sqrt(
      advantages.reduce((a, b) => a + (b - mean) ** 2, 0) / advantages.length
    ) + 1e-8;

    return advantages.map(a => (a - mean) / std);
  }

  private accumulateGradients(
    sharedGrad: Float32Array,
    policyGrad: Float32Array,
    valueGrad: Float32Array,
    state: Float32Array,
    hidden: Float32Array,
    action: number,
    advantage: number,
    valueError: number
  ): void {
    // Policy gradient
    for (let h = 0; h < this.hiddenDim; h++) {
      policyGrad[h * this.numActions + action] += hidden[h] * advantage;
    }

    // Value gradient
    for (let h = 0; h < this.hiddenDim; h++) {
      valueGrad[h] += hidden[h] * valueError * this.config.valueLossCoef;
    }

    // Shared layer gradient (backprop through both heads)
    for (let h = 0; h < this.hiddenDim; h++) {
      if (hidden[h] > 0) { // ReLU gradient
        const policySignal = advantage * this.policyHead[h * this.numActions + action];
        const valueSignal = valueError * this.valueHead[h] * this.config.valueLossCoef;
        const totalSignal = policySignal + valueSignal;

        for (let i = 0; i < Math.min(state.length, this.inputDim); i++) {
          sharedGrad[i * this.hiddenDim + h] += state[i] * totalSignal;
        }
      }
    }
  }

  private applyGradients(
    sharedGrad: Float32Array,
    policyGrad: Float32Array,
    valueGrad: Float32Array,
    batchSize: number
  ): void {
    const lr = this.config.learningRate / batchSize;
    const beta = 0.9;

    // Apply to shared weights
    for (let i = 0; i < this.sharedWeights.length; i++) {
      const grad = Math.max(Math.min(sharedGrad[i], this.config.maxGradNorm), -this.config.maxGradNorm);
      this.sharedMomentum[i] = beta * this.sharedMomentum[i] + (1 - beta) * grad;
      this.sharedWeights[i] -= lr * this.sharedMomentum[i];
    }

    // Apply to policy head
    for (let i = 0; i < this.policyHead.length; i++) {
      const grad = Math.max(Math.min(policyGrad[i], this.config.maxGradNorm), -this.config.maxGradNorm);
      this.policyMomentum[i] = beta * this.policyMomentum[i] + (1 - beta) * grad;
      this.policyHead[i] -= lr * this.policyMomentum[i];
    }

    // Apply to value head
    for (let i = 0; i < this.valueHead.length; i++) {
      const grad = Math.max(Math.min(valueGrad[i], this.config.maxGradNorm), -this.config.maxGradNorm);
      this.valueMomentum[i] = beta * this.valueMomentum[i] + (1 - beta) * grad;
      this.valueHead[i] -= lr * this.valueMomentum[i];
    }
  }

  private softmax(logits: Float32Array): Float32Array {
    const max = Math.max(...logits);
    const exps = new Float32Array(logits.length);
    let sum = 0;

    for (let i = 0; i < logits.length; i++) {
      exps[i] = Math.exp(logits[i] - max);
      sum += exps[i];
    }

    for (let i = 0; i < exps.length; i++) {
      exps[i] /= sum;
    }

    return exps;
  }

  private sampleAction(probs: Float32Array): number {
    const r = Math.random();
    let cumSum = 0;
    for (let i = 0; i < probs.length; i++) {
      cumSum += probs[i];
      if (r < cumSum) return i;
    }
    return probs.length - 1;
  }

  private hashAction(action: string): number {
    let hash = 0;
    for (let i = 0; i < action.length; i++) {
      hash = (hash * 31 + action.charCodeAt(i)) % this.numActions;
    }
    return hash;
  }
}

/**
 * Factory function
 */
export function createA2C(config?: Partial<A2CConfig>): A2CAlgorithm {
  return new A2CAlgorithm(config);
}
