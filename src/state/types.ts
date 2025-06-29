/**
 * Unified State Management Types
 * Central type definitions for the unified state store
 */

import type { 
  SwarmAgent, 
  SwarmTask, 
  SwarmObjective,
  AgentType,
  AgentStatus,
  AgentCapabilities,
  AgentMetrics,
  TaskStatus
} from '../swarm/types.js';
import type { 
  AgentProfile, 
  AgentSession, 
  Task,
  MemoryEntry,
  Config
} from '../utils/types.js';
import type {
  AgentPool,
  AgentCluster,
  AgentTemplate
} from '../agents/agent-manager.js';
import type {
  Workflow,
  TaskExecution,
  TaskDependency,
  TaskSchedule
} from '../task/engine.js';

// ===== Core State Structure =====

export interface UnifiedSystemState {
  // System metadata
  version: string;
  lastUpdated: Date;
  sessionId: string;
  
  // Core domains
  swarm: SwarmState;
  agents: AgentState;
  tasks: TaskState;
  sessions: SessionState;
  memory: MemoryState;
  orchestration: OrchestrationState;
  
  // System health and monitoring
  health: SystemHealthState;
  metrics: SystemMetricsState;
  
  // Configuration
  config: SystemConfigState;
}

// ===== Domain States =====

export interface SwarmState {
  activeSwarms: Map<string, SwarmObjective>;
  swarmAgents: Map<string, SwarmAgent>;
  swarmTasks: Map<string, SwarmTask>;
  coordinators: Map<string, SwarmCoordinatorState>;
}

export interface SwarmCoordinatorState {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'stopped';
  strategy: string;
  startedAt: Date;
  metrics: {
    tasksProcessed: number;
    successRate: number;
    averageTaskTime: number;
  };
}

export interface AgentState {
  agents: Map<string, Agent>;
  pools: Map<string, AgentPool>;
  clusters: Map<string, AgentCluster>;
  templates: Map<string, AgentTemplate>;
  metrics: Map<string, AgentMetrics>;
}

export interface Agent {
  id: string;
  type: AgentType;
  status: AgentStatus;
  capabilities: AgentCapabilities;
  currentTask?: string;
  sessionId?: string;
  createdAt: Date;
  lastActiveAt: Date;
  metadata: Record<string, unknown>;
}

export interface TaskState {
  tasks: Map<string, Task>;
  workflows: Map<string, Workflow>;
  executions: Map<string, TaskExecution>;
  dependencies: Map<string, TaskDependency[]>;
  schedule: Map<string, TaskSchedule>;
  queue: {
    pending: string[];
    active: string[];
    completed: string[];
    failed: string[];
  };
}

export interface SessionState {
  sessions: Map<string, AgentSession>;
  profiles: Map<string, AgentProfile>;
  persistence: SessionPersistence;
  activeCount: number;
  totalCreated: number;
}

export interface SessionPersistence {
  sessions: Array<AgentSession & { profile: AgentProfile }>;
  taskQueue: Task[];
  metrics: {
    completedTasks: number;
    failedTasks: number;
    totalTaskDuration: number;
  };
  savedAt: Date;
}

export interface MemoryState {
  banks: Map<string, MemoryBank>;
  entries: Map<string, MemoryEntry>;
  indexes: Map<string, MemoryIndex>;
  cache: MemoryCacheState;
  totalEntries: number;
  totalSize: number;
}

export interface MemoryBank {
  id: string;
  agentId: string;
  createdAt: Date;
  lastAccessed: Date;
  entryCount: number;
  sizeBytes: number;
}

export interface MemoryIndex {
  id: string;
  type: 'namespace' | 'tag' | 'agent' | 'session';
  entries: Set<string>;
  lastUpdated: Date;
}

export interface MemoryCacheState {
  size: number;
  maxSize: number;
  hitRate: number;
  entries: number;
}

export interface OrchestrationState {
  status: 'idle' | 'running' | 'paused' | 'error';
  activeOrchestrators: Map<string, OrchestratorInfo>;
  mcpServers: Map<string, MCPServerState>;
  terminals: Map<string, TerminalState>;
}

export interface OrchestratorInfo {
  id: string;
  type: string;
  status: string;
  startedAt: Date;
  tasksAssigned: number;
  tasksCompleted: number;
}

