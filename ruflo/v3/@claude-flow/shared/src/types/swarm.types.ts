/**
 * V3 Swarm Types
 * Modernized type system for swarm coordination
 */

import type { ISwarmConfig, ISwarmState, SwarmTopology, CoordinationStatus } from '../core/interfaces/coordinator.interface.js';
import type { IAgent } from '../core/interfaces/agent.interface.js';

/**
 * Swarm initialization options
 */
export interface SwarmInitOptions extends ISwarmConfig {
  name?: string;
  description?: string;
  initialAgents?: string[];
  warmup?: boolean;
  warmupTasks?: number;
}

/**
 * Swarm initialization result
 */
export interface SwarmInitResult {
  state: ISwarmState;
  agents: IAgent[];
  startupTime: number;
  ready: boolean;
}

/**
 * Swarm scaling options
 */
export interface SwarmScaleOptions {
  targetSize: number;
  agentType?: string;
  timeout?: number;
  graceful?: boolean;
}

/**
 * Swarm scaling result
 */
export interface SwarmScaleResult {
  previousSize: number;
  currentSize: number;
  agentsAdded: string[];
  agentsRemoved: string[];
  duration: number;
  success: boolean;
}

/**
 * Swarm coordination message
 */
export interface SwarmMessage<T = unknown> {
  id: string;
  type: string;
  source: string;
  target?: string | 'broadcast';
  payload: T;
  timestamp: Date;
  correlationId?: string;
  replyTo?: string;
  ttl?: number;
}

/**
 * Swarm consensus request
 */
export interface ConsensusRequest<T = unknown> {
  topic: string;
  options: T[];
  requiredVotes: number | 'majority' | 'all';
  timeout: number;
  voters?: string[];
}

/**
 * Swarm consensus response
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
 * Distributed lock state
 */
export interface DistributedLock {
  resourceId: string;
  holderId: string;
  acquiredAt: Date;
  expiresAt: Date;
  renewCount: number;
}

/**
 * Lock acquisition result
 */
export interface LockAcquisitionResult {
  acquired: boolean;
  lock?: DistributedLock;
  waitTime?: number;
  error?: Error;
}

/**
 * Deadlock detection result
 */
export interface DeadlockDetectionResult {
  detected: boolean;
  agents: string[];
  resources: string[];
  cycle?: string[][];
  suggestedResolution?: string;
}

/**
 * Swarm metrics
 */
export interface SwarmMetrics {
  topology: SwarmTopology;
  status: CoordinationStatus;
  agentCount: number;
  activeAgentCount: number;
  taskCount: number;
  completedTasks: number;
  failedTasks: number;
  throughput: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  successRate: number;
  resourceUtilization: number;
  messagesSent: number;
  messagesReceived: number;
  consensusRounds: number;
  locksAcquired: number;
  deadlocksDetected: number;
  uptime: number;
  timestamp: Date;
}

/**
 * Swarm event payloads
 */
export interface SwarmEventPayloads {
  'swarm:initialized': {
    state: ISwarmState;
    config: ISwarmConfig;
  };
  'swarm:scaled': {
    result: SwarmScaleResult;
  };
  'swarm:topology:changed': {
    previousTopology: SwarmTopology;
    currentTopology: SwarmTopology;
  };
  'swarm:status:changed': {
    previousStatus: CoordinationStatus;
    currentStatus: CoordinationStatus;
  };
  'swarm:message:sent': {
    message: SwarmMessage;
  };
  'swarm:message:received': {
    message: SwarmMessage;
  };
  'swarm:consensus:started': {
    request: ConsensusRequest;
  };
  'swarm:consensus:completed': {
    response: ConsensusResponse;
  };
  'swarm:lock:acquired': {
    lock: DistributedLock;
  };
  'swarm:lock:released': {
    resourceId: string;
    holderId: string;
    duration: number;
  };
  'swarm:deadlock:detected': {
    result: DeadlockDetectionResult;
  };
  'swarm:shutdown': {
    reason: string;
    graceful: boolean;
  };
}

/**
 * Topology configuration presets
 */
export const TopologyPresets: Record<SwarmTopology, Partial<ISwarmConfig>> = {
  hierarchical: {
    topology: 'hierarchical',
    coordination: {
      consensusRequired: false,
      timeoutMs: 5000,
      retryPolicy: { maxRetries: 3, backoffMs: 1000 }
    }
  },
  mesh: {
    topology: 'mesh',
    coordination: {
      consensusRequired: true,
      timeoutMs: 10000,
      retryPolicy: { maxRetries: 5, backoffMs: 500 }
    }
  },
  ring: {
    topology: 'ring',
    coordination: {
      consensusRequired: true,
      timeoutMs: 8000,
      retryPolicy: { maxRetries: 4, backoffMs: 750 }
    }
  },
  star: {
    topology: 'star',
    coordination: {
      consensusRequired: false,
      timeoutMs: 3000,
      retryPolicy: { maxRetries: 2, backoffMs: 500 }
    }
  },
  adaptive: {
    topology: 'adaptive',
    autoScale: {
      enabled: true,
      minAgents: 1,
      maxAgents: 20,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.3
    },
    coordination: {
      consensusRequired: true,
      timeoutMs: 10000,
      retryPolicy: { maxRetries: 5, backoffMs: 500 }
    }
  },
  'hierarchical-mesh': {
    topology: 'hierarchical-mesh',
    coordination: {
      consensusRequired: true,
      timeoutMs: 8000,
      retryPolicy: { maxRetries: 4, backoffMs: 750 }
    }
  }
};
