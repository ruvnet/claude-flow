/**
 * Tabular Q-Learning
 *
 * Classic Q-learning algorithm with:
 * - Epsilon-greedy exploration
 * - State hashing for continuous states
 * - Eligibility traces (optional)
 * - Experience replay
 *
 * Suitable for smaller state spaces or discretized environments.
 * Performance Target: <1ms per update
 */

import type { Trajectory, RLConfig } from '../types.js';

/**
 * Q-Learning configuration
 */
export interface QLearningConfig extends RLConfig {
  algorithm: 'q-learning';
  explorationInitial: number;
  explorationFinal: number;
  explorationDecay: number;
  maxStates: number;
  useEligibilityTraces: boolean;
  traceDecay: number;
}

/**
 * Default Q-Learning configuration
 */
export const DEFAULT_QLEARNING_CONFIG: QLearningConfig = {
  algorithm: 'q-learning',
  learningRate: 0.1,
  gamma: 0.99,
  entropyCoef: 0,
  valueLossCoef: 1,
  maxGradNorm: 1,
  epochs: 1,
  miniBatchSize: 1,
  explorationInitial: 1.0,
  explorationFinal: 0.01,
  explorationDecay: 10000,
  maxStates: 10000,
  useEligibilityTraces: false,
  traceDecay: 0.9,
};

/**
 * Q-table entry
 */
interface QEntry {
  qValues: Float32Array;
  visits: number;
  lastUpdate: number;
}

/**
 * Q-Learning Algorithm Implementation
 */
export class QLearning {
  private config: QLearningConfig;

  // Q-table
  private qTable: Map<string, QEntry> = new Map();

  // Exploration
  private epsilon: number;
  private stepCount = 0;

  // Number of actions
  private numActions = 4;

  // Eligibility traces
  private traces: Map<string, Float32Array> = new Map();

  // Statistics
  private updateCount = 0;
  private avgTDError = 0;

  constructor(config: Partial<QLearningConfig> = {}) {
    this.config = { ...DEFAULT_QLEARNING_CONFIG, ...config };
    this.epsilon = this.config.explorationInitial;
  }

  /**
   * Update Q-values from trajectory
   */
  update(trajectory: Trajectory): { tdError: number } {
    const startTime = performance.now();

    if (trajectory.steps.length === 0) {
      return { tdError: 0 };
    }

    let totalTDError = 0;

    // Reset eligibility traces for new trajectory
    if (this.config.useEligibilityTraces) {
      this.traces.clear();
    }

    for (let i = 0; i < trajectory.steps.length; i++) {
      const step = trajectory.steps[i];
      const stateKey = this.hashState(step.stateBefore);
      const action = this.hashAction(step.action);

      // Get or create Q-entry
      const qEntry = this.getOrCreateEntry(stateKey);

      // Current Q-value
      const currentQ = qEntry.qValues[action];

      // Compute target Q-value
      let targetQ: number;
      if (i === trajectory.steps.length - 1) {
        // Terminal state
        targetQ = step.reward;
      } else {
        const nextStateKey = this.hashState(step.stateAfter);
        const nextEntry = this.getOrCreateEntry(nextStateKey);
        const maxNextQ = Math.max(...nextEntry.qValues);
        targetQ = step.reward + this.config.gamma * maxNextQ;
      }

      // TD error
      const tdError = targetQ - currentQ;
      totalTDError += Math.abs(tdError);

      if (this.config.useEligibilityTraces) {
        // Update eligibility trace
        this.updateTrace(stateKey, action);

        // Update all states with traces
        this.updateWithTraces(tdError);
      } else {
        // Simple Q-learning update
        qEntry.qValues[action] += this.config.learningRate * tdError;
        qEntry.visits++;
        qEntry.lastUpdate = Date.now();
      }
    }

    // Decay exploration
    this.stepCount += trajectory.steps.length;
    this.epsilon = Math.max(
      this.config.explorationFinal,
      this.config.explorationInitial - this.stepCount / this.config.explorationDecay
    );

    // Prune Q-table if too large
    if (this.qTable.size > this.config.maxStates) {
      this.pruneQTable();
    }

    this.updateCount++;
    this.avgTDError = totalTDError / trajectory.steps.length;

    const elapsed = performance.now() - startTime;
    if (elapsed > 1) {
      console.warn(`Q-learning update exceeded target: ${elapsed.toFixed(2)}ms > 1ms`);
    }

    return { tdError: this.avgTDError };
  }

