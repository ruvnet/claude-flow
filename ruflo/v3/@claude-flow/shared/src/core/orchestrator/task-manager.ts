/**
 * V3 Task Manager
 * Decomposed from orchestrator.ts - Task lifecycle management
 * ~200 lines (target achieved)
 */

import type {
  ITask,
  ITaskCreate,
  ITaskResult,
  ITaskManager,
  ITaskQueue,
  TaskManagerMetrics,
  TaskStatus,
} from '../interfaces/task.interface.js';
import type { IEventBus, SystemEventType } from '../interfaces/event.interface.js';
import { SystemEventTypes } from '../interfaces/event.interface.js';
import { randomBytes } from 'crypto';

// Secure task ID generation
function generateSecureTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(12).toString('hex');
  return `task_${timestamp}_${random}`;
}

/**
 * Priority queue implementation for tasks
 */
export class TaskQueue implements ITaskQueue {
  private tasks: ITask[] = [];

  async enqueue(task: ITask): Promise<void> {
    this.tasks.push(task);
    this.tasks.sort((a, b) => b.priority - a.priority);
  }

  async dequeue(): Promise<ITask | undefined> {
    return this.tasks.shift();
  }

  async peek(): Promise<ITask | undefined> {
    return this.tasks[0];
  }

  size(): number {
    return this.tasks.length;
  }

  isEmpty(): boolean {
    return this.tasks.length === 0;
  }

  async clear(): Promise<void> {
    this.tasks = [];
  }

  async getAll(): Promise<ITask[]> {
    return [...this.tasks];
  }

  async remove(taskId: string): Promise<boolean> {
    const index = this.tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      this.tasks.splice(index, 1);
      return true;
    }
    return false;
  }

  async updatePriority(taskId: string, priority: number): Promise<boolean> {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      (task as { priority: number }).priority = priority;
      this.tasks.sort((a, b) => b.priority - a.priority);
      return true;
    }
    return false;
  }
}

/**
 * Task manager implementation
 */
export class TaskManager implements ITaskManager {
  private tasks = new Map<string, ITask>();
  private queue: ITaskQueue;
  private metrics = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    totalDuration: 0,
    totalWaitTime: 0,
  };

  constructor(
    private eventBus: IEventBus,
    queue?: ITaskQueue,
  ) {
    this.queue = queue ?? new TaskQueue();
  }

  async createTask(params: ITaskCreate): Promise<ITask> {
    const task: ITask = {
      id: generateSecureTaskId(),
      type: params.type,
      description: params.description,
      priority: params.priority ?? 50,
      createdAt: new Date(),
      status: 'pending',
      timeout: params.timeout,
      assignedAgent: params.assignedAgent,
      input: params.input,
      metadata: params.metadata,
    };

    this.tasks.set(task.id, task);
    this.metrics.totalTasks++;

    this.eventBus.emit(SystemEventTypes.TASK_CREATED, { task });

    return task;
  }

  getTask(taskId: string): ITask | undefined {
    return this.tasks.get(taskId);
  }

  getTasks(filter?: Partial<Pick<ITask, 'status' | 'type' | 'assignedAgent'>>): ITask[] {
    let tasks = Array.from(this.tasks.values());

    if (filter) {
      if (filter.status) {
        tasks = tasks.filter(t => t.status === filter.status);
      }
      if (filter.type) {
        tasks = tasks.filter(t => t.type === filter.type);
      }
      if (filter.assignedAgent) {
        tasks = tasks.filter(t => t.assignedAgent === filter.assignedAgent);
      }
    }

    return tasks;
  }

  async assignTask(taskId: string, agentId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.assignedAgent = agentId;
    task.status = 'assigned';

    this.eventBus.emit(SystemEventTypes.TASK_ASSIGNED, {
      taskId,
      agentId,
    });
  }

  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = 'running';
    task.startedAt = new Date();

    // Calculate wait time
    const waitTime = task.startedAt.getTime() - task.createdAt.getTime();
    this.metrics.totalWaitTime += waitTime;

    this.eventBus.emit(SystemEventTypes.TASK_STARTED, {
      taskId,
      agentId: task.assignedAgent,
      startTime: task.startedAt,
    });
  }

  async completeTask(taskId: string, result: ITaskResult): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = 'completed';
    task.completedAt = new Date();
    task.output = result.output;

    this.metrics.completedTasks++;
    this.metrics.totalDuration += result.duration;

    this.eventBus.emit(SystemEventTypes.TASK_COMPLETED, {
      taskId,
      result,
    });
  }

  async failTask(taskId: string, error: Error): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = 'failed';
    task.completedAt = new Date();
    task.error = error;

    this.metrics.failedTasks++;

    this.eventBus.emit(SystemEventTypes.TASK_FAILED, {
      taskId,
      error,
      retryable: this.isRetryable(task),
    });
  }

  async cancelTask(taskId: string, reason?: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = 'cancelled';
    task.completedAt = new Date();

    this.metrics.cancelledTasks++;

    this.eventBus.emit(SystemEventTypes.TASK_CANCELLED, {
      taskId,
      reason: reason ?? 'User requested',
    });
  }

  async retryTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const retryCount = (task.metadata?.retryCount as number) ?? 0;
    const maxRetries = (task.metadata?.maxRetries as number) ?? 3;

    if (retryCount >= maxRetries) {
      throw new Error(`Task ${taskId} has exceeded max retries`);
    }

    task.status = 'pending';
    task.assignedAgent = undefined;
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.error = undefined;
    task.metadata = {
      ...task.metadata,
      retryCount: retryCount + 1,
    };

    await this.queue.enqueue(task);

    this.eventBus.emit(SystemEventTypes.TASK_RETRY, {
      taskId,
      attempt: retryCount + 1,
      maxAttempts: maxRetries,
      error: task.error,
    });
  }

  getMetrics(): TaskManagerMetrics {
    const pendingTasks = this.getTasks({ status: 'pending' }).length;
    const runningTasks = this.getTasks({ status: 'running' }).length;

    return {
      totalTasks: this.metrics.totalTasks,
      pendingTasks,
      runningTasks,
      completedTasks: this.metrics.completedTasks,
      failedTasks: this.metrics.failedTasks,
      cancelledTasks: this.metrics.cancelledTasks,
      avgDuration: this.metrics.completedTasks > 0
        ? this.metrics.totalDuration / this.metrics.completedTasks
        : 0,
      avgWaitTime: this.metrics.completedTasks > 0
        ? this.metrics.totalWaitTime / this.metrics.completedTasks
        : 0,
    };
  }

  async cleanup(olderThan: Date): Promise<number> {
    let cleaned = 0;
    const cutoffTime = olderThan.getTime();

    for (const [taskId, task] of this.tasks.entries()) {
      if (task.completedAt && task.completedAt.getTime() < cutoffTime) {
        this.tasks.delete(taskId);
        cleaned++;
      }
    }

    return cleaned;
  }

  private isRetryable(task: ITask): boolean {
    const retryCount = (task.metadata?.retryCount as number) ?? 0;
    const maxRetries = (task.metadata?.maxRetries as number) ?? 3;
    return retryCount < maxRetries;
  }

  /**
   * Get the task queue
   */
  getQueue(): ITaskQueue {
    return this.queue;
  }
}
