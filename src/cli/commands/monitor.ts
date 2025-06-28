/**
 * Monitor command for Claude-Flow - Live dashboard mode
 */

import { Command } from '@cliffy/command';
import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { formatProgressBar, formatDuration, formatStatusIndicator } from '../formatter.js';
import { writeFileSync, rmSync, existsSync } from 'fs';
import process from 'process';
import type { ComponentStatus, AlertData } from '../../types/missing-types.js';

export const monitorCommand = new Command()
  .description('Start live monitoring dashboard')
  .option('-i, --interval <seconds:number>', 'Update interval in seconds', { default: 2 })
  .option('-c, --compact', 'Compact view mode')
  .option('--no-graphs', 'Disable ASCII graphs')
  .option('--focus <component:string>', 'Focus on specific component')
  .action(async (options: any) => {
    await startMonitorDashboard(options);
  });

interface MonitorData {
  timestamp: Date;
  system: {
    cpu: number;
    memory: number;
    agents: number;
    tasks: number;
  };
  components: Record<string, any>;
  agents: any[];
  tasks: any[];
  events: any[];
}

class Dashboard {
  private data: MonitorData[] = [];
  private maxDataPoints = 60; // 2 minutes at 2-second intervals
  private running = true;
  private alerts: any[] = [];
  private startTime = Date.now();
  private exportData: any[] = [];

  constructor(private options: any) {}

