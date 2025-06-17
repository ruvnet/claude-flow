/**
 * Task Engine Core - Comprehensive task management with orchestration features
 * Integrates with TodoWrite/TodoRead for coordination and Memory for persistence
 */

import { EventEmitter } from 'events';
import { Task, TaskStatus, AgentProfile, Resource } from '../utils/types.js';
import { generateId } from '../utils/helpers.js';

export interface TaskDependency {
  taskId: string;
  type: 'finish-to-start' | 'start-to-start' | 'finish-to-finish' | 'start-to-finish';
  lag?: number; // delay in milliseconds
}

export interface ResourceRequirement {
  resourceId: string;
  type: 'cpu' | 'memory' | 'disk' | 'network' | 'custom';
  amount: number;
  unit: string;
  exclusive?: boolean;
  priority?: number;
}

export interface TaskSchedule {
  startTime?: Date;
  endTime?: Date;
  deadline?: Date;
  recurring?: {
    interval: 'daily' | 'weekly' | 'monthly';
    count?: number;
    until?: Date;
  };
  timezone?: string;
}

export interface WorkflowTask extends Task {
  dependencies: TaskDependency[];
  resourceRequirements: ResourceRequirement[];
  schedule?: TaskSchedule;
  retryPolicy?: {
    maxAttempts: number;
    backoffMs: number;
    backoffMultiplier: number;
  };
  timeout?: number;
  tags: string[];
  estimatedDurationMs?: number;
  actualDurationMs?: number;
  progressPercentage: number;
  checkpoints: TaskCheckpoint[];
  rollbackStrategy?: 'previous-checkpoint' | 'initial-state' | 'custom';
  customRollbackHandler?: string;
}

export interface TaskCheckpoint {
  id: string;
  timestamp: Date;
  description: string;
  state: Record<string, unknown>;
  artifacts: string[];
}

export interface TaskExecution {
  id: string;
  taskId: string;
  agentId: string;
  startedAt: Date;
  completedAt?: Date;
  status: TaskStatus;
  progress: number;
  metrics: TaskMetrics;
  logs: TaskLog[];
}

export interface TaskMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskIO: number;
  networkIO: number;
  customMetrics: Record<string, number>;
}

export interface TaskLog {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  version: string;
  tasks: WorkflowTask[];
  variables: Record<string, unknown>;
  parallelism: {
    maxConcurrent: number;
    strategy: 'breadth-first' | 'depth-first' | 'priority-based';
  };
  errorHandling: {
    strategy: 'fail-fast' | 'continue-on-error' | 'retry-failed';
    maxRetries: number;
  };
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface TaskFilter {
  status?: TaskStatus[];
  assignedAgent?: string[];
  priority?: { min?: number; max?: number };
  tags?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
  dueBefore?: Date;
  search?: string;
}

export interface TaskSort {
  field: 'createdAt' | 'priority' | 'deadline' | 'status' | 'estimatedDuration';
  direction: 'asc' | 'desc';
}

export class TaskEngine extends EventEmitter {
  private tasks = new Map<string, WorkflowTask>();
  private executions = new Map<string, TaskExecution>();
  private workflows = new Map<string, Workflow>();
  private resources = new Map<string, Resource>();
  private dependencyGraph = new Map<string, Set<string>>();
  private readyQueue: string[] = [];
  private runningTasks = new Set<string>();
  private cancelledTasks = new Set<string>();
  private taskState = new Map<string, Record<string, unknown>>();

  constructor(
    private maxConcurrent: number = 10,
    private memoryManager?: any // Memory interface for persistence
  ) {
    super();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('task:created', this.handleTaskCreated.bind(this));
    this.on('task:completed', this.handleTaskCompleted.bind(this));
    this.on('task:failed', this.handleTaskFailed.bind(this));
    this.on('task:cancelled', this.handleTaskCancelled.bind(this));
  }

