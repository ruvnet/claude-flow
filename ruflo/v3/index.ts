/**
 * Claude Flow V3 - Modular AI Agent Coordination System
 *
 * This is the main entry point that re-exports all @claude-flow modules.
 * Each module can also be imported directly for tree-shaking.
 *
 * @example
 * // Import everything
 * import * as claudeFlow from '@claude-flow/v3';
 *
 * // Or import specific modules
 * import { UnifiedSwarmCoordinator } from '@claude-flow/swarm';
 * import { PasswordHasher } from '@claude-flow/security';
 * import { HNSWIndex } from '@claude-flow/memory';
 *
 * Complete reimagining based on 10 ADRs:
 * - ADR-001: Adopt agentic-flow as core foundation
 * - ADR-002: Domain-Driven Design structure
 * - ADR-003: Single coordination engine
 * - ADR-004: Plugin-based architecture
 * - ADR-005: MCP-first API design
 * - ADR-006: Unified memory service
 * - ADR-007: Event sourcing for state changes
 * - ADR-008: Vitest over Jest
 * - ADR-009: Hybrid memory backend default
 * - ADR-010: Remove Deno support (Node.js 20+ only)
 *
 * Performance Targets:
 * - Flash Attention: 2.49x-7.47x speedup
 * - AgentDB Search: 150x-12,500x improvement
 * - Memory Reduction: 50-75%
 * - Code Reduction: <5,000 lines (vs 15,000+)
 * - Startup Time: <500ms
 *
 * @module @claude-flow/v3
 * @version 3.0.0-alpha.1
 */

// =============================================================================
// @claude-flow Module Exports (New Modular Architecture)
// =============================================================================

/**
 * Security module - CVE fixes, input validation, credential management
 * @see {@link @claude-flow/security}
 */
export * as security from './@claude-flow/security/src/index.js';

/**
 * Memory module - AgentDB, HNSW indexing, vector search
 * @see {@link @claude-flow/memory}
 */
export * as memory from './@claude-flow/memory/src/index.js';

/**
 * Swarm module - 15-agent coordination, hierarchical mesh, consensus
 * @see {@link @claude-flow/swarm}
 */
export * as swarm from './@claude-flow/swarm/src/index.js';

/**
 * Integration module - agentic-flow@alpha integration, ADR-001 compliance
 * @see {@link @claude-flow/integration}
 */
export * as integration from './@claude-flow/integration/src/index.js';

/**
 * Shared module - common types, events, utilities, core interfaces
 * @see {@link @claude-flow/shared}
 */
export * as shared from './@claude-flow/shared/src/index.js';

/**
 * CLI module - Command parsing, prompts, output formatting
 * @see {@link @claude-flow/cli}
 */
export * as cli from './@claude-flow/cli/src/index.js';

/**
 * Neural module - SONA learning, neural modes
 * @see {@link @claude-flow/neural}
 */
export * as neural from './@claude-flow/neural/src/index.js';

/**
 * Performance module - Benchmarking, Flash Attention validation
 * @see {@link @claude-flow/performance}
 */
export * as performance from './@claude-flow/performance/src/index.js';

/**
 * Testing module - TDD London School framework, test utilities
 * @see {@link @claude-flow/testing}
 */
export * as testing from './@claude-flow/testing/src/index.js';

/**
 * Deployment module - Release management, CI/CD
 * @see {@link @claude-flow/deployment}
 */
export * as deployment from './@claude-flow/deployment/src/index.js';

// =============================================================================
// Module List for Dynamic Loading
// =============================================================================

export const MODULES = [
  '@claude-flow/shared',
  '@claude-flow/security',
  '@claude-flow/memory',
  '@claude-flow/swarm',
  '@claude-flow/integration',
  '@claude-flow/cli',
  '@claude-flow/neural',
  '@claude-flow/performance',
  '@claude-flow/testing',
  '@claude-flow/deployment',
] as const;

