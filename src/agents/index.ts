/**
 * Agents Module Exports
 * Agent management and registry functionality
 */

// Agent Manager
export {
  AgentManager,
  type AgentManagerConfig,
  type AgentTemplate,
  type AgentCluster,
  type AgentPool,
  type ScalingPolicy,
  type ScalingRule,
  type AgentHealth,
  type HealthIssue
} from './agent-manager.js';

// Agent Registry
export {
  AgentRegistry,
  type AgentQuery,
  type AgentStatistics
} from './agent-registry.js';

// Agent Types
export type {
  AgentType,
  AgentStatus,
  AgentCapabilities,
  AgentMetrics,
  AgentState,
  AgentConfig,
  AgentId,
  AgentEnvironment,
  AgentError
} from '../swarm/types.js';