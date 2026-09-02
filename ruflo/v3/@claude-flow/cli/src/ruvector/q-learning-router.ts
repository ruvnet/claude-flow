/**
 * Q-Learning Router for Task Routing
 *
 * Uses reinforcement learning to optimize task routing decisions
 * based on historical performance and context.
 *
 * Features:
 * - Caching for repeated task patterns (LRU cache)
 * - Optimized state space with feature hashing
 * - Epsilon decay with exponential annealing
 * - Experience replay buffer for stable learning
 * - Model persistence to .swarm/q-learning-model.json
 *
 * @module q-learning-router
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Q-Learning Router Configuration
 */
export interface QLearningRouterConfig {
  /** Learning rate (default: 0.1) */
  learningRate: number;
  /** Discount factor (default: 0.99) */
  gamma: number;
  /** Initial exploration rate (default: 1.0) */
  explorationInitial: number;
  /** Final exploration rate (default: 0.01) */
  explorationFinal: number;
  /** Exploration decay steps (default: 10000) */
  explorationDecay: number;
  /** Exploration decay type (default: 'exponential') */
  explorationDecayType: 'linear' | 'exponential' | 'cosine';
  /** Maximum states in Q-table (default: 10000) */
  maxStates: number;
  /** Number of actions/routes (default: 8) */
  numActions: number;
  /** Experience replay buffer size (default: 1000) */
  replayBufferSize: number;
  /** Mini-batch size for replay (default: 32) */
  replayBatchSize: number;
  /** Enable experience replay (default: true) */
  enableReplay: boolean;
  /** Route cache size (default: 256) */
  cacheSize: number;
  /** Cache TTL in milliseconds (default: 300000 = 5 minutes) */
  cacheTTL: number;
  /** Model persistence path (default: '.swarm/q-learning-model.json') */
  modelPath: string;
  /** Auto-save interval in updates (default: 100) */
  autoSaveInterval: number;
  /** State space dimensionality for feature hashing (default: 64) */
  stateSpaceDim: number;
}

/**
 * Route decision result
 */
export interface RouteDecision {
  /** Selected route/action */
  route: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Q-values for all routes */
  qValues: number[];
  /** Was exploration used */
  explored: boolean;
  /** Route alternatives */
  alternatives: Array<{ route: string; score: number }>;
}

/**
 * Q-table entry
 */
interface QEntry {
  qValues: Float32Array;
  visits: number;
  lastUpdate: number;
  /** Eligibility trace for TD(lambda) */
  eligibility?: Float32Array;
}

/**
 * Experience tuple for replay buffer
 */
interface Experience {
  stateKey: string;
  actionIdx: number;
  reward: number;
  nextStateKey: string | null;
  timestamp: number;
  priority: number;
}

/**
 * Cache entry for route decisions
 */
interface CacheEntry {
  decision: RouteDecision;
  timestamp: number;
  hits: number;
}

/**
 * Persisted model structure
 */
