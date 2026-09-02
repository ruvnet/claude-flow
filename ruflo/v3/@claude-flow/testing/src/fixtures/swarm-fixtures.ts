/**
 * @claude-flow/testing - Swarm Fixtures
 *
 * Comprehensive mock swarm configurations, topologies, and coordination fixtures.
 * Supports hierarchical-mesh, adaptive, and all consensus protocols.
 *
 * Based on ADR-003 (Single Coordination Engine) and V3 swarm specifications.
 */
import { vi, type Mock } from 'vitest';
import type { V3AgentType, AgentInstance, MockAgent, createMockAgent } from './agent-fixtures.js';

/**
 * Swarm topology types
 */
export type SwarmTopology =
  | 'hierarchical'
  | 'mesh'
  | 'ring'
  | 'star'
  | 'adaptive'
  | 'hierarchical-mesh';

/**
 * Consensus protocol types
 */
export type ConsensusProtocol = 'raft' | 'pbft' | 'gossip' | 'crdt' | 'byzantine';

/**
 * Coordination status types
 */
export type CoordinationStatus =
  | 'initializing'
  | 'active'
  | 'coordinating'
  | 'consensus'
  | 'error'
  | 'shutdown';

/**
 * Swarm configuration interface
 */
export interface SwarmConfig {
  topology: SwarmTopology;
  maxAgents: number;
  name?: string;
  description?: string;
  coordination: CoordinationConfig;
  communication: CommunicationConfig;
  autoScale?: AutoScaleConfig;
  healthCheck?: HealthCheckConfig;
}

/**
 * Coordination configuration
 */
export interface CoordinationConfig {
  consensusProtocol: ConsensusProtocol;
  heartbeatInterval: number;
  electionTimeout: number;
  consensusRequired?: boolean;
  timeoutMs?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
  };
}

/**
 * Communication configuration
 */
export interface CommunicationConfig {
  protocol: 'quic' | 'tcp' | 'websocket' | 'ipc';
  maxMessageSize: number;
  retryAttempts: number;
  compressionEnabled?: boolean;
  encryptionEnabled?: boolean;
}

/**
 * Auto-scale configuration
 */
export interface AutoScaleConfig {
  enabled: boolean;
  minAgents: number;
  maxAgents: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  cooldownMs?: number;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  enabled: boolean;
  interval: number;
  timeout: number;
  unhealthyThreshold: number;
  healthyThreshold: number;
}

/**
 * Swarm state interface
 */
export interface SwarmState {
  id: string;
  topology: SwarmTopology;
  status: CoordinationStatus;
  agentCount: number;
  activeAgentCount: number;
  leaderId?: string;
  createdAt: Date;
  lastHeartbeat?: Date;
}

/**
 * Swarm message interface
 */
export interface SwarmMessage<T = unknown> {
  id: string;
  from: string;
  to: string | 'broadcast';
  type: 'task' | 'result' | 'status' | 'coordination' | 'heartbeat' | 'election';
  payload: T;
  timestamp: Date;
  correlationId?: string;
  replyTo?: string;
  ttl?: number;
  priority?: number;
}

/**
 * Swarm task interface
 */
export interface SwarmTask {
  id: string;
  name: string;
  type: string;
  payload: unknown;
  priority: number;
  assignedTo?: string;
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';
  dependencies?: string[];
  deadline?: Date;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Swarm task result interface
 */
export interface SwarmTaskResult {
  taskId: string;
  agentId: string;
  success: boolean;
  output?: unknown;
  error?: Error;
  duration: number;
  metrics?: TaskMetrics;
}

/**
 * Task metrics interface
 */
export interface TaskMetrics {
  cpuTime: number;
  memoryUsage: number;
  ioOperations: number;
  networkCalls: number;
}

/**
 * Coordination result interface
 */
export interface CoordinationResult {
  success: boolean;
  completedTasks: number;
  failedTasks: number;
  totalDuration: number;
  agentMetrics: Map<string, AgentCoordinationMetrics>;
  consensusRounds?: number;
}

/**
 * Agent coordination metrics
 */
export interface AgentCoordinationMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  averageTaskDuration: number;
  messagesProcessed: number;
  totalDuration: number;
}

/**
 * Consensus request interface
 */
export interface ConsensusRequest<T = unknown> {
  topic: string;
  options: T[];
  requiredVotes: number | 'majority' | 'all';
  timeout: number;
  voters?: string[];
}

/**
 * Consensus response interface
 */