export interface MCPServerState {
  id: string;
  status: 'running' | 'stopped' | 'error';
  port: number;
  connectedClients: number;
  startedAt?: Date;
  error?: string;
}

export interface TerminalState {
  id: string;
  agentId?: string;
  status: 'active' | 'idle' | 'terminated';
  createdAt: Date;
  lastCommand?: string;
}

// ===== Health and Metrics =====

export interface SystemHealthState {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: Map<string, ComponentHealth>;
  lastCheck: Date;
  issues: HealthIssue[];
}

export interface ComponentHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  metrics?: Record<string, number>;
  error?: string;
}

export interface HealthIssue {
  id: string;
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
}

export interface SystemMetricsState {
  performance: PerformanceMetrics;
  resource: ResourceMetrics;
  business: BusinessMetrics;
  lastUpdated: Date;
}

export interface PerformanceMetrics {
  avgResponseTime: number;
  throughput: number;
  errorRate: number;
  successRate: number;
}

export interface ResourceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkIO: number;
}

export interface BusinessMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  activeAgents: number;
  totalAgents: number;
}

export interface SystemConfigState {
  version: string;
  environment: 'development' | 'staging' | 'production';
  features: Map<string, boolean>;
  limits: SystemLimits;
  settings: SystemSettings;
}

export interface SystemLimits {
  maxAgents: number;
  maxTasks: number;
  maxMemoryMB: number;
  maxSessions: number;
}

export interface SystemSettings {
  autoScale: boolean;
  persistenceEnabled: boolean;
  monitoringEnabled: boolean;
  debugMode: boolean;
}

// ===== State Actions =====

export interface StateAction<T = any> {
  type: string;
  payload: T;
  metadata?: StateActionMetadata;
}

export interface StateActionMetadata {
  timestamp: Date;
  source: string;
  correlationId?: string;
  userId?: string;
  reason?: string;
}

// ===== State Changes =====

export interface StateChange<T = unknown> {
  id: string;
  timestamp: Date;
  action: StateAction;
  previousValue?: T;
  newValue?: T;
  path: string[];
}

export interface StateSnapshot {
  id: string;
  timestamp: Date;
  state: UnifiedSystemState;
  metadata: {
    reason: string;
    automatic: boolean;
    size: number;
  };
}

// ===== State Subscriptions =====

export interface StateSubscriber {
  id: string;
  path: string;
  callback: StateChangeCallback;
  filter?: StateChangeFilter;
}

export type StateChangeCallback = (change: StateChange) => void;

export interface StateChangeFilter {
  actionTypes?: string[];
  paths?: string[];
  sources?: string[];
}

export type Unsubscribe = () => void;

// ===== State Operations =====

export interface StateOperation<T = unknown> {
  type: 'set' | 'update' | 'delete' | 'merge';
  path: string[];
  value?: T;
  updater?: (current: T) => T;
}

export interface StateTransaction {
  id: string;
  operations: StateOperation[];
  metadata: StateActionMetadata;
}

// ===== Persistence Types =====

export interface PersistenceBackend {
  name: string;
  save(state: UnifiedSystemState): Promise<void>;
  load(): Promise<UnifiedSystemState | null>;
  saveSnapshot(snapshot: StateSnapshot): Promise<void>;
  loadSnapshot(id: string): Promise<StateSnapshot | null>;
  listSnapshots(): Promise<StateSnapshot[]>;
  deleteSnapshot(id: string): Promise<void>;
}

export interface StatePersistenceConfig {
  backends: PersistenceBackend[];
  primaryBackend: string;
  snapshotInterval: number;
  maxSnapshots: number;
  compressSnapshots: boolean;
}

// ===== Conflict Resolution =====

export type ConflictStrategy = 'local-wins' | 'remote-wins' | 'merge' | 'custom';

export interface StateConflict<T = unknown> {
  path: string[];
  localValue: T;
  remoteValue: T;
  timestamp: Date;
}

export interface ConflictResolution<T = unknown> {
  strategy: ConflictStrategy;
  resolvedValue: T;
  conflicts: StateConflict<T>[];
}

// ===== State Selectors =====

export type StateSelector<T> = (state: UnifiedSystemState) => T;

export interface SelectorCache {
  get<T>(selector: StateSelector<T>): T | undefined;
  set<T>(selector: StateSelector<T>, value: T): void;
  clear(): void;
}