export type ModuleName = (typeof MODULES)[number];

// =============================================================================
// Legacy Compatibility Layer (Gradual Migration Support)
// =============================================================================

// =============================================================================
// V3 Core Architecture (Decomposed Orchestrator)
// =============================================================================

// Core Interfaces
export type {
  // Task interfaces
  ITask,
  ITaskCreate,
  ITaskResult,
  ITaskManager,
  ITaskQueue,
  TaskManagerMetrics,

  // Agent interfaces
  IAgent,
  IAgentConfig,
  IAgentSession,
  IAgentPool,
  IAgentLifecycleManager,
  IAgentRegistry,
  IAgentCapability,

  // Event interfaces
  IEvent,
  IEventCreate,
  IEventBus as IEventBusCore,
  IEventHandler,
  IEventSubscription,
  IEventFilter,
  IEventStore,
  IEventCoordinator,

  // Memory interfaces
  IMemoryEntry,
  IMemoryEntryCreate,
  IMemoryBackend,
  IVectorMemoryBackend,
  IMemoryBank,
  IMemoryManager,
  IPatternStorage,
  IVectorSearchParams,
  IVectorSearchResult,

  // Coordinator interfaces
  ISwarmConfig,
  ISwarmState,
  ICoordinator,
  ICoordinationManager,
  IHealthMonitor,
  IMetricsCollector,
  IHealthStatus,
  IComponentHealth,
  IOrchestratorMetrics,
} from './core/interfaces/index.js';

export { SystemEventTypes } from './core/interfaces/event.interface.js';

// Orchestrator Components
export {
  // Task management
  TaskManager,
  TaskQueue,

  // Session management
  SessionManager,
  type ISessionManager,
  type SessionManagerConfig,
  type SessionPersistence,

  // Health monitoring
  HealthMonitor,
  type HealthMonitorConfig,
  type HealthCheckFn,

  // Lifecycle management
  LifecycleManager,
  AgentPool,
  type LifecycleManagerConfig,

  // Event coordination
  EventCoordinator,

  // Factory function
  createOrchestrator,
  defaultOrchestratorConfig,
  type OrchestratorConfig,
  type OrchestratorComponents,
} from './core/orchestrator/index.js';

// Event Bus
export { EventBus as EventBusCore, createEventBus } from './core/event-bus.js';

// Configuration
export {
  // Schemas
  AgentConfigSchema,
  TaskConfigSchema,
  SwarmConfigSchema,
  MemoryConfigSchema,
  MCPServerConfigSchema,
  OrchestratorConfigSchema,
  SystemConfigSchema,

  // Validation
  validateAgentConfig,
  validateTaskConfig,
  validateSwarmConfig,
  validateMemoryConfig,
  validateMCPServerConfig,
  validateOrchestratorConfig,
  validateSystemConfig,
  ConfigValidator,
  type ValidationResult,
  type ValidationError,

  // Defaults
  defaultAgentConfig,
  defaultTaskConfig,
  defaultSwarmConfigCore,
  defaultMemoryConfig,
  defaultMCPServerConfig,
  defaultSystemConfig,
  agentTypePresets,
  mergeWithDefaults,

  // Loader
  ConfigLoader,
  loadConfig,
  type LoadedConfig,
  type ConfigSource,
} from './core/config/index.js';

