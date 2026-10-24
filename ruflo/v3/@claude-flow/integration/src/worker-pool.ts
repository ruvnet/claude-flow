/**
 * WorkerPool - Worker Pool Management
 *
 * Manages a collection of workers with intelligent routing,
 * load balancing, and lifecycle management.
 *
 * Features:
 * - Dynamic worker spawning and termination
 * - Embedding-based task routing
 * - Load balancing across workers
 * - Health monitoring and auto-recovery
 * - Type-safe worker registry
 *
 * Compatible with agentic-flow's worker pool patterns.
 *
 * @module v3/integration/worker-pool
 * @version 3.0.0-alpha.1
 */

import { EventEmitter } from 'events';
import {
  WorkerBase,
  WorkerConfig,
  WorkerType,
  WorkerMetrics,
  WorkerHealth,
} from './worker-base.js';
import { SpecializedWorker, SpecializedWorkerConfig } from './specialized-worker.js';
import { LongRunningWorker, LongRunningWorkerConfig } from './long-running-worker.js';
import type { Task, TaskResult } from './agentic-flow-agent.js';

/**
 * Worker pool configuration
 */
export interface WorkerPoolConfig {
  /** Pool identifier */
  id?: string;
  /** Pool name */
  name?: string;
  /** Minimum workers to maintain */
  minWorkers?: number;
  /** Maximum workers allowed */
  maxWorkers?: number;
  /** Default worker configuration */
  defaultWorkerConfig?: Partial<WorkerConfig>;
  /** Enable auto-scaling */
  autoScale?: boolean;
  /** Scale up threshold (0.0-1.0 utilization) */
  scaleUpThreshold?: number;
  /** Scale down threshold (0.0-1.0 utilization) */
  scaleDownThreshold?: number;
  /** Health check interval in milliseconds */
  healthCheckInterval?: number;
  /** Enable automatic health recovery */
  autoRecover?: boolean;
  /** Routing strategy */
  routingStrategy?: RoutingStrategy;
  /** Load balancing strategy */
  loadBalancingStrategy?: LoadBalancingStrategy;
}

/**
 * Task routing strategy
 */
export type RoutingStrategy =
  | 'round-robin'
  | 'least-loaded'
  | 'capability-match'
  | 'embedding-similarity'
  | 'priority-based'
  | 'hybrid'
  | 'custom';

/**
 * Load balancing strategy
 */
export type LoadBalancingStrategy =
  | 'equal'
  | 'weighted'
  | 'adaptive'
  | 'capacity-based';

/**
 * Worker routing result
 */
export interface RoutingResult {
  /** Selected workers */
  workers: WorkerBase[];
  /** Routing scores for each worker */
  scores: Map<string, number>;
  /** Routing strategy used */
  strategy: RoutingStrategy;
  /** Routing metadata */
  metadata: {
    totalCandidates: number;
    filtered: number;
    matchThreshold: number;
  };
}

/**
 * Pool statistics
 */
export interface PoolStats {
  /** Pool identifier */
  poolId: string;
  /** Total workers */
  totalWorkers: number;
  /** Available workers */
  availableWorkers: number;
  /** Busy workers */
  busyWorkers: number;
  /** Unhealthy workers */
  unhealthyWorkers: number;
  /** Average utilization */
  avgUtilization: number;
  /** Average health score */
  avgHealthScore: number;
  /** Tasks processed */
  tasksProcessed: number;
  /** Tasks failed */
  tasksFailed: number;
  /** Average task duration */
  avgTaskDuration: number;
  /** Worker types breakdown */
  workerTypes: Record<WorkerType, number>;
  /** Uptime in milliseconds */
  uptime: number;
}

/**
 * Worker spawn options
 */
export interface SpawnOptions {
  /** Immediately initialize the worker */
  initialize?: boolean;
  /** Replace existing worker with same ID */
  replace?: boolean;
  /** Worker priority in pool */
  poolPriority?: number;
}

/**
 * WorkerPool - Manages a collection of workers
 *
 * Usage:
 * ```typescript
 * const pool = new WorkerPool({
 *   name: 'main-pool',
 *   minWorkers: 2,
 *   maxWorkers: 10,
 *   autoScale: true,
 *   routingStrategy: 'embedding-similarity',
 * });
 *
 * await pool.initialize();
 *
 * // Spawn workers
 * pool.spawn({
 *   id: 'coder-1',
 *   type: 'coder',
 *   capabilities: ['typescript', 'code-generation'],
 * });
 *
 * // Route a task
 * const workers = pool.routeTask(task, 3);
 * for (const worker of workers) {
 *   const result = await worker.executeTask(task);
 * }
 * ```
 */
