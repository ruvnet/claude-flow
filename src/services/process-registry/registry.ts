/**
 * Process Registry Implementation
 * 
 * Central registry for tracking and managing all Claude-Flow processes
 */

import { v4 as uuidv4 } from 'uuid';
import { spawn } from '@/tracing/index.js';
import { Logger } from '@/shared/logger.js';
import { ProcessRegistryDatabase } from './database.js';
import {
  ProcessRegistry,
  ProcessInfo,
  ProcessFilter,
  HealthStatus,
  ProcessStatus,
  ProcessMetrics
} from './types.js';

const logger = Logger.getInstance().child({ component: 'ProcessRegistry' });

export class ProcessRegistryImpl implements ProcessRegistry {
  private database: ProcessRegistryDatabase;
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();
  private metricsCollectionInterval: NodeJS.Timeout | null = null;
  private orphanCleanupInterval: NodeJS.Timeout | null = null;

  constructor(dbPath?: string) {
    this.database = new ProcessRegistryDatabase(dbPath);
  }

  async initialize(): Promise<void> {
    await this.database.initialize();
    
    // Start background tasks
    this.startMetricsCollection();
    this.startOrphanCleanup();
    
    logger.info('Process registry initialized');
  }

  async shutdown(): Promise<void> {
    // Stop all health checks
    for (const interval of this.healthCheckIntervals.values()) {
      clearInterval(interval);
    }
    this.healthCheckIntervals.clear();

    // Stop background tasks
    if (this.metricsCollectionInterval) {
      clearInterval(this.metricsCollectionInterval);
    }
    if (this.orphanCleanupInterval) {
      clearInterval(this.orphanCleanupInterval);
    }

    await this.database.shutdown();
    logger.info('Process registry shut down');
  }

  // Core registry operations
  async register(process: ProcessInfo): Promise<string> {
    try {
      // Generate ID if not provided
      if (!process.id) {
        process.id = uuidv4();
      }

      // Set default status
      if (!process.status) {
        process.status = 'starting';
      }

      // Store in database
      await this.database.insertProcess(process);
      
      // Log event
      await this.database.logEvent(process.id, 'register', {
        name: process.name,
        type: process.type,
        pid: process.pid
      });

      // Start health monitoring if configured
      if (process.healthCheck.interval > 0) {
        this.startHealthMonitoring(process.id, process.healthCheck);
      }

      logger.info('Process registered', {
        processId: process.id,
        name: process.name,
        type: process.type,
        pid: process.pid
      });

      return process.id;
    } catch (error) {
      logger.error('Failed to register process', { error, process });
      throw error;
    }
  }

  async unregister(processId: string): Promise<void> {
    try {
      // Stop health monitoring
      this.stopHealthMonitoring(processId);

      // Delete from database
      await this.database.deleteProcess(processId);
      
      // Log event
      await this.database.logEvent(processId, 'unregister');

      logger.info('Process unregistered', { processId });
    } catch (error) {
      logger.error('Failed to unregister process', { error, processId });
      throw error;
    }
  }

  async query(filter: ProcessFilter): Promise<ProcessInfo[]> {
    try {
      return await this.database.queryProcesses(filter);
    } catch (error) {
      logger.error('Failed to query processes', { error, filter });
      throw error;
    }
  }

  // Health and monitoring
  async heartbeat(processId: string): Promise<void> {
    try {
      const process = await this.database.getProcess(processId);
      if (!process) {
        throw new Error(`Process not found: ${processId}`);
      }

      // Update health status
      const healthStatus: HealthStatus = {
        processId,
        status: 'healthy',
        lastHeartbeat: new Date(),
        consecutiveFailures: 0
      };

      await this.database.insertHealthCheck(processId, healthStatus);
      
      // Update process status if needed
      if (process.status !== 'running') {
        await this.database.updateProcess(processId, { status: 'running' });
      }

      await this.database.logEvent(processId, 'heartbeat');
    } catch (error) {
      logger.error('Failed to record heartbeat', { error, processId });
      throw error;
    }
  }

  async getHealth(processId: string): Promise<HealthStatus> {
    try {
      const health = await this.database.getLatestHealthCheck(processId);
      if (!health) {
        return {
          processId,
          status: 'unknown',
          lastHeartbeat: new Date(0),
          consecutiveFailures: 0
        };
      }
      return health;
    } catch (error) {
      logger.error('Failed to get health status', { error, processId });
      throw error;
    }
  }

  // Lifecycle management
  async terminate(processId: string, signal: string = 'SIGTERM'): Promise<void> {
    try {
      const processInfo = await this.database.getProcess(processId);
      if (!processInfo) {
        throw new Error(`Process not found: ${processId}`);
      }

      // Update status
      await this.database.updateProcess(processId, { status: 'stopping' });
      
      // Attempt to terminate the process
      try {
        process.kill(processInfo.pid, signal as any);
        logger.info('Process termination signal sent', { processId, pid: processInfo.pid, signal });
        
        // Wait a bit and check if process stopped
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (!this.isProcessRunning(processInfo.pid)) {
          await this.database.updateProcess(processId, { status: 'stopped' });
        }
      } catch (error) {
        logger.error('Failed to terminate process', { error, processId, pid: processInfo.pid });
        await this.database.updateProcess(processId, { status: 'failed' });
      }

      await this.database.logEvent(processId, 'terminate', { signal });
    } catch (error) {
      logger.error('Failed to terminate process', { error, processId });
      throw error;
    }
  }

