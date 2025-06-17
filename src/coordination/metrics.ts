/**
 * Metrics and monitoring for coordination performance
 */

import { ILogger } from '../core/logger.js';
import { IEventBus } from '../core/event-bus.js';
import { SystemEvents } from '../utils/types.js';

export interface CoordinationMetrics {
  timestamp: Date;
  
  // Task metrics
  taskMetrics: {
    totalTasks: number;
    activeTasks: number;
    completedTasks: number;
    failedTasks: number;
    cancelledTasks: number;
    avgTaskDuration: number;
    taskThroughput: number; // tasks/minute
    tasksByPriority: Record<string, number>;
    tasksByType: Record<string, number>;
  };
  
  // Agent metrics
  agentMetrics: {
    totalAgents: number;
    activeAgents: number;
    idleAgents: number;
    busyAgents: number;
    agentUtilization: number; // percentage
    avgTasksPerAgent: number;
    agentsByType: Record<string, number>;
  };
  
  // Resource metrics
  resourceMetrics: {
    totalResources: number;
    lockedResources: number;
    freeResources: number;
    resourceUtilization: number; // percentage
    avgLockDuration: number;
    lockContention: number; // waiting requests
    deadlockCount: number;
  };
  
  // Coordination metrics
  coordinationMetrics: {
    messagesSent: number;
    messagesReceived: number;
    messageLatency: number; // avg ms
    conflictsDetected: number;
    conflictsResolved: number;
    workStealingEvents: number;
    circuitBreakerTrips: number;
  };
  
  // Performance metrics
  performanceMetrics: {
    coordinationLatency: number; // avg ms
    schedulingLatency: number; // avg ms
    memoryUsage: number; // MB
    cpuUsage: number; // percentage
    errorRate: number; // errors/minute
  };
}

export interface MetricsSample {
  timestamp: Date;
  metric: string;
  value: number;
  tags?: Record<string, string>;
}

/**
 * Metrics collector for coordination system
 */
export class CoordinationMetricsCollector {
  private samples: MetricsSample[] = [];
  private taskStartTimes = new Map<string, Date>();
  private messageStartTimes = new Map<string, Date>();
  private lockStartTimes = new Map<string, Date>();
  private collectionInterval?: number;
  
