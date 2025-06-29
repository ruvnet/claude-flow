/**
 * Swarm State Adapter
 * Bridges SwarmCoordinator to the unified state management system
 */

import { UnifiedStateManager } from '../state-manager.js';
import type { SwarmObjective as SwarmTypesObjective, AgentState as SwarmAgentState, TaskId } from '../../swarm/types.js';
import type { SwarmObjective as CoordinatorObjective } from '../../coordination/swarm-coordinator.js';

// Use coordinator objective type for compatibility
type SwarmObjective = CoordinatorObjective;

// Type aliases for swarm-specific entities
export type SwarmAgent = SwarmAgentState;
export type SwarmTask = {
  id: TaskId;
  agentId: string;
  objective: string;
  status: string;
  createdAt: Date;
  metadata?: Record<string, any>;
  // Additional properties used in the code
  assignedTo?: string;
  type?: string;
  priority?: number;
  startedAt?: Date;
  completedAt?: Date;
  result?: any;
  error?: string;
};
import type { StateChangeCallback, Unsubscribe } from '../types.js';
import { Logger } from '../../core/logger.js';

export interface SwarmStateAdapterConfig {
  coordinatorId: string;
  namespace?: string;
}

export class SwarmStateAdapter {
  private logger: Logger;
  private stateManager: UnifiedStateManager;
  private config: SwarmStateAdapterConfig;
  private subscriptions: Unsubscribe[] = [];

  constructor(stateManager: UnifiedStateManager, config: SwarmStateAdapterConfig) {
    this.stateManager = stateManager;
    this.config = config;
    this.logger = new Logger({
      level: 'info',
      format: 'json',
      destination: 'console'
    }, { component: 'SwarmStateAdapter' });

    this.logger.info('Swarm state adapter initialized', { coordinatorId: config.coordinatorId });
  }

  // ===== Agent Management =====

  /**
   * Get an agent by ID
   */
  public getAgent(agentId: string): SwarmAgent | undefined {
    const state = this.stateManager.getState();
    return state.swarm.swarmAgents.get(agentId);
  }

  /**
   * Get all agents
   */
  public getAllAgents(): SwarmAgent[] {
    const state = this.stateManager.getState();
    return Array.from(state.swarm.swarmAgents.values());
  }

  /**
   * Add a new agent
   */
  public addAgent(agent: SwarmAgent): void {
    this.stateManager.dispatch({
      type: 'swarm/addAgent',
      payload: agent,
      metadata: {
        timestamp: new Date(),
        source: `SwarmCoordinator:${this.config.coordinatorId}`,
        reason: 'Agent added to swarm'
      }
    });

    this.logger.debug('Agent added to state', { agentId: agent.id, type: agent.type });
  }

  /**
   * Update an existing agent
   */
  public updateAgent(agentId: string, updates: Partial<SwarmAgent>): void {
    this.stateManager.dispatch({
      type: 'swarm/updateAgent',
      payload: {
        id: agentId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `SwarmCoordinator:${this.config.coordinatorId}`,
        reason: 'Agent state updated'
      }
    });

    this.logger.debug('Agent updated in state', { agentId, updates });
  }

  /**
   * Remove an agent
   */
  public removeAgent(agentId: string): void {
    this.stateManager.dispatch({
      type: 'swarm/removeAgent',
      payload: { id: agentId },
      metadata: {
        timestamp: new Date(),
        source: `SwarmCoordinator:${this.config.coordinatorId}`,
        reason: 'Agent removed from swarm'
      }
    });

    this.logger.debug('Agent removed from state', { agentId });
  }

  /**
   * Update agent status
   */
  public setAgentStatus(agentId: string, status: SwarmAgent['status']): void {
    this.updateAgent(agentId, { status });
  }

  /**
   * Update agent metrics
   */
  public updateAgentMetrics(agentId: string, metrics: Partial<SwarmAgent['metrics']>): void {
    const currentAgent = this.getAgent(agentId);
    if (currentAgent) {
      this.updateAgent(agentId, {
        metrics: { ...currentAgent.metrics, ...metrics }
      });
    }
  }

