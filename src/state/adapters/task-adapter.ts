/**
 * Task State Adapter
 * Bridges TaskEngine to the unified state management system
 */

import { UnifiedStateManager } from '../state-manager.js';
import type { 
  TaskState,
  StateChangeCallback, 
  Unsubscribe 
} from '../types.js';
import { Logger } from '../../core/logger.js';

export interface TaskStateAdapterConfig {
  engineId: string;
  namespace?: string;
}

export interface Task {
  id: string;
  type: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  dependencies: string[];
  assignedTo?: string;
  agentType?: string;
  result?: any;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedDuration?: number;
  actualDuration?: number;
  retryCount: number;
  maxRetries: number;
  metadata: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  tasks: string[];
  status: 'draft' | 'active' | 'paused' | 'completed' | 'failed';
  strategy: 'sequential' | 'parallel' | 'conditional';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  executorId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  result?: any;
  error?: string;
  logs: string[];
  metrics: {
    duration: number;
    memoryUsage: number;
    cpuUsage: number;
  };
}

export interface TaskDependency {
  taskId: string;
  dependsOn: string;
  type: 'finish-to-start' | 'start-to-start' | 'finish-to-finish' | 'start-to-finish';
  conditions?: Record<string, any>;
}

export interface TaskSchedule {
  taskId: string;
  scheduledAt: Date;
  priority: number;
  constraints: Record<string, any>;
}

export class TaskStateAdapter {
  private logger: Logger;
  private stateManager: UnifiedStateManager;
  private config: TaskStateAdapterConfig;
  private subscriptions: Unsubscribe[] = [];

  constructor(stateManager: UnifiedStateManager, config: TaskStateAdapterConfig) {
    this.stateManager = stateManager;
    this.config = config;
    this.logger = new Logger({
      level: 'info',
      format: 'json',
      destination: 'console'
    }, { component: 'TaskStateAdapter' });

    this.logger.info('Task state adapter initialized', { engineId: config.engineId });
  }

  // ===== Task Management =====

  /**
   * Get a task by ID
   */
  public getTask(taskId: string): Task | undefined {
    const state = this.stateManager.getState();
    return state.tasks.tasks.get(taskId) as Task | undefined;
  }

  /**
   * Get all tasks
   */
  public getAllTasks(): Task[] {
    const state = this.stateManager.getState();
    return Array.from(state.tasks.tasks.values()) as unknown as Task[];
  }

  /**
   * Get tasks by status
   */
  public getTasksByStatus(status: Task['status']): Task[] {
    return this.getAllTasks().filter(task => task.status === status);
  }

  /**
   * Get tasks by assigned agent
   */
  public getTasksByAgent(agentId: string): Task[] {
    return this.getAllTasks().filter(task => task.assignedTo === agentId);
  }

  /**
   * Get tasks by priority (sorted high to low)
   */
  public getTasksByPriority(): Task[] {
    return this.getAllTasks().sort((a, b) => b.priority - a.priority);
  }

  /**
   * Add a new task
   */
  public addTask(task: Task): void {
    this.stateManager.dispatch({
      type: 'tasks/add',
      payload: task,
      metadata: {
        timestamp: new Date(),
        source: `TaskEngine:${this.config.engineId}`,
        reason: 'Task created'
      }
    });

    this.logger.debug('Task added to state', { 
      taskId: task.id, 
      type: task.type, 
      priority: task.priority,
      status: task.status
    });
  }

  /**
   * Update an existing task
   */
  public updateTask(taskId: string, updates: Partial<Task>): void {
    this.stateManager.dispatch({
      type: 'tasks/update',
      payload: {
        id: taskId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `TaskEngine:${this.config.engineId}`,
        reason: 'Task updated'
      }
    });

    this.logger.debug('Task updated in state', { taskId, updates });
  }

  /**
   * Remove a task
   */
  public removeTask(taskId: string): void {
    this.stateManager.dispatch({
      type: 'tasks/remove',
      payload: { id: taskId },
      metadata: {
        timestamp: new Date(),
        source: `TaskEngine:${this.config.engineId}`,
        reason: 'Task removed'
      }
    });

    this.logger.debug('Task removed from state', { taskId });
  }

  /**
   * Update task status
   */
  public setTaskStatus(taskId: string, status: Task['status']): void {
    const updates: Partial<Task> = { status };
    const now = new Date();

    switch (status) {
      case 'running':
        updates.startedAt = now;
        break;
      case 'completed':
      case 'failed':
      case 'cancelled':
        updates.completedAt = now;
        if (updates.startedAt) {
          updates.actualDuration = now.getTime() - updates.startedAt.getTime();
        }
        break;
    }

    this.updateTask(taskId, updates);
  }

