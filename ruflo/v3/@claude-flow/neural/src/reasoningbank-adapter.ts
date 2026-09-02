/**
 * V3 ReasoningBank Adapter
 *
 * Provides agentic-flow@alpha compatible ReasoningBank interface:
 * - 4-step pipeline: RETRIEVE, JUDGE, DISTILL, CONSOLIDATE
 * - Trajectory tracking and verdict judgment
 * - Memory distillation from successful trajectories
 * - Pattern consolidation with deduplication and pruning
 *
 * Based on Algorithm 3 & 4 from ReasoningBank paper.
 *
 * Performance Targets:
 * - Pattern retrieval: <5ms
 * - Verdict judgment: <10ms
 * - Memory distillation: <50ms
 * - Consolidation: <100ms
 */

import type {
  Trajectory,
  TrajectoryVerdict,
  DistilledMemory,
  Pattern,
  SONAMode,
} from './types.js';
import { createSONAManager, SONAManager } from './sona-manager.js';
import { createPatternLearner, PatternLearner } from './pattern-learner.js';

// ============================================================================
// ReasoningBank Types (agentic-flow compatible)
// ============================================================================

/**
 * ReasoningBank pattern record
 */
export interface ReasoningBankPattern {
  id: string;
  type: 'reasoning_memory' | 'strategy' | 'pattern';
  domain: string;
  patternData: {
    title: string;
    description: string;
    content: string;
    source: {
      taskId: string;
      agentId: string;
      outcome: 'Success' | 'Failure' | 'Partial';
      evidence: string[];
    };
    tags: string[];
    domain: string;
    createdAt: string;
    confidence: number;
    nUses: number;
  };
  confidence: number;
  usageCount: number;
  embedding: Float32Array;
  createdAt: number;
  lastUsed: number;
}

/**
 * Verdict from trajectory judgment
 */
export interface ReasoningBankVerdict {
  label: 'Success' | 'Failure' | 'Partial';
  score: number;
  evidence: string[];
  reasoning: string;
}

/**
 * Consolidation result
 */
export interface ConsolidationResult {
  itemsProcessed: number;
  duplicatesFound: number;
  contradictionsFound: number;
  itemsPruned: number;
  durationMs: number;
}

/**
 * ReasoningBank configuration
 */
export interface ReasoningBankConfig {
  /** Database path */
  dbPath?: string;

  /** Enable learning */
  enableLearning?: boolean;

  /** Enable reasoning agents */
  enableReasoning?: boolean;

  /** SONA mode */
  sonaMode?: SONAMode;

  /** Duplicate similarity threshold */
  duplicateThreshold?: number;

  /** Contradiction similarity threshold */
  contradictionThreshold?: number;

  /** Maximum age for pruning (days) */
  pruneAgeDays?: number;

  /** Minimum confidence to keep */
  minConfidenceKeep?: number;

  /** Consolidation trigger threshold */
  consolidateTriggerThreshold?: number;

  /** Maximum items for success distillation */
  maxItemsSuccess?: number;

  /** Maximum items for failure distillation */
  maxItemsFailure?: number;

  /** Confidence prior for success */
  confidencePriorSuccess?: number;

  /** Confidence prior for failure */
  confidencePriorFailure?: number;
}

// ============================================================================
// ReasoningBank Adapter Implementation
// ============================================================================

export class ReasoningBankAdapter {
  private readonly config: Required<ReasoningBankConfig>;
  private readonly sonaManager: SONAManager;
  private readonly patternLearner: PatternLearner;
  private patterns: Map<string, ReasoningBankPattern> = new Map();
  private newPatternsSinceConsolidation = 0;
  private initialized = false;

