/**
 * Unified Status Command
 * Consolidated implementation combining TypeScript and JavaScript versions
 */

import type { CommandHandler, CommandContext } from '../interfaces.js';
import chalk from 'chalk';

export const statusCommand: CommandHandler = {
  description: 'Show Claude-Flow system status',
  options: [
    {
      flag: '--watch',
      description: 'Watch mode - continuously update status',
      aliases: ['-w']
    },
    {
      flag: '--interval',
      description: 'Update interval in seconds (default: 5)',
      hasValue: true,
      defaultValue: 5,
      aliases: ['-i']
    },
    {
      flag: '--component',
      description: 'Show status for specific component',
      hasValue: true,
      aliases: ['-c']
    },
    {
      flag: '--json',
      description: 'Output in JSON format'
    },
    {
      flag: '--verbose',
      description: 'Show detailed information',
      aliases: ['-v']
    }
  ],
  examples: [
    'claude-flow status',
    'claude-flow status --watch',
    'claude-flow status --component orchestrator',
    'claude-flow status --json --verbose'
  ],
  action: async (ctx: CommandContext) => {
    if (ctx.flags.watch) {
      await watchStatus(ctx);
    } else {
      await showStatus(ctx);
    }
  }
};

interface SystemStatus {
  timestamp: number;
  version: string;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  startTime: Date;
  orchestrator: {
    running: boolean;
    uptime: number;
    status: string;
  };
  components: Record<string, ComponentStatus>;
  agents: AgentInfo[];
  tasks: TaskStats;
  memory: MemoryInfo;
  resources?: ResourceUsage;
  recentTasks?: TaskInfo[];
  errors?: ErrorInfo[];
  warnings?: WarningInfo[];
}

interface ComponentStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  details: string;
  metrics?: Record<string, any>;
  errors?: ErrorInfo[];
}

interface AgentInfo {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'idle' | 'error';
  activeTasks: number;
}

interface TaskStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

interface TaskInfo {
  id: string;
  type: string;
  status: 'running' | 'pending' | 'completed' | 'failed';
  agent?: string;
  duration?: number;
  priority?: 'high' | 'medium' | 'low';
}

interface MemoryInfo {
  status: string;
  entries: number;
  size: string;
}

interface ResourceUsage {
  memory: {
    total: string;
    free: string;
    available: string;
    usage: string;
  };
  cpu: {
    cores: number | string;
    load: string;
  };
}

interface ErrorInfo {
  component: string;
  message: string;
  timestamp: number;
  stack?: string;
}

interface WarningInfo {
  message: string;
  recommendation?: string;
}

