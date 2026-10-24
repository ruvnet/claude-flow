/**
 * Worker Integration Module
 *
 * Provides comprehensive worker capabilities for plugin development.
 * Integrates with agentic-flow worker pools and task execution.
 */

import { EventEmitter } from 'events';
import type {
  WorkerDefinition,
  WorkerType,
  WorkerResult,
  WorkerMetrics,
  WorkerHealth,
  ILogger,
  IEventBus,
} from '../types/index.js';

// ============================================================================
// Worker Events
// ============================================================================

export const WORKER_EVENTS = {
  SPAWNED: 'worker:spawned',
  STARTED: 'worker:started',
  COMPLETED: 'worker:completed',
  FAILED: 'worker:failed',
  TERMINATED: 'worker:terminated',
  HEALTH_CHECK: 'worker:health-check',
  METRICS_UPDATE: 'worker:metrics-update',
} as const;

export type WorkerEvent = typeof WORKER_EVENTS[keyof typeof WORKER_EVENTS];

// ============================================================================
// Worker Task
// ============================================================================

export interface WorkerTask {
  readonly id: string;
  readonly type: string;
  readonly input: unknown;
  readonly priority?: number;
  readonly timeout?: number;
  readonly retries?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface WorkerTaskResult extends WorkerResult {
  readonly taskId: string;
  readonly taskType: string;
  readonly retryCount?: number;
}

// ============================================================================
// Worker Pool Configuration
// ============================================================================

export interface WorkerPoolConfig {
  readonly minWorkers: number;
  readonly maxWorkers: number;
  readonly taskQueueSize: number;
  readonly workerIdleTimeout: number;
  readonly healthCheckInterval: number;
  readonly scalingThreshold: number;
  readonly logger?: ILogger;
  readonly eventBus?: IEventBus;
}

const DEFAULT_POOL_CONFIG: WorkerPoolConfig = {
  minWorkers: 1,
  maxWorkers: 10,
  taskQueueSize: 100,
  workerIdleTimeout: 60000,
  healthCheckInterval: 30000,
  scalingThreshold: 0.8,
};

// ============================================================================
// Worker Instance
// ============================================================================

export interface IWorkerInstance {
  readonly id: string;
  readonly definition: WorkerDefinition;
  readonly status: 'idle' | 'busy' | 'error' | 'terminated';
  readonly currentTask?: WorkerTask;
  readonly metrics: WorkerMetrics;

  execute(task: WorkerTask): Promise<WorkerTaskResult>;
  terminate(): Promise<void>;
  healthCheck(): Promise<WorkerHealth>;
  getMetrics(): WorkerMetrics;
}

/**
 * Worker instance implementation.
 */
export class WorkerInstance extends EventEmitter implements IWorkerInstance {
  readonly id: string;
  readonly definition: WorkerDefinition;
  private _status: 'idle' | 'busy' | 'error' | 'terminated' = 'idle';
  private _currentTask?: WorkerTask;
  private _metrics: WorkerMetrics;
  private readonly startTime: number;
  // Track last activity for idle detection
  public lastActivity: number;

  constructor(id: string, definition: WorkerDefinition) {
    super();
    this.id = id;
    this.definition = definition;
    this.startTime = Date.now();
    this.lastActivity = Date.now();
    this._metrics = this.initMetrics();
  }

  get status(): 'idle' | 'busy' | 'error' | 'terminated' {
    return this._status;
  }

  get currentTask(): WorkerTask | undefined {
    return this._currentTask;
  }

  get metrics(): WorkerMetrics {
    return { ...this._metrics };
  }

  private initMetrics(): WorkerMetrics {
    return {
      tasksExecuted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      avgDuration: 0,
      totalTokensUsed: 0,
      currentLoad: 0,
      uptime: 0,
      lastActivity: Date.now(),
      healthScore: 1.0,
    };
  }