export interface ConsensusResponse<T = unknown> {
  topic: string;
  decision: T | null;
  votes: Map<string, T>;
  consensus: boolean;
  votingDuration: number;
  participatingAgents: string[];
}

/**
 * Pre-defined swarm configurations for testing
 */
export const swarmConfigs: Record<string, SwarmConfig> = {
  v3Default: {
    topology: 'hierarchical-mesh',
    maxAgents: 15,
    name: 'V3 Default Swarm',
    description: 'Standard V3 15-agent hierarchical-mesh swarm',
    coordination: {
      consensusProtocol: 'raft',
      heartbeatInterval: 1000,
      electionTimeout: 5000,
      consensusRequired: true,
      timeoutMs: 8000,
      retryPolicy: { maxRetries: 3, backoffMs: 1000 },
    },
    communication: {
      protocol: 'quic',
      maxMessageSize: 1048576, // 1MB
      retryAttempts: 3,
      compressionEnabled: true,
      encryptionEnabled: true,
    },
    autoScale: {
      enabled: true,
      minAgents: 5,
      maxAgents: 15,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.3,
      cooldownMs: 30000,
    },
    healthCheck: {
      enabled: true,
      interval: 5000,
      timeout: 2000,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
    },
  },

  minimal: {
    topology: 'mesh',
    maxAgents: 5,
    name: 'Minimal Swarm',
    description: 'Lightweight swarm for testing',
    coordination: {
      consensusProtocol: 'gossip',
      heartbeatInterval: 2000,
      electionTimeout: 10000,
      consensusRequired: false,
      timeoutMs: 5000,
      retryPolicy: { maxRetries: 5, backoffMs: 500 },
    },
    communication: {
      protocol: 'tcp',
      maxMessageSize: 65536, // 64KB
      retryAttempts: 5,
    },
  },

  highPerformance: {
    topology: 'adaptive',
    maxAgents: 50,
    name: 'High Performance Swarm',
    description: 'Optimized for maximum throughput',
    coordination: {
      consensusProtocol: 'pbft',
      heartbeatInterval: 500,
      electionTimeout: 3000,
      consensusRequired: true,
      timeoutMs: 5000,
      retryPolicy: { maxRetries: 2, backoffMs: 250 },
    },
    communication: {
      protocol: 'quic',
      maxMessageSize: 4194304, // 4MB
      retryAttempts: 2,
      compressionEnabled: true,
      encryptionEnabled: true,
    },
    autoScale: {
      enabled: true,
      minAgents: 10,
      maxAgents: 50,
      scaleUpThreshold: 0.7,
      scaleDownThreshold: 0.2,
      cooldownMs: 15000,
    },
  },

  byzantineFault: {
    topology: 'mesh',
    maxAgents: 7,
    name: 'Byzantine Fault Tolerant Swarm',
    description: 'Tolerant to malicious actors',
    coordination: {
      consensusProtocol: 'byzantine',
      heartbeatInterval: 1000,
      electionTimeout: 10000,
      consensusRequired: true,
      timeoutMs: 15000,
      retryPolicy: { maxRetries: 5, backoffMs: 2000 },
    },
    communication: {
      protocol: 'tcp',
      maxMessageSize: 1048576,
      retryAttempts: 3,
      encryptionEnabled: true,
    },
  },

  hierarchicalOnly: {
    topology: 'hierarchical',
    maxAgents: 20,
    name: 'Hierarchical Swarm',
    description: 'Pure hierarchical coordination',
    coordination: {
      consensusProtocol: 'raft',
      heartbeatInterval: 1000,
      electionTimeout: 5000,
      consensusRequired: false,
      timeoutMs: 5000,
      retryPolicy: { maxRetries: 3, backoffMs: 1000 },
    },
    communication: {
      protocol: 'websocket',
      maxMessageSize: 524288, // 512KB
      retryAttempts: 3,
    },
  },

  ringTopology: {
    topology: 'ring',
    maxAgents: 10,
    name: 'Ring Topology Swarm',
    description: 'Token-passing ring coordination',
    coordination: {
      consensusProtocol: 'gossip',
      heartbeatInterval: 1500,
      electionTimeout: 8000,
      consensusRequired: true,
      timeoutMs: 8000,
      retryPolicy: { maxRetries: 4, backoffMs: 750 },
    },
    communication: {
      protocol: 'tcp',
      maxMessageSize: 262144, // 256KB
      retryAttempts: 4,
    },
  },
};

/**
 * Pre-defined swarm states for testing
 */
