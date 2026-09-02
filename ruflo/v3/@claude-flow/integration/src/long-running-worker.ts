/**
 * LongRunningWorker - Checkpoint-Based Long-Running Task Support
 *
 * Extends WorkerBase with checkpoint persistence and resumption
 * capabilities for tasks that may span extended periods.
 *
 * Features:
 * - Automatic checkpoint creation during execution
 * - Resume from checkpoint on failure or restart
 * - Progress tracking and reporting
 * - Timeout management with graceful handling
 * - Resource cleanup on completion or failure
 *
 * Compatible with agentic-flow's long-running agent patterns.
 *
 * @module v3/integration/long-running-worker
 * @version 3.0.0-alpha.1
 */

import {
  WorkerBase,
  WorkerConfig,
  AgentOutput,
  WorkerArtifact,
} from './worker-base.js';
import type { Task } from './agentic-flow-agent.js';

/**
 * Checkpoint data structure
 */
export interface Checkpoint {
  /** Unique checkpoint identifier */
  id: string;
  /** Associated task identifier */
  taskId: string;
  /** Worker identifier */
  workerId: string;
  /** Checkpoint sequence number */
  sequence: number;
  /** Checkpoint creation timestamp */
  timestamp: number;
  /** Checkpoint state data */
  state: CheckpointState;
  /** Execution progress (0.0-1.0) */
  progress: number;
  /** Checkpoint metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Checkpoint state containing all data needed to resume
 */
export interface CheckpointState {
  /** Current execution phase */
  phase: string;
  /** Current step within phase */
  step: number;
  /** Total steps in current phase */
  totalSteps: number;
  /** Partial results accumulated so far */
  partialResults: unknown[];
  /** Context data for resumption */
  context: Record<string, unknown>;
  /** Artifacts generated so far */
  artifacts: WorkerArtifact[];
  /** Custom state data */
  custom?: Record<string, unknown>;
}

/**
 * Long-running worker configuration
 */
export interface LongRunningWorkerConfig extends WorkerConfig {
  /** Checkpoint interval in milliseconds */
  checkpointInterval?: number;
  /** Maximum checkpoints to retain */
  maxCheckpoints?: number;
  /** Enable automatic checkpoint cleanup */
  autoCleanup?: boolean;
  /** Checkpoint storage adapter */
  storage?: CheckpointStorage;
  /** Progress reporting interval in milliseconds */
  progressInterval?: number;
  /** Task timeout in milliseconds (0 = no timeout) */
  taskTimeout?: number;
  /** Enable automatic retry on failure */
  autoRetry?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Retry backoff multiplier */
  retryBackoff?: number;
}

/**
 * Checkpoint storage interface
 */
export interface CheckpointStorage {
  /** Save a checkpoint */
  save(checkpoint: Checkpoint): Promise<void>;
  /** Load a checkpoint by ID */
  load(checkpointId: string): Promise<Checkpoint | null>;
  /** Load the latest checkpoint for a task */
  loadLatest(taskId: string, workerId: string): Promise<Checkpoint | null>;
  /** List all checkpoints for a task */
  list(taskId: string, workerId: string): Promise<Checkpoint[]>;
  /** Delete a checkpoint */
  delete(checkpointId: string): Promise<void>;
  /** Delete all checkpoints for a task */
  deleteAll(taskId: string, workerId: string): Promise<void>;
}

/**
 * Execution phase for long-running tasks
 */
export interface ExecutionPhase {
  /** Phase name */
  name: string;
  /** Phase description */
  description?: string;
  /** Estimated steps in this phase */
  estimatedSteps: number;
  /** Phase weight for progress calculation */
  weight?: number;
}

/**
 * Progress update event data
 */
export interface ProgressUpdate {
  /** Task identifier */
  taskId: string;
  /** Worker identifier */
  workerId: string;
  /** Current phase */
  phase: string;
  /** Current step */
  step: number;
  /** Total steps in phase */
  totalSteps: number;
  /** Overall progress (0.0-1.0) */
  progress: number;
  /** Estimated time remaining in milliseconds */
  estimatedTimeRemaining?: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Default in-memory checkpoint storage
 */
class InMemoryCheckpointStorage implements CheckpointStorage {
  private checkpoints: Map<string, Checkpoint> = new Map();

  async save(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.set(checkpoint.id, checkpoint);
  }

