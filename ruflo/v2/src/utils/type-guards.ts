/**
 * Type guard utility functions for safe type checking
 */

/**
 * Check if a value is an object (non-null and typeof object)
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Check if a value is an Error instance or has error-like properties
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Check if a value has a message property (error-like)
 */
export function hasMessage(value: unknown): value is { message: string } {
  return isObject(value) && 'message' in value && typeof value.message === 'string';
}

/**
 * Check if a value has a stack property (error-like)
 */
export function hasStack(value: unknown): value is { stack: string } {
  return isObject(value) && 'stack' in value && typeof value.stack === 'string';
}

/**
 * Check if a value is an error-like object
 */
export function isErrorLike(value: unknown): value is { message: string; stack?: string } {
  return hasMessage(value);
}

/**
 * Check if a value has a code property
 */
export function hasCode(value: unknown): value is { code: string | number } {
  return (
    isObject(value) &&
    'code' in value &&
    (typeof value.code === 'string' || typeof value.code === 'number')
  );
}

/**
 * Check if a value has an agentId property
 */
export function hasAgentId(value: unknown): value is { agentId: { id: string } } {
  return (
    isObject(value) &&
    'agentId' in value &&
    isObject(value.agentId) &&
    'id' in value.agentId &&
    typeof value.agentId.id === 'string'
  );
}

/**
 * Check if a value has a pid property (process-like)
 */
export function hasPid(value: unknown): value is { pid: number } {
  return isObject(value) && 'pid' in value && typeof value.pid === 'number';
}

/**
 * Safely get error message from unknown value
 */
export function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (isError(error)) {
    return error.message;
  }
  if (hasMessage(error)) {
    return error.message;
  }
  return String(error);
}

/**
 * Safely get error stack from unknown value
 */
export function getErrorStack(error: unknown): string | undefined {
  if (isError(error)) {
    return error.stack;
  }
  if (hasStack(error)) {
    return error.stack;
  }
  return undefined;
}

/**
 * Type guard for checking if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard for checking if value is a number
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Type guard for checking if value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Type guard for checking if value is an array
 */
export function isArray<T = unknown>(value: unknown): value is T[] {
  return Array.isArray(value);
}

/**
 * Type guard for checking if value is a function
 */
export function isFunction(value: unknown): value is (...args: any[]) => any {
  return typeof value === 'function';
}

/**
 * Type guard for checking if value is null or undefined
 */
export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Type guard for checking if value is defined (not null or undefined)
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard for agent load update event data
 */
export function hasAgentLoad(value: unknown): value is { agentId: { id: string }; load: number } {
  return (
    isObject(value) &&
    'agentId' in value &&
    isObject(value.agentId) &&
    'id' in value.agentId &&
    typeof value.agentId.id === 'string' &&
    'load' in value &&
    typeof value.load === 'number'
  );
}

/**
 * Type guard for task event data
 */
export function hasAgentTask(value: unknown): value is { agentId: { id: string }; task: unknown } {
  return (
    isObject(value) &&
    'agentId' in value &&
    isObject(value.agentId) &&
    'id' in value.agentId &&
    typeof value.agentId.id === 'string' &&
    'task' in value
  );
}

/**
 * Type guard for work stealing event data
 */
export function hasWorkStealingData(value: unknown): value is {
  sourceAgent: { id: string };
  targetAgent: { id: string };
  taskCount: number;
} {
  return (
    isObject(value) &&
    'sourceAgent' in value &&
    isObject(value.sourceAgent) &&
    'id' in value.sourceAgent &&
    typeof value.sourceAgent.id === 'string' &&
    'targetAgent' in value &&
    isObject(value.targetAgent) &&
    'id' in value.targetAgent &&
    typeof value.targetAgent.id === 'string' &&
    'taskCount' in value &&
    typeof value.taskCount === 'number'
  );
}
