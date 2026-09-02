/**
 * V3 Claude-Flow Shared Types
 * Core type definitions for the 15-agent swarm coordination system
 *
 * Based on ADR-002 (DDD) and ADR-003 (Single Coordination Engine)
 */

// =============================================================================
// Agent Types
// =============================================================================

export type AgentId = `agent-${number}` | string;

export type AgentRole =
  | 'queen-coordinator'      // Agent #1
  | 'security-architect'     // Agent #2
  | 'security-implementer'   // Agent #3
  | 'security-tester'        // Agent #4
  | 'core-architect'         // Agent #5
  | 'core-implementer'       // Agent #6
  | 'memory-specialist'      // Agent #7
  | 'swarm-specialist'       // Agent #8
  | 'mcp-specialist'         // Agent #9
  | 'integration-architect'  // Agent #10
  | 'cli-hooks-developer'    // Agent #11
  | 'neural-learning-dev'    // Agent #12
  | 'tdd-test-engineer'      // Agent #13
  | 'performance-engineer'   // Agent #14
  | 'release-engineer';      // Agent #15

export type AgentStatus =
  | 'idle'
  | 'active'
  | 'blocked'
  | 'completed'
  | 'error';

export type AgentDomain =
  | 'security'      // Agents #2-4
  | 'core'          // Agents #5-9
  | 'integration'   // Agents #10-12
  | 'quality'       // Agent #13
  | 'performance'   // Agent #14
  | 'deployment';   // Agent #15

export interface AgentCapability {
  name: string;
  description: string;
  supportedTaskTypes: TaskType[];
}

export interface AgentDefinition {
  id: AgentId;
  role: AgentRole;
  domain: AgentDomain;
  description: string;
  capabilities: AgentCapability[];
  dependencies: AgentId[];
  priority: number;
}

export interface AgentState {
  id: AgentId;
  role: AgentRole;
  status: AgentStatus;
  currentTask: TaskId | null;
  completedTasks: TaskId[];
  metrics: AgentMetrics;
  lastHeartbeat: number;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  averageTaskDuration: number;
  utilization: number;
  startTime: number;
}

// =============================================================================
// Task Types
// =============================================================================

export type TaskId = `task-${string}`;

export type TaskType =
  | 'security-audit'
  | 'security-fix'
  | 'security-test'
  | 'architecture-design'
  | 'implementation'
  | 'memory-optimization'
  | 'swarm-coordination'
  | 'mcp-enhancement'
  | 'integration'
  | 'cli-development'
  | 'neural-training'
  | 'test-writing'
  | 'benchmark'
  | 'deployment'
  | 'documentation';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'assigned'
  | 'in-progress'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low';

