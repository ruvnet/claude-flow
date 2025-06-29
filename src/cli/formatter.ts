/**
 * Output formatting utilities for CLI
 */

import { colors } from '../utils/cliffy-compat/colors.js';
import { Table } from '../utils/cliffy-compat/table.js';
// Box is not available in the current cliffy version
import { AgentProfile, Task, MemoryEntry, HealthStatus } from '../utils/types.js';

/**
 * Formats an error for display
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    let message = error.message;
    
    if ('code' in error) {
      message = `[${(error as any).code}] ${message}`;
    }
    
    if ('details' in error && (error as any).details) {
      message += '\n' + colors.gray('Details: ' + JSON.stringify((error as any).details, null, 2));
    }
    
    return message;
  }
  
  return String(error);
}

/**
 * Formats an agent profile for display
 */
export function formatAgent(agent: AgentProfile): string {
  const lines = [
    colors.cyan.bold(`Agent: ${agent.name}`),
    colors.gray(`ID: ${agent.id}`),
    colors.gray(`Type: ${agent.type}`),
    colors.gray(`Priority: ${agent.priority}`),
    colors.gray(`Max Tasks: ${agent.maxConcurrentTasks}`),
    colors.gray(`Capabilities: ${agent.capabilities.join(', ')}`),
  ];
  
  return lines.join('\n');
}

/**
 * Formats a task for display
 */
export function formatTask(task: Task): string {
  const statusColor = {
    pending: colors.gray,
    queued: colors.yellow,
    assigned: colors.blue,
    running: colors.cyan,
    completed: colors.green,
    failed: colors.red,
    cancelled: colors.magenta,
  }[task.status] || colors.white;

  const lines = [
    colors.yellow.bold(`Task: ${task.description}`),
    colors.gray(`ID: ${task.id}`),
    colors.gray(`Type: ${task.type}`),
    statusColor(`Status: ${task.status}`),
    colors.gray(`Priority: ${task.priority}`),
  ];

  if (task.assignedAgent) {
    lines.push(colors.gray(`Assigned to: ${task.assignedAgent}`));
  }

  if (task.dependencies.length > 0) {
    lines.push(colors.gray(`Dependencies: ${task.dependencies.join(', ')}`));
  }

  if (task.error) {
    lines.push(colors.red(`Error: ${task.error.message}`));
  }

  return lines.join('\n');
}

/**
 * Formats a memory entry for display
 */
export function formatMemoryEntry(entry: MemoryEntry): string {
  const lines = [
    colors.magenta.bold(`Memory Entry: ${entry.type}`),
    colors.gray(`ID: ${entry.id}`),
    colors.gray(`Agent: ${entry.agentId}`),
    colors.gray(`Session: ${entry.sessionId}`),
    colors.gray(`Timestamp: ${entry.timestamp.toISOString()}`),
    colors.gray(`Version: ${entry.version}`),
  ];

  if (entry.tags.length > 0) {
    lines.push(colors.gray(`Tags: ${entry.tags.join(', ')}`));
  }

  lines.push('', colors.white('Content:'), entry.content);

  return lines.join('\n');
}

/**
 * Formats health status for display
 */
export function formatHealthStatus(health: HealthStatus): string {
  const statusColor = {
    healthy: colors.green,
    degraded: colors.yellow,
    unhealthy: colors.red,
  }[health.status];

  const lines = [
    statusColor.bold(`System Status: ${health.status.toUpperCase()}`),
    colors.gray(`Checked at: ${health.timestamp.toISOString()}`),
    '',
    colors.cyan.bold('Components:'),
  ];

  for (const [name, component] of Object.entries(health.components)) {
    const compColor = {
      healthy: colors.green,
      degraded: colors.yellow,
      unhealthy: colors.red,
    }[component.status];

    lines.push(compColor(`  ${name}: ${component.status}`));
    
    if (component.error) {
      lines.push(colors.red(`    Error: ${component.error}`));
    }

    if (component.metrics) {
      for (const [metric, value] of Object.entries(component.metrics)) {
        lines.push(colors.gray(`    ${metric}: ${value}`));
      }
    }
  }

  return lines.join('\n');
}

