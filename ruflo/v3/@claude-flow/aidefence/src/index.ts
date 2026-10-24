/**
 * @claude-flow/aidefence
 *
 * AI Manipulation Defense System with self-learning capabilities.
 *
 * Features:
 * - 50+ prompt injection patterns
 * - HNSW-indexed threat pattern search (150x-12,500x faster with AgentDB)
 * - ReasoningBank-style pattern learning
 * - Adaptive mitigation with effectiveness tracking
 * - Strange-loop meta-learning integration
 *
 * @example
 * ```typescript
 * import { createAIDefence } from '@claude-flow/aidefence';
 *
 * const aidefence = createAIDefence({ enableLearning: true });
 *
 * // Detect threats
 * const result = await aidefence.detect('Ignore all previous instructions');
 * console.log(result.safe); // false
 *
 * // Search similar patterns (uses HNSW when connected to AgentDB)
 * const similar = await aidefence.searchSimilarThreats('system prompt injection');
 *
 * // Learn from feedback
 * await aidefence.learnFromDetection(input, result, { wasAccurate: true });
 * ```
 */

// Domain entities
export type {
  Threat,
  ThreatType,
  ThreatSeverity,
  ThreatDetectionResult,
  BehavioralAnalysisResult,
  PolicyVerificationResult,
} from './domain/entities/threat.js';

export { createThreat } from './domain/entities/threat.js';

// Domain services
export { ThreatDetectionService, createThreatDetectionService } from './domain/services/threat-detection-service.js';

export type {
  LearnedThreatPattern,
  MitigationStrategy,
  LearningTrajectory,
  VectorStore,
} from './domain/services/threat-learning-service.js';

export {
  ThreatLearningService,
  createThreatLearningService,
  InMemoryVectorStore,
} from './domain/services/threat-learning-service.js';

// Import for internal use
import { createThreatDetectionService } from './domain/services/threat-detection-service.js';
import { createThreatLearningService } from './domain/services/threat-learning-service.js';
import type { ThreatDetectionResult, ThreatType, Threat } from './domain/entities/threat.js';
import type { LearnedThreatPattern, MitigationStrategy, VectorStore } from './domain/services/threat-learning-service.js';

/**
 * Configuration for AIDefence
 */
export interface AIDefenceConfig {
  /** Enable self-learning from detections */
  enableLearning?: boolean;
  /** Custom vector store (defaults to in-memory, use AgentDB for production) */
  vectorStore?: VectorStore;
  /** Minimum confidence threshold for threats */
  confidenceThreshold?: number;
  /** Enable PII detection */
  enablePIIDetection?: boolean;
}

/**
 * AIDefence - Unified threat detection and learning facade
 */
export interface AIDefence {
  /**
   * Detect threats in input text
   */
  detect(input: string): Promise<ThreatDetectionResult>;

  /**
   * Quick scan for threats (faster, less detailed)
   */
  quickScan(input: string): { threat: boolean; confidence: number };

  /**
   * Check if input contains PII
   */
  hasPII(input: string): boolean;

  /**
   * Search for similar threat patterns using HNSW
   * Achieves 150x-12,500x speedup when connected to AgentDB
   */
  searchSimilarThreats(
    query: string,
    options?: { k?: number; minSimilarity?: number }
  ): Promise<LearnedThreatPattern[]>;

  /**
   * Learn from a detection result (ReasoningBank pattern)
   */
  learnFromDetection(
    input: string,
    result: ThreatDetectionResult,
    feedback?: { wasAccurate: boolean; userVerdict?: string }
  ): Promise<void>;

  /**
   * Record mitigation effectiveness for meta-learning
   */
  recordMitigation(
    threatType: ThreatType,
    strategy: 'block' | 'sanitize' | 'warn' | 'log' | 'escalate' | 'transform' | 'redirect',
    success: boolean
  ): Promise<void>;

  /**
   * Get best mitigation strategy based on learned effectiveness
   */
  getBestMitigation(
    threatType: ThreatType
  ): Promise<MitigationStrategy | null>;

  /**
   * Start a learning trajectory session
   */
  startTrajectory(sessionId: string, task: string): void;

  /**
   * End a learning trajectory and store for future learning
   */
  endTrajectory(sessionId: string, verdict: 'success' | 'failure' | 'partial'): Promise<void>;

  /**
   * Get detection and learning statistics
   */
  getStats(): Promise<{
    detectionCount: number;
    avgDetectionTimeMs: number;
    learnedPatterns: number;
    mitigationStrategies: number;
    avgMitigationEffectiveness: number;
  }>;
}

/**
 * Create an AIDefence instance with optional learning capabilities
 *
 * @example
 * ```typescript
 * // Simple usage (detection only)
 * const simple = createAIDefence();
 *
 * // With learning enabled
 * const learning = createAIDefence({ enableLearning: true });
 *
 * // With AgentDB for HNSW search (150x-12,500x faster)
 * import { AgentDB } from 'agentdb';
 * const agentdb = new AgentDB({ path: './data/aidefence' });
 * const fast = createAIDefence({
 *   enableLearning: true,
 *   vectorStore: agentdb
 * });
 * ```
 */
