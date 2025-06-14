/**
 * Performance Tracking and Monitoring for TaskMaster Integration
 * Tracks metrics, performance, and system health
 */

export interface PerformanceMetrics {
  // Task operations
  taskConversions: {
    toClaudeFlow: number;
    toTaskMaster: number;
    batchOperations: number;
    averageConversionTime: number;
  };
  
  // PRD operations
  prdOperations: {
    parsedPRDs: number;
    generatedTasks: number;
    averageParseTime: number;
    averageTasksPerPRD: number;
  };
  
  // Sync operations
  syncOperations: {
    successful: number;
    failed: number;
    conflictsResolved: number;
    averageSyncTime: number;
  };
  
  // System metrics
  system: {
    memoryUsage: number;
    cpuUsage: number;
    diskIO: number;
    networkRequests: number;
  };
  
  // Timestamps
  startTime: Date;
  lastUpdate: Date;
}

export interface AlertConfig {
  thresholds: {
    maxConversionTime: number; // ms
    maxMemoryUsage: number; // MB
    maxFailureRate: number; // percentage
    maxSyncTime: number; // ms
  };
  notifications: {
    email?: string[];
    webhook?: string;
    console: boolean;
  };
}

export class PerformanceTracker {
  private metrics: PerformanceMetrics;
  private alertConfig: AlertConfig;
  private operationTimes: Map<string, number[]> = new Map();

  constructor(alertConfig?: AlertConfig) {
    this.metrics = {
      taskConversions: {
        toClaudeFlow: 0,
        toTaskMaster: 0,
        batchOperations: 0,
        averageConversionTime: 0
      },
      prdOperations: {
        parsedPRDs: 0,
        generatedTasks: 0,
        averageParseTime: 0,
        averageTasksPerPRD: 0
      },
      syncOperations: {
        successful: 0,
        failed: 0,
        conflictsResolved: 0,
        averageSyncTime: 0
      },
      system: {
        memoryUsage: 0,
        cpuUsage: 0,
        diskIO: 0,
        networkRequests: 0
      },
      startTime: new Date(),
      lastUpdate: new Date()
    };

    this.alertConfig = alertConfig || {
      thresholds: {
        maxConversionTime: 1000,
        maxMemoryUsage: 512,
        maxFailureRate: 5,
        maxSyncTime: 5000
      },
      notifications: {
        console: true
      }
    };
  }

  // Track task conversion operations
  public trackTaskConversion(operation: 'toClaudeFlow' | 'toTaskMaster' | 'batch', duration: number): void {
    const key = operation === 'batch' ? 'batchOperations' : operation;
    this.metrics.taskConversions[key]++;
    
    this.recordOperationTime('taskConversion', duration);
    this.metrics.taskConversions.averageConversionTime = this.calculateAverage('taskConversion');
    
    this.checkThresholds('conversion', duration);
    this.updateTimestamp();
  }

  // Track PRD operations
  public trackPRDOperation(operation: 'parse' | 'generate', duration: number, taskCount?: number): void {
    if (operation === 'parse') {
      this.metrics.prdOperations.parsedPRDs++;
      this.recordOperationTime('prdParse', duration);
      this.metrics.prdOperations.averageParseTime = this.calculateAverage('prdParse');
    } else {
      this.metrics.prdOperations.generatedTasks += taskCount || 0;
      if (taskCount) {
        this.recordOperationTime('taskGeneration', taskCount);
        this.metrics.prdOperations.averageTasksPerPRD = this.calculateAverage('taskGeneration');
      }
    }
    
    this.checkThresholds('prd', duration);
    this.updateTimestamp();
  }

  // Track sync operations
  public trackSyncOperation(success: boolean, duration: number, conflictsResolved = 0): void {
    if (success) {
      this.metrics.syncOperations.successful++;
    } else {
      this.metrics.syncOperations.failed++;
    }
    
    this.metrics.syncOperations.conflictsResolved += conflictsResolved;
    this.recordOperationTime('sync', duration);
    this.metrics.syncOperations.averageSyncTime = this.calculateAverage('sync');
    
    const failureRate = (this.metrics.syncOperations.failed / 
      (this.metrics.syncOperations.successful + this.metrics.syncOperations.failed)) * 100;
    
    this.checkThresholds('sync', duration, failureRate);
    this.updateTimestamp();
  }

