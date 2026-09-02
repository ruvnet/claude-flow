/**
 * Decision Transformer
 *
 * Implements sequence modeling approach for RL:
 * - Trajectory as sequence: (s, a, R, s, a, R, ...)
 * - Return-conditioned generation
 * - Causal transformer attention
 * - Offline RL from trajectories
 *
 * Performance Target: <10ms per forward pass
 */

import type {
  DecisionTransformerConfig,
  Trajectory,
  TrajectoryStep,
} from '../types.js';

/**
 * Default Decision Transformer configuration
 */
export const DEFAULT_DT_CONFIG: DecisionTransformerConfig = {
  algorithm: 'decision-transformer',
  learningRate: 0.0001,
  gamma: 0.99,
  entropyCoef: 0,
  valueLossCoef: 0,
  maxGradNorm: 1.0,
  epochs: 1,
  miniBatchSize: 64,
  contextLength: 20,
  numHeads: 4,
  numLayers: 2,
  hiddenDim: 64,
  embeddingDim: 32,
  dropout: 0.1,
};

/**
 * Sequence entry for transformer
 */
interface SequenceEntry {
  returnToGo: number;
  state: Float32Array;
  action: number;
  timestep: number;
}

/**
 * Decision Transformer Implementation
 */
export class DecisionTransformer {
  private config: DecisionTransformerConfig;

  // Embeddings
  private stateEmbed: Float32Array;
  private actionEmbed: Float32Array;
  private returnEmbed: Float32Array;
  private posEmbed: Float32Array;

  // Transformer layers (simplified)
  private attentionWeights: Float32Array[][];
  private ffnWeights: Float32Array[][];

  // Output head
  private actionHead: Float32Array;

  // Training buffer
  private trajectoryBuffer: Trajectory[] = [];

  // Dimensions
  private stateDim = 768;
  private numActions = 4;

  // Statistics
  private updateCount = 0;
  private avgLoss = 0;

  constructor(config: Partial<DecisionTransformerConfig> = {}) {
    this.config = { ...DEFAULT_DT_CONFIG, ...config };

    // Initialize embeddings
    this.stateEmbed = this.initEmbedding(this.stateDim, this.config.embeddingDim);
    this.actionEmbed = this.initEmbedding(this.numActions, this.config.embeddingDim);
    this.returnEmbed = this.initEmbedding(1, this.config.embeddingDim);
    this.posEmbed = this.initEmbedding(this.config.contextLength * 3, this.config.embeddingDim);

    // Initialize transformer layers
    this.attentionWeights = [];
    this.ffnWeights = [];

    for (let l = 0; l < this.config.numLayers; l++) {
      // Attention: Q, K, V, O projections
      this.attentionWeights.push([
        this.initWeight(this.config.embeddingDim, this.config.hiddenDim), // Q
        this.initWeight(this.config.embeddingDim, this.config.hiddenDim), // K
        this.initWeight(this.config.embeddingDim, this.config.hiddenDim), // V
        this.initWeight(this.config.hiddenDim, this.config.embeddingDim), // O
      ]);

      // FFN: up and down projections
      this.ffnWeights.push([
        this.initWeight(this.config.embeddingDim, this.config.hiddenDim * 4),
        this.initWeight(this.config.hiddenDim * 4, this.config.embeddingDim),
      ]);
    }

    // Action prediction head
    this.actionHead = this.initWeight(this.config.embeddingDim, this.numActions);
  }

  /**
   * Add trajectory for training
   */
  addTrajectory(trajectory: Trajectory): void {
    if (trajectory.isComplete && trajectory.steps.length > 0) {
      this.trajectoryBuffer.push(trajectory);

      // Keep buffer bounded
      if (this.trajectoryBuffer.length > 1000) {
        this.trajectoryBuffer = this.trajectoryBuffer.slice(-1000);
      }
    }
  }

  /**
   * Train on buffered trajectories
   * Target: <10ms per batch
   */
  train(): { loss: number; accuracy: number } {
    const startTime = performance.now();

    if (this.trajectoryBuffer.length === 0) {
      return { loss: 0, accuracy: 0 };
    }

    // Sample mini-batch of trajectories
    const batchSize = Math.min(this.config.miniBatchSize, this.trajectoryBuffer.length);
    const batch: Trajectory[] = [];

    for (let i = 0; i < batchSize; i++) {
      const idx = Math.floor(Math.random() * this.trajectoryBuffer.length);
      batch.push(this.trajectoryBuffer[idx]);
    }

    let totalLoss = 0;
    let correct = 0;
    let total = 0;

    for (const trajectory of batch) {
      // Create sequence from trajectory
      const sequence = this.createSequence(trajectory);

      if (sequence.length < 2) continue;

      // Forward pass and compute loss
      for (let t = 1; t < sequence.length; t++) {
        // Use context up to position t
        const context = sequence.slice(Math.max(0, t - this.config.contextLength), t);
        const target = sequence[t];

        // Predict action
        const predicted = this.forward(context);
        const predictedAction = this.argmax(predicted);

        // Cross-entropy loss
        const loss = -Math.log(predicted[target.action] + 1e-8);
        totalLoss += loss;

        if (predictedAction === target.action) {
          correct++;
        }
        total++;

        // Gradient update (simplified)
        this.updateWeights(context, target.action, predicted);
      }
    }

    this.updateCount++;
    this.avgLoss = total > 0 ? totalLoss / total : 0;

    const elapsed = performance.now() - startTime;
    if (elapsed > 10) {
      console.warn(`DT training exceeded target: ${elapsed.toFixed(2)}ms > 10ms`);
    }

    return {
      loss: this.avgLoss,
      accuracy: total > 0 ? correct / total : 0,
    };
  }

