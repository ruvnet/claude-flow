/**
 * Mixture of Experts (MoE) Router for Dynamic Agent Routing
 *
 * Features:
 * - 8 expert slots for specialized agent types
 * - Gating network for soft expert selection (top-k)
 * - Online weight updates via reward signals
 * - Load balancing with auxiliary loss
 * - Weight persistence to .swarm/moe-weights.json
 *
 * Architecture:
 * - Input: 384-dim task embedding (from ONNX)
 * - Hidden: 128-dim layer with ReLU
 * - Output: 8-dim softmax weights
 *
 * @module moe-router
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

// ============================================================================
// Types & Constants
// ============================================================================

/**
 * Expert type definitions (8 experts)
 */
export type ExpertType =
  | 'coder'
  | 'tester'
  | 'reviewer'
  | 'architect'
  | 'security'
  | 'performance'
  | 'researcher'
  | 'coordinator';

/**
 * Expert names in order (index corresponds to expert slot)
 */
export const EXPERT_NAMES: ExpertType[] = [
  'coder',
  'tester',
  'reviewer',
  'architect',
  'security',
  'performance',
  'researcher',
  'coordinator',
];

/**
 * Number of experts (fixed at 8)
 */
export const NUM_EXPERTS = 8;

/**
 * Input dimension (384 from ONNX MiniLM-L6-v2)
 */
export const INPUT_DIM = 384;

/**
 * Hidden layer dimension
 */
export const HIDDEN_DIM = 128;

/**
 * MoE Router configuration
 */
export interface MoERouterConfig {
  /** Top-k experts to route to (default: 2) */
  topK: number;
  /** Learning rate for online updates (default: 0.01) */
  learningRate: number;
  /** Temperature for softmax (default: 1.0) */
  temperature: number;
  /** Load balancing coefficient (default: 0.01) */
  loadBalanceCoef: number;
  /** Path for weight persistence (default: '.swarm/moe-weights.json') */
  weightsPath: string;
  /** Auto-save interval in updates (default: 50) */
  autoSaveInterval: number;
  /** Enable noise for exploration (default: true) */
  enableNoise: boolean;
  /** Noise standard deviation (default: 0.1) */
  noiseStd: number;
}

/**
 * Expert routing result
 */
export interface RoutingResult {
  /** Selected experts with weights */
  experts: Array<{
    name: ExpertType;
    index: number;
    weight: number;
    score: number;
  }>;
  /** Raw gating scores (all experts) */
  allScores: number[];
  /** Load balance loss */
  loadBalanceLoss: number;
  /** Entropy of routing distribution */
  entropy: number;
}

/**
 * Expert utilization statistics
 */
export interface LoadBalanceStats {
  /** Per-expert utilization (0-1) */
  utilization: Record<ExpertType, number>;
  /** Total routing count */
  totalRoutings: number;
  /** Per-expert routing count */
  routingCounts: Record<ExpertType, number>;
  /** Gini coefficient of load (0 = perfect balance, 1 = all to one) */
  giniCoefficient: number;
  /** Coefficient of variation */
  coefficientOfVariation: number;
}

/**
 * Persisted model structure
 */
interface PersistedModel {
  version: string;
  config: Partial<MoERouterConfig>;
  weights: {
    W1: number[][];
    b1: number[];
    W2: number[][];
    b2: number[];
  };
  stats: {
    updateCount: number;
    routingCounts: number[];
    avgReward: number;
  };
  metadata: {
    savedAt: string;
    expertNames: string[];
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: MoERouterConfig = {
  topK: 2,
  learningRate: 0.01,
  temperature: 1.0,
  loadBalanceCoef: 0.01,
  weightsPath: '.swarm/moe-weights.json',
  autoSaveInterval: 50,
  enableNoise: true,
  noiseStd: 0.1,
};

// ============================================================================
// Matrix Operations
// ============================================================================

/**
 * Initialize weights using Xavier/Glorot initialization
 */
function xavierInit(fanIn: number, fanOut: number): Float32Array {
  const std = Math.sqrt(2.0 / (fanIn + fanOut));
  const weights = new Float32Array(fanIn * fanOut);
  for (let i = 0; i < weights.length; i++) {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-8)) * Math.cos(2 * Math.PI * u2);
    weights[i] = z * std;
  }
  return weights;
}

