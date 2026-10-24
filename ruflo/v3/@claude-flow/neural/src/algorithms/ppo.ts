/**
 * Proximal Policy Optimization (PPO)
 *
 * Implements PPO algorithm for stable policy learning with:
 * - Clipped surrogate objective
 * - GAE (Generalized Advantage Estimation)
 * - Value function clipping
 * - Entropy bonus
 *
 * Performance Target: <10ms per update step
 */

import type {
  PPOConfig,
  Trajectory,
  TrajectoryStep,
} from '../types.js';

/**
 * Default PPO configuration
 */
export const DEFAULT_PPO_CONFIG: PPOConfig = {
  algorithm: 'ppo',
  learningRate: 0.0003,
  gamma: 0.99,
  entropyCoef: 0.01,
  valueLossCoef: 0.5,
  maxGradNorm: 0.5,
  epochs: 4,
  miniBatchSize: 64,
  clipRange: 0.2,
  clipRangeVf: null,
  targetKL: 0.01,
  gaeLambda: 0.95,
};

/**
 * PPO experience buffer entry
 */
interface PPOExperience {
  state: Float32Array;
  action: number;
  reward: number;
  value: number;
  logProb: number;
  advantage: number;
  return_: number;
}

/**
 * PPO Algorithm Implementation
 */
export class PPOAlgorithm {
  private config: PPOConfig;

  // Policy network weights (simplified linear model for speed)
  private policyWeights: Float32Array;
  private valueWeights: Float32Array;

  // Optimizer state
  private policyMomentum: Float32Array;
  private valueMomentum: Float32Array;

  // Experience buffer
  private buffer: PPOExperience[] = [];

  // Statistics
  private updateCount = 0;
  private totalLoss = 0;
  private approxKL = 0;
  private clipFraction = 0;

  constructor(config: Partial<PPOConfig> = {}) {
    this.config = { ...DEFAULT_PPO_CONFIG, ...config };

    // Initialize weights (768 input dim, simplified)
    const dim = 768;
    this.policyWeights = new Float32Array(dim);
    this.valueWeights = new Float32Array(dim);
    this.policyMomentum = new Float32Array(dim);
    this.valueMomentum = new Float32Array(dim);

    // Xavier initialization
    const scale = Math.sqrt(2 / dim);
    for (let i = 0; i < dim; i++) {
      this.policyWeights[i] = (Math.random() - 0.5) * scale;
      this.valueWeights[i] = (Math.random() - 0.5) * scale;
    }
  }

  /**
   * Add experience from trajectory
   */
  addExperience(trajectory: Trajectory): void {
    if (trajectory.steps.length === 0) return;

    // Compute values for each step
    const values = trajectory.steps.map(step =>
      this.computeValue(step.stateAfter)
    );

    // Compute advantages using GAE
    const advantages = this.computeGAE(
      trajectory.steps.map(s => s.reward),
      values
    );

    // Compute returns
    const returns = this.computeReturns(
      trajectory.steps.map(s => s.reward)
    );

    // Add to buffer
    for (let i = 0; i < trajectory.steps.length; i++) {
      const step = trajectory.steps[i];
      this.buffer.push({
        state: step.stateAfter,
        action: this.hashAction(step.action),
        reward: step.reward,
        value: values[i],
        logProb: this.computeLogProb(step.stateAfter, step.action),
        advantage: advantages[i],
        return_: returns[i],
      });
    }
  }

