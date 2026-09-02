/**
 * @claude-flow/plugins - Core Type Definitions
 *
 * Unified type system for plugins, workers, hooks, and providers.
 */

// ============================================================================
// Plugin Lifecycle
// ============================================================================

export type PluginLifecycleState =
  | 'uninitialized'
  | 'initializing'
  | 'initialized'
  | 'shutting-down'
  | 'shutdown'
  | 'error';

export interface PluginMetadata {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly author?: string;
  readonly license?: string;
  readonly repository?: string;
  readonly dependencies?: string[];
  readonly peerDependencies?: Record<string, string>;
  readonly minCoreVersion?: string;
  readonly maxCoreVersion?: string;
  readonly tags?: string[];
}

// ============================================================================
// Plugin Context & Configuration
// ============================================================================

export interface PluginConfig {
  readonly enabled: boolean;
  readonly priority: number;
  readonly settings: Record<string, unknown>;
  readonly sandbox?: boolean;
  readonly timeout?: number;
  readonly maxMemoryMb?: number;
}

export interface PluginContext {
  readonly config: PluginConfig;
  readonly eventBus: IEventBus;
  readonly logger: ILogger;
  readonly services: ServiceContainer;
  readonly coreVersion: string;
  readonly dataDir: string;
}

export interface ServiceContainer {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
}

// ============================================================================
// Event System
// ============================================================================

export interface IEventBus {
  emit(event: string, data?: unknown): void;
  on(event: string, handler: EventHandler): () => void;
  off(event: string, handler: EventHandler): void;
  once(event: string, handler: EventHandler): () => void;
}

export type EventHandler = (data?: unknown) => void | Promise<void>;

// ============================================================================
// Logging
// ============================================================================

export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  child(context: Record<string, unknown>): ILogger;
}

// ============================================================================
// Extension Points
// ============================================================================

export interface AgentTypeDefinition {
  readonly type: string;
  readonly name: string;
  readonly description?: string;
  readonly capabilities: string[];
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: string[];
  readonly metadata?: Record<string, unknown>;
}

export interface TaskTypeDefinition {
  readonly type: string;
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JSONSchema;
  readonly outputSchema?: JSONSchema;
  readonly handler?: string;
  readonly timeout?: number;
  readonly retries?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface MCPToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  readonly handler: (input: Record<string, unknown>) => Promise<MCPToolResult>;
}

export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface CLICommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly aliases?: string[];
  readonly args?: CLIArgumentDefinition[];
  readonly options?: CLIOptionDefinition[];
  readonly handler: (args: Record<string, unknown>) => Promise<number>;
}

export interface CLIArgumentDefinition {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: unknown;
}

export interface CLIOptionDefinition {
  readonly name: string;
  readonly short?: string;
  readonly description?: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly required?: boolean;
  readonly default?: unknown;
}

export interface MemoryBackendFactory {
  readonly name: string;
  readonly description?: string;
  readonly create: (config: Record<string, unknown>) => Promise<IMemoryBackend>;
}

export interface IMemoryBackend {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  store(key: string, value: unknown, metadata?: Record<string, unknown>): Promise<void>;
  retrieve(key: string): Promise<unknown | null>;
  delete(key: string): Promise<boolean>;
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]>;
  clear(): Promise<void>;
  getStats(): Promise<MemoryBackendStats>;
}

export interface MemorySearchOptions {
  limit?: number;
  threshold?: number;
  filters?: Record<string, unknown>;
}