  // Update system metrics
  public updateSystemMetrics(): void {
    try {
      // In a real implementation, these would be actual system metrics
      const memUsage = process.memoryUsage();
      this.metrics.system.memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024); // MB
      
      // Mock CPU usage (in real implementation, use a proper system monitoring library)
      this.metrics.system.cpuUsage = Math.random() * 100;
      
      this.checkThresholds('system');
      this.updateTimestamp();
    } catch (error) {
      console.warn('Failed to update system metrics:', error);
    }
  }

  // Get current metrics
  public getMetrics(): PerformanceMetrics {
    this.updateSystemMetrics();
    return { ...this.metrics };
  }

  // Get formatted report
  public generateReport(): string {
    const metrics = this.getMetrics();
    const uptime = Date.now() - metrics.startTime.getTime();
    const uptimeHours = Math.round(uptime / (1000 * 60 * 60) * 100) / 100;

    return `
📊 TaskMaster Integration Performance Report
═══════════════════════════════════════════

⏱️  System Uptime: ${uptimeHours} hours
📅 Last Updated: ${metrics.lastUpdate.toLocaleString()}

🔄 Task Operations:
   • ClaudeFlow Conversions: ${metrics.taskConversions.toClaudeFlow}
   • TaskMaster Conversions: ${metrics.taskConversions.toTaskMaster}  
   • Batch Operations: ${metrics.taskConversions.batchOperations}
   • Average Conversion Time: ${metrics.taskConversions.averageConversionTime}ms

📄 PRD Operations:
   • PRDs Parsed: ${metrics.prdOperations.parsedPRDs}
   • Tasks Generated: ${metrics.prdOperations.generatedTasks}
   • Average Parse Time: ${metrics.prdOperations.averageParseTime}ms
   • Average Tasks per PRD: ${metrics.prdOperations.averageTasksPerPRD}

🔄 Sync Operations:
   • Successful Syncs: ${metrics.syncOperations.successful}
   • Failed Syncs: ${metrics.syncOperations.failed}
   • Conflicts Resolved: ${metrics.syncOperations.conflictsResolved}
   • Average Sync Time: ${metrics.syncOperations.averageSyncTime}ms

💻 System Metrics:
   • Memory Usage: ${metrics.system.memoryUsage}MB
   • CPU Usage: ${metrics.system.cpuUsage.toFixed(1)}%
   • Network Requests: ${metrics.system.networkRequests}

📈 Performance Summary:
   • Total Operations: ${this.getTotalOperations()}
   • Operations per Hour: ${Math.round(this.getTotalOperations() / uptimeHours)}
   • Success Rate: ${this.getSuccessRate().toFixed(1)}%
`;
  }

  // Export metrics for external monitoring
  public exportMetrics(format: 'json' | 'prometheus' = 'json'): string {
    const metrics = this.getMetrics();
    
    if (format === 'prometheus') {
      return this.formatPrometheusMetrics(metrics);
    }
    
    return JSON.stringify(metrics, null, 2);
  }

  // Reset metrics
  public reset(): void {
    this.metrics = {
      ...this.metrics,
      taskConversions: { toClaudeFlow: 0, toTaskMaster: 0, batchOperations: 0, averageConversionTime: 0 },
      prdOperations: { parsedPRDs: 0, generatedTasks: 0, averageParseTime: 0, averageTasksPerPRD: 0 },
      syncOperations: { successful: 0, failed: 0, conflictsResolved: 0, averageSyncTime: 0 },
      startTime: new Date()
    };
    this.operationTimes.clear();
  }

  // Private helper methods
  private recordOperationTime(operation: string, time: number): void {
    if (!this.operationTimes.has(operation)) {
      this.operationTimes.set(operation, []);
    }
    
    const times = this.operationTimes.get(operation)!;
    times.push(time);
    
    // Keep only last 100 measurements for memory efficiency
    if (times.length > 100) {
      times.splice(0, times.length - 100);
    }
  }

  private calculateAverage(operation: string): number {
    const times = this.operationTimes.get(operation);
    if (!times || times.length === 0) return 0;
    
    const sum = times.reduce((acc, time) => acc + time, 0);
    return Math.round(sum / times.length * 100) / 100;
  }

  private checkThresholds(type: string, value?: number, secondaryValue?: number): void {
    let alertTriggered = false;
    let alertMessage = '';

    switch (type) {
      case 'conversion':
        if (value && value > this.alertConfig.thresholds.maxConversionTime) {
          alertTriggered = true;
          alertMessage = `High conversion time: ${value}ms (threshold: ${this.alertConfig.thresholds.maxConversionTime}ms)`;
        }
        break;
      
      case 'sync':
        if (value && value > this.alertConfig.thresholds.maxSyncTime) {
          alertTriggered = true;
          alertMessage = `High sync time: ${value}ms (threshold: ${this.alertConfig.thresholds.maxSyncTime}ms)`;
        }
        if (secondaryValue && secondaryValue > this.alertConfig.thresholds.maxFailureRate) {
          alertTriggered = true;
          alertMessage += ` | High failure rate: ${secondaryValue.toFixed(1)}% (threshold: ${this.alertConfig.thresholds.maxFailureRate}%)`;
        }
        break;
      
      case 'system':
        if (this.metrics.system.memoryUsage > this.alertConfig.thresholds.maxMemoryUsage) {
          alertTriggered = true;
          alertMessage = `High memory usage: ${this.metrics.system.memoryUsage}MB (threshold: ${this.alertConfig.thresholds.maxMemoryUsage}MB)`;
        }
        break;
    }

    if (alertTriggered) {
      this.triggerAlert(alertMessage);
    }
  }

  private triggerAlert(message: string): void {
    if (this.alertConfig.notifications.console) {
      console.warn(`🚨 TaskMaster Alert: ${message}`);
    }
    
    // In a real implementation, send email/webhook notifications
    if (this.alertConfig.notifications.email) {
      // Send email notification
    }
    
    if (this.alertConfig.notifications.webhook) {
      // Send webhook notification
    }
  }

  private updateTimestamp(): void {
    this.metrics.lastUpdate = new Date();
  }

  private getTotalOperations(): number {
    return this.metrics.taskConversions.toClaudeFlow +
           this.metrics.taskConversions.toTaskMaster +
           this.metrics.taskConversions.batchOperations +
           this.metrics.prdOperations.parsedPRDs +
           this.metrics.syncOperations.successful +
           this.metrics.syncOperations.failed;
  }

  private getSuccessRate(): number {
    const total = this.metrics.syncOperations.successful + this.metrics.syncOperations.failed;
    if (total === 0) return 100;
    return (this.metrics.syncOperations.successful / total) * 100;
  }

  private formatPrometheusMetrics(metrics: PerformanceMetrics): string {
    return `
# TaskMaster Integration Metrics
taskmaster_conversions_total{type="to_claudeflow"} ${metrics.taskConversions.toClaudeFlow}
taskmaster_conversions_total{type="to_taskmaster"} ${metrics.taskConversions.toTaskMaster}
taskmaster_conversions_total{type="batch"} ${metrics.taskConversions.batchOperations}
taskmaster_conversion_duration_avg ${metrics.taskConversions.averageConversionTime}

taskmaster_prd_operations_total{type="parsed"} ${metrics.prdOperations.parsedPRDs}
taskmaster_prd_operations_total{type="generated_tasks"} ${metrics.prdOperations.generatedTasks}
taskmaster_prd_duration_avg ${metrics.prdOperations.averageParseTime}

taskmaster_sync_operations_total{status="success"} ${metrics.syncOperations.successful}
taskmaster_sync_operations_total{status="failed"} ${metrics.syncOperations.failed}
taskmaster_sync_conflicts_resolved_total ${metrics.syncOperations.conflictsResolved}
taskmaster_sync_duration_avg ${metrics.syncOperations.averageSyncTime}

taskmaster_memory_usage_mb ${metrics.system.memoryUsage}
taskmaster_cpu_usage_percent ${metrics.system.cpuUsage}
`.trim();
  }
}

// Singleton instance for global use
export const performanceTracker = new PerformanceTracker();

export default PerformanceTracker;