  /**
   * Create a new task with comprehensive options
   */
  async createTask(taskData: Partial<WorkflowTask>): Promise<WorkflowTask> {
    const task: WorkflowTask = {
      id: taskData.id || generateId('task'),
      type: taskData.type || 'general',
      description: taskData.description || '',
      priority: taskData.priority || 0,
      status: 'pending',
      input: taskData.input || {},
      createdAt: new Date(),
      dependencies: taskData.dependencies || [],
      resourceRequirements: taskData.resourceRequirements || [],
      schedule: taskData.schedule,
      retryPolicy: taskData.retryPolicy || {
        maxAttempts: 3,
        backoffMs: 1000,
        backoffMultiplier: 2
      },
      timeout: taskData.timeout || 300000, // 5 minutes default
      tags: taskData.tags || [],
      estimatedDurationMs: taskData.estimatedDurationMs,
      progressPercentage: 0,
      checkpoints: [],
      rollbackStrategy: taskData.rollbackStrategy || 'previous-checkpoint',
      metadata: taskData.metadata || {}
    };

    this.tasks.set(task.id, task);
    this.updateDependencyGraph(task);
    
    // Store in memory if manager available
    if (this.memoryManager) {
      await this.memoryManager.store(`task:${task.id}`, task);
    }

    this.emit('task:created', { task });
    this.scheduleTask(task);

    return task;
  }

  /**
   * List tasks with filtering and sorting
   */
  async listTasks(
    filter?: TaskFilter,
    sort?: TaskSort,
    limit?: number,
    offset?: number
  ): Promise<{ tasks: WorkflowTask[]; total: number; hasMore: boolean }> {
    let filteredTasks = Array.from(this.tasks.values());

    // Apply filters
    if (filter) {
      filteredTasks = filteredTasks.filter(task => {
        if (filter.status && !filter.status.includes(task.status)) return false;
        if (filter.assignedAgent && !filter.assignedAgent.includes(task.assignedAgent || '')) return false;
        if (filter.priority) {
          if (filter.priority.min !== undefined && task.priority < filter.priority.min) return false;
          if (filter.priority.max !== undefined && task.priority > filter.priority.max) return false;
        }
        if (filter.tags && !filter.tags.some(tag => task.tags.includes(tag))) return false;
        if (filter.createdAfter && task.createdAt < filter.createdAfter) return false;
        if (filter.createdBefore && task.createdAt > filter.createdBefore) return false;
        if (filter.dueBefore && task.schedule?.deadline && task.schedule.deadline > filter.dueBefore) return false;
        if (filter.search && !this.matchesSearch(task, filter.search)) return false;
        return true;
      });
    }

    // Apply sorting
    if (sort) {
      filteredTasks.sort((a, b) => {
        const direction = sort.direction === 'desc' ? -1 : 1;
        switch (sort.field) {
          case 'createdAt':
            return direction * (a.createdAt.getTime() - b.createdAt.getTime());
          case 'priority':
            return direction * (a.priority - b.priority);
          case 'deadline':
            const aDeadline = a.schedule?.deadline?.getTime() || 0;
            const bDeadline = b.schedule?.deadline?.getTime() || 0;
            return direction * (aDeadline - bDeadline);
          case 'estimatedDuration':
            return direction * ((a.estimatedDurationMs || 0) - (b.estimatedDurationMs || 0));
          default:
            return 0;
        }
      });
    }

    const total = filteredTasks.length;
    const startIndex = offset || 0;
    const endIndex = limit ? startIndex + limit : filteredTasks.length;
    const tasks = filteredTasks.slice(startIndex, endIndex);

    return {
      tasks,
      total,
      hasMore: endIndex < total
    };
  }

  /**
   * Get detailed task status with progress and metrics
   */
  async getTaskStatus(taskId: string): Promise<{
    task: WorkflowTask;
    execution?: TaskExecution;
    dependencies: { task: WorkflowTask; satisfied: boolean }[];
    dependents: WorkflowTask[];
    resourceStatus: { required: ResourceRequirement; available: boolean; allocated: boolean }[];
  } | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const execution = this.executions.get(taskId);
    
