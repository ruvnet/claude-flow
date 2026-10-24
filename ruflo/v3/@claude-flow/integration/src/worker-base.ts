/**
 * WorkerBase - Abstract Base Worker Class
 *
 * Provides the foundation for all worker patterns in Claude Flow v3,
 * aligned with agentic-flow@alpha's worker architecture.
 *
 * Key Features:
 * - Specialization embeddings for intelligent task routing
 * - Load balancing and capacity tracking
 * - Capability-based task matching
 * - Memory and coordination integration
 *
 * This implements ADR-001 by building on agentic-flow patterns
 * while providing Claude Flow-specific extensions.
 *
 * @module v3/integration/worker-base
 * @version 3.0.0-alpha.1
 */

import { EventEmitter } from 'events';
import type { Task, TaskResult, AgentStatus, Message } from './agentic-flow-agent.js';

/**
 * Worker configuration interface
 */
export interface WorkerConfig {
  /** Unique worker identifier */
  id: string;
  /** Worker type classification */
  type: WorkerType;
  /** Human-readable name */
  name?: string;
  /** Worker capabilities */
  capabilities: string[];
  /** Specialization embedding vector (for similarity-based routing) */
  specialization?: Float32Array | number[];
  /** Maximum concurrent tasks */
  maxConcurrentTasks?: number;
  /** Task execution timeout in milliseconds */
  timeout?: number;
  /** Worker priority (0-100, higher = more preferred) */
  priority?: number;
  /** Memory configuration */
  memory?: WorkerMemoryConfig;
  /** Coordination configuration */
  coordination?: WorkerCoordinationConfig;
  /** Provider configuration for multi-model support */
  provider?: WorkerProviderConfig;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Worker type classification
 */
export type WorkerType =
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'researcher'
  | 'planner'
  | 'architect'
  | 'coordinator'
  | 'security'
  | 'performance'
  | 'specialized'
  | 'long-running'
  | 'generic';

/**
 * Worker memory configuration
 */
export interface WorkerMemoryConfig {
  /** Enable persistent memory */
  enabled: boolean;
  /** Memory namespace for isolation */
  namespace?: string;
  /** Maximum memory entries */
  maxEntries?: number;
  /** Enable embedding-based retrieval */
  enableEmbeddings?: boolean;
  /** Memory bank ID (for cross-session persistence) */
  memoryBankId?: string;
}

/**
 * Worker coordination configuration
 */
export interface WorkerCoordinationConfig {
  /** Enable coordination with other workers */
  enabled: boolean;
  /** Coordination protocol */
  protocol?: 'direct' | 'broadcast' | 'pub-sub' | 'request-response';
  /** Message queue capacity */
  queueCapacity?: number;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval?: number;
}

/**
 * Worker provider configuration for multi-model support
 */
export interface WorkerProviderConfig {
  /** Provider identifier */
  providerId?: string;
  /** Model identifier */
  modelId?: string;
  /** Provider-specific options */
  options?: Record<string, unknown>;
}

/**
 * Agent output interface (compatible with agentic-flow)
 */
export interface AgentOutput {
  /** Output content */
  content: string | Record<string, unknown>;
  /** Success indicator */
  success: boolean;
  /** Error if failed */
  error?: Error;
  /** Execution duration in milliseconds */
  duration: number;
  /** Tokens used (if applicable) */
  tokensUsed?: number;
  /** Artifacts produced */
  artifacts?: WorkerArtifact[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Worker artifact - files or data produced by task execution
 */
export interface WorkerArtifact {
  /** Artifact identifier */
  id: string;
  /** Artifact type */
  type: 'file' | 'data' | 'code' | 'log' | 'metric';
  /** Artifact name */
  name: string;
  /** Artifact content or path */
  content: string | Buffer | Record<string, unknown>;
  /** Content size in bytes */
  size?: number;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Worker metrics for monitoring
 */
export interface WorkerMetrics {
  /** Total tasks executed */
  tasksExecuted: number;
  /** Successful task count */
  tasksSucceeded: number;
  /** Failed task count */
  tasksFailed: number;
  /** Average execution duration */
  avgDuration: number;
  /** Total tokens used */
  totalTokensUsed: number;
  /** Current load (0.0-1.0) */
  currentLoad: number;
  /** Uptime in milliseconds */
  uptime: number;
  /** Last activity timestamp */
  lastActivity: number;
  /** Health score (0.0-1.0) */
  healthScore: number;
}

/**
 * Worker health status
 */
export interface WorkerHealth {
  /** Health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Health score (0.0-1.0) */
  score: number;
  /** Active issues */
  issues: string[];
  /** Last health check timestamp */
  lastCheck: number;
  /** Resource usage */
  resources: {
    memoryMb: number;
    cpuPercent: number;
  };
}

/**
 * WorkerBase - Abstract base class for all workers
 *
 * This class provides the foundation for:
 * - SpecializedWorker: Domain-specific task processing
 * - LongRunningWorker: Checkpoint-based long-running tasks
 * - Generic workers for various use cases
 *
 * Usage:
 * ```typescript
 * class CoderWorker extends WorkerBase {
 *   async execute(task: Task): Promise<AgentOutput> {
 *     // Implementation
 *   }
 * }
 *
 * const worker = new CoderWorker({
 *   id: 'coder-1',
 *   type: 'coder',
 *   capabilities: ['code-generation', 'refactoring'],
 * });
 *
 * await worker.initialize();
 * const result = await worker.execute(task);
 * ```
 */
export abstract class WorkerBase extends EventEmitter {
  // ===== Public Properties =====

  /** Unique worker identifier */
  readonly id: string;

  /** Worker type classification */
  readonly type: WorkerType;

  /** Human-readable name */
  readonly name: string;

  /** Worker capabilities */
  capabilities: string[];

  /** Specialization embedding vector */
  specialization?: Float32Array;

  /** Current load factor (0.0-1.0) */
  load: number = 0;

  /** Current status */
  status: AgentStatus = 'spawning';

  /** Worker configuration (publicly readable for pool operations) */
  readonly config: WorkerConfig;

  /** Initialization state */
  protected initialized: boolean = false;

  /** Current concurrent task count */
  protected currentTaskCount: number = 0;

  /** Creation timestamp */
  protected createdAt: number;

  /** Worker metrics */
  protected metrics: WorkerMetrics;

  /** Message queue for coordination */
  protected messageQueue: Message[] = [];

  /** Memory reference (for persistent memory integration) */
  protected memoryBankId?: string;

  /**
   * Create a new WorkerBase instance
   *
   * @param config - Worker configuration
   */
  constructor(config: WorkerConfig) {
    super();

    // Validate required fields
    if (!config.id) {
      throw new Error('Worker config must include id');
    }

    this.id = config.id;
    this.type = config.type || 'generic';
    this.name = config.name || `${this.type}-${this.id}`;
    this.capabilities = config.capabilities || [];
    this.config = config;
    this.createdAt = Date.now();

    // Set specialization embedding
    if (config.specialization) {
      this.specialization = config.specialization instanceof Float32Array
        ? config.specialization
        : new Float32Array(config.specialization);
    }

    // Initialize metrics
    this.metrics = {
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

    // Memory configuration
    if (config.memory?.enabled) {
      this.memoryBankId = config.memory.memoryBankId;
    }

    this.emit('created', { workerId: this.id, type: this.type });
  }

  // ===== Abstract Methods =====

  /**
   * Execute a task
   *
   * This is the core method that subclasses must implement.
   * It receives a task and returns the execution result.
   *
   * @param task - Task to execute
   * @returns Agent output with results
   */
  abstract execute(task: Task): Promise<AgentOutput>;

  // ===== Lifecycle Methods =====

  /**
   * Initialize the worker
   *
   * Sets up resources, connections, and prepares for task execution.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.emit('initializing', { workerId: this.id });

    try {
      // Initialize memory if configured
      if (this.config.memory?.enabled) {
        await this.initializeMemory();
      }

      // Initialize coordination if configured
      if (this.config.coordination?.enabled) {
        await this.initializeCoordination();
      }

      // Call subclass initialization hook
      await this.onInitialize();

      this.status = 'idle';
      this.initialized = true;

      this.emit('initialized', { workerId: this.id });
    } catch (error) {
      this.status = 'error';
      this.emit('initialization-failed', {
        workerId: this.id,
        error: error as Error,
      });
      throw error;
    }
  }

  /**
   * Shutdown the worker gracefully
   *
   * Releases resources and completes cleanup.
   */
  async shutdown(): Promise<void> {
    this.emit('shutting-down', { workerId: this.id });

    try {
      // Call subclass shutdown hook
      await this.onShutdown();

      this.status = 'terminated';
      this.initialized = false;

      this.emit('shutdown', { workerId: this.id });
    } catch (error) {
      this.emit('shutdown-error', {
        workerId: this.id,
        error: error as Error,
      });
      throw error;
    }
  }

  // ===== Task Execution =====

  /**
   * Execute a task with wrapper logic
   *
   * Handles load tracking, metrics, and error handling.
   *
   * @param task - Task to execute
   * @returns Task result with metrics
   */
  async executeTask(task: Task): Promise<TaskResult> {
    this.ensureInitialized();

    // Check capacity
    const maxTasks = this.config.maxConcurrentTasks || 1;
    if (this.currentTaskCount >= maxTasks) {
      throw new Error(`Worker ${this.id} at capacity (${maxTasks} tasks)`);
    }

    this.currentTaskCount++;
    this.updateLoad();
    this.status = 'busy';
    const startTime = Date.now();

    this.emit('task-started', { workerId: this.id, taskId: task.id });

    try {
      // Execute via subclass implementation
      const output = await this.execute(task);

      const duration = Date.now() - startTime;

      // Update metrics
      this.updateMetricsSuccess(duration, output.tokensUsed);

      const result: TaskResult = {
        taskId: task.id,
        success: output.success,
        output: output.content,
        duration,
        tokensUsed: output.tokensUsed,
        metadata: output.metadata,
      };

      this.emit('task-completed', {
        workerId: this.id,
        taskId: task.id,
        duration,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Update metrics for failure
      this.updateMetricsFailure(duration);

      const result: TaskResult = {
        taskId: task.id,
        success: false,
        error: error as Error,
        duration,
      };

      this.emit('task-failed', {
        workerId: this.id,
        taskId: task.id,
        error: error as Error,
        duration,
      });

      return result;
    } finally {
      this.currentTaskCount--;
      this.updateLoad();
      this.status = this.currentTaskCount > 0 ? 'busy' : 'idle';
      this.metrics.lastActivity = Date.now();
    }
  }

  // ===== Embedding & Matching =====

  /**
   * Get the specialization embedding
   *
   * Returns the worker's specialization vector for similarity-based routing.
   * If no specialization is set, generates a default based on capabilities.
   *
   * @returns Specialization embedding vector
   */
  getEmbedding(): Float32Array {
    if (this.specialization) {
      return this.specialization;
    }

    // Generate default embedding from capabilities
    return this.generateDefaultEmbedding();
  }

  /**
   * Calculate similarity with a task embedding
   *
   * Uses cosine similarity to match worker specialization with task requirements.
   *
   * @param taskEmbedding - Task embedding vector
   * @returns Similarity score (0.0-1.0)
   */
  calculateSimilarity(taskEmbedding: Float32Array | number[]): number {
    const workerEmbedding = this.getEmbedding();
    const taskArray = taskEmbedding instanceof Float32Array
      ? taskEmbedding
      : new Float32Array(taskEmbedding);

    // Cosine similarity
    return this.cosineSimilarity(workerEmbedding, taskArray);
  }

  /**
   * Check if worker has required capabilities for a task
   *
   * @param requiredCapabilities - Required capability list
   * @returns True if worker has all required capabilities
   */
  hasCapabilities(requiredCapabilities: string[]): boolean {
    return requiredCapabilities.every((cap) =>
      this.capabilities.includes(cap)
    );
  }

  // ===== Load Management =====

  /**
   * Update the load factor
   *
   * @param delta - Load change (optional, recalculates if not provided)
   */
  updateLoad(delta?: number): void {
    if (typeof delta === 'number') {
      this.load = Math.max(0, Math.min(1, this.load + delta));
    } else {
      // Calculate based on current task count
      const maxTasks = this.config.maxConcurrentTasks || 1;
      this.load = this.currentTaskCount / maxTasks;
    }

    this.metrics.currentLoad = this.load;

    this.emit('load-updated', { workerId: this.id, load: this.load });
  }

  /**
   * Check if worker is available for tasks
   */
  isAvailable(): boolean {
    return (
      this.initialized &&
      this.status !== 'terminated' &&
      this.status !== 'error' &&
      this.currentTaskCount < (this.config.maxConcurrentTasks || 1)
    );
  }

  // ===== Health & Metrics =====

  /**
   * Get worker health status
   */
  getHealth(): WorkerHealth {
    const uptime = Date.now() - this.createdAt;
    this.metrics.uptime = uptime;

    // Calculate health score
    const successRate =
      this.metrics.tasksExecuted > 0
        ? this.metrics.tasksSucceeded / this.metrics.tasksExecuted
        : 1;

    const healthScore = Math.min(1, successRate * 0.7 + (1 - this.load) * 0.3);
    this.metrics.healthScore = healthScore;

    let status: WorkerHealth['status'] = 'healthy';
    const issues: string[] = [];

    if (healthScore < 0.5) {
      status = 'unhealthy';
      issues.push('Low health score');
    } else if (healthScore < 0.8) {
      status = 'degraded';
    }

    if (this.load > 0.9) {
      issues.push('High load');
    }

    if (this.status === 'error') {
      status = 'unhealthy';
      issues.push('Worker in error state');
    }

    return {
      status,
      score: healthScore,
      issues,
      lastCheck: Date.now(),
      resources: {
        memoryMb: this.estimateMemoryUsage(),
        cpuPercent: this.load * 100,
      },
    };
  }

  /**
   * Get worker metrics
   */
  getMetrics(): WorkerMetrics {
    this.metrics.uptime = Date.now() - this.createdAt;
    return { ...this.metrics };
  }

  // ===== Coordination =====

  /**
   * Send a message to another worker
   *
   * @param to - Target worker ID
   * @param message - Message to send
   */
  async sendMessage(to: string, message: Message): Promise<void> {
    this.emit('message-send', {
      from: this.id,
      to,
      message,
    });
  }

  /**
   * Receive a message from another worker
   *
   * @param message - Received message
   */
  async receiveMessage(message: Message): Promise<void> {
    this.messageQueue.push(message);

    this.emit('message-received', {
      workerId: this.id,
      message,
    });

    // Process message
    await this.processMessage(message);
  }

  // ===== Protected Hook Methods =====

  /**
   * Hook called during initialization
   * Override in subclasses for custom initialization
   */
  protected async onInitialize(): Promise<void> {
    // Default: no-op
  }

  /**
   * Hook called during shutdown
   * Override in subclasses for custom cleanup
   */
  protected async onShutdown(): Promise<void> {
    // Default: no-op
  }

  /**
   * Process a received message
   * Override in subclasses for custom message handling
   *
   * @param message - Message to process
   */
  protected async processMessage(message: Message): Promise<void> {
    // Default: emit event for external handling
    this.emit('message-process', { workerId: this.id, message });
  }

  // ===== Private Methods =====

  /**
   * Initialize memory integration
   */
  private async initializeMemory(): Promise<void> {
    if (!this.memoryBankId) {
      this.memoryBankId = `memory_${this.id}_${Date.now()}`;
    }

    this.emit('memory-initialized', {
      workerId: this.id,
      memoryBankId: this.memoryBankId,
    });
  }

  /**
   * Initialize coordination
   */
  private async initializeCoordination(): Promise<void> {
    this.emit('coordination-initialized', {
      workerId: this.id,
      protocol: this.config.coordination?.protocol || 'direct',
    });
  }

  /**
   * Ensure worker is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Worker ${this.id} not initialized. Call initialize() first.`);
    }
  }

  /**
   * Update metrics for successful task
   */
  private updateMetricsSuccess(duration: number, tokensUsed?: number): void {
    this.metrics.tasksExecuted++;
    this.metrics.tasksSucceeded++;

    // Update average duration
    const total = this.metrics.avgDuration * (this.metrics.tasksSucceeded - 1) + duration;
    this.metrics.avgDuration = total / this.metrics.tasksSucceeded;

    if (tokensUsed) {
      this.metrics.totalTokensUsed += tokensUsed;
    }
  }

  /**
   * Update metrics for failed task
   */
  private updateMetricsFailure(duration: number): void {
    this.metrics.tasksExecuted++;
    this.metrics.tasksFailed++;
  }

  /**
   * Generate default embedding from capabilities
   */
  private generateDefaultEmbedding(): Float32Array {
    // Create a simple hash-based embedding from capabilities
    const dimension = 64;
    const embedding = new Float32Array(dimension);

    for (const cap of this.capabilities) {
      const hash = this.hashString(cap);
      for (let i = 0; i < dimension; i++) {
        embedding[i] += ((hash >> (i % 32)) & 1) ? 0.1 : -0.1;
      }
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
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      // Pad shorter array or use minimum length
      const minLen = Math.min(a.length, b.length);
      a = a.slice(0, minLen);
      b = b.slice(0, minLen);
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dot / denominator : 0;
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * Estimate memory usage in MB
   */
  private estimateMemoryUsage(): number {
    // Base estimate: 2MB + 100KB per capability + queue size
    const base = 2;
    const capabilityOverhead = this.capabilities.length * 0.1;
    const queueOverhead = this.messageQueue.length * 0.01;
    return base + capabilityOverhead + queueOverhead;
  }
}

/**
 * Create a worker with the given configuration
 *
 * @param config - Worker configuration
 * @param ExecutorClass - Worker class to instantiate
 * @returns Initialized worker instance
 */
export async function createWorker<T extends WorkerBase>(
  config: WorkerConfig,
  ExecutorClass: new (config: WorkerConfig) => T
): Promise<T> {
  const worker = new ExecutorClass(config);
  await worker.initialize();
  return worker;
}