  async restart(processId: string): Promise<void> {
    try {
      const processInfo = await this.database.getProcess(processId);
      if (!processInfo) {
        throw new Error(`Process not found: ${processId}`);
      }

      // Terminate existing process
      await this.terminate(processId, 'SIGTERM');
      
      // Wait for process to stop
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Spawn new process
      const child = spawn(processInfo.command[0], processInfo.command.slice(1), {
        env: { ...process.env, ...processInfo.environment },
        detached: true,
        stdio: 'inherit'
      });

      // Update process info with new PID
      const newProcessInfo: ProcessInfo = {
        ...processInfo,
        pid: child.pid!,
        startTime: new Date(),
        status: 'starting'
      };

      await this.database.updateProcess(processId, {
        pid: newProcessInfo.pid,
        status: newProcessInfo.status
      });

      await this.database.logEvent(processId, 'restart', { 
        oldPid: processInfo.pid,
        newPid: child.pid 
      });

      logger.info('Process restarted', { 
        processId, 
        oldPid: processInfo.pid, 
        newPid: child.pid 
      });
    } catch (error) {
      logger.error('Failed to restart process', { error, processId });
      throw error;
    }
  }

  // Private helper methods
  private startHealthMonitoring(processId: string, healthCheck: ProcessInfo['healthCheck']): void {
    const interval = setInterval(async () => {
      try {
        const process = await this.database.getProcess(processId);
        if (!process) {
          this.stopHealthMonitoring(processId);
          return;
        }

        // Check if process is still running
        const isRunning = this.isProcessRunning(process.pid);
        
        const health = await this.database.getLatestHealthCheck(processId);
        const consecutiveFailures = isRunning ? 0 : (health?.consecutiveFailures || 0) + 1;

        const healthStatus: HealthStatus = {
          processId,
          status: isRunning ? 'healthy' : 'unhealthy',
          lastHeartbeat: new Date(),
          consecutiveFailures,
          diagnostics: {
            errors: isRunning ? [] : ['Process not running']
          }
        };

        await this.database.insertHealthCheck(processId, healthStatus);

        // Update process status if unhealthy
        if (!isRunning && process.status === 'running') {
          await this.database.updateProcess(processId, { status: 'unresponsive' });
        }

        // Auto-restart if configured and too many failures
        if (consecutiveFailures >= healthCheck.retries && process.metadata?.autoRestart) {
          logger.warn('Auto-restarting unresponsive process', { processId, failures: consecutiveFailures });
          await this.restart(processId);
        }
      } catch (error) {
        logger.error('Health check failed', { error, processId });
      }
    }, healthCheck.interval);

    this.healthCheckIntervals.set(processId, interval);
  }

  private stopHealthMonitoring(processId: string): void {
    const interval = this.healthCheckIntervals.get(processId);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(processId);
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private startMetricsCollection(): void {
    this.metricsCollectionInterval = setInterval(async () => {
      try {
        const processes = await this.database.queryProcesses({ status: 'running' });
        
        for (const proc of processes) {
          try {
            // Collect basic metrics (this is a simplified version)
            const metrics: ProcessMetrics = {
              processId: proc.id,
              timestamp: new Date(),
              memory: process.memoryUsage().heapUsed, // Simplified - would need actual process metrics
              cpu: 0, // Would need actual CPU usage
              uptime: Date.now() - proc.startTime.getTime(),
              errorCount: 0
            };

            await this.database.insertMetrics(metrics);
          } catch (error) {
            logger.debug('Failed to collect metrics for process', { processId: proc.id, error });
          }
        }
      } catch (error) {
        logger.error('Metrics collection failed', { error });
      }
    }, 60000); // Every minute
  }

  private startOrphanCleanup(): void {
    this.orphanCleanupInterval = setInterval(async () => {
      try {
        const processes = await this.database.queryProcesses({});
        
        for (const proc of processes) {
          if (!this.isProcessRunning(proc.pid)) {
            logger.warn('Found orphaned process', { 
              processId: proc.id, 
              name: proc.name,
              pid: proc.pid 
            });
            
            await this.database.updateProcess(proc.id, { status: 'stopped' });
            await this.database.logEvent(proc.id, 'status_change', {
              from: proc.status,
              to: 'stopped',
              reason: 'orphaned'
            });
          }
        }
        
        // Cleanup old data
        await this.database.cleanupOldHealthChecks();
        await this.database.cleanupOldMetrics();
        await this.database.cleanupOldEvents();
      } catch (error) {
        logger.error('Orphan cleanup failed', { error });
      }
    }, 300000); // Every 5 minutes
  }
}

// Export singleton instance
let registryInstance: ProcessRegistryImpl | null = null;

export function getProcessRegistry(dbPath?: string): ProcessRegistryImpl {
  if (!registryInstance) {
    registryInstance = new ProcessRegistryImpl(dbPath);
  }
  return registryInstance;
}