  constructor(config?: ReasoningBankConfig) {
    this.config = {
      dbPath: config?.dbPath || '.agentdb/reasoningbank.db',
      enableLearning: config?.enableLearning ?? true,
      enableReasoning: config?.enableReasoning ?? true,
      sonaMode: config?.sonaMode || 'balanced',
      duplicateThreshold: config?.duplicateThreshold ?? 0.95,
      contradictionThreshold: config?.contradictionThreshold ?? 0.85,
      pruneAgeDays: config?.pruneAgeDays ?? 30,
      minConfidenceKeep: config?.minConfidenceKeep ?? 0.3,
      consolidateTriggerThreshold: config?.consolidateTriggerThreshold ?? 100,
      maxItemsSuccess: config?.maxItemsSuccess ?? 5,
      maxItemsFailure: config?.maxItemsFailure ?? 3,
      confidencePriorSuccess: config?.confidencePriorSuccess ?? 0.8,
      confidencePriorFailure: config?.confidencePriorFailure ?? 0.5,
    };

    this.sonaManager = createSONAManager(this.config.sonaMode);
    this.patternLearner = createPatternLearner({
      maxPatterns: 5000,
      matchThreshold: 0.7,
      qualityThreshold: 0.5,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.sonaManager.initialize();
    this.initialized = true;
  }

  // ==========================================================================
  // Step 1: RETRIEVE - Top-k memory injection with MMR diversity
  // ==========================================================================

  /**
   * Retrieve relevant patterns for a query
   */
  async retrieve(
    queryEmbedding: Float32Array,
    options?: {
      k?: number;
      domain?: string;
      minConfidence?: number;
      useMmr?: boolean;
      mmrLambda?: number;
    }
  ): Promise<ReasoningBankPattern[]> {
    const k = options?.k ?? 5;
    const domain = options?.domain;
    const minConfidence = options?.minConfidence ?? 0;
    const useMmr = options?.useMmr ?? true;
    const mmrLambda = options?.mmrLambda ?? 0.7;

    // Get all patterns, filter by domain and confidence
    let candidates = Array.from(this.patterns.values());

    if (domain) {
      candidates = candidates.filter(p => p.domain === domain);
    }

    if (minConfidence > 0) {
      candidates = candidates.filter(p => p.confidence >= minConfidence);
    }

    if (candidates.length === 0) {
      return [];
    }

    // Compute similarities
    const similarities = candidates.map(pattern => ({
      pattern,
      similarity: this.cosineSimilarity(queryEmbedding, pattern.embedding),
    }));

    if (!useMmr) {
      // Simple top-k
      return similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k)
        .map(s => s.pattern);
    }

    // Maximal Marginal Relevance (MMR) for diversity
    return this.mmrSelect(queryEmbedding, similarities, k, mmrLambda);
  }

  // ==========================================================================
  // Step 2: JUDGE - LLM-as-judge trajectory evaluation
  // ==========================================================================

  /**
   * Judge a trajectory's success
   */
  async judge(trajectory: Trajectory): Promise<ReasoningBankVerdict> {
    // Compute quality metrics
    const qualityScore = trajectory.qualityScore;
    const stepCount = trajectory.steps.length;
    const avgReward = stepCount > 0
      ? trajectory.steps.reduce((sum, s) => sum + s.reward, 0) / stepCount
      : 0;

    // Determine verdict label
    let label: 'Success' | 'Failure' | 'Partial';
    if (qualityScore >= 0.8 && avgReward >= 0.7) {
      label = 'Success';
    } else if (qualityScore < 0.4 || avgReward < 0.3) {
      label = 'Failure';
    } else {
      label = 'Partial';
    }

    // Collect evidence
    const evidence: string[] = [];
    evidence.push(`Quality score: ${qualityScore.toFixed(2)}`);
    evidence.push(`Average reward: ${avgReward.toFixed(2)}`);
    evidence.push(`Step count: ${stepCount}`);

    if (trajectory.steps.length > 0) {
      const lastStep = trajectory.steps[trajectory.steps.length - 1];
      evidence.push(`Final action: ${lastStep.action}`);
      evidence.push(`Final reward: ${lastStep.reward.toFixed(2)}`);
    }

    // Generate reasoning
    const reasoning = this.generateJudgmentReasoning(trajectory, label, evidence);

    return {
      label,
      score: qualityScore,
      evidence,
      reasoning,
    };
  }

  // ==========================================================================
  // Step 3: DISTILL - Extract strategy memories from trajectories
  // ==========================================================================

  /**
   * Distill memories from a judged trajectory
   */
  async distill(
    trajectory: Trajectory,
    verdict: ReasoningBankVerdict,
    options?: {
      taskId?: string;
      agentId?: string;
    }
  ): Promise<string[]> {
    const maxItems = verdict.label === 'Success'
      ? this.config.maxItemsSuccess
      : this.config.maxItemsFailure;

    const confidencePrior = verdict.label === 'Success'
      ? this.config.confidencePriorSuccess
      : this.config.confidencePriorFailure;

    const memoryIds: string[] = [];

    // Extract key patterns from trajectory
    const patterns = this.extractPatternsFromTrajectory(trajectory, verdict);

    for (let i = 0; i < Math.min(patterns.length, maxItems); i++) {
      const pattern = patterns[i];

      const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const rbPattern: ReasoningBankPattern = {
        id,
        type: 'reasoning_memory',
        domain: trajectory.domain,
        patternData: {
          title: pattern.title,
          description: pattern.description,
          content: pattern.content,
          source: {
            taskId: options?.taskId || trajectory.trajectoryId,
            agentId: options?.agentId || 'unknown',
            outcome: verdict.label,
            evidence: verdict.evidence,
          },
          tags: pattern.tags,
          domain: trajectory.domain,
          createdAt: new Date().toISOString(),
          confidence: confidencePrior,
          nUses: 0,
        },
        confidence: confidencePrior,
        usageCount: 0,
        embedding: this.computePatternEmbedding(trajectory, i),
        createdAt: Date.now(),
        lastUsed: Date.now(),
      };

      this.patterns.set(id, rbPattern);
      this.newPatternsSinceConsolidation++;
      memoryIds.push(id);
    }

    // Check if consolidation should run
    if (this.shouldConsolidate()) {
      await this.consolidate();
    }

    return memoryIds;
  }

  // ==========================================================================
  // Step 4: CONSOLIDATE - Dedup, detect contradictions, prune old patterns
  // ==========================================================================

  /**
   * Run consolidation: deduplicate, detect contradictions, prune
   */
  async consolidate(): Promise<ConsolidationResult> {
    const startTime = Date.now();

    const patterns = Array.from(this.patterns.values());
    let duplicatesFound = 0;
    let contradictionsFound = 0;
    let itemsPruned = 0;

    // Step 1: Deduplicate similar patterns
    const toRemove = new Set<string>();

    for (let i = 0; i < patterns.length; i++) {
      if (toRemove.has(patterns[i].id)) continue;

      for (let j = i + 1; j < patterns.length; j++) {
        if (toRemove.has(patterns[j].id)) continue;

        const similarity = this.cosineSimilarity(
          patterns[i].embedding,
          patterns[j].embedding
        );

        if (similarity >= this.config.duplicateThreshold) {
          duplicatesFound++;

          // Keep the one with higher usage/confidence
          const score1 = patterns[i].usageCount * patterns[i].confidence;
          const score2 = patterns[j].usageCount * patterns[j].confidence;

          if (score1 >= score2) {
            toRemove.add(patterns[j].id);
          } else {
            toRemove.add(patterns[i].id);
          }
        }
      }
    }

    // Step 2: Detect contradictions (similar embeddings, different outcomes)
    for (let i = 0; i < patterns.length; i++) {
      if (toRemove.has(patterns[i].id)) continue;

      for (let j = i + 1; j < patterns.length; j++) {
        if (toRemove.has(patterns[j].id)) continue;

        const similarity = this.cosineSimilarity(
          patterns[i].embedding,
          patterns[j].embedding
        );

        const outcome1 = patterns[i].patternData.source.outcome;
        const outcome2 = patterns[j].patternData.source.outcome;

        if (
          similarity >= this.config.contradictionThreshold &&
          outcome1 !== outcome2
        ) {
          contradictionsFound++;
          // Log contradiction for analysis (don't auto-remove)
          console.warn(`Contradiction detected: ${patterns[i].id} vs ${patterns[j].id}`);
        }
      }
    }

    // Step 3: Prune old, low-confidence patterns
    const now = Date.now();
    const maxAge = this.config.pruneAgeDays * 24 * 60 * 60 * 1000;

    for (const pattern of patterns) {
      if (toRemove.has(pattern.id)) continue;

      const age = now - pattern.createdAt;
      if (
        age > maxAge &&
        pattern.confidence < this.config.minConfidenceKeep &&
        pattern.usageCount < 3
      ) {
        toRemove.add(pattern.id);
        itemsPruned++;
      }
    }

    // Remove marked patterns
    for (const id of toRemove) {
      this.patterns.delete(id);
    }

    this.newPatternsSinceConsolidation = 0;
    const durationMs = Date.now() - startTime;

    return {
      itemsProcessed: patterns.length,
      duplicatesFound,
      contradictionsFound,
      itemsPruned,
      durationMs,
    };
  }

  // ==========================================================================
  // Pattern Management
  // ==========================================================================

  /**
   * Insert a pattern directly
   */
  insertPattern(pattern: Omit<ReasoningBankPattern, 'createdAt' | 'lastUsed'>): string {
    const fullPattern: ReasoningBankPattern = {
      ...pattern,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    this.patterns.set(pattern.id, fullPattern);
    this.newPatternsSinceConsolidation++;

    return pattern.id;
  }

  /**
   * Get a pattern by ID
   */
  getPattern(id: string): ReasoningBankPattern | undefined {
    const pattern = this.patterns.get(id);
    if (pattern) {
      pattern.lastUsed = Date.now();
      pattern.usageCount++;
    }
    return pattern;
  }

  /**
   * Update pattern confidence
   */
  updateConfidence(id: string, delta: number): void {
    const pattern = this.patterns.get(id);
    if (pattern) {
      pattern.confidence = Math.max(0, Math.min(1, pattern.confidence + delta));
      pattern.patternData.confidence = pattern.confidence;
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPatterns: number;
    byDomain: Record<string, number>;
    byOutcome: Record<string, number>;
    avgConfidence: number;
  } {
    const patterns = Array.from(this.patterns.values());
    const byDomain: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};

    for (const pattern of patterns) {
      byDomain[pattern.domain] = (byDomain[pattern.domain] || 0) + 1;
      byOutcome[pattern.patternData.source.outcome] =
        (byOutcome[pattern.patternData.source.outcome] || 0) + 1;
    }

    const avgConfidence = patterns.length > 0
      ? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
      : 0;

    return {
      totalPatterns: patterns.length,
      byDomain,
      byOutcome,
      avgConfidence,
    };
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  private mmrSelect(
    query: Float32Array,
    candidates: Array<{ pattern: ReasoningBankPattern; similarity: number }>,
    k: number,
    lambda: number
  ): ReasoningBankPattern[] {
    const selected: ReasoningBankPattern[] = [];
    const remaining = [...candidates];

    while (selected.length < k && remaining.length > 0) {
      let bestScore = -Infinity;
      let bestIdx = 0;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const relevance = candidate.similarity;

        // Calculate max similarity to already selected patterns
        let maxSimilarity = 0;
        for (const sel of selected) {
          const sim = this.cosineSimilarity(candidate.pattern.embedding, sel.embedding);
          maxSimilarity = Math.max(maxSimilarity, sim);
        }

        // MMR score: lambda * relevance - (1 - lambda) * redundancy
        const score = lambda * relevance - (1 - lambda) * maxSimilarity;

        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      selected.push(remaining[bestIdx].pattern);
      remaining.splice(bestIdx, 1);
    }

    return selected;
  }

  private shouldConsolidate(): boolean {
    return this.newPatternsSinceConsolidation >= this.config.consolidateTriggerThreshold;
  }

  private generateJudgmentReasoning(
    trajectory: Trajectory,
    label: string,
    evidence: string[]
  ): string {
    const parts: string[] = [];

    parts.push(`Trajectory ${trajectory.trajectoryId} judged as ${label}.`);
    parts.push(`Domain: ${trajectory.domain}, Steps: ${trajectory.steps.length}.`);

    if (label === 'Success') {
      parts.push('The trajectory achieved high quality scores with positive rewards.');
    } else if (label === 'Failure') {
      parts.push('The trajectory had low quality scores or negative rewards.');
    } else {
      parts.push('The trajectory showed mixed results with room for improvement.');
    }

    return parts.join(' ');
  }

  private extractPatternsFromTrajectory(
    trajectory: Trajectory,
    verdict: ReasoningBankVerdict
  ): Array<{ title: string; description: string; content: string; tags: string[] }> {
    const patterns: Array<{ title: string; description: string; content: string; tags: string[] }> = [];

    // Extract overall strategy pattern
    const actions = trajectory.steps.map(s => s.action);
    patterns.push({
      title: `${verdict.label}: ${trajectory.context.slice(0, 50)}`,
      description: `Strategy for ${trajectory.domain} task with ${verdict.label.toLowerCase()} outcome`,
      content: `Actions: ${actions.slice(0, 5).join(' -> ')}${actions.length > 5 ? '...' : ''}`,
      tags: [verdict.label.toLowerCase(), trajectory.domain, 'strategy'],
    });

    // Extract key step patterns for successful trajectories
    if (verdict.label === 'Success' && trajectory.steps.length > 0) {
      const highRewardSteps = trajectory.steps
        .filter(s => s.reward > 0.7)
        .slice(0, 3);

      for (const step of highRewardSteps) {
        patterns.push({
          title: `High-reward action: ${step.action.slice(0, 30)}`,
          description: `Effective action in ${trajectory.domain} context`,
          content: `Action: ${step.action}, Reward: ${step.reward.toFixed(2)}`,
          tags: ['high-reward', trajectory.domain, 'action'],
        });
      }
    }

    return patterns;
  }

  private computePatternEmbedding(trajectory: Trajectory, index: number): Float32Array {
    if (trajectory.steps.length === 0) {
      return new Float32Array(768);
    }

    // Use weighted average of step embeddings
    const dim = trajectory.steps[0].stateAfter.length;
    const embedding = new Float32Array(dim);

    let totalWeight = 0;
    for (let i = 0; i < trajectory.steps.length; i++) {
      const weight = (i + 1 + index) / (trajectory.steps.length + index);
      totalWeight += weight;
      for (let j = 0; j < dim; j++) {
        embedding[j] += trajectory.steps[i].stateAfter[j] * weight;
      }
    }

    for (let j = 0; j < dim; j++) {
      embedding[j] /= totalWeight;
    }

    return embedding;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create ReasoningBank adapter
 */
export function createReasoningBankAdapter(
  config?: ReasoningBankConfig
): ReasoningBankAdapter {
  return new ReasoningBankAdapter(config);
}

/**
 * Create default ReasoningBank adapter
 */
export function createDefaultReasoningBankAdapter(): ReasoningBankAdapter {
  return new ReasoningBankAdapter({
    enableLearning: true,
    enableReasoning: true,
    sonaMode: 'balanced',
  });
}
