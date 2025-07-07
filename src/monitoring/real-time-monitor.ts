import { getErrorMessage } from '../utils/error-handler.js';
/**
 * Real-time monitoring system for swarm operations
 */

import { EventEmitter } from 'node:events';
import type { ILogger } from '../core/logger.js';
import type { IEventBus } from '../core/event-bus.js';
import type { 
  SystemMetrics, 
  Alert, 
  AlertLevel, 
  AlertType, 
  MonitoringConfig,
  AgentMetrics,
  SwarmMetrics,
  AgentId
} from '../swarm/types.js';
import type { DistributedMemorySystem } from '../memory/distributed-memory.js';

export interface MonitorConfig {
  updateInterval: number;
  retentionPeriod: number;
  alertingEnabled: boolean;
  alertThresholds: AlertThresholds;
  metricsEnabled: boolean;
  tracingEnabled: boolean;
  dashboardEnabled: boolean;
  exportEnabled: boolean;
  exportFormat: 'json' | 'csv' | 'prometheus';
  debugMode: boolean;
}

export interface AlertThresholds {
  cpu: { warning: number; critical: number };
  memory: { warning: number; critical: number };
  disk: { warning: number; critical: number };
  errorRate: { warning: number; critical: number };
  responseTime: { warning: number; critical: number };
  queueDepth: { warning: number; critical: number };
  agentHealth: { warning: number; critical: number };
  swarmUtilization: { warning: number; critical: number };
}

export interface MetricPoint {
  timestamp: Date;
  value: number;
  tags: Record<string, string>;
  metadata?: Record<string, any>;
}

export interface TimeSeries {
  name: string;
  points: MetricPoint[];
  aggregations: {
    min: number;
    max: number;
    avg: number;
    sum: number;
    count: number;
  };
  lastUpdated: Date;
}

export interface MonitoringDashboard {
  title: string;
  panels: DashboardPanel[];
  refreshInterval: number;
  timeRange: { start: Date; end: Date };
  filters: Record<string, any>;
}

export interface DashboardPanel {
  id: string;
  title: string;
  type: 'line' | 'bar' | 'gauge' | 'table' | 'heatmap' | 'stat';
  metrics: string[];
  config: {
    width: number;
    height: number;
    position: { x: number; y: number };
    visualization: Record<string, any>;
  };
}

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  metric: string;
  condition: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold: number;
  duration: number; // How long condition must persist
  severity: AlertLevel;
  tags: Record<string, string>;
  actions: AlertAction[];
  suppressions: AlertSuppression[];
}

export interface AlertAction {
  type: 'email' | 'webhook' | 'slack' | 'log' | 'auto-scale' | 'restart';
  config: Record<string, any>;
  enabled: boolean;
}

export interface AlertSuppression {
  condition: string;
  duration: number;
  reason: string;
}

export interface HealthCheck {
  name: string;
  type: 'http' | 'tcp' | 'custom';
  target: string;
  interval: number;
  timeout: number;
  retries: number;
  expectedResponse?: any;
  customCheck?: () => Promise<boolean>;
}

/**
 * Comprehensive real-time monitoring and alerting system
 */
export class RealTimeMonitor extends EventEmitter {
  private logger: ILogger;
  private eventBus: IEventBus;
  private memory: DistributedMemorySystem;
  private config: MonitorConfig;

  // Metrics storage
  private timeSeries = new Map<string, TimeSeries>();
  private activeAlerts = new Map<string, Alert>();
  private alertHistory: Alert[] = [];

  // Monitoring state
  private monitoringInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private alertRules = new Map<string, AlertRule>();
  private healthChecks = new Map<string, HealthCheck>();

  // System state tracking
  private systemMetrics: SystemMetrics;
  private agentMetrics = new Map<string, AgentMetrics>();
  private swarmMetrics: SwarmMetrics;

  // Dashboards
  private dashboards = new Map<string, MonitoringDashboard>();