export const swarmStates: Record<string, SwarmState> = {
  active: {
    id: 'swarm-001',
    topology: 'hierarchical-mesh',
    status: 'active',
    agentCount: 15,
    activeAgentCount: 15,
    leaderId: 'agent-queen-001',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    lastHeartbeat: new Date(),
  },

  initializing: {
    id: 'swarm-002',
    topology: 'mesh',
    status: 'initializing',
    agentCount: 5,
    activeAgentCount: 3,
    createdAt: new Date(),
  },

  coordinating: {
    id: 'swarm-003',
    topology: 'adaptive',
    status: 'coordinating',
    agentCount: 10,
    activeAgentCount: 10,
    leaderId: 'agent-coordinator-001',
    createdAt: new Date('2024-01-10T00:00:00Z'),
    lastHeartbeat: new Date(),
  },

  consensus: {
    id: 'swarm-004',
    topology: 'hierarchical-mesh',
    status: 'consensus',
    agentCount: 15,
    activeAgentCount: 14,
    leaderId: 'agent-queen-001',
    createdAt: new Date('2024-01-05T00:00:00Z'),
    lastHeartbeat: new Date(),
  },

  error: {
    id: 'swarm-005',
    topology: 'mesh',
    status: 'error',
    agentCount: 8,
    activeAgentCount: 3,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    lastHeartbeat: new Date(Date.now() - 60000), // 1 minute ago
  },

  shutdown: {
    id: 'swarm-006',
    topology: 'hierarchical',
    status: 'shutdown',
    agentCount: 10,
    activeAgentCount: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
  },
};

/**
 * Pre-defined swarm tasks for testing
 */
export const swarmTasks: Record<string, SwarmTask> = {
  securityScan: {
    id: 'task-security-001',
    name: 'Security Scan',
    type: 'security',
    payload: { target: './src', scanType: 'full', severity: 'high' },
    priority: 100,
    status: 'pending',
    createdAt: new Date(),
  },

  codeReview: {
    id: 'task-review-001',
    name: 'Code Review',
    type: 'review',
    payload: { files: ['src/main.ts'], rules: ['security', 'performance'] },
    priority: 80,
    status: 'assigned',
    assignedTo: 'agent-reviewer-001',
    createdAt: new Date(),
  },

  implementation: {
    id: 'task-impl-001',
    name: 'Feature Implementation',
    type: 'coding',
    payload: { feature: 'path-validation', module: 'security' },
    priority: 70,
    status: 'running',
    assignedTo: 'agent-coder-001',
    createdAt: new Date(Date.now() - 60000),
    startedAt: new Date(Date.now() - 30000),
  },

  testing: {
    id: 'task-test-001',
    name: 'Unit Testing',
    type: 'testing',
    payload: { framework: 'vitest', coverage: 0.90 },
    priority: 75,
    status: 'completed',
    assignedTo: 'agent-tester-001',
    createdAt: new Date(Date.now() - 120000),
    startedAt: new Date(Date.now() - 90000),
    completedAt: new Date(Date.now() - 30000),
  },

  orchestration: {
    id: 'task-orch-001',
    name: 'Task Orchestration',
    type: 'coordination',
    payload: { subtasks: ['task-impl-001', 'task-test-001'], parallel: true },
    priority: 90,
    status: 'running',
    assignedTo: 'agent-queen-001',
    dependencies: ['task-security-001'],
    createdAt: new Date(Date.now() - 180000),
    startedAt: new Date(Date.now() - 120000),
  },
};

/**
 * Pre-defined swarm messages for testing
 */
export const swarmMessages: Record<string, SwarmMessage> = {
  taskAssignment: {
    id: 'msg-001',
    from: 'agent-queen-001',
    to: 'agent-coder-001',
    type: 'task',
    payload: swarmTasks.implementation,
    timestamp: new Date(),
    correlationId: 'corr-001',
    priority: 70,
  },

  taskResult: {
    id: 'msg-002',
    from: 'agent-coder-001',
    to: 'agent-queen-001',
    type: 'result',
    payload: { taskId: 'task-impl-001', success: true, duration: 5000 },
    timestamp: new Date(),
    correlationId: 'corr-001',
    replyTo: 'msg-001',
  },

  heartbeat: {
    id: 'msg-003',
    from: 'agent-queen-001',
    to: 'broadcast',
    type: 'heartbeat',
    payload: { status: 'active', load: 0.6, taskCount: 5 },
    timestamp: new Date(),
    ttl: 5000,
  },

  election: {
    id: 'msg-004',
    from: 'agent-swarm-001',
    to: 'broadcast',
    type: 'election',
    payload: { term: 5, candidateId: 'agent-swarm-001', lastLogIndex: 100 },
    timestamp: new Date(),
    priority: 100,
  },

  coordination: {
    id: 'msg-005',
    from: 'agent-queen-001',
    to: 'agent-swarm-001',
    type: 'coordination',
    payload: { action: 'scale-up', targetAgents: 3 },
    timestamp: new Date(),
    correlationId: 'corr-002',
  },

  statusUpdate: {
    id: 'msg-006',
    from: 'agent-memory-001',
    to: 'agent-queen-001',
    type: 'status',
    payload: { status: 'busy', currentTask: 'indexing', progress: 0.75 },
    timestamp: new Date(),
  },
};

