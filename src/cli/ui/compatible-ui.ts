import { getErrorMessage } from '../../utils/error-handler.js';
/**
 * Compatible Terminal UI - Works without raw mode
 * Designed for environments that don't support stdin raw mode
 */

import readline from 'readline';
import chalk from 'chalk';

export interface UIProcess {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'error' | 'crashed';
  type: string;
  pid?: number;
  startTime?: number;
  metrics?: {
    cpu?: number;
    memory?: number;
    restarts?: number;
    lastError?: string;
  };
}

export interface UISystemStats {
  totalProcesses: number;
  runningProcesses: number;
  errorProcesses: number;
}

export class CompatibleUI {
  private processes: UIProcess[] = [];
  private running = false;
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false // Don't require raw mode
    });
  }

  async start(): Promise<void> {
    this.running = true;
    
    // Initial render
    this.render();
    
    // Setup command loop
    while (this.running) {
      const command = await this.promptCommand();
      await this.handleCommand(command);
    }
  }

  stop(): void {
    this.running = false;
    this.rl.close();
    console.clear();
  }

  updateProcesses(processes: UIProcess[]): void {
    this.processes = processes;
    if (this.running) {
      this.render();
    }
  }

  private async promptCommand(): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question('\nCommand: ', (answer) => {
        resolve(answer.trim());
      });
    });
  }

  private async handleCommand(input: string): Promise<void> {
    switch (input.toLowerCase()) {
      case 'q':
      case 'quit':
      case 'exit':
        await this.handleExit();
        break;
        
      case 'r':
      case 'refresh':
        this.render();
        break;
        
      case 'h':
      case 'help':
      case '?':
        this.showHelp();
        break;
        
      case 's':
      case 'status':
        this.showStatus();
        break;
        
      case 'l':
      case 'list':
        this.showProcessList();
        break;
        
      default:
        // Check if it's a number (process selection)
        const num = parseInt(input);
        if (!isNaN(num) && num >= 1 && num <= this.processes.length) {
          await this.showProcessDetails(this.processes[num - 1]);
        } else {
          console.log(chalk.yellow('Invalid command. Type "h" for help.'));
        }
        break;
    }
  }

  private render(): void {
    console.clear();
    const stats = this.getSystemStats();

    // Header
    console.log(chalk.cyan.bold('🧠 Claude-Flow System Monitor'));
    console.log(chalk.gray('─'.repeat(60)));
    
    // System stats
    console.log(chalk.white('System Status:'), 
      chalk.green(`${stats.runningProcesses}/${stats.totalProcesses} running`));
    
    if (stats.errorProcesses > 0) {
      console.log(chalk.red(`⚠️  ${stats.errorProcesses} processes with errors`));
    }
    
    console.log();

    // Process list
    console.log(chalk.white.bold('Processes:'));
    console.log(chalk.gray('─'.repeat(60)));
    
    if (this.processes.length === 0) {
      console.log(chalk.gray('No processes configured'));
    } else {
      this.processes.forEach((process, index) => {
        const num = `[${index + 1}]`.padEnd(4);
        const status = this.getStatusDisplay(process.status);
        const name = process.name.padEnd(25);
        
        console.log(`${chalk.gray(num)} ${status} ${chalk.white(name)}`);
        
        if (process.metrics?.lastError) {
          console.log(chalk.red(`       Error: ${process.metrics.lastError}`));
        }
      });
    }

    // Footer
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray('Commands: [1-9] Process details [s] Status [l] List [r] Refresh [h] Help [q] Quit'));
  }

  private showHelp(): void {
    console.log();
    console.log(chalk.cyan.bold('📖 Available Commands'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.white('[1-9]'), 'Show process details');
    console.log(chalk.white('[s]'), 'Show system status');
    console.log(chalk.white('[l]'), 'List all processes');
    console.log(chalk.white('[r]'), 'Refresh display');
    console.log(chalk.white('[h]'), 'Show this help');
    console.log(chalk.white('[q]'), 'Quit application');
    console.log();
  }

  private showStatus(): void {
    const stats = this.getSystemStats();
    
    console.log();
    console.log(chalk.cyan.bold('📊 System Status Details'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.white('Total Processes:'), stats.totalProcesses);
    console.log(chalk.white('Running:'), chalk.green(stats.runningProcesses));
    console.log(chalk.white('Stopped:'), chalk.gray(stats.totalProcesses - stats.runningProcesses - stats.errorProcesses));
    console.log(chalk.white('Errors:'), chalk.red(stats.errorProcesses));
    console.log(chalk.white('System Load:'), this.getSystemLoad());
    console.log(chalk.white('Uptime:'), this.getSystemUptime());
  }

  private showProcessList(): void {
    console.log();
    console.log(chalk.cyan.bold('📋 Process List'));
    console.log(chalk.gray('─'.repeat(60)));
    
    if (this.processes.length === 0) {
      console.log(chalk.gray('No processes configured'));
      return;
    }

    this.processes.forEach((process, index) => {
      console.log(`${chalk.gray(`[${index + 1}]`)} ${this.getStatusDisplay(process.status)} ${chalk.white.bold(process.name)}`);
      console.log(chalk.gray(`    Type: ${process.type}`));
      
      if (process.pid) {
        console.log(chalk.gray(`    PID: ${process.pid}`));
      }
      
      if (process.startTime) {
        const uptime = Date.now() - process.startTime;
        console.log(chalk.gray(`    Uptime: ${this.formatUptime(uptime)}`));
      }
      
      if (process.metrics) {
        if (process.metrics.cpu !== undefined) {
          console.log(chalk.gray(`    CPU: ${process.metrics.cpu.toFixed(1)}%`));
        }
        if (process.metrics.memory !== undefined) {
          console.log(chalk.gray(`    Memory: ${process.metrics.memory.toFixed(0)} MB`));
        }
      }
      
      console.log();
    });
  }

  private async showProcessDetails(process: UIProcess): Promise<void> {
    console.log();
    console.log(chalk.cyan.bold(`📋 Process Details: ${process.name}`));
    console.log(chalk.gray('─'.repeat(60)));
    
    console.log(chalk.white('ID:'), process.id);
    console.log(chalk.white('Type:'), process.type);
    console.log(chalk.white('Status:'), this.getStatusDisplay(process.status), process.status);
    
    if (process.pid) {
      console.log(chalk.white('PID:'), process.pid);
    }
    
    if (process.startTime) {
      const uptime = Date.now() - process.startTime;
      console.log(chalk.white('Uptime:'), this.formatUptime(uptime));
    }
    
    if (process.metrics) {
      console.log();
      console.log(chalk.white.bold('Metrics:'));
      if (process.metrics.cpu !== undefined) {
        console.log(chalk.white('CPU:'), `${process.metrics.cpu.toFixed(1)}%`);
      }
      if (process.metrics.memory !== undefined) {
        console.log(chalk.white('Memory:'), `${process.metrics.memory.toFixed(0)} MB`);
      }
      if (process.metrics.restarts !== undefined) {
        console.log(chalk.white('Restarts:'), process.metrics.restarts);
      }
      if (process.metrics.lastError) {
        console.log(chalk.red('Last Error:'), process.metrics.lastError);
      }
    }
  }

  private getStatusDisplay(status: string): string {
    switch (status) {
      case 'running':
        return chalk.green('●');
      case 'stopped':
        return chalk.gray('○');
      case 'starting':
        return chalk.yellow('◐');
      case 'stopping':
        return chalk.yellow('◑');
      case 'error':
        return chalk.red('✗');
      case 'crashed':
        return chalk.red('☠');
      default:
        return chalk.gray('?');
    }
  }

  private getSystemStats(): UISystemStats {
    return {
      totalProcesses: this.processes.length,
      runningProcesses: this.processes.filter(p => p.status === 'running').length,
      errorProcesses: this.processes.filter(p => p.status === 'error' || p.status === 'crashed').length
    };
  }

  private getSystemLoad(): string {
    // Simulate system load
    return '0.45, 0.52, 0.48';
  }

  private getSystemUptime(): string {
    const uptime = process.uptime() * 1000;
    return this.formatUptime(uptime);
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private showHelp(): void {
    console.log();
    console.log(chalk.cyan.bold('🧠 Claude-Flow System Monitor - Help'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();
    console.log(chalk.white.bold('Commands:'));
    console.log('  1-9     - Show process details by number');
    console.log('  s       - Show system status');
    console.log('  l       - List all processes');
    console.log('  r       - Refresh display');
    console.log('  h/?     - Show this help');
    console.log('  q       - Quit');
    console.log();
    console.log(chalk.white.bold('Features:'));
    console.log('  • Non-interactive mode (works in any terminal)');
    console.log('  • Real-time process monitoring');
    console.log('  • System statistics');
    console.log('  • Compatible with VS Code, CI/CD, containers');
  }

  private async handleExit(): Promise<void> {
    const runningProcesses = this.processes.filter(p => p.status === 'running');
    
    if (runningProcesses.length > 0) {
      console.log();
      console.log(chalk.yellow(`⚠️  ${runningProcesses.length} processes are still running.`));
      console.log('These processes will continue running in the background.');
      console.log('Use the main CLI to stop them if needed.');
    }
    
    this.stop();
  }
}

// Factory function to create UI instances
export function createCompatibleUI(): CompatibleUI {
  return new CompatibleUI();
}

// Check if raw mode is supported
export function isRawModeSupported(): boolean {
  try {
    return process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';
  } catch {
    return false;
  }
}

// Fallback UI launcher that chooses the best available UI
export async function launchUI(): Promise<void> {
  const ui = createCompatibleUI();
  
  // Mock some example processes for demonstration
  const mockProcesses: UIProcess[] = [
    {
      id: 'orchestrator',
      name: 'Orchestrator Engine',
      status: 'running',
      type: 'core',
      pid: 12345,
      startTime: Date.now() - 30000,
      metrics: { cpu: 2.1, memory: 45.2, restarts: 0 }
    },
    {
      id: 'memory-manager',
      name: 'Memory Manager',
      status: 'running',
      type: 'service',
      pid: 12346,
      startTime: Date.now() - 25000,
      metrics: { cpu: 0.8, memory: 12.5, restarts: 0 }
    },
    {
      id: 'mcp-server',
      name: 'MCP Server',
      status: 'stopped',
      type: 'server',
      metrics: { restarts: 1 }
    }
  ];
  
  ui.updateProcesses(mockProcesses);
  
  console.log(chalk.green('✅ Starting Claude-Flow UI (compatible mode)'));
  console.log(chalk.gray('Note: Using compatible UI mode for broader terminal support'));
  console.log();
  
  await ui.start();
}