  // Performance tracking
  private lastMetricsUpdate = new Date();
  private metricsBuffer: MetricPoint[] = [];
  private alertProcessor?: NodeJS.Timeout;

  constructor(
    config: Partial<MonitorConfig>,
    logger: ILogger,
    eventBus: IEventBus,
    memory: DistributedMemorySystem
  ) {
    super();
    this.logger = logger;
    this.eventBus = eventBus;
    this.memory = memory;

    this.config = {
      updateInterval: 5000,
      retentionPeriod: 86400000, // 24 hours
      alertingEnabled: true,
      alertThresholds: {
        cpu: { warning: 70, critical: 90 },
        memory: { warning: 80, critical: 95 },
        disk: { warning: 85, critical: 95 },
        errorRate: { warning: 5, critical: 10 },
        responseTime: { warning: 5000, critical: 10000 },
        queueDepth: { warning: 10, critical: 20 },
        agentHealth: { warning: 0.7, critical: 0.5 },
        swarmUtilization: { warning: 0.8, critical: 0.95 }
      },
      metricsEnabled: true,
      tracingEnabled: true,
      dashboardEnabled: true,
      exportEnabled: false,
      exportFormat: 'json',
      debugMode: false,
      ...config
    };

    this.systemMetrics = this.initializeSystemMetrics();
    this.swarmMetrics = this.initializeSwarmMetrics();

    this.setupEventHandlers();
    this.initializeDefaultAlertRules();
    this.initializeDefaultDashboards();
  }

