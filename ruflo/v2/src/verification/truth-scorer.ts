/**
 * TruthScorer - Advanced truth scoring system with configurable thresholds
 * Provides statistical validation and confidence analysis for agent claims and system states
 */

import type { ILogger } from '../core/logger.js';
import { logger } from '../core/logger.js';
import { AppError } from '../utils/error-handler.js';
import type {
  TruthScore,
  TruthScoreConfig,
  TruthScoringWeights,
  TruthValidationChecks,
  ConfidenceConfig,
  TruthScoreComponents,
  ConfidenceInterval,
  TruthEvidence,
  AgentClaim,
  VerificationError,
} from './types.js';
import { VERIFICATION_CONSTANTS } from './types.js';
import type { AgentId, AgentState } from '../swarm/types.js';

export interface TruthScorerOptions {
  config?: Partial<TruthScoreConfig>;
  logger?: ILogger;
}

export class TruthScorer {
  private readonly config: TruthScoreConfig;
  private readonly logger: ILogger;
  private readonly agentHistory: Map<string, AgentPerformanceHistory> = new Map();
  private readonly validationCache: Map<string, CachedValidation> = new Map();

  constructor(options: TruthScorerOptions = {}) {
    this.logger = options.logger || logger.child({ component: 'TruthScorer' });
    this.config = this.mergeConfig(options.config);
    
    this.logger.info('TruthScorer initialized', {
      threshold: this.config.threshold,
      checks: this.config.checks,
      weights: this.config.weights,
    });
  }

