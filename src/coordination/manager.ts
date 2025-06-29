/**
 * Coordination manager for task scheduling and resource management
 */

import { Task, CoordinationConfig, SystemEvents } from '../utils/types.js';
import { IEventBus } from '../core/event-bus.js';
import { ILogger } from '../core/logger.js';
import { CoordinationError, DeadlockError } from '../utils/errors.js';
import { TaskScheduler } from './scheduler.js';
import { ResourceManager } from './resources.js';
import { MessageRouter } from './messaging.js';
import { AdvancedTaskScheduler } from './advanced-scheduler.js';
import { ConflictResolver } from './conflict-resolution.js';
import { CoordinationMetricsCollector } from './metrics.js';

export interface ICoordinationManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  assignTask(task: Task, agentId: string): Promise<void>;
  getAgentTaskCount(agentId: string): Promise<number>;
  getAgentTasks(agentId: string): Promise<Task[]>;
  cancelTask(taskId: string, reason?: string): Promise<void>;
  acquireResource(resourceId: string, agentId: string): Promise<void>;
  releaseResource(resourceId: string, agentId: string): Promise<void>;
  sendMessage(from: string, to: string, message: unknown): Promise<void>;
  getHealthStatus(): Promise<{ healthy: boolean; error?: string; metrics?: Record<string, number> }>;
  performMaintenance(): Promise<void>;
  getCoordinationMetrics(): Promise<Record<string, unknown>>;
  enableAdvancedScheduling(): void;
  reportConflict(type: 'resource' | 'task', id: string, agents: string[]): Promise<void>;
}

/**
 * Coordination manager implementation
 */
export class CoordinationManager implements ICoordinationManager {
  private scheduler: TaskScheduler;
  private resourceManager: ResourceManager;
  private messageRouter: MessageRouter;
  private conflictResolver: ConflictResolver;
  private metricsCollector: CoordinationMetricsCollector;
  private initialized = false;
  private deadlockCheckInterval?: ReturnType<typeof setInterval>;
  private advancedSchedulingEnabled = false;

  constructor(
    private config: CoordinationConfig,
    private eventBus: IEventBus,
    private logger: ILogger,
  ) {
    this.scheduler = new TaskScheduler(config, eventBus, logger);
    this.resourceManager = new ResourceManager(config, eventBus, logger);
    this.messageRouter = new MessageRouter(config, eventBus, logger);
    this.conflictResolver = new ConflictResolver(logger, eventBus);
    this.metricsCollector = new CoordinationMetricsCollector(logger, eventBus);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing coordination manager...');

    try {
      // Initialize components
      await this.scheduler.initialize();
      await this.resourceManager.initialize();
      await this.messageRouter.initialize();
      
      // Start metrics collection
      this.metricsCollector.start();

      // Start deadlock detection if enabled
      if (this.config.deadlockDetection) {
        this.startDeadlockDetection();
      }

      // Set up event handlers
      this.setupEventHandlers();

      this.initialized = true;
      this.logger.info('Coordination manager initialized');
    } catch (error) {
      this.logger.error('Failed to initialize coordination manager', error);
      throw new CoordinationError('Coordination manager initialization failed', { error });
    }
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.info('Shutting down coordination manager...');

    try {
      // Stop deadlock detection
      if (this.deadlockCheckInterval) {
        clearInterval(this.deadlockCheckInterval);
      }

      // Stop metrics collection
      this.metricsCollector.stop();
      
      // Shutdown components
      await Promise.all([
        this.scheduler.shutdown(),
        this.resourceManager.shutdown(),
        this.messageRouter.shutdown(),
      ]);

      this.initialized = false;
      this.logger.info('Coordination manager shutdown complete');
    } catch (error) {
      this.logger.error('Error during coordination manager shutdown', error);
      throw error;
    }
  }

  async assignTask(task: Task, agentId: string): Promise<void> {
    if (!this.initialized) {
      throw new CoordinationError('Coordination manager not initialized');
    }

    await this.scheduler.assignTask(task, agentId);
  }

  async getAgentTaskCount(agentId: string): Promise<number> {
    if (!this.initialized) {
      throw new CoordinationError('Coordination manager not initialized');
    }

    return this.scheduler.getAgentTaskCount(agentId);
  }