/**
 * Matrix-vector multiplication: y = Wx
 * W is stored row-major: [rows * cols]
 */
function matmul(
  W: Float32Array,
  x: Float32Array,
  rows: number,
  cols: number,
  out: Float32Array
): void {
  for (let i = 0; i < rows; i++) {
    let sum = 0;
    const rowOffset = i * cols;
    // 4x loop unrolling for SIMD-friendly access
    let j = 0;
    for (; j + 3 < cols; j += 4) {
      sum +=
        W[rowOffset + j] * x[j] +
        W[rowOffset + j + 1] * x[j + 1] +
        W[rowOffset + j + 2] * x[j + 2] +
        W[rowOffset + j + 3] * x[j + 3];
    }
    // Handle remainder
    for (; j < cols; j++) {
      sum += W[rowOffset + j] * x[j];
    }
    out[i] = sum;
  }
}

/**
 * Vector addition: y = x + b
 */
function addBias(x: Float32Array, b: Float32Array, out: Float32Array): void {
  for (let i = 0; i < x.length; i++) {
    out[i] = x[i] + b[i];
  }
}

/**
 * ReLU activation: y = max(0, x)
 */
function relu(x: Float32Array, out: Float32Array): void {
  for (let i = 0; i < x.length; i++) {
    out[i] = x[i] > 0 ? x[i] : 0;
  }
}

/**
 * Softmax with temperature: y_i = exp(x_i/T) / sum(exp(x_j/T))
 */
function softmax(x: Float32Array, temperature: number, out: Float32Array): void {
  // Find max for numerical stability
  let maxVal = x[0];
  for (let i = 1; i < x.length; i++) {
    if (x[i] > maxVal) maxVal = x[i];
  }

  // Compute exp and sum
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    out[i] = Math.exp((x[i] - maxVal) / temperature);
    sum += out[i];
  }

  // Normalize
  const invSum = 1.0 / (sum + 1e-8);
  for (let i = 0; i < x.length; i++) {
    out[i] *= invSum;
  }
}

/**
 * Compute entropy of distribution: H = -sum(p * log(p))
 */
function entropy(p: Float32Array): number {
  let h = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] > 1e-8) {
      h -= p[i] * Math.log(p[i]);
    }
  }
  return h;
}

/**
 * Add Gaussian noise for exploration
 */
function addNoise(x: Float32Array, std: number, out: Float32Array): void {
  for (let i = 0; i < x.length; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-8)) * Math.cos(2 * Math.PI * u2);
    out[i] = x[i] + z * std;
  }
}

// ============================================================================
// MoE Router Implementation
// ============================================================================

/**
 * Mixture of Experts Router
 *
 * Implements a two-layer gating network:
 * - Layer 1: Linear(384, 128) + ReLU
 * - Layer 2: Linear(128, 8) + Softmax
 *
 * Uses top-k expert selection with load balancing.
 */
export class MoERouter {
  private config: MoERouterConfig;

  // Network weights (pre-allocated Float32Arrays)
  private W1: Float32Array; // [HIDDEN_DIM x INPUT_DIM]
  private b1: Float32Array; // [HIDDEN_DIM]
  private W2: Float32Array; // [NUM_EXPERTS x HIDDEN_DIM]
  private b2: Float32Array; // [NUM_EXPERTS]

  // Intermediate buffers (pre-allocated, no GC pressure)
  private hidden: Float32Array; // [HIDDEN_DIM]
  private hiddenWithBias: Float32Array; // [HIDDEN_DIM]
  private hiddenActivated: Float32Array; // [HIDDEN_DIM]
  private logits: Float32Array; // [NUM_EXPERTS]
  private logitsWithBias: Float32Array; // [NUM_EXPERTS]
  private noisyLogits: Float32Array; // [NUM_EXPERTS]
  private probs: Float32Array; // [NUM_EXPERTS]

