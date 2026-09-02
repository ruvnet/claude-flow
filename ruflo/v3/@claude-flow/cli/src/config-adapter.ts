/**
 * Configuration Adapter
 * Converts between SystemConfig and V3Config types
 */

import type { SystemConfig } from '@claude-flow/shared';
import type { V3Config } from './types.js';

/**
 * Convert SystemConfig to V3Config (CLI-specific format)
 */
export function systemConfigToV3Config(systemConfig: SystemConfig): V3Config {
  return {
    version: '3.0.0',
    projectRoot: systemConfig.orchestrator?.session?.dataDir || process.cwd(),

    // Agent configuration
    agents: {
      defaultType: 'coder',
      autoSpawn: false, // Not in SystemConfig
      maxConcurrent: systemConfig.orchestrator?.lifecycle?.maxConcurrentAgents ?? 15,
      timeout: systemConfig.orchestrator?.lifecycle?.spawnTimeout ?? 300000,
      providers: [],
    },

    // Swarm configuration
    swarm: {
      topology: normalizeTopology(systemConfig.swarm?.topology),
      maxAgents: systemConfig.swarm?.maxAgents ?? 15,
      autoScale: systemConfig.swarm?.autoScale?.enabled ?? false,
      coordinationStrategy: systemConfig.swarm?.coordination?.consensusRequired ? 'consensus' : 'leader',
      healthCheckInterval: systemConfig.swarm?.coordination?.timeoutMs ?? 10000,
    },

    // Memory configuration
    memory: {
      backend: normalizeMemoryBackend(systemConfig.memory?.type),
      persistPath: systemConfig.memory?.path || './data/memory',
      cacheSize: systemConfig.memory?.maxSize ?? 1000000,
      enableHNSW: systemConfig.memory?.agentdb?.indexType === 'hnsw',
      vectorDimension: systemConfig.memory?.agentdb?.dimensions ?? 1536,
    },

    // MCP configuration
    mcp: {
      serverHost: systemConfig.mcp?.transport?.host || 'localhost',
      serverPort: systemConfig.mcp?.transport?.port ?? 3000,
      autoStart: false, // Not in SystemConfig
      transportType: systemConfig.mcp?.transport?.type || 'stdio',
      tools: [], // Not in SystemConfig
    },

    // CLI preferences
    cli: {
      colorOutput: true,
      interactive: true,
      verbosity: 'normal',
      outputFormat: 'text',
      progressStyle: 'spinner',
    },

    // Hooks configuration
    hooks: {
      enabled: false,
      autoExecute: false,
      hooks: [],
    },
  };
}

/**
 * Convert V3Config to SystemConfig
 */
export function v3ConfigToSystemConfig(v3Config: V3Config): Partial<SystemConfig> {
  return {
    orchestrator: {
      lifecycle: {
        maxConcurrentAgents: v3Config.agents.maxConcurrent,
        spawnTimeout: v3Config.agents.timeout,
        terminateTimeout: 10000,
        maxSpawnRetries: 3,
      },
      session: {
        dataDir: v3Config.projectRoot,
        persistSessions: true,
        sessionRetentionMs: 3600000,
      },
      health: {
        checkInterval: v3Config.swarm.healthCheckInterval,
        historyLimit: 100,
        degradedThreshold: 1,
        unhealthyThreshold: 2,
      },
    },

    swarm: {
      topology: denormalizeTopology(v3Config.swarm.topology),
      maxAgents: v3Config.swarm.maxAgents,
      autoScale: {
        enabled: v3Config.swarm.autoScale,
        minAgents: 1,
        maxAgents: v3Config.swarm.maxAgents,
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.3,
      },
      coordination: {
        consensusRequired: v3Config.swarm.coordinationStrategy === 'consensus',
        timeoutMs: v3Config.swarm.healthCheckInterval,
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
    },

    memory: {
      type: denormalizeMemoryBackend(v3Config.memory.backend),
      path: v3Config.memory.persistPath,
      maxSize: v3Config.memory.cacheSize,
      agentdb: {
        dimensions: v3Config.memory.vectorDimension,
        indexType: v3Config.memory.enableHNSW ? 'hnsw' : 'flat',
        efConstruction: 200,
        m: 16,
        quantization: 'none',
      },
    },

    mcp: {
      name: 'claude-flow',
      version: '3.0.0',
      transport: {
        type: v3Config.mcp.transportType as 'stdio' | 'http' | 'websocket',
        host: v3Config.mcp.serverHost,
        port: v3Config.mcp.serverPort,
      },
      capabilities: {
        tools: true,
        resources: true,
        prompts: true,
        logging: true,
      },
    },
  };
}

/**
 * Normalize topology from SystemConfig to V3Config
 */
function normalizeTopology(
  topology: string | undefined
): 'hierarchical' | 'mesh' | 'ring' | 'star' | 'hybrid' | 'hierarchical-mesh' {
  switch (topology) {
    case 'hierarchical':
    case 'mesh':
    case 'ring':
    case 'star':
    case 'hybrid':
    case 'hierarchical-mesh':
      return topology;
    case 'adaptive':
      return 'hybrid';
    default:
      return 'hierarchical';
  }
}

/**
 * Denormalize topology from V3Config to SystemConfig
 */
function denormalizeTopology(
  topology: 'hierarchical' | 'mesh' | 'ring' | 'star' | 'hybrid' | 'hierarchical-mesh'
): 'hierarchical' | 'mesh' | 'ring' | 'star' | 'adaptive' | 'hierarchical-mesh' {
  if (topology === 'hybrid') {
    return 'hierarchical-mesh';
  }
  return topology;
}

/**
 * Normalize memory backend from SystemConfig to V3Config
 */
function normalizeMemoryBackend(
  backend: string | undefined
): 'memory' | 'sqlite' | 'agentdb' | 'hybrid' {
  switch (backend) {
    case 'memory':
    case 'sqlite':
    case 'agentdb':
    case 'hybrid':
      return backend;
    case 'redis':
      return 'memory'; // Redis maps to memory for CLI purposes
    default:
      return 'hybrid';
  }
}

/**
 * Denormalize memory backend from V3Config to SystemConfig
 */
function denormalizeMemoryBackend(
  backend: 'memory' | 'sqlite' | 'agentdb' | 'hybrid'
): 'memory' | 'sqlite' | 'agentdb' | 'hybrid' | 'redis' {
  return backend;
}
