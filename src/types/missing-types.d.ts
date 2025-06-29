/**
 * Type declarations for missing types identified in TS2304 errors
 */

// MCP-related types
export interface MCPServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): string;
  handleRequest(request: any): Promise<any>;
}

export interface MCPPerformanceMonitor {
  startTracking(operation: string): void;
  endTracking(operation: string): void;
  getMetrics(): Record<string, any>;
  reset(): void;
}

export interface MCPLifecycleManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  registerComponent(component: any): void;
  getState(): string;
}

export interface MCPProtocolManager {
  registerProtocol(name: string, handler: any): void;
  handleMessage(message: any): Promise<any>;
  getProtocols(): string[];
}

export interface MCPOrchestrationIntegration {
  integrate(config: MCPOrchestrationConfig): void;
  getComponents(): OrchestrationComponents;
  executeTask(task: any): Promise<any>;
}

export interface MCPOrchestrationConfig {
  enableSwarm?: boolean;
  enableMemory?: boolean;
  enableTasks?: boolean;
  maxConcurrency?: number;
}

export interface OrchestrationComponents {
  swarmCoordinator?: any;
  memoryManager?: any;
  taskExecutor?: any;
  optimizedExecutor?: OptimizedExecutor;
}

export interface OptimizedExecutor {
  execute(task: any): Promise<any>;
  optimize(config: any): void;
  getMetrics(): Record<string, any>;
}

// Swarm-related types
export type SwarmStrategy = 'research' | 'development' | 'analysis' | 'testing' | 'optimization' | 'maintenance';
export type SwarmMode = 'centralized' | 'distributed' | 'hierarchical' | 'mesh' | 'hybrid';

// UI/Monitoring types
export interface ComponentStatus {
  status: 'healthy' | 'degraded' | 'error';
  load: number;
  uptime: number;
  errors: number;
  lastError?: string;
}

export interface AlertData {
  id: string;
  type: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  component: string;
  timestamp: number;
  acknowledged: boolean;
}

// Task/Todo types
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  createdAt?: Date;
  updatedAt?: Date;
}

// Other utility types
export interface Message {
  type: string;
  payload: any;
  timestamp?: Date;
  source?: string;
}

export interface ClaudeConnectionPool {
  getConnection(): Promise<any>;
  releaseConnection(connection: any): void;
  getPoolSize(): number;
  shutdown(): Promise<void>;
}

export interface ClaudeAPI {
  sendMessage(message: string): Promise<string>;
  complete(prompt: string, options?: any): Promise<string>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export interface AsyncFileManager {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
}

// Command-related types (for Cliffy compatibility)
export { Command } from '@cliffy/command';

// Color utility type
export interface Colors {
  red(text: string): string;
  green(text: string): string;
  blue(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
  magenta(text: string): string;
  gray(text: string): string;
  bold(text: string): string;
  dim(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  stripColors(text: string): string;
}

// Re-export existsSync type
export { existsSync } from 'fs';

// Work Stealing types
export interface WorkStealingConfig {
  enabled: boolean;
  stealThreshold: number;
  maxStealBatch: number;
  stealInterval: number;
}

export interface AgentWorkload {
  agentId: string;
  taskCount: number;
  avgTaskDuration: number;
  cpuUsage: number;
  memoryUsage: number;
  priority: number;
  capabilities: string[];
}

export interface WorkStealingCoordinator {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  updateWorkload(agentId: string, workload: AgentWorkload): void;
  getWorkload(agentId: string): AgentWorkload | undefined;
  shouldSteal(fromAgent: string, toAgent: string): boolean;
  stealTasks(fromAgent: string, toAgent: string, count: number): Promise<void>;
  getMetrics(): WorkStealingMetrics;
}

export interface WorkStealingMetrics {
  totalSteals: number;
  successfulSteals: number;
  failedSteals: number;
  avgStealSize: number;
  lastStealTime?: Date;
}

// Circuit Breaker types
export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  halfOpenLimit: number;
}

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open',
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  totalRequests: number;
  rejectedRequests: number;
  halfOpenRequests: number;
}

export interface CircuitBreaker {
  call<T>(operation: () => Promise<T>): Promise<T>;
  isOpen(): boolean;
  isClosed(): boolean;
  isHalfOpen(): boolean;
  getMetrics(): CircuitBreakerMetrics;
  reset(): void;
}

// Task Result types
export interface TaskResult {
  success: boolean;
  output?: string | Record<string, unknown>;
  error?: string;
  executionTime?: number;
  metadata?: Record<string, unknown>;
}

// Worker Thread types
export interface WorkerData {
  type: string;
  payload: unknown;
}

export interface WorkerMessage {
  id: string;
  type: 'result' | 'error' | 'progress' | 'log';
  data: unknown;
}

// Handler Function types
export type HandlerFunction<T = unknown, R = unknown> = (input: T, context?: HandlerContext) => Promise<R>;

export interface HandlerContext {
  logger?: ILogger;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// Generic Component Status
export interface ComponentMetrics {
  status: 'healthy' | 'degraded' | 'error';
  uptime: number;
  requestCount: number;
  errorCount: number;
  averageResponseTime: number;
  lastError?: string;
  lastErrorTime?: Date;
}

// ILogger interface (if not defined elsewhere)
export interface ILogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, error?: unknown): void;
}

