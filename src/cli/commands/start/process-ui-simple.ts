/**
 * Simplified Process UI without keypress dependency
 * Uses basic stdin reading for compatibility
 */

import { colors } from '@cliffy/ansi/colors';
import { ProcessManager } from './process-manager.js';
import { ProcessInfo, ProcessStatus, SystemStats } from './types.js';

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
    console.clear();

    // Initial render
    this.render();

    // Simple input loop
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    
    while (this.running) {
      // Show prompt
      await Deno.stdout.write(encoder.encode('\nCommand: '));
      
      // Read single character
      const buf = new Uint8Array(1024);
      const n = await Deno.stdin.read(buf);
      if (n === null) break;
      
      const input = decoder.decode(buf.subarray(0, n)).trim();
      
      if (input.length > 0) {
        await this.handleCommand(input);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    console.clear();
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
    console.clear();
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

  private async showProcessMenu(process: ProcessInfo): Promise<void> {
    console.log();
    console.log(colors.cyan.bold(`Selected: ${process.name}`));
    console.log(colors.gray('─'.repeat(40)));
    
    if (process.status === ProcessStatus.STOPPED) {
      console.log('[s] Start');
    } else if (process.status === ProcessStatus.RUNNING) {
      console.log('[x] Stop');
      console.log('[r] Restart');
    }
    
    console.log('[d] Details');
    console.log('[c] Cancel');
    
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    
    await Deno.stdout.write(encoder.encode('\nAction: '));
    
    const buf = new Uint8Array(1024);
    const n = await Deno.stdin.read(buf);
    if (n === null) return;
    
    const action = decoder.decode(buf.subarray(0, n)).trim().toLowerCase();
    
    switch (action) {
      case 's':
        if (process.status === ProcessStatus.STOPPED) {
          await this.startProcess(process.id);
        }
        break;
      case 'x':
        if (process.status === ProcessStatus.RUNNING) {
          await this.stopProcess(process.id);
        }
        break;
      case 'r':
        if (process.status === ProcessStatus.RUNNING) {
          await this.restartProcess(process.id);
        }
        break;
      case 'd':
        this.showProcessDetails(process);
        await this.waitForKey();
        break;
    }
    
    this.render();
  }

  private showProcessDetails(process: ProcessInfo): void {
    console.log();
    console.log(colors.cyan.bold(`📋 Process Details: ${process.name}`));
    console.log(colors.gray('─'.repeat(60)));
    
    console.log(colors.white('ID:'), process.id);
    console.log(colors.white('Type:'), process.type);
    console.log(colors.white('Status:'), this.getStatusDisplay(process.status), process.status);
    
    if (process.pid) {
      console.log(colors.white('PID:'), process.pid);
    }
    
    if (process.startTime) {
      const uptime = Date.now() - process.startTime;
      console.log(colors.white('Uptime:'), this.formatUptime(uptime));
    }
    
    if (process.metrics) {
      console.log();
      console.log(colors.white.bold('Metrics:'));
      if (process.metrics.cpu !== undefined) {
        console.log(colors.white('CPU:'), `${process.metrics.cpu.toFixed(1)}%`);
      }
      if (process.metrics.memory !== undefined) {
        console.log(colors.white('Memory:'), `${process.metrics.memory.toFixed(0)} MB`);
      }
      if (process.metrics.restarts !== undefined) {
        console.log(colors.white('Restarts:'), process.metrics.restarts);
      }
      if (process.metrics.lastError) {
        console.log(colors.red('Last Error:'), process.metrics.lastError);
      }
    }
    
    console.log();
    console.log(colors.gray('Press any key to continue...'));
  }

  private async waitForKey(): Promise<void> {
    const buf = new Uint8Array(1);
    await Deno.stdin.read(buf);
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
      
      const decoder = new TextDecoder();
      const buf = new Uint8Array(1024);
      const n = await Deno.stdin.read(buf);
      
      if (n && decoder.decode(buf.subarray(0, n)).trim().toLowerCase() === 'y') {
        await this.stopAll();
      }
    }
    
    await this.stop();
  }
}