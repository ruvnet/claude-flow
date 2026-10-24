/**
 * V3 Default Configuration Values
 */

import type {
  AgentConfig,
  TaskConfig,
  SwarmConfig,
  MemoryConfig,
  MCPServerConfig,
  OrchestratorConfig,
  SystemConfig,
} from './schema.js';

/**
 * Default agent configuration
 */
export const defaultAgentConfig: Partial<AgentConfig> = {
  capabilities: [],
  maxConcurrentTasks: 5,
  priority: 50,
  retryPolicy: {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
  },
};

/**
 * Default task configuration
 */
export const defaultTaskConfig: Partial<TaskConfig> = {
  priority: 50,
  metadata: {
    maxRetries: 3,
  },
};

/**
 * Default swarm configuration (core version)
 */
export const defaultSwarmConfigCore: SwarmConfig = {
  topology: 'hierarchical-mesh',
  maxAgents: 20,
  autoScale: {
    enabled: false,
    minAgents: 1,
    maxAgents: 20,
    scaleUpThreshold: 0.8,
    scaleDownThreshold: 0.3,
  },
  coordination: {
    consensusRequired: false,
    timeoutMs: 10000,
    retryPolicy: {
      maxRetries: 3,
      backoffMs: 500,
    },
  },
  communication: {
    protocol: 'events',
    batchSize: 10,
    flushIntervalMs: 100,
  },
};

/**
 * Default memory configuration (hybrid backend - ADR-009)
 */
export const defaultMemoryConfig: MemoryConfig = {
  type: 'hybrid',
  path: './data/memory',
  sqlite: {
    inMemory: false,
    wal: true,
  },
  agentdb: {
    dimensions: 1536,
    indexType: 'hnsw',
    efConstruction: 200,
    m: 16,
    quantization: 'none',
  },
  hybrid: {
    vectorThreshold: 100,
  },
};

/**
 * Default MCP server configuration
 */
export const defaultMCPServerConfig: MCPServerConfig = {
  name: 'claude-flow',
  version: '3.0.0',
  transport: {
    type: 'stdio',
  },
  capabilities: {
    tools: true,
    resources: true,
    prompts: true,
    logging: true,
  },
};

/**
 * Default orchestrator configuration
 */
export const defaultOrchestratorConfig: OrchestratorConfig = {
  session: {
    persistSessions: true,
    dataDir: './data',
    sessionRetentionMs: 3600000, // 1 hour
  },
  health: {
    checkInterval: 30000, // 30 seconds
    historyLimit: 100,
    degradedThreshold: 1,
    unhealthyThreshold: 2,
  },
  lifecycle: {
    maxConcurrentAgents: 20,
    spawnTimeout: 30000, // 30 seconds
    terminateTimeout: 10000, // 10 seconds
    maxSpawnRetries: 3,
  },
};

/**
 * Default full system configuration
 */
export const defaultSystemConfig: SystemConfig = {
  orchestrator: defaultOrchestratorConfig,
  memory: defaultMemoryConfig,
  mcp: defaultMCPServerConfig,
  swarm: defaultSwarmConfigCore,
};

/**
 * Agent type presets
 */
export const agentTypePresets: Record<string, Partial<AgentConfig>> = {
  coder: {
    type: 'coder',
    capabilities: ['code', 'debug', 'refactor', 'test'],
    maxConcurrentTasks: 3,
    priority: 70,
  },
  reviewer: {
    type: 'reviewer',
    capabilities: ['review', 'analyze', 'suggest'],
    maxConcurrentTasks: 5,
    priority: 60,
  },
  tester: {
    type: 'tester',
    capabilities: ['test', 'validate', 'benchmark'],
    maxConcurrentTasks: 4,
    priority: 65,
  },
  researcher: {
    type: 'researcher',
    capabilities: ['research', 'analyze', 'summarize'],
    maxConcurrentTasks: 3,
    priority: 50,
  },
  planner: {
    type: 'planner',
    capabilities: ['plan', 'organize', 'decompose'],
    maxConcurrentTasks: 2,
    priority: 80,
  },
  architect: {
    type: 'architect',
    capabilities: ['design', 'architecture', 'patterns'],
    maxConcurrentTasks: 2,
    priority: 85,
  },
  coordinator: {
    type: 'coordinator',
    capabilities: ['coordinate', 'delegate', 'monitor'],
    maxConcurrentTasks: 10,
    priority: 90,
  },
  security: {
    type: 'security',
    capabilities: ['audit', 'scan', 'validate', 'secure'],
    maxConcurrentTasks: 3,
    priority: 95,
  },
  performance: {
    type: 'performance',
    capabilities: ['benchmark', 'optimize', 'profile'],
    maxConcurrentTasks: 2,
    priority: 70,
  },
};

/**
 * Get merged configuration with defaults
 */
export function mergeWithDefaults<T extends Record<string, unknown>>(
  config: Partial<T>,
  defaults: T,
): T {
  return { ...defaults, ...config } as T;
}