interface PersistedModel {
  version: string;
  config: Partial<QLearningRouterConfig>;
  qTable: Record<string, { qValues: number[]; visits: number }>;
  stats: {
    stepCount: number;
    updateCount: number;
    avgTDError: number;
    epsilon: number;
  };
  metadata: {
    savedAt: string;
    totalExperiences: number;
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: QLearningRouterConfig = {
  learningRate: 0.1,
  gamma: 0.99,
  explorationInitial: 1.0,
  explorationFinal: 0.01,
  explorationDecay: 10000,
  explorationDecayType: 'exponential',
  maxStates: 10000,
  numActions: 8,
  replayBufferSize: 1000,
  replayBatchSize: 32,
  enableReplay: true,
  cacheSize: 256,
  cacheTTL: 300000,
  modelPath: '.swarm/q-learning-model.json',
  autoSaveInterval: 100,
  stateSpaceDim: 64,
};

/**
 * Route names mapping
 */
const ROUTE_NAMES = [
  'coder',
  'tester',
  'reviewer',
  'architect',
  'researcher',
  'optimizer',
  'debugger',
  'documenter',
];

/**
 * Task feature keywords for state representation
 */
const FEATURE_KEYWORDS = [
  // Code-related
  'implement', 'code', 'write', 'create', 'build', 'develop',
  // Testing-related
  'test', 'spec', 'coverage', 'unit', 'integration', 'e2e',
  // Review-related
  'review', 'check', 'audit', 'analyze', 'inspect',
  // Architecture-related
  'architect', 'design', 'structure', 'pattern', 'system',
  // Research-related
  'research', 'investigate', 'explore', 'find', 'search',
  // Optimization-related
  'optimize', 'performance', 'speed', 'memory', 'improve',
  // Debug-related
  'debug', 'fix', 'bug', 'error', 'issue', 'problem',
  // Documentation-related
  'document', 'docs', 'readme', 'comment', 'explain',
];

/**
 * Q-Learning Router for intelligent task routing
 *
 * Optimized with:
 * - LRU cache for repeated task patterns
 * - Feature hashing for efficient state space
 * - Exponential epsilon decay
 * - Prioritized experience replay
 * - Model persistence
 */
export class QLearningRouter {
  private config: QLearningRouterConfig;
  private qTable: Map<string, QEntry> = new Map();
  private epsilon: number;
  private stepCount = 0;
  private updateCount = 0;
  private avgTDError = 0;
  private ruvectorEngine: unknown = null;
  private useNative = false;

  // Experience replay buffer (circular buffer)
  private replayBuffer: Experience[] = [];
  private replayBufferIdx = 0;
  private totalExperiences = 0;

  // LRU cache for route decisions
  private routeCache: Map<string, CacheEntry> = new Map();
  private cacheOrder: string[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;

  // Feature hash cache for state representation
  private featureHashCache: Map<string, Float32Array> = new Map();

  constructor(config: Partial<QLearningRouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.epsilon = this.config.explorationInitial;
  }

  /**
   * Initialize the router, attempting to load ruvector native module
   * and restore persisted model if available
   */
  async initialize(): Promise<void> {
    try {
      const ruvector = await import('@ruvector/core');
      this.ruvectorEngine = (ruvector as any).createQLearning?.(this.config);
      this.useNative = !!this.ruvectorEngine;
    } catch {
      // Fallback to JS implementation
      this.useNative = false;
    }

    // Try to load persisted model
    await this.loadModel();
  }

  /**
   * Load model from persistence file
   */
  async loadModel(path?: string): Promise<boolean> {
    const modelPath = path || this.config.modelPath;
    try {
      if (!existsSync(modelPath)) {
        return false;
      }
      const data = readFileSync(modelPath, 'utf-8');
      const model: PersistedModel = JSON.parse(data);

      // Validate version compatibility
      if (!model.version || !model.version.startsWith('1.')) {
        console.warn(`[Q-Learning] Incompatible model version: ${model.version}`);
        return false;
      }

      // Import Q-table
      this.import(model.qTable);

      // Restore stats
      this.stepCount = model.stats.stepCount || 0;
      this.updateCount = model.stats.updateCount || 0;
      this.avgTDError = model.stats.avgTDError || 0;
      this.epsilon = model.stats.epsilon || this.config.explorationInitial;
      this.totalExperiences = model.metadata?.totalExperiences || 0;

      return true;
    } catch (err) {
      console.warn(`[Q-Learning] Failed to load model: ${err}`);
      return false;
    }
  }

  /**
   * Save model to persistence file
   */
  async saveModel(path?: string): Promise<boolean> {
    const modelPath = path || this.config.modelPath;
    try {
      // Ensure directory exists
      const dir = dirname(modelPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const model: PersistedModel = {
        version: '1.0.0',
        config: {
          learningRate: this.config.learningRate,
          gamma: this.config.gamma,
          explorationDecayType: this.config.explorationDecayType,
          numActions: this.config.numActions,
        },
        qTable: this.export(),
        stats: {
          stepCount: this.stepCount,
          updateCount: this.updateCount,
          avgTDError: this.avgTDError,
          epsilon: this.epsilon,
        },
        metadata: {
          savedAt: new Date().toISOString(),
          totalExperiences: this.totalExperiences,
        },
      };

      writeFileSync(modelPath, JSON.stringify(model, null, 2));
      return true;
    } catch (err) {
      console.warn(`[Q-Learning] Failed to save model: ${err}`);
      return false;
    }
  }

  /**
   * Route a task based on its context
   * Uses LRU cache for repeated task patterns
   */
  route(taskContext: string, explore: boolean = true): RouteDecision {
    const stateKey = this.hashStateOptimized(taskContext);

    // Check cache first (only for exploitation, not exploration)
    if (!explore) {
      const cached = this.getCachedRoute(stateKey);
      if (cached) {
        this.cacheHits++;
        return cached;
      }
      this.cacheMisses++;
    }

    // Check if we should explore using decayed epsilon
    const shouldExplore = explore && Math.random() < this.epsilon;

    let actionIdx: number;
    let qValues: number[];

    if (shouldExplore) {
      // Random exploration
      actionIdx = Math.floor(Math.random() * this.config.numActions);
      qValues = this.getQValues(stateKey);
    } else {
      // Exploit - choose best action
      qValues = this.getQValues(stateKey);
      actionIdx = this.argmax(qValues);
    }

    // Calculate confidence from softmax of Q-values
    const confidence = this.softmaxConfidence(qValues, actionIdx);

    // Get alternatives sorted by Q-value
    const alternatives = ROUTE_NAMES
      .map((route, idx) => ({ route, score: qValues[idx] }))
      .sort((a, b) => b.score - a.score)
      .slice(1, 4); // Top 3 alternatives

    const decision: RouteDecision = {
      route: ROUTE_NAMES[actionIdx] || 'coder',
      confidence,
      qValues,
      explored: shouldExplore,
      alternatives,
    };

    // Cache the decision for exploitation queries
    if (!shouldExplore) {
      this.cacheRoute(stateKey, decision);
    }

    return decision;
  }

  /**
   * Get cached route decision (LRU cache)
   */
  private getCachedRoute(stateKey: string): RouteDecision | null {
    const entry = this.routeCache.get(stateKey);
    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.cacheTTL) {
      this.routeCache.delete(stateKey);
      this.cacheOrder = this.cacheOrder.filter(k => k !== stateKey);
      return null;
    }

    // Update LRU order
    this.cacheOrder = this.cacheOrder.filter(k => k !== stateKey);
    this.cacheOrder.push(stateKey);
    entry.hits++;

    return entry.decision;
  }

  /**
   * Cache a route decision (LRU eviction)
   */
  private cacheRoute(stateKey: string, decision: RouteDecision): void {
    // Evict oldest if cache is full
    while (this.routeCache.size >= this.config.cacheSize && this.cacheOrder.length > 0) {
      const oldest = this.cacheOrder.shift();
      if (oldest) {
        this.routeCache.delete(oldest);
      }
    }

    this.routeCache.set(stateKey, {
      decision,
      timestamp: Date.now(),
      hits: 0,
    });
    this.cacheOrder.push(stateKey);
  }

  /**
   * Invalidate cache (call after significant Q-table updates)
   */
  invalidateCache(): void {
    this.routeCache.clear();
    this.cacheOrder = [];
  }

  /**
   * Update Q-values based on feedback
   * Includes experience replay for stable learning
   */
  update(taskContext: string, action: string, reward: number, nextContext?: string): number {
    const stateKey = this.hashStateOptimized(taskContext);
    const actionIdx = ROUTE_NAMES.indexOf(action);

    if (actionIdx === -1) {
      return 0;
    }

    const nextStateKey = nextContext ? this.hashStateOptimized(nextContext) : null;

    // Store experience in replay buffer
    if (this.config.enableReplay) {
      const experience: Experience = {
        stateKey,
        actionIdx,
        reward,
        nextStateKey,
        timestamp: Date.now(),
        priority: Math.abs(reward) + 0.1, // Initial priority based on reward magnitude
      };
      this.addToReplayBuffer(experience);
    }

    // Perform direct update
    const tdError = this.updateQValue(stateKey, actionIdx, reward, nextStateKey);

    // Perform experience replay
    if (this.config.enableReplay && this.replayBuffer.length >= this.config.replayBatchSize) {
      this.experienceReplay();
    }

    // Decay exploration using configured strategy
    this.stepCount++;
    this.epsilon = this.calculateEpsilon();

    // Prune Q-table if needed
    if (this.qTable.size > this.config.maxStates) {
      this.pruneQTable();
    }

    this.updateCount++;
    this.avgTDError = (this.avgTDError * (this.updateCount - 1) + Math.abs(tdError)) / this.updateCount;

    // Auto-save periodically
    if (this.config.autoSaveInterval > 0 && this.updateCount % this.config.autoSaveInterval === 0) {
      this.saveModel().catch(() => {}); // Fire and forget
    }

    // Invalidate cache periodically to reflect Q-table changes
    if (this.updateCount % 50 === 0) {
      this.invalidateCache();
    }

    return tdError;
  }

  /**
   * Internal Q-value update
   */
  private updateQValue(stateKey: string, actionIdx: number, reward: number, nextStateKey: string | null): number {
    const entry = this.getOrCreateEntry(stateKey);
    const currentQ = entry.qValues[actionIdx];

    // Calculate target Q-value
    let targetQ: number;
    if (nextStateKey) {
      const nextQValues = this.getQValues(nextStateKey);
      const maxNextQ = Math.max(...nextQValues);
      targetQ = reward + this.config.gamma * maxNextQ;
    } else {
      // Terminal state
      targetQ = reward;
    }

    // TD error
    const tdError = targetQ - currentQ;

    // Update Q-value
    entry.qValues[actionIdx] += this.config.learningRate * tdError;
    entry.visits++;
    entry.lastUpdate = Date.now();

    return tdError;
  }

  /**
   * Add experience to circular replay buffer
   */
  private addToReplayBuffer(experience: Experience): void {
    if (this.replayBuffer.length < this.config.replayBufferSize) {
      this.replayBuffer.push(experience);
    } else {
      this.replayBuffer[this.replayBufferIdx] = experience;
    }
    this.replayBufferIdx = (this.replayBufferIdx + 1) % this.config.replayBufferSize;
    this.totalExperiences++;
  }

  /**
   * Perform prioritized experience replay
   * Samples mini-batch from buffer and updates Q-values
   */
  private experienceReplay(): void {
    if (this.replayBuffer.length < this.config.replayBatchSize) {
      return;
    }

    // Prioritized sampling based on TD error magnitude
    const batch = this.samplePrioritizedBatch(this.config.replayBatchSize);

    for (const exp of batch) {
      const tdError = this.updateQValue(exp.stateKey, exp.actionIdx, exp.reward, exp.nextStateKey);

      // Update priority for future sampling
      exp.priority = Math.abs(tdError) + 0.01; // Small constant to avoid zero priority
    }
  }

  /**
   * Sample a prioritized batch from replay buffer
   * Uses proportional prioritization
   */
  private samplePrioritizedBatch(batchSize: number): Experience[] {
    const totalPriority = this.replayBuffer.reduce((sum, exp) => sum + exp.priority, 0);
    const batch: Experience[] = [];
    const selected = new Set<number>();

    while (batch.length < batchSize && selected.size < this.replayBuffer.length) {
      let threshold = Math.random() * totalPriority;
      let cumSum = 0;

      for (let i = 0; i < this.replayBuffer.length; i++) {
        if (selected.has(i)) continue;

        cumSum += this.replayBuffer[i].priority;
        if (cumSum >= threshold) {
          batch.push(this.replayBuffer[i]);
          selected.add(i);
          break;
        }
      }
    }

    return batch;
  }

  /**
   * Calculate epsilon using configured decay strategy
   */
  private calculateEpsilon(): number {
    const { explorationInitial, explorationFinal, explorationDecay, explorationDecayType } = this.config;
    const progress = Math.min(this.stepCount / explorationDecay, 1.0);

    switch (explorationDecayType) {
      case 'linear':
        return explorationFinal + (explorationInitial - explorationFinal) * (1 - progress);

      case 'exponential':
        // Exponential decay: epsilon = final + (initial - final) * exp(-decay_rate * step)
        const decayRate = -Math.log((explorationFinal / explorationInitial) + 1e-8) / explorationDecay;
        return explorationFinal + (explorationInitial - explorationFinal) * Math.exp(-decayRate * this.stepCount);

      case 'cosine':
        // Cosine annealing: smooth transition
        return explorationFinal + (explorationInitial - explorationFinal) * 0.5 * (1 + Math.cos(Math.PI * progress));

      default:
        return Math.max(explorationFinal, explorationInitial - this.stepCount / explorationDecay);
    }
  }

  /**
   * Get statistics including cache and replay buffer metrics
   */
  getStats(): Record<string, number> {
    const cacheHitRate = this.cacheHits + this.cacheMisses > 0
      ? this.cacheHits / (this.cacheHits + this.cacheMisses)
      : 0;

    return {
      updateCount: this.updateCount,
      qTableSize: this.qTable.size,
      epsilon: this.epsilon,
      avgTDError: this.avgTDError,
      stepCount: this.stepCount,
      useNative: this.useNative ? 1 : 0,
      // Cache metrics
      cacheSize: this.routeCache.size,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate,
      // Replay buffer metrics
      replayBufferSize: this.replayBuffer.length,
      totalExperiences: this.totalExperiences,
      // Feature hash cache
      featureHashCacheSize: this.featureHashCache.size,
    };
  }

  /**
   * Reset the router (clears all learned data)
   */
  reset(): void {
    this.qTable.clear();
    this.epsilon = this.config.explorationInitial;
    this.stepCount = 0;
    this.updateCount = 0;
    this.avgTDError = 0;

    // Reset replay buffer
    this.replayBuffer = [];
    this.replayBufferIdx = 0;
    this.totalExperiences = 0;

    // Reset cache
    this.routeCache.clear();
    this.cacheOrder = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;

    // Reset feature hash cache
    this.featureHashCache.clear();
  }

  /**
   * Export Q-table for persistence
   */
  export(): Record<string, { qValues: number[]; visits: number }> {
    const result: Record<string, { qValues: number[]; visits: number }> = {};
    for (const [key, entry] of this.qTable) {
      result[key] = {
        qValues: Array.from(entry.qValues),
        visits: entry.visits,
      };
    }
    return result;
  }

  /**
   * Import Q-table from persistence
   */
  import(data: Record<string, { qValues: number[]; visits: number }>): void {
    this.qTable.clear();
    for (const [key, entry] of Object.entries(data)) {
      this.qTable.set(key, {
        qValues: new Float32Array(entry.qValues),
        visits: entry.visits,
        lastUpdate: Date.now(),
      });
    }
  }

  // Private methods

  /**
   * Legacy hash function (kept for backward compatibility)
   */
  private hashState(context: string): string {
    // Simple hash for context string
    let hash = 0;
    for (let i = 0; i < context.length; i++) {
      const char = context.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `state_${hash}`;
  }

  /**
   * Optimized state hashing using feature extraction
   * Creates a more semantic representation of the task context
   */
  private hashStateOptimized(context: string): string {
    // Check feature hash cache first
    if (this.featureHashCache.has(context)) {
      const cached = this.featureHashCache.get(context)!;
      return this.featureVectorToKey(cached);
    }

    // Extract features from context
    const features = this.extractFeatures(context);

    // Cache the feature vector
    if (this.featureHashCache.size < 1000) { // Limit cache size
      this.featureHashCache.set(context, features);
    }

    return this.featureVectorToKey(features);
  }

  /**
   * Extract feature vector from task context
   * Uses keyword matching and n-gram hashing
   */
  private extractFeatures(context: string): Float32Array {
    const features = new Float32Array(this.config.stateSpaceDim);
    const lowerContext = context.toLowerCase();
    const words = lowerContext.split(/\s+/);

    // Feature 1-32: Keyword presence (binary features)
    for (let i = 0; i < FEATURE_KEYWORDS.length && i < 32; i++) {
      if (lowerContext.includes(FEATURE_KEYWORDS[i])) {
        features[i] = 1.0;
      }
    }

    // Feature 33-40: Context length buckets
    const lengthBucket = Math.min(Math.floor(context.length / 50), 7);
    features[32 + lengthBucket] = 1.0;

    // Feature 41-48: Word count buckets
    const wordBucket = Math.min(Math.floor(words.length / 5), 7);
    features[40 + wordBucket] = 1.0;

    // Feature 49-56: File extension hints
    const extPatterns = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.md', '.json'];
    for (let i = 0; i < extPatterns.length; i++) {
      if (lowerContext.includes(extPatterns[i])) {
        features[48 + i] = 1.0;
      }
    }

    // Feature 57-64: N-gram hash features (for capturing unique patterns)
    for (let i = 0; i < words.length - 1 && i < 8; i++) {
      const bigram = `${words[i]}_${words[i + 1]}`;
      const hash = this.murmurhash3(bigram) % 8;
      features[56 + hash] += 0.25;
    }

    // Normalize features
    let norm = 0;
    for (let i = 0; i < features.length; i++) {
      norm += features[i] * features[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < features.length; i++) {
      features[i] /= norm;
    }

    return features;
  }

  /**
   * Convert feature vector to state key
   * Uses locality-sensitive hashing for similar contexts
   */
  private featureVectorToKey(features: Float32Array): string {
    // Quantize features to create discrete state
    const quantized: number[] = [];
    for (let i = 0; i < features.length; i += 4) {
      let bucket = 0;
      for (let j = 0; j < 4 && i + j < features.length; j++) {
        if (features[i + j] > 0.25) {
          bucket |= (1 << j);
        }
      }
      quantized.push(bucket);
    }

    // Create hash from quantized values
    let hash = 0;
    for (let i = 0; i < quantized.length; i++) {
      hash = ((hash << 4) ^ quantized[i]) & 0x7fffffff;
    }

    return `fstate_${hash.toString(36)}`;
  }

  /**
   * MurmurHash3 32-bit implementation for n-gram hashing
   */
  private murmurhash3(str: string): number {
    let h1 = 0xdeadbeef;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;

    for (let i = 0; i < str.length; i++) {
      let k1 = str.charCodeAt(i);
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = Math.imul(h1, 5) + 0xe6546b64;
    }

    h1 ^= str.length;
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;

    return h1 >>> 0;
  }

  private getQValues(stateKey: string): number[] {
    const entry = this.qTable.get(stateKey);
    if (!entry) {
      return new Array(this.config.numActions).fill(0);
    }
    return Array.from(entry.qValues);
  }

  private getOrCreateEntry(stateKey: string): QEntry {
    let entry = this.qTable.get(stateKey);
    if (!entry) {
      entry = {
        qValues: new Float32Array(this.config.numActions),
        visits: 0,
        lastUpdate: Date.now(),
      };
      this.qTable.set(stateKey, entry);
    }
    return entry;
  }

  private argmax(values: number[]): number {
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

  private softmaxConfidence(qValues: number[], actionIdx: number): number {
    const maxQ = Math.max(...qValues);
    const expValues = qValues.map(q => Math.exp(q - maxQ)); // Subtract max for numerical stability
    const sumExp = expValues.reduce((a, b) => a + b, 0);
    return expValues[actionIdx] / sumExp;
  }

  private pruneQTable(): void {
    const entries = Array.from(this.qTable.entries())
      .sort((a, b) => a[1].lastUpdate - b[1].lastUpdate);

    const toRemove = entries.length - Math.floor(this.config.maxStates * 0.8);
    for (let i = 0; i < toRemove; i++) {
      this.qTable.delete(entries[i][0]);
    }
  }
}

/**
 * Factory function
 */
export function createQLearningRouter(config?: Partial<QLearningRouterConfig>): QLearningRouter {
  return new QLearningRouter(config);
}
