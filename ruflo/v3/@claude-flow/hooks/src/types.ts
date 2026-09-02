/**
 * V3 Hooks System Types
 *
 * Core type definitions for the hooks system including:
 * - Hook events and priorities
 * - Hook handlers and context
 * - Execution results
 * - Daemon configuration
 * - Statusline data
 */

/**
 * Hook event types
 */
export enum HookEvent {
  // Tool lifecycle
  PreToolUse = 'pre-tool-use',
  PostToolUse = 'post-tool-use',

  // File operations
  PreEdit = 'pre-edit',
  PostEdit = 'post-edit',
  PreRead = 'pre-read',
  PostRead = 'post-read',

  // Command execution
  PreCommand = 'pre-command',
  PostCommand = 'post-command',

  // Task lifecycle
  PreTask = 'pre-task',
  PostTask = 'post-task',
  TaskProgress = 'task-progress',

  // Session lifecycle
  SessionStart = 'session-start',
  SessionEnd = 'session-end',
  SessionRestore = 'session-restore',

  // Agent lifecycle
  AgentSpawn = 'agent-spawn',
  AgentTerminate = 'agent-terminate',

  // Routing
  PreRoute = 'pre-route',
  PostRoute = 'post-route',

  // Learning
  PatternLearned = 'pattern-learned',
  PatternConsolidated = 'pattern-consolidated',
}

/**
 * Hook priority levels
 */
export enum HookPriority {
  Critical = 1000,    // Security, validation - runs first
  High = 100,         // Pre-processing, preparation
  Normal = 50,        // Standard hooks
  Low = 10,           // Logging, metrics
  Background = 1,     // Async operations - runs last
}

/**
 * Hook handler function type
 */
export type HookHandler<T = unknown> = (
  context: HookContext<T>
) => Promise<HookResult> | HookResult;

/**
 * Hook context passed to handlers
 */
export interface HookContext<T = unknown> {
  /** The event that triggered this hook */
  event: HookEvent;

  /** Timestamp when the event occurred */
  timestamp: Date;

  /** Tool information (for tool hooks) */
  tool?: {
    name: string;
    parameters: Record<string, unknown>;
  };

  /** File information (for file hooks) */
  file?: {
    path: string;
    operation: 'create' | 'modify' | 'delete' | 'read';
  };

  /** Command information (for command hooks) */
  command?: {
    raw: string;
    workingDirectory?: string;
    exitCode?: number;
    output?: string;
    error?: string;
  };

  /** Task information (for task hooks) */
  task?: {
    id: string;
    description: string;
    agent?: string;
    status?: string;
  };

  /** Session information */
  session?: {
    id: string;
    startedAt: Date;
  };

  /** Agent information (for agent hooks) */
  agent?: {
    id: string;
    type: string;
    status?: string;
  };

  /** Routing information (for routing hooks) */
  routing?: {
    task: string;
    recommendedAgent?: string;
    confidence?: number;
  };

  /** Execution duration in milliseconds */
  duration?: number;

  /** Custom metadata */
  metadata?: Record<string, unknown>;

  /** Custom payload data */
  data?: T;
}

/**
 * Hook execution result
 */
export interface HookResult {
  /** Whether the hook executed successfully */
  success: boolean;

  /** Whether to abort subsequent hooks and/or the operation */
  abort?: boolean;

  /** Error message if failed */
  error?: string;

  /** Custom data to pass to subsequent hooks */
  data?: Record<string, unknown>;

  /** Message to display to user */
  message?: string;

  /** Warnings to display */
  warnings?: string[];
}

/**
 * Registered hook entry
 */
export interface HookEntry {
  /** Unique hook identifier */
  id: string;

  /** Event this hook is registered for */
  event: HookEvent;

  /** Handler function */
  handler: HookHandler;

  /** Execution priority */
  priority: HookPriority;

  /** Whether the hook is enabled */
  enabled: boolean;

  /** Hook name for display */
  name?: string;

  /** Hook description */
  description?: string;

  /** Registration timestamp */
  registeredAt: Date;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Hook registration options
 */
export interface HookRegistrationOptions {
  /** Whether the hook is initially enabled */
  enabled?: boolean;

  /** Hook name for display */
  name?: string;