  /**
   * Get action conditioned on target return
   */
  getAction(
    states: Float32Array[],
    actions: number[],
    targetReturn: number
  ): number {
    // Build sequence
    const sequence: SequenceEntry[] = [];
    let returnToGo = targetReturn;

    for (let i = 0; i < states.length; i++) {
      sequence.push({
        returnToGo,
        state: states[i],
        action: actions[i] ?? 0,
        timestep: i,
      });

      // Decrease return-to-go by estimated reward
      if (i > 0) {
        returnToGo -= 0.1; // Default reward decrement for inference
      }
    }

    // Forward pass
    const logits = this.forward(sequence);
    return this.argmax(logits);
  }

  /**
   * Forward pass through transformer
   */
  forward(sequence: SequenceEntry[]): Float32Array {
    // Embed sequence elements
    const seqLen = Math.min(sequence.length, this.config.contextLength);
    const embedDim = this.config.embeddingDim;

    // Initialize hidden states (simplified: stack all modalities)
    const hidden = new Float32Array(seqLen * 3 * embedDim);

    for (let t = 0; t < seqLen; t++) {
      const entry = sequence[sequence.length - seqLen + t];
      const baseIdx = t * 3 * embedDim;

      // Embed return
      for (let d = 0; d < embedDim; d++) {
        hidden[baseIdx + d] = entry.returnToGo * this.returnEmbed[d];
      }

      // Embed state
      for (let d = 0; d < embedDim; d++) {
        let stateSum = 0;
        for (let s = 0; s < Math.min(entry.state.length, this.stateDim); s++) {
          stateSum += entry.state[s] * this.stateEmbed[s * embedDim + d];
        }
        hidden[baseIdx + embedDim + d] = stateSum;
      }

      // Embed action
      for (let d = 0; d < embedDim; d++) {
        hidden[baseIdx + 2 * embedDim + d] = this.actionEmbed[entry.action * embedDim + d];
      }

      // Add positional embedding
      for (let d = 0; d < 3 * embedDim; d++) {
        hidden[baseIdx + d] += this.posEmbed[t * 3 * embedDim + d] || 0;
      }
    }

    // Apply transformer layers
    for (let l = 0; l < this.config.numLayers; l++) {
      hidden.set(this.transformerLayer(hidden, seqLen * 3, l));
    }

    // Extract last state position embedding for action prediction
    const lastStateIdx = (seqLen * 3 - 2) * embedDim;
    const lastState = hidden.slice(lastStateIdx, lastStateIdx + embedDim);

    // Action prediction
    const logits = new Float32Array(this.numActions);
    for (let a = 0; a < this.numActions; a++) {
      let sum = 0;
      for (let d = 0; d < embedDim; d++) {
        sum += lastState[d] * this.actionHead[d * this.numActions + a];
      }
      logits[a] = sum;
    }

    return this.softmax(logits);
  }