  // Gradient buffers for online learning
  private gradW2: Float32Array; // [NUM_EXPERTS x HIDDEN_DIM]
  private gradb2: Float32Array; // [NUM_EXPERTS]
  private gradW1: Float32Array; // [HIDDEN_DIM x INPUT_DIM]
  private gradb1: Float32Array; // [HIDDEN_DIM]
  private gradHidden: Float32Array; // [HIDDEN_DIM]

  // Statistics
  private routingCounts: Float32Array; // [NUM_EXPERTS]
  private totalRoutings = 0;
  private updateCount = 0;
  private avgReward = 0;

  // Cache for last input (for gradient computation)
  private lastInput: Float32Array | null = null;
  private lastHiddenActivated: Float32Array | null = null;
  private lastProbs: Float32Array | null = null;
  private lastSelectedExperts: number[] = [];

  constructor(config: Partial<MoERouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize weights
    this.W1 = xavierInit(INPUT_DIM, HIDDEN_DIM);
    this.b1 = new Float32Array(HIDDEN_DIM);
    this.W2 = xavierInit(HIDDEN_DIM, NUM_EXPERTS);
    this.b2 = new Float32Array(NUM_EXPERTS);

    // Pre-allocate intermediate buffers
    this.hidden = new Float32Array(HIDDEN_DIM);
    this.hiddenWithBias = new Float32Array(HIDDEN_DIM);
    this.hiddenActivated = new Float32Array(HIDDEN_DIM);
    this.logits = new Float32Array(NUM_EXPERTS);
    this.logitsWithBias = new Float32Array(NUM_EXPERTS);
    this.noisyLogits = new Float32Array(NUM_EXPERTS);
    this.probs = new Float32Array(NUM_EXPERTS);

    // Pre-allocate gradient buffers
    this.gradW2 = new Float32Array(NUM_EXPERTS * HIDDEN_DIM);
    this.gradb2 = new Float32Array(NUM_EXPERTS);
    this.gradW1 = new Float32Array(HIDDEN_DIM * INPUT_DIM);
    this.gradb1 = new Float32Array(HIDDEN_DIM);
    this.gradHidden = new Float32Array(HIDDEN_DIM);

    // Statistics
    this.routingCounts = new Float32Array(NUM_EXPERTS);
  }

  /**
   * Initialize router, loading persisted weights if available
   */
  async initialize(): Promise<void> {
    await this.loadWeights();
  }

  /**
   * Route task to top-k experts based on embedding
   *
   * @param taskEmbedding - 384-dim task embedding from ONNX
   * @returns Routing result with selected experts and weights
   */
  route(taskEmbedding: Float32Array | number[]): RoutingResult {
    // Convert to Float32Array if needed
    const input =
      taskEmbedding instanceof Float32Array
        ? taskEmbedding
        : new Float32Array(taskEmbedding);

    // Validate input dimension
    if (input.length !== INPUT_DIM) {
      throw new Error(
        `Expected embedding dimension ${INPUT_DIM}, got ${input.length}`
      );
    }

    // Forward pass through gating network
    // Layer 1: Linear + ReLU
    matmul(this.W1, input, HIDDEN_DIM, INPUT_DIM, this.hidden);
    addBias(this.hidden, this.b1, this.hiddenWithBias);
    relu(this.hiddenWithBias, this.hiddenActivated);

    // Layer 2: Linear
    matmul(this.W2, this.hiddenActivated, NUM_EXPERTS, HIDDEN_DIM, this.logits);
    addBias(this.logits, this.b2, this.logitsWithBias);

    // Add noise for exploration if enabled
    if (this.config.enableNoise) {
      addNoise(this.logitsWithBias, this.config.noiseStd, this.noisyLogits);
    } else {
      this.noisyLogits.set(this.logitsWithBias);
    }

    // Softmax to get probabilities
    softmax(this.noisyLogits, this.config.temperature, this.probs);

    // Select top-k experts
    const expertIndices = this.selectTopK(this.probs, this.config.topK);

    // Compute load balance loss
    const loadBalanceLoss = this.computeLoadBalanceLoss();

    // Compute entropy
    const routingEntropy = entropy(this.probs);

    // Update statistics
    for (const idx of expertIndices) {
      this.routingCounts[idx]++;
    }
    this.totalRoutings++;

    // Cache for gradient computation
    this.lastInput = new Float32Array(input);
    this.lastHiddenActivated = new Float32Array(this.hiddenActivated);
    this.lastProbs = new Float32Array(this.probs);
    this.lastSelectedExperts = expertIndices;

    // Build result
    const totalWeight = expertIndices.reduce((sum, idx) => sum + this.probs[idx], 0);
    const experts = expertIndices.map((idx) => ({
      name: EXPERT_NAMES[idx],
      index: idx,
      weight: this.probs[idx] / (totalWeight + 1e-8), // Normalize weights
      score: this.probs[idx],
    }));

    return {
      experts,
      allScores: Array.from(this.probs),
      loadBalanceLoss,
      entropy: routingEntropy,
    };
  }

