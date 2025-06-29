/**
 * Daemon Recovery Manager
 * 
 * Handles daemon process failures with exponential backoff retry mechanism
 * and state preservation across restarts
 */

import { Logger } from '../../core/logger';
import { ProcessRegistryDatabase } from './database.js';
import { ProcessInfo, ProcessStatus } from './types.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { EventEmitter } from 'events';
import { ConfigIntegration } from '@/config/loader.js';
import { DaemonConfig } from '@/config/types.js';

const logger = Logger.getInstance().child({ component: 'DaemonRecoveryManager' });

export interface RecoveryStrategy {
  name: string;
  canRecover(error: Error): boolean;
  recover(): Promise<void>;
}

export interface DaemonState {
  processes: ProcessInfo[];
  lastCheckpoint: Date;
  configHash: string;
}

export class DaemonRecoveryManager extends EventEmitter {
  private recoveryStrategies: Map<string, RecoveryStrategy> = new Map();
  private database: ProcessRegistryDatabase;
  private stateDir: string;
  private isRecovering = false;
  private config: ConfigIntegration;
  private daemonConfig: DaemonConfig | null = null;
  
  constructor(database: ProcessRegistryDatabase) {
    super();
    this.database = database;
    this.stateDir = join(process.cwd(), '.claude-flow', 'recovery');
    this.config = ConfigIntegration.getInstance();
    this.initializeStrategies();
    this.loadConfiguration();
  }
  
  private async loadConfiguration(): Promise<void> {
    try {
      await this.config.initialize('DaemonRecoveryManager');
      this.daemonConfig = this.config.getDaemonConfig();
      logger.info('Daemon configuration loaded', {
        healthCheckEnabled: this.daemonConfig.healthCheck.enabled,
        ipcTransport: this.daemonConfig.ipc.transport
      });
    } catch (error) {
      logger.error('Failed to load daemon configuration', { error });
    }
  }

  private initializeStrategies(): void {
    // Add default recovery strategies
    this.recoveryStrategies.set('database-connection', {
      name: 'database-connection',
      canRecover: (error) => error.message.includes('SQLITE') || error.message.includes('database'),
      recover: async () => {
        logger.info('Attempting database recovery');
        await this.database.initialize();
      }
    });

    this.recoveryStrategies.set('memory-exhaustion', {
      name: 'memory-exhaustion',
      canRecover: (error) => error.message.includes('heap out of memory'),
      recover: async () => {
        logger.info('Recovering from memory exhaustion');
        global.gc?.(); // Force garbage collection if available
        await this.cleanupOrphanedProcesses();
      }
    });
  }

  async handleDaemonCrash(error: Error): Promise<void> {
    if (this.isRecovering) {
      logger.error('Already recovering, preventing recursive recovery', { error });
      return;
    }

    this.isRecovering = true;
    logger.error('Daemon crashed:', error);
    
    try {
      // 1. Save current state
      await this.saveRegistryState();
      
      // 2. Clean up orphaned processes
      await this.cleanupOrphanedProcesses();
      
      // 3. Apply recovery strategies
      for (const [name, strategy] of this.recoveryStrategies) {
        if (strategy.canRecover(error)) {
          logger.info(`Applying recovery strategy: ${name}`);
          await strategy.recover();
        }
      }
      
      // 4. Attempt restart with exponential backoff
      await this.restartWithBackoff();
      
      // 5. Restore registry state
      await this.restoreRegistryState();
      
      // 6. Notify monitoring systems
      await this.notifyRecovery();
    } finally {
      this.isRecovering = false;
    }
  }

