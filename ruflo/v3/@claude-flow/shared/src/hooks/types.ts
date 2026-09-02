/**
 * V3 Hooks System - Type Definitions
 *
 * Provides extensible hook points for tool execution, file operations,
 * and session lifecycle events. Integrates with event bus for coordination.
 *
 * @module v3/shared/hooks/types
 */

/**
 * Hook event types
 */
export enum HookEvent {
  // Tool execution hooks
  PreToolUse = 'hook:pre-tool-use',
  PostToolUse = 'hook:post-tool-use',

  // File operation hooks
  PreEdit = 'hook:pre-edit',
  PostEdit = 'hook:post-edit',
  PreRead = 'hook:pre-read',
  PostRead = 'hook:post-read',
  PreWrite = 'hook:pre-write',
  PostWrite = 'hook:post-write',

  // Command execution hooks
  PreCommand = 'hook:pre-command',
  PostCommand = 'hook:post-command',

  // Session lifecycle hooks
  SessionStart = 'hook:session-start',
  SessionEnd = 'hook:session-end',
  SessionPause = 'hook:session-pause',
  SessionResume = 'hook:session-resume',

  // Agent lifecycle hooks
  PreAgentSpawn = 'hook:pre-agent-spawn',
  PostAgentSpawn = 'hook:post-agent-spawn',
  PreAgentTerminate = 'hook:pre-agent-terminate',
  PostAgentTerminate = 'hook:post-agent-terminate',

  // Task lifecycle hooks
  PreTaskExecute = 'hook:pre-task-execute',
  PostTaskExecute = 'hook:post-task-execute',
  PreTaskComplete = 'hook:pre-task-complete',
  PostTaskComplete = 'hook:post-task-complete',

  // Memory hooks
  PreMemoryStore = 'hook:pre-memory-store',
  PostMemoryStore = 'hook:post-memory-store',
  PreMemoryRetrieve = 'hook:pre-memory-retrieve',
  PostMemoryRetrieve = 'hook:post-memory-retrieve',

  // Error hooks
  OnError = 'hook:on-error',
  OnWarning = 'hook:on-warning',
}

/**
 * Hook priority levels (higher = earlier execution)
 */
export enum HookPriority {
  Critical = 1000,
  High = 500,
  Normal = 0,
  Low = -500,
  Lowest = -1000,
}

/**
 * Tool information for tool-related hooks
 */
export interface ToolInfo {
  /** Tool name (e.g., 'Read', 'Write', 'Bash') */
  name: string;

  /** Tool parameters */
  parameters: Record<string, unknown>;

  /** Estimated execution time in ms */
  estimatedDuration?: number;

  /** Tool category */
  category?: 'file' | 'bash' | 'search' | 'edit' | 'git' | 'other';
}

/**
 * Command information for command-related hooks
 */
export interface CommandInfo {
  /** Command string */
  command: string;

  /** Working directory */
  cwd?: string;

  /** Environment variables */
  env?: Record<string, string>;

  /** Command timeout in ms */
  timeout?: number;

  /** Whether command is destructive */
  isDestructive?: boolean;
}

/**
 * File operation information
 */
export interface FileOperationInfo {
  /** File path */
  path: string;

  /** Operation type */
  operation: 'read' | 'write' | 'edit' | 'delete';

  /** File content (for write/edit operations) */
  content?: string;

  /** Previous content (for edit operations) */
  previousContent?: string;

  /** File size in bytes */
  size?: number;
}

/**
 * Session information
 */
export interface SessionInfo {
  /** Session ID */
  id: string;

  /** Session start time */
  startTime: Date;

  /** Session end time */
  endTime?: Date;

  /** Session metadata */
  metadata?: Record<string, unknown>;

  /** User ID (if available) */
  userId?: string;
}

/**
 * Agent information
 */
export interface AgentInfo {
  /** Agent ID */
  id: string;

  /** Agent type/role */
  type: string;

  /** Agent configuration */
  config?: Record<string, unknown>;

  /** Parent agent ID */
  parentId?: string;
}

/**
 * Task information
 */
export interface TaskInfo {
  /** Task ID */
  id: string;

  /** Task description */
  description: string;

  /** Task priority */
  priority?: number;

  /** Assigned agent ID */
  agentId?: string;

  /** Task metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Memory operation information
 */
export interface MemoryInfo {
  /** Memory key */
  key: string;

  /** Memory value */
  value?: unknown;

  /** Memory namespace */
  namespace?: string;

  /** TTL in seconds */
  ttl?: number;
}

/**
 * Error information
 */
export interface ErrorInfo {
  /** Error object */
  error: Error;

  /** Error context */
  context?: string;

  /** Error severity */
  severity: 'warning' | 'error' | 'fatal';

  /** Recoverable flag */
  recoverable: boolean;
}

/**
 * Hook context - contains information about the event being hooked
 */
export interface HookContext {
  /** Event type */
  event: HookEvent;

  /** Timestamp when hook was triggered */
  timestamp: Date;

  /** Correlation ID for tracking related events */
  correlationId?: string;

  /** Tool information (for tool hooks) */
  tool?: ToolInfo;

  /** Command information (for command hooks) */
  command?: CommandInfo;

  /** File operation information (for file hooks) */
  file?: FileOperationInfo;

  /** Session information (for session hooks) */
  session?: SessionInfo;

  /** Agent information (for agent hooks) */
  agent?: AgentInfo;

  /** Task information (for task hooks) */
  task?: TaskInfo;

  /** Memory information (for memory hooks) */
  memory?: MemoryInfo;

  /** Error information (for error hooks) */
  error?: ErrorInfo;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Hook result - returned by hook handlers
 */
export interface HookResult {
  /** Whether the hook succeeded */
  success: boolean;

  /** Result data (can modify context) */
  data?: Partial<HookContext>;

  /** Error if hook failed */
  error?: Error;

  /** Whether to continue executing other hooks */
  continueChain?: boolean;

  /** Whether to abort the operation */
  abort?: boolean;

  /** Hook execution time in ms */
  executionTime?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Hook handler function type
 */
export type HookHandler = (context: HookContext) => Promise<HookResult> | HookResult;

/**
 * Hook definition with metadata
 */
export interface HookDefinition {
  /** Unique hook ID */
  id: string;

  /** Hook event type */
  event: HookEvent;

  /** Hook handler function */
  handler: HookHandler;

  /** Hook priority */
  priority: HookPriority;

  /** Hook name/description */
  name?: string;

  /** Whether hook is enabled */
  enabled: boolean;

  /** Hook timeout in ms */
  timeout?: number;

  /** Hook metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Hook statistics
 */
export interface HookStats {
  /** Total hooks registered */
  totalHooks: number;

  /** Hooks by event type */
  byEvent: Record<HookEvent, number>;

  /** Total executions */
  totalExecutions: number;

  /** Total failures */
  totalFailures: number;

  /** Average execution time in ms */
  avgExecutionTime: number;

  /** Total execution time in ms */
  totalExecutionTime: number;
}

/**
 * Hook execution options
 */
export interface HookExecutionOptions {
  /** Timeout in ms (overrides hook-specific timeout) */
  timeout?: number;

  /** Whether to continue on error */
  continueOnError?: boolean;

  /** Maximum parallel executions */
  maxParallel?: number;

  /** Whether to collect results from all hooks */
  collectResults?: boolean;
}