  /**
   * Update expert weights based on reward signal
   *
   * Uses REINFORCE-style gradient update:
   * gradient = reward * d_log_prob / d_weights
   *
   * @param expert - Expert that received the reward
   * @param reward - Reward signal (-1 to 1, positive = good)
   */
  updateExpertWeights(expert: ExpertType | number, reward: number): void {
    const expertIdx = typeof expert === 'number' ? expert : EXPERT_NAMES.indexOf(expert);

    if (expertIdx < 0 || expertIdx >= NUM_EXPERTS) {
      console.warn(`[MoE] Invalid expert: ${expert}`);
      return;
    }

    if (!this.lastInput || !this.lastHiddenActivated || !this.lastProbs) {
      console.warn('[MoE] No cached forward pass for gradient computation');
      return;
    }

    // Clamp reward to [-1, 1]
    const clampedReward = Math.max(-1, Math.min(1, reward));

    // Compute gradients using REINFORCE
    // For softmax: d_log_p_i / d_logit_j = delta_ij - p_j
    // gradient = reward * (1 - p_expert) for selected expert
    // gradient = reward * (-p_j) for other experts

    // Clear gradient buffers
    this.gradW2.fill(0);
    this.gradb2.fill(0);
    this.gradW1.fill(0);
    this.gradb1.fill(0);
    this.gradHidden.fill(0);

    // Gradient w.r.t. logits (before softmax)
    for (let i = 0; i < NUM_EXPERTS; i++) {
      if (i === expertIdx) {
        this.gradb2[i] = clampedReward * (1 - this.lastProbs[i]);
      } else {
        this.gradb2[i] = clampedReward * (-this.lastProbs[i]);
      }
    }

    // Gradient w.r.t. W2: outer product of gradb2 and hiddenActivated
    for (let i = 0; i < NUM_EXPERTS; i++) {
      const rowOffset = i * HIDDEN_DIM;
      for (let j = 0; j < HIDDEN_DIM; j++) {
        this.gradW2[rowOffset + j] = this.gradb2[i] * this.lastHiddenActivated[j];
      }
    }

    // Backprop through W2 to get gradient w.r.t. hidden
    for (let j = 0; j < HIDDEN_DIM; j++) {
      let sum = 0;
      for (let i = 0; i < NUM_EXPERTS; i++) {
        sum += this.gradb2[i] * this.W2[i * HIDDEN_DIM + j];
      }
      this.gradHidden[j] = sum;
    }

    // Backprop through ReLU: gradient is 0 where activation was 0
    for (let j = 0; j < HIDDEN_DIM; j++) {
      if (this.lastHiddenActivated[j] <= 0) {
        this.gradHidden[j] = 0;
      }
    }

    // Gradient w.r.t. b1
    this.gradb1.set(this.gradHidden);

    // Gradient w.r.t. W1: outer product of gradHidden and input
    for (let i = 0; i < HIDDEN_DIM; i++) {
      const rowOffset = i * INPUT_DIM;
      for (let j = 0; j < INPUT_DIM; j++) {
        this.gradW1[rowOffset + j] = this.gradHidden[i] * this.lastInput[j];
      }
    }

    // Apply gradients with learning rate
    const lr = this.config.learningRate;
    for (let i = 0; i < this.W2.length; i++) {
      this.W2[i] += lr * this.gradW2[i];
    }
    for (let i = 0; i < this.b2.length; i++) {
      this.b2[i] += lr * this.gradb2[i];
    }
    for (let i = 0; i < this.W1.length; i++) {
      this.W1[i] += lr * this.gradW1[i];
    }
    for (let i = 0; i < this.b1.length; i++) {
      this.b1[i] += lr * this.gradb1[i];
    }

    // Update statistics
    this.updateCount++;
    this.avgReward = (this.avgReward * (this.updateCount - 1) + clampedReward) / this.updateCount;

    // Auto-save
    if (
      this.config.autoSaveInterval > 0 &&
      this.updateCount % this.config.autoSaveInterval === 0
    ) {
      this.saveWeights().catch(() => {}); // Fire and forget
    }
  }