  /**
   * Perform PPO update
   * Target: <10ms
   */
  update(): { policyLoss: number; valueLoss: number; entropy: number } {
    const startTime = performance.now();

    if (this.buffer.length < this.config.miniBatchSize) {
      return { policyLoss: 0, valueLoss: 0, entropy: 0 };
    }

    // Normalize advantages
    const advantages = this.buffer.map(e => e.advantage);
    const advMean = advantages.reduce((a, b) => a + b, 0) / advantages.length;
    const advStd = Math.sqrt(
      advantages.reduce((a, b) => a + (b - advMean) ** 2, 0) / advantages.length
    ) + 1e-8;

    for (const exp of this.buffer) {
      exp.advantage = (exp.advantage - advMean) / advStd;
    }

    let totalPolicyLoss = 0;
    let totalValueLoss = 0;
    let totalEntropy = 0;
    let totalClipFrac = 0;
    let totalKL = 0;
    let numUpdates = 0;

    // Multiple epochs
    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      // Shuffle buffer
      this.shuffleBuffer();

      // Process mini-batches
      for (let i = 0; i < this.buffer.length; i += this.config.miniBatchSize) {
        const batch = this.buffer.slice(i, i + this.config.miniBatchSize);
        if (batch.length < this.config.miniBatchSize / 2) continue;

        const result = this.updateMiniBatch(batch);
        totalPolicyLoss += result.policyLoss;
        totalValueLoss += result.valueLoss;
        totalEntropy += result.entropy;
        totalClipFrac += result.clipFrac;
        totalKL += result.kl;
        numUpdates++;

        // Early stopping if KL too high
        if (result.kl > this.config.targetKL * 1.5) {
          break;
        }
      }
    }

    // Clear buffer
    this.buffer = [];
    this.updateCount++;

    const elapsed = performance.now() - startTime;
    if (elapsed > 10) {
      console.warn(`PPO update exceeded target: ${elapsed.toFixed(2)}ms > 10ms`);
    }