  /**
   * Calculate truth score for an agent claim
   */
  async scoreClaim(claim: AgentClaim, context?: ScoringContext): Promise<TruthScore> {
    const startTime = Date.now();
    this.logger.debug('Starting truth score calculation', {
      claimId: claim.id,
      claimType: claim.type,
      agentId: claim.agentId,
    });

    try {
      // Initialize score components
      const components: Partial<TruthScoreComponents> = {};
      const evidence: TruthEvidence[] = [];
      const errors: VerificationError[] = [];

      // Calculate individual components
      if (this.config.checks.historicalValidation) {
        components.agentReliability = await this.calculateAgentReliability(claim, evidence, errors);
      }

      if (this.config.checks.crossAgentValidation && context?.peers) {
        components.crossValidation = await this.calculateCrossValidation(claim, context.peers, evidence, errors);
      }

      if (this.config.checks.externalValidation && context?.externalSources) {
        components.externalVerification = await this.calculateExternalVerification(claim, context.externalSources, evidence, errors);
      }

      if (this.config.checks.logicalValidation) {
        components.logicalCoherence = await this.calculateLogicalCoherence(claim, evidence, errors);
      }

      if (this.config.checks.statisticalValidation) {
        components.factualConsistency = await this.calculateFactualConsistency(claim, evidence, errors);
      }

      // Calculate overall score using weighted average
      const overall = this.calculateWeightedScore(components as TruthScoreComponents);
      const fullComponents: TruthScoreComponents = {
        agentReliability: components.agentReliability || 0,
        crossValidation: components.crossValidation || 0,
        externalVerification: components.externalVerification || 0,
        logicalCoherence: components.logicalCoherence || 0,
        factualConsistency: components.factualConsistency || 0,
        overall,
      };

      // Calculate confidence interval
      const confidence = this.calculateConfidenceInterval(fullComponents, evidence.length);

      const score: TruthScore = {
        score: overall,
        components: fullComponents,
        confidence,
        evidence,
        timestamp: new Date(),
        metadata: {
          claimId: claim.id,
          agentId: claim.agentId,
          calculationTime: Date.now() - startTime,
          evidenceCount: evidence.length,
          errorCount: errors.length,
          config: this.config,
        },
      };

      this.logger.info('Truth score calculated', {
        claimId: claim.id,
        score: overall,
        components: fullComponents,
        confidence: confidence.level,
        duration: Date.now() - startTime,
      });

      return score;
    } catch (error) {
      this.logger.error('Failed to calculate truth score', error);
      throw new AppError(
        `Truth score calculation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TRUTH_SCORE_CALCULATION_FAILED',
        500
      );
    }
  }

  /**
   * Validate if a truth score meets the configured threshold
   */
  validateScore(score: TruthScore): boolean {
    const passes = score.score >= this.config.threshold;
    this.logger.debug('Truth score validation', {
      score: score.score,
      threshold: this.config.threshold,
      passes,
    });
    return passes;
  }

  /**
   * Update agent performance history
   */
  updateAgentHistory(agentId: AgentId, performance: AgentPerformanceRecord): void {
    const agentKey = typeof agentId === 'string' ? agentId : agentId.id;
    
    if (!this.agentHistory.has(agentKey)) {
      this.agentHistory.set(agentKey, {
        agentId: agentKey,
        records: [],
        statistics: {
          averageScore: 0,
          successRate: 0,
          totalClaims: 0,
          recentTrend: 'stable',
        },
      });
    }

    const history = this.agentHistory.get(agentKey)!;
    history.records.push(performance);

    // Keep only recent records (last 100)
    if (history.records.length > 100) {
      history.records = history.records.slice(-100);
    }

    // Update statistics
    this.updateAgentStatistics(history);

    this.logger.debug('Agent history updated', {
      agentId: agentKey,
      recordCount: history.records.length,
      averageScore: history.statistics.averageScore,
    });
  }

  /**
   * Get agent reliability score
   */
  getAgentReliability(agentId: AgentId): number {
    const agentKey = typeof agentId === 'string' ? agentId : agentId.id;
    const history = this.agentHistory.get(agentKey);
    
    if (!history || history.records.length === 0) {
      return 0.5; // Default neutral score for unknown agents
    }

    return history.statistics.averageScore;
  }

  /**
   * Clear validation cache
   */
  clearCache(): void {
    this.validationCache.clear();
    this.logger.debug('Validation cache cleared');
  }

  private mergeConfig(partialConfig?: Partial<TruthScoreConfig>): TruthScoreConfig {
    const defaultWeights: TruthScoringWeights = {
      agentReliability: 0.3,
      crossValidation: 0.25,
      externalVerification: 0.2,
      factualConsistency: 0.15,
      logicalCoherence: 0.1,
    };

    const defaultChecks: TruthValidationChecks = {
      historicalValidation: true,
      crossAgentValidation: true,
      externalValidation: false,
      logicalValidation: true,
      statisticalValidation: true,
    };

    const defaultConfidence: ConfidenceConfig = {
      level: VERIFICATION_CONSTANTS.DEFAULT_CONFIDENCE_LEVEL,
      minSampleSize: VERIFICATION_CONSTANTS.DEFAULT_MIN_SAMPLE_SIZE,
      maxErrorMargin: VERIFICATION_CONSTANTS.DEFAULT_MAX_ERROR_MARGIN,
    };

    return {
      threshold: partialConfig?.threshold || VERIFICATION_CONSTANTS.DEFAULT_TRUTH_THRESHOLD,
      weights: { ...defaultWeights, ...partialConfig?.weights },
      checks: { ...defaultChecks, ...partialConfig?.checks },
      confidence: { ...defaultConfidence, ...partialConfig?.confidence },
    };
  }

  private async calculateAgentReliability(
    claim: AgentClaim,
    evidence: TruthEvidence[],
    errors: VerificationError[]
  ): Promise<number> {
    try {
      const agentKey = typeof claim.agentId === 'string' ? claim.agentId : claim.agentId.id;
      const history = this.agentHistory.get(agentKey);

      if (!history || history.records.length < 3) {
        // Insufficient data - use neutral score
        evidence.push({
          type: 'agent_history',
          source: 'internal_history',
          weight: this.config.weights.agentReliability,
          score: 0.5,
          details: { reason: 'insufficient_data', recordCount: history?.records.length || 0 },
          timestamp: new Date(),
        });
        return 0.5;
      }

      // Calculate reliability based on recent performance
      const recentRecords = history.records.slice(-10); // Last 10 records
      const avgScore = recentRecords.reduce((sum, record) => sum + record.score, 0) / recentRecords.length;
      const consistency = 1 - this.calculateVariance(recentRecords.map(r => r.score));
      const trendFactor = this.calculateTrendFactor(recentRecords);

      const reliability = (avgScore * 0.6) + (consistency * 0.3) + (trendFactor * 0.1);

      evidence.push({
        type: 'agent_history',
        source: 'internal_history',
        weight: this.config.weights.agentReliability,
        score: reliability,
        details: {
          averageScore: avgScore,
          consistency,
          trendFactor,
          recordCount: recentRecords.length,
        },
        timestamp: new Date(),
      });

      return Math.max(0, Math.min(1, reliability));
    } catch (error) {
      errors.push({
        code: 'AGENT_RELIABILITY_CALCULATION_FAILED',
        message: `Failed to calculate agent reliability: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'medium',
        context: { claimId: claim.id, agentId: claim.agentId },
        recoverable: true,
        timestamp: new Date(),
      });
      return 0.5; // Default score on error
    }
  }

  private async calculateCrossValidation(
    claim: AgentClaim,
    peers: AgentState[],
    evidence: TruthEvidence[],
    errors: VerificationError[]
  ): Promise<number> {
    try {
      if (peers.length === 0) {
        evidence.push({
          type: 'cross_validation',
          source: 'peer_agents',
          weight: this.config.weights.crossValidation,
          score: 0.5,
          details: { reason: 'no_peers_available' },
          timestamp: new Date(),
        });
        return 0.5;
      }

      // Simulate cross-validation with peer agents
      // In a real implementation, this would involve querying other agents
      const validationScores: number[] = [];
      const reliablePeers = peers.filter(peer => this.getAgentReliability(peer.id) > 0.7);

      for (const peer of reliablePeers.slice(0, 5)) { // Limit to 5 peers
        const peerReliability = this.getAgentReliability(peer.id);
        const validationScore = this.simulatePeerValidation(claim, peer);
        validationScores.push(validationScore * peerReliability);
      }

      if (validationScores.length === 0) {
        evidence.push({
          type: 'cross_validation',
          source: 'peer_agents',
          weight: this.config.weights.crossValidation,
          score: 0.5,
          details: { reason: 'no_reliable_peers' },
          timestamp: new Date(),
        });
        return 0.5;
      }

      const avgValidation = validationScores.reduce((sum, score) => sum + score, 0) / validationScores.length;
      const consensus = 1 - this.calculateVariance(validationScores);
      const crossValidationScore = (avgValidation * 0.8) + (consensus * 0.2);

      evidence.push({
        type: 'cross_validation',
        source: 'peer_agents',
        weight: this.config.weights.crossValidation,
        score: crossValidationScore,
        details: {
          peerCount: validationScores.length,
          averageValidation: avgValidation,
          consensus,
          validationScores,
        },
        timestamp: new Date(),
      });

      return Math.max(0, Math.min(1, crossValidationScore));
    } catch (error) {
      errors.push({
        code: 'CROSS_VALIDATION_FAILED',
        message: `Cross validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'medium',
        context: { claimId: claim.id, peerCount: peers.length },
        recoverable: true,
        timestamp: new Date(),
      });
      return 0.5;
    }
  }

  private async calculateExternalVerification(
    claim: AgentClaim,
    externalSources: ExternalSource[],
    evidence: TruthEvidence[],
    errors: VerificationError[]
  ): Promise<number> {
    try {
      if (externalSources.length === 0) {
        evidence.push({
          type: 'external_source',
          source: 'external_verification',
          weight: this.config.weights.externalVerification,
          score: 0.5,
          details: { reason: 'no_external_sources' },
          timestamp: new Date(),
        });
        return 0.5;
      }

      // Simulate external verification
      // In a real implementation, this would query external APIs, databases, etc.
      const verificationResults: number[] = [];

      for (const source of externalSources.slice(0, 3)) { // Limit to 3 sources
        const verificationScore = await this.simulateExternalVerification(claim, source);
        verificationResults.push(verificationScore * source.reliability);
      }

      const avgVerification = verificationResults.reduce((sum, score) => sum + score, 0) / verificationResults.length;
      const sourceAgreement = 1 - this.calculateVariance(verificationResults);
      const externalScore = (avgVerification * 0.7) + (sourceAgreement * 0.3);

      evidence.push({
        type: 'external_source',
        source: 'external_verification',
        weight: this.config.weights.externalVerification,
        score: externalScore,
        details: {
          sourceCount: verificationResults.length,
          averageVerification: avgVerification,
          sourceAgreement,
          verificationResults,
        },
        timestamp: new Date(),
      });

      return Math.max(0, Math.min(1, externalScore));
    } catch (error) {
      errors.push({
        code: 'EXTERNAL_VERIFICATION_FAILED',
        message: `External verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'medium',
        context: { claimId: claim.id, sourceCount: externalSources.length },
        recoverable: true,
        timestamp: new Date(),
      });
      return 0.5;
    }
  }

  private async calculateLogicalCoherence(
    claim: AgentClaim,
    evidence: TruthEvidence[],
    errors: VerificationError[]
  ): Promise<number> {
    try {
      // Analyze logical consistency of the claim
      const coherenceChecks = {
        structuralIntegrity: this.checkStructuralIntegrity(claim),
        causalConsistency: this.checkCausalConsistency(claim),
        temporalCoherence: this.checkTemporalCoherence(claim),
        metricConsistency: this.checkMetricConsistency(claim),
      };

      const coherenceScore = Object.values(coherenceChecks).reduce((sum, score) => sum + score, 0) / 4;

      evidence.push({
        type: 'logical_proof',
        source: 'logical_analyzer',
        weight: this.config.weights.logicalCoherence,
        score: coherenceScore,
        details: coherenceChecks,
        timestamp: new Date(),
      });

      return Math.max(0, Math.min(1, coherenceScore));
    } catch (error) {
      errors.push({
        code: 'LOGICAL_COHERENCE_FAILED',
        message: `Logical coherence analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'medium',
        context: { claimId: claim.id },
        recoverable: true,
        timestamp: new Date(),
      });
      return 0.5;
    }
  }

  private async calculateFactualConsistency(
    claim: AgentClaim,
    evidence: TruthEvidence[],
    errors: VerificationError[]
  ): Promise<number> {
    try {
      // Perform statistical validation of claim metrics
      const statisticalTests = {
        distributionTest: this.performDistributionTest(claim),
        outlierDetection: this.performOutlierDetection(claim),
        trendAnalysis: this.performTrendAnalysis(claim),
        correlationAnalysis: this.performCorrelationAnalysis(claim),
      };

      const consistencyScore = Object.values(statisticalTests).reduce((sum, score) => sum + score, 0) / 4;

      evidence.push({
        type: 'statistical_test',
        source: 'statistical_analyzer',
        weight: this.config.weights.factualConsistency,
        score: consistencyScore,
        details: statisticalTests,
        timestamp: new Date(),
      });

      return Math.max(0, Math.min(1, consistencyScore));
    } catch (error) {
      errors.push({
        code: 'FACTUAL_CONSISTENCY_FAILED',
        message: `Factual consistency analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'medium',
        context: { claimId: claim.id },
        recoverable: true,
        timestamp: new Date(),
      });
      return 0.5;
    }
  }

  private calculateWeightedScore(components: TruthScoreComponents): number {
    const weights = this.config.weights;
    const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    
    const weightedSum = 
      (components.agentReliability * weights.agentReliability) +
      (components.crossValidation * weights.crossValidation) +
      (components.externalVerification * weights.externalVerification) +
      (components.factualConsistency * weights.factualConsistency) +
      (components.logicalCoherence * weights.logicalCoherence);

    return weightedSum / totalWeight;
  }

  private calculateConfidenceInterval(components: TruthScoreComponents, evidenceCount: number): ConfidenceInterval {
    const score = components.overall;
    const sampleSize = Math.max(evidenceCount, 1);
    const confidenceLevel = this.config.confidence.level;
    
    // Calculate standard error (simplified)
    const variance = this.calculateComponentVariance(components);
    const standardError = Math.sqrt(variance / sampleSize);
    
    // Z-score for confidence level (approximation)
    const zScore = this.getZScore(confidenceLevel);
    const margin = zScore * standardError;
    
    return {
      lower: Math.max(0, score - margin),
      upper: Math.min(1, score + margin),
      level: confidenceLevel,
    };
  }

  private calculateComponentVariance(components: TruthScoreComponents): number {
    const scores = [
      components.agentReliability,
      components.crossValidation,
      components.externalVerification,
      components.factualConsistency,
      components.logicalCoherence,
    ];
    
    return this.calculateVariance(scores);
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }

  private calculateTrendFactor(records: AgentPerformanceRecord[]): number {
    if (records.length < 2) return 0.5;
    
    // Simple linear trend calculation
    const scores = records.map(r => r.score);
    const n = scores.length;
    const x = Array.from({ length: n }, (_, i) => i);
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = scores.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * scores[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    
    // Convert slope to factor (positive trend increases score)
    return 0.5 + Math.max(-0.5, Math.min(0.5, slope));
  }

  private getZScore(confidenceLevel: number): number {
    // Simplified Z-score lookup
    if (confidenceLevel >= 0.99) return 2.576;
    if (confidenceLevel >= 0.95) return 1.96;
    if (confidenceLevel >= 0.90) return 1.645;
    if (confidenceLevel >= 0.80) return 1.282;
    return 1.0;
  }

  private updateAgentStatistics(history: AgentPerformanceHistory): void {
    const records = history.records;
    if (records.length === 0) return;

    const scores = records.map(r => r.score);
    const successCount = records.filter(r => r.success).length;

    history.statistics.averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    history.statistics.successRate = successCount / records.length;
    history.statistics.totalClaims = records.length;

    // Calculate trend
    if (records.length >= 5) {
      const recentScores = scores.slice(-5);
      const earlierScores = scores.slice(-10, -5);
      
      if (earlierScores.length > 0) {
        const recentAvg = recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length;
        const earlierAvg = earlierScores.reduce((sum, score) => sum + score, 0) / earlierScores.length;
        
        if (recentAvg > earlierAvg + 0.05) {
          history.statistics.recentTrend = 'improving';
        } else if (recentAvg < earlierAvg - 0.05) {
          history.statistics.recentTrend = 'declining';
        } else {
          history.statistics.recentTrend = 'stable';
        }
      }
    }
  }

  // Simulation methods for demo purposes - replace with real implementations
  private simulatePeerValidation(claim: AgentClaim, peer: AgentState): number {
    // Simulate peer validation logic
    const baseScore = 0.7;
    const randomFactor = (Math.random() - 0.5) * 0.4;
    return Math.max(0, Math.min(1, baseScore + randomFactor));
  }

  private async simulateExternalVerification(claim: AgentClaim, source: ExternalSource): Promise<number> {
    // Simulate external source verification
    const baseScore = source.reliability * 0.8;
    const randomFactor = (Math.random() - 0.5) * 0.3;
    return Math.max(0, Math.min(1, baseScore + randomFactor));
  }

  private checkStructuralIntegrity(claim: AgentClaim): number {
    // Check if claim has required fields and proper structure
    let score = 0.8;
    
    if (!claim.data || typeof claim.data !== 'object') score -= 0.3;
    if (!claim.evidence || claim.evidence.length === 0) score -= 0.2;
    if (!claim.metrics) score -= 0.2;
    
    return Math.max(0, score);
  }

  private checkCausalConsistency(claim: AgentClaim): number {
    // Check for causal relationships in claim data
    return 0.8; // Simplified - implement actual causal analysis
  }

  private checkTemporalCoherence(claim: AgentClaim): number {
    // Check temporal consistency of claim
    const now = new Date();
    const claimAge = now.getTime() - claim.submittedAt.getTime();
    
    // Claims should be recent
    if (claimAge > 24 * 60 * 60 * 1000) { // More than 24 hours
      return 0.5;
    }
    
    return 0.9;
  }

  private checkMetricConsistency(claim: AgentClaim): number {
    // Check consistency of metrics in claim
    if (!claim.metrics) return 0.5;
    
    // Check for reasonable metric values
    const metrics = claim.metrics;
    let score = 0.8;
    
    if (metrics.accuracy && (metrics.accuracy < 0 || metrics.accuracy > 1)) score -= 0.3;
    if (metrics.errorRate && metrics.errorRate < 0) score -= 0.2;
    if (metrics.executionTime && metrics.executionTime < 0) score -= 0.2;
    
    return Math.max(0, score);
  }

  private performDistributionTest(claim: AgentClaim): number {
    // Perform statistical distribution test
    return 0.8; // Simplified - implement actual statistical tests
  }

  private performOutlierDetection(claim: AgentClaim): number {
    // Detect outliers in claim metrics
    return 0.8; // Simplified - implement actual outlier detection
  }

  private performTrendAnalysis(claim: AgentClaim): number {
    // Analyze trends in claim data
    return 0.8; // Simplified - implement actual trend analysis
  }

  private performCorrelationAnalysis(claim: AgentClaim): number {
    // Analyze correlations in claim metrics
    return 0.8; // Simplified - implement actual correlation analysis
  }
}

// Supporting interfaces
interface AgentPerformanceHistory {
  agentId: string;
  records: AgentPerformanceRecord[];
  statistics: AgentStatistics;
}

interface AgentPerformanceRecord {
  timestamp: Date;
  claimId: string;
  score: number;
  success: boolean;
  executionTime: number;
  resourceUsage: number;
  metadata: Record<string, unknown>;
}

interface AgentStatistics {
  averageScore: number;
  successRate: number;
  totalClaims: number;
  recentTrend: 'improving' | 'stable' | 'declining';
}

interface CachedValidation {
  key: string;
  result: number;
  timestamp: Date;
  expiry: Date;
}

interface ScoringContext {
  peers?: AgentState[];
  externalSources?: ExternalSource[];
  historicalData?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
}

interface ExternalSource {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  reliability: number;
  credentials?: Record<string, string>;
}

export default TruthScorer;