/**
 * Create Task Command - Application Layer (CQRS)
 *
 * Command for creating new tasks in the swarm.
 *
 * @module v3/swarm/application/commands
 */

import { Task, TaskPriority, TaskProps } from '../../domain/entities/task.js';
import { ITaskRepository } from '../../domain/repositories/task-repository.interface.js';

/**
 * Create Task Command Input
 */
export interface CreateTaskInput {
  title: string;
  description: string;
  type: string;
  priority?: TaskPriority;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
  input?: unknown;
  timeout?: number;
  maxRetries?: number;
  autoQueue?: boolean;
}

/**
 * Create Task Command Result
 */
export interface CreateTaskResult {
  success: boolean;
  taskId: string;
  task: Task;
  queuedAutomatically: boolean;
}

/**
 * Create Task Command Handler
 */
export class CreateTaskCommandHandler {
  constructor(private readonly repository: ITaskRepository) {}

  async execute(input: CreateTaskInput): Promise<CreateTaskResult> {
    // Validate dependencies exist
    if (input.dependencies && input.dependencies.length > 0) {
      for (const depId of input.dependencies) {
        const exists = await this.repository.exists(depId);
        if (!exists) {
          throw new Error(`Dependency task '${depId}' not found`);
        }
      }
    }

    // Create task
    const task = Task.create({
      title: input.title,
      description: input.description,
      type: input.type,
      priority: input.priority,
      dependencies: input.dependencies,
      metadata: input.metadata,
      input: input.input,
      timeout: input.timeout,
      maxRetries: input.maxRetries,
    });

    // Auto-queue if requested and no dependencies
    let queuedAutomatically = false;
    if (input.autoQueue && (!input.dependencies || input.dependencies.length === 0)) {
      task.queue();
      queuedAutomatically = true;
    }

    await this.repository.save(task);

    return {
      success: true,
      taskId: task.id,
      task,
      queuedAutomatically,
    };
  }
}

/**
 * Cancel Task Command Input
 */
export interface CancelTaskInput {
  taskId: string;
}

/**
 * Cancel Task Command Result
 */
export interface CancelTaskResult {
  success: boolean;
  taskId: string;
  previousStatus: string;
}

/**
 * Cancel Task Command Handler
 */
export class CancelTaskCommandHandler {
  constructor(private readonly repository: ITaskRepository) {}

  async execute(input: CancelTaskInput): Promise<CancelTaskResult> {
    const task = await this.repository.findById(input.taskId);
    if (!task) {
      throw new Error(`Task '${input.taskId}' not found`);
    }

    const previousStatus = task.status;
    task.cancel();
    await this.repository.save(task);

    return {
      success: true,
      taskId: input.taskId,
      previousStatus,
    };
  }
}
