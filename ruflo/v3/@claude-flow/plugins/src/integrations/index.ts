/**
 * Integrations Module
 *
 * Provides integration bridges for external systems:
 * - agentic-flow@alpha for swarm coordination
 * - AgentDB for vector storage and similarity search
 */

export {
  // Agentic Flow
  AgenticFlowBridge,
  getAgenticFlowBridge,
  AGENTIC_FLOW_EVENTS,
  type AgenticFlowConfig,
  type SwarmTopology,
  type AgentSpawnOptions,
  type SpawnedAgent,
  type TaskOrchestrationOptions,
  type OrchestrationResult,
  type AgenticFlowEvent,

  // AgentDB
  AgentDBBridge,
  getAgentDBBridge,
  resetBridges,
  type AgentDBConfig,
  type VectorEntry,
  type VectorSearchOptions,
  type VectorSearchResult,
} from './agentic-flow.js';