/**
 * Creates a table for agent listing
 */
export function createAgentTable(agents: AgentProfile[]): Table {
  const table = new Table()
    .header(['ID', 'Name', 'Type', 'Priority', 'Max Tasks'])
    .border(true);

  for (const agent of agents) {
    table.push([
      agent.id,
      agent.name,
      agent.type,
      agent.priority.toString(),
      agent.maxConcurrentTasks.toString(),
    ]);
  }

  return table;
}

/**
 * Creates a table for task listing
 */
export function createTaskTable(tasks: Task[]): Table {
  const table = new Table()
    .header(['ID', 'Type', 'Description', 'Status', 'Agent'])
    .border(true);

  for (const task of tasks) {
    const statusCell = {
      pending: colors.gray(task.status),
      queued: colors.yellow(task.status),
      assigned: colors.blue(task.status),
      running: colors.cyan(task.status),
      completed: colors.green(task.status),
      failed: colors.red(task.status),
      cancelled: colors.magenta(task.status),
    }[task.status] || task.status;

    table.push([
      task.id,
      task.type,
      task.description.substring(0, 40) + (task.description.length > 40 ? '...' : ''),
      statusCell,
      task.assignedAgent || '-',
    ]);
  }

  return table;
}

/**
 * Formats duration in human-readable form
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  
  return `${seconds}s`;
}

/**
 * Displays the Claude-Flow banner
 */
export function displayBanner(version: string): void {
  const banner = `
${colors.cyan.bold('╔══════════════════════════════════════════════════════════════╗')}
${colors.cyan.bold('║')}             ${colors.white.bold('🧠 Claude-Flow')} ${colors.gray('v' + version)}                        ${colors.cyan.bold('║')}
${colors.cyan.bold('║')}          ${colors.gray('Advanced AI Agent Orchestration')}               ${colors.cyan.bold('║')}
${colors.cyan.bold('╚══════════════════════════════════════════════════════════════╝')}
`;
  console.log(banner);
}

/**
 * Displays detailed version information
 */
export function displayVersion(version: string, buildDate: string): void {
  const info = [
    colors.cyan.bold('Claude-Flow Version Information'),
    '',
    colors.white('Version:    ') + colors.yellow(version),
    colors.white('Build Date: ') + colors.yellow(buildDate),
    colors.white('Runtime:    ') + colors.yellow('Node.js ' + process.version),
    colors.white('V8:         ') + colors.yellow(process.versions.v8),
    colors.white('Platform:   ') + colors.yellow(process.platform),
    '',
    colors.gray('Components:'),
    colors.white('  • Multi-Agent Orchestration'),
    colors.white('  • Memory Management'),
    colors.white('  • Terminal Integration'),
    colors.white('  • MCP Server'),
    colors.white('  • Task Coordination'),
    '',
    colors.blue('Homepage: ') + colors.underline('https://github.com/anthropics/claude-code-flow'),
  ];
  
  console.log(info.join('\n'));
}

/**
 * Formats a progress bar
 */
export function formatProgressBar(
  current: number,
  total: number,
  width: number = 40,
  label?: string
): string {
  const percentage = Math.min(100, (current / total) * 100);
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;
  
  const bar = colors.green('█'.repeat(filled)) + colors.gray('░'.repeat(empty));
  const percent = percentage.toFixed(1).padStart(5) + '%';
  
  let result = `[${bar}] ${percent}`;
  if (label) {
    result = `${label}: ${result}`;
  }
  
  return result;
}

/**
 * Creates a status indicator
 */
export function formatStatusIndicator(status: string): string {
  const indicators = {
    success: colors.green('✓'),
    error: colors.red('✗'),
    warning: colors.yellow('⚠'),
    info: colors.blue('ℹ'),
    running: colors.cyan('⟳'),
    pending: colors.gray('○'),
  };
  
  return indicators[status as keyof typeof indicators] || status;
}

/**
 * Formats a spinner with message
 */
export function formatSpinner(message: string, frame: number = 0): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const spinner = colors.cyan(frames[frame % frames.length]);
  return `${spinner} ${message}`;
}