/**
 * V3 Init Module
 * Comprehensive initialization system for Claude Code integration
 */

// Types
export {
  type InitOptions,
  type InitComponents,
  type InitResult,
  type HooksConfig,
  type SkillsConfig,
  type CommandsConfig,
  type AgentsConfig,
  type StatuslineConfig,
  type MCPConfig,
  type RuntimeConfig,
  type EmbeddingsConfig,
  type PlatformInfo,
  DEFAULT_INIT_OPTIONS,
  MINIMAL_INIT_OPTIONS,
  FULL_INIT_OPTIONS,
  detectPlatform,
} from './types.js';

// Generators
export {
  generateSettings,
  generateSettingsJson,
} from './settings-generator.js';

export {
  generateMCPConfig,
  generateMCPJson,
  generateMCPCommands,
} from './mcp-generator.js';

export {
  generateStatuslineScript,
  generateStatuslineHook,
} from './statusline-generator.js';

export {
  generatePreCommitHook,
  generatePostCommitHook,
  generateSessionManager,
  generateAgentRouter,
  generateMemoryHelper,
  generateHelpers,
  generateWindowsDaemonManager,
  generateWindowsBatchWrapper,
  generateCrossPlatformSessionManager,
} from './helpers-generator.js';

export {
  generateClaudeMd,
  generateMinimalClaudeMd,
} from './claudemd-generator.js';

// Main executor
export { executeInit, default } from './executor.js';
