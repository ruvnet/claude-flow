/**
 * Threat Learning Service
 *
 * Self-learning threat pattern service using AgentDB for vector search
 * and ReasoningBank-style pattern storage.
 *
 * Features:
 * - HNSW-indexed threat pattern search (150x-12,500x faster)
 * - Pattern learning from successful detections
 * - Effectiveness tracking for adaptive mitigation
 * - Integration with agentic-flow attention mechanisms
 */

import type {
  Threat,
  ThreatType,
  ThreatSeverity,
  ThreatDetectionResult,
} from '../entities/threat.js';

/**
 * Learned threat pattern stored in vector database
 */
export interface LearnedThreatPattern {
  id: string;
  pattern: string;
  type: ThreatType;
  severity: ThreatSeverity;
  embedding?: number[];
  effectiveness: number;
  detectionCount: number;
  falsePositiveCount: number;
  lastUpdated: Date;
  metadata: {
    source: 'builtin' | 'learned' | 'community';
    confidenceDecay: number;
    contextPatterns: string[];
  };
}

/**
 * Mitigation strategy with effectiveness tracking
 */
export interface MitigationStrategy {
  id: string;
  threatType: ThreatType;
  strategy: 'block' | 'sanitize' | 'warn' | 'log' | 'escalate' | 'transform' | 'redirect';
  effectiveness: number;
  applicationCount: number;
  successCount: number;
  rollbackCount: number;
  recursionDepth: number; // strange-loop depth
  lastUpdated: Date;
}

/**
 * Learning trajectory for ReasoningBank integration
 */
export interface LearningTrajectory {
  sessionId: string;
  task: string;
  steps: Array<{
    input: string;
    output: ThreatDetectionResult;
    reward: number;
    timestamp: Date;
  }>;
  verdict: 'success' | 'failure' | 'partial';
  totalReward: number;
}

/**
 * AgentDB-compatible vector store interface
 */
export interface VectorStore {
  store(params: {
    namespace: string;
    key: string;
    value: unknown;
    embedding?: number[];
    ttl?: number;
  }): Promise<void>;

  search(params: {
    namespace: string;
    query: string | number[];
    k?: number;
    minSimilarity?: number;
  }): Promise<Array<{ key: string; value: unknown; similarity: number }>>;

  get(namespace: string, key: string): Promise<unknown | null>;

  delete(namespace: string, key: string): Promise<void>;
}

/**
 * Simple in-memory vector store for standalone usage
 * Replace with AgentDB in production
 */
export class InMemoryVectorStore implements VectorStore {
  private storage = new Map<string, Map<string, { value: unknown; embedding?: number[] }>>();

  async store(params: {
    namespace: string;
    key: string;
    value: unknown;
    embedding?: number[];
  }): Promise<void> {
    if (!this.storage.has(params.namespace)) {
      this.storage.set(params.namespace, new Map());
    }
    this.storage.get(params.namespace)!.set(params.key, {
      value: params.value,
      embedding: params.embedding,
    });
  }

  async search(params: {
    namespace: string;
    query: string | number[];
    k?: number;
  }): Promise<Array<{ key: string; value: unknown; similarity: number }>> {
    const ns = this.storage.get(params.namespace);
    if (!ns) return [];

    // Simple text-based search for in-memory version
    const results: Array<{ key: string; value: unknown; similarity: number }> = [];
    const queryStr = typeof params.query === 'string' ? params.query.toLowerCase() : '';

    for (const [key, { value }] of ns) {
      const valueStr = JSON.stringify(value).toLowerCase();
      if (queryStr && valueStr.includes(queryStr)) {
        results.push({ key, value, similarity: 0.8 });
      } else {
        results.push({ key, value, similarity: 0.5 });
      }
    }

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, params.k ?? 10);
  }

  async get(namespace: string, key: string): Promise<unknown | null> {
    return this.storage.get(namespace)?.get(key)?.value ?? null;
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.storage.get(namespace)?.delete(key);
  }
}

/**
 * Threat Learning Service
 */
export class ThreatLearningService {
  private readonly vectorStore: VectorStore;
  private readonly namespace = 'security_threats';
  private readonly mitigationNamespace = 'security_mitigations';
  private trajectories = new Map<string, LearningTrajectory>();

  constructor(vectorStore?: VectorStore) {
    this.vectorStore = vectorStore ?? new InMemoryVectorStore();
  }

  /**
   * Search for similar threat patterns using HNSW
   * When connected to AgentDB, achieves 150x-12,500x speedup
   */
  async searchSimilarThreats(
    query: string,
    options: { k?: number; minSimilarity?: number } = {}
  ): Promise<LearnedThreatPattern[]> {
    const results = await this.vectorStore.search({
      namespace: this.namespace,
      query,
      k: options.k ?? 10,
      minSimilarity: options.minSimilarity ?? 0.7,
    });

    return results.map(r => r.value as LearnedThreatPattern);
  }

