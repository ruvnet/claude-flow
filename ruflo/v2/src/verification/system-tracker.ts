/**
 * System Truth Tracker - System-wide truth accuracy monitoring and analysis
 * 
 * Tracks overall system performance, distributional metrics, and system health
 * with real-time monitoring and predictive analytics capabilities.
 */

import type { ILogger } from '../core/logger.js';
import type {
  TruthMetric,
  SystemTruthMetrics,
  DistributionMetrics,
  TruthTelemetryConfig,
} from './telemetry.js';

export interface SystemHealthIndicators {
  timestamp: Date;
  overallHealth: number; // 0-1
  subsystemHealth: {
    collection: number;
    validation: number;
    scoring: number;
    alerting: number;
    persistence: number;
  };
  performanceIndicators: {
    latency: number;
    throughput: number;
    errorRate: number;
    availability: number;
  };
  capacityMetrics: {
    currentLoad: number;
    maxCapacity: number;
    utilizationRate: number;
    queueDepth: number;
  };
}

export interface SystemTrend {
  metric: string;
  timeframe: string;
  currentValue: number;
  previousValue: number;
  changePercent: number;
  direction: 'improving' | 'declining' | 'stable';
  significance: 'low' | 'medium' | 'high';
  prediction: {
    nextValue: number;
    confidence: number;
    timeToTarget?: Date;
  };
}

export interface DistributionAnalysis {
  metric: string;
  distribution: {
    min: number;
    max: number;
    mean: number;
    median: number;
    mode: number;
    stdDev: number;
    percentiles: Record<string, number>;
  };
  outliers: {
    values: number[];
    count: number;
    percentage: number;
  };
  normalityTest: {
    isNormal: boolean;
    pValue: number;
    testStatistic: number;
  };
}

export interface SystemPrediction {
  metric: string;
  currentValue: number;
  predictions: {
    shortTerm: { value: number; confidence: number; timeframe: string };
    mediumTerm: { value: number; confidence: number; timeframe: string };
    longTerm: { value: number; confidence: number; timeframe: string };
  };
  factors: PredictionFactor[];
  recommendations: string[];
}

export interface PredictionFactor {
  name: string;
  impact: number; // -1 to 1
  confidence: number; // 0 to 1
  description: string;
}

export interface SystemAlert {
  id: string;
  timestamp: Date;
  type: 'performance' | 'quality' | 'capacity' | 'health';
  severity: 'info' | 'warning' | 'critical' | 'emergency';
  message: string;
  metrics: Record<string, number>;
  threshold: number;
  currentValue: number;
  trend: string;
  impact: string;
  recommendedActions: string[];
}

export class SystemTruthTracker {
  private config: TruthTelemetryConfig;
  private logger: ILogger;
  
  // System state
  private systemMetrics: SystemTruthMetrics;
  private healthIndicators: SystemHealthIndicators;
  private historicalMetrics: TruthMetric[] = [];
  private systemTrends = new Map<string, SystemTrend>();
  private distributionAnalyses = new Map<string, DistributionAnalysis>();
  private predictions = new Map<string, SystemPrediction>();
  
  // Analytics state
  private metricsBuffer: TruthMetric[] = [];
  private analysisInterval?: NodeJS.Timeout;
  private predictionInterval?: NodeJS.Timeout;
  
  // Performance tracking
  private lastAnalysisTime = new Date();
  private totalMetricsProcessed = 0;
  private systemStartTime = new Date();
  
  constructor(config: TruthTelemetryConfig, logger: ILogger) {
    this.config = config;
    this.logger = logger;
    
    this.initializeSystemMetrics();
    this.initializeHealthIndicators();
  }
  
  async initialize(): Promise<void> {
    this.logger.info('Initializing System Truth Tracker');
    
    // Start analysis processes
    this.startPeriodicAnalysis();
    this.startPredictiveAnalysis();
    
    this.logger.info('System Truth Tracker initialized successfully');
  }
  
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down System Truth Tracker');
    
    // Stop intervals
    if (this.analysisInterval) clearInterval(this.analysisInterval);
    if (this.predictionInterval) clearInterval(this.predictionInterval);
    
    // Final analysis
    await this.performComprehensiveAnalysis();
    
