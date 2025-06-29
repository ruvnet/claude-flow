/**
 * Consolidated utilities index for Claude-Flow
 * Central export point for all utility modules
 */

// CLI utilities (consolidated) - Import CLI as namespace to avoid conflicts
import CLI from './cli/index.js';
export { CLI };

// Error handling (extended)
export * from './errors.js';

// Path utilities (new) - Export paths utilities with alias to avoid conflicts
export { paths, patterns as pathPatterns, validation } from './paths.js';

// Logging utilities (new)
export * from './logger.js';

// Existing utilities
export * from './helpers.js';

// Individual exports to avoid conflicts
export { colors as utilColors } from './colors.js';
export { formatBytes, formatUptime, formatDuration } from './formatters.js';

// Re-export specific compatibility layers
export * from './cliffy-compat/command.js';
export * from './cliffy-compat/colors.js';
export * from './cliffy-compat/table.js';
export * from './cliffy-compat/prompt.js';

// Utility groups for convenience
import { paths } from './paths.js';
import { logger, log, loggers } from './logger.js';
import { fatal, wrap, wrapSync, safeHandle } from './errors.js';

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