  /**
   * Get load balance statistics across all experts
   */
  getLoadBalance(): LoadBalanceStats {
    const counts: Record<ExpertType, number> = {} as Record<ExpertType, number>;
    const utilization: Record<ExpertType, number> = {} as Record<ExpertType, number>;

    const total = this.totalRoutings || 1;
    const idealUtilization = 1 / NUM_EXPERTS;

    for (let i = 0; i < NUM_EXPERTS; i++) {
      const name = EXPERT_NAMES[i];
      counts[name] = this.routingCounts[i];
      utilization[name] = this.routingCounts[i] / total;
    }

    // Compute Gini coefficient
    const gini = this.computeGiniCoefficient();

    // Compute coefficient of variation
    const mean = total / NUM_EXPERTS;
    let variance = 0;
    for (let i = 0; i < NUM_EXPERTS; i++) {
      variance += Math.pow(this.routingCounts[i] - mean, 2);
    }
    variance /= NUM_EXPERTS;
    const cv = Math.sqrt(variance) / (mean + 1e-8);

    return {
      utilization,
      totalRoutings: this.totalRoutings,
      routingCounts: counts,
      giniCoefficient: gini,
      coefficientOfVariation: cv,
    };
  }

  /**
   * Get router statistics
   */
  getStats(): Record<string, number | string> {
    return {
      totalRoutings: this.totalRoutings,
      updateCount: this.updateCount,
      avgReward: this.avgReward,
      topK: this.config.topK,
      temperature: this.config.temperature,
      learningRate: this.config.learningRate,
      giniCoefficient: this.computeGiniCoefficient(),
    };
  }

  /**
   * Reset all statistics and routing counts
   */
  resetStats(): void {
    this.routingCounts.fill(0);
    this.totalRoutings = 0;
    this.updateCount = 0;
    this.avgReward = 0;
  }

  /**
   * Load weights from persistence file
   */
  async loadWeights(path?: string): Promise<boolean> {
    const weightsPath = path || this.config.weightsPath;
    try {
      if (!existsSync(weightsPath)) {
        return false;
      }

      const data = readFileSync(weightsPath, 'utf-8');
      const model: PersistedModel = JSON.parse(data);

      // Validate version
      if (!model.version || !model.version.startsWith('1.')) {
        console.warn(`[MoE] Incompatible model version: ${model.version}`);
        return false;
      }

      // Load weights
      this.W1 = new Float32Array(model.weights.W1.flat());
      this.b1 = new Float32Array(model.weights.b1);
      this.W2 = new Float32Array(model.weights.W2.flat());
      this.b2 = new Float32Array(model.weights.b2);

      // Load stats
      this.updateCount = model.stats.updateCount || 0;
      this.avgReward = model.stats.avgReward || 0;
      this.routingCounts = new Float32Array(
        model.stats.routingCounts || new Array(NUM_EXPERTS).fill(0)
      );
      this.totalRoutings = this.routingCounts.reduce((a, b) => a + b, 0);

      return true;
    } catch (err) {
      console.warn(`[MoE] Failed to load weights: ${err}`);
      return false;
    }
  }