export class WorkerPool extends EventEmitter {
  /** Pool identifier */
  readonly id: string;

  /** Pool name */
  readonly name: string;

  /** Worker registry */
  workers: Map<string, WorkerBase>;

  /** Pool configuration */
  protected config: WorkerPoolConfig;

  /** Pool initialized state */
  protected initialized: boolean = false;

  /** Health check timer */
  private healthCheckTimer: NodeJS.Timeout | null = null;

  /** Pool creation time */
  private createdAt: number;

  /** Round-robin index */
  private roundRobinIndex: number = 0;

  /** Pool-level metrics */
  private poolMetrics: {
    tasksProcessed: number;
    tasksFailed: number;
    totalTaskDuration: number;
  };

  /**
   * Create a new WorkerPool instance
   *
   * @param config - Pool configuration
   */
  constructor(config: WorkerPoolConfig = {}) {
    super();

    this.id = config.id || `pool_${Date.now()}`;
    this.name = config.name || 'default-pool';
    this.workers = new Map();
    this.createdAt = Date.now();

    this.config = {
      minWorkers: config.minWorkers ?? 1,
      maxWorkers: config.maxWorkers ?? 10,
      defaultWorkerConfig: config.defaultWorkerConfig ?? {},
      autoScale: config.autoScale ?? true,
      scaleUpThreshold: config.scaleUpThreshold ?? 0.8,
      scaleDownThreshold: config.scaleDownThreshold ?? 0.2,
      healthCheckInterval: config.healthCheckInterval ?? 30000,
      autoRecover: config.autoRecover ?? true,
      routingStrategy: config.routingStrategy ?? 'hybrid',
      loadBalancingStrategy: config.loadBalancingStrategy ?? 'adaptive',
      ...config,
    };

    this.poolMetrics = {
      tasksProcessed: 0,
      tasksFailed: 0,
      totalTaskDuration: 0,
    };

    this.emit('pool-created', { poolId: this.id, name: this.name });
  }

  /**
   * Initialize the pool
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.emit('pool-initializing', { poolId: this.id });

    // Initialize all existing workers
    const initPromises = Array.from(this.workers.values()).map((worker) =>
      worker.initialize().catch((error) => {
        this.emit('worker-init-failed', {
          poolId: this.id,
          workerId: worker.id,
          error,
        });
      })
    );

    await Promise.all(initPromises);

    // Start health checks
    this.startHealthChecks();

    this.initialized = true;

    this.emit('pool-initialized', {
      poolId: this.id,
      workerCount: this.workers.size,
    });
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    this.emit('pool-shutting-down', { poolId: this.id });

    // Stop health checks
    this.stopHealthChecks();

    // Shutdown all workers
    const shutdownPromises = Array.from(this.workers.values()).map((worker) =>
      worker.shutdown().catch((error) => {
        this.emit('worker-shutdown-failed', {
          poolId: this.id,
          workerId: worker.id,
          error,
        });
      })
    );

    await Promise.all(shutdownPromises);

    this.workers.clear();
    this.initialized = false;

    this.emit('pool-shutdown', { poolId: this.id });
  }

  /**
   * Spawn a new worker in the pool
   *
   * @param config - Worker configuration
   * @param options - Spawn options
   * @returns Created worker
   */
  spawn(
    config: WorkerConfig | SpecializedWorkerConfig | LongRunningWorkerConfig,
    options: SpawnOptions = {}
  ): WorkerBase {
    // Check capacity
    if (this.workers.size >= this.config.maxWorkers! && !options.replace) {
      throw new Error(
        `Pool ${this.id} at maximum capacity (${this.config.maxWorkers} workers)`
      );
    }

    // Handle replacement
    if (this.workers.has(config.id)) {
      if (options.replace) {
        this.terminate(config.id);
      } else {
        throw new Error(`Worker ${config.id} already exists in pool`);
      }
    }

    // Merge with default config
    const mergedConfig = {
      ...this.config.defaultWorkerConfig,
      ...config,
    };

    // Create appropriate worker type
    let worker: WorkerBase;

    if ('domain' in config) {
      worker = new SpecializedWorker(config as SpecializedWorkerConfig);
    } else if ('checkpointInterval' in config) {
      worker = new LongRunningWorker(config as LongRunningWorkerConfig);
    } else {
      // Create a concrete implementation for generic workers
      worker = new GenericWorker(mergedConfig);
    }

    // Add to registry
    this.workers.set(worker.id, worker);

    // Forward worker events
    this.forwardWorkerEvents(worker);

    // Initialize if requested and pool is initialized
    if (options.initialize && this.initialized) {
      worker.initialize().catch((error) => {
        this.emit('worker-init-failed', {
          poolId: this.id,
          workerId: worker.id,
          error,
        });
      });
    }

    this.emit('worker-spawned', {
      poolId: this.id,
      workerId: worker.id,
      type: worker.type,
    });

    return worker;
  }

