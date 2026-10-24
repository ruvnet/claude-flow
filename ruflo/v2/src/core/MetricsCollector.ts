/**
 * MetricsCollector - Performance and coordination tracking
 * Collects, aggregates, and analyzes system performance metrics
 */

import { IDatabaseProvider, InitializationMetrics, Metrics, PerformanceMetrics } from '../types/interfaces.js';

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  score: number; // 0-100
  issues: string[];
  recommendations: string[];
}

export interface PerformanceTrend {
  metric: string;
  trend: 'improving' | 'stable' | 'degrading';
  change: number; // percentage change
  period: string;
}

export interface Benchmark {
  name: string;
  value: number;
  unit: string;
  timestamp: Date;
  baseline?: number;
  percentile?: number;
}

export class MetricsCollector {
  private metricsBuffer: Map<string, any[]> = new Map();
  private initialized: boolean = false;

  constructor(private database: IDatabaseProvider) {}

  /**
   * Initialize metrics collection
   */
  async initialize(): Promise<void> {
    // Create metrics tables/collections if using database
    await this.setupMetricsStorage();
    this.initialized = true;
  }

  /**
   * Setup metrics storage structure
   */
  private async setupMetricsStorage(): Promise<void> {
    // Initialize metrics namespaces
    const namespaces = [
      'initialization',
      'system',
      'performance',
      'agents',
      'consensus',
      'topology',
      'benchmarks'
    ];

    for (const namespace of namespaces) {
      try {
        await this.database.store(`metrics-${namespace}-init`, {
          initialized: true,
          timestamp: new Date().toISOString()
        }, 'metrics');
      } catch (error) {
        console.warn(`Failed to initialize metrics namespace ${namespace}:`, error);
      }
    }
  }

  /**
   * Record initialization metrics
   */
  async recordInitialization(metrics: InitializationMetrics): Promise<void> {
    const key = `init-${Date.now()}`;
    await this.database.store(key, metrics, 'metrics');

    // Update aggregated initialization stats
    await this.updateAggregatedMetrics('initialization', metrics);
  }