  async load(checkpointId: string): Promise<Checkpoint | null> {
    return this.checkpoints.get(checkpointId) || null;
  }

  async loadLatest(taskId: string, workerId: string): Promise<Checkpoint | null> {
    const taskCheckpoints = Array.from(this.checkpoints.values())
      .filter((cp) => cp.taskId === taskId && cp.workerId === workerId)
      .sort((a, b) => b.sequence - a.sequence);

    return taskCheckpoints[0] || null;
  }

  async list(taskId: string, workerId: string): Promise<Checkpoint[]> {
    return Array.from(this.checkpoints.values())
      .filter((cp) => cp.taskId === taskId && cp.workerId === workerId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async delete(checkpointId: string): Promise<void> {
    this.checkpoints.delete(checkpointId);
  }

  async deleteAll(taskId: string, workerId: string): Promise<void> {
    const entries = Array.from(this.checkpoints.entries());
    for (const [id, cp] of entries) {
      if (cp.taskId === taskId && cp.workerId === workerId) {
        this.checkpoints.delete(id);
      }
    }
  }
}

/**
 * LongRunningWorker - Handles extended task execution with checkpoints
 *
 * Usage:
 * ```typescript
 * const worker = new LongRunningWorker({
 *   id: 'long-runner-1',
 *   type: 'long-running',
 *   capabilities: ['data-processing', 'batch-analysis'],
 *   checkpointInterval: 30000, // 30 seconds
 *   maxCheckpoints: 10,
 * });
 *
 * await worker.initialize();
 *
 * // Execute task (checkpoints automatically)
 * const result = await worker.execute(task);
 *
 * // Or resume from checkpoint
 * const result = await worker.resumeFromCheckpoint(checkpointId);
 * ```
 */
export class LongRunningWorker extends WorkerBase {
  /** Active checkpoints for current task */
  checkpoints: Checkpoint[] = [];

  /** Checkpoint storage adapter */
  protected storage: CheckpointStorage;

  /** Checkpoint interval in milliseconds */
  protected checkpointInterval: number;

  /** Maximum checkpoints to retain */
  protected maxCheckpoints: number;

  /** Auto cleanup enabled */
  protected autoCleanup: boolean;

  /** Progress reporting interval */
  protected progressInterval: number;

  /** Task timeout */
  protected taskTimeout: number;

  /** Auto retry on failure */
  protected autoRetry: boolean;

  /** Maximum retry attempts */
  protected maxRetries: number;

  /** Retry backoff multiplier */
  protected retryBackoff: number;

  /** Current task being executed */
  private currentLongTask: Task | null = null;

  /** Current execution state */
  private currentState: CheckpointState | null = null;

  /** Checkpoint timer */
  private checkpointTimer: NodeJS.Timeout | null = null;

  /** Progress timer */
  private progressTimer: NodeJS.Timeout | null = null;

  /** Execution start time */
  private executionStartTime: number = 0;

  /** Checkpoint sequence counter */
  private checkpointSequence: number = 0;

  /** Abort controller for task cancellation */
  private abortController: AbortController | null = null;

  /**
   * Create a new LongRunningWorker instance
   *
   * @param config - Long-running worker configuration
   */
  constructor(config: LongRunningWorkerConfig) {
    const baseConfig: WorkerConfig = {
      ...config,
      type: config.type || 'long-running',
    };

    super(baseConfig);

    this.checkpointInterval = config.checkpointInterval ?? 60000; // 1 minute default
    this.maxCheckpoints = config.maxCheckpoints ?? 10;
    this.autoCleanup = config.autoCleanup ?? true;
    this.progressInterval = config.progressInterval ?? 5000; // 5 seconds default
    this.taskTimeout = config.taskTimeout ?? 0; // No timeout by default
    this.autoRetry = config.autoRetry ?? true;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBackoff = config.retryBackoff ?? 2;
    this.storage = config.storage ?? new InMemoryCheckpointStorage();

    this.emit('long-running-worker-created', {
      workerId: this.id,
      checkpointInterval: this.checkpointInterval,
      maxCheckpoints: this.maxCheckpoints,
    });
  }

  /**
   * Execute a long-running task with checkpoint support
   *
   * @param task - Task to execute
   * @returns Agent output with results
   */
  async execute(task: Task): Promise<AgentOutput> {
    this.currentLongTask = task;
    this.executionStartTime = Date.now();
    this.checkpointSequence = 0;
    this.abortController = new AbortController();

    // Initialize execution state
    this.currentState = {
      phase: 'initialization',
      step: 0,
      totalSteps: 1,
      partialResults: [],
      context: {},
      artifacts: [],
    };

    this.emit('long-task-started', {
      workerId: this.id,
      taskId: task.id,
    });

    try {
      // Start checkpoint timer
      this.startCheckpointTimer();

      // Start progress timer
      this.startProgressTimer();

      // Execute with retry support
      let result: AgentOutput;
      let attempt = 0;
      let lastError: Error | undefined;

      while (attempt < this.maxRetries) {
        try {
          result = await this.executeWithTimeout(task);
          break;
        } catch (error) {
          lastError = error as Error;
          attempt++;

          if (!this.autoRetry || attempt >= this.maxRetries) {
            throw lastError;
          }

          // Wait before retry with exponential backoff
          const delay = 1000 * Math.pow(this.retryBackoff, attempt - 1);
          await this.delay(delay);

          this.emit('task-retry', {
            workerId: this.id,
            taskId: task.id,
            attempt,
            maxRetries: this.maxRetries,
            delay,
          });
        }
      }

      // Cleanup on success
      if (this.autoCleanup) {
        await this.cleanupCheckpoints();
      }

      this.emit('long-task-completed', {
        workerId: this.id,
        taskId: task.id,
        duration: Date.now() - this.executionStartTime,
        checkpointsCreated: this.checkpointSequence,
      });

      return result!;
    } catch (error) {
      // Save final checkpoint on failure
      await this.saveCheckpoint();

      this.emit('long-task-failed', {
        workerId: this.id,
        taskId: task.id,
        error: error as Error,
        checkpointId: this.checkpoints[this.checkpoints.length - 1]?.id,
      });

      return {
        content: { error: (error as Error).message },
        success: false,
        error: error as Error,
        duration: Date.now() - this.executionStartTime,
        metadata: {
          checkpointId: this.checkpoints[this.checkpoints.length - 1]?.id,
          progress: this.calculateProgress(),
        },
      };
    } finally {
      this.stopTimers();
      this.currentLongTask = null;
      this.abortController = null;
    }
  }

  /**
   * Save a checkpoint of the current execution state
   *
   * @returns Created checkpoint
   */
  async saveCheckpoint(): Promise<Checkpoint> {
    if (!this.currentLongTask || !this.currentState) {
      throw new Error('No active task to checkpoint');
    }

    this.checkpointSequence++;

    const checkpoint: Checkpoint = {
      id: `cp_${this.id}_${this.currentLongTask.id}_${this.checkpointSequence}`,
      taskId: this.currentLongTask.id,
      workerId: this.id,
      sequence: this.checkpointSequence,
      timestamp: Date.now(),
      state: { ...this.currentState },
      progress: this.calculateProgress(),
      metadata: {
        executionDuration: Date.now() - this.executionStartTime,
      },
    };

    // Save to storage
    await this.storage.save(checkpoint);

    // Update local list
    this.checkpoints.push(checkpoint);

    // Trim old checkpoints
    await this.trimCheckpoints();

    this.emit('checkpoint-saved', {
      workerId: this.id,
      taskId: this.currentLongTask.id,
      checkpointId: checkpoint.id,
      sequence: checkpoint.sequence,
      progress: checkpoint.progress,
    });

    return checkpoint;
  }

  /**
   * Resume execution from a checkpoint
   *
   * @param checkpointId - Checkpoint ID to resume from
   * @returns Agent output with results
   */
  async resumeFromCheckpoint(checkpointId: string): Promise<AgentOutput> {
    const checkpoint = await this.storage.load(checkpointId);

    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    this.emit('resuming-from-checkpoint', {
      workerId: this.id,
      checkpointId,
      taskId: checkpoint.taskId,
      progress: checkpoint.progress,
    });

    // Restore state
    this.currentState = { ...checkpoint.state };
    this.checkpointSequence = checkpoint.sequence;
    this.checkpoints = await this.storage.list(checkpoint.taskId, this.id);

    // Create a synthetic task from checkpoint
    const resumeTask: Task = {
      id: checkpoint.taskId,
      type: 'resume',
      description: `Resume from checkpoint ${checkpointId}`,
      metadata: {
        resumedFromCheckpoint: checkpointId,
        previousProgress: checkpoint.progress,
      },
    };

    this.currentLongTask = resumeTask;
    this.executionStartTime = Date.now();
    this.abortController = new AbortController();

    try {
      // Start timers
      this.startCheckpointTimer();
      this.startProgressTimer();

      // Execute remaining work
      const result = await this.executeFromState(checkpoint.state);

      // Cleanup on success
      if (this.autoCleanup) {
        await this.cleanupCheckpoints();
      }

      this.emit('resumed-task-completed', {
        workerId: this.id,
        taskId: checkpoint.taskId,
        checkpointId,
        duration: Date.now() - this.executionStartTime,
      });

      return result;
    } catch (error) {
      await this.saveCheckpoint();

      return {
        content: { error: (error as Error).message },
        success: false,
        error: error as Error,
        duration: Date.now() - this.executionStartTime,
        metadata: {
          resumedFromCheckpoint: checkpointId,
          finalCheckpointId: this.checkpoints[this.checkpoints.length - 1]?.id,
        },
      };
    } finally {
      this.stopTimers();
      this.currentLongTask = null;
      this.abortController = null;
    }
  }

  /**
   * Get all checkpoints for the current or specified task
   *
   * @param taskId - Optional task ID (uses current task if not specified)
   * @returns List of checkpoints
   */
  async getCheckpoints(taskId?: string): Promise<Checkpoint[]> {
    const targetTaskId = taskId || this.currentLongTask?.id;

    if (!targetTaskId) {
      return this.checkpoints;
    }

    return this.storage.list(targetTaskId, this.id);
  }

  /**
   * Cancel the current long-running task
   */
  async cancelTask(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }

    // Save final checkpoint
    if (this.currentLongTask) {
      await this.saveCheckpoint();
    }

    this.stopTimers();

    this.emit('task-cancelled', {
      workerId: this.id,
      taskId: this.currentLongTask?.id,
    });
  }

  /**
   * Update the current execution state
   *
   * @param phase - Current phase name
   * @param step - Current step number
   * @param totalSteps - Total steps in phase
   * @param partialResult - Optional partial result to accumulate
   */
  protected updateState(
    phase: string,
    step: number,
    totalSteps: number,
    partialResult?: unknown
  ): void {
    if (!this.currentState) {
      return;
    }

    this.currentState.phase = phase;
    this.currentState.step = step;
    this.currentState.totalSteps = totalSteps;

    if (partialResult !== undefined) {
      this.currentState.partialResults.push(partialResult);
    }
  }

  /**
   * Update context data
   *
   * @param key - Context key
   * @param value - Context value
   */
  protected updateContext(key: string, value: unknown): void {
    if (this.currentState) {
      this.currentState.context[key] = value;
    }
  }

  /**
   * Add an artifact
   *
   * @param artifact - Artifact to add
   */
  protected addArtifact(artifact: WorkerArtifact): void {
    if (this.currentState) {
      this.currentState.artifacts.push(artifact);
    }
  }

  /**
   * Check if task should be aborted
   */
  protected isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  /**
   * Execute task with timeout handling
   */
  private async executeWithTimeout(task: Task): Promise<AgentOutput> {
    if (this.taskTimeout <= 0) {
      return this.executeCore(task);
    }

    return Promise.race([
      this.executeCore(task),
      new Promise<AgentOutput>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Task timeout after ${this.taskTimeout}ms`));
        }, this.taskTimeout);
      }),
    ]);
  }

  /**
   * Core execution logic
   *
   * Override this in subclasses for custom long-running task implementations.
   *
   * @param task - Task to execute
   * @returns Execution output
   */
  protected async executeCore(task: Task): Promise<AgentOutput> {
    // Default implementation with standard execution phases
    const phases: ExecutionPhase[] = [
      { name: 'initialization', estimatedSteps: 1 },
      { name: 'processing', estimatedSteps: 5 },
      { name: 'finalization', estimatedSteps: 1 },
    ];

    for (const phase of phases) {
      if (this.isAborted()) {
        throw new Error('Task aborted');
      }

      for (let step = 1; step <= phase.estimatedSteps; step++) {
        this.updateState(phase.name, step, phase.estimatedSteps);

        // Phase processing time
        await this.delay(100);

        // Add partial result
        this.updateState(phase.name, step, phase.estimatedSteps, {
          phase: phase.name,
          step,
          timestamp: Date.now(),
        });
      }
    }

    return {
      content: {
        results: this.currentState?.partialResults || [],
        artifacts: this.currentState?.artifacts || [],
      },
      success: true,
      duration: Date.now() - this.executionStartTime,
      artifacts: this.currentState?.artifacts,
    };
  }

  /**
   * Execute from a restored state
   *
   * @param state - State to resume from
   * @returns Execution output
   */
  protected async executeFromState(state: CheckpointState): Promise<AgentOutput> {
    // Continue from saved state - subclasses can override for specific behavior
    return this.executeCore(this.currentLongTask!);
  }

  /**
   * Start the checkpoint timer
   */
  private startCheckpointTimer(): void {
    if (this.checkpointInterval <= 0) {
      return;
    }

    this.checkpointTimer = setInterval(async () => {
      if (this.currentLongTask && this.currentState) {
        try {
          await this.saveCheckpoint();
        } catch (error) {
          this.emit('checkpoint-error', {
            workerId: this.id,
            error: error as Error,
          });
        }
      }
    }, this.checkpointInterval);
  }

  /**
   * Start the progress timer
   */
  private startProgressTimer(): void {
    if (this.progressInterval <= 0) {
      return;
    }

    this.progressTimer = setInterval(() => {
      if (this.currentLongTask && this.currentState) {
        const progress = this.calculateProgress();
        const elapsed = Date.now() - this.executionStartTime;
        const estimatedRemaining = progress > 0
          ? (elapsed / progress) * (1 - progress)
          : undefined;

        const update: ProgressUpdate = {
          taskId: this.currentLongTask.id,
          workerId: this.id,
          phase: this.currentState.phase,
          step: this.currentState.step,
          totalSteps: this.currentState.totalSteps,
          progress,
          estimatedTimeRemaining: estimatedRemaining,
          timestamp: Date.now(),
        };

        this.emit('progress', update);
      }
    }, this.progressInterval);
  }

  /**
   * Stop all timers
   */
  private stopTimers(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }

    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  /**
   * Calculate overall progress
   */
  private calculateProgress(): number {
    if (!this.currentState) {
      return 0;
    }

    const { step, totalSteps } = this.currentState;
    if (totalSteps <= 0) {
      return 0;
    }

    return Math.min(1, step / totalSteps);
  }

  /**
   * Trim old checkpoints to stay within limit
   */
  private async trimCheckpoints(): Promise<void> {
    if (this.checkpoints.length <= this.maxCheckpoints) {
      return;
    }

    // Sort by sequence and remove oldest
    this.checkpoints.sort((a, b) => a.sequence - b.sequence);

    while (this.checkpoints.length > this.maxCheckpoints) {
      const oldest = this.checkpoints.shift();
      if (oldest) {
        await this.storage.delete(oldest.id);
      }
    }
  }

  /**
   * Cleanup all checkpoints for the current task
   */
  private async cleanupCheckpoints(): Promise<void> {
    if (!this.currentLongTask) {
      return;
    }

    await this.storage.deleteAll(this.currentLongTask.id, this.id);
    this.checkpoints = [];

    this.emit('checkpoints-cleaned', {
      workerId: this.id,
      taskId: this.currentLongTask.id,
    });
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Shutdown with checkpoint cleanup
   */
  protected async onShutdown(): Promise<void> {
    // Cancel any running task
    if (this.currentLongTask) {
      await this.cancelTask();
    }

    this.stopTimers();
  }
}

/**
 * Create a long-running worker with the given configuration
 *
 * @param config - Worker configuration
 * @returns Configured LongRunningWorker
 */
export function createLongRunningWorker(
  config: Partial<LongRunningWorkerConfig> = {}
): LongRunningWorker {
  return new LongRunningWorker({
    id: config.id || `long-runner-${Date.now()}`,
    type: 'long-running',
    capabilities: config.capabilities || ['long-running'],
    ...config,
  });
}

/**
 * Create a custom checkpoint storage
 *
 * @param options - Storage options
 * @returns Checkpoint storage implementation
 */
export function createCheckpointStorage(options?: {
  type?: 'memory' | 'file' | 'custom';
  path?: string;
  custom?: CheckpointStorage;
}): CheckpointStorage {
  if (options?.custom) {
    return options.custom;
  }

  // Default to in-memory storage
  return new InMemoryCheckpointStorage();
}