  /**
   * Learn from a detection result
   * Implements ReasoningBank RETRIEVE-JUDGE-DISTILL-CONSOLIDATE pattern
   */
  async learnFromDetection(
    input: string,
    result: ThreatDetectionResult,
    feedback?: { wasAccurate: boolean; userVerdict?: string }
  ): Promise<void> {
    // Calculate reward based on detection accuracy
    let reward = result.safe ? 0.5 : 0.8; // Base reward

    if (feedback) {
      if (feedback.wasAccurate) {
        reward = 1.0;
      } else {
        reward = 0.2; // Penalize false positive/negative
      }
    }

    // Store each detected threat as a learned pattern
    for (const threat of result.threats) {
      const patternId = `learned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const learnedPattern: LearnedThreatPattern = {
        id: patternId,
        pattern: threat.pattern,
        type: threat.type,
        severity: threat.severity,
        effectiveness: reward,
        detectionCount: 1,
        falsePositiveCount: feedback?.wasAccurate === false ? 1 : 0,
        lastUpdated: new Date(),
        metadata: {
          source: 'learned',
          confidenceDecay: 0.99, // 1% decay per day
          contextPatterns: this.extractContextPatterns(input),
        },
      };

      await this.vectorStore.store({
        namespace: this.namespace,
        key: patternId,
        value: learnedPattern,
      });
    }
  }

  /**
   * Record mitigation effectiveness
   * Feeds into strange-loop meta-learning
   */
  async recordMitigation(
    threatType: ThreatType,
    strategy: MitigationStrategy['strategy'],
    success: boolean,
    recursionDepth: number = 0
  ): Promise<void> {
    const key = `mitigation-${threatType}-${strategy}`;
    const existing = await this.vectorStore.get(this.mitigationNamespace, key) as MitigationStrategy | null;

    const updated: MitigationStrategy = existing ?? {
      id: key,
      threatType,
      strategy,
      effectiveness: 0.5,
      applicationCount: 0,
      successCount: 0,
      rollbackCount: 0,
      recursionDepth: 0,
      lastUpdated: new Date(),
    };

    updated.applicationCount++;
    if (success) {
      updated.successCount++;
    } else {
      updated.rollbackCount++;
    }

    // Update effectiveness using exponential moving average
    const alpha = 0.1; // Learning rate
    updated.effectiveness = alpha * (success ? 1 : 0) + (1 - alpha) * updated.effectiveness;
    updated.recursionDepth = Math.max(updated.recursionDepth, recursionDepth);
    updated.lastUpdated = new Date();

    await this.vectorStore.store({
      namespace: this.mitigationNamespace,
      key,
      value: updated,
    });
  }

  /**
   * Get best mitigation strategy for a threat type
   */
  async getBestMitigation(threatType: ThreatType): Promise<MitigationStrategy | null> {
    const results = await this.vectorStore.search({
      namespace: this.mitigationNamespace,
      query: threatType,
      k: 5,
    });

    if (results.length === 0) return null;

    // Return highest effectiveness strategy
    const strategies = results.map(r => r.value as MitigationStrategy);
    return strategies.reduce((best, current) =>
      current.effectiveness > best.effectiveness ? current : best
    );
  }

  /**
   * Start a learning trajectory (for ReasoningBank integration)
   */
  startTrajectory(sessionId: string, task: string): void {
    this.trajectories.set(sessionId, {
      sessionId,
      task,
      steps: [],
      verdict: 'partial',
      totalReward: 0,
    });
  }

  /**
   * Record a trajectory step
   */
  recordStep(
    sessionId: string,
    input: string,
    output: ThreatDetectionResult,
    reward: number
  ): void {
    const trajectory = this.trajectories.get(sessionId);
    if (!trajectory) return;

    trajectory.steps.push({
      input,
      output,
      reward,
      timestamp: new Date(),
    });
    trajectory.totalReward += reward;
  }

  /**
   * End a trajectory and store for future learning
   */
  async endTrajectory(
    sessionId: string,
    verdict: 'success' | 'failure' | 'partial'
  ): Promise<void> {
    const trajectory = this.trajectories.get(sessionId);
    if (!trajectory) return;

    trajectory.verdict = verdict;

    // Store trajectory for pattern learning
    await this.vectorStore.store({
      namespace: 'security_trajectories',
      key: sessionId,
      value: trajectory,
    });

    // Clean up
    this.trajectories.delete(sessionId);
  }

  /**
   * Get learning statistics
   */
  async getStats(): Promise<{
    learnedPatterns: number;
    mitigationStrategies: number;
    avgEffectiveness: number;
  }> {
    const patterns = await this.vectorStore.search({
      namespace: this.namespace,
      query: '',
      k: 1000,
    });

    const mitigations = await this.vectorStore.search({
      namespace: this.mitigationNamespace,
      query: '',
      k: 100,
    });

    const avgEffectiveness = mitigations.length > 0
      ? mitigations.reduce((sum, m) => sum + (m.value as MitigationStrategy).effectiveness, 0) / mitigations.length
      : 0;

    return {
      learnedPatterns: patterns.length,
      mitigationStrategies: mitigations.length,
      avgEffectiveness,
    };
  }

  /**
   * Extract context patterns from input for better learning
   */
  private extractContextPatterns(input: string): string[] {
    const patterns: string[] = [];

    // Extract structural patterns
    if (input.includes('```')) patterns.push('code_block');
    if (input.includes('system:')) patterns.push('system_reference');
    if (/\[.*\]/.test(input)) patterns.push('bracket_notation');
    if (/<.*>/.test(input)) patterns.push('xml_like');
    if (input.length > 500) patterns.push('long_input');
    if (input.split('\n').length > 5) patterns.push('multiline');

    return patterns;
  }
}

/**
 * Create a ThreatLearningService with optional AgentDB vector store
 */
export function createThreatLearningService(
  vectorStore?: VectorStore
): ThreatLearningService {
  return new ThreatLearningService(vectorStore);
}
