/**
 * System Monitor - Real-time monitoring of system processes
 */

import { colors } from '@cliffy/ansi/colors';
import { ProcessManager } from './process-manager.js';
import { SystemEvents } from '../../../utils/types.js';
import { eventBus } from '../../../core/event-bus.js';

export class SystemMonitor {
  private processManager: ProcessManager;
  private events: any[] = [];
  private maxEvents = 100;
  private metricsInterval?: NodeJS.Timeout;

  constructor(processManager: ProcessManager) {
    this.processManager = processManager;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // System events
    eventBus.on(SystemEvents.AGENT_SPAWNED, (data: any) => {
      this.addEvent({
        type: 'agent_spawned',
        timestamp: Date.now(),
        data,
        level: 'info'
      });
    });

    eventBus.on(SystemEvents.AGENT_TERMINATED, (data: any) => {
      this.addEvent({
        type: 'agent_terminated',
        timestamp: Date.now(),
        data,
        level: 'warning'
      });
    });

    eventBus.on(SystemEvents.TASK_ASSIGNED, (data: any) => {
      this.addEvent({
        type: 'task_assigned',
        timestamp: Date.now(),
        data,
        level: 'info'
      });
    });

    eventBus.on(SystemEvents.TASK_COMPLETED, (data: any) => {
      this.addEvent({
        type: 'task_completed',
        timestamp: Date.now(),
        data,
        level: 'success'
      });
    });

    eventBus.on(SystemEvents.TASK_FAILED, (data: any) => {
      this.addEvent({
        type: 'task_failed',
        timestamp: Date.now(),
        data,
        level: 'error'
      });
    });

    eventBus.on(SystemEvents.SYSTEM_ERROR, (data: any) => {
      this.addEvent({
        type: 'system_error',
        timestamp: Date.now(),
        data,
        level: 'error'
      });
    });

    // Process manager events
    this.processManager.on('processStarted', ({ processId, process }) => {
      this.addEvent({
        type: 'process_started',
        timestamp: Date.now(),
        data: { processId, processName: process.name },
        level: 'success'
      });
    });

    this.processManager.on('processStopped', ({ processId }) => {
      this.addEvent({
        type: 'process_stopped',
        timestamp: Date.now(),
        data: { processId },
        level: 'warning'
      });
    });

    this.processManager.on('processError', ({ processId, error }) => {
      this.addEvent({
        type: 'process_error',
        timestamp: Date.now(),
        data: { processId, error: error.message },
        level: 'error'
      });
    });
  }

  private addEvent(event: any): void {
    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }
  }

  start(): void {
    // Start collecting metrics
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, 5000);
  }

  stop(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }

  private collectMetrics(): void {
    // Collect system metrics
    const processes = this.processManager.getAllProcesses();
    
    for (const process of processes) {
      if (process.status === 'running') {
        // Simulate metrics collection (would integrate with actual monitoring)
        process.metrics = {
          ...process.metrics,
          cpu: Math.random() * 50,
          memory: Math.random() * 200,
          uptime: process.startTime ? Date.now() - process.startTime : 0
        };
      }
    }
  }

  getRecentEvents(count: number = 10): any[] {
    return this.events.slice(0, count);
  }

  printEventLog(count: number = 20): void {
    console.log(colors.cyan.bold('📊 Recent System Events'));
    console.log(colors.gray('─'.repeat(80)));
    
    const events = this.getRecentEvents(count);
    
    for (const event of events) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      const icon = this.getEventIcon(event.type);
      const color = this.getEventColor(event.level);
      
      console.log(
        colors.gray(timestamp),
        icon,
        color(this.formatEventMessage(event))
      );
    }
  }

  private getEventIcon(type: string): string {
    const icons: Record<string, string> = {
      agent_spawned: '🤖',
      agent_terminated: '🔚',
      task_assigned: '📌',
      task_completed: '✅',
      task_failed: '❌',
      system_error: '⚠️',
      process_started: '▶️',
      process_stopped: '⏹️',
      process_error: '🚨'
    };
    
    return icons[type] || '•';
  }

  private getEventColor(level: string): (text: string) => string {
    switch (level) {
      case 'success':
        return colors.green;
      case 'info':
        return colors.blue;
      case 'warning':
        return colors.yellow;
      case 'error':
        return colors.red;
      default:
        return colors.white;
    }
  }

  private formatEventMessage(event: any): string {
    switch (event.type) {
      case 'agent_spawned':
        return `Agent spawned: ${event.data.agentId} (${event.data.profile?.type || 'unknown'})`;
      case 'agent_terminated':
        return `Agent terminated: ${event.data.agentId} - ${event.data.reason}`;
      case 'task_assigned':
        return `Task ${event.data.taskId} assigned to ${event.data.agentId}`;
      case 'task_completed':
        return `Task completed: ${event.data.taskId}`;
      case 'task_failed':
        return `Task failed: ${event.data.taskId} - ${event.data.error?.message}`;
      case 'system_error':
        return `System error in ${event.data.component}: ${event.data.error?.message}`;
      case 'process_started':
        return `Process started: ${event.data.processName}`;
      case 'process_stopped':
        return `Process stopped: ${event.data.processId}`;
      case 'process_error':
        return `Process error: ${event.data.processId} - ${event.data.error}`;
      default:
        return JSON.stringify(event.data);
    }
  }

  printSystemHealth(): void {
    const stats = this.processManager.getSystemStats();
    const processes = this.processManager.getAllProcesses();
    
    console.log(colors.cyan.bold('🏥 System Health'));
    console.log(colors.gray('─'.repeat(60)));
    
    // Overall status
    const healthStatus = stats.errorProcesses === 0 ? 
      colors.green('● Healthy') : 
      colors.red(`● Unhealthy (${stats.errorProcesses} errors)`);
    
    console.log('Status:', healthStatus);
    console.log('Uptime:', this.formatUptime(stats.systemUptime));
    console.log();
    
    // Process status
    console.log(colors.white.bold('Process Status:'));
    for (const process of processes) {
      const status = this.getProcessStatusIcon(process.status);
      const metrics = process.metrics;
      
      let line = `  ${status} ${process.name.padEnd(20)}`;
      
      if (metrics && process.status === 'running') {
        line += colors.gray(` CPU: ${metrics.cpu?.toFixed(1)}% `);
        line += colors.gray(` MEM: ${metrics.memory?.toFixed(0)}MB`);
      }
      
      console.log(line);
    }
    
    console.log();
    
    // System metrics
    console.log(colors.white.bold('System Metrics:'));
    console.log(`  Active Processes: ${stats.runningProcesses}/${stats.totalProcesses}`);
    console.log(`  Recent Events: ${this.events.length}`);
    
    // Recent errors
    const recentErrors = this.events
      .filter(e => e.level === 'error')
      .slice(0, 3);
    
    if (recentErrors.length > 0) {
      console.log();
      console.log(colors.red.bold('Recent Errors:'));
      for (const error of recentErrors) {
        const time = new Date(error.timestamp).toLocaleTimeString();
        console.log(colors.red(`  ${time} - ${this.formatEventMessage(error)}`));
      }
    }
  }

  private getProcessStatusIcon(status: string): string {
    switch (status) {
      case 'running':
        return colors.green('●');
      case 'stopped':
        return colors.gray('○');
      case 'starting':
        return colors.yellow('◐');
      case 'stopping':
        return colors.yellow('◑');
      case 'error':
        return colors.red('✗');
      default:
        return colors.gray('?');
    }
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}