  async acquireResource(resourceId: string, agentId: string): Promise<void> {
    if (!this.initialized) {
      throw new CoordinationError('Coordination manager not initialized');
    }

    await this.resourceManager.acquire(resourceId, agentId);
  }

  async releaseResource(resourceId: string, agentId: string): Promise<void> {
    if (!this.initialized) {
      throw new CoordinationError('Coordination manager not initialized');
    }

    await this.resourceManager.release(resourceId, agentId);
  }

  async sendMessage(from: string, to: string, message: unknown): Promise<void> {
    if (!this.initialized) {
      throw new CoordinationError('Coordination manager not initialized');
    }

    await this.messageRouter.send(from, to, message);
  }

  async getHealthStatus(): Promise<{ 
    healthy: boolean; 
    error?: string; 
    metrics?: Record<string, number>;
  }> {
    try {
      const [schedulerHealth, resourceHealth, messageHealth] = await Promise.all([
        this.scheduler.getHealthStatus(),
        this.resourceManager.getHealthStatus(),
        this.messageRouter.getHealthStatus(),
      ]);

      const metrics = {
        ...schedulerHealth.metrics,
        ...resourceHealth.metrics,
        ...messageHealth.metrics,
      };

      const healthy = schedulerHealth.healthy && 
                     resourceHealth.healthy && 
                     messageHealth.healthy;

      const errors = [
        schedulerHealth.error,
        resourceHealth.error,
        messageHealth.error,
      ].filter(Boolean);

      const status: { healthy: boolean; error?: string; metrics?: Record<string, number> } = {
        healthy,
        metrics,
      };
      if (errors.length > 0) {
        status.error = errors.join('; ');
      }
      return status;
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private setupEventHandlers(): void {
    // Handle task events
    this.eventBus.on(SystemEvents.TASK_COMPLETED, async (data: unknown) => {
      const { taskId, result } = data as { taskId: string; result: unknown };
      try {
        await this.scheduler.completeTask(taskId, result);
      } catch (error) {
        this.logger.error('Error handling task completion', { taskId, error });
      }
    });

    this.eventBus.on(SystemEvents.TASK_FAILED, async (data: unknown) => {
      const { taskId, error } = data as { taskId: string; error: Error };
      try {
        await this.scheduler.failTask(taskId, error);
      } catch (err) {
        this.logger.error('Error handling task failure', { taskId, error: err });
      }
    });

    // Handle agent termination
    this.eventBus.on(SystemEvents.AGENT_TERMINATED, async (data: unknown) => {
      const { agentId } = data as { agentId: string };
      try {
        // Release all resources held by the agent
        await this.resourceManager.releaseAllForAgent(agentId);
        
        // Cancel all tasks assigned to the agent
        await this.scheduler.cancelAgentTasks(agentId);
      } catch (error) {
        this.logger.error('Error handling agent termination', { agentId, error });
      }
    });
  }

  private startDeadlockDetection(): void {
    this.deadlockCheckInterval = setInterval(async () => {
      try {
        const deadlock = await this.detectDeadlock();
        
        if (deadlock) {
          this.logger.error('Deadlock detected', deadlock);
          
          // Emit deadlock event
          this.eventBus.emit(SystemEvents.DEADLOCK_DETECTED, deadlock);
          
          // Attempt to resolve deadlock
          await this.resolveDeadlock(deadlock);
        }
      } catch (error) {
        this.logger.error('Error during deadlock detection', error);
      }
    }, 10000); // Check every 10 seconds
  }

  private async detectDeadlock(): Promise<{ 
    agents: string[]; 
    resources: string[];
  } | null> {
    // Get resource allocation graph
    const allocations = await this.resourceManager.getAllocations();
    const waitingFor = await this.resourceManager.getWaitingRequests();

    // Build dependency graph
    const graph = new Map<string, Set<string>>();
    
    // Add edges for resources agents are waiting for
    for (const [agentId, resources] of waitingFor) {
      if (!graph.has(agentId)) {
        graph.set(agentId, new Set());
      }
      
      // Find who owns these resources
      for (const resource of resources) {
        const owner = allocations.get(resource);
        if (owner && owner !== agentId) {
          graph.get(agentId)!.add(owner);
        }
      }
    }

    // Detect cycles using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycle: string[] = [];

    const hasCycle = (node: string): boolean => {
      visited.add(node);
      recursionStack.add(node);

      const neighbors = graph.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) {
            cycle.unshift(node);
            return true;
          }
        } else if (recursionStack.has(neighbor)) {
          cycle.unshift(node);
          cycle.unshift(neighbor);
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    // Check for cycles
    for (const node of graph.keys()) {
      if (!visited.has(node) && hasCycle(node)) {
        // Extract unique agents in cycle
        const agents = Array.from(new Set(cycle));
        
        // Find resources involved
        const resources: string[] = [];
        for (const agent of agents) {
          const waiting = waitingFor.get(agent) || [];
          resources.push(...waiting);
        }

        return {
          agents,
          resources: Array.from(new Set(resources)),
        };
      }
    }

    return null;
  }

  private async resolveDeadlock(deadlock: { 
    agents: string[]; 
    resources: string[];
  }): Promise<void> {
    this.logger.warn('Attempting to resolve deadlock', deadlock);

    // Simple resolution: release resources from the lowest priority agent
    // In a real implementation, use more sophisticated strategies
    
    try {
      // Find the agent with the lowest priority or least work done
      const agentToPreempt = deadlock.agents[0]; // Simplified
      
      if (!agentToPreempt) {
        throw new Error('No agents available to preempt in deadlock');
      }
      
      // Release all resources held by this agent
      await this.resourceManager.releaseAllForAgent(agentToPreempt);
      
      // Reschedule the agent's tasks
      await this.scheduler.rescheduleAgentTasks(agentToPreempt);
      
      this.logger.info('Deadlock resolved by preempting agent', { 
        agentId: agentToPreempt,
      });
    } catch (error) {
      throw new DeadlockError(
        'Failed to resolve deadlock',
        deadlock.agents,
        deadlock.resources,
      );
    }
  }

  async getAgentTasks(agentId: string): Promise<Task[]> {
    if (!this.initialized) {
      throw new CoordinationError('Coordination manager not initialized');
    }

    return this.scheduler.getAgentTasks(agentId);
  }

  async cancelTask(taskId: string, reason?: string): Promise<void> {
    if (!this.initialized) {
      throw new CoordinationError('Coordination manager not initialized');
    }

    await this.scheduler.cancelTask(taskId, reason || 'User requested cancellation');
  }

  async performMaintenance(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.debug('Performing coordination manager maintenance');

    try {
      await Promise.all([
        this.scheduler.performMaintenance(),
        this.resourceManager.performMaintenance(),
        this.messageRouter.performMaintenance(),
      ]);
      
      // Clean up old conflicts
      this.conflictResolver.cleanupOldConflicts(24 * 60 * 60 * 1000); // 24 hours
    } catch (error) {
      this.logger.error('Error during coordination manager maintenance', error);
    }
  }

  async getCoordinationMetrics(): Promise<Record<string, unknown>> {
    const baseMetrics = await this.getHealthStatus();
    const coordinationMetrics = this.metricsCollector.getCurrentMetrics();
    const conflictStats = this.conflictResolver.getStats();
    
    return {
      ...baseMetrics.metrics,
      coordination: coordinationMetrics,
      conflicts: conflictStats,
      advancedScheduling: this.advancedSchedulingEnabled,
    };
  }

  enableAdvancedScheduling(): void {
    if (this.advancedSchedulingEnabled) {
      return;
    }

    this.logger.info('Enabling advanced scheduling features');
    
    // Replace basic scheduler with advanced one
    const advancedScheduler = new AdvancedTaskScheduler(
      this.config,
      this.eventBus,
      this.logger,
    );

    // Transfer state if needed (in a real implementation)
    this.scheduler = advancedScheduler;
    this.advancedSchedulingEnabled = true;
  }

  async reportConflict(
    type: 'resource' | 'task',
    id: string,
    agents: string[],
  ): Promise<void> {
    this.logger.warn('Conflict reported', { type, id, agents });

    let conflict;
    if (type === 'resource') {
      conflict = await this.conflictResolver.reportResourceConflict(id, agents);
    } else {
      conflict = await this.conflictResolver.reportTaskConflict(id, agents, 'assignment');
    }

    // Auto-resolve using default strategy
    try {
      await this.conflictResolver.autoResolve(conflict.id);
    } catch (error) {
      this.logger.error('Failed to auto-resolve conflict', { 
        conflictId: conflict.id,
        error,
      });
    }
  }
}