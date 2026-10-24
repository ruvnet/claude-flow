/**
 * Custom error types for Claude-Flow
 */

/**
 * Base error class for all Claude-Flow errors
 */
export class ClaudeFlowError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ClaudeFlowError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      stack: this.stack,
    };
  }
}

/**
 * Terminal-related errors
 */
export class TerminalError extends ClaudeFlowError {
  constructor(message: string, details?: unknown) {
    super(message, 'TERMINAL_ERROR', details);
    this.name = 'TerminalError';
  }
}

export class TerminalSpawnError extends TerminalError {
  override readonly code = 'TERMINAL_SPAWN_ERROR';

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class TerminalCommandError extends TerminalError {
  override readonly code = 'TERMINAL_COMMAND_ERROR';

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * Memory-related errors
 */
export class MemoryError extends ClaudeFlowError {
  constructor(message: string, details?: unknown) {
    super(message, 'MEMORY_ERROR', details);
    this.name = 'MemoryError';
  }
}

export class MemoryBackendError extends MemoryError {
  override readonly code = 'MEMORY_BACKEND_ERROR';

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class MemoryConflictError extends MemoryError {
  override readonly code = 'MEMORY_CONFLICT_ERROR';

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * Coordination-related errors
 */
export class CoordinationError extends ClaudeFlowError {
  constructor(message: string, details?: unknown) {
    super(message, 'COORDINATION_ERROR', details);
    this.name = 'CoordinationError';
  }
}

export class DeadlockError extends CoordinationError {
  override readonly code = 'DEADLOCK_ERROR';

  constructor(
    message: string,
    public readonly agents: string[],
    public readonly resources: string[],
  ) {
    super(message, { agents, resources });
  }
}

export class ResourceLockError extends CoordinationError {
  override readonly code = 'RESOURCE_LOCK_ERROR';

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * MCP-related errors
 */
export class MCPError extends ClaudeFlowError {
  constructor(message: string, details?: unknown) {
    super(message, 'MCP_ERROR', details);
    this.name = 'MCPError';
  }
}

export class MCPTransportError extends MCPError {
  override readonly code = 'MCP_TRANSPORT_ERROR';

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class MCPMethodNotFoundError extends MCPError {
  override readonly code = 'MCP_METHOD_NOT_FOUND';

  constructor(method: string) {
    super(`Method not found: ${method}`, { method });
  }
}

/**
 * Configuration errors
 */
export class ConfigError extends ClaudeFlowError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'ConfigError';
  }
}

export class ValidationError extends ConfigError {
  override readonly code = 'VALIDATION_ERROR';

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * Task-related errors
 */
export class TaskError extends ClaudeFlowError {
  constructor(message: string, details?: unknown) {
    super(message, 'TASK_ERROR', details);
    this.name = 'TaskError';
  }
}

export class TaskTimeoutError extends TaskError {
  override readonly code = 'TASK_TIMEOUT_ERROR';

  constructor(taskId: string, timeout: number) {
    super(`Task ${taskId} timed out after ${timeout}ms`, { taskId, timeout });
  }
}

export class TaskDependencyError extends TaskError {
  override readonly code = 'TASK_DEPENDENCY_ERROR';

  constructor(taskId: string, dependencies: string[]) {
    super(`Task ${taskId} has unmet dependencies`, { taskId, dependencies });
  }
}

/**
 * System errors
 */
export class SystemError extends ClaudeFlowError {
  constructor(message: string, details?: unknown) {
    super(message, 'SYSTEM_ERROR', details);
    this.name = 'SystemError';
  }
}

export class InitializationError extends SystemError {
  override readonly code = 'INITIALIZATION_ERROR';

  constructor(componentOrMessage: string, details?: unknown) {
    // If the message already contains the word "initialize", use it as-is
    const message = componentOrMessage.includes('initialize')
      ? componentOrMessage
      : `Failed to initialize ${componentOrMessage}`;
    super(
      message,
      details ? { component: componentOrMessage, ...details } : { component: componentOrMessage },
    );
  }
}

export class ShutdownError extends SystemError {
  override readonly code = 'SHUTDOWN_ERROR';

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * Error utilities
 */
export function isClaudeFlowError(error: unknown): error is ClaudeFlowError {
  return error instanceof ClaudeFlowError;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

export function getErrorDetails(error: unknown): unknown {
  if (isClaudeFlowError(error)) {
    return error.details;
  }
  return undefined;
}