  /**
   * Get statistics
   */
  getStats(): Record<string, number> {
    return {
      updateCount: this.updateCount,
      bufferSize: this.trajectoryBuffer.length,
      avgLoss: this.avgLoss,
      contextLength: this.config.contextLength,
      numLayers: this.config.numLayers,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private initEmbedding(inputDim: number, outputDim: number): Float32Array {
    const embed = new Float32Array(inputDim * outputDim);
    const scale = Math.sqrt(2 / inputDim);
    for (let i = 0; i < embed.length; i++) {
      embed[i] = (Math.random() - 0.5) * scale;
    }
    return embed;
  }

  private initWeight(inputDim: number, outputDim: number): Float32Array {
    const weight = new Float32Array(inputDim * outputDim);
    const scale = Math.sqrt(2 / inputDim);
    for (let i = 0; i < weight.length; i++) {
      weight[i] = (Math.random() - 0.5) * scale;
    }
    return weight;
  }

  private createSequence(trajectory: Trajectory): SequenceEntry[] {
    const sequence: SequenceEntry[] = [];

    // Compute returns-to-go
    const rewards = trajectory.steps.map(s => s.reward);
    const returnsToGo = new Array(rewards.length).fill(0);
    let cumReturn = 0;

    for (let t = rewards.length - 1; t >= 0; t--) {
      cumReturn = rewards[t] + this.config.gamma * cumReturn;
      returnsToGo[t] = cumReturn;
    }

    // Create sequence entries
    for (let t = 0; t < trajectory.steps.length; t++) {
      sequence.push({
        returnToGo: returnsToGo[t],
        state: trajectory.steps[t].stateAfter,
        action: this.hashAction(trajectory.steps[t].action),
        timestep: t,
      });
    }

    return sequence;
  }

  private transformerLayer(
    hidden: Float32Array,
    seqLen: number,
    layerIdx: number
  ): Float32Array {
    const embedDim = this.config.embeddingDim;
    const hiddenDim = this.config.hiddenDim;
    const numHeads = this.config.numHeads;
    const headDim = hiddenDim / numHeads;

    const output = new Float32Array(hidden.length);

    // Self-attention (simplified causal)
    const [Wq, Wk, Wv, Wo] = this.attentionWeights[layerIdx];

    // Compute Q, K, V for all positions
    const Q = new Float32Array(seqLen * hiddenDim);
    const K = new Float32Array(seqLen * hiddenDim);
    const V = new Float32Array(seqLen * hiddenDim);

    for (let pos = 0; pos < seqLen; pos++) {
      for (let h = 0; h < hiddenDim; h++) {
        let qSum = 0, kSum = 0, vSum = 0;
        for (let d = 0; d < embedDim; d++) {
          const hiddenVal = hidden[pos * embedDim + d];
          qSum += hiddenVal * Wq[d * hiddenDim + h];
          kSum += hiddenVal * Wk[d * hiddenDim + h];
          vSum += hiddenVal * Wv[d * hiddenDim + h];
        }
        Q[pos * hiddenDim + h] = qSum;
        K[pos * hiddenDim + h] = kSum;
        V[pos * hiddenDim + h] = vSum;
      }
    }

    // Causal attention
    for (let pos = 0; pos < seqLen; pos++) {
      // Compute attention scores for current position
      const scores = new Float32Array(pos + 1);
      for (let k = 0; k <= pos; k++) {
        let score = 0;
        for (let h = 0; h < hiddenDim; h++) {
          score += Q[pos * hiddenDim + h] * K[k * hiddenDim + h];
        }
        scores[k] = score / Math.sqrt(headDim);
      }

      // Softmax
      const maxScore = Math.max(...scores);
      let sumExp = 0;
      for (let k = 0; k <= pos; k++) {
        scores[k] = Math.exp(scores[k] - maxScore);
        sumExp += scores[k];
      }
      for (let k = 0; k <= pos; k++) {
        scores[k] /= sumExp;
      }

      // Weighted sum of values
      const attnOut = new Float32Array(hiddenDim);
      for (let k = 0; k <= pos; k++) {
        for (let h = 0; h < hiddenDim; h++) {
          attnOut[h] += scores[k] * V[k * hiddenDim + h];
        }
      }

      // Output projection
      for (let d = 0; d < embedDim; d++) {
        let sum = hidden[pos * embedDim + d]; // Residual
        for (let h = 0; h < hiddenDim; h++) {
          sum += attnOut[h] * Wo[h * embedDim + d];
        }
        output[pos * embedDim + d] = sum;
      }
    }

    // FFN with residual
    const [Wup, Wdown] = this.ffnWeights[layerIdx];
    const ffnHiddenDim = hiddenDim * 4;

    for (let pos = 0; pos < seqLen; pos++) {
      // Up projection + GELU
      const ffnHidden = new Float32Array(ffnHiddenDim);
      for (let h = 0; h < ffnHiddenDim; h++) {
        let sum = 0;
        for (let d = 0; d < embedDim; d++) {
          sum += output[pos * embedDim + d] * Wup[d * ffnHiddenDim + h];
        }
        // GELU approximation
        ffnHidden[h] = sum * 0.5 * (1 + Math.tanh(0.7978845608 * (sum + 0.044715 * sum * sum * sum)));
      }

      // Down projection
      for (let d = 0; d < embedDim; d++) {
        let sum = output[pos * embedDim + d]; // Residual
        for (let h = 0; h < ffnHiddenDim; h++) {
          sum += ffnHidden[h] * Wdown[h * embedDim + d];
        }
        output[pos * embedDim + d] = sum;
      }
    }

    return output;
  }

  private updateWeights(
    context: SequenceEntry[],
    targetAction: number,
    predicted: Float32Array
  ): void {
    // Simplified gradient update for action head
    const lr = this.config.learningRate;
    const embedDim = this.config.embeddingDim;

    // Gradient of cross-entropy
    const grad = new Float32Array(this.numActions);
    for (let a = 0; a < this.numActions; a++) {
      grad[a] = predicted[a] - (a === targetAction ? 1 : 0);
    }

    // Update action head (simplified)
    for (let d = 0; d < embedDim; d++) {
      for (let a = 0; a < this.numActions; a++) {
        this.actionHead[d * this.numActions + a] -= lr * grad[a] * 0.1;
      }
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
export function createDecisionTransformer(
  config?: Partial<DecisionTransformerConfig>
): DecisionTransformer {
  return new DecisionTransformer(config);
}
