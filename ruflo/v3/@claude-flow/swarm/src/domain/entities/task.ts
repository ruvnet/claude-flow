/**
 * Task Entity - Domain Layer
 *
 * Core domain entity representing a task in the swarm.
 * Tasks are units of work assigned to agents.
 *
 * @module v3/swarm/domain/entities
 */

import { randomUUID } from 'crypto';

/**
 * Task status types
 */
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Task priority levels
 */
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Task properties
 */
export interface TaskProps {
  id?: string;
  title: string;
  description: string;
  type: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  assignedAgentId?: string;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  error?: string;
  retryCount?: number;
  maxRetries?: number;
  timeout?: number;
  createdAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Task - Entity
 *
 * Represents a unit of work with lifecycle management,
 * dependency tracking, and result storage.
 */
export class Task {
  private _id: string;
  private _title: string;
  private _description: string;
  private _type: string;
  private _priority: TaskPriority;
  private _status: TaskStatus;
  private _assignedAgentId?: string;
  private _dependencies: Set<string>;
  private _metadata: Record<string, unknown>;
  private _input?: unknown;
  private _output?: unknown;
  private _error?: string;
  private _retryCount: number;
  private _maxRetries: number;
  private _timeout: number;
  private _createdAt: Date;
  private _startedAt?: Date;
  private _completedAt?: Date;

  private constructor(props: TaskProps) {
    const now = new Date();
    this._id = props.id ?? randomUUID();
    this._title = props.title;
    this._description = props.description;
    this._type = props.type;
    this._priority = props.priority ?? 'normal';
    this._status = props.status ?? 'pending';
    this._assignedAgentId = props.assignedAgentId;
    this._dependencies = new Set(props.dependencies ?? []);
    this._metadata = props.metadata ?? {};
    this._input = props.input;
    this._output = props.output;
    this._error = props.error;
    this._retryCount = props.retryCount ?? 0;
    this._maxRetries = props.maxRetries ?? 3;
    this._timeout = props.timeout ?? 300000; // 5 minutes default
    this._createdAt = props.createdAt ?? now;
    this._startedAt = props.startedAt;
    this._completedAt = props.completedAt;
  }

  static create(props: TaskProps): Task {
    return new Task(props);
  }

  static fromPersistence(props: TaskProps): Task {
    return new Task(props);
  }

  // Getters
  get id(): string {
    return this._id;
  }
  get title(): string {
    return this._title;
  }
  get description(): string {
    return this._description;
  }
  get type(): string {
    return this._type;
  }
  get priority(): TaskPriority {
    return this._priority;
  }
  get status(): TaskStatus {
    return this._status;
  }
  get assignedAgentId(): string | undefined {
    return this._assignedAgentId;
  }
  get dependencies(): string[] {
    return Array.from(this._dependencies);
  }
  get metadata(): Record<string, unknown> {
    return { ...this._metadata };
  }
  get input(): unknown {
    return this._input;
  }
  get output(): unknown {
    return this._output;
  }
  get error(): string | undefined {
    return this._error;
  }
  get retryCount(): number {
    return this._retryCount;
  }
  get maxRetries(): number {
    return this._maxRetries;
  }
  get timeout(): number {
    return this._timeout;
  }
  get createdAt(): Date {
    return new Date(this._createdAt);
  }
  get startedAt(): Date | undefined {
    return this._startedAt ? new Date(this._startedAt) : undefined;
  }
  get completedAt(): Date | undefined {
    return this._completedAt ? new Date(this._completedAt) : undefined;
  }

  // ============================================================================
  // Business Logic
  // ============================================================================

  /**
   * Queue the task for execution
   */
  queue(): void {
    if (this._status !== 'pending') {
      throw new Error('Can only queue pending tasks');
    }
    this._status = 'queued';
  }

  /**
   * Assign task to an agent
   */
  assign(agentId: string): void {
    if (this._status !== 'queued' && this._status !== 'pending') {
      throw new Error('Can only assign queued or pending tasks');
    }
    this._assignedAgentId = agentId;
    this._status = 'assigned';
  }

  /**
   * Start task execution
   */
  start(): void {
    if (this._status !== 'assigned') {
      throw new Error('Can only start assigned tasks');
    }
    this._status = 'running';
    this._startedAt = new Date();
  }

  /**
   * Complete the task successfully
   */
  complete(output?: unknown): void {
    if (this._status !== 'running') {
      throw new Error('Can only complete running tasks');
    }
    this._status = 'completed';
    this._output = output;
    this._completedAt = new Date();
  }

  /**
   * Mark task as failed
   */
  fail(error: string): void {
    if (this._status !== 'running' && this._status !== 'assigned') {
      throw new Error('Can only fail running or assigned tasks');
    }
    this._error = error;
    this._retryCount++;

    if (this._retryCount >= this._maxRetries) {
      this._status = 'failed';
      this._completedAt = new Date();
    } else {
      // Reset for retry
      this._status = 'queued';
      this._assignedAgentId = undefined;
    }
  }

  /**
   * Cancel the task
   */
  cancel(): void {
    if (this._status === 'completed' || this._status === 'failed') {
      throw new Error('Cannot cancel finished tasks');
    }
    this._status = 'cancelled';
    this._completedAt = new Date();
  }

  /**
   * Check if all dependencies are satisfied
   */
  areDependenciesSatisfied(completedTaskIds: Set<string>): boolean {
    for (const depId of this._dependencies) {
      if (!completedTaskIds.has(depId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if task can be retried
   */
  canRetry(): boolean {
    return this._retryCount < this._maxRetries;
  }

  /**
   * Get execution duration in milliseconds
   */
  getExecutionDuration(): number | null {
    if (!this._startedAt) return null;
    const endTime = this._completedAt ?? new Date();
    return endTime.getTime() - this._startedAt.getTime();
  }

  /**
   * Check if task is timed out
   */
  isTimedOut(): boolean {
    if (this._status !== 'running' || !this._startedAt) return false;
    return Date.now() - this._startedAt.getTime() > this._timeout;
  }

  /**
   * Priority comparison (for sorting)
   */
  comparePriority(other: Task): number {
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
    };
    return priorityOrder[this._priority] - priorityOrder[other.priority];
  }

  toPersistence(): Record<string, unknown> {
    return {
      id: this._id,
      title: this._title,
      description: this._description,
      type: this._type,
      priority: this._priority,
      status: this._status,
      assignedAgentId: this._assignedAgentId,
      dependencies: Array.from(this._dependencies),
      metadata: this._metadata,
      input: this._input,
      output: this._output,
      error: this._error,
      retryCount: this._retryCount,
      maxRetries: this._maxRetries,
      timeout: this._timeout,
      createdAt: this._createdAt.toISOString(),
      startedAt: this._startedAt?.toISOString(),
      completedAt: this._completedAt?.toISOString(),
    };
  }

  toJSON(): Record<string, unknown> {
    return this.toPersistence();
  }
}
