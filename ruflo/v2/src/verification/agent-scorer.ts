/**
 * Agent Truth Scorer - Advanced performance evaluation and scoring system
 * 
 * Provides comprehensive agent performance analysis including accuracy,
 * reliability, consistency, efficiency, and adaptability metrics.
 */

import type { ILogger } from '../core/logger.js';
import type {
  TruthMetric,
  AgentTruthScore,
  PerformanceWindow,
  ScoreTrend,
  BenchmarkComparison,
  RiskAssessment,
  RiskFactor,
  TruthTelemetryConfig,
} from './telemetry.js';

export interface AgentScoringConfig {
  windowSizes: {
    recent: number; // minutes
    short: number; // hours
    medium: number; // days
    long: number; // weeks
  };
  weights: {
    accuracy: number;
    reliability: number;
    consistency: number;
    efficiency: number;
    adaptability: number;
  };
  benchmarks: {
    minAccuracy: number;
    minReliability: number;
    minConsistency: number;
    minEfficiency: number;
    targetTasksPerHour: number;
  };
  riskThresholds: {
    low: number;
    medium: number;
    high: number;
  };
}

export interface AgentPerformanceData {
  agentId: string;
  metrics: TruthMetric[];
  recentMetrics: TruthMetric[];
  taskHistory: TaskPerformance[];
  errorHistory: ErrorAnalysis[];
}

export interface TaskPerformance {
  taskId: string;
  timestamp: Date;
  taskType: string;
  complexity: string;
  duration: number;
  accuracy: number;
  success: boolean;
  interventionRequired: boolean;
  errorCount: number;
}

export interface ErrorAnalysis {
  timestamp: Date;
  errorType: string;
  severity: string;
  frequency: number;
  impact: number;
  resolved: boolean;
  pattern: string;
}

export interface TrendAnalysis {
  metric: string;
  timeframe: string;
  direction: 'improving' | 'declining' | 'stable';
  rate: number;
  confidence: number;
  significance: number;
  seasonality?: {
    detected: boolean;
    period: number;
    strength: number;
  };
}

export class AgentTruthScorer {
  private config: AgentScoringConfig;
  private logger: ILogger;
  private telemetryConfig: TruthTelemetryConfig;
  
  // Agent data storage
  private agentData = new Map<string, AgentPerformanceData>();
  private agentScores = new Map<string, AgentTruthScore>();
  
  // Benchmark data
  private benchmarkScores = new Map<string, number>();
  private industryBenchmarks: Map<string, BenchmarkComparison[]> = new Map();
  
  constructor(telemetryConfig: TruthTelemetryConfig, logger: ILogger) {
    this.telemetryConfig = telemetryConfig;
    this.logger = logger;
    
    this.config = {
      windowSizes: {
        recent: 15, // 15 minutes
        short: 4, // 4 hours
        medium: 7, // 7 days
        long: 4, // 4 weeks
      },
      weights: {
        accuracy: 0.30,
        reliability: 0.25,
        consistency: 0.20,
        efficiency: 0.15,
        adaptability: 0.10,
      },
      benchmarks: {
        minAccuracy: 0.90,
        minReliability: 0.85,
        minConsistency: 0.80,
        minEfficiency: 0.75,
        targetTasksPerHour: 10,
      },
      riskThresholds: {
        low: 0.85,
        medium: 0.70,
        high: 0.50,
      },
    };
    
    this.initializeBenchmarks();
  }
  
  async initialize(): Promise<void> {
    this.logger.info('Initializing Agent Truth Scorer', {
      weights: this.config.weights,
      benchmarks: this.config.benchmarks,
    });
    
    await this.loadHistoricalData();
    
    this.logger.info('Agent Truth Scorer initialized successfully');
  }
  
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Agent Truth Scorer');
    
    await this.persistScoringData();
    
