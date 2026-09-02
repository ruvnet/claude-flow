/**
 * V3 Unified Swarm Coordinator Types
 * Consolidated type definitions for the unified swarm coordination system
 */

import { EventEmitter } from 'events';

// ===== CORE IDENTIFIERS =====

export interface SwarmId {
  id: string;
  namespace: string;
  version: string;
  createdAt: Date;
}

export interface AgentId {
  id: string;
  swarmId: string;
  type: AgentType;
  instance: number;
}

export interface TaskId {
  id: string;
  swarmId: string;
  sequence: number;
  priority: TaskPriority;
}

// ===== TOPOLOGY TYPES =====

export type TopologyType = 'mesh' | 'hierarchical' | 'centralized' | 'hybrid';

export interface TopologyConfig {
  type: TopologyType;
  maxAgents: number;
  replicationFactor?: number;
  partitionStrategy?: 'hash' | 'range' | 'round-robin';
  failoverEnabled?: boolean;
  autoRebalance?: boolean;
}

export interface TopologyState {
  type: TopologyType;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  leader?: string;
  partitions: TopologyPartition[];
}

export interface TopologyNode {
  id: string;
  agentId: string;
  role: 'queen' | 'worker' | 'coordinator' | 'peer';
  status: 'active' | 'inactive' | 'syncing' | 'failed';
  connections: string[];
  metadata: Record<string, unknown>;
}

export interface TopologyEdge {
  from: string;
  to: string;
  weight: number;
  bidirectional: boolean;
  latencyMs?: number;
}

export interface TopologyPartition {
  id: string;
  nodes: string[];
  leader: string;
  replicaCount: number;
}

// ===== AGENT TYPES =====

export type AgentType =
  | 'coordinator'
  | 'researcher'
  | 'coder'
  | 'analyst'
  | 'architect'
  | 'tester'
  | 'reviewer'
  | 'optimizer'
  | 'documenter'
  | 'monitor'
  | 'specialist'
  | 'queen'
  | 'worker';

export type AgentStatus =
  | 'initializing'
  | 'idle'
  | 'busy'
  | 'paused'
  | 'error'
  | 'offline'
  | 'terminating'
  | 'terminated';

export interface AgentCapabilities {
  codeGeneration: boolean;
  codeReview: boolean;
  testing: boolean;
  documentation: boolean;
  research: boolean;
  analysis: boolean;
  coordination: boolean;
  languages: string[];
  frameworks: string[];
  domains: string[];
  tools: string[];
  maxConcurrentTasks: number;
  maxMemoryUsage: number;
  maxExecutionTime: number;
  reliability: number;
  speed: number;
  quality: number;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  averageExecutionTime: number;
  successRate: number;
  cpuUsage: number;
  memoryUsage: number;
  messagesProcessed: number;
  lastActivity: Date;
  responseTime: number;
  health: number;
}

export interface AgentState {
  id: AgentId;
  name: string;
  type: AgentType;
  status: AgentStatus;
  capabilities: AgentCapabilities;
  metrics: AgentMetrics;
  currentTask?: TaskId;
  workload: number;
  health: number;
  lastHeartbeat: Date;
  topologyRole?: TopologyNode['role'];
  connections: string[];
}

// ===== TASK TYPES =====

export type TaskType =
  | 'research'
  | 'analysis'
  | 'coding'
  | 'testing'
  | 'review'
  | 'documentation'
  | 'coordination'
  | 'consensus'
  | 'custom';

export type TaskStatus =
  | 'created'
  | 'queued'
  | 'assigned'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface TaskDefinition {
  id: TaskId;
  type: TaskType;
  name: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo?: AgentId;
  dependencies: TaskId[];
  input: unknown;
  output?: unknown;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  timeoutMs: number;
  retries: number;
  maxRetries: number;
  metadata: Record<string, unknown>;
}

// ===== CONSENSUS TYPES =====

export type ConsensusAlgorithm = 'raft' | 'byzantine' | 'gossip' | 'paxos';

export interface ConsensusConfig {
  algorithm: ConsensusAlgorithm;
  threshold: number;
  timeoutMs: number;
  maxRounds: number;
  requireQuorum: boolean;
}