// Process Registry types
export interface ProcessInfo {
  pid: number;
  name: string;
  type: string;
  status: 'running' | 'stopped' | 'error';
  startTime: Date;
  cpuUsage?: number;
  memoryUsage?: number;
}

// Database Query types
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  where?: Record<string, unknown>;
}

export interface QueryResult<T = unknown> {
  rows: T[];
  total: number;
  page?: number;
  pageSize?: number;
}

// Migration types
export interface Migration {
  id: string;
  name: string;
  timestamp: number;
  up: () => Promise<void>;
  down: () => Promise<void>;
}

export interface MigrationStatus {
  id: string;
  name: string;
  executedAt?: Date;
  status: 'pending' | 'completed' | 'failed';
  error?: string;
}

// Resource Manager types
export interface ResourceLimits {
  maxMemory?: number;
  maxCpu?: number;
  maxDisk?: number;
  maxConnections?: number;
}

export interface ResourceUsage {
  memory: number;
  cpu: number;
  disk: number;
  connections: number;
  timestamp: Date;
}

// Session types
export interface SessionData {
  id: string;
  userId?: string;
  createdAt: Date;
  expiresAt?: Date;
  data: Record<string, unknown>;
}

// Event Handler types
export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

export interface EventSubscription {
  id: string;
  event: string;
  handler: EventHandler;
  once?: boolean;
}

// Configuration Validation types
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

// Performance Monitoring types
export interface PerformanceMetrics {
  requestsPerSecond: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  errorRate: number;
  throughput: number;
}

// CLI Command types
export interface CommandDefinition {
  name: string;
  description: string;
  options?: CommandOption[];
  arguments?: CommandArgument[];
  handler: CommandHandler;
}

export interface CommandOption {
  name: string;
  short?: string;
  description: string;
  type?: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: unknown;
}

export interface CommandArgument {
  name: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
}

export type CommandHandler = (args: Record<string, unknown>, options: Record<string, unknown>) => Promise<void>;

// WebSocket types
export interface WebSocketMessage {
  type: string;
  id?: string;
  payload?: unknown;
  timestamp?: Date;
}

export interface WebSocketClient {
  id: string;
  socket: unknown;
  authenticated: boolean;
  permissions: string[];
  connectedAt: Date;
  lastActivity: Date;
}

// File System types
export interface FileInfo {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: Date;
  createdAt: Date;
  permissions?: string;
}

// Backup types
export interface BackupOptions {
  destination: string;
  includePatterns?: string[];
  excludePatterns?: string[];
  compression?: boolean;
  encryption?: boolean;
}

export interface BackupResult {
  success: boolean;
  backupPath: string;
  filesBackedUp: number;
  totalSize: number;
  duration: number;
  errors?: string[];
}

// Monitoring Alert types
export interface MonitoringAlert {
  id: string;
  type: 'cpu' | 'memory' | 'disk' | 'error' | 'custom';
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: Date;
  source: string;
  metadata?: Record<string, unknown>;
  acknowledged?: boolean;
  resolvedAt?: Date;
}