  private async restartWithBackoff(): Promise<void> {
    const maxRetries = 5;
    let delay = 1000; // Start with 1 second
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.startDaemon();
        logger.info(`Daemon restarted successfully on attempt ${attempt}`);
        this.emit('daemon-restarted', { attempt });
        return;
      } catch (error) {
        logger.warn(`Restart attempt ${attempt} failed:`, error);
        if (attempt < maxRetries) {
          await this.sleep(delay);
          delay *= 2; // Exponential backoff
          
          // Add jitter to prevent thundering herd
          const jitter = Math.random() * 1000;
          delay += jitter;
        }
      }
    }
    
    throw new Error('Failed to restart daemon after maximum retries');
  }

  private async startDaemon(): Promise<void> {
    // Ensure state directory exists
    await mkdir(this.stateDir, { recursive: true });
    
    // Initialize database
    await this.database.initialize();
    
    // Verify database connectivity
    const processes = await this.database.queryProcesses({});
    logger.info(`Daemon started, found ${processes.length} registered processes`);
  }

  private async saveRegistryState(): Promise<void> {
    try {
      const processes = await this.database.queryProcesses({});
      const state: DaemonState = {
        processes,
        lastCheckpoint: new Date(),
        configHash: this.calculateConfigHash()
      };
      
      const statePath = join(this.stateDir, 'daemon-state.json');
      await writeFile(statePath, JSON.stringify(state, null, 2));
      
      logger.info('Registry state saved', { processCount: processes.length });
    } catch (error) {
      logger.error('Failed to save registry state', { error });
    }
  }

  private async restoreRegistryState(): Promise<void> {
    try {
      const statePath = join(this.stateDir, 'daemon-state.json');
      const stateData = await readFile(statePath, 'utf-8');
      const state: DaemonState = JSON.parse(stateData);
      
      // Verify config hasn't changed
      if (state.configHash !== this.calculateConfigHash()) {
        logger.warn('Configuration has changed since last checkpoint');
      }
      
      // Re-register processes that were running
      for (const process of state.processes) {
        if (process.status === 'running' || process.status === 'starting') {
          // Check if process is still alive
          if (this.isProcessRunning(process.pid)) {
            await this.database.register(process);
            logger.info(`Restored process ${process.id} (${process.name})`);
          } else {
            logger.warn(`Process ${process.id} no longer running, marking as stopped`);
            process.status = 'stopped';
            await this.database.register(process);
          }
        }
      }
      
      logger.info('Registry state restored', { processCount: state.processes.length });
    } catch (error) {
      logger.error('Failed to restore registry state', { error });
    }
  }

  private async cleanupOrphanedProcesses(): Promise<void> {
    try {
      const processes = await this.database.queryProcesses({ status: 'running' });
      let orphanedCount = 0;
      
      for (const process of processes) {
        if (!this.isProcessRunning(process.pid)) {
          await this.database.updateProcess(process.id, { status: 'stopped' });
          await this.database.logEvent(process.id, 'cleanup', {
            reason: 'orphaned process detected during recovery'
          });
          orphanedCount++;
        }
      }
      
      if (orphanedCount > 0) {
        logger.info(`Cleaned up ${orphanedCount} orphaned processes`);
      }
    } catch (error) {
      logger.error('Failed to cleanup orphaned processes', { error });
    }
  }

  private async notifyRecovery(): Promise<void> {
    this.emit('recovery-complete', {
      timestamp: new Date(),
      strategies: Array.from(this.recoveryStrategies.keys())
    });
    
    logger.info('Recovery notification sent');
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private calculateConfigHash(): string {
    // Simple hash of configuration for change detection
    const config = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    };
    
    return require('crypto')
      .createHash('sha256')
      .update(JSON.stringify(config))
      .digest('hex')
      .substring(0, 16);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  addRecoveryStrategy(strategy: RecoveryStrategy): void {
    this.recoveryStrategies.set(strategy.name, strategy);
    logger.info(`Added recovery strategy: ${strategy.name}`);
  }

  removeRecoveryStrategy(name: string): void {
    this.recoveryStrategies.delete(name);
    logger.info(`Removed recovery strategy: ${name}`);
  }
}