/**
 * V3 Shared Types
 *
 * Core type definitions used across all V3 modules
 */

import { EventEmitter } from 'events';

// ============================================================================
// Agent Types
// ============================================================================

export type AgentStatus = 'active' | 'idle' | 'busy' | 'terminated' | 'error';
export type AgentRole = 'leader' | 'worker' | 'peer';
export type AgentType = 'coder' | 'tester' | 'reviewer' | 'coordinator' | 'designer' | 'deployer' | string;

export interface AgentCapability {
  name: string;
  level?: 'basic' | 'intermediate' | 'advanced';
}

export interface AgentConfig {
  id: string;
  type: AgentType;
  capabilities?: string[];
  role?: AgentRole;
  parent?: string;
  metadata?: Record<string, unknown>;
}

export interface Agent {
  id: string;
  type: AgentType;
  status: AgentStatus;
  capabilities: string[];
  role?: AgentRole;
  parent?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
  lastActive?: number;
  executeTask?(task: Task): Promise<TaskResult>;
}

// ============================================================================
// Task Types
// ============================================================================

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'cancelled';
export type TaskType = 'code' | 'test' | 'review' | 'design' | 'deploy' | 'workflow' | string;

export interface Task {
  id: string;
  type: TaskType;
  description: string;
  priority: TaskPriority;
  status?: TaskStatus;
  assignedTo?: string;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
  workflow?: WorkflowDefinition;
  onExecute?: () => void | Promise<void>;
  onRollback?: () => void | Promise<void>;
}

export interface TaskResult {
  taskId: string;
  status: 'completed' | 'failed';
  result?: unknown;
  error?: string;
  duration?: number;
  agentId?: string;
}

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  assignedAt: number;
  priority: TaskPriority;
}

// ============================================================================
// Memory Types
// ============================================================================

export type MemoryType = 'task' | 'context' | 'event' | 'task-start' | 'task-complete' | 'workflow-state' | string;

