/**
 * @claude-flow/codex - Type Definitions
 *
 * OpenAI Codex platform adapter types for Claude Flow
 * Part of the coflow rebranding initiative
 */

/**
 * Template types for AGENTS.md generation
 */
export type AgentsMdTemplate = 'default' | 'minimal' | 'full' | 'enterprise';

/**
 * Approval policy levels for Codex
 */
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';

/**
 * Sandbox mode levels
 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Web search configuration
 */
export type WebSearchMode = 'disabled' | 'cached' | 'live';

/**
 * Configuration options for AGENTS.md generation
 */
export interface AgentsMdOptions {
  projectName: string;
  description?: string;
  techStack?: string;
  buildCommand?: string;
  testCommand?: string;
  devCommand?: string;
  template?: AgentsMdTemplate;
  skills?: string[];
  customSections?: Record<string, string>;
}

/**
 * Configuration options for SKILL.md generation
 */
export interface SkillMdOptions {
  name: string;
  description: string;
  /** Skill version (default: "1.0.0") */
  version?: string;
  /** Skill author (default: "rUv") */
  author?: string;
  /** Discovery tags (default: derived from the skill name) */
  tags?: string[];
  triggers?: string[];
  skipWhen?: string[];
  scripts?: SkillScript[];
  references?: SkillReference[];
  commands?: SkillCommand[];
}

/**
 * Skill script definition
 */
export interface SkillScript {
  name: string;
  path: string;
  description: string;
}

/**
 * Skill reference documentation
 */
export interface SkillReference {
  name: string;
  path: string;
  description?: string;
}

/**
 * Skill CLI command
 */
export interface SkillCommand {
  name: string;
  command: string;
  description: string;
  example?: string;
}

/**
 * MCP server configuration
 */
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  enabled?: boolean;
  startupTimeout?: number;
  toolTimeout?: number;
  env?: Record<string, string>;
}

/**
 * Skill path configuration
 */
export interface SkillConfig {
  path: string;
  enabled?: boolean;
}

/**
 * Configuration options for config.toml generation
 */
export interface ConfigTomlOptions {
  platform?: NodeJS.Platform;
  model?: string;
  approvalPolicy?: ApprovalPolicy;
  sandboxMode?: SandboxMode;
  webSearch?: WebSearchMode;
  projectDocMaxBytes?: number;
  features?: ConfigFeatures;
  mcpServers?: McpServerConfig[];
  skills?: SkillConfig[];
  profiles?: Record<string, ConfigProfile>;
  historyPersistence?: 'none' | 'save-all';
}

/**
 * Codex feature flags
 */
export interface ConfigFeatures {
  childAgentsMd?: boolean;
  shellSnapshot?: boolean;
  requestRule?: boolean;
  remoteCompaction?: boolean;
}

/**
 * Configuration profile
 */
export interface ConfigProfile {
  approvalPolicy?: ApprovalPolicy;
  sandboxMode?: SandboxMode;
  webSearch?: WebSearchMode;
}

/**
 * Full initialization options
 */
export interface CodexInitOptions {
  projectPath: string;
  template?: AgentsMdTemplate;
  skills?: string[];
  force?: boolean;
  dual?: boolean;  // Generate both Claude Code and Codex configs
  migrateFrom?: 'claude.md' | 'CLAUDE.md';
}

/**
 * Initialization result
 */
export interface CodexInitResult {
  success: boolean;
  filesCreated: string[];
  skillsGenerated: string[];
  warnings?: string[];
  errors?: string[];
}

/**
 * Migration options
 */
export interface MigrationOptions {
  sourcePath: string;
  targetPath: string;
  preserveComments?: boolean;
  generateSkills?: boolean;
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  agentsMdPath?: string;
  skillsCreated?: string[];
  configTomlPath?: string;
  mappings?: FeatureMapping[];
  warnings?: string[];
}

/**
 * Feature mapping between Claude Code and Codex
 */
export interface FeatureMapping {
  claudeCode: string;
  codex: string;
  status: 'mapped' | 'partial' | 'unsupported';
  notes?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Validation error
 */
export interface ValidationError {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

/**
 * Built-in skill names
 */
export type BuiltInSkill =
  | 'swarm-orchestration'
  | 'memory-management'
  | 'sparc-methodology'
  | 'security-audit'
  | 'performance-analysis'
  | 'github-automation';

/**
 * Codex undocumented features (from binary analysis)
 */
export interface CodexHiddenFeatures {
  envVars: {
    CODEX_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
    CODEX_GHOST_MODE?: 'enabled' | 'disabled';
    CODEX_SANDBOX_NETWORK_DISABLED?: 'true' | 'false';
    CODEX_EXEC_TIMEOUT?: string;
    CODEX_MULTI_TURN_MAX_TURNS?: string;
    CODEX_REMOTE_SYNC?: 'true' | 'false';
  };
  jsonRpcMethods?: string[];
  experimentalFlags?: string[];
}
