/**
 * Output formatting utilities for CLI
 */

import chalk from 'chalk';
import Table from 'cli-table3';
// Using cli-table3 instead of @cliffy/table for Node.js compatibility
import type { AgentProfile, Task, MemoryEntry, HealthStatus } from '../utils/types.js';
import * as process from 'process';

/**
 * Formats an error for display
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    let message = error instanceof Error ? error.message : String(error);

    if ('code' in error) {
      message = `[${(error as any).code}] ${message}`;
    }

    if ('details' in error && (error as any).details) {
      message += '\n' + chalk.gray('Details: ' + JSON.stringify((error as any).details, null, 2));
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
    chalk.cyan.bold(`Agent: ${agent.name}`),
    chalk.gray(`ID: ${agent.id}`),
    chalk.gray(`Type: ${agent.type}`),
    chalk.gray(`Priority: ${agent.priority}`),
    chalk.gray(`Max Tasks: ${agent.maxConcurrentTasks}`),
    chalk.gray(`Capabilities: ${agent.capabilities.join(', ')}`),
  ];

  return lines.join('\n');
}

/**
 * Formats a task for display
 */
export function formatTask(task: Task): string {
  const statusColor =
    {
      pending: chalk.gray,
      queued: chalk.yellow,
      assigned: chalk.blue,
      running: chalk.cyan,
      completed: chalk.green,
      failed: chalk.red,
      cancelled: chalk.magenta,
    }[task.status] || chalk.white;

  const lines = [
    chalk.yellow.bold(`Task: ${task.description}`),
    chalk.gray(`ID: ${task.id}`),
    chalk.gray(`Type: ${task.type}`),
    statusColor(`Status: ${task.status}`),
    chalk.gray(`Priority: ${task.priority}`),
  ];

  if (task.assignedAgent) {
    lines.push(chalk.gray(`Assigned to: ${task.assignedAgent}`));
  }

  if (task.dependencies.length > 0) {
    lines.push(chalk.gray(`Dependencies: ${task.dependencies.join(', ')}`));
  }

  if (task.error) {
    lines.push(chalk.red(`Error: ${task.error}`));
  }

  return lines.join('\n');
}

/**
 * Formats a memory entry for display
 */
export function formatMemoryEntry(entry: MemoryEntry): string {
  const lines = [
    chalk.magenta.bold(`Memory Entry: ${entry.type}`),
    chalk.gray(`ID: ${entry.id}`),
    chalk.gray(`Agent: ${entry.agentId}`),
    chalk.gray(`Session: ${entry.sessionId}`),
    chalk.gray(`Timestamp: ${entry.timestamp.toISOString()}`),
    chalk.gray(`Version: ${entry.version}`),
  ];

  if (entry.tags.length > 0) {
    lines.push(chalk.gray(`Tags: ${entry.tags.join(', ')}`));
  }

  lines.push('', chalk.white('Content:'), entry.content);

  return lines.join('\n');
}

/**
 * Formats health status for display
 */
export function formatHealthStatus(health: HealthStatus): string {
  const statusColor = {
    healthy: chalk.green,
    degraded: chalk.yellow,
    unhealthy: chalk.red,
  }[health.status];

  const lines = [
    statusColor.bold(`System Status: ${health.status.toUpperCase()}`),
    chalk.gray(`Checked at: ${health.timestamp.toISOString()}`),
    '',
    chalk.cyan.bold('Components:'),
  ];

  for (const [name, component] of Object.entries(health.components)) {
    const compColor = {
      healthy: chalk.green,
      degraded: chalk.yellow,
      unhealthy: chalk.red,
    }[component.status];

    lines.push(compColor(`  ${name}: ${component.status}`));

    if (component.error) {
      lines.push(chalk.red(`    Error: ${component.error}`));
    }

    if (component.metrics) {
      for (const [metric, value] of Object.entries(component.metrics)) {
        lines.push(chalk.gray(`    ${metric}: ${value}`));
      }
    }
  }

  return lines.join('\n');
}

/**
 * Creates a table for agent listing
 */
export function createAgentTable(agents: AgentProfile[]): any {
  const table = new Table({
    head: ['ID', 'Name', 'Type', 'Priority', 'Max Tasks'],
  });

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
export function createTaskTable(tasks: Task[]): any {
  const table = new Table({
    head: ['ID', 'Type', 'Description', 'Status', 'Agent'],
  });

  for (const task of tasks) {
    const statusCell =
      {
        pending: chalk.gray(task.status),
        queued: chalk.yellow(task.status),
        assigned: chalk.blue(task.status),
        running: chalk.cyan(task.status),
        completed: chalk.green(task.status),
        failed: chalk.red(task.status),
        cancelled: chalk.magenta(task.status),
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
${chalk.cyan.bold('╔══════════════════════════════════════════════════════════════╗')}
${chalk.cyan.bold('║')}             ${chalk.white.bold('🧠 Claude-Flow')} ${chalk.gray('v' + version)}                        ${chalk.cyan.bold('║')}
${chalk.cyan.bold('║')}          ${chalk.gray('Advanced AI Agent Orchestration')}               ${chalk.cyan.bold('║')}
${chalk.cyan.bold('╚══════════════════════════════════════════════════════════════╝')}
`;
  console.log(banner);
}

/**
 * Displays detailed version information
 */
export function displayVersion(version: string, buildDate: string): void {
  const info = [
    chalk.cyan.bold('Claude-Flow Version Information'),
    '',
    chalk.white('Version:    ') + chalk.yellow(version),
    chalk.white('Build Date: ') + chalk.yellow(buildDate),
    chalk.white('Runtime:    ') + chalk.yellow('Node.js ' + process.version),
    chalk.white('Platform:   ') + chalk.yellow(process.platform),
    chalk.white('Arch:       ') + chalk.yellow(process.arch),
    '',
    chalk.gray('Components:'),
    chalk.white('  • Multi-Agent Orchestration'),
    chalk.white('  • Memory Management'),
    chalk.white('  • Terminal Integration'),
    chalk.white('  • MCP Server'),
    chalk.white('  • Task Coordination'),
    '',
    chalk.blue('Homepage: ') + chalk.underline('https://github.com/ruvnet/claude-flow'),
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
  label?: string,
): string {
  const percentage = Math.min(100, (current / total) * 100);
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;

  const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
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
    success: chalk.green('✓'),
    error: chalk.red('✗'),
    warning: chalk.yellow('⚠'),
    info: chalk.blue('ℹ'),
    running: chalk.cyan('⟳'),
    pending: chalk.gray('○'),
  };

  return indicators[status as keyof typeof indicators] || status;
}

/**
 * Formats a success message
 */
export function formatSuccess(message: string): string {
  return chalk.green('✓') + ' ' + chalk.white(message);
}

/**
 * Formats an info message
 */
export function formatInfo(message: string): string {
  return chalk.blue('ℹ') + ' ' + chalk.white(message);
}

/**
 * Formats a warning message
 */
export function formatWarning(message: string): string {
  return chalk.yellow('⚠') + ' ' + chalk.white(message);
}

/**
 * Formats a spinner with message
 */
export function formatSpinner(message: string, frame: number = 0): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const spinner = chalk.cyan(frames[frame % frames.length]);
  return `${spinner} ${message}`;
}
