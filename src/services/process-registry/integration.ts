/**
 * Process Registry Integration
 * 
 * Helper functions for integrating commands and processes with the registry
 */

import { ProcessInfo, ProcessRegistry } from './types.js';
import { getProcessRegistry } from './registry.js';
import { Logger } from '@/shared/logger.js';

const logger = Logger.getInstance().child({ component: 'RegistryIntegration' });

export interface RegisterOptions {
  name: string;
  type: ProcessInfo['type'];
  command: string[];
  parentId?: string;
  healthCheckInterval?: number;
  healthCheckTimeout?: number;
  metadata?: Record<string, any>;
}

/**
 * Register current process with the registry
 */
export async function registerCurrentProcess(options: RegisterOptions): Promise<string> {
  const registry = getProcessRegistry();
  
  // Ensure registry is initialized
  try {
    await registry.initialize();
  } catch (error) {
    // Registry might already be initialized
    logger.debug('Registry initialization skipped', { error });
  }

  const processInfo: ProcessInfo = {
    id: `${options.type}-${Date.now()}-${process.pid}`,
    name: options.name,
    type: options.type,
    pid: process.pid,
    parentId: options.parentId,
    startTime: new Date(),
    status: 'starting',
    command: options.command,
    environment: process.env as Record<string, string>,
    resources: {
      memory: process.memoryUsage().heapUsed,
      cpu: 0 // Would need proper CPU tracking
    },
    healthCheck: {
      interval: options.healthCheckInterval || 30000,
      timeout: options.healthCheckTimeout || 5000,
      retries: 3
    },
    metadata: options.metadata
  };

  const processId = await registry.register(processInfo);

  // Set up automatic heartbeat
  if (options.healthCheckInterval && options.healthCheckInterval > 0) {
    setInterval(async () => {
      try {
        await registry.heartbeat(processId);
      } catch (error) {
        logger.error('Heartbeat failed', { error, processId });
      }
    }, options.healthCheckInterval);
  }

  // Register cleanup on exit
  const cleanup = async () => {
    try {
      await registry.unregister(processId);
    } catch (error) {
      logger.error('Failed to unregister on exit', { error, processId });
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return processId;
}

/**
 * Register a child process with the registry
 */
export async function registerChildProcess(
  childPid: number,
  options: RegisterOptions & { parentId: string }
): Promise<string> {
  const registry = getProcessRegistry();

  const processInfo: ProcessInfo = {
    id: `${options.type}-${Date.now()}-${childPid}`,
    name: options.name,
    type: options.type,
    pid: childPid,
    parentId: options.parentId,
    startTime: new Date(),
    status: 'starting',
    command: options.command,
    environment: process.env as Record<string, string>,
    resources: {
      memory: 0,
      cpu: 0
    },
    healthCheck: {
      interval: options.healthCheckInterval || 30000,
      timeout: options.healthCheckTimeout || 5000,
      retries: 3
    },
    metadata: options.metadata
  };

  return await registry.register(processInfo);
}

/**
 * Create a registry-aware command wrapper
 */
export function withRegistry<T extends (...args: any[]) => any>(
  commandFn: T,
  registryOptions: Omit<RegisterOptions, 'command'>
): T {
  return (async (...args: Parameters<T>) => {
    let processId: string | undefined;

    try {
      // Register process
      processId = await registerCurrentProcess({
        ...registryOptions,
        command: [process.argv[0], ...process.argv.slice(1)]
      });

      // Update status to running
      const registry = getProcessRegistry();
      await registry.heartbeat(processId);

      // Execute command
      const result = await commandFn(...args);

      // Clean up
      if (processId) {
        await registry.unregister(processId);
      }

      return result;
    } catch (error) {
      // Update status to failed if registered
      if (processId) {
        try {
          const registry = getProcessRegistry();
          await registry.unregister(processId);
        } catch {
          // Ignore cleanup errors
        }
      }
      throw error;
    }
  }) as T;
}

/**
 * Get process hierarchy for a given process
 */
export async function getProcessHierarchy(processId: string): Promise<ProcessInfo[]> {
  const registry = getProcessRegistry();
  const hierarchy: ProcessInfo[] = [];
  
  // Get the process
  const process = await registry.query({ id: processId });
  if (process.length === 0) return hierarchy;
  
  hierarchy.push(process[0]);
  
  // Get all children
  const children = await registry.query({ parentId: processId });
  for (const child of children) {
    const childHierarchy = await getProcessHierarchy(child.id);
    hierarchy.push(...childHierarchy);
  }
  
  return hierarchy;
}

/**
 * Monitor process health and auto-restart if needed
 */
export async function monitorProcessHealth(
  processId: string,
  options: {
    checkInterval?: number;
    maxFailures?: number;
    autoRestart?: boolean;
  } = {}
): Promise<() => void> {
  const registry = getProcessRegistry();
  const {
    checkInterval = 30000,
    maxFailures = 3,
    autoRestart = false
  } = options;

  const interval = setInterval(async () => {
    try {
      const health = await registry.getHealth(processId);
      
      if (health.status === 'unhealthy' && health.consecutiveFailures >= maxFailures) {
        logger.warn('Process unhealthy', {
          processId,
          failures: health.consecutiveFailures
        });

        if (autoRestart) {
          logger.info('Auto-restarting unhealthy process', { processId });
          await registry.restart(processId);
        }
      }
    } catch (error) {
      logger.error('Health monitoring failed', { error, processId });
    }
  }, checkInterval);

  // Return cleanup function
  return () => clearInterval(interval);
}