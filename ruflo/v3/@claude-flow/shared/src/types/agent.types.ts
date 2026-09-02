/**
 * V3 Agent Types
 * Modernized type system with strict TypeScript
 */

import type { IAgent, IAgentConfig, IAgentSession, AgentStatus, AgentType } from '../core/interfaces/agent.interface.js';

/**
 * Agent profile - extended configuration for spawning
 */
export interface AgentProfile extends IAgentConfig {
  description?: string;
  systemPrompt?: string;
  tools?: string[];
  permissions?: AgentPermissions;
}

/**
 * Agent permissions for resource access
 */
export interface AgentPermissions {
  canSpawnAgents: boolean;
  canTerminateAgents: boolean;
  canAccessFiles: boolean;
  canExecuteCommands: boolean;
  canAccessNetwork: boolean;
  canAccessMemory: boolean;
  maxMemoryMb?: number;
  maxCpuPercent?: number;
  allowedPaths?: string[];
  blockedPaths?: string[];
}

/**
 * Agent spawn options
 */
export interface AgentSpawnOptions {
  timeout?: number;
  waitForReady?: boolean;
  retryOnFailure?: boolean;
  maxRetries?: number;
  parallel?: boolean;
}

/**
 * Agent spawn result
 */
export interface AgentSpawnResult {
  agent: IAgent;
  session: IAgentSession;
  startupTime: number;
  success: boolean;
  error?: Error;
}

/**
 * Agent termination options
 */
export interface AgentTerminationOptions {
  graceful?: boolean;
  timeout?: number;
  cancelTasks?: boolean;
  saveState?: boolean;
}

/**
 * Agent termination result
 */
export interface AgentTerminationResult {
  agentId: string;
  success: boolean;
  duration: number;
  tasksTerminated: number;
  error?: Error;
}

/**
 * Agent health check result
 */
export interface AgentHealthCheckResult {
  agentId: string;
  status: AgentStatus;
  healthy: boolean;
  lastActivity: Date;
  metrics: {
    tasksCompleted: number;
    tasksFailed: number;
    avgTaskDuration: number;
    errorRate: number;
    memoryUsageMb: number;
  };
  issues?: string[];
}

/**
 * Agent batch operation result
 */
export interface AgentBatchResult<T> {
  successful: T[];
  failed: Array<{ id: string; error: Error }>;
  totalDuration: number;
  parallelDegree: number;
}

/**
 * Agent type configuration map
 */
export type AgentTypeConfigMap = Record<AgentType | string, Partial<AgentProfile>>;

/**
 * Agent event payloads
 */
export interface AgentEventPayloads {
  'agent:spawned': {
    agentId: string;
    profile: AgentProfile;
    sessionId: string;
    parallel?: boolean;
  };
  'agent:terminated': {
    agentId: string;
    reason: string;
    duration?: number;
  };
  'agent:error': {
    agentId: string;
    error: Error;
    recoverable: boolean;
  };
  'agent:idle': {
    agentId: string;
    idleSince: Date;
  };
  'agent:busy': {
    agentId: string;
    taskCount: number;
  };
  'agent:health:changed': {
    agentId: string;
    previousStatus: AgentStatus;
    currentStatus: AgentStatus;
    issues?: string[];
  };
}