export interface MemorySearchResult {
  key: string;
  value: unknown;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryBackendStats {
  entries: number;
  sizeBytes: number;
  lastAccess: Date;
}

// ============================================================================
// Worker Types
// ============================================================================

export type WorkerType =
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'researcher'
  | 'planner'
  | 'architect'
  | 'coordinator'
  | 'security'
  | 'performance'
  | 'specialized'
  | 'long-running'
  | 'generic';

export interface WorkerDefinition {
  readonly type: WorkerType;
  readonly name: string;
  readonly description?: string;
  readonly capabilities: string[];
  readonly specialization?: Float32Array;
  readonly maxConcurrentTasks?: number;
  readonly timeout?: number;
  readonly priority?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface WorkerResult {
  readonly workerId: string;
  readonly success: boolean;
  readonly output?: unknown;
  readonly error?: string;
  readonly duration: number;
  readonly tokensUsed?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface WorkerMetrics {
  tasksExecuted: number;
  tasksSucceeded: number;
  tasksFailed: number;
  avgDuration: number;
  totalTokensUsed: number;
  currentLoad: number;
  uptime: number;
  lastActivity: number;
  healthScore: number;
}

export interface WorkerHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  score: number;
  issues: string[];
  resources: {
    memoryMb: number;
    cpuPercent: number;
  };
}

// ============================================================================
// Hook Types
// ============================================================================

export enum HookEvent {
  // Tool lifecycle
  PreToolUse = 'hook:pre-tool-use',
  PostToolUse = 'hook:post-tool-use',

  // Session lifecycle
  SessionStart = 'hook:session-start',
  SessionEnd = 'hook:session-end',
  SessionRestore = 'hook:session-restore',

  // Task execution
  PreTaskExecute = 'hook:pre-task-execute',
  PostTaskComplete = 'hook:post-task-complete',
  TaskFailed = 'hook:task-failed',

  // File operations
  PreFileWrite = 'hook:pre-file-write',
  PostFileWrite = 'hook:post-file-write',
  PreFileDelete = 'hook:pre-file-delete',

  // Command execution
  PreCommand = 'hook:pre-command',
  PostCommand = 'hook:post-command',

  // Agent operations
  AgentSpawned = 'hook:agent-spawned',
  AgentTerminated = 'hook:agent-terminated',

  // Memory operations
  PreMemoryStore = 'hook:pre-memory-store',
  PostMemoryStore = 'hook:post-memory-store',

  // Learning
  PatternDetected = 'hook:pattern-detected',
  StrategyUpdated = 'hook:strategy-updated',

  // Plugin lifecycle
  PluginLoaded = 'hook:plugin-loaded',
  PluginUnloaded = 'hook:plugin-unloaded',
}

export enum HookPriority {
  Critical = 100,
  High = 75,
  Normal = 50,
  Low = 25,
  Deferred = 0,
}

export interface HookDefinition {
  readonly event: HookEvent;
  readonly handler: HookHandler;
  readonly priority?: HookPriority;
  readonly name?: string;
  readonly description?: string;
  readonly async?: boolean;
}

export type HookHandler = (context: HookContext) => HookResult | Promise<HookResult>;

export interface HookContext {
  readonly event: HookEvent;
  readonly data: unknown;
  readonly timestamp: Date;
  readonly source?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface HookResult {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly modified?: boolean;
  readonly abort?: boolean;
}

// ============================================================================
// Provider Types
// ============================================================================

export interface LLMProviderDefinition {
  readonly name: string;
  readonly displayName: string;
  readonly models: string[];
  readonly capabilities: LLMCapability[];
  readonly rateLimit?: RateLimitConfig;
  readonly costPerToken?: CostConfig;
}

export type LLMCapability =
  | 'completion'
  | 'chat'
  | 'streaming'
  | 'function-calling'
  | 'vision'
  | 'embeddings'
  | 'code-generation';

export interface RateLimitConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  tokensPerDay?: number;
}

export interface CostConfig {
  input: number;
  output: number;
  currency: string;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  tools?: LLMTool[];
  stream?: boolean;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface LLMResponse {
  id: string;
  model: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

// ============================================================================
// JSON Schema
// ============================================================================

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JSONSchema;
}

// ============================================================================
// Health Check
// ============================================================================

export interface HealthCheckResult {
  healthy: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  checks: Record<string, {
    healthy: boolean;
    message?: string;
    latencyMs?: number;
  }>;
  timestamp: Date;
}
