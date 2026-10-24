/**
 * Hook validation utilities
 */

import type { HookType } from './hook-types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate hook parameters before execution
 */
export function validateHookParams(
  hookType: HookType,
  params: Record<string, any>,
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // Common validations
  if (params.metadata && typeof params.metadata === 'string') {
    try {
      JSON.parse(params.metadata);
    } catch {
      result.errors.push('Invalid JSON in --metadata parameter');
      result.valid = false;
    }
  }

  // Hook-specific validations
  switch (hookType) {
    case 'pre-task':
      if (params.complexity && !['low', 'medium', 'high'].includes(params.complexity)) {
        result.errors.push('--complexity must be one of: low, medium, high');
        result.valid = false;
      }
      if (params.estimatedMinutes && isNaN(Number(params.estimatedMinutes))) {
        result.errors.push('--estimated-minutes must be a number');
        result.valid = false;
      }
      break;

    case 'post-task':
      if (!params.taskId) {
        result.errors.push('--task-id is required for post-task hook');
        result.valid = false;
      }
      break;

    case 'pre-edit':
    case 'post-edit':
      if (!params.file) {
        result.errors.push(`--file is required for ${hookType} hook`);
        result.valid = false;
      }
      if (hookType === 'pre-edit' && params.operation) {
        if (!['read', 'write', 'edit', 'delete'].includes(params.operation)) {
          result.errors.push('--operation must be one of: read, write, edit, delete');
          result.valid = false;
        }
      }
      break;

    case 'pre-command':
    case 'post-command':
      if (!params.command) {
        result.errors.push(`--command is required for ${hookType} hook`);
        result.valid = false;
      }
      if (hookType === 'post-command' && params.exitCode) {
        if (isNaN(Number(params.exitCode))) {
          result.errors.push('--exit-code must be a number');
          result.valid = false;
        }
      }
      break;

    case 'session-restore':
      if (!params.sessionId) {
        result.errors.push('--session-id is required for session-restore hook');
        result.valid = false;
      }
      break;

    case 'pre-search':
      if (!params.query) {
        result.errors.push('--query is required for pre-search hook');
        result.valid = false;
      }
      if (params.maxResults && isNaN(Number(params.maxResults))) {
        result.errors.push('--max-results must be a number');
        result.valid = false;
      }
      break;

    case 'notification':
      if (!params.message) {
        result.errors.push('--message is required for notification hook');
        result.valid = false;
      }
      if (params.level && !['info', 'warning', 'error'].includes(params.level)) {
        result.errors.push('--level must be one of: info, warning, error');
        result.valid = false;
      }
      break;

    case 'performance':
      if (params.duration && isNaN(Number(params.duration))) {
        result.errors.push('--duration must be a number');
        result.valid = false;
      }
      if (params.metrics && typeof params.metrics === 'string') {
        try {
          JSON.parse(params.metrics);
        } catch {
          result.errors.push('Invalid JSON in --metrics parameter');
          result.valid = false;
        }
      }
      break;

    case 'memory-sync':
      if (params.direction && !['push', 'pull', 'sync'].includes(params.direction)) {
        result.errors.push('--direction must be one of: push, pull, sync');
        result.valid = false;
      }
      break;

    case 'telemetry':
      if (!params.event) {
        result.errors.push('--event is required for telemetry hook');
        result.valid = false;
      }
      if (params.data && typeof params.data === 'string') {
        try {
          JSON.parse(params.data);
        } catch {
          result.errors.push('Invalid JSON in --data parameter');
          result.valid = false;
        }
      }
      break;
  }

  // Add warnings for deprecated or unusual usage
  if (hookType === 'session-start' && params.loadPrevious && !params.sessionId) {
    result.warnings.push('--load-previous without --session-id may load unexpected data');
  }

  if (
    hookType === 'post-edit' &&
    params.format &&
    !params.file?.match(/\.(js|ts|jsx|tsx|py|java|cpp|cs)$/)
  ) {
    result.warnings.push('--format may not work correctly for this file type');
  }

  return result;
}

/**
 * Sanitize hook parameters for safe execution
 */
export function sanitizeHookParams(params: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    // Sanitize file paths
    if (['file', 'saveTo', 'target'].includes(key) && typeof value === 'string') {
      // Remove potentially dangerous characters
      sanitized[key] = value.replace(/[<>"|?*]/g, '');
    }
    // Sanitize commands
    else if (key === 'command' && typeof value === 'string') {
      // Basic command injection prevention
      sanitized[key] = value.replace(/[;&|`$()]/g, '');
    }
    // Keep other values as-is
    else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