// V3 Extended Types
export type {
  // Agent types
  AgentProfile,
  AgentPermissions,
  AgentSpawnOptions,
  AgentSpawnResult,
  AgentTerminationOptions,
  AgentTerminationResult,
  AgentHealthCheckResult,
  AgentBatchResult,
  AgentEventPayloads,

  // Task types
  TaskInput,
  TaskMetadata as TaskMetadataExtended,
  TaskExecutionContext,
  TaskExecutionResult,
  TaskArtifact,
  TaskQueueConfig,
  TaskAssignmentConfig,
  TaskRetryPolicy,
  TaskFilter,
  TaskSortOptions,
  TaskQueryOptions,
  TaskEventPayloads,

  // Swarm types
  SwarmInitOptions,
  SwarmInitResult,
  SwarmScaleOptions,
  SwarmScaleResult,
  SwarmMessage,
  ConsensusRequest,
  ConsensusResponse,
  DistributedLock,
  LockAcquisitionResult,
  DeadlockDetectionResult,
  SwarmMetrics as SwarmMetricsExtended,
  SwarmEventPayloads,

  // Memory types
  MemoryBackendConfig,
  MemoryStoreOptions,
  MemoryRetrieveOptions,
  MemoryListOptions,
  MemorySearchOptions,
  MemoryBatchOperation,
  MemoryBatchResult,
  MemoryStats,
  MemoryBankStats,
  LearnedPattern,
  PatternSearchResult,
  MemoryEventPayloads,
  CacheConfig,
  VectorIndexConfig,
  FlashAttentionConfig,

  // MCP types
  MCPTool,
  MCPToolHandler,
  MCPToolResult,
  MCPContent,
  MCPServerConfig as MCPServerConfigExtended,
  MCPTransportConfig,
  MCPResource,
  MCPPrompt,
  MCPCapabilities,
  MCPRequest,
  MCPResponse,
  MCPError,
  MCPEventPayloads,
  MCPServerStatus,
} from './types/index.js';

export {
  priorityToNumber,
  numberToPriority,
  TopologyPresets,
} from './types/index.js';

// =============================================================================
// Legacy/Shared Exports (Preserved for Backward Compatibility)
// =============================================================================

// Shared Types
export type {
  AgentId,
  AgentRole,
  AgentDomain,
  AgentStatus,
  AgentDefinition,
  AgentState,
  AgentCapability,
  AgentMetrics,
  TaskId,
  TaskType,
  TaskStatus,
  TaskPriority,
  TaskDefinition,
  TaskMetadata,
  TaskResult,
  TaskResultMetrics,
  PhaseId,
  PhaseDefinition,
  MilestoneDefinition,
  MilestoneStatus,
  MilestoneCriteria,
  TopologyType,
  SwarmConfig,
  SwarmState,
  SwarmMetrics,
  EventType,
  SwarmEvent,
  EventHandler,
  MessageType,
  SwarmMessage,
  MessageHandler,
  PerformanceTargets,
  DeepPartial,
  AsyncCallback,
  Result
} from './shared/types';

export {
  V3_PERFORMANCE_TARGETS,
  success,
  failure
} from './shared/types';

// Event System
export type {
  IEventBus,
  IEventStore,
  EventFilter,
  EventStoreSnapshot
} from './shared/events';

export {
  EventBus,
  InMemoryEventStore,
  createEvent,
  agentSpawnedEvent,
  agentStatusChangedEvent,
  agentTaskAssignedEvent,
  agentTaskCompletedEvent,
  agentErrorEvent,
  taskCreatedEvent,
  taskQueuedEvent,
  taskAssignedEvent,
  taskStartedEvent,
  taskCompletedEvent,
  taskFailedEvent,
  taskBlockedEvent,
  swarmInitializedEvent,
  swarmPhaseChangedEvent,
  swarmMilestoneReachedEvent,
  swarmErrorEvent
} from './shared/events';

// Agent Registry
export type {
  IAgentRegistry,
  HealthStatus
} from './coordination/agent-registry';

export {
  AgentRegistry,
  createAgentRegistry
} from './coordination/agent-registry';

// Task Orchestrator
export type {
  ITaskOrchestrator,
  TaskSpec,
  TaskOrchestratorMetrics
} from './coordination/task-orchestrator';

export {
  TaskOrchestrator,
  createTaskOrchestrator
} from './coordination/task-orchestrator';

// Swarm Hub
export type {
  ISwarmHub
} from './coordination/swarm-hub';