export interface Memory {
  id: string;
  agentId: string;
  content: string;
  type: MemoryType;
  timestamp: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  agentId?: string;
  type?: MemoryType;
  timeRange?: { start: number; end: number };
  metadata?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface MemorySearchResult extends Memory {
  similarity?: number;
}

// ============================================================================
// Workflow Types
// ============================================================================

export type WorkflowStatus = 'pending' | 'in-progress' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowDefinition {
  id: string;
  name: string;
  tasks: Task[];
  debug?: boolean;
  rollbackOnFailure?: boolean;
}

export interface WorkflowState {
  id: string;
  name: string;
  tasks: Task[];
  status: WorkflowStatus;
  completedTasks: string[];
  currentTask?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface WorkflowResult {
  id: string;
  status: 'completed' | 'failed' | 'cancelled';
  tasksCompleted: number;
  tasksFailed?: number;
  errors: Error[];
  executionOrder?: string[];
  duration?: number;
}

export interface WorkflowMetrics {
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed?: number;
  totalDuration: number;
  averageTaskDuration: number;
  successRate: number;
}

export interface WorkflowDebugInfo {
  executionTrace: Array<{ taskId: string; timestamp: number; action: string }>;
  taskTimings: Record<string, { start: number; end: number; duration: number }>;
  memorySnapshots: Array<{ timestamp: number; snapshot: Record<string, unknown> }>;
  eventLog: Array<{ timestamp: number; event: string; data: unknown }>;
}

// ============================================================================
// Swarm/Coordination Types
// ============================================================================

export type SwarmTopology = 'hierarchical' | 'mesh' | 'simple' | 'adaptive';

export interface SwarmConfig {
  topology: SwarmTopology;
  memoryBackend?: MemoryBackend;
  eventBus?: EventEmitter;
  pluginManager?: PluginManagerInterface;
  maxAgents?: number;
}

export interface SwarmState {
  agents: Agent[];
  topology: SwarmTopology;
  leader?: string;
  activeConnections?: number;
}

export interface SwarmHierarchy {
  leader: string;
  workers: Array<{ id: string; parent: string }>;
}

export interface MeshConnection {
  from: string;
  to: string;
  type: 'peer' | 'leader' | 'worker';
  weight?: number;
}

export interface AgentMessage {
  from: string;
  to: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp?: number;
}

export interface AgentMetrics {
  agentId: string;
  tasksCompleted: number;
  tasksFailed?: number;
  averageExecutionTime: number;
  successRate: number;
  health: 'healthy' | 'degraded' | 'unhealthy';
}

export interface ConsensusDecision {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface ConsensusResult {
  decision: unknown;
  votes: Array<{ agentId: string; vote: unknown }>;
  consensusReached: boolean;
}

// ============================================================================
// Plugin Types
// ============================================================================

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  priority?: number;
  dependencies?: string[];
  configSchema?: Record<string, unknown>;
  minCoreVersion?: string;
  maxCoreVersion?: string;
  initialize(config?: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;
  getExtensionPoints(): ExtensionPoint[];
}

export interface ExtensionPoint {
  name: string;
  handler: (context: unknown) => Promise<unknown>;
  priority?: number;
}

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
}

export interface PluginManagerInterface {
  loadPlugin(plugin: Plugin, config?: Record<string, unknown>): Promise<void>;
  unloadPlugin(pluginId: string): Promise<void>;
  reloadPlugin(pluginId: string, plugin: Plugin): Promise<void>;
  listPlugins(): Plugin[];
  getPluginMetadata(pluginId: string): PluginMetadata | undefined;
  invokeExtensionPoint(name: string, context: unknown): Promise<unknown[]>;
  getCoreVersion(): string;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

// ============================================================================
// MCP Types
// ============================================================================

export interface MCPServerOptions {
  tools?: MCPToolProvider[];
  port?: number;
  host?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface MCPToolProvider {
  execute(toolName: string, params: Record<string, unknown>): Promise<MCPToolResult>;
  getTools?(): MCPTool[];
}

export interface MCPToolResult {
  success: boolean;
  agent?: Agent;
  agents?: Agent[];
  metrics?: AgentMetrics;
  memories?: Memory[];
  results?: MemorySearchResult[];
  config?: Record<string, unknown>;
  valid?: boolean;
  errors?: string[];
  error?: string;
}

export interface MCPRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface MCPResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

// ============================================================================
// Backend Interfaces
// ============================================================================

export interface MemoryBackend {
  initialize(): Promise<void>;
  close(): Promise<void>;
  store(memory: Memory): Promise<Memory>;
  retrieve(id: string): Promise<Memory | undefined>;
  update(memory: Memory): Promise<void>;
  delete(id: string): Promise<void>;
  query(query: MemoryQuery): Promise<Memory[]>;
  vectorSearch(embedding: number[], k?: number): Promise<MemorySearchResult[]>;
  clearAgent?(agentId: string): Promise<void>;
}

export interface SQLiteOptions {
  dbPath: string;
  timeout?: number;
}

export interface AgentDBOptions {
  dbPath: string;
  dimensions?: number;
  hnswM?: number;
  efConstruction?: number;
}

// ============================================================================
// Event Types
// ============================================================================

export interface AgentEvent {
  type: 'agent:spawned' | 'agent:terminated' | 'agent:message';
  agentId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface TaskEvent {
  type: 'task:started' | 'task:completed' | 'task:failed';
  taskId: string;
  agentId?: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface WorkflowEvent {
  type: 'workflow:started' | 'workflow:taskComplete' | 'workflow:completed' | 'workflow:failed';
  workflowId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface PluginEvent {
  type: 'plugin:loaded' | 'plugin:unloaded' | 'plugin:error';
  pluginId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

// ============================================================================
// Error Types
// ============================================================================

export class V3Error extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'V3Error';
  }
}

export class ValidationError extends V3Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class ExecutionError extends V3Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EXECUTION_ERROR', details);
    this.name = 'ExecutionError';
  }
}

export class CoordinationError extends V3Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'COORDINATION_ERROR', details);
    this.name = 'CoordinationError';
  }
}

export class PluginError extends V3Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PLUGIN_ERROR', details);
    this.name = 'PluginError';
  }
}

export class MemoryError extends V3Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'MEMORY_ERROR', details);
    this.name = 'MemoryError';
  }
}