  /** Hook description */
  description?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Hook execution options
 */
export interface HookExecutionOptions {
  /** Continue executing hooks even if one fails */
  continueOnError?: boolean;

  /** Timeout for individual hook execution (ms) */
  timeout?: number;

  /** Whether to emit events to the event bus */
  emitEvents?: boolean;
}

/**
 * Aggregated hook execution result
 */
export interface HookExecutionResult {
  /** Overall success (all hooks passed) */
  success: boolean;

  /** Whether execution was aborted */
  aborted?: boolean;

  /** Number of hooks executed */
  hooksExecuted: number;

  /** Number of hooks that failed */
  hooksFailed: number;

  /** Total execution time in milliseconds */
  executionTime: number;

  /** Individual hook results */
  results: Array<{
    hookId: string;
    hookName?: string;
    success: boolean;
    duration: number;
    error?: string;
  }>;

  /** Final context after all hooks */
  finalContext?: HookContext;

  /** Aggregated warnings from all hooks */
  warnings?: string[];

  /** Aggregated messages from all hooks */
  messages?: string[];
}

/**
 * Hook registry statistics
 */
export interface HookRegistryStats {
  /** Total registered hooks */
  totalHooks: number;

  /** Enabled hooks */
  enabledHooks: number;

  /** Disabled hooks */
  disabledHooks: number;

  /** Hooks by event type */
  hooksByEvent: Record<string, number>;

  /** Total executions */
  totalExecutions: number;

  /** Total failures */
  totalFailures: number;

  /** Average execution time (ms) */
  avgExecutionTime: number;
}

/**
 * Hook list filter options
 */
export interface HookListFilter {
  /** Filter by event type */
  event?: HookEvent;

  /** Filter by enabled status */
  enabled?: boolean;

  /** Filter by minimum priority */
  minPriority?: HookPriority;

  /** Filter by name pattern */
  namePattern?: RegExp;
}

// ============================================================================
// Daemon Types
// ============================================================================

/**
 * Daemon status
 */
export type DaemonStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/**
 * Daemon configuration
 */
export interface DaemonConfig {
  /** Daemon name */
  name: string;

  /** Update interval in milliseconds */
  interval: number;

  /** Whether the daemon is enabled */
  enabled: boolean;

  /** PID file path */
  pidFile?: string;

  /** Log file path */
  logFile?: string;

  /** Custom configuration */
  config?: Record<string, unknown>;
}

/**
 * Daemon state
 */
export interface DaemonState {
  /** Daemon name */
  name: string;

  /** Current status */
  status: DaemonStatus;

  /** Process ID if running */
  pid?: number;

  /** Started timestamp */
  startedAt?: Date;

  /** Last update timestamp */
  lastUpdateAt?: Date;

  /** Error message if status is 'error' */
  error?: string;

  /** Execution count */
  executionCount: number;

  /** Failure count */
  failureCount: number;
}

/**
 * Daemon manager configuration
 */
export interface DaemonManagerConfig {
  /** Base directory for PID files */
  pidDirectory: string;

  /** Base directory for log files */
  logDirectory: string;

  /** Daemons to manage */
  daemons: DaemonConfig[];

  /** Auto-restart on failure */
  autoRestart: boolean;

  /** Max restart attempts */
  maxRestartAttempts: number;
}

// ============================================================================
// Statusline Types
// ============================================================================

/**
 * Statusline data
 */
export interface StatuslineData {
  /** V3 implementation progress */
  v3Progress: {
    domainsCompleted: number;
    totalDomains: number;
    dddProgress: number;
    modulesCount: number;
    filesCount: number;
    linesCount: number;
  };

  /** Security status */
  security: {
    status: 'PENDING' | 'IN_PROGRESS' | 'CLEAN';
    cvesFixed: number;
    totalCves: number;
  };

  /** Swarm activity */
  swarm: {
    activeAgents: number;
    maxAgents: number;
    coordinationActive: boolean;
  };

  /** Hooks metrics */
  hooks: {
    status: 'ACTIVE' | 'INACTIVE';
    patternsLearned: number;
    routingAccuracy: number;
    totalOperations: number;
  };

  /** Performance targets */
  performance: {
    flashAttentionTarget: string;
    searchImprovement: string;
    memoryReduction: string;
  };