export interface ConsensusProposal {
  id: string;
  proposerId: string;
  value: unknown;
  term: number;
  timestamp: Date;
  votes: Map<string, ConsensusVote>;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

export interface ConsensusVote {
  voterId: string;
  approve: boolean;
  confidence: number;
  timestamp: Date;
  reason?: string;
}

export interface ConsensusResult {
  proposalId: string;
  approved: boolean;
  approvalRate: number;
  participationRate: number;
  finalValue: unknown;
  rounds: number;
  durationMs: number;
}

// ===== MESSAGE BUS TYPES =====

export type MessageType =
  | 'task_assign'
  | 'task_complete'
  | 'task_fail'
  | 'heartbeat'
  | 'status_update'
  | 'consensus_propose'
  | 'consensus_vote'
  | 'consensus_commit'
  | 'topology_update'
  | 'agent_join'
  | 'agent_leave'
  | 'broadcast'
  | 'direct';

export interface Message {
  id: string;
  type: MessageType;
  from: string;
  to: string | 'broadcast';
  payload: unknown;
  timestamp: Date;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  requiresAck: boolean;
  ttlMs: number;
  correlationId?: string;
}

export interface MessageAck {
  messageId: string;
  from: string;
  received: boolean;
  processedAt: Date;
  error?: string;
}

export interface MessageBusConfig {
  maxQueueSize: number;
  processingIntervalMs: number;
  ackTimeoutMs: number;
  retryAttempts: number;
  enablePersistence: boolean;
  compressionEnabled: boolean;
}

export interface MessageBusStats {
  totalMessages: number;
  messagesPerSecond: number;
  avgLatencyMs: number;
  queueDepth: number;
  ackRate: number;
  errorRate: number;
}

// ===== COORDINATOR TYPES =====

export interface CoordinatorConfig {
  topology: TopologyConfig;
  consensus: ConsensusConfig;
  messageBus: MessageBusConfig;
  maxAgents: number;
  maxTasks: number;
  heartbeatIntervalMs: number;
  healthCheckIntervalMs: number;
  taskTimeoutMs: number;
  autoScaling: boolean;
  autoRecovery: boolean;
}

export interface CoordinatorState {
  id: SwarmId;
  status: SwarmStatus;
  topology: TopologyState;
  agents: Map<string, AgentState>;
  tasks: Map<string, TaskDefinition>;
  metrics: CoordinatorMetrics;
  startedAt?: Date;
}

export type SwarmStatus =
  | 'initializing'
  | 'running'
  | 'paused'
  | 'recovering'
  | 'shutting_down'
  | 'stopped'
  | 'failed';

export interface CoordinatorMetrics {
  uptime: number;
  activeAgents: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgTaskDurationMs: number;
  messagesPerSecond: number;
  consensusSuccessRate: number;
  coordinationLatencyMs: number;
  memoryUsageBytes: number;
}

// ===== EVENT TYPES =====

export type SwarmEventType =
  | 'swarm.initialized'
  | 'swarm.started'
  | 'swarm.paused'
  | 'swarm.resumed'
  | 'swarm.stopped'
  | 'swarm.failed'
  | 'agent.joined'
  | 'agent.left'
  | 'agent.status_changed'
  | 'agent.heartbeat'
  | 'agent.domain_assigned'
  | 'task.created'
  | 'task.assigned'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.queued'
  | 'topology.updated'
  | 'topology.rebalanced'
  | 'consensus.proposed'
  | 'consensus.achieved'
  | 'consensus.failed'
  | 'message.sent'
  | 'message.received'
  | 'parallel.execution.completed'
  | 'hierarchy.spawned';

export interface SwarmEvent {
  id: string;
  type: SwarmEventType;
  source: string;
  timestamp: Date;
  data: Record<string, unknown>;
  correlationId?: string;
}

// ===== POOL TYPES =====

export interface AgentPoolConfig {
  name: string;
  type: AgentType;
  minSize: number;
  maxSize: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  cooldownMs: number;
  healthCheckIntervalMs: number;
}

export interface AgentPoolState {
  id: string;
  config: AgentPoolConfig;
  agents: Map<string, AgentState>;
  availableAgents: string[];
  busyAgents: string[];
  pendingScale: number;
  lastScaleOperation?: Date;
}

// ===== UTILITY TYPES =====

export interface HealthCheck {
  agentId: string;
  timestamp: Date;
  healthy: boolean;
  latencyMs: number;
  details: Record<string, unknown>;
}

export interface PerformanceReport {
  timestamp: Date;
  window: number;
  coordinationLatencyP50: number;
  coordinationLatencyP99: number;
  messagesPerSecond: number;
  taskThroughput: number;
  agentUtilization: number;
  consensusSuccessRate: number;
}

// ===== CONSTANTS =====

export const SWARM_CONSTANTS = {
  DEFAULT_HEARTBEAT_INTERVAL_MS: 5000,
  DEFAULT_HEALTH_CHECK_INTERVAL_MS: 10000,
  DEFAULT_TASK_TIMEOUT_MS: 300000,
  DEFAULT_CONSENSUS_TIMEOUT_MS: 30000,
  DEFAULT_MESSAGE_TTL_MS: 60000,
  DEFAULT_MAX_AGENTS: 100,
  DEFAULT_MAX_TASKS: 1000,
  DEFAULT_CONSENSUS_THRESHOLD: 0.66,
  MAX_QUEUE_SIZE: 10000,
  MAX_RETRIES: 3,
  COORDINATION_LATENCY_TARGET_MS: 100,
  MESSAGES_PER_SECOND_TARGET: 1000,
} as const;

// ===== TYPE GUARDS =====

export function isAgentId(obj: unknown): obj is AgentId {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'swarmId' in obj &&
    'type' in obj
  );
}