/**
 * Pre-defined coordination results for testing
 */
export const coordinationResults: Record<string, CoordinationResult> = {
  successful: {
    success: true,
    completedTasks: 10,
    failedTasks: 0,
    totalDuration: 15000,
    agentMetrics: new Map([
      ['agent-queen-001', { tasksCompleted: 3, tasksFailed: 0, averageTaskDuration: 200, messagesProcessed: 50, totalDuration: 600 }],
      ['agent-coder-001', { tasksCompleted: 4, tasksFailed: 0, averageTaskDuration: 2000, messagesProcessed: 20, totalDuration: 8000 }],
      ['agent-tester-001', { tasksCompleted: 3, tasksFailed: 0, averageTaskDuration: 1500, messagesProcessed: 15, totalDuration: 4500 }],
    ]),
    consensusRounds: 2,
  },

  partialFailure: {
    success: true,
    completedTasks: 8,
    failedTasks: 2,
    totalDuration: 20000,
    agentMetrics: new Map([
      ['agent-queen-001', { tasksCompleted: 2, tasksFailed: 0, averageTaskDuration: 250, messagesProcessed: 40, totalDuration: 500 }],
      ['agent-coder-001', { tasksCompleted: 4, tasksFailed: 1, averageTaskDuration: 2500, messagesProcessed: 25, totalDuration: 10000 }],
      ['agent-tester-001', { tasksCompleted: 2, tasksFailed: 1, averageTaskDuration: 2000, messagesProcessed: 18, totalDuration: 4000 }],
    ]),
    consensusRounds: 3,
  },

  failed: {
    success: false,
    completedTasks: 2,
    failedTasks: 8,
    totalDuration: 30000,
    agentMetrics: new Map([
      ['agent-queen-001', { tasksCompleted: 1, tasksFailed: 2, averageTaskDuration: 500, messagesProcessed: 60, totalDuration: 500 }],
      ['agent-coder-001', { tasksCompleted: 1, tasksFailed: 3, averageTaskDuration: 5000, messagesProcessed: 30, totalDuration: 5000 }],
    ]),
    consensusRounds: 5,
  },
};

/**
 * Factory function to create swarm config with overrides
 */
export function createSwarmConfig(
  base: keyof typeof swarmConfigs = 'v3Default',
  overrides?: Partial<SwarmConfig>
): SwarmConfig {
  return mergeDeep(swarmConfigs[base] as SwarmConfig & Record<string, unknown>, (overrides ?? {}) as Partial<SwarmConfig & Record<string, unknown>>);
}

/**
 * Factory function to create swarm state with overrides
 */
export function createSwarmState(
  base: keyof typeof swarmStates = 'active',
  overrides?: Partial<SwarmState>
): SwarmState {
  return {
    ...swarmStates[base],
    ...overrides,
    id: overrides?.id ?? swarmStates[base].id,
    createdAt: overrides?.createdAt ?? swarmStates[base].createdAt,
  };
}

/**
 * Factory function to create swarm task with overrides
 */
export function createSwarmTask(
  base: keyof typeof swarmTasks = 'implementation',
  overrides?: Partial<SwarmTask>
): SwarmTask {
  return {
    ...swarmTasks[base],
    ...overrides,
    id: overrides?.id ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: overrides?.createdAt ?? new Date(),
  };
}

/**
 * Factory function to create swarm message with overrides
 */
export function createSwarmMessage<T = unknown>(
  type: SwarmMessage['type'],
  payload: T,
  overrides?: Partial<SwarmMessage<T>>
): SwarmMessage<T> {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    from: 'agent-sender',
    to: 'agent-receiver',
    type,
    payload,
    timestamp: new Date(),
    ...overrides,
  };
}

/**
 * Factory function to create consensus request
 */
export function createConsensusRequest<T>(
  topic: string,
  options: T[],
  overrides?: Partial<ConsensusRequest<T>>
): ConsensusRequest<T> {
  return {
    topic,
    options,
    requiredVotes: 'majority',
    timeout: 5000,
    ...overrides,
  };
}

