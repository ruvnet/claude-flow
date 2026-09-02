/**
 * TypeScript type definitions for all hook commands
 */

export interface BaseHookOptions {
  description?: string;
  metadata?: Record<string, any>;
  verbose?: boolean;
}

export interface PreTaskOptions extends BaseHookOptions {
  autoSpawnAgents?: boolean;
  complexity?: 'low' | 'medium' | 'high';
  estimatedMinutes?: number;
  requiresResearch?: boolean;
  requiresTesting?: boolean;
}

export interface PostTaskOptions extends BaseHookOptions {
  taskId: string;
  analyzePerformance?: boolean;
  generateReport?: boolean;
}

export interface PreEditOptions extends BaseHookOptions {
  file: string;
  operation?: 'read' | 'write' | 'edit' | 'delete';
  validate?: boolean;
  autoAssignAgents?: boolean;
  'auto-assign-agents'?: boolean;
  loadContext?: boolean;
  'load-context'?: boolean;
}

export interface PostEditOptions extends BaseHookOptions {
  file: string;
  memoryKey?: string;
  'memory-key'?: string;
  format?: boolean;
  analyze?: boolean;
  updateMemory?: boolean;
  'update-memory'?: boolean;
  trainNeural?: boolean;
  'train-neural'?: boolean;
}

export interface PreCommandOptions extends BaseHookOptions {
  command: string;
  validate?: boolean;
  'validate-safety'?: boolean;
  sandbox?: boolean;
  prepareResources?: boolean;
  'prepare-resources'?: boolean;
}

export interface PostCommandOptions extends BaseHookOptions {
  command: string;
  exitCode?: number;
  'exit-code'?: number;
  duration?: number;
  trackMetrics?: boolean;
  'track-metrics'?: boolean;
  storeResults?: boolean;
  'store-results'?: boolean;
  output?: string;
}

export interface SessionStartOptions extends BaseHookOptions {
  sessionId?: string;
  loadPrevious?: boolean;
  autoRestore?: boolean;
}

export interface SessionEndOptions extends BaseHookOptions {
  sessionId?: string;
  exportMetrics?: boolean;
  'export-metrics'?: boolean;
  generateSummary?: boolean;
  'generate-summary'?: boolean;
  persistState?: boolean;
  'persist-state'?: boolean;
  saveTo?: string;
}

export interface SessionRestoreOptions extends BaseHookOptions {
  sessionId: string;
  loadMemory?: boolean;
  loadAgents?: boolean;
  loadTasks?: boolean;
}

export interface PreSearchOptions extends BaseHookOptions {
  query: string;
  cacheResults?: boolean;
  maxResults?: number;
}

export interface NotificationOptions extends BaseHookOptions {
  message: string;
  level?: 'info' | 'warning' | 'error';
  telemetry?: boolean;
  persist?: boolean;
}

export interface PerformanceOptions extends BaseHookOptions {
  operation?: string;
  duration?: number;
  metrics?: Record<string, number>;
}

export interface MemorySyncOptions extends BaseHookOptions {
  namespace?: string;
  direction?: 'push' | 'pull' | 'sync';
  target?: string;
}

export interface TelemetryOptions extends BaseHookOptions {
  event: string;
  data?: Record<string, any>;
  tags?: string[];
}

export type HookType =
  | 'pre-task'
  | 'post-task'
  | 'pre-edit'
  | 'post-edit'
  | 'pre-command'
  | 'post-command'
  | 'session-start'
  | 'session-end'
  | 'session-restore'
  | 'pre-search'
  | 'notification'
  | 'performance'
  | 'memory-sync'
  | 'telemetry';

export interface HookResult {
  success: boolean;
  message?: string;
  data?: any;
  error?: Error;
}

export interface HookCommandOptions {
  args: string[];
}