export interface TaskDefinition {
  id: TaskId;
  type: TaskType;
  title: string;
  description: string;
  assignedAgent: AgentId | null;
  status: TaskStatus;
  priority: TaskPriority;
  dependencies: TaskId[];
  blockedBy: TaskId[];
  metadata: TaskMetadata;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface TaskMetadata {
  domain: AgentDomain;
  phase: PhaseId;
  estimatedDuration: number;
  actualDuration: number | null;
  retryCount: number;
  maxRetries: number;
  artifacts: string[];
  tags: string[];
}

export interface TaskResult {
  taskId: TaskId;
  success: boolean;
  output: unknown;
  error: Error | null;
  duration: number;
  metrics: TaskResultMetrics;
}

export interface TaskResultMetrics {
  linesOfCode: number;
  testsWritten: number;
  testsPassed: number;
  coveragePercent: number;
  performanceImpact: number;
}

// =============================================================================
// Phase Types
// =============================================================================

export type PhaseId =
  | 'phase-1-foundation'
  | 'phase-2-core'
  | 'phase-3-integration'
  | 'phase-4-release';

export interface PhaseDefinition {
  id: PhaseId;
  name: string;
  description: string;
  weeks: [number, number];
  activeAgents: AgentId[];
  goals: string[];
  milestones: MilestoneDefinition[];
}

export interface MilestoneDefinition {
  id: string;
  name: string;
  description: string;
  criteria: MilestoneCriteria[];
  status: MilestoneStatus;
  completedAt: number | null;
}

export type MilestoneStatus = 'pending' | 'in-progress' | 'completed' | 'blocked';

export interface MilestoneCriteria {
  description: string;
  met: boolean;
  evidence: string | null;
}

// =============================================================================
// Swarm Types
// =============================================================================

export type TopologyType =
  | 'hierarchical-mesh'
  | 'mesh'
  | 'hierarchical'
  | 'centralized';

export interface SwarmConfig {
  topology: TopologyType;
  maxAgents: number;
  messageTimeout: number;
  retryAttempts: number;
  healthCheckInterval: number;
  loadBalancingStrategy: LoadBalancingStrategy;
}

export type LoadBalancingStrategy =
  | 'round-robin'
  | 'least-loaded'
  | 'capability-match'
  | 'priority-based';

export interface SwarmState {
  initialized: boolean;
  topology: TopologyType;
  agents: Map<AgentId, AgentState>;
  tasks: Map<TaskId, TaskDefinition>;
  currentPhase: PhaseId;
  metrics: SwarmMetrics;
}

export interface SwarmMetrics {
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
  blockedAgents: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  averageTaskDuration: number;
  utilization: number;
  startTime: number;
  lastUpdate: number;
}

// =============================================================================
// Event Types
// =============================================================================

export type EventType =
  | 'agent:spawned'
  | 'agent:status-changed'
  | 'agent:task-assigned'
  | 'agent:task-completed'
  | 'agent:error'
  | 'task:created'
  | 'task:queued'
  | 'task:assigned'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:blocked'
  | 'swarm:initialized'
  | 'swarm:phase-changed'
  | 'swarm:milestone-reached'
  | 'swarm:error';

export interface SwarmEvent<T = unknown> {
  id: string;
  type: EventType;
  timestamp: number;
  source: AgentId | 'swarm';
  payload: T;
}

export type EventHandler<T = unknown> = (event: SwarmEvent<T>) => void | Promise<void>;

// =============================================================================
// Message Types
// =============================================================================

export type MessageType =
  | 'task_assignment'
  | 'task_complete'
  | 'task_failed'
  | 'dependency_ready'
  | 'review_request'
  | 'status_update'
  | 'heartbeat'
  | 'broadcast';

export interface SwarmMessage<T = unknown> {
  id: string;
  type: MessageType;
  from: AgentId;
  to: AgentId | 'broadcast';
  payload: T;
  timestamp: number;
  correlationId: string | null;
}

export type MessageHandler<T = unknown> = (message: SwarmMessage<T>) => void | Promise<void>;

// =============================================================================
// Performance Targets
// =============================================================================

export interface PerformanceTargets {
  flashAttention: {
    minSpeedup: number;
    maxSpeedup: number;
  };
  agentDbSearch: {
    minSpeedup: number;
    maxSpeedup: number;
  };
  memoryReduction: {
    minPercent: number;
    maxPercent: number;
  };
  codeReduction: {
    targetLines: number;
    currentLines: number;
  };
  startupTime: {
    targetMs: number;
  };
  sonaLearning: {
    targetMs: number;
  };
}

export const V3_PERFORMANCE_TARGETS: PerformanceTargets = {
  flashAttention: { minSpeedup: 2.49, maxSpeedup: 7.47 },
  agentDbSearch: { minSpeedup: 150, maxSpeedup: 12500 },
  memoryReduction: { minPercent: 50, maxPercent: 75 },
  codeReduction: { targetLines: 5000, currentLines: 15000 },
  startupTime: { targetMs: 500 },
  sonaLearning: { targetMs: 0.05 }
};

// =============================================================================
// Utility Types
// =============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type AsyncCallback<T = void> = () => Promise<T>;

export interface Result<T, E = Error> {
  success: boolean;
  value?: T;
  error?: E;
}

export function success<T>(value: T): Result<T> {
  return { success: true, value };
}

export function failure<E = Error>(error: E): Result<never, E> {
  return { success: false, error };
}
