/**
 * Unified CLI System - Index
 * Main exports for the unified CLI system
 */

export { main, UnifiedCommandRegistry, CLIError } from './cli.js';
export type { 
  CommandHandler, 
  CommandContext, 
  CommandOption,
  RuntimeAdapter,
  Logger 
} from './interfaces.js';
export { NodeRuntimeAdapter } from './node-runtime.js';

// Re-export commands for direct access
export { statusCommand } from './commands/status.js';