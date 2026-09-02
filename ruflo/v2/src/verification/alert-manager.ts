/**
 * Truth Alert Manager - Advanced alerting and notification system
 * 
 * Provides comprehensive threshold monitoring, intelligent alert routing,
 * escalation management, and automated remediation capabilities.
 */

import type { ILogger } from '../core/logger.js';
import type { IEventBus } from '../core/event-bus.js';
import type {
  TruthMetric,
  TruthAlert,
  AlertThreshold,
  AlertAction,
  EscalationLevel,
  TruthAlertType,
  TruthTelemetryConfig,
} from './telemetry.js';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  
  // Condition definition
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'ne' | 'change' | 'rate';
  threshold: number;
  duration: number; // How long condition must persist (ms)
  
  // Alert configuration
  severity: 'info' | 'warning' | 'critical' | 'emergency';
  category: TruthAlertType;
  priority: number; // 1-10, higher is more urgent
  
  // Context and filtering
  filters: Record<string, any>;
  conditions: AlertCondition[];
  
  // Actions and escalation
  actions: AlertAction[];
  escalationPath: EscalationLevel[];
  suppressions: AlertSuppression[];
  
  // Metadata
  tags: Record<string, string>;
  createdBy: string;
  createdAt: Date;
  lastModified: Date;
}

export interface AlertCondition {
  field: string;
  operator: string;
  value: any;
  logicalOperator?: 'AND' | 'OR';
}

export interface AlertSuppression {
  id: string;
  condition: string;
  startTime: Date;
  endTime: Date;
  reason: string;
  createdBy: string;
}

export interface AlertChannel {
  id: string;
  name: string;
  type: 'email' | 'slack' | 'webhook' | 'sms' | 'teams' | 'discord' | 'pagerduty';
  config: Record<string, any>;
  enabled: boolean;
  filters: AlertFilter[];
  rateLimits: RateLimit[];
}

export interface AlertFilter {
  field: string;
  operator: string;
  values: string[];
  action: 'include' | 'exclude';
}

export interface RateLimit {
  window: number; // time window in milliseconds
  maxAlerts: number;
  resetTime?: Date;
  currentCount: number;
}

export interface AlertHistory {
  alertId: string;
  timestamp: Date;
  action: 'created' | 'acknowledged' | 'resolved' | 'escalated' | 'suppressed';
  actor: string;
  details: Record<string, any>;
}

export interface AlertStatistics {
  totalAlerts: number;
  activeAlerts: number;
  resolvedAlerts: number;
  averageResolutionTime: number;
  alertsByType: Record<string, number>;
  alertsBySeverity: Record<string, number>;
  topAlertSources: Array<{ source: string; count: number }>;
  escalationRate: number;
  falsePositiveRate: number;
}

export interface ThresholdGroup {
  name: string;
  thresholds: AlertThreshold[];
  enabled: boolean;
  scope: 'system' | 'agent' | 'task' | 'custom';
}

export class TruthAlertManager {
  private config: TruthTelemetryConfig;
  private logger: ILogger;
  private eventBus: IEventBus;
  
  // Alert management state
  private alertRules = new Map<string, AlertRule>();
  private activeAlerts = new Map<string, TruthAlert>();
  private alertHistory: AlertHistory[] = [];
  private alertChannels = new Map<string, AlertChannel>();
  private suppressions = new Map<string, AlertSuppression>();
  
  // Threshold monitoring
  private thresholdGroups = new Map<string, ThresholdGroup>();
  private metricStates = new Map<string, MetricState>();
  
  // Processing state
  private processingInterval?: NodeJS.Timeout;
  private escalationInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  
  // Statistics
  private statistics: AlertStatistics;
  
  constructor(
    config: TruthTelemetryConfig,
    logger: ILogger,
    eventBus: IEventBus
  ) {
    this.config = config;
    this.logger = logger;
    this.eventBus = eventBus;
    
    this.statistics = this.initializeStatistics();
    this.initializeDefaultRules();
    this.initializeDefaultChannels();
  }
  
  async initialize(): Promise<void> {
    this.logger.info('Initializing Truth Alert Manager', {
      alertEnabled: this.config.alertEnabled,
      thresholds: this.config.alertThresholds,
    });
    
    // Start processing loops
    this.startAlertProcessing();
    this.startEscalationProcessing();
    this.startCleanupProcessing();
    
    // Load configuration
    await this.loadAlertConfiguration();
    
    this.logger.info('Truth Alert Manager initialized successfully', {
      rules: this.alertRules.size,
      channels: this.alertChannels.size,
    });
  }
  
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Truth Alert Manager');
    
    // Stop processing intervals
    if (this.processingInterval) clearInterval(this.processingInterval);
    if (this.escalationInterval) clearInterval(this.escalationInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    
    // Save state
    await this.saveAlertConfiguration();
    
    this.logger.info('Truth Alert Manager shutdown complete');
  }
  
