/**
 * Task Domain Entity
 *
 * Represents a task to be executed by agents in the V3 system
 */

import type {
  Task as ITask,
  TaskPriority,
  TaskStatus,
  TaskType,
  WorkflowDefinition
} from '../../shared/types';

export class Task implements ITask {
  public readonly id: string;
  public readonly type: TaskType;
  public description: string;
  public priority: TaskPriority;
  public status: TaskStatus;
  public assignedTo?: string;
  public dependencies: string[];
  public metadata?: Record<string, unknown>;
  public workflow?: WorkflowDefinition;
  public onExecute?: () => void | Promise<void>;
  public onRollback?: () => void | Promise<void>;

  private startedAt?: number;
  private completedAt?: number;

  constructor(config: ITask) {
    this.id = config.id;
    this.type = config.type;
    this.description = config.description;
    this.priority = config.priority;
    this.status = config.status || 'pending';
    this.assignedTo = config.assignedTo;
    this.dependencies = config.dependencies || [];
    this.metadata = config.metadata || {};
    this.workflow = config.workflow;
    this.onExecute = config.onExecute;
    this.onRollback = config.onRollback;
  }

  /**
   * Check if task has all dependencies resolved
   */
  areDependenciesResolved(completedTasks: Set<string>): boolean {
    return this.dependencies.every(dep => completedTasks.has(dep));
  }

  /**
   * Mark task as started
   */
  start(): void {
    if (this.status === 'pending') {
      this.status = 'in-progress';
      this.startedAt = Date.now();
    }
  }

  /**
   * Mark task as completed
   */
  complete(): void {
    if (this.status === 'in-progress') {
      this.status = 'completed';
      this.completedAt = Date.now();
    }
  }

  /**
   * Mark task as failed
   */
  fail(error?: string): void {
    this.status = 'failed';
    this.completedAt = Date.now();
    if (error && this.metadata) {
      this.metadata.error = error;
    }
  }

  /**
   * Cancel the task
   */
  cancel(): void {
    if (this.status !== 'completed' && this.status !== 'failed') {
      this.status = 'cancelled';
      this.completedAt = Date.now();
    }
  }

  /**
   * Get task duration
   */
  getDuration(): number | undefined {
    if (this.startedAt && this.completedAt) {
      return this.completedAt - this.startedAt;
    }
    if (this.startedAt) {
      return Date.now() - this.startedAt;
    }
    return undefined;
  }

  /**
   * Check if task is a nested workflow
   */
  isWorkflow(): boolean {
    return this.type === 'workflow' && this.workflow !== undefined;
  }

  /**
   * Assign task to an agent
   */
  assignTo(agentId: string): void {
    this.assignedTo = agentId;
  }

  /**
   * Get priority as numeric value for sorting
   */
  getPriorityValue(): number {
    const values: Record<TaskPriority, number> = {
      high: 3,
      medium: 2,
      low: 1
    };
    return values[this.priority] || 2;
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON(): ITask {
    return {
      id: this.id,
      type: this.type,
      description: this.description,
      priority: this.priority,
      status: this.status,
      assignedTo: this.assignedTo,
      dependencies: this.dependencies,
      metadata: {
        ...this.metadata,
        startedAt: this.startedAt,
        completedAt: this.completedAt,
        duration: this.getDuration()
      },
      workflow: this.workflow
    };
  }

  /**
   * Create task from config
   */
  static fromConfig(config: ITask): Task {
    return new Task(config);
  }

  /**
   * Sort tasks by priority (high to low)
   */
  static sortByPriority(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => b.getPriorityValue() - a.getPriorityValue());
  }

  /**
   * Resolve task execution order based on dependencies
   */
  static resolveExecutionOrder(tasks: Task[]): Task[] {
    const resolved: Task[] = [];
    const resolvedIds = new Set<string>();
    const remaining = [...tasks];

    // Topological sort
    while (remaining.length > 0) {
      const ready = remaining.filter(task =>
        task.areDependenciesResolved(resolvedIds)
      );

      if (ready.length === 0 && remaining.length > 0) {
        throw new Error('Circular dependency detected in tasks');
      }

      // Sort ready tasks by priority
      const sorted = Task.sortByPriority(ready);

      for (const task of sorted) {
        resolved.push(task);
        resolvedIds.add(task.id);
        const index = remaining.indexOf(task);
        if (index > -1) {
          remaining.splice(index, 1);
        }
      }
    }

    return resolved;
  }
}

export { Task as default };
