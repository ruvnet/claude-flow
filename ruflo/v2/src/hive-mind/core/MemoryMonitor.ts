/**
 * Memory Monitor and Optimization System
 *
 * Provides real-time monitoring, analysis, and optimization
 * recommendations for the Hive Mind memory subsystem.
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { Memory } from './Memory.js';
import { DatabaseManager } from './DatabaseManager.js';

interface MemoryAlert {
  level: 'info' | 'warning' | 'critical';
  type: string;
  message: string;
  value: number;
  threshold: number;
  timestamp: Date;
  recommendations: string[];
}

interface OptimizationSuggestion {
  type: 'cache' | 'database' | 'pool' | 'compression' | 'cleanup';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  estimatedImpact: string;
  implementation: string;
  effort: 'minimal' | 'moderate' | 'significant';
}

interface MemoryHealthReport {
  overall: {
    score: number;
    status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    summary: string;
  };
  metrics: {
    cacheHitRate: number;
    avgQueryTime: number;
    memoryUtilization: number;
    compressionRatio: number;
    poolEfficiency: number;
  };
  alerts: MemoryAlert[];
  suggestions: OptimizationSuggestion[];
  trends: {
    performance: 'improving' | 'stable' | 'degrading';
    memoryUsage: 'increasing' | 'stable' | 'decreasing';
    cacheEfficiency: 'improving' | 'stable' | 'degrading';
  };
}

export class MemoryMonitor extends EventEmitter {
  private memory: Memory;
  private db: DatabaseManager;
  private isActive = false;
  private monitoringTimers: NodeJS.Timeout[] = [];
  private historicalData: Map<string, number[]> = new Map();
  private alertThresholds = {
    cacheHitRate: { warning: 50, critical: 30 },
    avgQueryTime: { warning: 100, critical: 500 },
    memoryUtilization: { warning: 80, critical: 95 },
    poolReuseRate: { warning: 30, critical: 10 },
  };
  private alerts: MemoryAlert[] = [];
  private maxHistorySize = 1000;

  constructor(memory: Memory, db: DatabaseManager) {
    super();
    this.memory = memory;
    this.db = db;
  }

  /**
   * Start memory monitoring
   */
  async start(): Promise<void> {
    if (this.isActive) return;

    this.isActive = true;

    // Real-time monitoring (every 10 seconds)
    const realtimeTimer = setInterval(() => {
      this.collectMetrics();
    }, 10000);

    // Health analysis (every minute)
    const healthTimer = setInterval(() => {
      this.analyzeHealth();
    }, 60000);

    // Trend analysis (every 5 minutes)
    const trendTimer = setInterval(() => {
      this.analyzeTrends();
    }, 300000);

    // Optimization suggestions (every 15 minutes)
    const optimizationTimer = setInterval(() => {
      this.generateOptimizationSuggestions();
    }, 900000);

    // Alert cleanup (every hour)
    const cleanupTimer = setInterval(() => {
      this.cleanupOldAlerts();
    }, 3600000);

    this.monitoringTimers.push(
      realtimeTimer,
      healthTimer,
      trendTimer,
      optimizationTimer,
      cleanupTimer,
    );

    // Initial baseline collection
    await this.establishBaseline();

    this.emit('monitoring:started');
  }

  /**
   * Stop memory monitoring
   */
  stop(): void {
    this.isActive = false;

    this.monitoringTimers.forEach((timer) => clearInterval(timer));
    this.monitoringTimers.length = 0;

    this.emit('monitoring:stopped');
  }

  /**
   * Collect real-time metrics
   */
  private async collectMetrics(): Promise<void> {
    if (!this.isActive) return;

    try {
      const startTime = performance.now();

      // Get memory analytics
      const memoryAnalytics = this.memory.getAdvancedAnalytics();
      const dbAnalytics = this.db.getDatabaseAnalytics();

      // Extract key metrics
      const metrics = {
        cacheHitRate: memoryAnalytics.cache.hitRate || 0,
        avgQueryTime: dbAnalytics.performance.query_execution?.avg || 0,
        memoryUtilization: memoryAnalytics.cache.utilizationPercent || 0,
        poolEfficiency: this.calculatePoolEfficiency(memoryAnalytics.pools),
        dbFragmentation: dbAnalytics.fragmentation || 0,
        activeConnections: 1, // Simplified for now
        timestamp: Date.now(),
      };

      // Store historical data
      this.storeHistoricalData(metrics);

      // Check for alerts
      this.checkAlerts(metrics);

      const duration = performance.now() - startTime;
      this.emit('metrics:collected', { metrics, duration });
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Establish performance baseline
   */
  private async establishBaseline(): Promise<void> {
    const samples = [];

    for (let i = 0; i < 10; i++) {
      await this.collectMetrics();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    this.emit('baseline:established', { samples: samples.length });
  }

  /**
   * Store historical performance data
   */
  private storeHistoricalData(metrics: any): void {
    for (const [key, value] of Object.entries(metrics)) {
      if (typeof value === 'number') {
        if (!this.historicalData.has(key)) {
          this.historicalData.set(key, []);
        }

        const history = this.historicalData.get(key)!;
        history.push(value);

        // Limit history size
        if (history.length > this.maxHistorySize) {
          history.shift();
        }
      }
    }
  }

  /**
   * Check metrics against alert thresholds
   */
  private checkAlerts(metrics: any): void {
    const newAlerts: MemoryAlert[] = [];

    // Cache hit rate alerts
    const cacheHitRate = metrics.cacheHitRate;
    if (cacheHitRate < this.alertThresholds.cacheHitRate.critical) {
      newAlerts.push({
        level: 'critical',
        type: 'cache_performance',
        message: `Cache hit rate critically low: ${cacheHitRate.toFixed(1)}%`,
        value: cacheHitRate,
        threshold: this.alertThresholds.cacheHitRate.critical,
        timestamp: new Date(),
        recommendations: [
          'Increase cache size immediately',
          'Review access patterns',
          'Consider cache warming strategies',
        ],
      });
    } else if (cacheHitRate < this.alertThresholds.cacheHitRate.warning) {
      newAlerts.push({
        level: 'warning',
        type: 'cache_performance',
        message: `Cache hit rate below optimal: ${cacheHitRate.toFixed(1)}%`,
        value: cacheHitRate,
        threshold: this.alertThresholds.cacheHitRate.warning,
        timestamp: new Date(),
        recommendations: [
          'Monitor cache patterns',
          'Consider increasing cache size',
          'Review cache eviction policy',
        ],
      });
    }

    // Query performance alerts
    const avgQueryTime = metrics.avgQueryTime;
    if (avgQueryTime > this.alertThresholds.avgQueryTime.critical) {
      newAlerts.push({
        level: 'critical',
        type: 'query_performance',
        message: `Query performance critically slow: ${avgQueryTime.toFixed(1)}ms`,
        value: avgQueryTime,
        threshold: this.alertThresholds.avgQueryTime.critical,
        timestamp: new Date(),
        recommendations: [
          'Immediate database optimization required',
          'Review query plans and indexes',
          'Consider query result caching',
        ],
      });
    } else if (avgQueryTime > this.alertThresholds.avgQueryTime.warning) {
      newAlerts.push({
        level: 'warning',
        type: 'query_performance',
        message: `Query performance degraded: ${avgQueryTime.toFixed(1)}ms`,
        value: avgQueryTime,
        threshold: this.alertThresholds.avgQueryTime.warning,
        timestamp: new Date(),
        recommendations: [
          'Monitor query performance trends',
          'Consider database maintenance',
          'Review recent schema changes',
        ],
      });
    }

    // Memory utilization alerts
    const memoryUtilization = metrics.memoryUtilization;
    if (memoryUtilization > this.alertThresholds.memoryUtilization.critical) {
      newAlerts.push({
        level: 'critical',
        type: 'memory_utilization',
        message: `Memory utilization critical: ${memoryUtilization.toFixed(1)}%`,
        value: memoryUtilization,
        threshold: this.alertThresholds.memoryUtilization.critical,
        timestamp: new Date(),
        recommendations: [
          'Immediate memory cleanup required',
          'Increase memory limits',
          'Enable aggressive garbage collection',
        ],
      });
    } else if (memoryUtilization > this.alertThresholds.memoryUtilization.warning) {
      newAlerts.push({
        level: 'warning',
        type: 'memory_utilization',
        message: `Memory utilization high: ${memoryUtilization.toFixed(1)}%`,
        value: memoryUtilization,
        threshold: this.alertThresholds.memoryUtilization.warning,
        timestamp: new Date(),
        recommendations: [
          'Monitor memory usage trends',
          'Consider memory optimization',
          'Review cache sizes',
        ],
      });
    }

    // Add new alerts and emit events
    if (newAlerts.length > 0) {
      this.alerts.push(...newAlerts);
      newAlerts.forEach((alert) => {
        this.emit('alert', alert);
      });
    }
  }

  /**
   * Analyze overall system health
   */
  private async analyzeHealth(): Promise<void> {
    const memoryHealth = await this.memory.healthCheck();
    const dbHealth = await this.db.healthCheck();
    const analytics = this.memory.getAdvancedAnalytics();

    const healthReport: MemoryHealthReport = {
      overall: {
        score: this.calculateOverallScore(memoryHealth, dbHealth, analytics),
        status: 'good',
        summary: '',
      },
      metrics: {
        cacheHitRate: analytics.cache.hitRate || 0,
        avgQueryTime: this.getAverageFromHistory('avgQueryTime'),
        memoryUtilization: analytics.cache.utilizationPercent || 0,
        compressionRatio: 0.7, // Simplified
        poolEfficiency: this.calculatePoolEfficiency(analytics.pools),
      },
      alerts: this.getActiveAlerts(),
      suggestions: this.generateHealthSuggestions(analytics),
      trends: this.calculateTrends(),
    };

    // Determine status
    if (healthReport.overall.score >= 90) {
      healthReport.overall.status = 'excellent';
    } else if (healthReport.overall.score >= 75) {
      healthReport.overall.status = 'good';
    } else if (healthReport.overall.score >= 60) {
      healthReport.overall.status = 'fair';
    } else if (healthReport.overall.score >= 40) {
      healthReport.overall.status = 'poor';
    } else {
      healthReport.overall.status = 'critical';
    }

    // Generate summary
    healthReport.overall.summary = this.generateHealthSummary(healthReport);

    this.emit('health:analyzed', healthReport);
  }

  /**
   * Generate optimization suggestions
   */
  private generateOptimizationSuggestions(): void {
    const analytics = this.memory.getAdvancedAnalytics();
    const suggestions: OptimizationSuggestion[] = [];

    // Cache optimization suggestions
    if ((analytics.cache.hitRate || 0) < 70) {
      suggestions.push({
        type: 'cache',
        priority: 'high',
        title: 'Optimize Cache Configuration',
        description: 'Cache hit rate is below optimal threshold',
        estimatedImpact: 'Reduce database queries by 20-40%',
        implementation: 'Increase cache size and adjust eviction policy',
        effort: 'minimal',
      });
    }

    // Database optimization suggestions
    const avgQueryTime = this.getAverageFromHistory('avgQueryTime');
    if (avgQueryTime > 50) {
      suggestions.push({
        type: 'database',
        priority: 'medium',
        title: 'Database Performance Tuning',
        description: 'Query execution times are above optimal range',
        estimatedImpact: 'Improve query performance by 30-50%',
        implementation: 'Add indexes, optimize queries, run ANALYZE',
        effort: 'moderate',
      });
    }

    // Pool optimization suggestions
    const poolEfficiency = this.calculatePoolEfficiency(analytics.pools);
    if (poolEfficiency < 50) {
      suggestions.push({
        type: 'pool',
        priority: 'low',
        title: 'Object Pool Optimization',
        description: 'Object pools have low reuse rates',
        estimatedImpact: 'Reduce garbage collection pressure',
        implementation: 'Increase pool sizes and improve object lifecycle',
        effort: 'minimal',
      });
    }

    this.emit('suggestions:generated', suggestions);
  }

  /**
   * Calculate pool efficiency
   */
  private calculatePoolEfficiency(pools: any): number {
    if (!pools) return 0;

    const efficiencies = Object.values(pools).map((pool: any) => pool.reuseRate || 0);
    return efficiencies.length > 0
      ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length
      : 0;
  }

  /**
   * Get average value from historical data
   */
  private getAverageFromHistory(metric: string): number {
    const history = this.historicalData.get(metric);
    if (!history || history.length === 0) return 0;

    return history.reduce((a, b) => a + b, 0) / history.length;
  }

  /**
   * Calculate overall health score
   */
  private calculateOverallScore(memoryHealth: any, dbHealth: any, analytics: any): number {
    let score = 100;

    // Cache performance impact (30%)
    const cacheHitRate = analytics.cache.hitRate || 0;
    score -= Math.max(0, (70 - cacheHitRate) * 0.3);

    // Query performance impact (25%)
    const avgQueryTime = this.getAverageFromHistory('avgQueryTime');
    if (avgQueryTime > 50) {
      score -= Math.min(25, (avgQueryTime - 50) * 0.5);
    }

    // Memory utilization impact (20%)
    const memoryUtil = analytics.cache.utilizationPercent || 0;
    if (memoryUtil > 80) {
      score -= (memoryUtil - 80) * 0.5;
    }

    // Active alerts impact (15%)
    const criticalAlerts = this.alerts.filter((a) => a.level === 'critical').length;
    const warningAlerts = this.alerts.filter((a) => a.level === 'warning').length;
    score -= criticalAlerts * 10 + warningAlerts * 5;

    // Pool efficiency impact (10%)
    const poolEff = this.calculatePoolEfficiency(analytics.pools);
    score -= Math.max(0, (50 - poolEff) * 0.2);

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get active alerts (within last hour)
   */
  private getActiveAlerts(): MemoryAlert[] {
    const oneHourAgo = Date.now() - 3600000;
    return this.alerts.filter((alert) => alert.timestamp.getTime() > oneHourAgo);
  }

  /**
   * Generate health-based suggestions
   */
  private generateHealthSuggestions(analytics: any): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Add specific suggestions based on current state
    if ((analytics.cache.utilizationPercent || 0) > 90) {
      suggestions.push({
        type: 'cache',
        priority: 'critical',
        title: 'Immediate Cache Memory Relief',
        description: 'Cache memory utilization is critically high',
        estimatedImpact: 'Prevent system instability',
        implementation: 'Increase cache memory limit or enable aggressive cleanup',
        effort: 'minimal',
      });
    }

    return suggestions;
  }

  /**
   * Calculate performance trends
   */
  private calculateTrends(): any {
    const trends = {
      performance: 'stable' as 'improving' | 'stable' | 'degrading',
      memoryUsage: 'stable' as 'increasing' | 'stable' | 'decreasing',
      cacheEfficiency: 'stable' as 'improving' | 'stable' | 'degrading',
    };

    // Analyze query time trend
    const queryTimes = this.historicalData.get('avgQueryTime') || [];
    if (queryTimes.length >= 10) {
      const recent = queryTimes.slice(-5);
      const older = queryTimes.slice(-10, -5);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

      if (recentAvg < olderAvg * 0.9) {
        trends.performance = 'improving';
      } else if (recentAvg > olderAvg * 1.1) {
        trends.performance = 'degrading';
      }
    }

    // Analyze memory usage trend
    const memoryUsage = this.historicalData.get('memoryUtilization') || [];
    if (memoryUsage.length >= 10) {
      const recent = memoryUsage.slice(-5);
      const older = memoryUsage.slice(-10, -5);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

      if (recentAvg > olderAvg * 1.05) {
        trends.memoryUsage = 'increasing';
      } else if (recentAvg < olderAvg * 0.95) {
        trends.memoryUsage = 'decreasing';
      }
    }

    // Analyze cache efficiency trend
    const cacheHitRates = this.historicalData.get('cacheHitRate') || [];
    if (cacheHitRates.length >= 10) {
      const recent = cacheHitRates.slice(-5);
      const older = cacheHitRates.slice(-10, -5);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

      if (recentAvg > olderAvg * 1.05) {
        trends.cacheEfficiency = 'improving';
      } else if (recentAvg < olderAvg * 0.95) {
        trends.cacheEfficiency = 'degrading';
      }
    }

    return trends;
  }

  /**
   * Analyze trends over time
   */
  private analyzeTrends(): void {
    const trends = this.calculateTrends();
    this.emit('trends:analyzed', trends);
  }

  /**
   * Generate health summary
   */
  private generateHealthSummary(report: MemoryHealthReport): string {
    const { overall, metrics, alerts } = report;

    if (overall.status === 'excellent') {
      return 'All memory systems are operating at peak efficiency with optimal performance metrics.';
    } else if (overall.status === 'good') {
      return 'Memory systems are performing well with minor optimization opportunities.';
    } else if (overall.status === 'fair') {
      return `Memory performance is acceptable but ${alerts.length} issue(s) need attention.`;
    } else if (overall.status === 'poor') {
      return `Memory systems require optimization. Cache hit rate: ${metrics.cacheHitRate.toFixed(1)}%, Avg query time: ${metrics.avgQueryTime.toFixed(1)}ms.`;
    } else {
      return `Critical memory issues detected. Immediate intervention required. ${alerts.filter((a) => a.level === 'critical').length} critical alert(s) active.`;
    }
  }

  /**
   * Clean up old alerts
   */
  private cleanupOldAlerts(): void {
    const cutoff = Date.now() - 86400000; // 24 hours
    const initialCount = this.alerts.length;

    this.alerts = this.alerts.filter((alert) => alert.timestamp.getTime() > cutoff);

    const cleaned = initialCount - this.alerts.length;
    if (cleaned > 0) {
      this.emit('alerts:cleaned', { cleaned });
    }
  }

  /**
   * Get current monitoring status
   */
  getStatus() {
    return {
      isActive: this.isActive,
      alertCount: this.alerts.length,
      criticalAlerts: this.alerts.filter((a) => a.level === 'critical').length,
      warningAlerts: this.alerts.filter((a) => a.level === 'warning').length,
      historicalDataPoints: Array.from(this.historicalData.entries()).map(([key, values]) => ({
        metric: key,
        samples: values.length,
      })),
    };
  }

  /**
   * Get detailed memory report
   */
  async generateDetailedReport(): Promise<MemoryHealthReport> {
    const memoryHealth = await this.memory.healthCheck();
    const dbHealth = await this.db.healthCheck();
    const analytics = this.memory.getAdvancedAnalytics();

    return {
      overall: {
        score: this.calculateOverallScore(memoryHealth, dbHealth, analytics),
        status: 'good',
        summary: '',
      },
      metrics: {
        cacheHitRate: analytics.cache.hitRate || 0,
        avgQueryTime: this.getAverageFromHistory('avgQueryTime'),
        memoryUtilization: analytics.cache.utilizationPercent || 0,
        compressionRatio: 0.7,
        poolEfficiency: this.calculatePoolEfficiency(analytics.pools),
      },
      alerts: this.getActiveAlerts(),
      suggestions: this.generateHealthSuggestions(analytics),
      trends: this.calculateTrends(),
    };
  }

  /**
   * Export monitoring data for analysis
   */
  exportData() {
    return {
      historicalData: Object.fromEntries(this.historicalData),
      alerts: this.alerts,
      thresholds: this.alertThresholds,
      status: this.getStatus(),
    };
  }
}