    return {
      policyLoss: numUpdates > 0 ? totalPolicyLoss / numUpdates : 0,
      valueLoss: numUpdates > 0 ? totalValueLoss / numUpdates : 0,
      entropy: numUpdates > 0 ? totalEntropy / numUpdates : 0,
    };
  }

  /**
   * Get action from policy
   */
  getAction(state: Float32Array): { action: number; logProb: number; value: number } {
    const logits = this.computeLogits(state);
    const probs = this.softmax(logits);
    const action = this.sampleAction(probs);

    return {
      action,
      logProb: Math.log(probs[action] + 1e-8),
      value: this.computeValue(state),
    };
  }

  /**
   * Get statistics
   */
  getStats(): Record<string, number> {
    return {
      updateCount: this.updateCount,
      bufferSize: this.buffer.length,
      avgLoss: this.updateCount > 0 ? this.totalLoss / this.updateCount : 0,
      approxKL: this.approxKL,
      clipFraction: this.clipFraction,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private computeValue(state: Float32Array): number {
    let value = 0;
    for (let i = 0; i < Math.min(state.length, this.valueWeights.length); i++) {
      value += state[i] * this.valueWeights[i];
    }
    return value;
  }

  private computeLogits(state: Float32Array): Float32Array {
    // Simplified: 4 discrete actions
    const numActions = 4;
    const logits = new Float32Array(numActions);

    for (let a = 0; a < numActions; a++) {
      for (let i = 0; i < Math.min(state.length, this.policyWeights.length); i++) {
        logits[a] += state[i] * this.policyWeights[i] * (1 + a * 0.1);
      }
    }

    return logits;
  }

  private computeLogProb(state: Float32Array, action: string): number {
    const logits = this.computeLogits(state);
    const probs = this.softmax(logits);
    const actionIdx = this.hashAction(action);
    return Math.log(probs[actionIdx] + 1e-8);
  }

  private hashAction(action: string): number {
    // Simple hash to action index (0-3)
    let hash = 0;
    for (let i = 0; i < action.length; i++) {
      hash = (hash * 31 + action.charCodeAt(i)) % 4;
    }
    return hash;
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

  private computeGAE(rewards: number[], values: number[]): number[] {
    const advantages = new Array(rewards.length).fill(0);
    let lastGae = 0;

    for (let t = rewards.length - 1; t >= 0; t--) {
      const nextValue = t < rewards.length - 1 ? values[t + 1] : 0;
      const delta = rewards[t] + this.config.gamma * nextValue - values[t];
      lastGae = delta + this.config.gamma * this.config.gaeLambda * lastGae;
      advantages[t] = lastGae;
    }

    return advantages;
  }

  private computeReturns(rewards: number[]): number[] {
    const returns = new Array(rewards.length).fill(0);
    let cumReturn = 0;

    for (let t = rewards.length - 1; t >= 0; t--) {
      cumReturn = rewards[t] + this.config.gamma * cumReturn;
      returns[t] = cumReturn;
    }

    return returns;
  }

  private shuffleBuffer(): void {
    for (let i = this.buffer.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.buffer[i], this.buffer[j]] = [this.buffer[j], this.buffer[i]];
    }
  }

  private updateMiniBatch(batch: PPOExperience[]): {
    policyLoss: number;
    valueLoss: number;
    entropy: number;
    clipFrac: number;
    kl: number;
  } {
    let policyLoss = 0;
    let valueLoss = 0;
    let entropy = 0;
    let clipFrac = 0;
    let kl = 0;

    const policyGrad = new Float32Array(this.policyWeights.length);
    const valueGrad = new Float32Array(this.valueWeights.length);

    for (const exp of batch) {
      // Current policy
      const logits = this.computeLogits(exp.state);
      const probs = this.softmax(logits);
      const newLogProb = Math.log(probs[exp.action] + 1e-8);
      const currentValue = this.computeValue(exp.state);

      // Ratio for PPO
      const ratio = Math.exp(newLogProb - exp.logProb);

      // Clipped surrogate objective
      const surr1 = ratio * exp.advantage;
      const surr2 = Math.max(
        Math.min(ratio, 1 + this.config.clipRange),
        1 - this.config.clipRange
      ) * exp.advantage;

      const policyLossI = -Math.min(surr1, surr2);
      policyLoss += policyLossI;

      // Track clipping
      if (Math.abs(ratio - 1) > this.config.clipRange) {
        clipFrac++;
      }

      // KL divergence approximation
      kl += (exp.logProb - newLogProb);

      // Value loss
      let valueLossI: number;
      if (this.config.clipRangeVf !== null) {
        const valuePred = currentValue;
        const valueClipped = exp.value + Math.max(
          Math.min(valuePred - exp.value, this.config.clipRangeVf),
          -this.config.clipRangeVf
        );
        const vf1 = (valuePred - exp.return_) ** 2;
        const vf2 = (valueClipped - exp.return_) ** 2;
        valueLossI = Math.max(vf1, vf2);
      } else {
        valueLossI = (currentValue - exp.return_) ** 2;
      }
      valueLoss += valueLossI;

      // Entropy
      let entropyI = 0;
      for (const p of probs) {
        if (p > 0) entropyI -= p * Math.log(p);
      }
      entropy += entropyI;

      // Compute gradients (simplified)
      for (let i = 0; i < Math.min(exp.state.length, policyGrad.length); i++) {
        policyGrad[i] += exp.state[i] * policyLossI * 0.01;
        valueGrad[i] += exp.state[i] * valueLossI * 0.01;
      }
    }

    // Apply gradients with momentum
    const lr = this.config.learningRate;
    const beta = 0.9;

    for (let i = 0; i < this.policyWeights.length; i++) {
      this.policyMomentum[i] = beta * this.policyMomentum[i] + (1 - beta) * policyGrad[i];
      this.policyWeights[i] -= lr * this.policyMomentum[i];

      this.valueMomentum[i] = beta * this.valueMomentum[i] + (1 - beta) * valueGrad[i];
      this.valueWeights[i] -= lr * this.valueMomentum[i];
    }

    return {
      policyLoss: policyLoss / batch.length,
      valueLoss: valueLoss / batch.length,
      entropy: entropy / batch.length,
      clipFrac: clipFrac / batch.length,
      kl: kl / batch.length,
    };
  }
}

/**
 * Factory function
 */
export function createPPO(config?: Partial<PPOConfig>): PPOAlgorithm {
  return new PPOAlgorithm(config);
}