  /**
   * Assign task to agent
   */
  public assignTask(taskId: string, agentId: string, agentType?: string): void {
    this.updateTask(taskId, {
      assignedTo: agentId,
      agentType,
      status: 'running'
    });
  }

  /**
   * Complete task with result
   */
  public completeTask(taskId: string, result?: any): void {
    this.updateTask(taskId, {
      status: 'completed',
      result,
      completedAt: new Date()
    });
  }

  /**
   * Fail task with error
   */
  public failTask(taskId: string, error: string): void {
    const task = this.getTask(taskId);
    if (task && task.retryCount < task.maxRetries) {
      this.updateTask(taskId, {
        status: 'pending',
        error,
        retryCount: task.retryCount + 1
      });
    } else {
      this.updateTask(taskId, {
        status: 'failed',
        error,
        completedAt: new Date()
      });
    }
  }

  // ===== Workflow Management =====

  /**
   * Get a workflow by ID
   */
  public getWorkflow(workflowId: string): Workflow | undefined {
    const state = this.stateManager.getState();
    return state.tasks.workflows.get(workflowId) as Workflow | undefined;
  }

  /**
   * Get all workflows
   */
  public getAllWorkflows(): Workflow[] {
    const state = this.stateManager.getState();
    return Array.from(state.tasks.workflows.values()) as unknown as Workflow[];
  }

  /**
   * Add a new workflow
   */
  public addWorkflow(workflow: Workflow): void {
    this.stateManager.dispatch({
      type: 'tasks/addWorkflow',
      payload: workflow,
      metadata: {
        timestamp: new Date(),
        source: `TaskEngine:${this.config.engineId}`,
        reason: 'Workflow created'
      }
    });

    this.logger.debug('Workflow added to state', { 
      workflowId: workflow.id, 
      tasksCount: workflow.tasks.length 
    });
  }

  /**
   * Update workflow
   */
  public updateWorkflow(workflowId: string, updates: Partial<Workflow>): void {
    this.stateManager.dispatch({
      type: 'tasks/updateWorkflow',
      payload: {
        id: workflowId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `TaskEngine:${this.config.engineId}`,
        reason: 'Workflow updated'
      }
    });

    this.logger.debug('Workflow updated in state', { workflowId, updates });
  }

  // ===== Task Execution Management =====

  /**
   * Get task execution
   */
  public getTaskExecution(executionId: string): TaskExecution | undefined {
    const state = this.stateManager.getState();
    return state.tasks.executions.get(executionId) as TaskExecution | undefined;
  }

  /**
   * Get executions for a task
   */
  public getExecutionsForTask(taskId: string): TaskExecution[] {
    return Array.from(this.stateManager.getState().tasks.executions.values())
      .filter((exec: any) => exec.taskId === taskId) as unknown as TaskExecution[];
  }

  /**
   * Add task execution
   */
  public addTaskExecution(execution: TaskExecution): void {
    this.stateManager.dispatch({
      type: 'tasks/addExecution',
      payload: execution,
      metadata: {
        timestamp: new Date(),
        source: `TaskEngine:${this.config.engineId}`,
        reason: 'Task execution started'
      }
    });

    this.logger.debug('Task execution added to state', { 
      executionId: execution.id, 
      taskId: execution.taskId 
    });
  }

  /**
   * Update task execution
   */
  public updateTaskExecution(executionId: string, updates: Partial<TaskExecution>): void {
    this.stateManager.dispatch({
      type: 'tasks/updateExecution',
      payload: {
        id: executionId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `TaskEngine:${this.config.engineId}`,
        reason: 'Task execution updated'
      }
    });

    this.logger.debug('Task execution updated in state', { executionId, updates });
  }

  // ===== Task Dependencies =====

  /**
   * Get dependencies for a task
   */
  public getTaskDependencies(taskId: string): TaskDependency[] {
    const state = this.stateManager.getState();
    return (state.tasks.dependencies.get(taskId) || []) as unknown as TaskDependency[];
  }

  /**
   * Add task dependency
   */
  public addTaskDependency(dependency: TaskDependency): void {
    this.stateManager.dispatch({
      type: 'tasks/addDependency',
      payload: dependency,
      metadata: {
        timestamp: new Date(),
        source: `TaskEngine:${this.config.engineId}`,
        reason: 'Task dependency added'
      }
    });

    this.logger.debug('Task dependency added to state', { 
      taskId: dependency.taskId, 
      dependsOn: dependency.dependsOn 
    });
  }