  /**
   * Terminate a worker
   *
   * @param workerId - Worker ID to terminate
   * @returns True if worker was terminated
   */
  terminate(workerId: string): boolean {
    const worker = this.workers.get(workerId);

    if (!worker) {
      return false;
    }

    // Shutdown worker
    worker.shutdown().catch((error) => {
      this.emit('worker-shutdown-failed', {
        poolId: this.id,
        workerId,
        error,
      });
    });

    // Remove from registry
    this.workers.delete(workerId);

    this.emit('worker-terminated', {
      poolId: this.id,
      workerId,
    });

    return true;
  }

  /**
   * Route a task to the best workers
   *
   * @param task - Task to route
   * @param topK - Number of workers to return (default: 1)
   * @returns Array of best-matched workers
   */
  routeTask(task: Task, topK: number = 1): WorkerBase[] {
    const result = this.routeTaskWithDetails(task, topK);
    return result.workers;
  }

  /**
   * Route a task with detailed scoring information
   *
   * @param task - Task to route
   * @param topK - Number of workers to return
   * @returns Detailed routing result
   */
  routeTaskWithDetails(task: Task, topK: number = 1): RoutingResult {
    const availableWorkers = this.getAvailableWorkers();
    const scores = new Map<string, number>();

    // Score each worker
    for (const worker of availableWorkers) {
      const score = this.scoreWorkerForTask(worker, task);
      scores.set(worker.id, score);
    }

    // Sort by score and take top K
    const sortedWorkers = availableWorkers
      .sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0))
      .slice(0, topK);

    return {
      workers: sortedWorkers,
      scores,
      strategy: this.config.routingStrategy!,
      metadata: {
        totalCandidates: availableWorkers.length,
        filtered: availableWorkers.length - sortedWorkers.length,
        matchThreshold: 0.5,
      },
    };
  }

  /**
   * Balance load across workers
   *
   * Redistributes tasks or adjusts worker priorities based on
   * the configured load balancing strategy.
   */
  balanceLoad(): void {
    const stats = this.getStats();

    if (stats.avgUtilization > this.config.scaleUpThreshold! && this.config.autoScale) {
      this.scaleUp();
    } else if (
      stats.avgUtilization < this.config.scaleDownThreshold! &&
      this.config.autoScale
    ) {
      this.scaleDown();
    }

    this.emit('load-balanced', {
      poolId: this.id,
      avgUtilization: stats.avgUtilization,
      workerCount: stats.totalWorkers,
    });
  }

  /**
   * Get a worker by ID
   *
   * @param workerId - Worker ID
   * @returns Worker or undefined
   */
  getWorker(workerId: string): WorkerBase | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get all workers
   */
  getAllWorkers(): WorkerBase[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get available workers (not at capacity)
   */
  getAvailableWorkers(): WorkerBase[] {
    return Array.from(this.workers.values()).filter((worker) =>
      worker.isAvailable()
    );
  }

  /**
   * Get workers by type
   *
   * @param type - Worker type to filter
   */
  getWorkersByType(type: WorkerType): WorkerBase[] {
    return Array.from(this.workers.values()).filter(
      (worker) => worker.type === type
    );
  }

  /**
   * Get workers by capability
   *
   * @param capability - Required capability
   */
  getWorkersByCapability(capability: string): WorkerBase[] {
    return Array.from(this.workers.values()).filter((worker) =>
      worker.capabilities.includes(capability)
    );
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const workers = Array.from(this.workers.values());
    const availableWorkers = workers.filter((w) => w.isAvailable());
    const busyWorkers = workers.filter(
      (w) => w.status === 'busy' || w.load > 0.9
    );
    const unhealthyWorkers = workers.filter(
      (w) => w.getHealth().status === 'unhealthy'
    );

    // Calculate averages
    const avgUtilization =
      workers.length > 0
        ? workers.reduce((sum, w) => sum + w.load, 0) / workers.length
        : 0;

    const avgHealthScore =
      workers.length > 0
        ? workers.reduce((sum, w) => sum + w.getHealth().score, 0) / workers.length
        : 1;

    const avgTaskDuration =
      this.poolMetrics.tasksProcessed > 0
        ? this.poolMetrics.totalTaskDuration / this.poolMetrics.tasksProcessed
        : 0;

    // Worker type breakdown
    const workerTypes: Record<WorkerType, number> = {
      coder: 0,
      reviewer: 0,
      tester: 0,
      researcher: 0,
      planner: 0,
      architect: 0,
      coordinator: 0,
      security: 0,
      performance: 0,
      specialized: 0,
      'long-running': 0,
      generic: 0,
    };

    for (const worker of workers) {
      if (worker.type in workerTypes) {
        workerTypes[worker.type as WorkerType]++;
      }
    }

    return {
      poolId: this.id,
      totalWorkers: workers.length,
      availableWorkers: availableWorkers.length,
      busyWorkers: busyWorkers.length,
      unhealthyWorkers: unhealthyWorkers.length,
      avgUtilization,
      avgHealthScore,
      tasksProcessed: this.poolMetrics.tasksProcessed,
      tasksFailed: this.poolMetrics.tasksFailed,
      avgTaskDuration,
      workerTypes,
      uptime: Date.now() - this.createdAt,
    };
  }

  /**
   * Execute a task on the best available worker
   *
   * @param task - Task to execute
   * @returns Task result
   */
  async executeTask(task: Task): Promise<TaskResult> {
    const workers = this.routeTask(task, 1);

    if (workers.length === 0) {
      throw new Error('No available workers for task');
    }

    const worker = workers[0];
    const startTime = Date.now();

    try {
      const result = await worker.executeTask(task);

      // Update pool metrics
      this.poolMetrics.tasksProcessed++;
      this.poolMetrics.totalTaskDuration += result.duration;

      if (!result.success) {
        this.poolMetrics.tasksFailed++;
      }

      return result;
    } catch (error) {
      this.poolMetrics.tasksProcessed++;
      this.poolMetrics.tasksFailed++;

      return {
        taskId: task.id,
        success: false,
        error: error as Error,
        duration: Date.now() - startTime,
      };
    }
  }

  // ===== Private Methods =====

  /**
   * Score a worker for a specific task
   */
  private scoreWorkerForTask(worker: WorkerBase, task: Task): number {
    let score = 0;

    switch (this.config.routingStrategy) {
      case 'round-robin':
        score = 1;
        break;

      case 'least-loaded':
        score = 1 - worker.load;
        break;

      case 'capability-match':
        score = this.calculateCapabilityScore(worker, task);
        break;

      case 'embedding-similarity':
        score = this.calculateEmbeddingScore(worker, task);
        break;

      case 'priority-based':
        score = (worker.config.priority || 5) / 10;
        break;

      case 'hybrid':
      default:
        // Weighted combination
        const loadScore = (1 - worker.load) * 0.3;
        const capabilityScore = this.calculateCapabilityScore(worker, task) * 0.3;
        const embeddingScore = this.calculateEmbeddingScore(worker, task) * 0.25;
        const healthScore = worker.getHealth().score * 0.15;
        score = loadScore + capabilityScore + embeddingScore + healthScore;
        break;
    }

    return score;
  }

  /**
   * Calculate capability match score
   */
  private calculateCapabilityScore(worker: WorkerBase, task: Task): number {
    const requiredCapabilities = this.extractRequiredCapabilities(task);

    if (requiredCapabilities.length === 0) {
      return 1;
    }

    const matched = requiredCapabilities.filter((cap) =>
      worker.capabilities.includes(cap)
    );

    return matched.length / requiredCapabilities.length;
  }

  /**
   * Calculate embedding similarity score
   */
  private calculateEmbeddingScore(worker: WorkerBase, task: Task): number {
    if (worker instanceof SpecializedWorker) {
      const matchResult = worker.matchTask(task);
      return matchResult.breakdown.embeddingScore;
    }

    // Generate task embedding and calculate similarity
    const taskEmbedding = this.generateTaskEmbedding(task);
    return worker.calculateSimilarity(taskEmbedding);
  }

  /**
   * Extract required capabilities from task
   */
  private extractRequiredCapabilities(task: Task): string[] {
    if (task.metadata?.requiredCapabilities) {
      return task.metadata.requiredCapabilities as string[];
    }
    return [];
  }

  /**
   * Generate a simple task embedding
   */
  private generateTaskEmbedding(task: Task): Float32Array {
    const dimension = 64;
    const embedding = new Float32Array(dimension);

    // Simple hash-based embedding from task description
    const text = `${task.type} ${task.description}`;
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }

    for (let i = 0; i < dimension; i++) {
      embedding[i] = ((hash >> (i % 32)) & 1) ? 0.1 : -0.1;
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /**
   * Scale up the pool
   */
  private scaleUp(): void {
    if (this.workers.size >= this.config.maxWorkers!) {
      return;
    }

    // Spawn a new generic worker
    const worker = this.spawn({
      id: `auto-worker-${Date.now()}`,
      type: 'generic',
      capabilities: ['general'],
      ...this.config.defaultWorkerConfig,
    });

    this.emit('pool-scaled-up', {
      poolId: this.id,
      newWorkerId: worker.id,
      workerCount: this.workers.size,
    });
  }

  /**
   * Scale down the pool
   */
  private scaleDown(): void {
    if (this.workers.size <= this.config.minWorkers!) {
      return;
    }

    // Find least utilized worker
    const workers = Array.from(this.workers.values())
      .filter((w) => w.status === 'idle')
      .sort((a, b) => a.load - b.load);

    if (workers.length > 0) {
      const worker = workers[0];
      this.terminate(worker.id);

      this.emit('pool-scaled-down', {
        poolId: this.id,
        removedWorkerId: worker.id,
        workerCount: this.workers.size,
      });
    }
  }

  /**
   * Start health check timer
   */
  private startHealthChecks(): void {
    if (this.config.healthCheckInterval! <= 0) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval!);
  }

  /**
   * Stop health check timer
   */
  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Perform health checks on all workers
   */
  private performHealthChecks(): void {
    for (const worker of Array.from(this.workers.values())) {
      const health = worker.getHealth();

      if (health.status === 'unhealthy' && this.config.autoRecover) {
        this.recoverWorker(worker);
      }

      this.emit('worker-health-check', {
        poolId: this.id,
        workerId: worker.id,
        health,
      });
    }

    // Balance load after health checks
    this.balanceLoad();
  }

  /**
   * Attempt to recover an unhealthy worker
   */
  private async recoverWorker(worker: WorkerBase): Promise<void> {
    this.emit('worker-recovering', {
      poolId: this.id,
      workerId: worker.id,
    });

    try {
      // Terminate and respawn
      const config = { ...worker.config };
      this.terminate(worker.id);

      const newWorker = this.spawn(config, { initialize: true });

      this.emit('worker-recovered', {
        poolId: this.id,
        oldWorkerId: worker.id,
        newWorkerId: newWorker.id,
      });
    } catch (error) {
      this.emit('worker-recovery-failed', {
        poolId: this.id,
        workerId: worker.id,
        error: error as Error,
      });
    }
  }

  /**
   * Forward worker events to pool
   */
  private forwardWorkerEvents(worker: WorkerBase): void {
    worker.on('task-started', (data) => {
      this.emit('worker-task-started', { poolId: this.id, ...data });
    });

    worker.on('task-completed', (data) => {
      this.emit('worker-task-completed', { poolId: this.id, ...data });
    });

    worker.on('task-failed', (data) => {
      this.emit('worker-task-failed', { poolId: this.id, ...data });
    });

    worker.on('load-updated', (data) => {
      this.emit('worker-load-updated', { poolId: this.id, ...data });
    });
  }
}

/**
 * Generic worker implementation for pool spawning
 */
class GenericWorker extends WorkerBase {
  async execute(task: Task): Promise<import('./worker-base.js').AgentOutput> {
    // Simple execution that returns processed task info
    return {
      content: {
        taskId: task.id,
        processed: true,
        workerId: this.id,
        timestamp: Date.now(),
      },
      success: true,
      duration: 0,
    };
  }
}

/**
 * Create a worker pool with the given configuration
 *
 * @param config - Pool configuration
 * @returns Configured WorkerPool
 */
export function createWorkerPool(config: WorkerPoolConfig = {}): WorkerPool {
  return new WorkerPool(config);
}

/**
 * Create and initialize a worker pool
 *
 * @param config - Pool configuration
 * @returns Initialized WorkerPool
 */
export async function createAndInitializeWorkerPool(
  config: WorkerPoolConfig = {}
): Promise<WorkerPool> {
  const pool = new WorkerPool(config);
  await pool.initialize();
  return pool;
}