export function isTaskId(obj: unknown): obj is TaskId {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'swarmId' in obj &&
    'sequence' in obj
  );
}

export function isMessage(obj: unknown): obj is Message {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'type' in obj &&
    'from' in obj &&
    'to' in obj
  );
}

// ===== INTERFACES FOR COMPONENTS =====

export interface ITopologyManager {
  initialize(config: TopologyConfig): Promise<void>;
  getState(): TopologyState;
  addNode(agentId: string, role: TopologyNode['role']): Promise<TopologyNode>;
  removeNode(agentId: string): Promise<void>;
  updateNode(agentId: string, updates: Partial<TopologyNode>): Promise<void>;
  getLeader(): string | undefined;
  electLeader(): Promise<string>;
  rebalance(): Promise<void>;
  getNeighbors(agentId: string): string[];
  findOptimalPath(from: string, to: string): string[];
}

export interface IConsensusEngine {
  initialize(config: ConsensusConfig): Promise<void>;
  propose(value: unknown, proposerId: string): Promise<ConsensusProposal>;
  vote(proposalId: string, vote: ConsensusVote): Promise<void>;
  getProposal(proposalId: string): ConsensusProposal | undefined;
  awaitConsensus(proposalId: string): Promise<ConsensusResult>;
  getActiveProposals(): ConsensusProposal[];
}

export interface IMessageBus {
  initialize(config: MessageBusConfig): Promise<void>;
  send(message: Omit<Message, 'id' | 'timestamp'>): Promise<string>;
  broadcast(message: Omit<Message, 'id' | 'timestamp' | 'to'>): Promise<string>;
  subscribe(agentId: string, callback: (message: Message) => void): void;
  unsubscribe(agentId: string): void;
  acknowledge(ack: MessageAck): Promise<void>;
  getStats(): MessageBusStats;
  getQueueDepth(): number;
}

export interface IAgentPool {
  initialize(config: AgentPoolConfig): Promise<void>;
  acquire(): Promise<AgentState | undefined>;
  release(agentId: string): Promise<void>;
  add(agent: AgentState): Promise<void>;
  remove(agentId: string): Promise<void>;
  scale(delta: number): Promise<void>;
  getState(): AgentPoolState;
  getAvailableCount(): number;
}

export interface IUnifiedSwarmCoordinator {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;

  // Agent management
  registerAgent(agent: Omit<AgentState, 'id'>): Promise<string>;
  unregisterAgent(agentId: string): Promise<void>;
  getAgent(agentId: string): AgentState | undefined;
  getAllAgents(): AgentState[];

  // Task management
  submitTask(task: Omit<TaskDefinition, 'id' | 'status' | 'createdAt'>): Promise<string>;
  cancelTask(taskId: string): Promise<void>;
  getTask(taskId: string): TaskDefinition | undefined;
  getAllTasks(): TaskDefinition[];

  // Coordination
  proposeConsensus(value: unknown): Promise<ConsensusResult>;
  broadcastMessage(payload: unknown, priority?: Message['priority']): Promise<void>;

  // Monitoring
  getState(): CoordinatorState;
  getMetrics(): CoordinatorMetrics;
  getPerformanceReport(): PerformanceReport;
}