    // Get dependency status
    const dependencies = await Promise.all(
      task.dependencies.map(async dep => {
        const depTask = this.tasks.get(dep.taskId);
        if (!depTask) throw new Error(`Dependency task ${dep.taskId} not found`);
        const satisfied = this.isDependencySatisfied(dep, depTask);
        return { task: depTask, satisfied };
      })
    );

    // Get dependent tasks
    const dependents = Array.from(this.tasks.values()).filter(t => 
      t.dependencies.some(dep => dep.taskId === taskId)
    );

    // Get resource status
    const resourceStatus = task.resourceRequirements.map(req => {
      const resource = this.resources.get(req.resourceId);
      return {
        required: req,
        available: !!resource,
        allocated: resource?.lockedBy === taskId
      };
    });

    return {
      task,
      execution,
      dependencies,
      dependents,
      resourceStatus
    };
  }

  /**
   * Cancel task with rollback and cleanup
   */
  async cancelTask(taskId: string, reason: string = 'User requested', rollback: boolean = true): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (task.status === 'completed') {
      throw new Error(`Cannot cancel completed task ${taskId}`);
    }

    this.cancelledTasks.add(taskId);
    
    // Stop running execution
    if (this.runningTasks.has(taskId)) {
      this.runningTasks.delete(taskId);
      const execution = this.executions.get(taskId);
      if (execution) {
        execution.status = 'cancelled';
        execution.completedAt = new Date();
      }
    }

    // Release resources
    await this.releaseTaskResources(taskId);

    // Perform rollback if requested
    if (rollback && task.checkpoints.length > 0) {
      await this.rollbackTask(task);
    }

    // Update task status
    task.status = 'cancelled';
    task.metadata = { ...task.metadata, cancellationReason: reason, cancelledAt: new Date() };

    // Update memory
    if (this.memoryManager) {
      await this.memoryManager.store(`task:${taskId}`, task);
    }

    this.emit('task:cancelled', { taskId, reason });

    // Cancel dependent tasks if configured
    const dependents = Array.from(this.tasks.values()).filter(t => 
      t.dependencies.some(dep => dep.taskId === taskId)
    );

