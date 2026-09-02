/**
 * V3 Task Interfaces
 * Domain-Driven Design - Task Bounded Context
 */

/**
 * Task priority levels
 */
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Task status throughout its lifecycle
 */
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/**
 * Core task entity
 */
export interface ITask {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly priority: number;
  readonly createdAt: Date;

  status: TaskStatus;
  assignedAgent?: string;
  startedAt?: Date;
  completedAt?: Date;
  timeout?: number;

  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Error;

  metadata?: {
    requiredCapabilities?: string[];
    retryCount?: number;
    maxRetries?: number;
    critical?: boolean;
    parentTaskId?: string;
    childTaskIds?: string[];
    tags?: string[];
    [key: string]: unknown;
  };
}

/**
 * Task creation parameters
 */
export interface ITaskCreate {
  type: string;
  description: string;
  priority?: number;
  timeout?: number;
  assignedAgent?: string;
  input?: Record<string, unknown>;
  metadata?: ITask['metadata'];
}

/**
 * Task result after completion
 */
export interface ITaskResult {
  taskId: string;
  success: boolean;
  output?: Record<string, unknown>;
  error?: Error;
  duration: number;
  agentId?: string;
  metrics?: {
    tokensUsed?: number;
    memoryPeakMb?: number;
    retryCount?: number;
  };
}

/**
 * Task queue interface for managing task ordering and processing
 */
export interface ITaskQueue {
  /**
   * Add a task to the queue
   */
  enqueue(task: ITask): Promise<void>;

  /**
   * Remove and return the highest priority task
   */
  dequeue(): Promise<ITask | undefined>;

  /**
   * Peek at the next task without removing it
   */
  peek(): Promise<ITask | undefined>;

  /**
   * Get the current queue size
   */
  size(): number;

  /**
   * Check if the queue is empty
   */
  isEmpty(): boolean;

  /**
   * Clear all tasks from the queue
   */
  clear(): Promise<void>;

  /**
   * Get all queued tasks (for inspection)
   */
  getAll(): Promise<ITask[]>;

  /**
   * Remove a specific task by ID
   */
  remove(taskId: string): Promise<boolean>;

  /**
   * Update task priority
   */
  updatePriority(taskId: string, priority: number): Promise<boolean>;
}

/**
 * Task manager interface for lifecycle management
 */
export interface ITaskManager {
  /**
   * Create a new task
   */
  createTask(params: ITaskCreate): Promise<ITask>;

  /**
   * Get a task by ID
   */
  getTask(taskId: string): ITask | undefined;

  /**
   * Get all tasks matching optional filter
   */
  getTasks(filter?: Partial<Pick<ITask, 'status' | 'type' | 'assignedAgent'>>): ITask[];

  /**
   * Assign a task to an agent
   */
  assignTask(taskId: string, agentId: string): Promise<void>;

  /**
   * Start task execution
   */
  startTask(taskId: string): Promise<void>;

  /**
   * Complete a task with result
   */
  completeTask(taskId: string, result: ITaskResult): Promise<void>;

  /**
   * Fail a task with error
   */
  failTask(taskId: string, error: Error): Promise<void>;

  /**
   * Cancel a task
   */
  cancelTask(taskId: string, reason?: string): Promise<void>;

  /**
   * Retry a failed task
   */
  retryTask(taskId: string): Promise<void>;

  /**
   * Get task metrics
   */
  getMetrics(): TaskManagerMetrics;

  /**
   * Clean up old completed/failed tasks
   */
  cleanup(olderThan: Date): Promise<number>;
}

/**
 * Task manager metrics
 */
export interface TaskManagerMetrics {
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  avgDuration: number;
  avgWaitTime: number;
}

/**
 * Task assignment strategy interface
 */
export interface ITaskAssignmentStrategy {
  /**
   * Select the best agent for a task
   */
  selectAgent(task: ITask, availableAgents: string[]): Promise<string | undefined>;

  /**
   * Score an agent for a task (higher is better)
   */
  scoreAgent(task: ITask, agentId: string): Promise<number>;
}