  /**
   * Save weights to persistence file
   */
  async saveWeights(path?: string): Promise<boolean> {
    const weightsPath = path || this.config.weightsPath;
    try {
      // Ensure directory exists
      const dir = dirname(weightsPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Convert Float32Arrays to nested arrays for JSON
      const W1_2d: number[][] = [];
      for (let i = 0; i < HIDDEN_DIM; i++) {
        W1_2d.push(Array.from(this.W1.slice(i * INPUT_DIM, (i + 1) * INPUT_DIM)));
      }

      const W2_2d: number[][] = [];
      for (let i = 0; i < NUM_EXPERTS; i++) {
        W2_2d.push(Array.from(this.W2.slice(i * HIDDEN_DIM, (i + 1) * HIDDEN_DIM)));
      }

      const model: PersistedModel = {
        version: '1.0.0',
        config: {
          topK: this.config.topK,
          temperature: this.config.temperature,
          learningRate: this.config.learningRate,
          loadBalanceCoef: this.config.loadBalanceCoef,
        },
        weights: {
          W1: W1_2d,
          b1: Array.from(this.b1),
          W2: W2_2d,
          b2: Array.from(this.b2),
        },
        stats: {
          updateCount: this.updateCount,
          routingCounts: Array.from(this.routingCounts),
          avgReward: this.avgReward,
        },
        metadata: {
          savedAt: new Date().toISOString(),
          expertNames: [...EXPERT_NAMES],
        },
      };

      writeFileSync(weightsPath, JSON.stringify(model, null, 2));
      return true;
    } catch (err) {
      console.warn(`[MoE] Failed to save weights: ${err}`);
      return false;
    }
  }

  /**
   * Reset weights to random initialization
   */
  resetWeights(): void {
    this.W1 = xavierInit(INPUT_DIM, HIDDEN_DIM);
    this.b1.fill(0);
    this.W2 = xavierInit(HIDDEN_DIM, NUM_EXPERTS);
    this.b2.fill(0);
    this.resetStats();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Select top-k indices from probabilities
   */
  private selectTopK(probs: Float32Array, k: number): number[] {
    // Create index-value pairs and sort by value descending
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < probs.length; i++) {
      pairs.push([i, probs[i]]);
    }
    pairs.sort((a, b) => b[1] - a[1]);

    // Return top-k indices
    return pairs.slice(0, k).map((p) => p[0]);
  }

  /**
   * Compute load balance loss for regularization
   *
   * Uses auxiliary loss from Switch Transformer:
   * L_balance = N * sum(f_i * P_i)
   * where f_i = fraction of tokens routed to expert i
   *       P_i = average routing probability to expert i
   */
  private computeLoadBalanceLoss(): number {
    if (this.totalRoutings === 0) return 0;

    let loss = 0;
    for (let i = 0; i < NUM_EXPERTS; i++) {
      const fraction = this.routingCounts[i] / this.totalRoutings;
      const avgProb = this.probs[i]; // Current routing prob
      loss += fraction * avgProb;
    }

    return NUM_EXPERTS * loss * this.config.loadBalanceCoef;
  }

  /**
   * Compute Gini coefficient for load distribution
   */
  private computeGiniCoefficient(): number {
    if (this.totalRoutings === 0) return 0;

    // Sort counts
    const sorted = Array.from(this.routingCounts).sort((a, b) => a - b);
    const n = sorted.length;
    const mean = this.totalRoutings / n;

    // Compute Gini using the formula: G = (2 * sum(i * x_i) - (n+1) * sum(x_i)) / (n * sum(x_i))
    let weightedSum = 0;
    for (let i = 0; i < n; i++) {
      weightedSum += (i + 1) * sorted[i];
    }

    const gini =
      (2 * weightedSum - (n + 1) * this.totalRoutings) /
      (n * this.totalRoutings + 1e-8);

    return Math.max(0, gini);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let moeRouterInstance: MoERouter | null = null;

/**
 * Get singleton MoE router instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns MoE router instance
 */
export function getMoERouter(config?: Partial<MoERouterConfig>): MoERouter {
  if (!moeRouterInstance) {
    moeRouterInstance = new MoERouter(config);
    // Initialize in background (load weights)
    moeRouterInstance.initialize().catch((err) => {
      console.warn('[MoE] Failed to initialize router:', err);
    });
  }
  return moeRouterInstance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetMoERouter(): void {
  moeRouterInstance = null;
}

/**
 * Factory function to create new router
 */
export function createMoERouter(config?: Partial<MoERouterConfig>): MoERouter {
  return new MoERouter(config);
}