  // ========================================================================================
  // Alert Processing
  // ========================================================================================
  
  async checkThresholds(metric: TruthMetric): Promise<void> {
    if (!this.config.alertEnabled) return;
    
    try {
      // Update metric state
      await this.updateMetricState(metric);
      
      // Check all applicable rules
      const applicableRules = this.getApplicableRules(metric);
      
      for (const rule of applicableRules) {
        await this.evaluateRule(rule, metric);
      }
      
    } catch (error) {
      this.logger.error('Error checking thresholds', { metricId: metric.id, error });
    }
  }
  
  private async updateMetricState(metric: TruthMetric): Promise<void> {
    const key = `${metric.agentId}:${metric.metricType}`;
    
    let state = this.metricStates.get(key);
    if (!state) {
      state = {
        key,
        currentValue: metric.value,
        previousValue: metric.value,
        lastUpdate: metric.timestamp,
        changeRate: 0,
        samples: [metric.value],
        thresholdViolations: new Map(),
      };
      this.metricStates.set(key, state);
    } else {
      // Update state
      state.previousValue = state.currentValue;
      state.currentValue = metric.value;
      state.lastUpdate = metric.timestamp;
      
      // Calculate change rate (per hour)
      const timeDiff = metric.timestamp.getTime() - state.lastUpdate.getTime();
      if (timeDiff > 0) {
        const valueDiff = metric.value - state.previousValue;
        state.changeRate = (valueDiff / timeDiff) * (60 * 60 * 1000); // per hour
      }
      
      // Update samples (keep last 100)
      state.samples.push(metric.value);
      if (state.samples.length > 100) {
        state.samples = state.samples.slice(-100);
      }
    }
  }
  
  private getApplicableRules(metric: TruthMetric): AlertRule[] {
    return Array.from(this.alertRules.values()).filter(rule => {
      if (!rule.enabled) return false;
      
      // Check if rule applies to this metric
      if (rule.metric !== metric.metricType && rule.metric !== '*') return false;
      
      // Check filters
      if (!this.matchesFilters(metric, rule.filters)) return false;
      
      // Check conditions
      if (!this.matchesConditions(metric, rule.conditions)) return false;
      
      return true;
    });
  }
  
  private async evaluateRule(rule: AlertRule, metric: TruthMetric): Promise<void> {
    const key = `${metric.agentId}:${metric.metricType}`;
    const state = this.metricStates.get(key);
    
    if (!state) return;
    
    // Evaluate threshold condition
    const conditionMet = this.evaluateCondition(rule, metric, state);
    
    if (conditionMet) {
      await this.handleThresholdViolation(rule, metric, state);
    } else {
      await this.handleThresholdClearance(rule, metric, state);
    }
  }
  
  private evaluateCondition(rule: AlertRule, metric: TruthMetric, state: MetricState): boolean {
    const value = metric.value;
    const threshold = rule.threshold;
    
    switch (rule.operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      case 'ne': return value !== threshold;
      case 'change': return Math.abs(value - state.previousValue) > threshold;
      case 'rate': return Math.abs(state.changeRate) > threshold;
      default: return false;
    }
  }
  
  private async handleThresholdViolation(
    rule: AlertRule,
    metric: TruthMetric,
    state: MetricState
  ): Promise<void> {
    const violationKey = `${rule.id}:${state.key}`;
    let violation = state.thresholdViolations.get(violationKey);
    
    if (!violation) {
      // New violation
      violation = {
        ruleId: rule.id,
        startTime: metric.timestamp,
        lastSeen: metric.timestamp,
        count: 1,
        alertId: null,
      };
      state.thresholdViolations.set(violationKey, violation);
    } else {
      // Existing violation
      violation.lastSeen = metric.timestamp;
      violation.count++;
    }
    
    // Check if violation has persisted long enough
    const duration = metric.timestamp.getTime() - violation.startTime.getTime();
    
    if (duration >= rule.duration && !violation.alertId) {
      // Create alert
      const alertId = await this.createAlert(rule, metric, violation);
      violation.alertId = alertId;
    }
  }
  
  private async handleThresholdClearance(
    rule: AlertRule,
    metric: TruthMetric,
    state: MetricState
  ): Promise<void> {
    const violationKey = `${rule.id}:${state.key}`;
    const violation = state.thresholdViolations.get(violationKey);
    
    if (violation && violation.alertId) {
      // Resolve the alert
      await this.resolveAlert(violation.alertId, 'threshold_cleared');
    }
    
    // Clear violation
    state.thresholdViolations.delete(violationKey);
  }
  