    for (const dependent of dependents) {
      if (dependent.status === 'pending' || dependent.status === 'queued') {
        await this.cancelTask(dependent.id, `Dependency ${taskId} was cancelled`);
      }
    }
  }

  /**
   * Execute workflow with parallel processing
   */
  async executeWorkflow(workflow: Workflow): Promise<void> {
    this.workflows.set(workflow.id, workflow);
    
    // Add all workflow tasks
    for (const task of workflow.tasks) {
      this.tasks.set(task.id, task);
      this.updateDependencyGraph(task);
    }

    // Start execution with parallel processing
    await this.processWorkflow(workflow);
  }

  /**
   * Create workflow from tasks
   */
  async createWorkflow(workflowData: Partial<Workflow>): Promise<Workflow> {
    const workflow: Workflow = {
      id: workflowData.id || generateId('workflow'),
      name: workflowData.name || 'Unnamed Workflow',
      description: workflowData.description || '',
      version: workflowData.version || '1.0.0',
      tasks: workflowData.tasks || [],
      variables: workflowData.variables || {},
      parallelism: workflowData.parallelism || {
        maxConcurrent: this.maxConcurrent,
        strategy: 'priority-based'
      },
      errorHandling: workflowData.errorHandling || {
        strategy: 'fail-fast',
        maxRetries: 3
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: workflowData.createdBy || 'system'
    };

    this.workflows.set(workflow.id, workflow);
    
    if (this.memoryManager) {
      await this.memoryManager.store(`workflow:${workflow.id}`, workflow);
    }

    return workflow;
  }

  /**
   * Get dependency visualization
   */
  getDependencyGraph(): { nodes: any[]; edges: any[] } {
    const nodes = Array.from(this.tasks.values()).map(task => ({
      id: task.id,
      label: task.description,
      status: task.status,
      priority: task.priority,
      progress: task.progressPercentage,
      estimatedDuration: task.estimatedDurationMs,
      tags: task.tags
    }));

    const edges: any[] = [];
    for (const task of this.tasks.values()) {
      for (const dep of task.dependencies) {
        edges.push({
          from: dep.taskId,
          to: task.id,
          type: dep.type,
          lag: dep.lag
        });
      }
    }

    return { nodes, edges };
  }

  // Private helper methods

  private updateDependencyGraph(task: WorkflowTask): void {
    if (!this.dependencyGraph.has(task.id)) {
      this.dependencyGraph.set(task.id, new Set());
    }

    for (const dep of task.dependencies) {
      if (!this.dependencyGraph.has(dep.taskId)) {
        this.dependencyGraph.set(dep.taskId, new Set());
      }
      this.dependencyGraph.get(dep.taskId)!.add(task.id);
    }
  }

  private scheduleTask(task: WorkflowTask): void {
    if (this.areTaskDependenciesSatisfied(task)) {
      this.readyQueue.push(task.id);
      this.processReadyQueue();
    }
  }

  private areTaskDependenciesSatisfied(task: WorkflowTask): boolean {
    return task.dependencies.every(dep => {
      const depTask = this.tasks.get(dep.taskId);
      return depTask && this.isDependencySatisfied(dep, depTask);
    });
  }

  private isDependencySatisfied(dependency: TaskDependency, depTask: WorkflowTask): boolean {
    switch (dependency.type) {
      case 'finish-to-start':
        return depTask.status === 'completed';
      case 'start-to-start':
        return depTask.status !== 'pending';
      case 'finish-to-finish':
        return depTask.status === 'completed';
      case 'start-to-finish':
        return depTask.status !== 'pending';
      default:
        return depTask.status === 'completed';
    }
  }

  private async processReadyQueue(): Promise<void> {
    while (this.readyQueue.length > 0 && this.runningTasks.size < this.maxConcurrent) {
      const taskId = this.readyQueue.shift()!;
      if (this.cancelledTasks.has(taskId)) continue;

      const task = this.tasks.get(taskId);
      if (!task) continue;

      await this.executeTask(task);
    }
  }

  private async executeTask(task: WorkflowTask): Promise<void> {
    if (!await this.acquireTaskResources(task)) {
      // Resources not available, put back in queue
      this.readyQueue.unshift(task.id);
      return;
    }

    const execution: TaskExecution = {
      id: generateId('execution'),
      taskId: task.id,
      agentId: task.assignedAgent || 'system',
      startedAt: new Date(),
      status: 'running',
      progress: 0,
      metrics: {
        cpuUsage: 0,
        memoryUsage: 0,
        diskIO: 0,
        networkIO: 0,
        customMetrics: {}
      },
      logs: []
    };

    this.executions.set(task.id, execution);
    this.runningTasks.add(task.id);
    task.status = 'running';
    task.startedAt = new Date();

    this.emit('task:started', { taskId: task.id, agentId: execution.agentId });

    try {
      // Simulate task execution - in real implementation, this would delegate to agents
      await this.simulateTaskExecution(task, execution);
      
      task.status = 'completed';
      task.completedAt = new Date();
      task.progressPercentage = 100;
      execution.status = 'completed';
      execution.completedAt = new Date();

      this.emit('task:completed', { taskId: task.id, result: task.output });
    } catch (error) {
      task.status = 'failed';
      task.error = error as Error;
      execution.status = 'failed';
      execution.completedAt = new Date();

      this.emit('task:failed', { taskId: task.id, error });
    } finally {
      this.runningTasks.delete(task.id);
      await this.releaseTaskResources(task.id);
      
      if (this.memoryManager) {
        await this.memoryManager.store(`task:${task.id}`, task);
        await this.memoryManager.store(`execution:${execution.id}`, execution);
      }
    }
  }

  private async simulateTaskExecution(task: WorkflowTask, execution: TaskExecution): Promise<void> {
    // Simulate work with progress updates
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      if (this.cancelledTasks.has(task.id)) {
        throw new Error('Task was cancelled');
      }

      task.progressPercentage = (i / steps) * 100;
      execution.progress = task.progressPercentage;

      // Create checkpoint every 25%
      if (i % Math.ceil(steps / 4) === 0) {
        await this.createCheckpoint(task, `Step ${i} completed`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    task.output = { result: 'Task completed successfully', timestamp: new Date() };
  }

  private async createCheckpoint(task: WorkflowTask, description: string): Promise<void> {
    const checkpoint: TaskCheckpoint = {
      id: generateId('checkpoint'),
      timestamp: new Date(),
      description,
      state: { ...this.taskState.get(task.id) || {} },
      artifacts: []
    };

    task.checkpoints.push(checkpoint);
    
    if (this.memoryManager) {
      await this.memoryManager.store(`checkpoint:${checkpoint.id}`, checkpoint);
    }
  }

  private async rollbackTask(task: WorkflowTask): Promise<void> {
    if (task.checkpoints.length === 0) return;

    const targetCheckpoint = task.rollbackStrategy === 'initial-state' 
      ? task.checkpoints[0] 
      : task.checkpoints[task.checkpoints.length - 1];

    // Restore state from checkpoint
    this.taskState.set(task.id, { ...targetCheckpoint.state });
    
    // Remove checkpoints after the target
    const targetIndex = task.checkpoints.findIndex(cp => cp.id === targetCheckpoint.id);
    task.checkpoints = task.checkpoints.slice(0, targetIndex + 1);

    task.progressPercentage = Math.max(0, task.progressPercentage - 25);
  }

  private async acquireTaskResources(task: WorkflowTask): Promise<boolean> {
    for (const requirement of task.resourceRequirements) {
      const resource = this.resources.get(requirement.resourceId);
      if (!resource) return false;
      
      if (resource.locked && requirement.exclusive) return false;
      
      resource.locked = true;
      resource.lockedBy = task.id;
      resource.lockedAt = new Date();
    }
    return true;
  }

  private async releaseTaskResources(taskId: string): Promise<void> {
    for (const resource of this.resources.values()) {
      if (resource.lockedBy === taskId) {
        resource.locked = false;
        resource.lockedBy = undefined;
        resource.lockedAt = undefined;
      }
    }
  }

  private matchesSearch(task: WorkflowTask, search: string): boolean {
    const searchLower = search.toLowerCase();
    return (
      task.description.toLowerCase().includes(searchLower) ||
      task.type.toLowerCase().includes(searchLower) ||
      task.tags.some(tag => tag.toLowerCase().includes(searchLower)) ||
      (task.assignedAgent && task.assignedAgent.toLowerCase().includes(searchLower))
    );
  }

  private async processWorkflow(workflow: Workflow): Promise<void> {
    // Implementation would manage workflow execution based on parallelism settings
    // This is a simplified version
    for (const task of workflow.tasks) {
      this.scheduleTask(task);
    }
  }

  private handleTaskCreated(data: { task: WorkflowTask }): void {
    // Handle task creation events
  }

  private handleTaskCompleted(data: { taskId: string; result: unknown }): void {
    // Schedule dependent tasks
    const dependents = Array.from(this.tasks.values()).filter(task =>
      task.dependencies.some(dep => dep.taskId === data.taskId)
    );

    for (const dependent of dependents) {
      if (this.areTaskDependenciesSatisfied(dependent)) {
        this.readyQueue.push(dependent.id);
      }
    }

    this.processReadyQueue();
  }

  private handleTaskFailed(data: { taskId: string; error: Error }): void {
    // Handle task failure, potentially retry or fail dependents
    const task = this.tasks.get(data.taskId);
    if (!task) return;

    // Implement retry logic based on retryPolicy
    if (task.retryPolicy && (task.metadata?.retryCount || 0) < task.retryPolicy.maxAttempts) {
      task.metadata = { ...task.metadata, retryCount: (task.metadata?.retryCount || 0) + 1 };
      task.status = 'pending';
      
      // Schedule retry with backoff
      setTimeout(() => {
        this.scheduleTask(task);
      }, task.retryPolicy!.backoffMs * Math.pow(task.retryPolicy!.backoffMultiplier, task.metadata.retryCount - 1));
    }
  }

  private handleTaskCancelled(data: { taskId: string; reason: string }): void {
    // Handle task cancellation
  }
}