  async start(): Promise<void> {
    // Hide cursor and clear screen
    process.stdout.write('\x1b[?25l');
    console.clear();

    // Setup signal handlers
    const cleanup = () => {
      this.running = false;
      process.stdout.write('\x1b[?25h'); // Show cursor
      console.log('\n' + colors.gray('Monitor stopped'));
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Start monitoring loop
    await this.monitoringLoop();
  }

  private async monitoringLoop(): Promise<void> {
    while (this.running) {
      try {
        const data = await this.collectData();
        this.data.push(data);
        
        // Keep only recent data points
        if (this.data.length > this.maxDataPoints) {
          this.data = this.data.slice(-this.maxDataPoints);
        }

        this.render();
        await new Promise(resolve => setTimeout(resolve, this.options.interval * 1000));
      } catch (error) {
        this.renderError(error);
        await new Promise(resolve => setTimeout(resolve, this.options.interval * 1000));
      }
    }
  }

  private async collectData(): Promise<MonitorData> {
    // Mock data collection - in production, this would connect to the orchestrator
    const timestamp = new Date();
    const cpuUsage = 10 + Math.random() * 20; // 10-30%
    const memoryUsage = 200 + Math.random() * 100; // 200-300MB
    
    return {
      timestamp,
      system: {
        cpu: cpuUsage,
        memory: memoryUsage,
        agents: 3 + Math.floor(Math.random() * 3),
        tasks: 5 + Math.floor(Math.random() * 10)
      },
      components: {
        orchestrator: { status: 'healthy', load: Math.random() * 100 },
        terminal: { status: 'healthy', load: Math.random() * 100 },
        memory: { status: 'healthy', load: Math.random() * 100 },
        coordination: { status: 'healthy', load: Math.random() * 100 },
        mcp: { status: 'healthy', load: Math.random() * 100 }
      },
      agents: this.generateMockAgents(),
      tasks: this.generateMockTasks(),
      events: this.generateMockEvents()
    };
  }

  private render(): void {
    console.clear();
    
    const latest = this.data[this.data.length - 1];
    if (!latest) return;

    // Header
    this.renderHeader(latest);
    
    if (this.options.focus) {
      this.renderFocusedComponent(latest, this.options.focus);
    } else {
      // System overview
      this.renderSystemOverview(latest);
      
      // Components status
      this.renderComponentsStatus(latest);
      
      if (!this.options.compact) {
        // Agents and tasks
        this.renderAgentsAndTasks(latest);
        
        // Recent events
        this.renderRecentEvents(latest);
        
        // Performance graphs
        if (!this.options.noGraphs) {
          this.renderPerformanceGraphs();
        }
      }
    }

    // Footer
    this.renderFooter();
  }

  private renderHeader(data: MonitorData): void {
    const time = data.timestamp.toLocaleTimeString();
    console.log(colors.cyan.bold('Claude-Flow Live Monitor') + colors.gray(` - ${time}`));
    console.log('═'.repeat(80));
  }

  private renderSystemOverview(data: MonitorData): void {
    console.log(colors.white.bold('System Overview'));
    console.log('─'.repeat(40));
    
    const cpuBar = formatProgressBar(data.system.cpu, 100, 20, 'CPU');
    const memoryBar = formatProgressBar(data.system.memory, 1024, 20, 'Memory');
    
    console.log(`${cpuBar} ${data.system.cpu.toFixed(1)}%`);
    console.log(`${memoryBar} ${data.system.memory.toFixed(0)}MB`);
    console.log(`${colors.white('Agents:')} ${data.system.agents} active`);
    console.log(`${colors.white('Tasks:')} ${data.system.tasks} in queue`);
    console.log();
  }

  private renderComponentsStatus(data: MonitorData): void {
    console.log(colors.white.bold('Components'));
    console.log('─'.repeat(40));
    
    const table = new Table()
      .header(['Component', 'Status', 'Load'])
      .border(false);

    for (const [name, component] of Object.entries(data.components)) {
      const statusIcon = formatStatusIndicator(component.status);
      const loadBar = this.createMiniProgressBar(component.load, 100, 10);
      
      table.push([
        colors.cyan(name),
        `${statusIcon} ${component.status}`,
        `${loadBar} ${component.load.toFixed(0)}%`
      ]);
    }
    
    table.render();
    console.log();
  }

  private renderAgentsAndTasks(data: MonitorData): void {
    // Agents table
    console.log(colors.white.bold('Active Agents'));
    console.log('─'.repeat(40));
    
    if (data.agents.length > 0) {
      const agentTable = new Table()
        .header(['ID', 'Type', 'Status', 'Tasks'])
        .border(false);

      for (const agent of data.agents.slice(0, 5)) {
        const statusIcon = formatStatusIndicator(agent.status);
        
        agentTable.push([
          colors.gray(agent.id.substring(0, 8) + '...'),
          colors.cyan(agent.type),
          `${statusIcon} ${agent.status}`,
          agent.activeTasks.toString()
        ]);
      }
      
      agentTable.render();
    } else {
      console.log(colors.gray('No active agents'));
    }
    console.log();

    // Recent tasks
    console.log(colors.white.bold('Recent Tasks'));
    console.log('─'.repeat(40));
    
    if (data.tasks.length > 0) {
      const taskTable = new Table()
        .header(['ID', 'Type', 'Status', 'Duration'])
        .border(false);

      for (const task of data.tasks.slice(0, 5)) {
        const statusIcon = formatStatusIndicator(task.status);
        
        taskTable.push([
          colors.gray(task.id.substring(0, 8) + '...'),
          colors.white(task.type),
          `${statusIcon} ${task.status}`,
          task.duration ? formatDuration(task.duration) : '-'
        ]);
      }
      
      taskTable.render();
    } else {
      console.log(colors.gray('No recent tasks'));
    }
    console.log();
  }

  private renderRecentEvents(data: MonitorData): void {
    console.log(colors.white.bold('Recent Events'));
    console.log('─'.repeat(40));
    
    if (data.events.length > 0) {
      for (const event of data.events.slice(0, 3)) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const icon = this.getEventIcon(event.type);
        console.log(`${colors.gray(time)} ${icon} ${event.message}`);
      }
    } else {
      console.log(colors.gray('No recent events'));
    }
    console.log();
  }

  private renderPerformanceGraphs(): void {
    console.log(colors.white.bold('Performance (Last 60s)'));
    console.log('─'.repeat(40));
    
    if (this.data.length >= 2) {
      // CPU graph
      console.log(colors.cyan('CPU Usage:'));
      console.log(this.createSparkline(this.data.map(d => d.system.cpu), 30));
      
      // Memory graph
      console.log(colors.cyan('Memory Usage:'));
      console.log(this.createSparkline(this.data.map(d => d.system.memory), 30));
    } else {
      console.log(colors.gray('Collecting data...'));
    }
    console.log();
  }

  private renderFocusedComponent(data: MonitorData, componentName: string): void {
    const component = data.components[componentName];
    if (!component) {
      console.log(colors.red(`Component '${componentName}' not found`));
      return;
    }

    console.log(colors.white.bold(`${componentName} Details`));
    console.log('─'.repeat(40));
    
    const statusIcon = formatStatusIndicator(component.status);
    console.log(`${statusIcon} Status: ${component.status}`);
    console.log(`Load: ${formatProgressBar(component.load, 100, 30)} ${component.load.toFixed(1)}%`);
    
    // Add component-specific metrics here
    console.log();
  }