  private async createAlert(
    rule: AlertRule,
    metric: TruthMetric,
    violation: ThresholdViolation
  ): Promise<string> {
    const alertId = `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const alert: TruthAlert = {
      id: alertId,
      timestamp: new Date(),
      severity: rule.severity,
      type: rule.category,
      message: this.generateAlertMessage(rule, metric),
      source: `agent:${metric.agentId}`,
      context: {
        ruleId: rule.id,
        ruleName: rule.name,
        metricType: metric.metricType,
        metricValue: metric.value,
        threshold: rule.threshold,
        operator: rule.operator,
        duration: violation.lastSeen.getTime() - violation.startTime.getTime(),
        violationCount: violation.count,
        agentId: metric.agentId,
        taskId: metric.taskId,
        ...metric.context,
      },
      thresholds: [
        {
          metric: rule.metric,
          operator: rule.operator,
          value: rule.threshold,
          duration: rule.duration,
          severity: rule.severity,
        },
      ],
      actions: [...rule.actions],
      escalationPath: [...rule.escalationPath],
      resolved: false,
    };
    
    this.activeAlerts.set(alertId, alert);
    
    // Update statistics
    this.statistics.totalAlerts++;
    this.statistics.activeAlerts++;
    this.statistics.alertsByType[alert.type] = (this.statistics.alertsByType[alert.type] || 0) + 1;
    this.statistics.alertsBySeverity[alert.severity] = (this.statistics.alertsBySeverity[alert.severity] || 0) + 1;
    
    // Log alert creation
    this.logger.warn('Truth alert created', {
      alertId,
      rule: rule.name,
      metric: metric.metricType,
      value: metric.value,
      threshold: rule.threshold,
      agent: metric.agentId,
    });
    
    // Add to history
    this.addToHistory(alertId, 'created', 'system', { rule: rule.name });
    
    // Emit event
    this.eventBus.emit('truth-alert:created', { alert, rule, metric });
    
    // Execute alert actions
    await this.executeAlertActions(alert);
    
    return alertId;
  }
  
  async executeAlertActions(alert: TruthAlert): Promise<void> {
    for (const action of alert.actions) {
      if (!action.enabled) continue;
      
      try {
        await this.executeAction(alert, action);
      } catch (error) {
        this.logger.error('Failed to execute alert action', {
          alertId: alert.id,
          actionType: action.type,
          error,
        });
      }
    }
  }
  
  private async executeAction(alert: TruthAlert, action: AlertAction): Promise<void> {
    switch (action.type) {
      case 'notify':
        await this.sendNotification(alert, action);
        break;
      
      case 'escalate':
        await this.escalateAlert(alert, action);
        break;
      
      case 'auto-remediate':
        await this.autoRemediate(alert, action);
        break;
      
      case 'suspend':
        await this.suspendAgent(alert, action);
        break;
      
      case 'restart':
        await this.restartAgent(alert, action);
        break;
      
      default:
        this.logger.warn('Unknown alert action type', { type: action.type });
    }
  }
  
  // ========================================================================================
  // Notification System
  // ========================================================================================
  
  private async sendNotification(alert: TruthAlert, action: AlertAction): Promise<void> {
    const channelIds = action.config.channels || ['default'];
    
    for (const channelId of channelIds) {
      const channel = this.alertChannels.get(channelId);
      if (!channel || !channel.enabled) continue;
      
      // Check filters
      if (!this.alertMatchesChannelFilters(alert, channel)) continue;
      
      // Check rate limits
      if (!this.checkRateLimit(channel, alert)) continue;
      
      await this.sendToChannel(alert, channel);
    }
  }
  
  private async sendToChannel(alert: TruthAlert, channel: AlertChannel): Promise<void> {
    try {
      switch (channel.type) {
        case 'email':
          await this.sendEmailNotification(alert, channel);
          break;
        
        case 'slack':
          await this.sendSlackNotification(alert, channel);
          break;
        
        case 'webhook':
          await this.sendWebhookNotification(alert, channel);
          break;
        
        case 'teams':
          await this.sendTeamsNotification(alert, channel);
          break;
        
        case 'discord':
          await this.sendDiscordNotification(alert, channel);
          break;
        
        case 'pagerduty':
          await this.sendPagerDutyNotification(alert, channel);
          break;
        
        default:
          this.logger.warn('Unknown channel type', { type: channel.type });
      }
      
      this.logger.info('Alert notification sent', {
        alertId: alert.id,
        channel: channel.name,
        type: channel.type,
      });
      
    } catch (error) {
      this.logger.error('Failed to send notification', {
        alertId: alert.id,
        channel: channel.name,
        error,
      });
    }
  }
  
  // ========================================================================================
  // Escalation Management
  // ========================================================================================
  
  private async escalateAlert(alert: TruthAlert, action: AlertAction): Promise<void> {
    const escalationLevel = action.config.level || 1;
    
    if (escalationLevel <= alert.escalationLevel) return; // Already escalated
    
    alert.escalationLevel = escalationLevel;
    
    // Find escalation configuration
    const escalation = alert.escalationPath.find(e => e.level === escalationLevel);
    if (!escalation) return;
    
    // Check escalation conditions
    if (!this.checkEscalationConditions(alert, escalation)) return;
    
    // Update alert severity if needed
    if (escalationLevel > 1) {
      alert.severity = this.getEscalatedSeverity(alert.severity);
    }
    
    // Send escalation notifications
    await this.sendEscalationNotifications(alert, escalation);
    
    // Add to history
    this.addToHistory(alert.id, 'escalated', 'system', {
      level: escalationLevel,
      targets: escalation.targets,
    });
    
    // Update statistics
    this.statistics.escalationRate = this.calculateEscalationRate();
    
    this.logger.warn('Alert escalated', {
      alertId: alert.id,
      level: escalationLevel,
      severity: alert.severity,
    });
    
    this.eventBus.emit('truth-alert:escalated', { alert, escalationLevel });
  }
  
  private async sendEscalationNotifications(
    alert: TruthAlert,
    escalation: EscalationLevel
  ): Promise<void> {
    for (const target of escalation.targets) {
      const channel = this.alertChannels.get(target);
      if (channel && channel.enabled) {
        await this.sendToChannel(alert, channel);
      }
    }
  }
  
  // ========================================================================================
  // Auto-Remediation
  // ========================================================================================
  
  private async autoRemediate(alert: TruthAlert, action: AlertAction): Promise<void> {
    const remediationType = action.config.type;
    
    try {
      switch (remediationType) {
        case 'restart_agent':
          await this.restartAgent(alert, action);
          break;
        
        case 'scale_resources':
          await this.scaleResources(alert, action);
          break;
        
        case 'adjust_thresholds':
          await this.adjustThresholds(alert, action);
          break;
        
        case 'redistribute_load':
          await this.redistributeLoad(alert, action);
          break;
        
        case 'failover':
          await this.initiateFailover(alert, action);
          break;
        
        default:
          this.logger.warn('Unknown remediation type', { type: remediationType });
      }
      
      this.logger.info('Auto-remediation executed', {
        alertId: alert.id,
        type: remediationType,
      });
      
    } catch (error) {
      this.logger.error('Auto-remediation failed', {
        alertId: alert.id,
        type: remediationType,
        error,
      });
    }
  }
  
  private async restartAgent(alert: TruthAlert, action: AlertAction): Promise<void> {
    const agentId = alert.context.agentId;
    if (!agentId) return;
    
    this.eventBus.emit('agent:restart-requested', {
      agentId,
      reason: 'automated_remediation',
      alertId: alert.id,
    });
  }
  
  private async suspendAgent(alert: TruthAlert, action: AlertAction): Promise<void> {
    const agentId = alert.context.agentId;
    if (!agentId) return;
    
    this.eventBus.emit('agent:suspend-requested', {
      agentId,
      duration: action.config.duration || 300000, // 5 minutes default
      reason: 'automated_remediation',
      alertId: alert.id,
    });
  }
  
  private async scaleResources(alert: TruthAlert, action: AlertAction): Promise<void> {
    this.eventBus.emit('system:scale-requested', {
      direction: action.config.direction || 'up',
      factor: action.config.factor || 1.5,
      reason: 'automated_remediation',
      alertId: alert.id,
    });
  }
  
  private async adjustThresholds(alert: TruthAlert, action: AlertAction): Promise<void> {
    const ruleId = alert.context.ruleId;
    const rule = this.alertRules.get(ruleId);
    
    if (rule) {
      const adjustment = action.config.adjustment || 0.1;
      rule.threshold = rule.threshold + (rule.threshold * adjustment);
      
      this.logger.info('Alert threshold adjusted', {
        ruleId,
        oldThreshold: rule.threshold - (rule.threshold * adjustment),
        newThreshold: rule.threshold,
      });
    }
  }
  
  private async redistributeLoad(alert: TruthAlert, action: AlertAction): Promise<void> {
    this.eventBus.emit('load-balancer:redistribute', {
      reason: 'automated_remediation',
      alertId: alert.id,
      excludeAgents: [alert.context.agentId],
    });
  }
  
  private async initiateFailover(alert: TruthAlert, action: AlertAction): Promise<void> {
    this.eventBus.emit('system:failover-requested', {
      primaryAgent: alert.context.agentId,
      reason: 'automated_remediation',
      alertId: alert.id,
    });
  }
  
  // ========================================================================================
  // Alert Resolution
  // ========================================================================================
  
  async resolveAlert(alertId: string, reason: string, resolvedBy?: string): Promise<boolean> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.resolved) return false;
    
    alert.resolved = true;
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy || 'system';
    alert.context.resolutionReason = reason;
    
    // Update statistics
    this.statistics.activeAlerts--;
    this.statistics.resolvedAlerts++;
    
    // Calculate resolution time
    const resolutionTime = alert.resolvedAt.getTime() - alert.timestamp.getTime();
    this.updateAverageResolutionTime(resolutionTime);
    
    // Add to history
    this.addToHistory(alertId, 'resolved', resolvedBy || 'system', { reason });
    
    this.logger.info('Alert resolved', {
      alertId,
      reason,
      resolvedBy: resolvedBy || 'system',
      duration: resolutionTime,
    });
    
    this.eventBus.emit('truth-alert:resolved', { alert, reason, resolvedBy });
    
    return true;
  }
  
  async acknowledgeAlert(alertId: string, acknowledgedBy: string, comment?: string): Promise<boolean> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.resolved) return false;
    
    alert.acknowledged = true;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;
    
    if (comment) {
      alert.context.acknowledgmentComment = comment;
    }
    
    // Add to history
    this.addToHistory(alertId, 'acknowledged', acknowledgedBy, { comment });
    
    this.logger.info('Alert acknowledged', {
      alertId,
      acknowledgedBy,
      comment,
    });
    
    this.eventBus.emit('truth-alert:acknowledged', { alert, acknowledgedBy, comment });
    
    return true;
  }
  
  // ========================================================================================
  // Rule Management
  // ========================================================================================
  
  createAlertRule(rule: Omit<AlertRule, 'id' | 'createdAt' | 'lastModified'>): string {
    const ruleId = `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const fullRule: AlertRule = {
      ...rule,
      id: ruleId,
      createdAt: new Date(),
      lastModified: new Date(),
    };
    
    this.alertRules.set(ruleId, fullRule);
    
    this.logger.info('Alert rule created', {
      ruleId,
      name: rule.name,
      metric: rule.metric,
      threshold: rule.threshold,
    });
    
    return ruleId;
  }
  