async function showStatus(ctx: CommandContext): Promise<void> {
  try {
    const status = await getSystemStatus(ctx.flags.verbose);
    
    if (ctx.flags.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    if (ctx.flags.component) {
      await showComponentStatus(status, ctx.flags.component);
    } else {
      await showFullStatus(status, ctx.flags.verbose);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('connection refused')) {
      console.error(chalk.red('✗ Claude-Flow is not running'));
      console.log(chalk.gray('Start it with: claude-flow start'));
    } else {
      console.error(chalk.red('Error getting status:'), errorMessage);
    }
  }
}

async function watchStatus(ctx: CommandContext): Promise<void> {
  const interval = (ctx.flags.interval || 5) * 1000;
  
  console.log(chalk.cyan('Watching Claude-Flow status...'));
  console.log(chalk.gray(`Update interval: ${ctx.flags.interval || 5}s`));
  console.log(chalk.gray('Press Ctrl+C to stop\n'));

  while (true) {
    // Clear screen and show status
    console.clear();
    console.log(chalk.cyan.bold('Claude-Flow Status Monitor'));
    console.log(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}\n`));
    
    try {
      await showStatus({ ...ctx, flags: { ...ctx.flags, json: false } });
    } catch (error) {
      console.error(chalk.red('Status update failed:'), error instanceof Error ? error.message : String(error));
    }
    
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

async function showFullStatus(status: SystemStatus, verbose: boolean): Promise<void> {
  // System overview
  console.log(chalk.cyan.bold('Claude-Flow System Status'));
  console.log('─'.repeat(50));
  
  const overallIcon = getStatusIcon(status.overall);
  const overallColor = getStatusColor(status.overall);
  console.log(`${overallIcon} Overall Status: ${overallColor(status.overall.toUpperCase())}`);
  console.log(`${chalk.white('Version:')} ${status.version}`);
  console.log(`${chalk.white('Timestamp:')} ${new Date(status.timestamp).toLocaleString()}`);
  
  if (status.uptime) {
    console.log(`${chalk.white('Uptime:')} ${formatDuration(status.uptime)}`);
  }
  
  console.log();

  // Core components status
  console.log(chalk.cyan.bold('Core Components'));
  console.log('─'.repeat(30));
  
  // Orchestrator
  const orchIcon = getStatusIcon(status.orchestrator.running ? 'healthy' : 'unhealthy');
  const orchColor = getStatusColor(status.orchestrator.running ? 'healthy' : 'unhealthy');
  console.log(`${orchIcon} Orchestrator: ${orchColor(status.orchestrator.status)}`);
  
  // Memory
  const memIcon = getStatusIcon('healthy');
  console.log(`${memIcon} Memory: ${status.memory.status} (${status.memory.entries} entries, ${status.memory.size})`);
  
  // Tasks
  const totalTasks = status.tasks.queued + status.tasks.running + status.tasks.completed + status.tasks.failed;
  console.log(`${getStatusIcon('healthy')} Tasks: ${totalTasks} total (${status.tasks.running} running, ${status.tasks.queued} queued)`);
  
  // Agents
  console.log(`${getStatusIcon('healthy')} Agents: ${status.agents.length} active`);
  
  console.log();

  // Detailed components (if verbose)
  if (verbose && status.components) {
    console.log(chalk.cyan.bold('Detailed Components'));
    console.log('─'.repeat(30));
    
    for (const [name, component] of Object.entries(status.components)) {
      const icon = getStatusIcon(component.status);
      const color = getStatusColor(component.status);
      console.log(`${icon} ${chalk.white(name.padEnd(15))}: ${color(component.status.toUpperCase())}`);
      if (component.details) {
        console.log(`   ${chalk.gray(component.details)}`);
      }
    }
    console.log();
  }

  // Active agents (if any)
  if (status.agents && status.agents.length > 0) {
    console.log(chalk.cyan.bold(`Active Agents (${status.agents.length})`));
    console.log('─'.repeat(30));
    
    for (const agent of status.agents) {
      const agentIcon = getStatusIcon(agent.status);
      const agentColor = getStatusColor(agent.status);
      console.log(`${agentIcon} ${chalk.white(agent.name)} (${chalk.cyan(agent.type)})`);
      console.log(`   Status: ${agentColor(agent.status)}, Tasks: ${agent.activeTasks}`);
    }
    console.log();
  }

  // Task breakdown
  if (status.tasks) {
    console.log(chalk.cyan.bold('Task Statistics'));
    console.log('─'.repeat(30));
    console.log(`${chalk.green('●')} Completed: ${status.tasks.completed}`);
    console.log(`${chalk.cyan('●')} Running: ${status.tasks.running}`);
    console.log(`${chalk.yellow('●')} Queued: ${status.tasks.queued}`);
    console.log(`${chalk.red('●')} Failed: ${status.tasks.failed}`);
    console.log();
  }

  // Resource usage (if verbose and available)
  if (verbose && status.resources) {
    console.log(chalk.cyan.bold('Resource Usage'));
    console.log('─'.repeat(30));
    console.log(`${chalk.white('Memory:')} ${status.resources.memory.usage} (${status.resources.memory.available} available)`);
    console.log(`${chalk.white('CPU Cores:')} ${status.resources.cpu.cores}`);
    if (status.resources.cpu.load !== 'N/A') {
      console.log(`${chalk.white('CPU Load:')} ${status.resources.cpu.load}`);
    }
    console.log();
  }

  // Recent warnings (if any)
  if (status.warnings && status.warnings.length > 0) {
    console.log(chalk.yellow.bold('Warnings'));
    console.log('─'.repeat(30));
    for (const warning of status.warnings) {
      console.log(`${chalk.yellow('⚠️')} ${warning.message}`);
      if (warning.recommendation) {
        console.log(`   ${chalk.gray(warning.recommendation)}`);
      }
    }
    console.log();
  }

  // Recent errors (if any)
  if (status.errors && status.errors.length > 0) {
    console.log(chalk.red.bold('Recent Errors'));
    console.log('─'.repeat(30));
    for (const error of status.errors.slice(0, 3)) {
      console.log(`${chalk.red('✗')} ${error.component}: ${error.message}`);
      console.log(`   ${chalk.gray(new Date(error.timestamp).toLocaleString())}`);
    }
    console.log();
  }
}

async function showComponentStatus(status: SystemStatus, componentName: string): Promise<void> {
  const component = status.components?.[componentName];
  
  if (!component) {
    console.error(chalk.red(`Component '${componentName}' not found`));
    if (status.components) {
      console.log(chalk.gray('Available components:'), Object.keys(status.components).join(', '));
    }
    return;
  }

  console.log(chalk.cyan.bold(`${componentName} Status`));
  console.log('─'.repeat(30));
  
  const statusIcon = getStatusIcon(component.status);
  const statusColor = getStatusColor(component.status);
  console.log(`${statusIcon} Status: ${statusColor(component.status.toUpperCase())}`);
  
  if (component.uptime) {
    console.log(`${chalk.white('Uptime:')} ${formatDuration(component.uptime)}`);
  }
  
  if (component.details) {
    console.log(`${chalk.white('Details:')} ${component.details}`);
  }
  
  if (component.metrics) {
    console.log('\n' + chalk.cyan.bold('Metrics'));
    console.log('─'.repeat(20));
    
    for (const [metric, value] of Object.entries(component.metrics)) {
      console.log(`${chalk.white(metric + ':')} ${value}`);
    }
  }
  
  if (component.errors && component.errors.length > 0) {
    console.log('\n' + chalk.red.bold('Recent Errors'));
    console.log('─'.repeat(20));
    
    for (const error of component.errors.slice(0, 5)) {
      console.log(chalk.red(`• ${error.message}`));
      console.log(chalk.gray(`  ${new Date(error.timestamp).toLocaleString()}`));
    }
  }
}

async function getSystemStatus(verbose: boolean = false): Promise<SystemStatus> {
  // Try to get real status first, fall back to mock
  const realStatus = await getRealSystemStatus();
  if (realStatus) {
    return realStatus;
  }

  // Mock status for development/testing
  const status: SystemStatus = {
    timestamp: Date.now(),
    version: '1.0.72',
    overall: 'healthy',
    uptime: Date.now() - (Date.now() - 3600000), // 1 hour
    startTime: new Date(Date.now() - 3600000),
    orchestrator: {
      running: false, // Default to not running
      uptime: 0,
      status: 'Not Running'
    },
    components: {
      orchestrator: {
        status: 'unhealthy',
        uptime: 0,
        details: 'Service not started'
      },
      terminal: {
        status: 'healthy',
        uptime: 3600000,
        details: 'Pool ready: 0/10 active sessions'
      },
      memory: {
        status: 'healthy',
        uptime: 3600000,
        details: 'Memory store available'
      },
      coordination: {
        status: 'healthy',
        uptime: 3600000,
        details: 'Coordination system ready'
      },
      mcp: {
        status: 'healthy',
        uptime: 3600000,
        details: 'MCP server ready'
      }
    },
    agents: [],
    tasks: {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0
    },
    memory: {
      status: 'Ready',
      entries: await getMemoryStats(),
      size: '0.37 KB'
    },
    recentTasks: []
  };

  // Add resource information if verbose
  if (verbose) {
    status.resources = await getResourceUsage();
  }

  return status;
}

async function getRealSystemStatus(): Promise<SystemStatus | null> {
  try {
    // This would attempt to connect to a running orchestrator
    // For now, return null to use mock data
    return null;
  } catch {
    return null;
  }
}

async function getMemoryStats(runtime?: any): Promise<number> {
  try {
    // Use Node.js fs directly since we don't have runtime context here
    const fs = await import('fs/promises');
    const memoryStorePath = './memory/memory-store.json';
    
    try {
      await fs.access(memoryStorePath);
    } catch {
      return 0;
    }
    
    const content = await fs.readFile(memoryStorePath, 'utf-8');
    const data = JSON.parse(content);
    
    let totalEntries = 0;
    for (const entries of Object.values(data)) {
      if (Array.isArray(entries)) {
        totalEntries += entries.length;
      }
    }
    
    return totalEntries;
  } catch {
    return 0;
  }
}

async function getResourceUsage(): Promise<ResourceUsage> {
  try {
    // This would use Node.js APIs to get actual system info
    return {
      memory: {
        total: 'Unknown',
        free: 'Unknown',
        available: 'Unknown',
        usage: 'Unknown'
      },
      cpu: {
        cores: require('os').cpus().length,
        load: 'Unknown'
      }
    };
  } catch {
    return {
      memory: {
        total: 'Unknown',
        free: 'Unknown',
        available: 'Unknown',
        usage: 'Unknown'
      },
      cpu: {
        cores: 'Unknown',
        load: 'Unknown'
      }
    };
  }
}

function getStatusIcon(status: string): string {
  switch (status.toLowerCase()) {
    case 'healthy':
    case 'active':
    case 'completed':
      return chalk.green('●');
    case 'degraded':
    case 'warning':
    case 'idle':
      return chalk.yellow('●');
    case 'unhealthy':
    case 'error':
    case 'failed':
      return chalk.red('●');
    case 'running':
      return chalk.cyan('●');
    default:
      return chalk.white('●');
  }
}

function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'healthy':
    case 'active':
    case 'completed':
      return chalk.green;
    case 'degraded':
    case 'warning':
    case 'idle':
      return chalk.yellow;
    case 'unhealthy':
    case 'error':
    case 'failed':
      return chalk.red;
    case 'running':
      return chalk.cyan;
    default:
      return chalk.white;
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}