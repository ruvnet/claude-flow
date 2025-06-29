/**
 * Consolidated utilities index for Claude-Flow
 * Central export point for all utility modules
 */

// CLI utilities (consolidated)
export * from './cli/index.js';

// Error handling (extended)
export * from './errors.js';

// Path utilities (new)
export * from './paths.js';

// Logging utilities (new)
export * from './logger.js';

// Existing utilities
export * from './helpers.js';
export * from './colors.js';
export * from './formatters.js';

// Re-export specific compatibility layers
export * from './cliffy-compat/command.js';
export * from './cliffy-compat/colors.js';
export * from './cliffy-compat/table.js';
export * from './cliffy-compat/prompt.js';

// Utility groups for convenience
import { paths } from './paths.js';
import { logger, log, loggers } from './logger.js';
import { fatal, wrap, wrapSync, safeHandle } from './errors.js';
import CLI from './cli/index.js';

export const utils = {
  paths,
  logger,
  log,
  loggers,
  CLI,
  errors: {
    fatal,
    wrap,
    wrapSync,
    safeHandle
  }
};

// Default export
export default utils;