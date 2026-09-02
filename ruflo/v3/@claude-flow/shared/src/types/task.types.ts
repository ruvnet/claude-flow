/**
 * V3 Task Types
 * Modernized type system with strict TypeScript
 */

import type { ITask, ITaskResult, TaskStatus, TaskPriority } from '../core/interfaces/task.interface.js';

/**
 * Task creation input
 */
export interface TaskInput {
  type: string;
  description: string;
  priority?: number | TaskPriority;
  timeout?: number;
  assignedAgent?: string;
  input?: Record<string, unknown>;
  metadata?: TaskMetadata;
}

/**
 * Task metadata for additional context
 */
export interface TaskMetadata {
  requiredCapabilities?: string[];
  retryCount?: number;
  maxRetries?: number;
  critical?: boolean;
  parentTaskId?: string;
  childTaskIds?: string[];
  tags?: string[];
  deadline?: Date;
  estimatedDuration?: number;
  source?: string;
  [key: string]: unknown;
}

/**
 * Task execution context
 */
export interface TaskExecutionContext {
  task: ITask;
  agentId: string;
  startTime: Date;
  timeout: number;
  attempt: number;
  maxAttempts: number;
}

/**
 * Task execution result - extended
 */
export interface TaskExecutionResult extends ITaskResult {
  context: TaskExecutionContext;
  logs?: string[];
  artifacts?: TaskArtifact[];
}

/**
 * Task artifact - file or data produced by task
 */
export interface TaskArtifact {
  id: string;
  name: string;
  type: 'file' | 'data' | 'log' | 'metric';
  path?: string;
  data?: unknown;
  size?: number;
  createdAt: Date;
}

/**
 * Task queue configuration
 */
export interface TaskQueueConfig {
  maxSize: number;
  priorityLevels: number;
  defaultTimeout: number;
  batchSize: number;
  processingInterval: number;
}

/**
 * Task assignment strategy configuration
 */
export interface TaskAssignmentConfig {
  strategy: 'round-robin' | 'least-loaded' | 'capability-match' | 'priority-based' | 'custom';
  loadBalancing: boolean;
  stickyAssignment: boolean;
  capabilityWeight: number;
  loadWeight: number;
  priorityWeight: number;
}

/**
 * Task retry policy
 */
export interface TaskRetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  retryableErrors?: string[];
  nonRetryableErrors?: string[];
}

/**
 * Task filter for queries
 */
export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  type?: string | string[];
  assignedAgent?: string;
  priority?: number | { min?: number; max?: number };
  createdAfter?: Date;
  createdBefore?: Date;
  tags?: string[];
  hasParent?: boolean;
  parentTaskId?: string;
}

/**
 * Task sort options
 */
export interface TaskSortOptions {
  field: 'priority' | 'createdAt' | 'startedAt' | 'completedAt' | 'status';
  direction: 'asc' | 'desc';
}

/**
 * Task query options
 */
export interface TaskQueryOptions {
  filter?: TaskFilter;
  sort?: TaskSortOptions;
  limit?: number;
  offset?: number;
}

/**
 * Task event payloads
 */
export interface TaskEventPayloads {
  'task:created': {
    task: ITask;
  };
  'task:assigned': {
    taskId: string;
    agentId: string;
  };
  'task:started': {
    taskId: string;
    agentId: string;
    startTime: Date;
  };
  'task:completed': {
    taskId: string;
    result: ITaskResult;
  };
  'task:failed': {
    taskId: string;
    error: Error;
    retryable: boolean;
  };
  'task:cancelled': {
    taskId: string;
    reason: string;
  };
  'task:timeout': {
    taskId: string;
    timeoutMs: number;
  };
  'task:retry': {
    taskId: string;
    attempt: number;
    maxAttempts: number;
    error: Error;
  };
}

/**
 * Priority value conversion
 */
export function priorityToNumber(priority: number | TaskPriority): number {
  if (typeof priority === 'number') {
    return Math.max(0, Math.min(100, priority));
  }
  switch (priority) {
    case 'critical': return 100;
    case 'high': return 75;
    case 'medium': return 50;
    case 'low': return 25;
    default: return 50;
  }
}

/**
 * Priority number to label
 */
export function numberToPriority(value: number): TaskPriority {
  if (value >= 90) return 'critical';
  if (value >= 70) return 'high';
  if (value >= 40) return 'medium';
  return 'low';
}