export function createAIDefence(config: AIDefenceConfig = {}): AIDefence {
  const detectionService = createThreatDetectionService();
  const learningService = config.enableLearning
    ? createThreatLearningService(config.vectorStore)
    : null;

  return {
    async detect(input: string) {
      const result = detectionService.detect(input);

      // Auto-learn if enabled
      if (learningService && result.threats.length > 0) {
        await learningService.learnFromDetection(input, result);
      }

      return result;
    },

    quickScan(input: string) {
      return detectionService.quickScan(input);
    },

    hasPII(input: string) {
      return detectionService.detectPII(input);
    },

    async searchSimilarThreats(query, options) {
      if (!learningService) {
        return [];
      }
      return learningService.searchSimilarThreats(query, options);
    },

    async learnFromDetection(input, result, feedback) {
      if (!learningService) {
        console.warn('Learning not enabled. Pass { enableLearning: true } to createAIDefence()');
        return;
      }
      await learningService.learnFromDetection(input, result, feedback);
    },

    async recordMitigation(threatType, strategy, success) {
      if (!learningService) return;
      await learningService.recordMitigation(threatType, strategy, success);
    },

    async getBestMitigation(threatType) {
      if (!learningService) return null;
      return learningService.getBestMitigation(threatType);
    },

    startTrajectory(sessionId, task) {
      learningService?.startTrajectory(sessionId, task);
    },

    async endTrajectory(sessionId, verdict) {
      await learningService?.endTrajectory(sessionId, verdict);
    },

    async getStats() {
      const detectionStats = detectionService.getStats();
      const learningStats = learningService
        ? await learningService.getStats()
        : { learnedPatterns: 0, mitigationStrategies: 0, avgEffectiveness: 0 };

      return {
        detectionCount: detectionStats.detectionCount,
        avgDetectionTimeMs: detectionStats.avgDetectionTimeMs,
        learnedPatterns: learningStats.learnedPatterns,
        mitigationStrategies: learningStats.mitigationStrategies,
        avgMitigationEffectiveness: learningStats.avgEffectiveness,
      };
    },
  };
}

/**
 * Singleton instance for convenience
 */
let defaultInstance: AIDefence | null = null;

/**
 * Get the default AIDefence instance (singleton, learning enabled)
 */
export function getAIDefence(): AIDefence {
  if (!defaultInstance) {
    defaultInstance = createAIDefence({ enableLearning: true });
  }
  return defaultInstance;
}

/**
 * Convenience function for quick threat check
 */
export function isSafe(input: string): boolean {
  const service = createThreatDetectionService();
  return service.detect(input).safe;
}

/**
 * Convenience function for quick threat check with details
 */
export function checkThreats(input: string) {
  const service = createThreatDetectionService();
  return service.detect(input);
}

/**
 * Integration with agentic-flow attention mechanisms
 * Use for multi-agent security consensus
 */
export interface AttentionContext {
  agentId: string;
  threatAssessment: ThreatDetectionResult;
  weight: number;
}

/**
 * Calculate security consensus from multiple agent assessments
 * Uses attention-based weighting for flash attention integration
 */
export function calculateSecurityConsensus(
  assessments: AttentionContext[]
): {
  consensus: 'safe' | 'threat' | 'uncertain';
  confidence: number;
  criticalThreats: Threat[];
} {
  if (assessments.length === 0) {
    return { consensus: 'uncertain', confidence: 0, criticalThreats: [] };
  }

  // Normalize weights
  const totalWeight = assessments.reduce((sum, a) => sum + a.weight, 0);
  const normalized = assessments.map(a => ({
    ...a,
    weight: a.weight / totalWeight,
  }));

  // Calculate weighted threat score
  let threatScore = 0;
  const allThreats: Threat[] = [];

  for (const assessment of normalized) {
    if (!assessment.threatAssessment.safe) {
      threatScore += assessment.weight;
      allThreats.push(...assessment.threatAssessment.threats);
    }
  }

  // Determine consensus
  const criticalThreats = allThreats.filter(t => t.severity === 'critical');

  if (criticalThreats.length > 0) {
    return {
      consensus: 'threat',
      confidence: Math.max(...criticalThreats.map(t => t.confidence)),
      criticalThreats,
    };
  }

  if (threatScore > 0.5) {
    return { consensus: 'threat', confidence: threatScore, criticalThreats: [] };
  }

  if (threatScore < 0.2) {
    return { consensus: 'safe', confidence: 1 - threatScore, criticalThreats: [] };
  }

  return { consensus: 'uncertain', confidence: 0.5, criticalThreats: [] };
}