  /**
   * Record system metrics
   */
  async recordSystemMetrics(metrics: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkLatency: number;
    activeConnections: number;
    timestamp?: Date;
  }): Promise<void> {
    const timestampedMetrics = {
      ...metrics,
      timestamp: metrics.timestamp || new Date()
    };

    const key = `system-${Date.now()}`;
    await this.database.store(key, timestampedMetrics, 'metrics');

    // Buffer for real-time analysis
    this.addToBuffer('system', timestampedMetrics);
  }

  /**
   * Record agent performance metrics
   */
  async recordAgentMetrics(agentId: string, metrics: {
    tasksCompleted: number;
    successRate: number;
    averageResponseTime: number;
    resourceUtilization: any;
    timestamp?: Date;
  }): Promise<void> {
    const timestampedMetrics = {
      agentId,
      ...metrics,
      timestamp: metrics.timestamp || new Date()
    };

    const key = `agent-${agentId}-${Date.now()}`;
    await this.database.store(key, timestampedMetrics, 'metrics');

    this.addToBuffer('agents', timestampedMetrics);
  }

  /**
   * Record consensus metrics
   */
  async recordConsensusMetrics(metrics: {
    algorithm: string;
    decisionId: string;
    participantCount: number;
    consensusTime: number;
    outcome: boolean;
    confidence: number;
    timestamp?: Date;
  }): Promise<void> {
    const timestampedMetrics = {
      ...metrics,
      timestamp: metrics.timestamp || new Date()
    };

    const key = `consensus-${metrics.decisionId}`;
    await this.database.store(key, timestampedMetrics, 'metrics');

    this.addToBuffer('consensus', timestampedMetrics);
  }

  /**
   * Record topology metrics
   */
  async recordTopologyMetrics(metrics: {
    type: string;
    agentCount: number;
    connectionCount: number;
    averageLatency: number;
    throughput: number;
    reliability: number;
    timestamp?: Date;
  }): Promise<void> {
    const timestampedMetrics = {
      ...metrics,
      timestamp: metrics.timestamp || new Date()
    };

    const key = `topology-${Date.now()}`;
    await this.database.store(key, timestampedMetrics, 'metrics');

    this.addToBuffer('topology', timestampedMetrics);
  }

  /**
   * Record performance benchmark
   */
  async recordBenchmark(benchmark: Benchmark): Promise<void> {
    const key = `benchmark-${benchmark.name}-${Date.now()}`;
    await this.database.store(key, benchmark, 'metrics');

    this.addToBuffer('benchmarks', benchmark);
  }

  /**
   * Get initialization metrics
   */
  async getInitializationMetrics(): Promise<{
    total: number;
    successful: number;
    failed: number;
    averageDuration: number;
    modeDistribution: Record<string, number>;
    recentMetrics: InitializationMetrics[];
  }> {
    const keys = await this.database.list('metrics');
    const initKeys = keys.filter(key => key.startsWith('init-'));

    const metrics: InitializationMetrics[] = [];
    for (const key of initKeys) {
      const metric = await this.database.retrieve(key, 'metrics');
      if (metric) metrics.push(metric);
    }

    // Sort by timestamp (most recent first)
    metrics.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total = metrics.length;
    const successful = metrics.filter(m => m.success).length;
    const failed = total - successful;

    const durations = metrics.map(m => m.duration).filter(d => d > 0);
    const averageDuration = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

    // Mode distribution
    const modeDistribution: Record<string, number> = {};
    metrics.forEach(m => {
      modeDistribution[m.mode] = (modeDistribution[m.mode] || 0) + 1;
    });

    return {
      total,
      successful,
      failed,
      averageDuration,
      modeDistribution,
      recentMetrics: metrics.slice(0, 10) // Last 10 initializations
    };
  }

  /**
   * Get system health status
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const systemMetrics = this.getBufferedMetrics('system', 10); // Last 10 measurements

    if (systemMetrics.length === 0) {
      return {
        status: 'critical',
        score: 0,
        issues: ['No system metrics available'],
        recommendations: ['Ensure metrics collection is working']
      };
    }

    const latest = systemMetrics[systemMetrics.length - 1];
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Check CPU usage
    if (latest.cpuUsage > 90) {
      issues.push('High CPU usage');
      recommendations.push('Consider scaling or optimizing CPU-intensive tasks');
      score -= 30;
    } else if (latest.cpuUsage > 70) {
      issues.push('Elevated CPU usage');
      score -= 15;
    }

    // Check memory usage
    if (latest.memoryUsage > 90) {
      issues.push('High memory usage');
      recommendations.push('Check for memory leaks or increase available memory');
      score -= 25;
    } else if (latest.memoryUsage > 70) {
      issues.push('Elevated memory usage');
      score -= 10;
    }

    // Check network latency
    if (latest.networkLatency > 100) {
      issues.push('High network latency');
      recommendations.push('Check network connectivity and optimize communication');
      score -= 20;
    }

    // Check trend (if we have historical data)
    if (systemMetrics.length >= 5) {
      const recent = systemMetrics.slice(-3);
      const older = systemMetrics.slice(-6, -3);

      const recentAvgCpu = recent.reduce((sum, m) => sum + m.cpuUsage, 0) / recent.length;
      const olderAvgCpu = older.reduce((sum, m) => sum + m.cpuUsage, 0) / older.length;

      if (recentAvgCpu > olderAvgCpu * 1.2) {
        issues.push('CPU usage trending upward');
        score -= 10;
      }
    }

    let status: 'healthy' | 'degraded' | 'critical';
    if (score >= 80) status = 'healthy';
    else if (score >= 50) status = 'degraded';
    else status = 'critical';

    return { status, score, issues, recommendations };
  }

  /**
   * Get performance trends
   */
  async getPerformanceTrends(period: string = '1h'): Promise<PerformanceTrend[]> {
    const trends: PerformanceTrend[] = [];

    // Analyze different metric types
    const metricTypes = ['system', 'agents', 'consensus', 'topology'];

    for (const type of metricTypes) {
      const metrics = this.getBufferedMetrics(type, 20);
      if (metrics.length < 2) continue;

      const recent = metrics.slice(-5);
      const older = metrics.slice(-10, -5);

      if (recent.length === 0 || older.length === 0) continue;

      // Calculate trends for different metrics
      switch (type) {
        case 'system':
          trends.push(...this.analyzeSystemTrends(recent, older, period));
          break;
        case 'agents':
          trends.push(...this.analyzeAgentTrends(recent, older, period));
          break;
        case 'consensus':
          trends.push(...this.analyzeConsensusTrends(recent, older, period));
          break;
        case 'topology':
          trends.push(...this.analyzeTopologyTrends(recent, older, period));
          break;
      }
    }

    return trends;
  }

  /**
   * Run performance benchmarks
   */
  async runBenchmarks(): Promise<Benchmark[]> {
    const benchmarks: Benchmark[] = [];

    // CPU benchmark
    const cpuStart = Date.now();
    for (let i = 0; i < 1000000; i++) {
      Math.sqrt(i);
    }
    const cpuTime = Date.now() - cpuStart;

    benchmarks.push({
      name: 'cpu-computation',
      value: cpuTime,
      unit: 'ms',
      timestamp: new Date(),
      baseline: 50 // Expected baseline
    });

    // Memory allocation benchmark
    const memStart = Date.now();
    const arrays = [];
    for (let i = 0; i < 1000; i++) {
      arrays.push(new Array(1000).fill(i));
    }
    const memTime = Date.now() - memStart;

    benchmarks.push({
      name: 'memory-allocation',
      value: memTime,
      unit: 'ms',
      timestamp: new Date(),
      baseline: 20
    });

    // Database I/O benchmark
    const dbStart = Date.now();
    for (let i = 0; i < 10; i++) {
      await this.database.store(`benchmark-test-${i}`, { value: i }, 'temp');
      await this.database.retrieve(`benchmark-test-${i}`, 'temp');
    }
    const dbTime = Date.now() - dbStart;

    benchmarks.push({
      name: 'database-io',
      value: dbTime,
      unit: 'ms',
      timestamp: new Date(),
      baseline: 100
    });

    // Store benchmarks
    for (const benchmark of benchmarks) {
      await this.recordBenchmark(benchmark);
    }

    return benchmarks;
  }

  /**
   * Get performance summary
   */
  async getPerformanceSummary(): Promise<{
    health: SystemHealth;
    trends: PerformanceTrend[];
    benchmarks: Benchmark[];
    recommendations: string[];
  }> {
    const [health, trends, benchmarks] = await Promise.all([
      this.getSystemHealth(),
      this.getPerformanceTrends(),
      this.getRecentBenchmarks()
    ]);

    const recommendations = [
      ...health.recommendations,
      ...this.generateTrendRecommendations(trends),
      ...this.generateBenchmarkRecommendations(benchmarks)
    ];

    return {
      health,
      trends,
      benchmarks,
      recommendations: [...new Set(recommendations)] // Remove duplicates
    };
  }

  // Helper methods

  private addToBuffer(type: string, data: any): void {
    if (!this.metricsBuffer.has(type)) {
      this.metricsBuffer.set(type, []);
    }

    const buffer = this.metricsBuffer.get(type)!;
    buffer.push(data);

    // Keep buffer size manageable
    if (buffer.length > 100) {
      buffer.shift();
    }
  }

  private getBufferedMetrics(type: string, limit?: number): any[] {
    const buffer = this.metricsBuffer.get(type) || [];
    return limit ? buffer.slice(-limit) : buffer;
  }

  private async updateAggregatedMetrics(type: string, metrics: any): Promise<void> {
    const key = `aggregated-${type}`;
    const existing = await this.database.retrieve(key, 'metrics') || {
      count: 0,
      sum: {},
      avg: {}
    };

    // Update aggregated data (simplified example)
    existing.count++;
    existing.lastUpdated = new Date().toISOString();

    await this.database.store(key, existing, 'metrics');
  }

  private analyzeSystemTrends(recent: any[], older: any[], period: string): PerformanceTrend[] {
    const trends: PerformanceTrend[] = [];

    const recentAvgCpu = recent.reduce((sum, m) => sum + m.cpuUsage, 0) / recent.length;
    const olderAvgCpu = older.reduce((sum, m) => sum + m.cpuUsage, 0) / older.length;
    const cpuChange = ((recentAvgCpu - olderAvgCpu) / olderAvgCpu) * 100;

    trends.push({
      metric: 'cpu-usage',
      trend: cpuChange > 5 ? 'degrading' : cpuChange < -5 ? 'improving' : 'stable',
      change: cpuChange,
      period
    });

    return trends;
  }

  private analyzeAgentTrends(recent: any[], older: any[], period: string): PerformanceTrend[] {
    // Analyze agent performance trends
    return [];
  }

  private analyzeConsensusTrends(recent: any[], older: any[], period: string): PerformanceTrend[] {
    // Analyze consensus performance trends
    return [];
  }

  private analyzeTopologyTrends(recent: any[], older: any[], period: string): PerformanceTrend[] {
    // Analyze topology performance trends
    return [];
  }

  private async getRecentBenchmarks(): Promise<Benchmark[]> {
    const keys = await this.database.list('metrics');
    const benchmarkKeys = keys.filter(key => key.startsWith('benchmark-')).slice(-10);

    const benchmarks: Benchmark[] = [];
    for (const key of benchmarkKeys) {
      const benchmark = await this.database.retrieve(key, 'metrics');
      if (benchmark) benchmarks.push(benchmark);
    }

    return benchmarks;
  }

  private generateTrendRecommendations(trends: PerformanceTrend[]): string[] {
    const recommendations: string[] = [];

    trends.forEach(trend => {
      if (trend.trend === 'degrading') {
        recommendations.push(`${trend.metric} is degrading (${trend.change.toFixed(1)}% change) - investigate potential causes`);
      }
    });

    return recommendations;
  }

  private generateBenchmarkRecommendations(benchmarks: Benchmark[]): string[] {
    const recommendations: string[] = [];

    benchmarks.forEach(benchmark => {
      if (benchmark.baseline && benchmark.value > benchmark.baseline * 2) {
        recommendations.push(`${benchmark.name} performance is significantly below baseline - consider optimization`);
      }
    });

    return recommendations;
  }
}