    this.logger.info('Agent Truth Scorer shutdown complete');
  }
  
  async updateAgentMetric(metric: TruthMetric): Promise<void> {
    const agentId = metric.agentId;
    
    // Get or create agent data
    let agentData = this.agentData.get(agentId);
    if (!agentData) {
      agentData = {
        agentId,
        metrics: [],
        recentMetrics: [],
        taskHistory: [],
        errorHistory: [],
      };
      this.agentData.set(agentId, agentData);
    }
    
    // Add metric to agent data
    agentData.metrics.push(metric);
    
    // Update recent metrics (last 15 minutes)
    const recentCutoff = new Date(Date.now() - this.config.windowSizes.recent * 60 * 1000);
    agentData.recentMetrics = agentData.metrics.filter(m => m.timestamp >= recentCutoff);
    
    // Update task history
    await this.updateTaskHistory(agentData, metric);
    
    // Update error history
    await this.updateErrorHistory(agentData, metric);
    
    // Trigger score recalculation for significant updates
    if (this.shouldRecalculateScore(metric)) {
      await this.calculateAgentScore(agentId);
    }
  }
  
  async calculateAgentScore(agentId: string): Promise<AgentTruthScore | null> {
    const agentData = this.agentData.get(agentId);
    if (!agentData || agentData.metrics.length === 0) {
      return null;
    }
    
    try {
      // Calculate component scores
      const components = await this.calculateComponentScores(agentData);
      
      // Calculate overall score using weighted average
      const overallScore = this.calculateWeightedScore(components);
      
      // Generate performance windows
      const recentPerformance = await this.generatePerformanceWindows(agentData);
      
      // Analyze trends
      const trends = await this.analyzeTrends(agentData);
      
      // Generate benchmark comparisons
      const benchmarks = await this.generateBenchmarkComparisons(agentId, components);
      
      // Assess risk
      const riskAssessment = await this.assessRisk(agentData, components);
      
      const score: AgentTruthScore = {
        agentId,
        timestamp: new Date(),
        overallScore,
        components,
        recentPerformance,
        trends,
        benchmarks,
        riskAssessment,
      };
      
      this.agentScores.set(agentId, score);
      
      this.logger.debug('Calculated agent score', {
        agentId,
        overallScore: overallScore.toFixed(3),
        components,
      });
      
      return score;
      
    } catch (error) {
      this.logger.error('Error calculating agent score', { agentId, error });
      return null;
    }
  }
  
  private async calculateComponentScores(agentData: AgentPerformanceData): Promise<{
    accuracy: number;
    reliability: number;
    consistency: number;
    efficiency: number;
    adaptability: number;
  }> {
    const shortTermMetrics = this.getMetricsInWindow(
      agentData.metrics,
      this.config.windowSizes.short * 60 * 60 * 1000 // hours to ms
    );
    
    return {
      accuracy: await this.calculateAccuracyScore(shortTermMetrics),
      reliability: await this.calculateReliabilityScore(shortTermMetrics),
      consistency: await this.calculateConsistencyScore(shortTermMetrics),
      efficiency: await this.calculateEfficiencyScore(agentData),
      adaptability: await this.calculateAdaptabilityScore(agentData),
    };
  }
  
  private async calculateAccuracyScore(metrics: TruthMetric[]): Promise<number> {
    if (metrics.length === 0) return 0;
    
    const accuracyMetrics = metrics.filter(m => m.metricType === 'accuracy');
    if (accuracyMetrics.length === 0) return 0.8; // Default for new agents
    
    // Weighted average with more recent metrics having higher weight
    let totalWeight = 0;
    let weightedSum = 0;
    
    accuracyMetrics.forEach((metric, index) => {
      const age = Date.now() - metric.timestamp.getTime();
      const weight = Math.exp(-age / (24 * 60 * 60 * 1000)); // Exponential decay over 24 hours
      
      totalWeight += weight * metric.confidence;
      weightedSum += metric.value * weight * metric.confidence;
    });
    
    return totalWeight > 0 ? Math.min(1, weightedSum / totalWeight) : 0;
  }
  
  private async calculateReliabilityScore(metrics: TruthMetric[]): Promise<number> {
    if (metrics.length === 0) return 0;
    
    const reliabilityMetrics = metrics.filter(m => m.metricType === 'reliability');
    const validationScores = metrics.map(m => m.validation.score);
    
    // Calculate task success rate
    const successRate = validationScores.filter(score => score >= 0.8).length / validationScores.length;
    
    // Calculate consistency of performance
    const variance = this.calculateVariance(validationScores);
    const consistencyScore = Math.max(0, 1 - variance);
    
    // Combine factors
    return (successRate * 0.7) + (consistencyScore * 0.3);
  }
  
  private async calculateConsistencyScore(metrics: TruthMetric[]): Promise<number> {
    if (metrics.length < 3) return 0.8; // Default for insufficient data
    
    const values = metrics.map(m => m.value);
    const confidences = metrics.map(m => m.confidence);
    
    // Calculate coefficient of variation for values and confidence
    const valueCV = this.calculateCoefficientOfVariation(values);
    const confidenceCV = this.calculateCoefficientOfVariation(confidences);
    
    // Lower CV means higher consistency
    const valueConsistency = Math.max(0, 1 - valueCV);
    const confidenceConsistency = Math.max(0, 1 - confidenceCV);
    
    return (valueConsistency * 0.6) + (confidenceConsistency * 0.4);
  }
  
  private async calculateEfficiencyScore(agentData: AgentPerformanceData): Promise<number> {
    const recentTasks = agentData.taskHistory.filter(
      task => task.timestamp > new Date(Date.now() - this.config.windowSizes.short * 60 * 60 * 1000)
    );
    
    if (recentTasks.length === 0) return 0.8; // Default
    
    // Calculate tasks per hour
    const hoursSpanned = this.config.windowSizes.short;
    const tasksPerHour = recentTasks.length / hoursSpanned;
    const throughputScore = Math.min(1, tasksPerHour / this.config.benchmarks.targetTasksPerHour);
    
    // Calculate average task duration relative to complexity
    const durationEfficiency = this.calculateDurationEfficiency(recentTasks);
    
    // Calculate human intervention rate (lower is better)
    const interventionRate = recentTasks.filter(t => t.interventionRequired).length / recentTasks.length;
    const interventionScore = Math.max(0, 1 - (interventionRate * 2)); // Penalty for interventions
    
    return (throughputScore * 0.4) + (durationEfficiency * 0.4) + (interventionScore * 0.2);
  }
  
  private async calculateAdaptabilityScore(agentData: AgentPerformanceData): Promise<number> {
    const recentTasks = agentData.taskHistory.filter(
      task => task.timestamp > new Date(Date.now() - this.config.windowSizes.medium * 24 * 60 * 60 * 1000)
    );
    
    if (recentTasks.length < 5) return 0.7; // Default for new agents
    
    // Analyze performance across different task types
    const taskTypes = new Set(recentTasks.map(t => t.taskType));
    const performanceByType = new Map<string, number[]>();
    
    recentTasks.forEach(task => {
      if (!performanceByType.has(task.taskType)) {
        performanceByType.set(task.taskType, []);
      }
      performanceByType.get(task.taskType)!.push(task.accuracy);
    });
    
    // Calculate adaptability as consistency across different task types
    let adaptabilitySum = 0;
    let typeCount = 0;
    
    for (const [taskType, accuracies] of performanceByType) {
      if (accuracies.length >= 2) {
        const avgAccuracy = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length;
        adaptabilitySum += avgAccuracy;
        typeCount++;
      }
    }
    
    const adaptabilityScore = typeCount > 0 ? adaptabilitySum / typeCount : 0.7;
    
    // Bonus for handling multiple task types
    const diversityBonus = Math.min(0.1, taskTypes.size * 0.02);
    
    return Math.min(1, adaptabilityScore + diversityBonus);
  }
  
  private calculateWeightedScore(components: {
    accuracy: number;
    reliability: number;
    consistency: number;
    efficiency: number;
    adaptability: number;
  }): number {
    const weights = this.config.weights;
    
    return (
      components.accuracy * weights.accuracy +
      components.reliability * weights.reliability +
      components.consistency * weights.consistency +
      components.efficiency * weights.efficiency +
      components.adaptability * weights.adaptability
    );
  }
  
  private async generatePerformanceWindows(agentData: AgentPerformanceData): Promise<PerformanceWindow[]> {
    const windows: PerformanceWindow[] = [];
    const now = new Date();
    
    // Recent window (last 15 minutes)
    const recentStart = new Date(now.getTime() - this.config.windowSizes.recent * 60 * 1000);
    windows.push(await this.createPerformanceWindow('recent', recentStart, now, agentData));
    
    // Short window (last 4 hours)
    const shortStart = new Date(now.getTime() - this.config.windowSizes.short * 60 * 60 * 1000);
    windows.push(await this.createPerformanceWindow('short', shortStart, now, agentData));
    
    // Medium window (last 7 days)
    const mediumStart = new Date(now.getTime() - this.config.windowSizes.medium * 24 * 60 * 60 * 1000);
    windows.push(await this.createPerformanceWindow('medium', mediumStart, now, agentData));
    
    // Long window (last 4 weeks)
    const longStart = new Date(now.getTime() - this.config.windowSizes.long * 7 * 24 * 60 * 60 * 1000);
    windows.push(await this.createPerformanceWindow('long', longStart, now, agentData));
    
    return windows;
  }
  
  private async createPerformanceWindow(
    period: string,
    startTime: Date,
    endTime: Date,
    agentData: AgentPerformanceData
  ): Promise<PerformanceWindow> {
    const windowMetrics = agentData.metrics.filter(
      m => m.timestamp >= startTime && m.timestamp <= endTime
    );
    
    const windowTasks = agentData.taskHistory.filter(
      t => t.timestamp >= startTime && t.timestamp <= endTime
    );
    
    const successfulTasks = windowTasks.filter(t => t.success).length;
    const accuracyValues = windowMetrics
      .filter(m => m.metricType === 'accuracy')
      .map(m => m.value);
    const confidenceValues = windowMetrics.map(m => m.confidence);
    const interventions = windowTasks.filter(t => t.interventionRequired).length;
    const criticalErrors = agentData.errorHistory.filter(
      e => e.timestamp >= startTime && e.timestamp <= endTime && e.severity === 'critical'
    ).length;
    
    return {
      period,
      startTime,
      endTime,
      metrics: {
        totalTasks: windowTasks.length,
        successfulTasks,
        averageAccuracy: accuracyValues.length > 0 ? 
          accuracyValues.reduce((sum, val) => sum + val, 0) / accuracyValues.length : 0,
        averageConfidence: confidenceValues.length > 0 ?
          confidenceValues.reduce((sum, val) => sum + val, 0) / confidenceValues.length : 0,
        humanInterventions: interventions,
        criticalErrors,
      },
    };
  }
  
  private async analyzeTrends(agentData: AgentPerformanceData): Promise<ScoreTrend[]> {
    const trends: ScoreTrend[] = [];
    
    const metricTypes = ['accuracy', 'reliability', 'consistency', 'efficiency'];
    
    for (const metricType of metricTypes) {
      const trend = await this.analyzeTrendForMetric(agentData, metricType);
      if (trend) {
        trends.push(trend);
      }
    }
    
    return trends;
  }
  
  private async analyzeTrendForMetric(
    agentData: AgentPerformanceData,
    metricType: string
  ): Promise<ScoreTrend | null> {
    const relevantMetrics = agentData.metrics
      .filter(m => m.metricType === metricType)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    if (relevantMetrics.length < 5) return null; // Need minimum data points
    
    // Calculate linear trend
    const values = relevantMetrics.map(m => m.value);
    const times = relevantMetrics.map(m => m.timestamp.getTime());
    
    const { slope, correlation } = this.calculateLinearTrend(times, values);
    
    // Determine trend direction and significance
    let direction: 'improving' | 'declining' | 'stable';
    if (Math.abs(slope) < 0.001) {
      direction = 'stable';
    } else {
      direction = slope > 0 ? 'improving' : 'declining';
    }
    
    const confidence = Math.abs(correlation);
    const rate = Math.abs(slope);
    
    return {
      metric: metricType,
      direction,
      rate,
      confidence,
      timespan: 'medium',
    };
  }
  
  private async generateBenchmarkComparisons(
    agentId: string,
    components: any
  ): Promise<BenchmarkComparison[]> {
    const comparisons: BenchmarkComparison[] = [];
    
    // Compare against configured benchmarks
    const benchmarks = this.config.benchmarks;
    
    comparisons.push({
      category: 'accuracy',
      agentScore: components.accuracy,
      benchmarkScore: benchmarks.minAccuracy,
      percentile: this.calculatePercentile(components.accuracy, 'accuracy'),
      comparison: components.accuracy >= benchmarks.minAccuracy ? 'above' : 'below',
    });
    
    comparisons.push({
      category: 'reliability',
      agentScore: components.reliability,
      benchmarkScore: benchmarks.minReliability,
      percentile: this.calculatePercentile(components.reliability, 'reliability'),
      comparison: components.reliability >= benchmarks.minReliability ? 'above' : 'below',
    });
    
    comparisons.push({
      category: 'consistency',
      agentScore: components.consistency,
      benchmarkScore: benchmarks.minConsistency,
      percentile: this.calculatePercentile(components.consistency, 'consistency'),
      comparison: components.consistency >= benchmarks.minConsistency ? 'above' : 'below',
    });
    
    comparisons.push({
      category: 'efficiency',
      agentScore: components.efficiency,
      benchmarkScore: benchmarks.minEfficiency,
      percentile: this.calculatePercentile(components.efficiency, 'efficiency'),
      comparison: components.efficiency >= benchmarks.minEfficiency ? 'above' : 'below',
    });
    
    return comparisons;
  }
  
  private async assessRisk(
    agentData: AgentPerformanceData,
    components: any
  ): Promise<RiskAssessment> {
    const riskFactors: RiskFactor[] = [];
    
    // Accuracy risk
    if (components.accuracy < this.config.riskThresholds.medium) {
      riskFactors.push({
        name: 'Low Accuracy',
        severity: components.accuracy < this.config.riskThresholds.high ? 0.8 : 0.5,
        probability: 0.9,
        impact: 'High risk of incorrect outputs',
        trend: this.getTrendDirection(agentData, 'accuracy'),
      });
    }
    
    // Reliability risk
    if (components.reliability < this.config.riskThresholds.medium) {
      riskFactors.push({
        name: 'Low Reliability',
        severity: components.reliability < this.config.riskThresholds.high ? 0.7 : 0.4,
        probability: 0.8,
        impact: 'Frequent task failures',
        trend: this.getTrendDirection(agentData, 'reliability'),
      });
    }
    
    // Efficiency risk
    if (components.efficiency < this.config.riskThresholds.medium) {
      riskFactors.push({
        name: 'Low Efficiency',
        severity: 0.4,
        probability: 0.7,
        impact: 'Reduced throughput and increased costs',
        trend: this.getTrendDirection(agentData, 'efficiency'),
      });
    }
    
    // Error pattern risk
    const recentErrors = agentData.errorHistory.filter(
      e => e.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
    );
    
    if (recentErrors.length > 5) {
      riskFactors.push({
        name: 'High Error Rate',
        severity: 0.6,
        probability: 0.8,
        impact: 'Increased human intervention required',
        trend: 'increasing',
      });
    }
    
    // Determine overall risk level
    const maxSeverity = riskFactors.length > 0 ? 
      Math.max(...riskFactors.map(f => f.severity)) : 0;
    
    let level: 'low' | 'medium' | 'high' | 'critical';
    if (maxSeverity >= 0.8) level = 'critical';
    else if (maxSeverity >= 0.6) level = 'high';
    else if (maxSeverity >= 0.3) level = 'medium';
    else level = 'low';
    
    return {
      level,
      factors: riskFactors,
      recommendations: this.generateRecommendations(riskFactors),
      mitigationStrategies: this.generateMitigationStrategies(riskFactors),
    };
  }
  
  // ========================================================================================
  // Utility Methods
  // ========================================================================================
  
  private getMetricsInWindow(metrics: TruthMetric[], windowMs: number): TruthMetric[] {
    const cutoff = new Date(Date.now() - windowMs);
    return metrics.filter(m => m.timestamp >= cutoff);
  }
  
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }
  
  private calculateCoefficientOfVariation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    if (mean === 0) return 0;
    
    const variance = this.calculateVariance(values);
    const stdDev = Math.sqrt(variance);
    
    return stdDev / mean;
  }
  
  private calculateDurationEfficiency(tasks: TaskPerformance[]): number {
    if (tasks.length === 0) return 0.8;
    
    // Group tasks by complexity and calculate average duration
    const complexityGroups = new Map<string, number[]>();
    
    tasks.forEach(task => {
      if (!complexityGroups.has(task.complexity)) {
        complexityGroups.set(task.complexity, []);
      }
      complexityGroups.get(task.complexity)!.push(task.duration);
    });
    
    // Expected durations by complexity (in minutes)
    const expectedDurations: Record<string, number> = {
      low: 5,
      medium: 15,
      high: 45,
      critical: 120,
    };
    
    let totalEfficiency = 0;
    let groupCount = 0;
    
    for (const [complexity, durations] of complexityGroups) {
      const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const expected = expectedDurations[complexity] || 15;
      
      // Efficiency is better when duration is less than expected
      const efficiency = Math.min(1, expected / avgDuration);
      totalEfficiency += efficiency;
      groupCount++;
    }
    
    return groupCount > 0 ? totalEfficiency / groupCount : 0.8;
  }
  
  private calculateLinearTrend(x: number[], y: number[]): { slope: number; correlation: number } {
    const n = x.length;
    if (n < 2) return { slope: 0, correlation: 0 };
    
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
    const sumY2 = y.reduce((sum, val) => sum + val * val, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    const correlation = denominator !== 0 ? numerator / denominator : 0;
    
    return { slope, correlation };
  }
  
  private calculatePercentile(score: number, category: string): number {
    // This would typically compare against a database of historical scores
    // For now, using a simplified calculation
    const allScores = Array.from(this.agentScores.values())
      .map(s => s.components[category as keyof typeof s.components])
      .filter(s => s !== undefined)
      .sort((a, b) => a - b);
    
    if (allScores.length === 0) return 50;
    
    const index = allScores.findIndex(s => s >= score);
    return index === -1 ? 100 : (index / allScores.length) * 100;
  }
  
  private getTrendDirection(agentData: AgentPerformanceData, metricType: string): 'increasing' | 'stable' | 'decreasing' {
    const recentMetrics = agentData.metrics
      .filter(m => m.metricType === metricType)
      .slice(-10); // Last 10 metrics
    
    if (recentMetrics.length < 3) return 'stable';
    
    const values = recentMetrics.map(m => m.value);
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
    
    const diff = secondAvg - firstAvg;
    if (Math.abs(diff) < 0.01) return 'stable';
    return diff > 0 ? 'increasing' : 'decreasing';
  }
  
  private generateRecommendations(riskFactors: RiskFactor[]): string[] {
    const recommendations: string[] = [];
    
    riskFactors.forEach(factor => {
      switch (factor.name) {
        case 'Low Accuracy':
          recommendations.push('Implement additional validation steps');
          recommendations.push('Review training data quality');
          recommendations.push('Consider accuracy-focused training sessions');
          break;
        case 'Low Reliability':
          recommendations.push('Increase redundancy in critical tasks');
          recommendations.push('Implement circuit breaker patterns');
          recommendations.push('Add health check monitoring');
          break;
        case 'Low Efficiency':
          recommendations.push('Optimize task distribution algorithms');
          recommendations.push('Review resource allocation');
          recommendations.push('Consider task batching strategies');
          break;
        case 'High Error Rate':
          recommendations.push('Implement better error handling');
          recommendations.push('Add preventive validation checks');
          recommendations.push('Review error patterns for systemic issues');
          break;
      }
    });
    
    return Array.from(new Set(recommendations)); // Remove duplicates
  }
  
  private generateMitigationStrategies(riskFactors: RiskFactor[]): string[] {
    const strategies: string[] = [];
    
    const hasAccuracyRisk = riskFactors.some(f => f.name.includes('Accuracy'));
    const hasReliabilityRisk = riskFactors.some(f => f.name.includes('Reliability'));
    const hasEfficiencyRisk = riskFactors.some(f => f.name.includes('Efficiency'));
    
    if (hasAccuracyRisk) {
      strategies.push('Increase human oversight for critical tasks');
      strategies.push('Implement staged rollback procedures');
      strategies.push('Add confidence-based task routing');
    }
    
    if (hasReliabilityRisk) {
      strategies.push('Implement automatic failover mechanisms');
      strategies.push('Add task retry logic with exponential backoff');
      strategies.push('Create backup processing pipelines');
    }
    
    if (hasEfficiencyRisk) {
      strategies.push('Implement dynamic load balancing');
      strategies.push('Add performance-based task assignment');
      strategies.push('Create efficiency monitoring dashboards');
    }
    
    return strategies;
  }
  
  private shouldRecalculateScore(metric: TruthMetric): boolean {
    // Recalculate for significant changes
    return (
      metric.value < 0.7 || // Low performance
      metric.confidence < 0.5 || // Low confidence
      metric.validation.errors.some(e => e.severity === 'critical') || // Critical errors
      metric.metricType === 'accuracy' // Always recalculate for accuracy metrics
    );
  }
  
  private async updateTaskHistory(agentData: AgentPerformanceData, metric: TruthMetric): Promise<void> {
    // Convert metric to task performance record
    const taskPerformance: TaskPerformance = {
      taskId: metric.taskId,
      timestamp: metric.timestamp,
      taskType: metric.context.taskType,
      complexity: metric.context.complexity,
      duration: 0, // Would be calculated from task start/end times
      accuracy: metric.value,
      success: metric.validation.isValid,
      interventionRequired: metric.context.verificationMethod === 'human',
      errorCount: metric.validation.errors.length,
    };
    
    agentData.taskHistory.push(taskPerformance);
    
    // Keep only recent history (last 1000 tasks)
    if (agentData.taskHistory.length > 1000) {
      agentData.taskHistory = agentData.taskHistory.slice(-1000);
    }
  }
  
  private async updateErrorHistory(agentData: AgentPerformanceData, metric: TruthMetric): Promise<void> {
    // Process validation errors
    metric.validation.errors.forEach(error => {
      const errorAnalysis: ErrorAnalysis = {
        timestamp: metric.timestamp,
        errorType: error.type,
        severity: error.severity,
        frequency: 1,
        impact: error.impact,
        resolved: false,
        pattern: this.identifyErrorPattern(error, agentData.errorHistory),
      };
      
      agentData.errorHistory.push(errorAnalysis);
    });
    
    // Keep only recent history (last 500 errors)
    if (agentData.errorHistory.length > 500) {
      agentData.errorHistory = agentData.errorHistory.slice(-500);
    }
  }
  
  private identifyErrorPattern(error: any, errorHistory: ErrorAnalysis[]): string {
    // Simple pattern identification based on error type frequency
    const recentSimilar = errorHistory.filter(
      e => e.errorType === error.type && 
           e.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
    );
    
    if (recentSimilar.length >= 3) return 'recurring';
    if (recentSimilar.length >= 2) return 'intermittent';
    return 'isolated';
  }
  
  private initializeBenchmarks(): void {
    // Initialize industry benchmarks (would typically load from external source)
    this.benchmarkScores.set('accuracy', 0.92);
    this.benchmarkScores.set('reliability', 0.88);
    this.benchmarkScores.set('consistency', 0.85);
    this.benchmarkScores.set('efficiency', 0.80);
    this.benchmarkScores.set('adaptability', 0.75);
  }
  
  private async loadHistoricalData(): Promise<void> {
    // Placeholder for loading historical scoring data
    this.logger.debug('Loading historical agent scoring data');
  }
  
  private async persistScoringData(): Promise<void> {
    // Placeholder for persisting scoring data
    this.logger.debug('Persisting agent scoring data');
  }
  
  // ========================================================================================
  // Public API
  // ========================================================================================
  
  getAgentScore(agentId: string): AgentTruthScore | undefined {
    return this.agentScores.get(agentId);
  }
  
  getAllAgentScores(): AgentTruthScore[] {
    return Array.from(this.agentScores.values());
  }
  
  getTopPerformers(limit: number = 10): AgentTruthScore[] {
    return Array.from(this.agentScores.values())
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, limit);
  }
  
  getAgentsByRiskLevel(riskLevel: 'low' | 'medium' | 'high' | 'critical'): AgentTruthScore[] {
    return Array.from(this.agentScores.values())
      .filter(score => score.riskAssessment.level === riskLevel);
  }
  
  getPerformanceStatistics(): {
    totalAgents: number;
    averageScore: number;
    highPerformers: number;
    atRiskAgents: number;
    improvingAgents: number;
    decliningAgents: number;
  } {
    const scores = Array.from(this.agentScores.values());
    
    return {
      totalAgents: scores.length,
      averageScore: scores.length > 0 ? 
        scores.reduce((sum, s) => sum + s.overallScore, 0) / scores.length : 0,
      highPerformers: scores.filter(s => s.overallScore >= 0.9).length,
      atRiskAgents: scores.filter(s => s.riskAssessment.level === 'high' || s.riskAssessment.level === 'critical').length,
      improvingAgents: scores.filter(s => 
        s.trends.some(t => t.direction === 'improving' && t.confidence > 0.7)
      ).length,
      decliningAgents: scores.filter(s => 
        s.trends.some(t => t.direction === 'declining' && t.confidence > 0.7)
      ).length,
    };
  }
}