export {
  SwarmHub,
  createSwarmHub,
  getSwarmHub,
  resetSwarmHub
} from './coordination/swarm-hub';

// Configuration
export type {
  V3SwarmConfig,
  DomainConfig,
  PhaseConfig,
  GitHubConfig,
  LoggingConfig,
  TopologyConfig
} from './swarm.config';

export {
  defaultSwarmConfig,
  agentRoleMapping,
  getAgentsByDomain,
  getAgentConfig,
  getPhaseConfig,
  getActiveAgentsForPhase,
  createCustomConfig,
  topologyConfigs,
  getTopologyConfig
} from './swarm.config';

// =============================================================================
// Quick Start Functions
// =============================================================================

/**
 * Initialize the V3 swarm with default configuration
 *
 * @example
 * ```typescript
 * import { initializeV3Swarm } from './v3';
 *
 * const swarm = await initializeV3Swarm();
 * await swarm.spawnAllAgents();
 *
 * // Submit a task
 * const task = swarm.submitTask({
 *   type: 'implementation',
 *   title: 'Implement feature X',
 *   description: 'Detailed description...',
 *   domain: 'core',
 *   phase: 'phase-2-core',
 *   priority: 'high'
 * });
 * ```
 */
export async function initializeV3Swarm(config?: Partial<SwarmConfig>): Promise<ISwarmHub> {
  const { createSwarmHub } = await import('./coordination/swarm-hub');
  const swarm = createSwarmHub();
  await swarm.initialize(config);
  return swarm;
}

/**
 * Get the current V3 swarm instance
 * Creates a new one if none exists
 */
export async function getOrCreateSwarm(): Promise<ISwarmHub> {
  const { getSwarmHub } = await import('./coordination/swarm-hub');
  const swarm = getSwarmHub();

  if (!swarm.isInitialized()) {
    await swarm.initialize();
  }

  return swarm;
}

// =============================================================================
// Version Info
// =============================================================================

export const V3_VERSION = {
  major: 3,
  minor: 0,
  patch: 0,
  prerelease: 'alpha',
  full: '3.0.0-alpha',
  buildDate: new Date().toISOString()
};

export const V3_INFO = {
  name: 'claude-flow',
  version: V3_VERSION.full,
  description: 'Complete reimagining of Claude-Flow with 15-agent hierarchical mesh swarm',
  repository: 'https://github.com/ruvnet/claude-flow',
  license: 'MIT',
  engines: {
    node: '>=20.0.0'
  },
  features: [
    'agentic-flow integration (ADR-001)',
    'Domain-Driven Design (ADR-002)',
    'Single coordination engine (ADR-003)',
    'Plugin architecture (ADR-004)',
    'MCP-first API (ADR-005)',
    'Unified memory service (ADR-006)',
    'Event sourcing (ADR-007)',
    'Vitest testing (ADR-008)',
    'Hybrid memory backend (ADR-009)',
    'Node.js 20+ focus (ADR-010)'
  ],
  performanceTargets: {
    flashAttention: '2.49x-7.47x speedup',
    agentDbSearch: '150x-12,500x improvement',
    memoryReduction: '50-75%',
    codeReduction: '<5,000 lines',
    startupTime: '<500ms'
  },
  agents: {
    total: 15,
    topology: 'hierarchical-mesh',
    domains: ['security', 'core', 'integration', 'quality', 'performance', 'deployment']
  }
};

// =============================================================================
// Default Export
// =============================================================================

import type { ISwarmHub } from './coordination/swarm-hub';
import type { SwarmConfig } from './shared/types';
import { V3_PERFORMANCE_TARGETS as PERF_TARGETS } from './shared/types';

export default {
  // Quick start
  initializeV3Swarm,
  getOrCreateSwarm,

  // Version info
  version: V3_VERSION,
  info: V3_INFO,

  // Performance targets
  performanceTargets: PERF_TARGETS
};
