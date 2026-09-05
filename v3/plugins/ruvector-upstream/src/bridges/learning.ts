/**
 * Reinforcement Learning Bridge
 *
 * Bridge to ruvector-learning-wasm for RL algorithms including
 * Q-Learning, SARSA, Actor-Critic, PPO, DQN, and Decision Transformer.
 */

import type { WasmBridge, WasmModuleStatus, LearningConfig } from '../types.js';
import { LearningConfigSchema } from '../types.js';

/**
 * Learning experience tuple
 */
export interface Experience {
  state: Float32Array;
  action: number;
  reward: number;
  nextState: Float32Array;
  done: boolean;
}

/**
 * Learning trajectory
 */
export interface Trajectory {
  experiences: Experience[];
  totalReward: number;
  metadata?: Record<string, unknown>;
}

/**
 * Learning WASM module interface
 */
interface LearningModule {
  // Core learning
  train(trajectories: Trajectory[], config: LearningConfig): number;
  predict(state: Float32Array): { action: number; qValues: Float32Array };
  evaluate(state: Float32Array): number;

  // Policy methods
  getPolicy(): Float32Array;
  setPolicy(weights: Float32Array): void;

  // Experience replay
  addExperience(experience: Experience): void;
  sampleBatch(batchSize: number): Experience[];

  // Decision transformer specific
  sequencePredict(states: Float32Array[], actions: number[], rewards: number[], targetReturn: number): number;
}

/**
 * Reinforcement Learning Bridge implementation
 */
export class LearningBridge implements WasmBridge<LearningModule> {
  readonly name = 'ruvector-learning-wasm';
  readonly version = '0.1.0';

  private _status: WasmModuleStatus = 'unloaded';
  private _module: LearningModule | null = null;
  private config: LearningConfig;

  constructor(config?: Partial<LearningConfig>) {
    this.config = LearningConfigSchema.parse(config ?? {});
  }

  get status(): WasmModuleStatus {
    return this._status;
  }

  async init(): Promise<void> {
    if (this._status === 'ready') return;
    if (this._status === 'loading') return;

    this._status = 'loading';

    try {
      const wasmModule = await import('@ruvector/learning-wasm' as string).catch(() => null);

      if (wasmModule) {
        this._module = wasmModule as unknown as LearningModule;
      } else {
        this._module = this.createMockModule();
      }

      this._status = 'ready';
    } catch (error) {
      this._status = 'error';
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this._module = null;
    this._status = 'unloaded';
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  getModule(): LearningModule | null {
    return this._module;
  }

  /**
   * Train on trajectories
   */
  train(trajectories: Trajectory[], config?: Partial<LearningConfig>): number {
    if (!this._module) throw new Error('Learning module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.train(trajectories, mergedConfig);
  }

  /**
   * Predict action for state
   */
  predict(state: Float32Array): { action: number; qValues: Float32Array } {
    if (!this._module) throw new Error('Learning module not initialized');
    return this._module.predict(state);
  }

  /**
   * Evaluate state value
   */
  evaluate(state: Float32Array): number {
    if (!this._module) throw new Error('Learning module not initialized');
    return this._module.evaluate(state);
  }

  /**
   * Add experience to replay buffer
   */
  addExperience(experience: Experience): void {
    if (!this._module) throw new Error('Learning module not initialized');
    this._module.addExperience(experience);
  }

  /**
   * Decision Transformer sequence prediction
   */
  sequencePredict(
    states: Float32Array[],
    actions: number[],
    rewards: number[],
    targetReturn: number
  ): number {
    if (!this._module) throw new Error('Learning module not initialized');
    return this._module.sequencePredict(states, actions, rewards, targetReturn);
  }

  /**
   * Create mock module for development
   */
  private createMockModule(): LearningModule {
    const replayBuffer: Experience[] = [];
    let policyWeights = new Float32Array(100);

    return {
      train(trajectories: Trajectory[], config: LearningConfig): number {
        let totalLoss = 0;

        for (const trajectory of trajectories) {
          for (const exp of trajectory.experiences) {
            // Simple TD update approximation
            const tdError = exp.reward + config.gamma * 0.5 - 0.3;
            totalLoss += Math.abs(tdError);
          }
        }

        return totalLoss / Math.max(1, trajectories.length);
      },

      predict(state: Float32Array): { action: number; qValues: Float32Array } {
        const numActions = 4;
        const qValues = new Float32Array(numActions);

        for (let i = 0; i < numActions; i++) {
          qValues[i] = state.reduce((s, v, j) => s + v * policyWeights[(i * 10 + j) % 100], 0);
        }

        let maxIdx = 0;
        for (let i = 1; i < numActions; i++) {
          if (qValues[i] > qValues[maxIdx]) maxIdx = i;
        }

        return { action: maxIdx, qValues };
      },

      evaluate(state: Float32Array): number {
        return state.reduce((s, v) => s + v, 0) / state.length;
      },

      getPolicy(): Float32Array {
        return new Float32Array(policyWeights);
      },

      setPolicy(weights: Float32Array): void {
        policyWeights = new Float32Array(weights);
      },

      addExperience(experience: Experience): void {
        replayBuffer.push(experience);
        if (replayBuffer.length > 10000) {
          replayBuffer.shift();
        }
      },

      sampleBatch(batchSize: number): Experience[] {
        const batch: Experience[] = [];
        for (let i = 0; i < Math.min(batchSize, replayBuffer.length); i++) {
          const idx = Math.floor(Math.random() * replayBuffer.length);
          batch.push(replayBuffer[idx]);
        }
        return batch;
      },

      sequencePredict(
        states: Float32Array[],
        actions: number[],
        rewards: number[],
        targetReturn: number
      ): number {
        // Decision Transformer: predict next action based on sequence and target return
        const avgReward = rewards.reduce((s, r) => s + r, 0) / rewards.length;
        const returnDiff = targetReturn - avgReward;
        return returnDiff > 0 ? 1 : 0; // Simplified
      },
    };
  }
}

/**
 * Create a new learning bridge
 */
export function createLearningBridge(config?: Partial<LearningConfig>): LearningBridge {
  return new LearningBridge(config);
}
