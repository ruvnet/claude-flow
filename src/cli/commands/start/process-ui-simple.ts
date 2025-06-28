/**
 * Simplified Process UI without keypress dependency
 * Uses basic stdin reading for compatibility
 */

import { colors } from '@cliffy/ansi/colors';
import { ProcessManager } from './process-manager.js';
import { ProcessInfo, ProcessStatus, SystemStats } from './types.js';
import { stdin, stdout } from 'process';

export class ProcessUI {
  private processManager: ProcessManager;
  private running = false;
  private selectedIndex = 0;

  constructor(processManager: ProcessManager) {
    this.processManager = processManager;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.processManager.on('statusChanged', ({ processId, status }: { processId: string; status: ProcessStatus }) => {
      if (this.running) {
        this.render();
      }
    });

    this.processManager.on('processError', ({ processId, error }: { processId: string; error: Error }) => {
      if (this.running) {
        console.log(colors.red(`\nProcess ${processId} error: ${error.message}`));
      }
    });
  }

  async start(): Promise<void> {
    this.running = true;
    
    // Clear screen
    process.stdout.write('\x1Bc');

    // Initial render
    this.render();

    // Simple input loop
    while (this.running) {
      // Show prompt
      process.stdout.write('\nCommand: ');
      
      // Read input line by line
      const input = await this.readLine();
      if (input === null) break;
      
      if (input.length > 0) {
        await this.handleCommand(input);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    process.stdout.write('\x1Bc'); // Clear screen
  }

  private async handleCommand(input: string): Promise<void> {
    const processes = this.processManager.getAllProcesses();
    
    switch (input.toLowerCase()) {
      case 'q':
      case 'quit':
      case 'exit':
        await this.handleExit();
        break;
        
      case 'a':
      case 'all':
        await this.startAll();
        break;
        
      case 'z':
      case 'stop-all':
        await this.stopAll();
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
        
      default:
        // Check if it's a number (process selection)
        const num = parseInt(input);
        if (!isNaN(num) && num >= 1 && num <= processes.length) {
          this.selectedIndex = num - 1;
          await this.showProcessMenu(processes[this.selectedIndex]);
        } else {
          console.log(colors.yellow('Invalid command. Type "h" for help.'));
        }
        break;
    }
  }

  private render(): void {
    process.stdout.write('\x1Bc'); // Clear screen
    const processes = this.processManager.getAllProcesses();
    const stats = this.processManager.getSystemStats();

    // Header
    console.log(colors.cyan.bold('🧠 Claude-Flow Process Manager'));
    console.log(colors.gray('─'.repeat(60)));
    
    // System stats
    console.log(colors.white('System Status:'), 
      colors.green(`${stats.runningProcesses}/${stats.totalProcesses} running`));
    
    if (stats.errorProcesses > 0) {
      console.log(colors.red(`⚠️  ${stats.errorProcesses} processes with errors`));
    }
    
    console.log();

    // Process list
    console.log(colors.white.bold('Processes:'));
    console.log(colors.gray('─'.repeat(60)));
    
    processes.forEach((process, index) => {
      const num = `[${index + 1}]`.padEnd(4);
      const status = this.getStatusDisplay(process.status);
      const name = process.name.padEnd(25);
      
      console.log(`${colors.gray(num)} ${status} ${colors.white(name)}`);
      
      if (process.metrics?.lastError) {
        console.log(colors.red(`       Error: ${process.metrics.lastError}`));
      }
    });

    // Footer
    console.log(colors.gray('─'.repeat(60)));
    console.log(colors.gray('Commands: [1-9] Select process [a] Start All [z] Stop All'));
    console.log(colors.gray('[r] Refresh [h] Help [q] Quit'));
  }

  private async showProcessMenu(processInfo: ProcessInfo): Promise<void> {
    console.log();
    console.log(colors.cyan.bold(`Selected: ${processInfo.name}`));
    console.log(colors.gray('─'.repeat(40)));
    
    if (processInfo.status === ProcessStatus.STOPPED) {
      console.log('[s] Start');
    } else if (processInfo.status === ProcessStatus.RUNNING) {
      console.log('[x] Stop');
      console.log('[r] Restart');
    }
    
    console.log('[d] Details');
    console.log('[c] Cancel');
    
    process.stdout.write('\nAction: ');
    
    const action = await this.readLine();
    if (action === null) return;
    
    const actionLower = action.toLowerCase();
    
    switch (actionLower) {
      case 's':
        if (processInfo.status === ProcessStatus.STOPPED) {
          await this.startProcess(processInfo.id);
        }
        break;
      case 'x':
        if (processInfo.status === ProcessStatus.RUNNING) {
          await this.stopProcess(processInfo.id);
        }
        break;
      case 'r':
        if (processInfo.status === ProcessStatus.RUNNING) {
          await this.restartProcess(processInfo.id);
        }
        break;
      case 'd':
        this.showProcessDetails(processInfo);
        await this.waitForKey();
        break;
    }
    
    this.render();
  }

  private showProcessDetails(processInfo: ProcessInfo): void {
    console.log();
    console.log(colors.cyan.bold(`📋 Process Details: ${processInfo.name}`));
    console.log(colors.gray('─'.repeat(60)));
    
    console.log(colors.white('ID:'), processInfo.id);
    console.log(colors.white('Type:'), processInfo.type);
    console.log(colors.white('Status:'), this.getStatusDisplay(processInfo.status), processInfo.status);
    
    if (processInfo.pid) {
      console.log(colors.white('PID:'), processInfo.pid);
    }
    
    if (processInfo.startTime) {
      const uptime = Date.now() - processInfo.startTime;
      console.log(colors.white('Uptime:'), this.formatUptime(uptime));
    }
    
    if (processInfo.metrics) {
      console.log();
      console.log(colors.white.bold('Metrics:'));
      if (processInfo.metrics.cpu !== undefined) {
        console.log(colors.white('CPU:'), `${processInfo.metrics.cpu.toFixed(1)}%`);
      }
      if (processInfo.metrics.memory !== undefined) {
        console.log(colors.white('Memory:'), `${processInfo.metrics.memory.toFixed(0)} MB`);
      }
      if (processInfo.metrics.restarts !== undefined) {
        console.log(colors.white('Restarts:'), processInfo.metrics.restarts);
      }
      if (processInfo.metrics.lastError) {
        console.log(colors.red('Last Error:'), processInfo.metrics.lastError);
      }
    }
    
    console.log();
    console.log(colors.gray('Press any key to continue...'));
  }

  private async waitForKey(): Promise<void> {
    await this.readLine();
  }

  private getStatusDisplay(status: ProcessStatus): string {
    switch (status) {
      case ProcessStatus.RUNNING:
        return colors.green('●');
      case ProcessStatus.STOPPED:
        return colors.gray('○');
      case ProcessStatus.STARTING:
        return colors.yellow('◐');
      case ProcessStatus.STOPPING:
        return colors.yellow('◑');
      case ProcessStatus.ERROR:
        return colors.red('✗');
      case ProcessStatus.CRASHED:
        return colors.red('☠');
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
    console.log(colors.cyan.bold('🧠 Claude-Flow Process Manager - Help'));
    console.log(colors.gray('─'.repeat(60)));
    console.log();
    console.log(colors.white.bold('Commands:'));
    console.log('  1-9     - Select process by number');
    console.log('  a       - Start all processes');
    console.log('  z       - Stop all processes');
    console.log('  r       - Refresh display');
    console.log('  h/?     - Show this help');
    console.log('  q       - Quit');
    console.log();
    console.log(colors.white.bold('Process Actions:'));
    console.log('  s       - Start selected process');
    console.log('  x       - Stop selected process');
    console.log('  r       - Restart selected process');
    console.log('  d       - Show process details');
    console.log();
    console.log(colors.gray('Press any key to continue...'));
  }

  private async startProcess(processId: string): Promise<void> {
    try {
      console.log(colors.yellow(`Starting ${processId}...`));
      await this.processManager.startProcess(processId);
      console.log(colors.green(`✓ Started ${processId}`));
    } catch (error) {
      console.log(colors.red(`✗ Failed to start ${processId}: ${(error as Error).message}`));
    }
    await this.waitForKey();
  }

  private async stopProcess(processId: string): Promise<void> {
    try {
      console.log(colors.yellow(`Stopping ${processId}...`));
      await this.processManager.stopProcess(processId);
      console.log(colors.green(`✓ Stopped ${processId}`));
    } catch (error) {
      console.log(colors.red(`✗ Failed to stop ${processId}: ${(error as Error).message}`));
    }
    await this.waitForKey();
  }

  private async restartProcess(processId: string): Promise<void> {
    try {
      console.log(colors.yellow(`Restarting ${processId}...`));
      await this.processManager.restartProcess(processId);
      console.log(colors.green(`✓ Restarted ${processId}`));
    } catch (error) {
      console.log(colors.red(`✗ Failed to restart ${processId}: ${(error as Error).message}`));
    }
    await this.waitForKey();
  }

  private async startAll(): Promise<void> {
    try {
      console.log(colors.yellow('Starting all processes...'));
      await this.processManager.startAll();
      console.log(colors.green('✓ All processes started'));
    } catch (error) {
      console.log(colors.red(`✗ Failed to start all: ${(error as Error).message}`));
    }
    await this.waitForKey();
    this.render();
  }

  private async stopAll(): Promise<void> {
    try {
      console.log(colors.yellow('Stopping all processes...'));
      await this.processManager.stopAll();
      console.log(colors.green('✓ All processes stopped'));
    } catch (error) {
      console.log(colors.red(`✗ Failed to stop all: ${(error as Error).message}`));
    }
    await this.waitForKey();
    this.render();
  }

  private async handleExit(): Promise<void> {
    const processes = this.processManager.getAllProcesses();
    const hasRunning = processes.some(p => p.status === ProcessStatus.RUNNING);
    
    if (hasRunning) {
      console.log();
      console.log(colors.yellow('⚠️  Some processes are still running.'));
      console.log('Stop all processes before exiting? [y/N]: ');
      
      const answer = await this.readLine();
      
      if (answer && answer.trim().toLowerCase() === 'y') {
        await this.stopAll();
      }
    }
    
    await this.stop();
  }

  private readLine(): Promise<string | null> {
    return new Promise((resolve) => {
      if (!stdin.readable) {
        resolve(null);
        return;
      }

      const onData = (data: Buffer) => {
        stdin.pause();
        stdin.removeListener('data', onData);
        resolve(data.toString().trim());
      };

      const onEnd = () => {
        stdin.removeListener('data', onData);
        stdin.removeListener('end', onEnd);
        resolve(null);
      };

      stdin.resume();
      stdin.setEncoding('utf8');
      stdin.once('data', onData);
      stdin.once('end', onEnd);
    });
  }
}