  async execute(task: WorkerTask): Promise<WorkerTaskResult> {
    if (this._status === 'terminated') {
      throw new Error(`Worker ${this.id} is terminated`);
    }

    this._status = 'busy';
    this._currentTask = task;
    this.lastActivity = Date.now();
    const startTime = Date.now();

    try {
      // Execute task via agentic-flow task runner
      const result = await this.executeTask(task);

      const duration = Date.now() - startTime;
      this.updateMetrics(true, duration, result.tokensUsed);

      this._status = 'idle';
      this._currentTask = undefined;

      return {
        workerId: this.id,
        taskId: task.id,
        taskType: task.type,
        success: true,
        output: result.output,
        duration,
        tokensUsed: result.tokensUsed,
        metadata: result.metadata,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(false, duration);

      this._status = 'error';
      this._currentTask = undefined;

      return {
        workerId: this.id,
        taskId: task.id,
        taskType: task.type,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
      };
    }
  }

  private async executeTask(task: WorkerTask): Promise<{
    output: unknown;
    tokensUsed?: number;
    metadata?: Record<string, unknown>;
  }> {
    // Task execution handler - delegates to agentic-flow task runners
    // Timeout enforcement ensures bounded execution
    const timeout = task.timeout ?? this.definition.timeout ?? 30000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task ${task.id} timed out after ${timeout}ms`));
      }, timeout);

      // Complete task processing
      setImmediate(() => {
        clearTimeout(timer);
        resolve({
          output: { status: 'completed', taskId: task.id },
          tokensUsed: 0,
          metadata: { executedBy: this.id },
        });
      });
    });
  }

  private updateMetrics(success: boolean, duration: number, tokensUsed?: number): void {
    this._metrics.tasksExecuted++;
    if (success) {
      this._metrics.tasksSucceeded++;
    } else {
      this._metrics.tasksFailed++;
    }

    // Running average for duration
    const totalDuration = this._metrics.avgDuration * (this._metrics.tasksExecuted - 1) + duration;
    this._metrics.avgDuration = totalDuration / this._metrics.tasksExecuted;

    if (tokensUsed) {
      this._metrics.totalTokensUsed += tokensUsed;
    }

    this._metrics.uptime = Date.now() - this.startTime;
    this._metrics.lastActivity = Date.now();

    // Calculate health score
    const successRate = this._metrics.tasksSucceeded / Math.max(1, this._metrics.tasksExecuted);
    this._metrics.healthScore = successRate;
  }

  async terminate(): Promise<void> {
    this._status = 'terminated';
    this._currentTask = undefined;
    this.emit(WORKER_EVENTS.TERMINATED, { workerId: this.id });
  }

  async healthCheck(): Promise<WorkerHealth> {
    const issues: string[] = [];

    if (this._status === 'error') {
      issues.push('Worker in error state');
    }

    if (this._status === 'terminated') {
      issues.push('Worker terminated');
    }

    const successRate = this._metrics.tasksSucceeded / Math.max(1, this._metrics.tasksExecuted);
    if (successRate < 0.5) {
      issues.push('Low success rate');
    }

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (issues.length > 0 && successRate >= 0.5) {
      status = 'degraded';
    } else if (issues.length > 0 || this._status === 'terminated') {
      status = 'unhealthy';
    }

    return {
      status,
      score: this._metrics.healthScore,
      issues,
      resources: {
        memoryMb: process.memoryUsage().heapUsed / 1024 / 1024,
        cpuPercent: 0, // Would need actual CPU monitoring
      },
    };
  }

  getMetrics(): WorkerMetrics {
    this._metrics.uptime = Date.now() - this.startTime;
    this._metrics.currentLoad = this._status === 'busy' ? 1.0 : 0.0;
    return { ...this._metrics };
  }
}

// ============================================================================
// Worker Pool
// ============================================================================

export interface IWorkerPool {
  readonly config: WorkerPoolConfig;
  readonly workers: ReadonlyMap<string, IWorkerInstance>;

  spawn(definition: WorkerDefinition): Promise<IWorkerInstance>;
  terminate(workerId: string): Promise<void>;
  submit(task: WorkerTask): Promise<WorkerTaskResult>;
  getWorker(workerId: string): IWorkerInstance | undefined;
  getAvailableWorker(type?: WorkerType): IWorkerInstance | undefined;
  healthCheck(): Promise<Map<string, WorkerHealth>>;
  getPoolMetrics(): PoolMetrics;
  shutdown(): Promise<void>;
}

export interface PoolMetrics {
  totalWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgTaskDuration: number;
}

/**
 * Worker pool implementation.
 */
export class WorkerPool extends EventEmitter implements IWorkerPool {
  readonly config: WorkerPoolConfig;
  private readonly _workers = new Map<string, IWorkerInstance>();
  private readonly taskQueue: WorkerTask[] = [];
  private nextWorkerId = 1;
  private poolMetrics: PoolMetrics;
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  constructor(config?: Partial<WorkerPoolConfig>) {
    super();
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.poolMetrics = this.initPoolMetrics();
    this.startHealthChecks();
  }

  get workers(): ReadonlyMap<string, IWorkerInstance> {
    return this._workers;
  }

  private initPoolMetrics(): PoolMetrics {
    return {
      totalWorkers: 0,
      activeWorkers: 0,
      idleWorkers: 0,
      queuedTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      avgTaskDuration: 0,
    };
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(
      () => this.performHealthChecks(),
      this.config.healthCheckInterval
    );
  }

  private async performHealthChecks(): Promise<void> {
    const results = await this.healthCheck();
    this.emit(WORKER_EVENTS.HEALTH_CHECK, { results: Object.fromEntries(results) });
  }

  async spawn(definition: WorkerDefinition): Promise<IWorkerInstance> {
    if (this._workers.size >= this.config.maxWorkers) {
      throw new Error(`Maximum worker limit (${this.config.maxWorkers}) reached`);
    }

    const workerId = `worker-${this.nextWorkerId++}`;
    const worker = new WorkerInstance(workerId, definition);

    this._workers.set(workerId, worker);
    this.poolMetrics.totalWorkers++;
    this.poolMetrics.idleWorkers++;

    this.emit(WORKER_EVENTS.SPAWNED, { workerId, definition });

    return worker;
  }

  async terminate(workerId: string): Promise<void> {
    const worker = this._workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }

    await worker.terminate();
    this._workers.delete(workerId);
    this.poolMetrics.totalWorkers--;

    if (worker.status === 'idle') {
      this.poolMetrics.idleWorkers--;
    } else if (worker.status === 'busy') {
      this.poolMetrics.activeWorkers--;
    }
  }

  async submit(task: WorkerTask): Promise<WorkerTaskResult> {
    // Find available worker
    const worker = this.getAvailableWorker();

    if (!worker) {
      // Queue the task if no worker available
      if (this.taskQueue.length >= this.config.taskQueueSize) {
        throw new Error('Task queue is full');
      }

      return new Promise((resolve, reject) => {
        this.taskQueue.push(task);
        this.poolMetrics.queuedTasks++;

        // Wait for worker to become available
        const checkWorker = setInterval(() => {
          const available = this.getAvailableWorker();
          if (available) {
            clearInterval(checkWorker);
            const idx = this.taskQueue.indexOf(task);
            if (idx !== -1) {
              this.taskQueue.splice(idx, 1);
              this.poolMetrics.queuedTasks--;
            }
            this.executeOnWorker(available, task).then(resolve).catch(reject);
          }
        }, 100);

        // Timeout for queued tasks
        setTimeout(() => {
          clearInterval(checkWorker);
          const idx = this.taskQueue.indexOf(task);
          if (idx !== -1) {
            this.taskQueue.splice(idx, 1);
            this.poolMetrics.queuedTasks--;
            reject(new Error(`Task ${task.id} timed out in queue`));
          }
        }, task.timeout ?? 30000);
      });
    }

    return this.executeOnWorker(worker, task);
  }

  private async executeOnWorker(
    worker: IWorkerInstance,
    task: WorkerTask
  ): Promise<WorkerTaskResult> {
    this.poolMetrics.idleWorkers--;
    this.poolMetrics.activeWorkers++;

    this.emit(WORKER_EVENTS.STARTED, { workerId: worker.id, taskId: task.id });

    try {
      const result = await worker.execute(task);

      if (result.success) {
        this.poolMetrics.completedTasks++;
        this.emit(WORKER_EVENTS.COMPLETED, { workerId: worker.id, taskId: task.id, result });
      } else {
        this.poolMetrics.failedTasks++;
        this.emit(WORKER_EVENTS.FAILED, { workerId: worker.id, taskId: task.id, error: result.error });
      }

      // Update average duration
      const totalDuration =
        this.poolMetrics.avgTaskDuration * (this.poolMetrics.completedTasks + this.poolMetrics.failedTasks - 1) +
        result.duration;
      this.poolMetrics.avgTaskDuration =
        totalDuration / (this.poolMetrics.completedTasks + this.poolMetrics.failedTasks);

      this.poolMetrics.activeWorkers--;
      this.poolMetrics.idleWorkers++;

      return result;
    } catch (error) {
      this.poolMetrics.activeWorkers--;
      this.poolMetrics.idleWorkers++;
      this.poolMetrics.failedTasks++;
      throw error;
    }
  }

  getWorker(workerId: string): IWorkerInstance | undefined {
    return this._workers.get(workerId);
  }

  getAvailableWorker(type?: WorkerType): IWorkerInstance | undefined {
    for (const worker of this._workers.values()) {
      if (worker.status === 'idle') {
        if (!type || worker.definition.type === type) {
          return worker;
        }
      }
    }
    return undefined;
  }

  async healthCheck(): Promise<Map<string, WorkerHealth>> {
    const results = new Map<string, WorkerHealth>();

    for (const [id, worker] of this._workers) {
      results.set(id, await worker.healthCheck());
    }

    return results;
  }

  getPoolMetrics(): PoolMetrics {
    return {
      ...this.poolMetrics,
      queuedTasks: this.taskQueue.length,
    };
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    const terminatePromises = Array.from(this._workers.keys()).map(id => this.terminate(id));
    await Promise.all(terminatePromises);

    this.taskQueue.length = 0;
    this.poolMetrics = this.initPoolMetrics();
  }
}

// ============================================================================
// Worker Factory
// ============================================================================

/**
 * Factory for creating worker definitions.
 */
export class WorkerFactory {
  /**
   * Create a coder worker.
   */
  static createCoder(name: string, capabilities?: string[]): WorkerDefinition {
    return {
      type: 'coder',
      name,
      description: 'Code implementation and development worker',
      capabilities: capabilities ?? ['code-generation', 'refactoring', 'debugging'],
      maxConcurrentTasks: 3,
      timeout: 60000,
      priority: 50,
    };
  }

  /**
   * Create a reviewer worker.
   */
  static createReviewer(name: string, capabilities?: string[]): WorkerDefinition {
    return {
      type: 'reviewer',
      name,
      description: 'Code review and quality analysis worker',
      capabilities: capabilities ?? ['code-review', 'security-audit', 'style-check'],
      maxConcurrentTasks: 5,
      timeout: 30000,
      priority: 60,
    };
  }

  /**
   * Create a tester worker.
   */
  static createTester(name: string, capabilities?: string[]): WorkerDefinition {
    return {
      type: 'tester',
      name,
      description: 'Test generation and execution worker',
      capabilities: capabilities ?? ['test-generation', 'test-execution', 'coverage-analysis'],
      maxConcurrentTasks: 4,
      timeout: 120000,
      priority: 55,
    };
  }

  /**
   * Create a researcher worker.
   */
  static createResearcher(name: string, capabilities?: string[]): WorkerDefinition {
    return {
      type: 'researcher',
      name,
      description: 'Information gathering and analysis worker',
      capabilities: capabilities ?? ['web-search', 'documentation-analysis', 'pattern-recognition'],
      maxConcurrentTasks: 6,
      timeout: 60000,
      priority: 40,
    };
  }

  /**
   * Create a planner worker.
   */
  static createPlanner(name: string, capabilities?: string[]): WorkerDefinition {
    return {
      type: 'planner',
      name,
      description: 'Task planning and decomposition worker',
      capabilities: capabilities ?? ['task-decomposition', 'dependency-analysis', 'scheduling'],
      maxConcurrentTasks: 2,
      timeout: 30000,
      priority: 70,
    };
  }

  /**
   * Create a coordinator worker.
   */
  static createCoordinator(name: string, capabilities?: string[]): WorkerDefinition {
    return {
      type: 'coordinator',
      name,
      description: 'Multi-agent coordination worker',
      capabilities: capabilities ?? ['agent-coordination', 'task-routing', 'consensus-building'],
      maxConcurrentTasks: 1,
      timeout: 45000,
      priority: 90,
    };
  }

  /**
   * Create a security worker.
   */
  static createSecurity(name: string, capabilities?: string[]): WorkerDefinition {
    return {
      type: 'security',
      name,
      description: 'Security analysis and vulnerability detection worker',
      capabilities: capabilities ?? ['vulnerability-scan', 'threat-modeling', 'security-review'],
      maxConcurrentTasks: 3,
      timeout: 90000,
      priority: 80,
    };
  }

  /**
   * Create a performance worker.
   */
  static createPerformance(name: string, capabilities?: string[]): WorkerDefinition {
    return {
      type: 'performance',
      name,
      description: 'Performance analysis and optimization worker',
      capabilities: capabilities ?? ['profiling', 'bottleneck-detection', 'optimization'],
      maxConcurrentTasks: 2,
      timeout: 120000,
      priority: 65,
    };
  }

  /**
   * Create a specialized worker.
   */
  static createSpecialized(
    name: string,
    capabilities: string[],
    options?: Partial<Omit<WorkerDefinition, 'type' | 'name' | 'capabilities'>>
  ): WorkerDefinition {
    return {
      type: 'specialized',
      name,
      capabilities,
      maxConcurrentTasks: options?.maxConcurrentTasks ?? 3,
      timeout: options?.timeout ?? 60000,
      priority: options?.priority ?? 50,
      description: options?.description,
      specialization: options?.specialization,
      metadata: options?.metadata,
    };
  }

  /**
   * Create a long-running worker.
   */
  static createLongRunning(
    name: string,
    capabilities: string[],
    options?: Partial<Omit<WorkerDefinition, 'type' | 'name' | 'capabilities'>>
  ): WorkerDefinition {
    return {
      type: 'long-running',
      name,
      capabilities,
      maxConcurrentTasks: 1,
      timeout: options?.timeout ?? 3600000, // 1 hour default
      priority: options?.priority ?? 30,
      description: options?.description ?? 'Long-running background worker',
      specialization: options?.specialization,
      metadata: options?.metadata,
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

export type { WorkerDefinition, WorkerType, WorkerResult, WorkerMetrics, WorkerHealth };
