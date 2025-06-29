/**
 * Process execution metrics collection and monitoring
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

export interface ProcessMetrics {
  totalSpawns: number;
  successfulSpawns: number;
  failedSpawns: number;
  averageDuration: number;
  commandFrequency: Record<string, number>;
  lastExecutions: ProcessExecution[];
  alertsTriggered: number;
  thresholdViolations: ThresholdViolation[];
}

export interface ProcessExecution {
  id: string;
  command: string;
  args: string[];
  startTime: number;
  endTime?: number;
  duration?: number;
  exitCode?: number;
  success?: boolean;
  pid?: number;
  error?: string;
}

export interface ThresholdViolation {
  timestamp: number;
  type: 'spawn_count' | 'failure_rate' | 'resource_usage';
  currentValue: number;
  thresholdValue: number;
  message: string;
}

export interface TracingConfig {
  enabled: boolean;
  maxExecutionHistory: number;
  spawnCountThreshold: number;
  failureRateThreshold: number;
  alertOnThresholdViolation: boolean;
  persistMetrics: boolean;
  metricsFilePath?: string;
  debugMode: boolean;
}

class ProcessMetricsCollector extends EventEmitter {
  private static instance: ProcessMetricsCollector | null = null;
  private metrics: ProcessMetrics;
  private config: TracingConfig;
  private metricsFilePath: string;
  
  private constructor(config: Partial<TracingConfig> = {}) {
    super();
    
    this.config = {
      enabled: true,
      maxExecutionHistory: 100,
      spawnCountThreshold: 9, // Alert at 9 spawns
      failureRateThreshold: 0.3, // Alert at 30% failure rate
      alertOnThresholdViolation: true,
      persistMetrics: true,
      debugMode: false,
      ...config
    };
    
    this.metricsFilePath = this.config.metricsFilePath || path.join(process.cwd(), '.claude-flow', 'process-metrics.json');
    
    this.metrics = {
      totalSpawns: 0,
      successfulSpawns: 0,
      failedSpawns: 0,
      averageDuration: 0,
      commandFrequency: {},
      lastExecutions: [],
      alertsTriggered: 0,
      thresholdViolations: []
    };
    
    // Load existing metrics if available
    this.loadMetrics().catch(() => {
      // Ignore load errors on first run
    });
  }
  
  static getInstance(config?: Partial<TracingConfig>): ProcessMetricsCollector {
    if (!ProcessMetricsCollector.instance) {
      ProcessMetricsCollector.instance = new ProcessMetricsCollector(config);
    }
    return ProcessMetricsCollector.instance;
  }
  
  /**
   * Record a new process spawn
   */
  recordSpawn(command: string, args: string[] = [], options: any = {}): string {
    if (!this.config.enabled) {
      return '';
    }
    
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    const execution: ProcessExecution = {
      id: executionId,
      command,
      args,
      startTime: Date.now()
    };
    
    // Update metrics
    this.metrics.totalSpawns++;
    this.metrics.commandFrequency[command] = (this.metrics.commandFrequency[command] || 0) + 1;
    
    // Add to execution history
    this.metrics.lastExecutions.unshift(execution);
    if (this.metrics.lastExecutions.length > this.config.maxExecutionHistory) {
      this.metrics.lastExecutions.pop();
    }
    
    // Check thresholds
    this.checkThresholds();
    
    // Debug logging
    if (this.config.debugMode) {
      console.debug(`[ProcessTracing] Spawn recorded: ${command} ${args.join(' ')} (ID: ${executionId})`);
    }
    
    // Persist metrics if enabled
    if (this.config.persistMetrics) {
      this.saveMetrics().catch(error => {
        console.warn('[ProcessTracing] Failed to save metrics:', error.message);
      });
    }
    
    return executionId;
  }
  
  /**
   * Record process completion
   */
  recordCompletion(executionId: string, success: boolean, exitCode?: number, error?: string, pid?: number): void {
    if (!this.config.enabled) {
      return;
    }
    
    const execution = this.metrics.lastExecutions.find(exec => exec.id === executionId);
    if (!execution) {
      return;
    }
    
    execution.endTime = Date.now();
    execution.duration = execution.endTime - execution.startTime;
    execution.success = success;
    if (exitCode !== undefined) {
      execution.exitCode = exitCode;
    }
    if (error !== undefined) {
      execution.error = error;
    }
    if (pid !== undefined) {
      execution.pid = pid;
    }
    
    // Update success/failure counts
    if (success) {
      this.metrics.successfulSpawns++;
    } else {
      this.metrics.failedSpawns++;
    }
    
    // Update average duration
    const completedExecutions = this.metrics.lastExecutions.filter(exec => exec.duration !== undefined);
    if (completedExecutions.length > 0) {
      const totalDuration = completedExecutions.reduce((sum, exec) => sum + (exec.duration || 0), 0);
      this.metrics.averageDuration = totalDuration / completedExecutions.length;
    }
    
    // Debug logging
    if (this.config.debugMode) {
      console.debug(`[ProcessTracing] Completion recorded: ${executionId} (Success: ${success}, Duration: ${execution.duration}ms)`);
    }
    
    // Check thresholds again after completion
    this.checkThresholds();
    
    // Persist metrics if enabled
    if (this.config.persistMetrics) {
      this.saveMetrics().catch(error => {
        console.warn('[ProcessTracing] Failed to save metrics:', error.message);
      });
    }
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): ProcessMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Get process spawn count
   */
  getSpawnCount(): number {
    return this.metrics.totalSpawns;
  }
  
  /**
   * Get failure rate
   */
  getFailureRate(): number {
    if (this.metrics.totalSpawns === 0) {
      return 0;
    }
    return this.metrics.failedSpawns / this.metrics.totalSpawns;
  }
  
  /**
   * Check if thresholds are violated
   */
  private checkThresholds(): void {
    const currentTime = Date.now();
    
    // Check spawn count threshold
    if (this.metrics.totalSpawns >= this.config.spawnCountThreshold) {
      const violation: ThresholdViolation = {
        timestamp: currentTime,
        type: 'spawn_count',
        currentValue: this.metrics.totalSpawns,
        thresholdValue: this.config.spawnCountThreshold,
        message: `Process spawn count (${this.metrics.totalSpawns}) exceeded threshold (${this.config.spawnCountThreshold})`
      };
      
      this.recordThresholdViolation(violation);
    }
    
    // Check failure rate threshold
    const failureRate = this.getFailureRate();
    if (this.metrics.totalSpawns > 0 && failureRate >= this.config.failureRateThreshold) {
      const violation: ThresholdViolation = {
        timestamp: currentTime,
        type: 'failure_rate',
        currentValue: failureRate,
        thresholdValue: this.config.failureRateThreshold,
        message: `Process failure rate (${(failureRate * 100).toFixed(1)}%) exceeded threshold (${(this.config.failureRateThreshold * 100).toFixed(1)}%)`
      };
      
      this.recordThresholdViolation(violation);
    }
  }
  
  /**
   * Record a threshold violation
   */
  private recordThresholdViolation(violation: ThresholdViolation): void {
    // Avoid duplicate violations within a short time period
    const recentViolation = this.metrics.thresholdViolations.find(
      v => v.type === violation.type && 
           (violation.timestamp - v.timestamp) < 5000 // 5 seconds
    );
    
    if (recentViolation) {
      return;
    }
    
    this.metrics.thresholdViolations.push(violation);
    this.metrics.alertsTriggered++;
    
    // Limit violation history
    if (this.metrics.thresholdViolations.length > 50) {
      this.metrics.thresholdViolations = this.metrics.thresholdViolations.slice(-50);
    }
    
    // Emit violation event
    this.emit('threshold-violation', violation);
    
    // Alert if enabled
    if (this.config.alertOnThresholdViolation) {
      console.warn(`🚨 [ProcessTracing] THRESHOLD VIOLATION: ${violation.message}`);
      
      // Fail operations if spawn count is critical
      if (violation.type === 'spawn_count' && violation.currentValue >= this.config.spawnCountThreshold) {
        console.error(`❌ [ProcessTracing] CRITICAL: Too many process spawns detected. Consider optimizing process usage.`);
        this.emit('critical-threshold', violation);
      }
    }
  }
  
  /**
   * Reset metrics
   */
  reset(): void {
    this.metrics = {
      totalSpawns: 0,
      successfulSpawns: 0,
      failedSpawns: 0,
      averageDuration: 0,
      commandFrequency: {},
      lastExecutions: [],
      alertsTriggered: 0,
      thresholdViolations: []
    };
    
    if (this.config.persistMetrics) {
      this.saveMetrics().catch(() => {
        // Ignore save errors
      });
    }
  }
  
  /**
   * Load metrics from file
   */
  private async loadMetrics(): Promise<void> {
    try {
      const data = await fs.readFile(this.metricsFilePath, 'utf-8');
      const savedMetrics = JSON.parse(data);
      
      // Merge with defaults to handle version differences
      this.metrics = {
        ...this.metrics,
        ...savedMetrics
      };
      
      if (this.config.debugMode) {
        console.debug(`[ProcessTracing] Loaded metrics from ${this.metricsFilePath}`);
      }
    } catch (error) {
      // File doesn't exist or is invalid, start fresh
      if (this.config.debugMode) {
        console.debug(`[ProcessTracing] Could not load metrics: ${error}`);
      }
    }
  }
  
  /**
   * Save metrics to file
   */
  private async saveMetrics(): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.metricsFilePath), { recursive: true });
      
      // Save metrics
      await fs.writeFile(this.metricsFilePath, JSON.stringify(this.metrics, null, 2));
      
      if (this.config.debugMode) {
        console.debug(`[ProcessTracing] Saved metrics to ${this.metricsFilePath}`);
      }
    } catch (error) {
      console.warn(`[ProcessTracing] Failed to save metrics: ${error}`);
    }
  }
  
  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<TracingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (newConfig.metricsFilePath) {
      this.metricsFilePath = newConfig.metricsFilePath;
    }
  }
  
  /**
   * Export metrics for reporting
   */
  exportMetrics(): string {
    const report = {
      timestamp: new Date().toISOString(),
      config: this.config,
      metrics: this.metrics,
      summary: {
        totalProcesses: this.metrics.totalSpawns,
        successRate: this.metrics.totalSpawns > 0 ? (this.metrics.successfulSpawns / this.metrics.totalSpawns * 100).toFixed(2) + '%' : 'N/A',
        failureRate: this.metrics.totalSpawns > 0 ? (this.metrics.failedSpawns / this.metrics.totalSpawns * 100).toFixed(2) + '%' : 'N/A',
        averageDuration: this.metrics.averageDuration.toFixed(2) + 'ms',
        mostUsedCommand: this.getMostUsedCommand(),
        recentAlerts: this.metrics.thresholdViolations.length
      }
    };
    
    return JSON.stringify(report, null, 2);
  }
  
  /**
   * Get the most frequently used command
   */
  private getMostUsedCommand(): string {
    if (Object.keys(this.metrics.commandFrequency).length === 0) {
      return 'None';
    }
    
    const entries = Object.entries(this.metrics.commandFrequency)
      .sort(([,a], [,b]) => b - a);
    return entries[0]?.[0] ?? 'None';
  }
}

// Export singleton instance
export const metrics = ProcessMetricsCollector.getInstance();

// Export class for custom instances
export { ProcessMetricsCollector };