  // Counters
  private counters = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    messagesSent: 0,
    messagesReceived: 0,
    conflictsDetected: 0,
    conflictsResolved: 0,
    workStealingEvents: 0,
    circuitBreakerTrips: 0,
    deadlockCount: 0,
    errors: 0,
  };
  
  // Gauges
  private gauges = {
    activeTasks: 0,
    activeAgents: 0,
    idleAgents: 0,
    busyAgents: 0,
    lockedResources: 0,
    freeResources: 0,
    lockContention: 0,
  };
  
  // Histograms (for calculating averages)
  private histograms = {
    taskDurations: [] as number[],
    messageDurations: [] as number[],
    lockDurations: [] as number[],
    coordinationLatencies: [] as number[],
    schedulingLatencies: [] as number[],
  };

  constructor(
    private logger: ILogger,
    private eventBus: IEventBus,
    private collectionIntervalMs = 30000, // 30 seconds
  ) {
    this.setupEventHandlers();
  }

  /**
   * Start metrics collection
   */
  start(): void {
    this.logger.info('Starting coordination metrics collection');
    
    this.collectionInterval = setInterval(() => {
      this.collectMetrics();
    }, this.collectionIntervalMs);
  }

  /**
   * Stop metrics collection
   */
  stop(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      delete this.collectionInterval;
    }
    
    this.logger.info('Stopped coordination metrics collection');
  }

  /**
   * Record a metric sample
   */
  recordMetric(metric: string, value: number, tags?: Record<string, string>): void {
    const sample: MetricsSample = {
      timestamp: new Date(),
      metric,
      value,
    };
    
    if (tags !== undefined) {
      sample.tags = tags;
    }
    
    this.samples.push(sample);
    
    // Keep only last 10000 samples to prevent memory bloat
    if (this.samples.length > 10000) {
      this.samples = this.samples.slice(-5000);
    }
  }

  /**
   * Get current metrics snapshot
   */
  getCurrentMetrics(): CoordinationMetrics {
    const now = new Date();
    const minuteAgo = new Date(now.getTime() - 60000);
    
    // Calculate throughput (items per minute)
    const recentSamples = this.samples.filter(s => s.timestamp >= minuteAgo);
    const taskCompletions = recentSamples.filter(s => s.metric === 'task.completed').length;
    const errorCount = recentSamples.filter(s => s.metric === 'error').length;
    
    return {
      timestamp: now,
      
      taskMetrics: {
        totalTasks: this.counters.totalTasks,
        activeTasks: this.gauges.activeTasks,
        completedTasks: this.counters.completedTasks,
        failedTasks: this.counters.failedTasks,
        cancelledTasks: this.counters.cancelledTasks,
        avgTaskDuration: this.average(this.histograms.taskDurations),
        taskThroughput: taskCompletions,
        tasksByPriority: this.getTasksByPriority(),
        tasksByType: this.getTasksByType(),
      },
      
      agentMetrics: {
        totalAgents: this.gauges.activeAgents + this.gauges.idleAgents,
        activeAgents: this.gauges.activeAgents,
        idleAgents: this.gauges.idleAgents,
        busyAgents: this.gauges.busyAgents,
        agentUtilization: this.calculateAgentUtilization(),
        avgTasksPerAgent: this.calculateAvgTasksPerAgent(),
        agentsByType: this.getAgentsByType(),
      },
      
      resourceMetrics: {
        totalResources: this.gauges.lockedResources + this.gauges.freeResources,
        lockedResources: this.gauges.lockedResources,
        freeResources: this.gauges.freeResources,
        resourceUtilization: this.calculateResourceUtilization(),
        avgLockDuration: this.average(this.histograms.lockDurations),
        lockContention: this.gauges.lockContention,
        deadlockCount: this.counters.deadlockCount,
      },
      
      coordinationMetrics: {
        messagesSent: this.counters.messagesSent,
        messagesReceived: this.counters.messagesReceived,
        messageLatency: this.average(this.histograms.messageDurations),
        conflictsDetected: this.counters.conflictsDetected,
        conflictsResolved: this.counters.conflictsResolved,
        workStealingEvents: this.counters.workStealingEvents,
        circuitBreakerTrips: this.counters.circuitBreakerTrips,
      },
      
      performanceMetrics: {
        coordinationLatency: this.average(this.histograms.coordinationLatencies),
        schedulingLatency: this.average(this.histograms.schedulingLatencies),
        memoryUsage: this.getMemoryUsage(),
        cpuUsage: this.getCpuUsage(),
        errorRate: errorCount,
      },
    };
  }

  /**
   * Get metric history for a specific metric
   */
  getMetricHistory(metric: string, since?: Date): MetricsSample[] {
    const cutoff = since || new Date(Date.now() - 3600000); // 1 hour ago
    
    return this.samples.filter(s => 
      s.metric === metric && s.timestamp >= cutoff
    );
  }

  /**
   * Get top metrics by value
   */
  getTopMetrics(limit = 10): Array<{ metric: string; value: number; timestamp: Date }> {
    const recent = this.samples.filter(s => 
      s.timestamp >= new Date(Date.now() - 300000) // 5 minutes
    );
    
    const byMetric = new Map<string, number>();
    const timestamps = new Map<string, Date>();
    
    for (const sample of recent) {
      byMetric.set(sample.metric, (byMetric.get(sample.metric) || 0) + sample.value);
      timestamps.set(sample.metric, sample.timestamp);
    }
    
    return Array.from(byMetric.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([metric, value]) => ({
        metric,
        value,
        timestamp: timestamps.get(metric)!,
      }));
  }

  /**
   * Set up event handlers to collect metrics
   */
  private setupEventHandlers(): void {
    // Task events
    this.eventBus.on(SystemEvents.TASK_CREATED, () => {
      this.counters.totalTasks++;
      this.recordMetric('task.created', 1);
    });

    this.eventBus.on(SystemEvents.TASK_STARTED, (data: any) => {
      this.taskStartTimes.set(data.taskId, new Date());
      this.gauges.activeTasks++;
      this.recordMetric('task.started', 1);
    });

    this.eventBus.on(SystemEvents.TASK_COMPLETED, (data: any) => {
      this.counters.completedTasks++;
      this.gauges.activeTasks = Math.max(0, this.gauges.activeTasks - 1);
      
      const startTime = this.taskStartTimes.get(data.taskId);
      if (startTime) {
        const duration = new Date().getTime() - startTime.getTime();
        this.histograms.taskDurations.push(duration);
        this.taskStartTimes.delete(data.taskId);
      }
      
      this.recordMetric('task.completed', 1);
    });

    this.eventBus.on(SystemEvents.TASK_FAILED, (data: any) => {
      this.counters.failedTasks++;
      this.gauges.activeTasks = Math.max(0, this.gauges.activeTasks - 1);
      this.taskStartTimes.delete(data.taskId);
      this.recordMetric('task.failed', 1);
    });

    this.eventBus.on(SystemEvents.TASK_CANCELLED, (data: any) => {
      this.counters.cancelledTasks++;
      this.gauges.activeTasks = Math.max(0, this.gauges.activeTasks - 1);
      this.taskStartTimes.delete(data.taskId);
      this.recordMetric('task.cancelled', 1);
    });

    // Agent events
    this.eventBus.on(SystemEvents.AGENT_SPAWNED, () => {
      this.gauges.activeAgents++;
      this.recordMetric('agent.spawned', 1);
    });

    this.eventBus.on(SystemEvents.AGENT_TERMINATED, () => {
      this.gauges.activeAgents = Math.max(0, this.gauges.activeAgents - 1);
      this.recordMetric('agent.terminated', 1);
    });

    this.eventBus.on(SystemEvents.AGENT_IDLE, () => {
      this.gauges.idleAgents++;
      this.gauges.busyAgents = Math.max(0, this.gauges.busyAgents - 1);
      this.recordMetric('agent.idle', 1);
    });

    this.eventBus.on(SystemEvents.AGENT_ACTIVE, () => {
      this.gauges.busyAgents++;
      this.gauges.idleAgents = Math.max(0, this.gauges.idleAgents - 1);
      this.recordMetric('agent.active', 1);
    });

    // Resource events
    this.eventBus.on(SystemEvents.RESOURCE_ACQUIRED, (data: any) => {
      this.lockStartTimes.set(data.resourceId, new Date());
      this.gauges.lockedResources++;
      this.gauges.freeResources = Math.max(0, this.gauges.freeResources - 1);
      this.recordMetric('resource.acquired', 1);
    });

    this.eventBus.on(SystemEvents.RESOURCE_RELEASED, (data: any) => {
      this.gauges.freeResources++;
      this.gauges.lockedResources = Math.max(0, this.gauges.lockedResources - 1);
      
      const startTime = this.lockStartTimes.get(data.resourceId);
      if (startTime) {
        const duration = new Date().getTime() - startTime.getTime();
        this.histograms.lockDurations.push(duration);
        this.lockStartTimes.delete(data.resourceId);
      }
      
      this.recordMetric('resource.released', 1);
    });

    // Deadlock events
    this.eventBus.on(SystemEvents.DEADLOCK_DETECTED, () => {
      this.counters.deadlockCount++;
      this.recordMetric('deadlock.detected', 1);
    });

    // Message events
    this.eventBus.on(SystemEvents.MESSAGE_SENT, (data: any) => {
      this.counters.messagesSent++;
      this.messageStartTimes.set(data.message.id, new Date());
      this.recordMetric('message.sent', 1);
    });

    this.eventBus.on(SystemEvents.MESSAGE_RECEIVED, (data: any) => {
      this.counters.messagesReceived++;
      
      const startTime = this.messageStartTimes.get(data.message.id);
      if (startTime) {
        const duration = new Date().getTime() - startTime.getTime();
        this.histograms.messageDurations.push(duration);
        this.messageStartTimes.delete(data.message.id);
      }
      
      this.recordMetric('message.received', 1);
    });

    // Conflict events
    this.eventBus.on('conflict:resource', () => {
      this.counters.conflictsDetected++;
      this.recordMetric('conflict.detected', 1);
    });

    this.eventBus.on('conflict:resolved', () => {
      this.counters.conflictsResolved++;
      this.recordMetric('conflict.resolved', 1);
    });

    // Work stealing events
    this.eventBus.on('workstealing:request', () => {
      this.counters.workStealingEvents++;
      this.recordMetric('workstealing.event', 1);
    });

    // Circuit breaker events
    this.eventBus.on('circuitbreaker:state-change', (data: any) => {
      if (data.to === 'open') {
        this.counters.circuitBreakerTrips++;
        this.recordMetric('circuitbreaker.trip', 1);
      }
    });

    // Error events
    this.eventBus.on(SystemEvents.SYSTEM_ERROR, () => {
      this.counters.errors++;
      this.recordMetric('error', 1);
    });
  }

  /**
   * Collect comprehensive metrics
   */
  private collectMetrics(): void {
    const metrics = this.getCurrentMetrics();
    
    // Emit metrics event
    this.eventBus.emit('metrics:coordination', metrics);
    
    // Log summary
    this.logger.debug('Coordination metrics collected', {
      activeTasks: metrics.taskMetrics.activeTasks,
      activeAgents: metrics.agentMetrics.activeAgents,
      lockedResources: metrics.resourceMetrics.lockedResources,
      taskThroughput: metrics.taskMetrics.taskThroughput,
    });
  }

  /**
   * Calculate average from array of numbers
   */
  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Get tasks grouped by priority
   */
  private getTasksByPriority(): Record<string, number> {
    const priorities = ['low', 'medium', 'high', 'critical'];
    const result: Record<string, number> = {};
    
    for (const priority of priorities) {
      result[priority] = this.samples.filter(s => 
        s.metric === 'task.created' && s.tags?.priority === priority
      ).length;
    }
    
    return result;
  }

  /**
   * Get tasks grouped by type
   */
  private getTasksByType(): Record<string, number> {
    const types = new Set<string>();
    
    for (const sample of this.samples) {
      if (sample.metric === 'task.created' && sample.tags?.type) {
        types.add(sample.tags.type);
      }
    }
    
    const result: Record<string, number> = {};
    for (const type of types) {
      result[type] = this.samples.filter(s => 
        s.metric === 'task.created' && s.tags?.type === type
      ).length;
    }
    
    return result;
  }

  /**
   * Get agents grouped by type
   */
  private getAgentsByType(): Record<string, number> {
    const types = new Set<string>();
    
    for (const sample of this.samples) {
      if (sample.metric === 'agent.spawned' && sample.tags?.type) {
        types.add(sample.tags.type);
      }
    }
    
    const result: Record<string, number> = {};
    for (const type of types) {
      result[type] = this.samples.filter(s => 
        s.metric === 'agent.spawned' && s.tags?.type === type
      ).length;
    }
    
    return result;
  }

  /**
   * Calculate agent utilization percentage
   */
  private calculateAgentUtilization(): number {
    const totalAgents = this.gauges.activeAgents + this.gauges.idleAgents;
    if (totalAgents === 0) return 0;
    return (this.gauges.busyAgents / totalAgents) * 100;
  }

  /**
   * Calculate average tasks per agent
   */
  private calculateAvgTasksPerAgent(): number {
    const totalAgents = this.gauges.activeAgents + this.gauges.idleAgents;
    if (totalAgents === 0) return 0;
    return this.gauges.activeTasks / totalAgents;
  }

  /**
   * Calculate resource utilization percentage
   */
  private calculateResourceUtilization(): number {
    const totalResources = this.gauges.lockedResources + this.gauges.freeResources;
    if (totalResources === 0) return 0;
    return (this.gauges.lockedResources / totalResources) * 100;
  }

  /**
   * Get current memory usage in MB
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed / 1024 / 1024;
    }
    return 0;
  }

  /**
   * Get current CPU usage percentage
   */
  private getCpuUsage(): number {
    if (typeof process !== 'undefined' && process.cpuUsage) {
      const usage = process.cpuUsage();
      return (usage.user + usage.system) / 1000000; // Convert to seconds
    }
    return 0;
  }

  /**
   * Clear all metrics data
   */
  clearMetrics(): void {
    this.samples = [];
    this.taskStartTimes.clear();
    this.messageStartTimes.clear();
    this.lockStartTimes.clear();
    
    // Reset counters
    for (const key in this.counters) {
      (this.counters as any)[key] = 0;
    }
    
    // Reset gauges
    for (const key in this.gauges) {
      (this.gauges as any)[key] = 0;
    }
    
    // Clear histograms
    for (const key in this.histograms) {
      (this.histograms as any)[key] = [];
    }
    
    this.logger.info('Coordination metrics cleared');
  }
}