  updateAlertRule(ruleId: string, updates: Partial<AlertRule>): boolean {
    const rule = this.alertRules.get(ruleId);
    if (!rule) return false;
    
    const updatedRule = {
      ...rule,
      ...updates,
      id: ruleId, // Prevent ID changes
      lastModified: new Date(),
    };
    
    this.alertRules.set(ruleId, updatedRule);
    
    this.logger.info('Alert rule updated', { ruleId, updates });
    
    return true;
  }
  
  deleteAlertRule(ruleId: string): boolean {
    const deleted = this.alertRules.delete(ruleId);
    
    if (deleted) {
      this.logger.info('Alert rule deleted', { ruleId });
    }
    
    return deleted;
  }
  
  // ========================================================================================
  // Processing Loops
  // ========================================================================================
  
  private startAlertProcessing(): void {
    this.processingInterval = setInterval(() => {
      this.processActiveAlerts();
    }, 30000); // Every 30 seconds
    
    this.logger.info('Started alert processing');
  }
  
  private startEscalationProcessing(): void {
    this.escalationInterval = setInterval(() => {
      this.processEscalations();
    }, 60000); // Every minute
    
    this.logger.info('Started escalation processing');
  }
  
  private startCleanupProcessing(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupResolvedAlerts();
      this.cleanupOldHistory();
      this.resetRateLimits();
    }, 300000); // Every 5 minutes
    
    this.logger.info('Started cleanup processing');
  }
  
  async processAlert(alert: TruthAlert): Promise<void> {
    // Check for auto-resolution conditions
    await this.checkAutoResolution(alert);
    
    // Check for escalation conditions
    await this.checkEscalation(alert);
    
    // Update alert statistics
    this.updateAlertStatistics(alert);
  }
  
  private async processActiveAlerts(): Promise<void> {
    for (const alert of this.activeAlerts.values()) {
      if (!alert.resolved) {
        await this.processAlert(alert);
      }
    }
  }
  
  private async processEscalations(): Promise<void> {
    for (const alert of this.activeAlerts.values()) {
      if (!alert.resolved && !alert.acknowledged) {
        await this.checkEscalation(alert);
      }
    }
  }
  
  private async checkAutoResolution(alert: TruthAlert): Promise<void> {
    // Check if the underlying condition has been resolved
    const currentValue = await this.getCurrentMetricValue(alert);
    if (currentValue === null) return;
    
    const rule = this.alertRules.get(alert.context.ruleId);
    if (!rule) return;
    
    // Check if condition is no longer met
    const conditionMet = this.evaluateConditionValue(rule, currentValue);
    
    if (!conditionMet) {
      await this.resolveAlert(alert.id, 'condition_resolved');
    }
  }
  
  private async checkEscalation(alert: TruthAlert): Promise<void> {
    const now = Date.now();
    const alertAge = now - alert.timestamp.getTime();
    
    // Find next escalation level
    const nextEscalation = alert.escalationPath.find(
      e => e.level > alert.escalationLevel
    );
    
    if (nextEscalation && alertAge >= nextEscalation.delay) {
      await this.escalateAlert(alert, {
        type: 'escalate',
        target: 'escalation',
        config: { level: nextEscalation.level },
        enabled: true,
      });
    }
  }
  
  // ========================================================================================
  // Utility Methods
  // ========================================================================================
  
  private generateAlertMessage(rule: AlertRule, metric: TruthMetric): string {
    return `${rule.name}: ${metric.metricType} ${rule.operator} ${rule.threshold} ` +
           `(current: ${metric.value.toFixed(3)}) for agent ${metric.agentId}`;
  }
  
  private matchesFilters(metric: TruthMetric, filters: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(filters)) {
      const metricValue = this.getMetricProperty(metric, key);
      if (metricValue !== value) return false;
    }
    return true;
  }
  
  private matchesConditions(metric: TruthMetric, conditions: AlertCondition[]): boolean {
    if (conditions.length === 0) return true;
    
    // Simple AND/OR logic evaluation
    let result = true;
    let currentOperator = 'AND';
    
    for (const condition of conditions) {
      const metricValue = this.getMetricProperty(metric, condition.field);
      const conditionResult = this.evaluateConditionValue(condition, metricValue);
      
      if (currentOperator === 'AND') {
        result = result && conditionResult;
      } else {
        result = result || conditionResult;
      }
      
      currentOperator = condition.logicalOperator || 'AND';
    }
    
    return result;
  }
  
  private getMetricProperty(metric: TruthMetric, path: string): any {
    const parts = path.split('.');
    let value: any = metric;
    
    for (const part of parts) {
      value = value?.[part];
    }
    
    return value;
  }
  
  private evaluateConditionValue(condition: any, value: any): boolean {
    switch (condition.operator) {
      case 'gt': return value > condition.value;
      case 'gte': return value >= condition.value;
      case 'lt': return value < condition.value;
      case 'lte': return value <= condition.value;
      case 'eq': return value === condition.value;
      case 'ne': return value !== condition.value;
      case 'contains': return String(value).includes(condition.value);
      case 'startsWith': return String(value).startsWith(condition.value);
      case 'endsWith': return String(value).endsWith(condition.value);
      default: return false;
    }
  }
  
  private alertMatchesChannelFilters(alert: TruthAlert, channel: AlertChannel): boolean {
    for (const filter of channel.filters) {
      const alertValue = this.getMetricProperty(alert, filter.field);
      const matches = filter.values.includes(String(alertValue));
      
      if (filter.action === 'include' && !matches) return false;
      if (filter.action === 'exclude' && matches) return false;
    }
    return true;
  }
  
  private checkRateLimit(channel: AlertChannel, alert: TruthAlert): boolean {
    for (const rateLimit of channel.rateLimits) {
      const now = Date.now();
      
      // Reset if window has passed
      if (rateLimit.resetTime && now > rateLimit.resetTime.getTime()) {
        rateLimit.currentCount = 0;
        rateLimit.resetTime = new Date(now + rateLimit.window);
      }
      
      // Initialize if needed
      if (!rateLimit.resetTime) {
        rateLimit.resetTime = new Date(now + rateLimit.window);
        rateLimit.currentCount = 0;
      }
      
      // Check limit
      if (rateLimit.currentCount >= rateLimit.maxAlerts) {
        return false;
      }
      
      // Increment counter
      rateLimit.currentCount++;
    }
    
    return true;
  }
  
  private checkEscalationConditions(alert: TruthAlert, escalation: EscalationLevel): boolean {
    // Simple condition evaluation
    for (const condition of escalation.conditions) {
      // This would typically parse and evaluate complex conditions
      // For now, using simple checks
      if (condition.includes('unacknowledged') && alert.acknowledged) return false;
      if (condition.includes('duration') && !this.checkDurationCondition(alert, condition)) return false;
    }
    return true;
  }
  
  private checkDurationCondition(alert: TruthAlert, condition: string): boolean {
    // Parse condition like "duration > 30m"
    const match = condition.match(/duration\s*([><=]+)\s*(\d+)([mhs])/);
    if (!match) return true;
    
    const operator = match[1];
    const value = parseInt(match[2]);
    const unit = match[3];
    
    const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000; // hours
    const thresholdMs = value * multiplier;
    const durationMs = Date.now() - alert.timestamp.getTime();
    
    switch (operator) {
      case '>': return durationMs > thresholdMs;
      case '>=': return durationMs >= thresholdMs;
      case '<': return durationMs < thresholdMs;
      case '<=': return durationMs <= thresholdMs;
      case '=': return Math.abs(durationMs - thresholdMs) < 1000;
      default: return true;
    }
  }
  
  private getEscalatedSeverity(currentSeverity: string): 'info' | 'warning' | 'critical' | 'emergency' {
    switch (currentSeverity) {
      case 'info': return 'warning';
      case 'warning': return 'critical';
      case 'critical': return 'emergency';
      default: return 'emergency';
    }
  }
  
  private async getCurrentMetricValue(alert: TruthAlert): Promise<number | null> {
    // This would typically query the current metric value
    // For now, returning null to indicate unavailable
    return null;
  }
  
  private addToHistory(alertId: string, action: string, actor: string, details: Record<string, any>): void {
    this.alertHistory.push({
      alertId,
      timestamp: new Date(),
      action: action as any,
      actor,
      details,
    });
    
    // Keep history size manageable
    if (this.alertHistory.length > 10000) {
      this.alertHistory = this.alertHistory.slice(-5000);
    }
  }
  
  private cleanupResolvedAlerts(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
    
    for (const [alertId, alert] of this.activeAlerts) {
      if (alert.resolved && alert.resolvedAt && alert.resolvedAt < cutoff) {
        this.activeAlerts.delete(alertId);
      }
    }
  }
  
  private cleanupOldHistory(): void {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
    this.alertHistory = this.alertHistory.filter(h => h.timestamp >= cutoff);
  }
  
  private resetRateLimits(): void {
    const now = Date.now();
    
    for (const channel of this.alertChannels.values()) {
      for (const rateLimit of channel.rateLimits) {
        if (rateLimit.resetTime && now > rateLimit.resetTime.getTime()) {
          rateLimit.currentCount = 0;
          rateLimit.resetTime = new Date(now + rateLimit.window);
        }
      }
    }
  }
  
  private updateAlertStatistics(alert: TruthAlert): void {
    // Update top alert sources
    const source = alert.source;
    const existing = this.statistics.topAlertSources.find(s => s.source === source);
    if (existing) {
      existing.count++;
    } else {
      this.statistics.topAlertSources.push({ source, count: 1 });
    }
    
    // Sort and limit
    this.statistics.topAlertSources.sort((a, b) => b.count - a.count);
    this.statistics.topAlertSources = this.statistics.topAlertSources.slice(0, 10);
  }
  
  private updateAverageResolutionTime(resolutionTime: number): void {
    const count = this.statistics.resolvedAlerts;
    const currentAvg = this.statistics.averageResolutionTime;
    
    this.statistics.averageResolutionTime = 
      ((currentAvg * (count - 1)) + resolutionTime) / count;
  }
  
  private calculateEscalationRate(): number {
    const escalatedAlerts = this.alertHistory.filter(h => h.action === 'escalated').length;
    return this.statistics.totalAlerts > 0 ? escalatedAlerts / this.statistics.totalAlerts : 0;
  }
  
  // ========================================================================================
  // Notification Implementations (Placeholders)
  // ========================================================================================
  
  private async sendEmailNotification(alert: TruthAlert, channel: AlertChannel): Promise<void> {
    // Implementation would send actual email
    this.logger.info('Email notification sent', { alertId: alert.id, to: channel.config.to });
  }
  
  private async sendSlackNotification(alert: TruthAlert, channel: AlertChannel): Promise<void> {
    // Implementation would send to Slack webhook
    this.logger.info('Slack notification sent', { alertId: alert.id, webhook: channel.config.webhook });
  }
  
  private async sendWebhookNotification(alert: TruthAlert, channel: AlertChannel): Promise<void> {
    // Implementation would POST to webhook URL
    this.logger.info('Webhook notification sent', { alertId: alert.id, url: channel.config.url });
  }
  
  private async sendTeamsNotification(alert: TruthAlert, channel: AlertChannel): Promise<void> {
    // Implementation would send to Teams webhook
    this.logger.info('Teams notification sent', { alertId: alert.id, webhook: channel.config.webhook });
  }
  
  private async sendDiscordNotification(alert: TruthAlert, channel: AlertChannel): Promise<void> {
    // Implementation would send to Discord webhook
    this.logger.info('Discord notification sent', { alertId: alert.id, webhook: channel.config.webhook });
  }
  
  private async sendPagerDutyNotification(alert: TruthAlert, channel: AlertChannel): Promise<void> {
    // Implementation would create PagerDuty incident
    this.logger.info('PagerDuty notification sent', { alertId: alert.id, serviceKey: channel.config.serviceKey });
  }
  
  // ========================================================================================
  // Configuration Management
  // ========================================================================================
  
  private async loadAlertConfiguration(): Promise<void> {
    // Placeholder for loading configuration from storage
    this.logger.debug('Loading alert configuration');
  }
  
  private async saveAlertConfiguration(): Promise<void> {
    // Placeholder for saving configuration to storage
    this.logger.debug('Saving alert configuration');
  }
  
  private initializeDefaultRules(): void {
    // Create default alert rules
    const defaultRules: Omit<AlertRule, 'id' | 'createdAt' | 'lastModified'>[] = [
      {
        name: 'Low Truth Accuracy',
        description: 'Alert when agent accuracy falls below threshold',
        enabled: true,
        metric: 'accuracy',
        operator: 'lt',
        threshold: this.config.alertThresholds.accuracyThreshold,
        duration: 300000, // 5 minutes
        severity: 'critical',
        category: 'accuracy_degradation',
        priority: 8,
        filters: {},
        conditions: [],
        actions: [
          { type: 'notify', target: 'default', config: { channels: ['default'] }, enabled: true },
        ],
        escalationPath: [
          { level: 1, delay: 900000, targets: ['critical'], conditions: ['unacknowledged'] }, // 15 minutes
        ],
        suppressions: [],
        tags: { category: 'accuracy', auto_created: 'true' },
        createdBy: 'system',
      },
      {
        name: 'High Human Intervention Rate',
        description: 'Alert when human intervention rate exceeds threshold',
        enabled: true,
        metric: '*',
        operator: 'gt',
        threshold: this.config.alertThresholds.interventionRateThreshold,
        duration: 600000, // 10 minutes
        severity: 'warning',
        category: 'high_intervention_rate',
        priority: 6,
        filters: { 'context.verificationMethod': 'human' },
        conditions: [],
        actions: [
          { type: 'notify', target: 'default', config: { channels: ['default'] }, enabled: true },
        ],
        escalationPath: [],
        suppressions: [],
        tags: { category: 'efficiency', auto_created: 'true' },
        createdBy: 'system',
      },
    ];
    
    defaultRules.forEach(rule => this.createAlertRule(rule));
  }
  
  private initializeDefaultChannels(): void {
    // Create default notification channels
    const defaultChannels: Omit<AlertChannel, 'id'>[] = [
      {
        name: 'Default Log Channel',
        type: 'email',
        config: { to: 'admin@example.com' },
        enabled: true,
        filters: [],
        rateLimits: [
          { window: 300000, maxAlerts: 10, currentCount: 0 }, // 10 alerts per 5 minutes
        ],
      },
      {
        name: 'Critical Alerts',
        type: 'slack',
        config: { webhook: 'https://hooks.slack.com/services/...' },
        enabled: false, // Disabled until configured
        filters: [
          { field: 'severity', operator: 'eq', values: ['critical', 'emergency'], action: 'include' },
        ],
        rateLimits: [
          { window: 60000, maxAlerts: 5, currentCount: 0 }, // 5 alerts per minute
        ],
      },
    ];
    
    defaultChannels.forEach(channel => {
      const channelId = `channel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.alertChannels.set(channelId, { ...channel, id: channelId });
    });
  }
  
  private initializeStatistics(): AlertStatistics {
    return {
      totalAlerts: 0,
      activeAlerts: 0,
      resolvedAlerts: 0,
      averageResolutionTime: 0,
      alertsByType: {},
      alertsBySeverity: {},
      topAlertSources: [],
      escalationRate: 0,
      falsePositiveRate: 0,
    };
  }
  
  // ========================================================================================
  // Public API
  // ========================================================================================
  
  getActiveAlerts(): TruthAlert[] {
    return Array.from(this.activeAlerts.values()).filter(a => !a.resolved);
  }
  
  getAlert(alertId: string): TruthAlert | undefined {
    return this.activeAlerts.get(alertId);
  }
  
  getAlertHistory(alertId?: string, limit: number = 100): AlertHistory[] {
    let history = this.alertHistory;
    
    if (alertId) {
      history = history.filter(h => h.alertId === alertId);
    }
    
    return history.slice(-limit);
  }
  
  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }
  
  getAlertChannels(): AlertChannel[] {
    return Array.from(this.alertChannels.values());
  }
  
  getStatistics(): AlertStatistics {
    return { ...this.statistics };
  }
  
  createSuppression(alertId: string, suppression: Omit<AlertSuppression, 'id'>): string {
    const suppressionId = `suppression-${Date.now()}`;
    this.suppressions.set(suppressionId, { ...suppression, id: suppressionId });
    return suppressionId;
  }
  
  removeSuppression(suppressionId: string): boolean {
    return this.suppressions.delete(suppressionId);
  }
}

// ========================================================================================
// Supporting Interfaces
// ========================================================================================

interface MetricState {
  key: string;
  currentValue: number;
  previousValue: number;
  lastUpdate: Date;
  changeRate: number;
  samples: number[];
  thresholdViolations: Map<string, ThresholdViolation>;
}

interface ThresholdViolation {
  ruleId: string;
  startTime: Date;
  lastSeen: Date;
  count: number;
  alertId: string | null;
}