  private renderFooter(): void {
    console.log('─'.repeat(80));
    console.log(colors.gray('Press Ctrl+C to exit • Update interval: ') + 
               colors.yellow(`${this.options.interval}s`));
  }

  private renderError(error: any): void {
    console.clear();
    console.log(colors.red.bold('Monitor Error'));
    console.log('─'.repeat(40));
    
    if ((error as Error).message.includes('ECONNREFUSED')) {
      console.log(colors.red('✗ Cannot connect to Claude-Flow'));
      console.log(colors.gray('Make sure Claude-Flow is running with: claude-flow start'));
    } else {
      console.log(colors.red('Error:'), (error as Error).message);
    }
    
    console.log('\n' + colors.gray('Retrying in ') + colors.yellow(`${this.options.interval}s...`));
  }

  private createMiniProgressBar(current: number, max: number, width: number): string {
    const filled = Math.floor((current / max) * width);
    const empty = width - filled;
    return colors.green('█'.repeat(filled)) + colors.gray('░'.repeat(empty));
  }

  private createSparkline(data: number[], width: number): string {
    if (data.length < 2) return colors.gray('▁'.repeat(width));
    
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    
    const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const recent = data.slice(-width);
    
    return recent.map(value => {
      const normalized = (value - min) / range;
      const charIndex = Math.floor(normalized * (chars.length - 1));
      return colors.cyan(chars[charIndex]);
    }).join('');
  }

  private getEventIcon(type: string): string {
    const icons = {
      agent_spawned: colors.green('↗'),
      agent_terminated: colors.red('↙'),
      task_completed: colors.green('✓'),
      task_failed: colors.red('✗'),
      task_assigned: colors.blue('→'),
      system_warning: colors.yellow('⚠'),
      system_error: colors.red('✗'),
    };
    return icons[type as keyof typeof icons] || colors.blue('•');
  }

  private generateMockAgents(): any[] {
    return [
      {
        id: 'agent-001',
        type: 'coordinator',
        status: 'active',
        activeTasks: Math.floor(Math.random() * 5) + 1
      },
      {
        id: 'agent-002',
        type: 'researcher',
        status: 'active',
        activeTasks: Math.floor(Math.random() * 8) + 1
      },
      {
        id: 'agent-003',
        type: 'implementer',
        status: Math.random() > 0.7 ? 'idle' : 'active',
        activeTasks: Math.floor(Math.random() * 3)
      }
    ];
  }

  private generateMockTasks(): any[] {
    const types = ['research', 'implementation', 'analysis', 'coordination'];
    const statuses = ['running', 'pending', 'completed', 'failed'];
    
    return Array.from({ length: 8 }, (_, i) => ({
      id: `task-${String(i + 1).padStart(3, '0')}`,
      type: types[Math.floor(Math.random() * types.length)],
      status: statuses[Math.floor(Math.random() * statuses.length)],
      duration: Math.random() > 0.5 ? Math.floor(Math.random() * 120000) : null
    }));
  }

  private generateMockEvents(): any[] {
    const events = [
      { type: 'task_completed', message: 'Research task completed successfully' },
      { type: 'agent_spawned', message: 'New implementer agent spawned' },
      { type: 'task_assigned', message: 'Task assigned to coordinator agent' },
      { type: 'system_warning', message: 'High memory usage detected' }
    ];
    
    const eventTypes = [
      { type: 'task_completed', message: 'Research task completed successfully', level: 'info' as const },
      { type: 'agent_spawned', message: 'New implementer agent spawned', level: 'info' as const },
      { type: 'task_assigned', message: 'Task assigned to coordinator agent', level: 'info' as const },
      { type: 'system_warning', message: 'High memory usage detected', level: 'warn' as const },
      { type: 'task_failed', message: 'Analysis task failed due to timeout', level: 'error' as const },
      { type: 'system_info', message: 'System health check completed', level: 'info' as const },
      { type: 'memory_gc', message: 'Garbage collection triggered', level: 'debug' as const },
      { type: 'network_event', message: 'MCP connection established', level: 'info' as const }
    ];
    
    const components = ['orchestrator', 'terminal', 'memory', 'coordination', 'mcp'];
    
    return Array.from({ length: 6 + Math.floor(Math.random() * 4) }, (_, i) => {
      const event = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      return {
        ...event,
        timestamp: Date.now() - (i * Math.random() * 300000), // Random intervals up to 5 minutes
        component: Math.random() > 0.3 ? components[Math.floor(Math.random() * components.length)] : undefined
      };
    }).sort((a, b) => b.timestamp - a.timestamp);
  }
  
