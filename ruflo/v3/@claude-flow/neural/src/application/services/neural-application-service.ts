/**
 * Neural Application Service - Application Layer
 *
 * Orchestrates neural learning operations.
 *
 * @module v3/neural/application/services
 */

import { Pattern, PatternType } from '../../domain/entities/pattern.js';
import { LearningDomainService, Trajectory, LearningResult, RouteRecommendation } from '../../domain/services/learning-service.js';

/**
 * Training session result
 */
export interface TrainingSessionResult {
  trajectoriesProcessed: number;
  patternsExtracted: number;
  patternsUpdated: number;
  averageConfidenceChange: number;
  duration: number;
}

/**
 * Neural metrics
 */
export interface NeuralMetrics {
  totalPatterns: number;
  patternsByType: Record<PatternType, number>;
  averageConfidence: number;
  reliablePatterns: number;
  totalSuccesses: number;
  totalFailures: number;
}

/**
 * Neural Application Service
 */
export class NeuralApplicationService {
  private readonly learningService: LearningDomainService;

  constructor() {
    this.learningService = new LearningDomainService();
  }

  // ============================================================================
  // Learning Operations
  // ============================================================================

  /**
   * Learn from a single trajectory
   */
  learn(trajectory: Trajectory): LearningResult {
    return this.learningService.updatePatterns(trajectory);
  }

  /**
   * Train on batch of trajectories
   */
  train(trajectories: Trajectory[]): TrainingSessionResult {
    const start = Date.now();
    let totalPatternsExtracted = 0;
    let totalPatternsUpdated = 0;
    let totalConfidenceChange = 0;

    for (const trajectory of trajectories) {
      const result = this.learningService.updatePatterns(trajectory);
      totalPatternsExtracted += result.patternsExtracted;
      totalPatternsUpdated += result.patternsUpdated;
      totalConfidenceChange += result.confidenceChange;
    }

    return {
      trajectoriesProcessed: trajectories.length,
      patternsExtracted: totalPatternsExtracted,
      patternsUpdated: totalPatternsUpdated,
      averageConfidenceChange: trajectories.length > 0 ? totalConfidenceChange / trajectories.length : 0,
      duration: Date.now() - start,
    };
  }

  // ============================================================================
  // Routing
  // ============================================================================

  /**
   * Get route recommendation for task
   */
  route(taskDescription: string): RouteRecommendation {
    return this.learningService.getRouteRecommendation(taskDescription);
  }

  /**
   * Explain routing decision
   */
  explain(taskDescription: string): {
    recommendation: RouteRecommendation;
    matchingPatterns: Pattern[];
    reasoning: string[];
  } {
    const recommendation = this.route(taskDescription);
    const matchingPatterns = this.learningService
      .getPatternsByType('task-routing')
      .filter((p) => p.matches(taskDescription));

    const reasoning: string[] = [];
    if (matchingPatterns.length > 0) {
      reasoning.push(`Found ${matchingPatterns.length} matching patterns`);
      for (const p of matchingPatterns.slice(0, 3)) {
        reasoning.push(`- Pattern "${p.name}": ${p.successRate.toFixed(2)} success rate, ${p.confidence.toFixed(2)} confidence`);
      }
    } else {
      reasoning.push('No matching patterns found, using keyword-based routing');
    }
    reasoning.push(`Recommended: ${recommendation.agentRole} (${(recommendation.confidence * 100).toFixed(0)}% confidence)`);

    return {
      recommendation,
      matchingPatterns,
      reasoning,
    };
  }

  // ============================================================================
  // Pattern Management
  // ============================================================================

  /**
   * Get all patterns
   */
  getPatterns(): Pattern[] {
    return this.learningService.getPatterns();
  }

  /**
   * Get patterns by type
   */
  getPatternsByType(type: PatternType): Pattern[] {
    return this.learningService.getPatternsByType(type);
  }

  /**
   * Add custom pattern
   */
  addPattern(props: {
    type: PatternType;
    name: string;
    description: string;
    condition: string;
    action: string;
    confidence?: number;
  }): Pattern {
    const pattern = Pattern.create({
      type: props.type,
      name: props.name,
      description: props.description,
      condition: props.condition,
      action: props.action,
      confidence: props.confidence ?? 0.5,
    });
    this.learningService.addPattern(pattern);
    return pattern;
  }

  /**
   * Remove pattern
   */
  removePattern(id: string): boolean {
    return this.learningService.removePattern(id);
  }

  /**
   * Consolidate patterns
   */
  consolidate(minConfidence?: number): { merged: number; pruned: number } {
    return this.learningService.consolidate(minConfidence);
  }

  // ============================================================================
  // Metrics
  // ============================================================================

  /**
   * Get neural metrics
   */
  getMetrics(): NeuralMetrics {
    const patterns = this.learningService.getPatterns();

    const patternsByType: Record<PatternType, number> = {
      'task-routing': 0,
      'error-recovery': 0,
      optimization: 0,
      learning: 0,
    };

    let totalConfidence = 0;
    let reliablePatterns = 0;
    let totalSuccesses = 0;
    let totalFailures = 0;

    for (const pattern of patterns) {
      patternsByType[pattern.type]++;
      totalConfidence += pattern.confidence;
      if (pattern.isReliable()) reliablePatterns++;
      totalSuccesses += pattern.successCount;
      totalFailures += pattern.failureCount;
    }

    return {
      totalPatterns: patterns.length,
      patternsByType,
      averageConfidence: patterns.length > 0 ? totalConfidence / patterns.length : 0,
      reliablePatterns,
      totalSuccesses,
      totalFailures,
    };
  }
}