    this.logger.info('System Truth Tracker shutdown complete');
  }
  
  async updateSystemMetric(metric: TruthMetric): Promise<void> {
    // Add to buffer for batch processing
    this.metricsBuffer.push(metric);
    this.totalMetricsProcessed++;
    
    // Add to historical data
    this.historicalMetrics.push(metric);
    
    // Keep historical data within limits
    if (this.historicalMetrics.length > 100000) {
      this.historicalMetrics = this.historicalMetrics.slice(-50000);
    }
    
    // Real-time updates for critical metrics
    if (this.isCriticalMetric(metric)) {
      await this.updateRealTimeMetrics();
    }
  }
  
  private async updateRealTimeMetrics(): Promise<void> {
    const recentMetrics = this.getRecentMetrics(60 * 60 * 1000); // Last hour
    
    if (recentMetrics.length === 0) return;
    
    // Update overall accuracy
    const accuracyMetrics = recentMetrics.filter(m => m.metricType === 'accuracy');
    if (accuracyMetrics.length > 0) {
      this.systemMetrics.overallAccuracy = 
        accuracyMetrics.reduce((sum, m) => sum + m.value, 0) / accuracyMetrics.length;
    }
    
    // Update human intervention rate
    const totalTasks = recentMetrics.length;
    const humanInterventions = recentMetrics.filter(
      m => m.context.verificationMethod === 'human' || m.context.verificationMethod === 'hybrid'
    ).length;
    
    this.systemMetrics.humanInterventionRate = totalTasks > 0 ? humanInterventions / totalTasks : 0;
    
    // Update system reliability
    const validTasks = recentMetrics.filter(m => m.validation.isValid).length;
    this.systemMetrics.systemReliability = totalTasks > 0 ? validTasks / totalTasks : 1;
    
    // Update agent counts
    const uniqueAgents = new Set(recentMetrics.map(m => m.agentId));
    this.systemMetrics.activeAgents = uniqueAgents.size;
    
    // Update task counts
    this.systemMetrics.totalTasks = this.historicalMetrics.length;
    this.systemMetrics.verifiedTasks = this.historicalMetrics.filter(m => m.validation.isValid).length;
    
    // Update critical failures
    const criticalErrors = recentMetrics.filter(
      m => m.validation.errors.some(e => e.severity === 'critical')
    ).length;
    this.systemMetrics.criticalFailures = criticalErrors;
    
    // Update efficiency
    this.systemMetrics.efficiency = this.calculateSystemEfficiency(recentMetrics);
    
    // Update timestamp
    this.systemMetrics.timestamp = new Date();
  }
  
  private startPeriodicAnalysis(): void {
    this.analysisInterval = setInterval(async () => {
      await this.performPeriodicAnalysis();
    }, 5 * 60 * 1000); // Every 5 minutes
    
    this.logger.info('Started periodic system analysis');
  }
  
  private startPredictiveAnalysis(): void {
    this.predictionInterval = setInterval(async () => {
      await this.performPredictiveAnalysis();
    }, 15 * 60 * 1000); // Every 15 minutes
    
    this.logger.info('Started predictive analysis');
  }
  
  private async performPeriodicAnalysis(): Promise<void> {
    try {
      // Process buffered metrics
      await this.processMetricsBuffer();
      
      // Update distribution metrics
      await this.updateDistributionMetrics();
      
      // Analyze trends
      await this.analyzeTrends();
      
      // Update health indicators
      await this.updateHealthIndicators();
      
      // Update timestamp
      this.lastAnalysisTime = new Date();
      
    } catch (error) {
      this.logger.error('Error in periodic analysis', error);
    }
  }
  
  private async processMetricsBuffer(): Promise<void> {
    if (this.metricsBuffer.length === 0) return;
    
    const batch = this.metricsBuffer.splice(0);
    
    // Update system metrics based on batch
    await this.updateSystemMetricsFromBatch(batch);
    
    // Analyze distribution for each metric type
    await this.analyzeDistributions(batch);
  }
  
  private async updateSystemMetricsFromBatch(metrics: TruthMetric[]): Promise<void> {
    if (metrics.length === 0) return;
    
    // Group metrics by type
    const metricsByType = new Map<string, TruthMetric[]>();
    metrics.forEach(metric => {
      if (!metricsByType.has(metric.metricType)) {
        metricsByType.set(metric.metricType, []);
      }
      metricsByType.get(metric.metricType)!.push(metric);
    });
    
    // Update accuracy
    const accuracyMetrics = metricsByType.get('accuracy') || [];
    if (accuracyMetrics.length > 0) {
      const weightedSum = accuracyMetrics.reduce(
        (sum, m) => sum + (m.value * m.confidence), 0
      );
      const totalWeight = accuracyMetrics.reduce((sum, m) => sum + m.confidence, 0);
      
      if (totalWeight > 0) {
        this.systemMetrics.overallAccuracy = weightedSum / totalWeight;
      }
    }
    
    // Update throughput
    const timeSpan = this.getTimeSpan(metrics);
    if (timeSpan > 0) {
      this.systemMetrics.throughput = metrics.length / (timeSpan / (60 * 60 * 1000)); // per hour
    }
    
    // Update latency (average validation time)
    const validationTimes = metrics
      .map(m => m.validation.automatedChecks.reduce((sum, c) => sum + c.executionTime, 0))
      .filter(t => t > 0);
    
    if (validationTimes.length > 0) {
      this.systemMetrics.latency = validationTimes.reduce((sum, t) => sum + t, 0) / validationTimes.length;
    }
    
    // Update error rate
    const errorCount = metrics.reduce(
      (sum, m) => sum + m.validation.errors.length, 0
    );
    this.systemMetrics.errorRate = metrics.length > 0 ? errorCount / metrics.length : 0;
    
    // Update success rate
    const successCount = metrics.filter(m => m.validation.isValid).length;
    this.systemMetrics.successRate = metrics.length > 0 ? 
      (successCount / metrics.length) * 100 : 100;
  }
  
  private async updateDistributionMetrics(): Promise<void> {
    const recentMetrics = this.getRecentMetrics(24 * 60 * 60 * 1000); // Last 24 hours
    
    if (recentMetrics.length === 0) return;
    
    // Task type distribution
    const taskTypes = new Map<string, number>();
    recentMetrics.forEach(metric => {
      const taskType = metric.context.taskType;
      taskTypes.set(taskType, (taskTypes.get(taskType) || 0) + 1);
    });
    this.systemMetrics.distributionMetrics.taskDistribution = Object.fromEntries(taskTypes);
    
    // Accuracy distribution (by ranges)
    const accuracyRanges = new Map<string, number>();
    recentMetrics
      .filter(m => m.metricType === 'accuracy')
      .forEach(metric => {
        const range = this.getAccuracyRange(metric.value);
        accuracyRanges.set(range, (accuracyRanges.get(range) || 0) + 1);
      });
    this.systemMetrics.distributionMetrics.accuracyDistribution = Object.fromEntries(accuracyRanges);
    
    // Complexity distribution
    const complexityTypes = new Map<string, number>();
    recentMetrics.forEach(metric => {
      const complexity = metric.context.complexity;
      complexityTypes.set(complexity, (complexityTypes.get(complexity) || 0) + 1);
    });
    this.systemMetrics.distributionMetrics.complexityDistribution = Object.fromEntries(complexityTypes);
    
    // Error type distribution
    const errorTypes = new Map<string, number>();
    recentMetrics.forEach(metric => {
      metric.validation.errors.forEach(error => {
        errorTypes.set(error.type, (errorTypes.get(error.type) || 0) + 1);
      });
    });
    this.systemMetrics.distributionMetrics.errorTypeDistribution = Object.fromEntries(errorTypes);
  }
  
  private async analyzeTrends(): Promise<void> {
    const metrics = ['overallAccuracy', 'humanInterventionRate', 'systemReliability', 'efficiency'];
    
    for (const metric of metrics) {
      const trend = await this.calculateTrend(metric);
      if (trend) {
        this.systemTrends.set(metric, trend);
      }
    }
  }
  
  private async calculateTrend(metricName: string): Promise<SystemTrend | null> {
    const historicalValues = await this.getHistoricalValues(metricName, 168); // Last 7 days
    
    if (historicalValues.length < 10) return null; // Need sufficient data
    
    // Calculate current and previous period averages
    const midpoint = Math.floor(historicalValues.length / 2);
    const earlierPeriod = historicalValues.slice(0, midpoint);
    const laterPeriod = historicalValues.slice(midpoint);
    
    const previousValue = earlierPeriod.reduce((sum, v) => sum + v.value, 0) / earlierPeriod.length;
    const currentValue = laterPeriod.reduce((sum, v) => sum + v.value, 0) / laterPeriod.length;
    
    const changePercent = previousValue !== 0 ? 
      ((currentValue - previousValue) / previousValue) * 100 : 0;
    
    // Determine direction and significance
    let direction: 'improving' | 'declining' | 'stable';
    let significance: 'low' | 'medium' | 'high';
    
    if (Math.abs(changePercent) < 1) {
      direction = 'stable';
      significance = 'low';
    } else {
      direction = changePercent > 0 ? 'improving' : 'declining';
      
      if (Math.abs(changePercent) > 10) significance = 'high';
      else if (Math.abs(changePercent) > 5) significance = 'medium';
      else significance = 'low';
    }
    
    // Make prediction
    const prediction = await this.predictNextValue(historicalValues);
    
    return {
      metric: metricName,
      timeframe: '7d',
      currentValue,
      previousValue,
      changePercent,
      direction,
      significance,
      prediction,
    };
  }
  
  private async predictNextValue(values: { timestamp: Date; value: number }[]): Promise<{
    nextValue: number;
    confidence: number;
    timeToTarget?: Date;
  }> {
    if (values.length < 5) {
      return { nextValue: values[values.length - 1].value, confidence: 0.3 };
    }
    
    // Simple linear regression for prediction
    const n = values.length;
    const x = values.map((_, i) => i);
    const y = values.map(v => v.value);
    
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Predict next value
    const nextValue = slope * n + intercept;
    
    // Calculate confidence based on R-squared
    const yMean = sumY / n;
    const ssRes = y.reduce((sum, val, i) => {
      const predicted = slope * i + intercept;
      return sum + Math.pow(val - predicted, 2);
    }, 0);
    const ssTot = y.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0);
    
    const rSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;
    const confidence = Math.max(0, Math.min(1, rSquared));
    
    return { nextValue, confidence };
  }
  
  private async updateHealthIndicators(): Promise<void> {
    const now = new Date();
    const uptime = now.getTime() - this.systemStartTime.getTime();
    
    // Calculate subsystem health scores
    const subsystemHealth = {
      collection: this.calculateCollectionHealth(),
      validation: this.calculateValidationHealth(),
      scoring: this.calculateScoringHealth(),
      alerting: this.calculateAlertingHealth(),
      persistence: this.calculatePersistenceHealth(),
    };
    
    // Calculate overall health
    const healthValues = Object.values(subsystemHealth);
    const overallHealth = healthValues.reduce((sum, h) => sum + h, 0) / healthValues.length;
    
    // Calculate performance indicators
    const recentMetrics = this.getRecentMetrics(60 * 60 * 1000); // Last hour
    const performanceIndicators = {
      latency: this.systemMetrics.latency,
      throughput: this.systemMetrics.throughput,
      errorRate: this.systemMetrics.errorRate,
      availability: this.calculateAvailability(uptime),
    };
    
    // Calculate capacity metrics
    const capacityMetrics = {
      currentLoad: this.calculateCurrentLoad(),
      maxCapacity: this.calculateMaxCapacity(),
      utilizationRate: this.calculateUtilizationRate(),
      queueDepth: this.metricsBuffer.length,
    };
    
    this.healthIndicators = {
      timestamp: now,
      overallHealth,
      subsystemHealth,
      performanceIndicators,
      capacityMetrics,
    };
  }
  
  private async performPredictiveAnalysis(): Promise<void> {
    try {
      const metrics = ['overallAccuracy', 'humanInterventionRate', 'systemReliability'];
      
      for (const metric of metrics) {
        const prediction = await this.generatePrediction(metric);
        if (prediction) {
          this.predictions.set(metric, prediction);
        }
      }
      
    } catch (error) {
      this.logger.error('Error in predictive analysis', error);
    }
  }
  
  private async generatePrediction(metricName: string): Promise<SystemPrediction | null> {
    const historicalValues = await this.getHistoricalValues(metricName, 336); // Last 2 weeks
    
    if (historicalValues.length < 20) return null;
    
    const currentValue = historicalValues[historicalValues.length - 1].value;
    
    // Generate predictions for different timeframes
    const shortTerm = await this.predictValue(historicalValues, 24); // 1 day
    const mediumTerm = await this.predictValue(historicalValues, 168); // 1 week
    const longTerm = await this.predictValue(historicalValues, 720); // 1 month
    
    // Identify factors affecting the prediction
    const factors = await this.identifyPredictionFactors(metricName, historicalValues);
    
    // Generate recommendations
    const recommendations = this.generatePredictionRecommendations(metricName, shortTerm, factors);
    
    return {
      metric: metricName,
      currentValue,
      predictions: {
        shortTerm: { ...shortTerm, timeframe: '1 day' },
        mediumTerm: { ...mediumTerm, timeframe: '1 week' },
        longTerm: { ...longTerm, timeframe: '1 month' },
      },
      factors,
      recommendations,
    };
  }
  
  private async predictValue(
    values: { timestamp: Date; value: number }[],
    hoursAhead: number
  ): Promise<{ value: number; confidence: number }> {
    // Use exponential smoothing for prediction
    const alpha = 0.3; // Smoothing parameter
    let smoothedValue = values[0].value;
    
    for (let i = 1; i < values.length; i++) {
      smoothedValue = alpha * values[i].value + (1 - alpha) * smoothedValue;
    }
    
    // Simple confidence calculation based on recent variance
    const recentValues = values.slice(-20).map(v => v.value);
    const variance = this.calculateVariance(recentValues);
    const confidence = Math.max(0.1, Math.min(0.9, 1 - Math.sqrt(variance)));
    
    return { value: smoothedValue, confidence };
  }
  
  private async identifyPredictionFactors(
    metricName: string,
    values: { timestamp: Date; value: number }[]
  ): Promise<PredictionFactor[]> {
    const factors: PredictionFactor[] = [];
    
    // Trend factor
    const trend = this.systemTrends.get(metricName);
    if (trend) {
      factors.push({
        name: 'Historical Trend',
        impact: trend.direction === 'improving' ? 0.3 : trend.direction === 'declining' ? -0.3 : 0,
        confidence: trend.significance === 'high' ? 0.8 : trend.significance === 'medium' ? 0.6 : 0.4,
        description: `${trend.direction} trend with ${trend.significance} significance`,
      });
    }
    
    // System load factor
    const currentLoad = this.healthIndicators.capacityMetrics.utilizationRate;
    if (currentLoad > 0.8) {
      factors.push({
        name: 'High System Load',
        impact: -0.2,
        confidence: 0.7,
        description: 'High system utilization may impact performance',
      });
    }
    
    // Error rate factor
    if (this.systemMetrics.errorRate > 0.05) {
      factors.push({
        name: 'Elevated Error Rate',
        impact: -0.4,
        confidence: 0.8,
        description: 'High error rate may continue to impact metrics',
      });
    }
    
    return factors;
  }
  
  // ========================================================================================
  // Utility Methods
  // ========================================================================================
  
  private getRecentMetrics(timeWindowMs: number): TruthMetric[] {
    const cutoff = new Date(Date.now() - timeWindowMs);
    return this.historicalMetrics.filter(m => m.timestamp >= cutoff);
  }
  
  private async getHistoricalValues(
    metricName: string,
    hoursBack: number
  ): Promise<{ timestamp: Date; value: number }[]> {
    // This would typically query a time-series database
    // For now, simulate historical data based on current metrics
    const values: { timestamp: Date; value: number }[] = [];
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    
    let currentValue = (this.systemMetrics as any)[metricName] || 0.8;
    
    for (let i = hoursBack; i >= 0; i--) {
      const timestamp = new Date(now - (i * hourMs));
      
      // Add some realistic variation
      const variation = (Math.random() - 0.5) * 0.1;
      const value = Math.max(0, Math.min(1, currentValue + variation));
      
      values.push({ timestamp, value });
      currentValue = value;
    }
    
    return values;
  }
  
  private getTimeSpan(metrics: TruthMetric[]): number {
    if (metrics.length < 2) return 0;
    
    const timestamps = metrics.map(m => m.timestamp.getTime()).sort((a, b) => a - b);
    return timestamps[timestamps.length - 1] - timestamps[0];
  }
  
  private getAccuracyRange(accuracy: number): string {
    if (accuracy >= 0.95) return '95-100%';
    if (accuracy >= 0.90) return '90-95%';
    if (accuracy >= 0.80) return '80-90%';
    if (accuracy >= 0.70) return '70-80%';
    return '<70%';
  }
  
  private calculateSystemEfficiency(metrics: TruthMetric[]): number {
    if (metrics.length === 0) return 0.8;
    
    // Efficiency based on validation success rate and automation rate
    const successRate = metrics.filter(m => m.validation.isValid).length / metrics.length;
    const automationRate = metrics.filter(
      m => m.context.verificationMethod === 'automated'
    ).length / metrics.length;
    
    return (successRate * 0.6) + (automationRate * 0.4);
  }
  
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }
  
  private isCriticalMetric(metric: TruthMetric): boolean {
    return (
      metric.metricType === 'accuracy' ||
      metric.value < 0.7 ||
      metric.validation.errors.some(e => e.severity === 'critical')
    );
  }
  
  private calculateCollectionHealth(): number {
    // Health based on collection throughput and error rate
    const targetThroughput = 100; // metrics per hour
    const currentThroughput = this.systemMetrics.throughput;
    const throughputScore = Math.min(1, currentThroughput / targetThroughput);
    
    const errorScore = Math.max(0, 1 - (this.systemMetrics.errorRate * 10));
    
    return (throughputScore * 0.7) + (errorScore * 0.3);
  }
  
  private calculateValidationHealth(): number {
    // Health based on validation success rate and processing time
    const successRate = this.systemMetrics.successRate / 100;
    const latencyScore = this.systemMetrics.latency > 0 ? 
      Math.max(0.1, Math.min(1, 5000 / this.systemMetrics.latency)) : 1;
    
    return (successRate * 0.8) + (latencyScore * 0.2);
  }
  
  private calculateScoringHealth(): number {
    // Health based on scoring coverage and accuracy
    const coverageScore = this.systemMetrics.agentCount > 0 ? 
      Math.min(1, this.systemMetrics.activeAgents / this.systemMetrics.agentCount) : 1;
    
    return coverageScore;
  }
  
  private calculateAlertingHealth(): number {
    // Health based on alert responsiveness
    return 0.95; // Placeholder
  }
  
  private calculatePersistenceHealth(): number {
    // Health based on data persistence success
    return 0.98; // Placeholder
  }
  
  private calculateAvailability(uptimeMs: number): number {
    // Simple availability calculation
    const uptimeHours = uptimeMs / (60 * 60 * 1000);
    return Math.min(1, uptimeHours / (uptimeHours + 0.1)); // Assume minimal downtime
  }
  
  private calculateCurrentLoad(): number {
    // Load based on current processing
    return this.metricsBuffer.length;
  }
  
  private calculateMaxCapacity(): number {
    // Maximum capacity based on configuration
    return this.config.bufferSize;
  }
  
  private calculateUtilizationRate(): number {
    // Utilization rate
    const maxCapacity = this.calculateMaxCapacity();
    return maxCapacity > 0 ? this.calculateCurrentLoad() / maxCapacity : 0;
  }
  
  private generatePredictionRecommendations(
    metricName: string,
    prediction: { value: number; confidence: number },
    factors: PredictionFactor[]
  ): string[] {
    const recommendations: string[] = [];
    
    // Low confidence recommendations
    if (prediction.confidence < 0.5) {
      recommendations.push('Increase data collection frequency for better predictions');
      recommendations.push('Implement additional monitoring points');
    }
    
    // Metric-specific recommendations
    if (metricName === 'overallAccuracy' && prediction.value < 0.9) {
      recommendations.push('Implement additional validation checks');
      recommendations.push('Consider agent retraining or calibration');
    }
    
    if (metricName === 'humanInterventionRate' && prediction.value > 0.15) {
      recommendations.push('Analyze common intervention patterns');
      recommendations.push('Improve automated decision-making capabilities');
    }
    
    // Factor-based recommendations
    factors.forEach(factor => {
      if (factor.impact < -0.3) {
        recommendations.push(`Address ${factor.name}: ${factor.description}`);
      }
    });
    
    return recommendations;
  }
  
  private initializeSystemMetrics(): void {
    this.systemMetrics = {
      timestamp: new Date(),
      overallAccuracy: 0.95,
      humanInterventionRate: 0.05,
      systemReliability: 0.98,
      agentCount: 0,
      activeAgents: 0,
      totalTasks: 0,
      verifiedTasks: 0,
      criticalFailures: 0,
      recoveryTime: 0,
      efficiency: 0.85,
      distributionMetrics: {
        taskDistribution: {},
        accuracyDistribution: {},
        complexityDistribution: {},
        errorTypeDistribution: {},
      },
    };
  }
  
  private initializeHealthIndicators(): void {
    this.healthIndicators = {
      timestamp: new Date(),
      overallHealth: 0.95,
      subsystemHealth: {
        collection: 0.95,
        validation: 0.92,
        scoring: 0.90,
        alerting: 0.98,
        persistence: 0.96,
      },
      performanceIndicators: {
        latency: 500,
        throughput: 50,
        errorRate: 0.02,
        availability: 0.99,
      },
      capacityMetrics: {
        currentLoad: 0,
        maxCapacity: 1000,
        utilizationRate: 0,
        queueDepth: 0,
      },
    };
  }
  
  // ========================================================================================
  // Public API
  // ========================================================================================
  
  getSystemMetrics(): SystemTruthMetrics {
    return { ...this.systemMetrics };
  }
  
  getHealthIndicators(): SystemHealthIndicators {
    return { ...this.healthIndicators };
  }
  
  getSystemTrends(): SystemTrend[] {
    return Array.from(this.systemTrends.values());
  }
  
  getTrend(metricName: string): SystemTrend | undefined {
    return this.systemTrends.get(metricName);
  }
  
  getPredictions(): SystemPrediction[] {
    return Array.from(this.predictions.values());
  }
  
  getPrediction(metricName: string): SystemPrediction | undefined {
    return this.predictions.get(metricName);
  }
  
  getDistributionAnalysis(metricName: string): DistributionAnalysis | undefined {
    return this.distributionAnalyses.get(metricName);
  }
  
  async performComprehensiveAnalysis(): Promise<{
    systemHealth: SystemHealthIndicators;
    trends: SystemTrend[];
    predictions: SystemPrediction[];
    recommendations: string[];
  }> {
    await this.performPeriodicAnalysis();
    await this.performPredictiveAnalysis();
    
    const recommendations = this.generateSystemRecommendations();
    
    return {
      systemHealth: this.healthIndicators,
      trends: Array.from(this.systemTrends.values()),
      predictions: Array.from(this.predictions.values()),
      recommendations,
    };
  }
  
  private generateSystemRecommendations(): string[] {
    const recommendations: string[] = [];
    
    // Health-based recommendations
    if (this.healthIndicators.overallHealth < 0.8) {
      recommendations.push('System health is degraded - investigate subsystem issues');
    }
    
    // Performance-based recommendations
    if (this.healthIndicators.performanceIndicators.errorRate > 0.05) {
      recommendations.push('High error rate detected - review validation processes');
    }
    
    // Capacity-based recommendations
    if (this.healthIndicators.capacityMetrics.utilizationRate > 0.8) {
      recommendations.push('High system utilization - consider scaling resources');
    }
    
    // Trend-based recommendations
    this.systemTrends.forEach(trend => {
      if (trend.direction === 'declining' && trend.significance === 'high') {
        recommendations.push(`${trend.metric} is declining significantly - immediate attention required`);
      }
    });
    
    return recommendations;
  }
  
  getSystemStatistics(): {
    totalMetricsProcessed: number;
    systemUptime: number;
    averageProcessingRate: number;
    healthScore: number;
    lastAnalysis: Date;
  } {
    const uptime = Date.now() - this.systemStartTime.getTime();
    const processingRate = uptime > 0 ? (this.totalMetricsProcessed / (uptime / 1000)) : 0;
    
    return {
      totalMetricsProcessed: this.totalMetricsProcessed,
      systemUptime: uptime,
      averageProcessingRate: processingRate,
      healthScore: this.healthIndicators.overallHealth,
      lastAnalysis: this.lastAnalysisTime,
    };
  }
}