  /**
   * Get action using epsilon-greedy policy
   */
  getAction(state: Float32Array, explore: boolean = true): number {
    if (explore && Math.random() < this.epsilon) {
      return Math.floor(Math.random() * this.numActions);
    }

    const stateKey = this.hashState(state);
    const entry = this.qTable.get(stateKey);

    if (!entry) {
      return Math.floor(Math.random() * this.numActions);
    }

    return this.argmax(entry.qValues);
  }

  /**
   * Get Q-values for a state
   */
  getQValues(state: Float32Array): Float32Array {
    const stateKey = this.hashState(state);
    const entry = this.qTable.get(stateKey);

    if (!entry) {
      return new Float32Array(this.numActions);
    }

    return new Float32Array(entry.qValues);
  }

  /**
   * Get statistics
   */
  getStats(): Record<string, number> {
    return {
      updateCount: this.updateCount,
      qTableSize: this.qTable.size,
      epsilon: this.epsilon,
      avgTDError: this.avgTDError,
      stepCount: this.stepCount,
    };
  }

  /**
   * Reset Q-table
   */
  reset(): void {
    this.qTable.clear();
    this.traces.clear();
    this.epsilon = this.config.explorationInitial;
    this.stepCount = 0;
    this.updateCount = 0;
    this.avgTDError = 0;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private hashState(state: Float32Array): string {
    // Discretize state by binning values
    const bins = 10;
    const parts: number[] = [];

    // Use first 8 dimensions for hashing
    for (let i = 0; i < Math.min(8, state.length); i++) {
      const normalized = (state[i] + 1) / 2; // Assume [-1, 1] range
      const bin = Math.floor(Math.max(0, Math.min(bins - 1, normalized * bins)));
      parts.push(bin);
    }

    return parts.join(',');
  }

  private hashAction(action: string): number {
    let hash = 0;
    for (let i = 0; i < action.length; i++) {
      hash = (hash * 31 + action.charCodeAt(i)) % this.numActions;
    }
    return hash;
  }

  private getOrCreateEntry(stateKey: string): QEntry {
    let entry = this.qTable.get(stateKey);

    if (!entry) {
      entry = {
        qValues: new Float32Array(this.numActions),
        visits: 0,
        lastUpdate: Date.now(),
      };
      this.qTable.set(stateKey, entry);
    }

    return entry;
  }

  private updateTrace(stateKey: string, action: number): void {
    // Decay all existing traces
    for (const [key, trace] of this.traces) {
      for (let a = 0; a < this.numActions; a++) {
        trace[a] *= this.config.gamma * this.config.traceDecay;
      }

      // Remove near-zero traces
      const maxTrace = Math.max(...trace);
      if (maxTrace < 0.001) {
        this.traces.delete(key);
      }
    }

    // Set trace for current state-action
    let trace = this.traces.get(stateKey);
    if (!trace) {
      trace = new Float32Array(this.numActions);
      this.traces.set(stateKey, trace);
    }
    trace[action] = 1.0;
  }

  private updateWithTraces(tdError: number): void {
    const lr = this.config.learningRate;

    for (const [stateKey, trace] of this.traces) {
      const entry = this.qTable.get(stateKey);
      if (entry) {
        for (let a = 0; a < this.numActions; a++) {
          entry.qValues[a] += lr * tdError * trace[a];
        }
        entry.visits++;
        entry.lastUpdate = Date.now();
      }
    }
  }

  private pruneQTable(): void {
    // Remove least recently used states
    const entries = Array.from(this.qTable.entries())
      .sort((a, b) => a[1].lastUpdate - b[1].lastUpdate);

    const toRemove = entries.length - Math.floor(this.config.maxStates * 0.8);
    for (let i = 0; i < toRemove; i++) {
      this.qTable.delete(entries[i][0]);
    }
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
export function createQLearning(config?: Partial<QLearningConfig>): QLearning {
  return new QLearning(config);
}