  /** Last update timestamp */
  lastUpdated: Date;
}

/**
 * Statusline configuration
 */
export interface StatuslineConfig {
  /** Enable statusline */
  enabled: boolean;

  /** Refresh on hook execution */
  refreshOnHook: boolean;

  /** Show hooks metrics */
  showHooksMetrics: boolean;

  /** Show swarm activity */
  showSwarmActivity: boolean;

  /** Show performance targets */
  showPerformance: boolean;

  /** Custom format template */
  formatTemplate?: string;
}

// ============================================================================
// Metrics Database Types
// ============================================================================

/**
 * Hooks metrics record
 */
export interface HooksMetricsRecord {
  id: number;
  totalExecutions: number;
  totalFailures: number;
  avgExecutionTime: number;
  patternsLearned: number;
  routingConfidence: number;
  lastUpdated: string;
}

/**
 * Hook stats record
 */
export interface HookStatsRecord {
  hookName: string;
  category: string;
  executionCount: number;
  successRate: number;
  avgTimeMs: number;
  lastExecuted: string;
}

/**
 * Routing history record
 */
export interface RoutingHistoryRecord {
  id: number;
  taskHash: string;
  recommendedAgent: string;
  confidence: number;
  wasSuccessful: boolean;
  timestamp: string;
}

/**
 * Learning pattern record
 */
export interface LearningPatternRecord {
  patternId: string;
  category: string;
  qualityScore: number;
  usageCount: number;
  createdAt: string;
  lastUsed: string;
}

// ============================================================================
// MCP Tool Types
// ============================================================================

/**
 * Pre-edit hook input
 */
export interface PreEditInput {
  filePath: string;
  operation?: 'create' | 'modify' | 'delete';
  includeContext?: boolean;
  includeSuggestions?: boolean;
}

/**
 * Pre-edit hook result
 */
export interface PreEditResult {
  filePath: string;
  operation: string;
  context?: {
    fileExists: boolean;
    fileType?: string;
    relatedFiles?: string[];
    similarPatterns?: Array<{
      pattern: string;
      confidence: number;
      description: string;
    }>;
  };
  suggestions?: Array<{
    agent: string;
    suggestion: string;
    confidence: number;
    rationale: string;
  }>;
  warnings?: string[];
}

/**
 * Post-edit hook input
 */
export interface PostEditInput {
  filePath: string;
  operation?: 'create' | 'modify' | 'delete';
  success: boolean;
  outcome?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Post-edit hook result
 */
export interface PostEditResult {
  filePath: string;
  operation: string;
  success: boolean;
  recorded: boolean;
  recordedAt: string;
  patternId?: string;
}

/**
 * Route task input
 */
export interface RouteTaskInput {
  task: string;
  context?: string;
  preferredAgents?: string[];
  constraints?: Record<string, unknown>;
  includeExplanation?: boolean;
}

/**
 * Route task result
 */
export interface RouteTaskResult {
  task: string;
  recommendedAgent: string;
  confidence: number;
  alternativeAgents?: Array<{
    agent: string;
    confidence: number;
  }>;
  explanation?: string;
  reasoning?: {
    factors: Array<{
      factor: string;
      weight: number;
      value: number;
    }>;
    historicalPerformance?: Array<{
      agent: string;
      successRate: number;
      avgQuality: number;
      tasksSimilar: number;
    }>;
  };
}

/**
 * Metrics query input
 */
export interface MetricsQueryInput {
  category?: 'all' | 'routing' | 'edits' | 'commands' | 'patterns';
  timeRange?: 'hour' | 'day' | 'week' | 'month' | 'all';
  includeDetailedStats?: boolean;
  format?: 'json' | 'summary';
}

/**
 * Metrics query result
 */
export interface MetricsQueryResult {
  category: string;
  timeRange: string;
  summary: {
    totalOperations: number;
    successRate: number;
    avgQuality: number;
    patternsLearned: number;
  };
  routing?: {
    totalRoutes: number;
    avgConfidence: number;
    topAgents: Array<{
      agent: string;
      count: number;
      successRate: number;
    }>;
  };
  edits?: {
    totalEdits: number;
    successRate: number;
    commonPatterns: string[];
  };
  commands?: {
    totalCommands: number;
    successRate: number;
    avgExecutionTime: number;
    commonCommands: string[];
  };
  detailedStats?: Record<string, unknown>;
}
