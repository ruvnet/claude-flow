/**
 * Learning Domain Service - Domain Layer
 *
 * Contains learning logic for pattern recognition and optimization.
 *
 * @module v3/neural/domain/services
 */

import { Pattern, PatternType } from '../entities/pattern.js';

/**
 * Learning trajectory
 */
export interface Trajectory {
  id: string;
  input: string;
  actions: string[];
  outcome: 'success' | 'failure' | 'partial';
  reward: number;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Learning result
 */
export interface LearningResult {
  patternsExtracted: number;
  patternsUpdated: number;
  confidenceChange: number;
}

/**
 * Route recommendation
 */
export interface RouteRecommendation {
  agentRole: string;
  confidence: number;
  reasoning: string;
  alternates: Array<{ role: string; confidence: number }>;
}

/**
 * Learning Domain Service
 */
export class LearningDomainService {
  private patterns: Map<string, Pattern> = new Map();

  /**
   * Extract patterns from trajectory
   */
  extractPatterns(trajectory: Trajectory): Pattern[] {
    const extracted: Pattern[] = [];

    // Extract task-routing pattern
    if (trajectory.outcome === 'success') {
      const taskPattern = Pattern.create({
        type: 'task-routing',
        name: `route_${trajectory.id}`,
        description: `Learned from successful trajectory`,
        condition: this.extractCondition(trajectory.input),
        action: trajectory.actions[0] ?? 'default',
        confidence: 0.6 + trajectory.reward * 0.2,
        metadata: { source: trajectory.id },
      });
      extracted.push(taskPattern);
    }

    // Extract error recovery pattern if failure
    if (trajectory.outcome === 'failure' && trajectory.actions.length > 1) {
      const lastAction = trajectory.actions[trajectory.actions.length - 1];
      const recoveryPattern = Pattern.create({
        type: 'error-recovery',
        name: `recovery_${trajectory.id}`,
        description: `Recovery action from failure`,
        condition: `error:${trajectory.actions[0]}`,
        action: lastAction,
        confidence: 0.5,
        metadata: { source: trajectory.id },
      });
      extracted.push(recoveryPattern);
    }

    return extracted;
  }

  /**
   * Update patterns based on trajectory outcome
   */
  updatePatterns(trajectory: Trajectory): LearningResult {
    let patternsUpdated = 0;
    let totalConfidenceChange = 0;

    for (const pattern of this.patterns.values()) {
      if (pattern.matches(trajectory.input)) {
        const oldConfidence = pattern.confidence;

        if (trajectory.outcome === 'success') {
          pattern.recordSuccess();
        } else {
          pattern.recordFailure();
        }

        totalConfidenceChange += pattern.confidence - oldConfidence;
        patternsUpdated++;
      }
    }

    // Extract and add new patterns
    const newPatterns = this.extractPatterns(trajectory);
    for (const pattern of newPatterns) {
      this.patterns.set(pattern.id, pattern);
    }

    return {
      patternsExtracted: newPatterns.length,
      patternsUpdated,
      confidenceChange: totalConfidenceChange,
    };
  }

  /**
   * Get route recommendation for task
   */
  getRouteRecommendation(taskDescription: string): RouteRecommendation {
    const matchingPatterns: Array<{ pattern: Pattern; score: number }> = [];

    for (const pattern of this.patterns.values()) {
      if (pattern.type !== 'task-routing') continue;

      if (pattern.matches(taskDescription)) {
        const score = pattern.confidence * (pattern.isReliable() ? 1.2 : 1.0);
        matchingPatterns.push({ pattern, score });
      }
    }

    // Sort by score
    matchingPatterns.sort((a, b) => b.score - a.score);

    if (matchingPatterns.length === 0) {
      return this.getDefaultRecommendation(taskDescription);
    }

    const best = matchingPatterns[0];
    const alternates = matchingPatterns.slice(1, 4).map((m) => ({
      role: m.pattern.action,
      confidence: m.score,
    }));

    return {
      agentRole: best.pattern.action,
      confidence: best.score,
      reasoning: `Based on pattern "${best.pattern.name}" with ${best.pattern.successCount} successes`,
      alternates,
    };
  }

  /**
   * Get default recommendation based on keywords
   */
  private getDefaultRecommendation(task: string): RouteRecommendation {
    const taskLower = task.toLowerCase();
    const keywordMap: Record<string, string> = {
      code: 'coder',
      implement: 'coder',
      write: 'coder',
      test: 'tester',
      review: 'reviewer',
      plan: 'planner',
      research: 'researcher',
      security: 'security-architect',
      performance: 'performance-engineer',
      memory: 'memory-specialist',
    };

    for (const [keyword, role] of Object.entries(keywordMap)) {
      if (taskLower.includes(keyword)) {
        return {
          agentRole: role,
          confidence: 0.5,
          reasoning: `Keyword match: "${keyword}"`,
          alternates: [],
        };
      }
    }

    return {
      agentRole: 'coder',
      confidence: 0.3,
      reasoning: 'Default fallback',
      alternates: [],
    };
  }

  /**
   * Extract condition from input
   */
  private extractCondition(input: string): string {
    // Extract key terms from input
    const words = input.toLowerCase().split(/\s+/);
    const keyWords = words.filter((w) => w.length > 4).slice(0, 5);
    return keyWords.join('|');
  }

  /**
   * Consolidate patterns (merge duplicates, prune low-confidence)
   */
  consolidate(minConfidence: number = 0.3): { merged: number; pruned: number } {
    let merged = 0;
    let pruned = 0;

    const toRemove: string[] = [];

    for (const [id, pattern] of this.patterns) {
      // Prune low confidence patterns with enough data
      if (pattern.confidence < minConfidence && pattern.successCount + pattern.failureCount > 20) {
        toRemove.push(id);
        pruned++;
      }
    }

    for (const id of toRemove) {
      this.patterns.delete(id);
    }

    return { merged, pruned };
  }

  /**
   * Get all patterns
   */
  getPatterns(): Pattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get patterns by type
   */
  getPatternsByType(type: PatternType): Pattern[] {
    return Array.from(this.patterns.values()).filter((p) => p.type === type);
  }

  /**
   * Add pattern
   */
  addPattern(pattern: Pattern): void {
    this.patterns.set(pattern.id, pattern);
  }

  /**
   * Remove pattern
   */
  removePattern(id: string): boolean {
    return this.patterns.delete(id);
  }
}
