/**
 * Consolidated CLI utilities for Claude-Flow
 * Centralizes all CLI-related imports and provides consistent interface
 */

// Re-export all cliffy-compat utilities
export { Command } from '../cliffy-compat/command.js';
export { colors } from '../cliffy-compat/colors.js';
import { Table } from '../cliffy-compat/table.js';
export { Table };
export { Select, Input, Confirm, Checkbox } from '../cliffy-compat/prompt.js';

// Re-export our color utilities
export { colors as internalColors } from '../colors.js';

// Re-export formatters
export * from '../formatters.js';

// Import chalk for external compatibility
import chalk from 'chalk';
export { chalk };

/**
 * Common CLI formatting utilities
 */
export const format = {
  // Success messages
  success: (message: string): string => chalk.green(`✓ ${message}`),
  
  // Error messages
  error: (message: string): string => chalk.red(`✗ ${message}`),
  
  // Warning messages
  warning: (message: string): string => chalk.yellow(`⚠ ${message}`),
  
  // Info messages
  info: (message: string): string => chalk.blue(`ℹ ${message}`),
  
  // Command descriptions
  command: (cmd: string): string => chalk.cyan(cmd),
  
  // File paths
  path: (path: string): string => chalk.magenta(path),
  
  // Values/data
  value: (value: string | number): string => chalk.yellow(String(value)),
  
  // Headers
  header: (text: string): string => chalk.bold.underline(text),
  
  // Subheaders
  subheader: (text: string): string => chalk.bold(text),
  
  // Dimmed text
  dim: (text: string): string => chalk.gray(text),
  
  // Progress indicators
  progress: (current: number, total: number): string => {
    const percentage = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * 20);
    const empty = 20 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return chalk.blue(`[${bar}] ${percentage}%`);
  },
  
  // Status indicators
  status: {
    running: chalk.blue('●'),
    success: chalk.green('●'),
    error: chalk.red('●'),
    warning: chalk.yellow('●'),
    stopped: chalk.gray('●')
  }
};

/**
 * CLI interaction utilities
 */
export const interact = {
  // Simple console logging with formatting
  log: {
    success: (message: string): void => console.log(format.success(message)),
    error: (message: string): void => console.error(format.error(message)),
    warning: (message: string): void => console.warn(format.warning(message)),
    info: (message: string): void => console.log(format.info(message)),
    plain: (message: string): void => console.log(message)
  },
  
  // Newlines and spacing
  newline: (): void => console.log(),
  separator: (): void => console.log(chalk.gray('─'.repeat(50))),
  
  // Clear screen
  clear: (): void => {
    process.stdout.write('\x1b[2J\x1b[0f');
  }
};

/**
 * Table creation helpers
 */
export const table = {
  // Create a simple two-column table
  keyValue: (data: Record<string, string | number>): Table => {
    const t = new Table();
    Object.entries(data).forEach(([key, value]) => {
      t.push([format.subheader(key), String(value)]);
    });
    return t;
  },
  
  // Create a status table
  status: (items: Array<{ name: string; status: 'running' | 'success' | 'error' | 'warning' | 'stopped'; message?: string }>): Table => {
    const t = new Table({
      head: ['Component', 'Status', 'Message']
    });
    
    items.forEach(item => {
      t.push([
        item.name,
        format.status[item.status] + ' ' + item.status,
        item.message || '-'
      ]);
    });
    
    return t;
  }
};

/**
 * Common CLI patterns
 */
export const patterns = {
  // Loading spinner simulation
  loading: async (message: string, fn: () => Promise<void>): Promise<void> => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    
    const interval = setInterval(() => {
      process.stdout.write(`\r${chalk.blue(frames[i++ % frames.length])} ${message}`);
    }, 100);
    
    try {
      await fn();
      clearInterval(interval);
      process.stdout.write(`\r${format.success(message)}\n`);
    } catch (error) {
      clearInterval(interval);
      process.stdout.write(`\r${format.error(message)}\n`);
      throw error;
    }
  },
  
  // Progress bar
  progressBar: (current: number, total: number, message?: string): void => {
    const progress = format.progress(current, total);
    const msg = message ? ` ${message}` : '';
    process.stdout.write(`\r${progress}${msg}`);
    
    if (current >= total) {
      process.stdout.write('\n');
    }
  }
};

/**
 * Backward compatibility exports
 */
// Support old import patterns
export const CLI = {
  Command,
  colors,
  Table,
  chalk,
  format,
  interact,
  table,
  patterns
};

// Default export
export default CLI;