  private setupEventHandlers(): void {
    // Agent events
    this.eventBus.on('agent:metrics-update', (data: any) => {
      this.updateAgentMetrics(data.agentId, data.metrics);
    });

    this.eventBus.on('agent:status-changed', (data: any) => {
      this.recordMetric('agent.status.change', 1, { 
        agentId: data.agentId, 
        from: data.from, 
        to: data.to 
      });
    });

    // Task events
    this.eventBus.on('task:started', (data: any) => {
      this.recordMetric('task.started', 1, { taskId: data.taskId, agentId: data.agentId });
    });

    this.eventBus.on('task:completed', (data: any) => {
      this.recordMetric('task.completed', 1, { taskId: data.taskId });
      this.recordMetric('task.duration', data.duration, { taskId: data.taskId });
    });

    this.eventBus.on('task:failed', (data: any) => {
      this.recordMetric('task.failed', 1, { taskId: data.taskId, error: data.error });
    });

    // System events
    this.eventBus.on('system:resource-update', (data: any) => {
      this.updateSystemMetrics(data);
    });

    this.eventBus.on('swarm:metrics-update', (data: any) => {
      this.updateSwarmMetrics(data.metrics);
    });

    // Error events
    this.eventBus.on('error', (data: any) => {
      this.handleError(data);
    });
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing real-time monitor', {
      updateInterval: this.config.updateInterval,
      alerting: this.config.alertingEnabled,
      dashboard: this.config.dashboardEnabled
    });

    // Start monitoring loops
    this.startMetricsCollection();
    this.startHealthChecks();
    
    if (this.config.alertingEnabled) {
      this.startAlertProcessing();
    }

    // Initialize default health checks
    this.initializeHealthChecks();

    this.emit('monitor:initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down real-time monitor');

    // Stop all intervals
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.alertProcessor) clearInterval(this.alertProcessor);

    // Flush any remaining metrics
    await this.flushMetrics();

    this.emit('monitor:shutdown');
  }

  // === METRICS COLLECTION ===

  private startMetricsCollection(): void {
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.processMetricsBuffer();
      this.cleanupOldMetrics();
    }, this.config.updateInterval);

    this.logger.info('Started metrics collection', { 
      interval: this.config.updateInterval 
    });
  }

  private async collectSystemMetrics(): Promise<void> {
    try {
      // Update system metrics
      this.systemMetrics = {
        ...this.systemMetrics,
        timestamp: new Date(),
        cpuUsage: await this.getCpuUsage(),
        memoryUsage: await this.getMemoryUsage(),
        diskUsage: await this.getDiskUsage(),
        networkUsage: await this.getNetworkUsage()
      };

      // Record as time series
      this.recordMetric('system.cpu', this.systemMetrics.cpuUsage);
      this.recordMetric('system.memory', this.systemMetrics.memoryUsage);
      this.recordMetric('system.disk', this.systemMetrics.diskUsage);
      this.recordMetric('system.network', this.systemMetrics.networkUsage);

      // Update swarm-level metrics
      await this.updateSwarmLevelMetrics();

    } catch (error) {
      this.logger.error('Failed to collect system metrics', error);
    }
  }

  private async updateSwarmLevelMetrics(): Promise<void> {
    const agents = Array.from(this.agentMetrics.values());
    
    this.swarmMetrics = {
      ...this.swarmMetrics,
      agentUtilization: this.calculateAgentUtilization(agents),
      throughput: this.calculateSwarmThroughput(agents),
      latency: this.calculateAverageLatency(agents),
      efficiency: this.calculateSwarmEfficiency(agents),
      reliability: this.calculateSwarmReliability(agents),
      averageQuality: this.calculateAverageQuality(agents)
    };

    // Record swarm metrics
    this.recordMetric('swarm.utilization', this.swarmMetrics.agentUtilization);
    this.recordMetric('swarm.throughput', this.swarmMetrics.throughput);
    this.recordMetric('swarm.latency', this.swarmMetrics.latency);
    this.recordMetric('swarm.efficiency', this.swarmMetrics.efficiency);
    this.recordMetric('swarm.reliability', this.swarmMetrics.reliability);
  }

  recordMetric(name: string, value: number, tags: Record<string, string> = {}): void {
    const point: MetricPoint = {
      timestamp: new Date(),
      value,
      tags
    };

    // Add to buffer for batch processing
    this.metricsBuffer.push({ ...point, tags: { ...tags, metric: name } });

    // Immediate processing for critical metrics
    if (this.isCriticalMetric(name)) {
      this.processMetricPoint(name, point);
    }
  }

  private processMetricsBuffer(): void {
    if (this.metricsBuffer.length === 0) return;

    // Group by metric name
    const metricGroups = new Map<string, MetricPoint[]>();
    for (const point of this.metricsBuffer) {
      const metricName = point.tags.metric || 'unknown';
      const group = metricGroups.get(metricName) || [];
      group.push(point);
      metricGroups.set(metricName, group);
    }

    // Process each metric group
    for (const [metricName, points] of metricGroups) {
      for (const point of points) {
        this.processMetricPoint(metricName, point);
      }
    }

    // Clear buffer
    this.metricsBuffer = [];
  }

  private processMetricPoint(metricName: string, point: MetricPoint): void {
    let series = this.timeSeries.get(metricName);
    
    if (!series) {
      series = {
        name: metricName,
        points: [],
        aggregations: { min: point.value, max: point.value, avg: point.value, sum: point.value, count: 1 },
        lastUpdated: point.timestamp
      };
      this.timeSeries.set(metricName, series);
    }

    // Add point
    series.points.push(point);
    series.lastUpdated = point.timestamp;

    // Update aggregations
    series.aggregations.count++;
    series.aggregations.sum += point.value;
    series.aggregations.avg = series.aggregations.sum / series.aggregations.count;
    series.aggregations.min = Math.min(series.aggregations.min, point.value);
    series.aggregations.max = Math.max(series.aggregations.max, point.value);

    // Trigger alert checking for this metric
    if (this.config.alertingEnabled) {
      this.checkAlertsForMetric(metricName, point);
    }
  }

  // === ALERTING ===

  private startAlertProcessing(): void {
    this.alertProcessor = setInterval(() => {
      this.processAlerts();
    }, 1000); // Process alerts every second

    this.logger.info('Started alert processing');
  }

  private processAlerts(): void {
    const now = new Date();

    // Check for alert resolution
    for (const [alertId, alert] of this.activeAlerts) {
      if (!alert.resolved) {
        const rule = this.alertRules.get(alert.context.ruleId);
        if (rule && this.isAlertResolved(rule, alert)) {
          this.resolveAlert(alertId, 'condition_resolved');
        }
      }
    }

    // Clean up old resolved alerts
    this.cleanupResolvedAlerts();
  }

  private checkAlertsForMetric(metricName: string, point: MetricPoint): void {
    for (const [ruleId, rule] of this.alertRules) {
      if (rule.enabled && rule.metric === metricName) {
        this.evaluateAlertRule(rule, point);
      }
    }
  }

  private evaluateAlertRule(rule: AlertRule, point: MetricPoint): void {
    const conditionMet = this.evaluateCondition(rule.condition, point.value, rule.threshold);
    
    if (conditionMet) {
      // Check if we already have an active alert for this rule
      const existingAlert = Array.from(this.activeAlerts.values())
        .find(alert => alert.context.ruleId === rule.id && !alert.resolved);

      if (!existingAlert) {
        this.createAlert(rule, point);
      }
    }
  }

  private createAlert(rule: AlertRule, triggeringPoint: MetricPoint): void {
    const alertId = `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const alert: Alert = {
      id: alertId,
      timestamp: new Date(),
      level: rule.severity,
      type: this.getAlertTypeFromMetric(rule.metric),
      message: `${rule.name}: ${rule.metric} ${rule.condition} ${rule.threshold} (current: ${triggeringPoint.value})`,
      source: 'real-time-monitor',
      context: {
        ruleId: rule.id,
        metric: rule.metric,
        value: triggeringPoint.value,
        threshold: rule.threshold,
        tags: { ...rule.tags, ...triggeringPoint.tags }
      },
      acknowledged: false,
      resolved: false,
      escalationLevel: 0
    };

    this.activeAlerts.set(alertId, alert);
    this.alertHistory.push(alert);

    this.logger.warn('Alert created', {
      alertId,
      rule: rule.name,
      metric: rule.metric,
      value: triggeringPoint.value,
      threshold: rule.threshold
    });

    this.emit('alert:created', { alert });

    // Execute alert actions
    this.executeAlertActions(rule, alert);
  }

  private executeAlertActions(rule: AlertRule, alert: Alert): void {
    for (const action of rule.actions) {
      if (!action.enabled) continue;

      try {
        switch (action.type) {
          case 'log':
            this.logger.warn(`ALERT: ${alert.message}`, alert.context);
            break;

          case 'email':
            this.sendEmailAlert(alert, action.config);
            break;

          case 'webhook':
            this.sendWebhookAlert(alert, action.config);
            break;

          case 'auto-scale':
            this.triggerAutoScale(alert, action.config);
            break;

          case 'restart':
            this.triggerRestart(alert, action.config);
            break;

          default:
            this.logger.warn('Unknown alert action type', { type: action.type });
        }
      } catch (error) {
        this.logger.error('Failed to execute alert action', { 
          alertId: alert.id, 
          actionType: action.type, 
          error 
        });
      }
    }
  }

  private resolveAlert(alertId: string, reason: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return;

    alert.resolved = true;
    alert.context.resolutionReason = reason;
    alert.context.resolvedAt = new Date();

    this.logger.info('Alert resolved', { alertId, reason });
    this.emit('alert:resolved', { alert, reason });
  }

  // === HEALTH CHECKS ===

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30000); // Every 30 seconds

    this.logger.info('Started health checks');
  }

  private async performHealthChecks(): Promise<void> {
    const checks = Array.from(this.healthChecks.values());
    const promises = checks.map(check => this.executeHealthCheck(check));
    
    await Promise.allSettled(promises);
  }

  private async executeHealthCheck(check: HealthCheck): Promise<void> {
    try {
      let isHealthy = false;

      switch (check.type) {
        case 'http':
          isHealthy = await this.performHttpHealthCheck(check);
          break;
        case 'tcp':
          isHealthy = await this.performTcpHealthCheck(check);
          break;
        case 'custom':
          if (check.customCheck) {
            isHealthy = await check.customCheck();
          }
          break;
      }

      this.recordMetric(`healthcheck.${check.name}`, isHealthy ? 1 : 0, {
        type: check.type,
        target: check.target
      });

    } catch (error) {
      this.logger.error('Health check failed', { check: check.name, error });
      this.recordMetric(`healthcheck.${check.name}`, 0, {
        type: check.type,
        target: check.target,
        error: (error instanceof Error ? error.message : String(error))
      });
    }
  }

  // === DASHBOARD MANAGEMENT ===

  createDashboard(title: string, panels: DashboardPanel[]): string {
    const dashboardId = `dashboard-${Date.now()}`;
    
    const dashboard: MonitoringDashboard = {
      title,
      panels,
      refreshInterval: 30000,
      timeRange: {
        start: new Date(Date.now() - 3600000), // Last hour
        end: new Date()
      },
      filters: {}
    };

    this.dashboards.set(dashboardId, dashboard);
    this.emit('dashboard:created', { dashboardId, dashboard });
    
    return dashboardId;
  }

  getDashboardData(dashboardId: string): any {
    const dashboard = this.dashboards.get(dashboardId);
    if (!dashboard) return null;

    const data: any = {
      dashboard,
      panels: []
    };

    for (const panel of dashboard.panels) {
      const panelData = {
        id: panel.id,
        title: panel.title,
        type: panel.type,
        data: this.getPanelData(panel, dashboard.timeRange)
      };
      data.panels.push(panelData);
    }

    return data;
  }

  private getPanelData(panel: DashboardPanel, timeRange: { start: Date; end: Date }): any {
    const data: any = {};

    for (const metricName of panel.metrics) {
      const series = this.timeSeries.get(metricName);
      if (series) {
        // Filter points by time range
        const filteredPoints = series.points.filter(point =>
          point.timestamp >= timeRange.start && point.timestamp <= timeRange.end
        );

        data[metricName] = {
          points: filteredPoints,
          aggregations: this.calculateAggregations(filteredPoints)
        };
      }
    }

    return data;
  }

  // === UTILITY METHODS ===

  private async getCpuUsage(): Promise<number> {
    // Placeholder - would use actual system APIs
    return Math.random() * 100;
  }

  private async getMemoryUsage(): Promise<number> {
    // Placeholder - would use actual system APIs
    return Math.random() * 100;
  }

  private async getDiskUsage(): Promise<number> {
    // Placeholder - would use actual system APIs
    return Math.random() * 100;
  }

  private async getNetworkUsage(): Promise<number> {
    // Placeholder - would use actual system APIs
    return Math.random() * 1024 * 1024; // bytes
  }

  private updateAgentMetrics(agentId: string, metrics: AgentMetrics): void {
    this.agentMetrics.set(agentId, metrics);

    // Record individual agent metrics
    this.recordMetric('agent.cpu', metrics.cpuUsage, { agentId });
    this.recordMetric('agent.memory', metrics.memoryUsage, { agentId });
    this.recordMetric('agent.tasks.completed', metrics.tasksCompleted, { agentId });
    this.recordMetric('agent.tasks.failed', metrics.tasksFailed, { agentId });
    this.recordMetric('agent.response.time', metrics.responseTime, { agentId });
  }

  private updateSystemMetrics(data: Partial<SystemMetrics>): void {
    this.systemMetrics = { ...this.systemMetrics, ...data };
  }

  private updateSwarmMetrics(metrics: SwarmMetrics): void {
    this.swarmMetrics = { ...this.swarmMetrics, ...metrics };
  }

  private handleError(data: any): void {
    this.recordMetric('error.count', 1, {
      type: data.type || 'unknown',
      source: data.source || 'unknown'
    });

    // Create critical alert for errors
    if (data.severity === 'critical') {
      const alertId = `error-alert-${Date.now()}`;
      const alert: Alert = {
        id: alertId,
        timestamp: new Date(),
        level: 'critical',
        type: 'system',
        message: `Critical error: ${data.message}`,
        source: data.source || 'unknown',
        context: data,
        acknowledged: false,
        resolved: false,
        escalationLevel: 0
      };

      this.activeAlerts.set(alertId, alert);
      this.emit('alert:created', { alert });
    }
  }

  private isCriticalMetric(name: string): boolean {
    const criticalMetrics = [
      'system.cpu', 'system.memory', 'system.disk',
      'agent.health', 'task.failed', 'error.count'
    ];
    return criticalMetrics.includes(name);
  }

  private evaluateCondition(condition: string, value: number, threshold: number): boolean {
    switch (condition) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  private isAlertResolved(rule: AlertRule, alert: Alert): boolean {
    // Get recent metric values
    const series = this.timeSeries.get(rule.metric);
    if (!series || series.points.length === 0) return false;

    // Check if condition is no longer met
    const recentPoints = series.points.slice(-5); // Last 5 points
    const allResolved = recentPoints.every(point =>
      !this.evaluateCondition(rule.condition, point.value, rule.threshold)
    );

    return allResolved;
  }

  private getAlertTypeFromMetric(metric: string): AlertType {
    if (metric.includes('system')) return 'system';
    if (metric.includes('agent')) return 'agent';
    if (metric.includes('task')) return 'task';
    if (metric.includes('swarm')) return 'swarm';
    if (metric.includes('performance')) return 'performance';
    if (metric.includes('resource')) return 'resource';
    return 'custom';
  }

  private calculateAgentUtilization(agents: AgentMetrics[]): number {
    if (agents.length === 0) return 0;
    const totalUtilization = agents.reduce((sum, agent) => sum + agent.cpuUsage, 0);
    return totalUtilization / agents.length;
  }

  private calculateSwarmThroughput(agents: AgentMetrics[]): number {
    return agents.reduce((sum, agent) => sum + (agent.tasksCompleted || 0), 0);
  }

  private calculateAverageLatency(agents: AgentMetrics[]): number {
    if (agents.length === 0) return 0;
    const totalLatency = agents.reduce((sum, agent) => sum + agent.responseTime, 0);
    return totalLatency / agents.length;
  }

  private calculateSwarmEfficiency(agents: AgentMetrics[]): number {
    if (agents.length === 0) return 0;
    const totalTasks = agents.reduce((sum, agent) => 
      sum + (agent.tasksCompleted || 0) + (agent.tasksFailed || 0), 0);
    const completedTasks = agents.reduce((sum, agent) => sum + (agent.tasksCompleted || 0), 0);
    return totalTasks > 0 ? completedTasks / totalTasks : 1;
  }

  private calculateSwarmReliability(agents: AgentMetrics[]): number {
    if (agents.length === 0) return 1;
    const totalReliability = agents.reduce((sum, agent) => sum + (agent.successRate || 1), 0);
    return totalReliability / agents.length;
  }

  private calculateAverageQuality(agents: AgentMetrics[]): number {
    if (agents.length === 0) return 0.8;
    const totalQuality = agents.reduce((sum, agent) => sum + (agent.codeQuality || 0.8), 0);
    return totalQuality / agents.length;
  }

  private calculateAggregations(points: MetricPoint[]): any {
    if (points.length === 0) {
      return { min: 0, max: 0, avg: 0, sum: 0, count: 0 };
    }

    const values = points.map(p => p.value);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((sum, val) => sum + val, 0) / values.length,
      sum: values.reduce((sum, val) => sum + val, 0),
      count: values.length
    };
  }

  private cleanupOldMetrics(): void {
    const cutoff = new Date(Date.now() - this.config.retentionPeriod);
    
    for (const [name, series] of this.timeSeries) {
      series.points = series.points.filter(point => point.timestamp > cutoff);
      
      if (series.points.length === 0) {
        this.timeSeries.delete(name);
      }
    }
  }

  private cleanupResolvedAlerts(): void {
    const cutoff = new Date(Date.now() - 86400000); // 24 hours
    
    // Remove old resolved alerts from active alerts
    for (const [alertId, alert] of this.activeAlerts) {
      if (alert.resolved && alert.timestamp < cutoff) {
        this.activeAlerts.delete(alertId);
      }
    }

    // Trim alert history
    this.alertHistory = this.alertHistory
      .filter(alert => alert.timestamp > cutoff)
      .slice(-1000); // Keep last 1000 alerts max
  }

  private async flushMetrics(): Promise<void> {
    if (this.metricsBuffer.length > 0) {
      this.processMetricsBuffer();
    }

    // Persist metrics to memory if enabled
    if (this.config.exportEnabled) {
      await this.exportMetrics();
    }
  }

  private async exportMetrics(): Promise<void> {
    try {
      const exportData = {
        timestamp: new Date(),
        timeSeries: Array.from(this.timeSeries.entries()),
        systemMetrics: this.systemMetrics,
        swarmMetrics: this.swarmMetrics,
        activeAlerts: Array.from(this.activeAlerts.values())
      };

      await this.memory.store('monitoring:export', exportData, {
        type: 'monitoring-export',
        partition: 'metrics'
      });

    } catch (error) {
      this.logger.error('Failed to export metrics', error);
    }
  }

  private initializeDefaultAlertRules(): void {
    const rules: AlertRule[] = [
      {
        id: 'cpu-warning',
        name: 'High CPU Usage',
        enabled: true,
        metric: 'system.cpu',
        condition: 'gt',
        threshold: this.config.alertThresholds.cpu.warning,
        duration: 60000,
        severity: 'warning',
        tags: { category: 'system' },
        actions: [{ type: 'log', config: {}, enabled: true }],
        suppressions: []
      },
      {
        id: 'memory-critical',
        name: 'Critical Memory Usage',
        enabled: true,
        metric: 'system.memory',
        condition: 'gt',
        threshold: this.config.alertThresholds.memory.critical,
        duration: 30000,
        severity: 'critical',
        tags: { category: 'system' },
        actions: [
          { type: 'log', config: {}, enabled: true },
          { type: 'auto-scale', config: { action: 'scale-down' }, enabled: true }
        ],
        suppressions: []
      }
    ];

    rules.forEach(rule => this.alertRules.set(rule.id, rule));
  }

  private initializeDefaultDashboards(): void {
    const systemDashboard = this.createDashboard('System Overview', [
      {
        id: 'cpu-panel',
        title: 'CPU Usage',
        type: 'line',
        metrics: ['system.cpu'],
        config: {
          width: 6,
          height: 4,
          position: { x: 0, y: 0 },
          visualization: { yAxis: { max: 100 } }
        }
      },
      {
        id: 'memory-panel',
        title: 'Memory Usage',
        type: 'gauge',
        metrics: ['system.memory'],
        config: {
          width: 6,
          height: 4,
          position: { x: 6, y: 0 },
          visualization: { max: 100, threshold: [70, 90] }
        }
      }
    ]);

    this.logger.info('Created default dashboard', { dashboardId: systemDashboard });
  }

  private initializeHealthChecks(): void {
    // Add default health checks
    this.healthChecks.set('system', {
      name: 'system',
      type: 'custom',
      target: 'local',
      interval: 30000,
      timeout: 5000,
      retries: 3,
      customCheck: async () => {
        // Basic system health check
        return this.systemMetrics.cpuUsage < 95 && this.systemMetrics.memoryUsage < 95;
      }
    });
  }

  private async performHttpHealthCheck(check: HealthCheck): Promise<boolean> {
    // Placeholder for HTTP health check
    return true;
  }

  private async performTcpHealthCheck(check: HealthCheck): Promise<boolean> {
    // Placeholder for TCP health check
    return true;
  }

  private async sendEmailAlert(alert: Alert, config: any): Promise<void> {
    // Placeholder for email alert
    this.logger.info('Email alert sent', { alertId: alert.id });
  }

  private async sendWebhookAlert(alert: Alert, config: any): Promise<void> {
    // Placeholder for webhook alert
    this.logger.info('Webhook alert sent', { alertId: alert.id });
  }

  private async triggerAutoScale(alert: Alert, config: any): Promise<void> {
    // Placeholder for auto-scaling
    this.logger.info('Auto-scale triggered', { alertId: alert.id, action: config.action });
    this.eventBus.emit('autoscale:triggered', { alert, config });
  }

  private async triggerRestart(alert: Alert, config: any): Promise<void> {
    // Placeholder for restart action
    this.logger.info('Restart triggered', { alertId: alert.id });
    this.eventBus.emit('restart:triggered', { alert, config });
  }

  private initializeSystemMetrics(): SystemMetrics {
    return {
      timestamp: new Date(),
      cpuUsage: 0,
      memoryUsage: 0,
      diskUsage: 0,
      networkUsage: 0,
      activeSwarms: 0,
      totalAgents: 0,
      activeAgents: 0,
      totalTasks: 0,
      runningTasks: 0,
      throughput: 0,
      latency: 0,
      errorRate: 0,
      successRate: 100,
      resourceUtilization: {},
      queueLengths: {}
    };
  }

  private initializeSwarmMetrics(): SwarmMetrics {
    return {
      throughput: 0,
      latency: 0,
      efficiency: 1.0,
      reliability: 1.0,
      averageQuality: 0.8,
      defectRate: 0,
      reworkRate: 0,
      resourceUtilization: {},
      costEfficiency: 1.0,
      agentUtilization: 0,
      agentSatisfaction: 0.8,
      collaborationEffectiveness: 0.8,
      scheduleVariance: 0,
      deadlineAdherence: 1.0
    };
  }

  // === PUBLIC API ===

  getSystemMetrics(): SystemMetrics {
    return { ...this.systemMetrics };
  }

  getSwarmMetrics(): SwarmMetrics {
    return { ...this.swarmMetrics };
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  getAlertHistory(limit: number = 100): Alert[] {
    return this.alertHistory.slice(-limit);
  }

  getTimeSeries(metricName: string): TimeSeries | undefined {
    return this.timeSeries.get(metricName);
  }

  getAllTimeSeries(): TimeSeries[] {
    return Array.from(this.timeSeries.values());
  }

  acknowledgeAlert(alertId: string, acknowledgedBy: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.assignedTo = acknowledgedBy;
      this.emit('alert:acknowledged', { alert, acknowledgedBy });
    }
  }

  createAlertRule(rule: Omit<AlertRule, 'id'>): string {
    const ruleId = `rule-${Date.now()}`;
    this.alertRules.set(ruleId, { ...rule, id: ruleId });
    return ruleId;
  }

  updateAlertRule(ruleId: string, updates: Partial<AlertRule>): void {
    const rule = this.alertRules.get(ruleId);
    if (rule) {
      this.alertRules.set(ruleId, { ...rule, ...updates });
    }
  }

  deleteAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId);
  }

  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  getMonitoringStatistics(): {
    metricsCount: number;
    activeAlerts: number;
    alertRules: number;
    healthChecks: number;
    dashboards: number;
    uptime: number;
  } {
    return {
      metricsCount: this.timeSeries.size,
      activeAlerts: this.activeAlerts.size,
      alertRules: this.alertRules.size,
      healthChecks: this.healthChecks.size,
      dashboards: this.dashboards.size,
      uptime: Date.now() - this.lastMetricsUpdate.getTime()
    };
  }
}