  /**
   * Check if task dependencies are satisfied
   */
  public areTaskDependenciesSatisfied(taskId: string): boolean {
    const dependencies = this.getTaskDependencies(taskId);
    
    return dependencies.every(dep => {
      const dependentTask = this.getTask(dep.dependsOn);
      return dependentTask?.status === 'completed';
    });
  }

  // ===== Task Queue Management =====

  /**
   * Get task queue
   */
  public getTaskQueue(): TaskState['queue'] {
    const state = this.stateManager.getState();
    return state.tasks.queue;
  }

  /**
   * Get next pending task
   */
  public getNextPendingTask(): Task | undefined {
    const queue = this.getTaskQueue();
    const pendingTasks = queue.pending
      .map(id => this.getTask(id))
      .filter((task): task is Task => task !== undefined)
      .filter(task => this.areTaskDependenciesSatisfied(task.id))
      .sort((a, b) => b.priority - a.priority);

    return pendingTasks[0];
  }

  /**
   * Move task to active queue
   */
  public moveTaskToActive(taskId: string): void {
    this.stateManager.dispatch({
      type: 'tasks/moveToActive',
      payload: { taskId },
      metadata: {
        timestamp: new Date(),
        source: `TaskEngine:${this.config.engineId}`,
        reason: 'Task moved to active queue'
      }
    });
  }

  // ===== State Subscription =====

  /**
   * Subscribe to task changes
   */
  public onTaskChanged(callback: StateChangeCallback): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('tasks', (change) => {
      if (change.action.type.startsWith('tasks/')) {
        callback(change);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Subscribe to specific task changes
   */
  public onSpecificTaskChanged(taskId: string, callback: StateChangeCallback): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('tasks', (change) => {
      if (change.action.type.startsWith('tasks/') && 
          change.action.payload?.id === taskId) {
        callback(change);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Subscribe to task status changes
   */
  public onTaskStatusChanged(callback: (taskId: string, status: Task['status']) => void): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('tasks', (change) => {
      if (change.action.type === 'tasks/update' && 
          change.action.payload?.updates?.status) {
        callback(change.action.payload.id, change.action.payload.updates.status);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  // ===== Query Methods =====

  /**
   * Get task statistics
   */
  public getTaskStats(): {
    totalTasks: number;
    tasksByStatus: Record<string, number>;
    averageTaskDuration: number;
    successRate: number;
    pendingTasks: number;
    activeTasks: number;
    completedTasks: number;
    failedTasks: number;
  } {
    const tasks = this.getAllTasks();
    const tasksByStatus: Record<string, number> = {};
    let totalDuration = 0;
    let completedCount = 0;

    tasks.forEach(task => {
      tasksByStatus[task.status] = (tasksByStatus[task.status] || 0) + 1;
      
      if (task.actualDuration) {
        totalDuration += task.actualDuration;
        completedCount++;
      }
    });

    const queue = this.getTaskQueue();
    const completedTasks = tasksByStatus['completed'] || 0;
    const failedTasks = tasksByStatus['failed'] || 0;
    const successRate = completedTasks + failedTasks > 0 
      ? (completedTasks / (completedTasks + failedTasks)) * 100 
      : 100;

    return {
      totalTasks: tasks.length,
      tasksByStatus,
      averageTaskDuration: completedCount > 0 ? totalDuration / completedCount : 0,
      successRate,
      pendingTasks: queue.pending.length,
      activeTasks: queue.active.length,
      completedTasks: queue.completed.length,
      failedTasks: queue.failed.length
    };
  }

  /**
   * Get ready tasks (dependencies satisfied)
   */
  public getReadyTasks(): Task[] {
    return this.getTasksByStatus('pending').filter(task => 
      this.areTaskDependenciesSatisfied(task.id)
    );
  }

  /**
   * Get blocked tasks (dependencies not satisfied)
   */
  public getBlockedTasks(): Task[] {
    return this.getTasksByStatus('pending').filter(task => 
      !this.areTaskDependenciesSatisfied(task.id)
    );
  }

  /**
   * Cleanup subscriptions
   */
  public dispose(): void {
    this.subscriptions.forEach(unsubscribe => unsubscribe());
    this.subscriptions = [];
    this.logger.info('Task state adapter disposed', { engineId: this.config.engineId });
  }
}