/**
 * Factory function to create coordination result
 */
export function createCoordinationResult(
  base: keyof typeof coordinationResults = 'successful',
  overrides?: Partial<CoordinationResult>
): CoordinationResult {
  return {
    ...coordinationResults[base],
    ...overrides,
  };
}

/**
 * Create a batch of swarm tasks for testing
 */
export function createSwarmTaskBatch(
  count: number,
  type: string = 'coding'
): SwarmTask[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `batch-task-${i}`,
    name: `Batch Task ${i + 1}`,
    type,
    payload: { index: i },
    priority: Math.floor(Math.random() * 100),
    status: 'pending' as const,
    createdAt: new Date(),
  }));
}

/**
 * Deep merge utility
 */
function mergeDeep<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const output = { ...target } as Record<string, unknown>;

  for (const key of Object.keys(source)) {
    const sourceValue = source[key as keyof T];
    if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
      output[key] = mergeDeep(
        (target[key as keyof T] as Record<string, unknown>) ?? {},
        sourceValue as Record<string, unknown>
      );
    } else {
      output[key] = sourceValue;
    }
  }

  return output as T;
}

/**
 * Invalid swarm configurations for error testing
 */
export const invalidSwarmConfigs = {
  zeroAgents: createSwarmConfig('v3Default', { maxAgents: 0 }),

  negativeHeartbeat: createSwarmConfig('v3Default', {
    coordination: {
      consensusProtocol: 'raft',
      heartbeatInterval: -100,
      electionTimeout: 5000,
    },
  }),

  invalidTopology: {
    ...swarmConfigs.v3Default,
    topology: 'invalid-topology' as SwarmTopology,
  },

  invalidProtocol: createSwarmConfig('v3Default', {
    coordination: {
      consensusProtocol: 'invalid-protocol' as ConsensusProtocol,
      heartbeatInterval: 1000,
      electionTimeout: 5000,
    },
  }),

  zeroMessageSize: createSwarmConfig('v3Default', {
    communication: {
      protocol: 'quic',
      maxMessageSize: 0,
      retryAttempts: 3,
    },
  }),
};

/**
 * Mock swarm coordinator interface
 */
export interface MockSwarmCoordinator {
  initialize: Mock<(config: SwarmConfig) => Promise<SwarmState>>;
  coordinate: Mock<(agents: string[], task: SwarmTask) => Promise<CoordinationResult>>;
  shutdown: Mock<(graceful?: boolean) => Promise<void>>;
  addAgent: Mock<(agentId: string) => Promise<void>>;
  removeAgent: Mock<(agentId: string) => Promise<void>>;
  getState: Mock<() => SwarmState>;
  broadcast: Mock<(message: SwarmMessage) => Promise<void>>;
  requestConsensus: Mock<<T>(request: ConsensusRequest<T>) => Promise<ConsensusResponse<T>>>;
}

/**
 * Create a mock swarm coordinator
 */
export function createMockSwarmCoordinator(): MockSwarmCoordinator {
  return {
    initialize: vi.fn().mockResolvedValue(swarmStates.active),
    coordinate: vi.fn().mockResolvedValue(coordinationResults.successful),
    shutdown: vi.fn().mockResolvedValue(undefined),
    addAgent: vi.fn().mockResolvedValue(undefined),
    removeAgent: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue(swarmStates.active),
    broadcast: vi.fn().mockResolvedValue(undefined),
    requestConsensus: vi.fn().mockResolvedValue({
      topic: 'test',
      decision: 'option-1',
      votes: new Map(),
      consensus: true,
      votingDuration: 100,
      participatingAgents: [],
    }),
  };
}

/**
 * Mock message bus interface
 */
export interface MockMessageBus {
  publish: Mock<(message: SwarmMessage) => Promise<void>>;
  subscribe: Mock<(pattern: string, handler: (message: SwarmMessage) => void) => () => void>;
  unsubscribe: Mock<(pattern: string) => void>;
  request: Mock<(message: SwarmMessage, timeout?: number) => Promise<SwarmMessage>>;
  getStats: Mock<() => { messagesSent: number; messagesReceived: number }>;
}

/**
 * Create a mock message bus
 */
export function createMockMessageBus(): MockMessageBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    unsubscribe: vi.fn(),
    request: vi.fn().mockResolvedValue(swarmMessages.taskResult),
    getStats: vi.fn().mockReturnValue({ messagesSent: 0, messagesReceived: 0 }),
  };
}