  private async checkSystemRunning(): Promise<boolean> {
    try {
      return await existsSync('.claude-flow.pid');
    } catch {
      return false;
    }
  }
  
  private async getRealSystemData(): Promise<MonitorData | null> {
    // This would connect to the actual orchestrator for real data
    // For now, return null to use mock data
    return null;
  }
  
  private generateComponentStatus(): Record<string, ComponentStatus> {
    const components = ['orchestrator', 'terminal', 'memory', 'coordination', 'mcp'];
    const statuses: ('healthy' | 'degraded' | 'error')[] = ['healthy', 'degraded', 'error'];
    
    const result: Record<string, ComponentStatus> = {};
    
    for (const component of components) {
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const hasErrors = Math.random() > 0.8;
      
      result[component] = {
        status,
        load: Math.random() * 100,
        uptime: Math.random() * 3600000, // Up to 1 hour
        errors: hasErrors ? Math.floor(Math.random() * 5) : 0,
        lastError: hasErrors ? 'Connection timeout' : undefined
      };
    }
    
    return result;
  }
  
  private checkAlerts(data: MonitorData): void {
    const newAlerts: AlertData[] = [];
    
    // Check system thresholds
    if (data.system.cpu > this.options.threshold) {
      newAlerts.push({
        id: 'cpu-high',
        type: 'warning',
        message: `CPU usage high: ${data.system.cpu.toFixed(1)}%`,
        component: 'system',
        timestamp: Date.now(),
        acknowledged: false
      });
    }
    
    if (data.system.memory > 800) {
      newAlerts.push({
        id: 'memory-high',
        type: 'warning',
        message: `Memory usage high: ${data.system.memory.toFixed(0)}MB`,
        component: 'system',
        timestamp: Date.now(),
        acknowledged: false
      });
    }
    
    // Check component status
    for (const [name, component] of Object.entries(data.components)) {
      if (component.status === 'error') {
        newAlerts.push({
          id: `component-error-${name}`,
          type: 'error',
          message: `Component ${name} is in error state`,
          component: name,
          timestamp: Date.now(),
          acknowledged: false
        });
      }
      
      if (component.load > this.options.threshold) {
        newAlerts.push({
          id: `component-load-${name}`,
          type: 'warning',
          message: `Component ${name} load high: ${component.load.toFixed(1)}%`,
          component: name,
          timestamp: Date.now(),
          acknowledged: false
        });
      }
    }
    
    // Update alerts list (keep only recent ones)
    this.alerts = [...this.alerts, ...newAlerts]
      .filter(alert => Date.now() - alert.timestamp < 300000) // 5 minutes
      .slice(-10); // Keep max 10 alerts
  }
  
  private async exportMonitoringData(): Promise<void> {
    try {
      const exportData = {
        metadata: {
          exportTime: new Date().toISOString(),
          duration: formatDuration(Date.now() - this.startTime),
          dataPoints: this.exportData.length,
          interval: this.options.interval
        },
        data: this.exportData,
        alerts: this.alerts
      };
      
      await writeFileSync(this.options.export, JSON.stringify(exportData, null, 2), 'utf8');
      console.log(colors.green(`✓ Monitoring data exported to ${this.options.export}`));
    } catch (error) {
      console.error(colors.red('Failed to export data:'), (error as Error).message);
    }
  }
}

async function startMonitorDashboard(options: any): Promise<void> {
  // Validate options
  if (options.interval < 1) {
    console.error(colors.red('Update interval must be at least 1 second'));
    return;
  }
  
  if (options.threshold < 1 || options.threshold > 100) {
    console.error(colors.red('Threshold must be between 1 and 100'));
    return;
  }
  
  if (options.export) {
    // Check if export path is writable
    try {
      writeFileSync(options.export, '', 'utf8');
      rmSync(options.export, { force: true });
    } catch {
      console.error(colors.red(`Cannot write to export file: ${options.export}`));
      return;
    }
  }
  
  const dashboard = new Dashboard(options);
  await dashboard.start();
}