  // ===== Task Management =====

  /**
   * Get a task by ID
   */
  public getTask(taskId: string): SwarmTask | undefined {
    const state = this.stateManager.getState();
    return state.swarm.swarmTasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  public getAllTasks(): SwarmTask[] {
    const state = this.stateManager.getState();
    return Array.from(state.swarm.swarmTasks.values());
  }

  /**
   * Get tasks by status
   */
  public getTasksByStatus(status: SwarmTask['status']): SwarmTask[] {
    return this.getAllTasks().filter(task => task.status === status);
  }

  /**
   * Get tasks assigned to an agent
   */
  public getTasksForAgent(agentId: string): SwarmTask[] {
    return this.getAllTasks().filter(task => task.assignedTo === agentId);
  }

  /**
   * Add a new task
   */
  public addTask(task: SwarmTask): void {
    this.stateManager.dispatch({
      type: 'swarm/addTask',
      payload: task,
      metadata: {
        timestamp: new Date(),
        source: `SwarmCoordinator:${this.config.coordinatorId}`,
        reason: 'Task added to swarm'
      }
    });

    this.logger.debug('Task added to state', { taskId: task.id, type: task.type, priority: task.priority });
  }

  /**
   * Update an existing task
   */
  public updateTask(taskId: string, updates: Partial<SwarmTask>): void {
    this.stateManager.dispatch({
      type: 'swarm/updateTask',
      payload: {
        id: taskId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `SwarmCoordinator:${this.config.coordinatorId}`,
        reason: 'Task state updated'
      }
    });

    this.logger.debug('Task updated in state', { taskId, updates });
  }

  /**
   * Update task status
   */
  public setTaskStatus(taskId: string, status: SwarmTask['status']): void {
    const updates: Partial<SwarmTask> = { status };
    
    // Set timestamps based on status
    const now = new Date();
    switch (status) {
      case 'running':
        updates.startedAt = now;
        break;
      case 'completed':
      case 'failed':
        updates.completedAt = now;
        break;
    }

    this.updateTask(taskId, updates);
  }

  /**
   * Assign task to agent
   */
  public assignTask(taskId: string, agentId: string): void {
    this.updateTask(taskId, { assignedTo: agentId });
  }

  /**
   * Set task result
   */
  public setTaskResult(taskId: string, result: SwarmTask['result'], error?: string): void {
    const updates: Partial<SwarmTask> = { result };
    if (error) {
      updates.error = error;
      updates.status = 'failed';
    } else {
      updates.status = 'completed';
    }
    updates.completedAt = new Date();
    
    this.updateTask(taskId, updates);
  }

  // ===== Objective Management =====

  /**
   * Get an objective by ID
   */
  public getObjective(objectiveId: string): SwarmObjective | undefined {
    const state = this.stateManager.getState();
    return state.swarm.activeSwarms.get(objectiveId) as SwarmObjective | undefined;
  }

  /**
   * Get all objectives
   */
  public getAllObjectives(): SwarmObjective[] {
    const state = this.stateManager.getState();
    return Array.from(state.swarm.activeSwarms.values()) as unknown as SwarmObjective[];
  }

  /**
   * Add a new objective
   */
  public addObjective(objective: SwarmObjective): void {
    this.stateManager.dispatch({
      type: 'swarm/addObjective',
      payload: objective,
      metadata: {
        timestamp: new Date(),
        source: `SwarmCoordinator:${this.config.coordinatorId}`,
        reason: 'Objective added to swarm'
      }
    });

    this.logger.info('Objective added to state', { 
      objectiveId: objective.id, 
      strategy: objective.strategy,
      tasksCount: objective.tasks.length
    });
  }

  /**
   * Update an existing objective
   */
  public updateObjective(objectiveId: string, updates: Partial<SwarmObjective>): void {
    this.stateManager.dispatch({
      type: 'swarm/updateObjective',
      payload: {
        id: objectiveId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `SwarmCoordinator:${this.config.coordinatorId}`,
        reason: 'Objective state updated'
      }
    });

    this.logger.debug('Objective updated in state', { objectiveId, updates });
  }

  /**
   * Update objective status
   */
  public setObjectiveStatus(objectiveId: string, status: SwarmObjective['status']): void {
    const updates: Partial<SwarmObjective> = { status };
    
    if (status === 'completed' || status === 'failed') {
      updates.completedAt = new Date();
    }

    this.updateObjective(objectiveId, updates);
  }

  // ===== Coordinator Management =====

  /**
   * Register this coordinator in the state
   */
  public registerCoordinator(status: 'active' | 'paused' | 'stopped', strategy: string): void {
    const coordinator = {
      id: this.config.coordinatorId,
      name: `SwarmCoordinator-${this.config.coordinatorId}`,
      status,
      strategy,
      startedAt: new Date(),
      metrics: {
        tasksProcessed: 0,
        successRate: 100,
        averageTaskTime: 0
      }
    };

    this.stateManager.dispatch({
      type: 'swarm/registerCoordinator',
      payload: coordinator,
      metadata: {
        timestamp: new Date(),
        source: `SwarmCoordinator:${this.config.coordinatorId}`,
        reason: 'Coordinator registered'
      }
    });

    this.logger.info('Coordinator registered in state', { coordinatorId: this.config.coordinatorId, strategy });
  }

  /**
   * Update coordinator metrics
   */
  public updateCoordinatorMetrics(metrics: Partial<{
    tasksProcessed: number;
    successRate: number;
    averageTaskTime: number;
  }>): void {
    this.stateManager.dispatch({
      type: 'swarm/updateCoordinatorMetrics',
      payload: {
        id: this.config.coordinatorId,
        metrics
      },
      metadata: {
        timestamp: new Date(),
        source: `SwarmCoordinator:${this.config.coordinatorId}`,
        reason: 'Coordinator metrics updated'
      }
    });
  }

  // ===== State Subscription =====

  /**
   * Subscribe to agent changes
   */
  public onAgentChanged(callback: StateChangeCallback): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('swarm', (change) => {
      if (change.action.type.startsWith('swarm/') && 
          (change.action.type.includes('Agent') || change.action.type.includes('agent'))) {
        callback(change);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Subscribe to task changes
   */
  public onTaskChanged(callback: StateChangeCallback): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('swarm', (change) => {
      if (change.action.type.startsWith('swarm/') && 
          (change.action.type.includes('Task') || change.action.type.includes('task'))) {
        callback(change);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Subscribe to objective changes
   */
  public onObjectiveChanged(callback: StateChangeCallback): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('swarm', (change) => {
      if (change.action.type.startsWith('swarm/') && 
          (change.action.type.includes('Objective') || change.action.type.includes('objective'))) {
        callback(change);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  // ===== Query Methods =====

  /**
   * Get swarm statistics
   */
  public getSwarmStats(): {
    agentCount: number;
    taskCount: number;
    objectiveCount: number;
    activeAgents: number;
    completedTasks: number;
    failedTasks: number;
  } {
    const agents = this.getAllAgents();
    const tasks = this.getAllTasks();
    const objectives = this.getAllObjectives();

    return {
      agentCount: agents.length,
      taskCount: tasks.length,
      objectiveCount: objectives.length,
      activeAgents: agents.filter(a => a.status === 'busy').length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      failedTasks: tasks.filter(t => t.status === 'failed').length
    };
  }

  /**
   * Get pending tasks ordered by priority
   */
  public getPendingTasksByPriority(): SwarmTask[] {
    return this.getTasksByStatus('pending')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Get available agents (idle status)
   */
  public getAvailableAgents(): SwarmAgent[] {
    return this.getAllAgents().filter(agent => agent.status === 'idle');
  }

  /**
   * Cleanup subscriptions
   */
  public dispose(): void {
    this.subscriptions.forEach(unsubscribe => unsubscribe());
    this.subscriptions = [];
    this.logger.info('Swarm state adapter disposed', { coordinatorId: this.config.coordinatorId });
  }
}