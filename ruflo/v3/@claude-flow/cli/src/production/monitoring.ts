/**
 * Production Monitoring and Observability
 *
 * Provides monitoring hooks for:
 * - Request/response metrics
 * - Error tracking
 * - Performance monitoring
 * - Health checks
 * - Alerting
 *
 * @module @claude-flow/cli/production/monitoring
 */

// ============================================================================
// Types
// ============================================================================

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricEvent {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface MonitorConfig {
  // Enable monitoring
  enabled: boolean;
  // Metrics retention time (ms)
  retentionMs: number;
  // Maximum metrics to store
  maxMetrics: number;
  // Sampling rate (0-1)
  samplingRate: number;
  // Alert thresholds
  alertThresholds: Record<string, { warning: number; critical: number }>;
  // Health check interval (ms)
  healthCheckIntervalMs: number;
  // External reporting endpoint
  reportingEndpoint?: string;
  // Custom labels for all metrics
  globalLabels: Record<string, string>;
}

export interface HealthStatus {
  healthy: boolean;
  checks: Record<string, {
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
    lastCheck: number;
    responseTimeMs?: number;
  }>;
  timestamp: number;
}

export interface PerformanceMetrics {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  avgResponseTimeMs: number;
  p50ResponseTimeMs: number;
  p95ResponseTimeMs: number;
  p99ResponseTimeMs: number;
  activeRequests: number;
  uptime: number;
}

type AlertLevel = 'info' | 'warning' | 'critical';

interface Alert {
  id: string;
  level: AlertLevel;
  metric: string;
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
  acknowledged: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MonitorConfig = {
  enabled: true,
  retentionMs: 3600000, // 1 hour
  maxMetrics: 100000,
  samplingRate: 1.0,
  alertThresholds: {
    'error_rate': { warning: 0.05, critical: 0.1 },
    'response_time_ms': { warning: 1000, critical: 5000 },
    'active_requests': { warning: 100, critical: 500 },
  },
  healthCheckIntervalMs: 30000,
  globalLabels: {},
};

// ============================================================================
// Monitoring Implementation
// ============================================================================

export class MonitoringHooks {
  private config: MonitorConfig;
  private metrics: MetricEvent[] = [];
  private responseTimes: number[] = [];
  private alerts: Alert[] = [];
  private healthStatus: HealthStatus;
  private startTime = Date.now();
  private activeRequests = 0;
  private requestCount = 0;
  private errorCount = 0;
  private healthChecks: Map<string, () => Promise<{ healthy: boolean; message?: string }>> = new Map();

  constructor(config: Partial<MonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.healthStatus = {
      healthy: true,
      checks: {},
      timestamp: Date.now(),
    };
  }

  // ============================================================================
  // Metrics Collection
  // ============================================================================

  /**
   * Record a counter metric
   */
  counter(name: string, value: number = 1, labels: Record<string, string> = {}): void {
    this.recordMetric(name, 'counter', value, labels);
  }

  /**
   * Record a gauge metric
   */
  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.recordMetric(name, 'gauge', value, labels);
  }

  /**
   * Record a histogram metric
   */
  histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    this.recordMetric(name, 'histogram', value, labels);
  }

  /**
   * Record a metric event
   */
  private recordMetric(
    name: string,
    type: MetricType,
    value: number,
    labels: Record<string, string>
  ): void {
    if (!this.config.enabled) return;

    // Apply sampling
    if (Math.random() > this.config.samplingRate) return;

    const event: MetricEvent = {
      name,
      type,
      value,
      labels: { ...this.config.globalLabels, ...labels },
      timestamp: Date.now(),
    };

    this.metrics.push(event);

    // Check alerts
    this.checkAlerts(name, value);

    // Cleanup old metrics
    this.cleanupMetrics();
  }

  // ============================================================================
  // Request Tracking
  // ============================================================================

  /**
   * Start tracking a request
   */
  startRequest(requestId: string): () => void {
    this.activeRequests++;
    this.requestCount++;
    const startTime = Date.now();

    this.counter('request_started', 1, { requestId });

    // Return end function
    return () => {
      this.activeRequests--;
      const duration = Date.now() - startTime;
      this.responseTimes.push(duration);
      this.histogram('response_time_ms', duration, { requestId });

      // Keep only last 1000 response times
      if (this.responseTimes.length > 1000) {
        this.responseTimes = this.responseTimes.slice(-1000);
      }
    };
  }

  /**
   * Record an error
   */
  recordError(error: Error, labels: Record<string, string> = {}): void {
    this.errorCount++;
    this.counter('error', 1, {
      ...labels,
      errorType: error.name,
      errorMessage: error.message.slice(0, 100),
    });
  }

  // ============================================================================
  // Health Checks
  // ============================================================================

  /**
   * Register a health check
   */
  registerHealthCheck(
    name: string,
    check: () => Promise<{ healthy: boolean; message?: string }>
  ): void {
    this.healthChecks.set(name, check);
  }

  /**
   * Run all health checks
   */
  async runHealthChecks(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = {};
    let allHealthy = true;

    for (const [name, check] of this.healthChecks) {
      const startTime = Date.now();
      try {
        const result = await check();
        checks[name] = {
          status: result.healthy ? 'healthy' : 'unhealthy',
          message: result.message,
          lastCheck: Date.now(),
          responseTimeMs: Date.now() - startTime,
        };
        if (!result.healthy) allHealthy = false;
      } catch (error) {
        checks[name] = {
          status: 'unhealthy',
          message: (error as Error).message,
          lastCheck: Date.now(),
          responseTimeMs: Date.now() - startTime,
        };
        allHealthy = false;
      }
    }

    this.healthStatus = {
      healthy: allHealthy,
      checks,
      timestamp: Date.now(),
    };

    return this.healthStatus;
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HealthStatus {
    return this.healthStatus;
  }

  // ============================================================================
  // Performance Metrics
  // ============================================================================

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const sortedTimes = [...this.responseTimes].sort((a, b) => a - b);
    const count = sortedTimes.length;

    const percentile = (p: number) => {
      if (count === 0) return 0;
      const index = Math.ceil(count * p) - 1;
      return sortedTimes[Math.min(index, count - 1)];
    };

    const avgResponseTime = count > 0
      ? sortedTimes.reduce((a, b) => a + b, 0) / count
      : 0;

    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount > 0 ? this.errorCount / this.requestCount : 0,
      avgResponseTimeMs: Math.round(avgResponseTime),
      p50ResponseTimeMs: percentile(0.5),
      p95ResponseTimeMs: percentile(0.95),
      p99ResponseTimeMs: percentile(0.99),
      activeRequests: this.activeRequests,
      uptime: Date.now() - this.startTime,
    };
  }

  // ============================================================================
  // Alerting
  // ============================================================================

  /**
   * Get active alerts
   */
  getAlerts(level?: AlertLevel): Alert[] {
    let filtered = this.alerts.filter(a => !a.acknowledged);
    if (level) {
      filtered = filtered.filter(a => a.level === level);
    }
    return filtered;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * Clear all alerts
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  // ============================================================================
  // Data Export
  // ============================================================================

  /**
   * Get metrics for a specific name
   */
  getMetrics(name: string, since?: number): MetricEvent[] {
    let filtered = this.metrics.filter(m => m.name === name);
    if (since) {
      filtered = filtered.filter(m => m.timestamp >= since);
    }
    return filtered;
  }

  /**
   * Get all metrics summary
   */
  getMetricsSummary(): Record<string, { count: number; lastValue: number; avgValue: number }> {
    const summary: Record<string, { count: number; sum: number; lastValue: number }> = {};

    for (const metric of this.metrics) {
      if (!summary[metric.name]) {
        summary[metric.name] = { count: 0, sum: 0, lastValue: 0 };
      }
      summary[metric.name].count++;
      summary[metric.name].sum += metric.value;
      summary[metric.name].lastValue = metric.value;
    }

    const result: Record<string, { count: number; lastValue: number; avgValue: number }> = {};
    for (const [name, data] of Object.entries(summary)) {
      result[name] = {
        count: data.count,
        lastValue: data.lastValue,
        avgValue: data.count > 0 ? data.sum / data.count : 0,
      };
    }

    return result;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = [];
    this.responseTimes = [];
    this.alerts = [];
    this.requestCount = 0;
    this.errorCount = 0;
    this.activeRequests = 0;
    this.startTime = Date.now();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private checkAlerts(name: string, value: number): void {
    const thresholds = this.config.alertThresholds[name];
    if (!thresholds) return;

    let level: AlertLevel | null = null;
    let threshold = 0;

    if (value >= thresholds.critical) {
      level = 'critical';
      threshold = thresholds.critical;
    } else if (value >= thresholds.warning) {
      level = 'warning';
      threshold = thresholds.warning;
    }

    if (level) {
      // Check if we already have a recent alert for this metric
      const recentAlert = this.alerts.find(
        a => a.metric === name &&
        !a.acknowledged &&
        Date.now() - a.timestamp < 60000
      );

      if (!recentAlert) {
        this.alerts.push({
          id: `alert_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          level,
          metric: name,
          message: `${name} exceeded ${level} threshold: ${value} >= ${threshold}`,
          value,
          threshold,
          timestamp: Date.now(),
          acknowledged: false,
        });
      }
    }
  }

  private cleanupMetrics(): void {
    const now = Date.now();
    const cutoff = now - this.config.retentionMs;

    // Remove old metrics
    this.metrics = this.metrics.filter(m => m.timestamp > cutoff);

    // Limit total metrics
    if (this.metrics.length > this.config.maxMetrics) {
      this.metrics = this.metrics.slice(-this.config.maxMetrics);
    }

    // Remove old acknowledged alerts
    this.alerts = this.alerts.filter(
      a => !a.acknowledged || Date.now() - a.timestamp < 300000
    );
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

let defaultMonitor: MonitoringHooks | null = null;

/**
 * Create or get the default monitor
 */
export function createMonitor(config?: Partial<MonitorConfig>): MonitoringHooks {
  if (!defaultMonitor) {
    defaultMonitor = new MonitoringHooks(config);
  }
  return defaultMonitor;
}

/**
 * Get the default monitor
 */
export function getMonitor(): MonitoringHooks {
  return createMonitor();
}

export default MonitoringHooks;
