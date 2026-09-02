/**
 * Utility for proper error handling in TypeScript
 */

import {
  getErrorMessage as getErrorMsg,
  getErrorStack as getErrorStk,
  isError as isErr,
} from './type-guards.js';

export class AppError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// Re-export from type-guards for backward compatibility
export const isError = isErr;
export const getErrorMessage = getErrorMsg;
export const getErrorStack = getErrorStk;

export function handleError(error: unknown, context?: string): never {
  const message = getErrorMessage(error);
  const stack = getErrorStack(error);

  console.error(`Error${context ? ` in ${context}` : ''}: ${message}`);
  if (stack && process.env.NODE_ENV === 'development') {
    console.error('Stack trace:', stack);
  }

  process.exit(1);
}
