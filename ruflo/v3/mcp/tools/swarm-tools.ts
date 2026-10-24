/**
 * V3 MCP Swarm Tools
 *
 * MCP tools for swarm coordination operations:
 * - swarm/init - Initialize swarm coordination
 * - swarm/status - Get swarm status
 * - swarm/scale - Scale swarm agents
 *
 * Implements ADR-005: MCP-First API Design
 */

import { z } from 'zod';
import { MCPTool, ToolContext } from '../types.js';

// ============================================================================
// Input Schemas
// ============================================================================

const initSwarmSchema = z.object({
  topology: z.enum(['hierarchical', 'mesh', 'adaptive', 'collective', 'hierarchical-mesh'])
    .default('hierarchical-mesh')
    .describe('Swarm coordination topology'),
  maxAgents: z.number().int().positive().max(1000).default(15)
    .describe('Maximum number of agents in the swarm'),
  config: z.object({
    communicationProtocol: z.enum(['direct', 'message-bus', 'pubsub']).optional(),
    consensusMechanism: z.enum(['majority', 'unanimous', 'weighted', 'none']).optional(),
    failureHandling: z.enum(['retry', 'failover', 'ignore']).optional(),
    loadBalancing: z.boolean().optional(),
    autoScaling: z.boolean().optional(),
  }).optional().describe('Swarm configuration'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});

const swarmStatusSchema = z.object({
  includeAgents: z.boolean().default(true).describe('Include individual agent information'),
  includeMetrics: z.boolean().default(false).describe('Include performance metrics'),
  includeTopology: z.boolean().default(false).describe('Include topology graph'),
});

const scaleSwarmSchema = z.object({
  targetAgents: z.number().int().positive().max(1000)
    .describe('Target number of agents'),
  scaleStrategy: z.enum(['gradual', 'immediate', 'adaptive']).default('gradual')
    .describe('Scaling strategy'),
  agentTypes: z.array(z.string()).optional()
    .describe('Specific agent types to scale (if not provided, will scale proportionally)'),
  reason: z.string().optional().describe('Reason for scaling'),
});

// ============================================================================
// Type Definitions
// ============================================================================

interface SwarmConfig {
  topology: 'hierarchical' | 'mesh' | 'adaptive' | 'collective' | 'hierarchical-mesh';
  maxAgents: number;
  currentAgents: number;
  communicationProtocol?: string;
  consensusMechanism?: string;
  failureHandling?: string;
  loadBalancing?: boolean;
  autoScaling?: boolean;
}

interface SwarmAgent {
  id: string;
  type: string;
  status: 'active' | 'idle' | 'busy' | 'error';
  role?: 'coordinator' | 'worker' | 'specialist';
  connections?: string[];
}

interface SwarmMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  inProgressTasks: number;
  averageTaskDuration: number;
  throughput: number;
  efficiency: number;
  uptime: number;
}

interface SwarmTopology {
  nodes: Array<{ id: string; type: string; role?: string }>;
  edges: Array<{ from: string; to: string; weight?: number }>;
  depth?: number;
  fanout?: number;
}

interface InitSwarmResult {
  swarmId: string;
  topology: string;
  initializedAt: string;
  config: SwarmConfig;
}

interface SwarmStatusResult {
  swarmId: string;
  status: 'initializing' | 'active' | 'scaling' | 'degraded' | 'stopped';
  config: SwarmConfig;
  agents?: SwarmAgent[];
  metrics?: SwarmMetrics;
  topology?: SwarmTopology;
  lastActivityAt?: string;
}

interface ScaleSwarmResult {
  swarmId: string;
  previousAgents: number;
  targetAgents: number;
  currentAgents: number;
  scalingStatus: 'in-progress' | 'completed' | 'failed';
  scaledAt: string;
  addedAgents?: string[];
  removedAgents?: string[];
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Initialize swarm coordination
 */
async function handleInitSwarm(
  input: z.infer<typeof initSwarmSchema>,
  context?: ToolContext
): Promise<InitSwarmResult> {
  // Secure swarm ID generation
  const { randomBytes } = await import('crypto');
  const swarmId = `swarm-${Date.now().toString(36)}-${randomBytes(12).toString('hex')}`;
  const initializedAt = new Date().toISOString();

  const config: SwarmConfig = {
    topology: input.topology,
    maxAgents: input.maxAgents,
    currentAgents: 0,
    communicationProtocol: input.config?.communicationProtocol || 'message-bus',
    consensusMechanism: input.config?.consensusMechanism || 'majority',
    failureHandling: input.config?.failureHandling || 'retry',
    loadBalancing: input.config?.loadBalancing ?? true,
    autoScaling: input.config?.autoScaling ?? true,
  };

  // Try to use swarmCoordinator if available
  if (context?.swarmCoordinator) {
    try {
      const { UnifiedSwarmCoordinator } = await import('@claude-flow/swarm');
      const coordinator = context.swarmCoordinator as InstanceType<typeof UnifiedSwarmCoordinator>;

      // Initialize the coordinator with the config
      await coordinator.initialize({
        topology: {
          type: input.topology as any,
          maxAgents: input.maxAgents,
        },
        consensus: {
          algorithm: input.config?.consensusMechanism === 'unanimous' ? 'byzantine' as any :
                     input.config?.consensusMechanism === 'weighted' ? 'raft' as any : 'gossip' as any,
          threshold: input.config?.consensusMechanism === 'unanimous' ? 1.0 :
                    input.config?.consensusMechanism === 'weighted' ? 0.66 : 0.5,
        },
        messageBus: {
          maxQueueSize: 10000,
          batchSize: 100,
        },
      });

      const status = await coordinator.getStatus();
      config.currentAgents = status.agents.length;

      return {
        swarmId: status.swarmId,
        topology: input.topology,
        initializedAt,
        config,
      };
    } catch (error) {
      // Fall through to simple implementation if coordinator fails
      console.error('Failed to initialize swarm via coordinator:', error);
    }
  }

  // Simple implementation when no coordinator is available
  return {
    swarmId,
    topology: input.topology,
    initializedAt,
    config,
  };
}

/**
 * Get swarm status
 */
async function handleSwarmStatus(
  input: z.infer<typeof swarmStatusSchema>,
  context?: ToolContext
): Promise<SwarmStatusResult> {
  // Try to use swarmCoordinator if available
  if (context?.swarmCoordinator) {
    try {
      const { UnifiedSwarmCoordinator } = await import('@claude-flow/swarm');
      const coordinator = context.swarmCoordinator as InstanceType<typeof UnifiedSwarmCoordinator>;

      // Get swarm status
      const status = await coordinator.getStatus();
      const metrics = await coordinator.getMetrics();

      const config: SwarmConfig = {
        topology: status.topology.type as any,
        maxAgents: status.topology.maxAgents,
        currentAgents: status.agents.length,
        communicationProtocol: 'message-bus',
        consensusMechanism: status.consensus?.algorithm === 'raft' ? 'weighted' :
                           status.consensus?.algorithm === 'byzantine' ? 'unanimous' : 'majority',
        failureHandling: 'retry',
        loadBalancing: true,
        autoScaling: status.state === 'scaling',
      };

      const result: SwarmStatusResult = {
        swarmId: status.swarmId,
        status: status.state === 'ready' ? 'active' :
                status.state === 'scaling' ? 'scaling' :
                status.state === 'degraded' ? 'degraded' :
                status.state === 'initializing' ? 'initializing' : 'stopped',
        config,
        lastActivityAt: new Date().toISOString(),
      };

      if (input.includeAgents) {
        result.agents = status.agents.map(agent => ({
          id: agent.id,
          type: agent.type,
          status: agent.status === 'active' ? 'active' :
                  agent.status === 'idle' ? 'idle' :
                  agent.status === 'busy' ? 'busy' : 'error',
          role: agent.role,
          connections: agent.connections,
        }));
      }

      if (input.includeMetrics) {
        result.metrics = {
          totalTasks: metrics.totalTasks,
          completedTasks: metrics.completedTasks,
          failedTasks: metrics.failedTasks,
          inProgressTasks: metrics.activeTasks,
          averageTaskDuration: metrics.averageTaskDuration,
          throughput: metrics.throughput,
          efficiency: metrics.successRate,
          uptime: Date.now() - status.createdAt.getTime(),
        };
      }

      if (input.includeTopology) {
        const topologyState = status.topology;
        result.topology = {
          nodes: status.agents.map(agent => ({
            id: agent.id,
            type: agent.type,
            role: agent.role,
          })),
          edges: topologyState.edges || [],
          depth: topologyState.depth,
          fanout: topologyState.fanout,
        };
      }

      return result;
    } catch (error) {
      // Fall through to simple implementation if coordinator fails
      console.error('Failed to get swarm status via coordinator:', error);
    }
  }

  // Simple implementation when no coordinator is available
  return {
    swarmId: 'swarm-not-initialized',
    status: 'stopped',
    config: {
      topology: 'hierarchical-mesh',
      maxAgents: 15,
      currentAgents: 0,
      communicationProtocol: 'message-bus',
      consensusMechanism: 'majority',
      failureHandling: 'retry',
      loadBalancing: true,
      autoScaling: true,
    },
    lastActivityAt: new Date().toISOString(),
  };
}

/**
 * Scale swarm agents
 */
async function handleScaleSwarm(
  input: z.infer<typeof scaleSwarmSchema>,
  context?: ToolContext
): Promise<ScaleSwarmResult> {
  const scaledAt = new Date().toISOString();

  // Try to use swarmCoordinator if available
  if (context?.swarmCoordinator) {
    try {
      const { UnifiedSwarmCoordinator } = await import('@claude-flow/swarm');
      const coordinator = context.swarmCoordinator as InstanceType<typeof UnifiedSwarmCoordinator>;

      // Get current status
      const beforeStatus = await coordinator.getStatus();
      const previousAgents = beforeStatus.agents.length;

      // Perform scaling (note: UnifiedSwarmCoordinator may not have a direct scale method,
      // so we spawn or terminate agents to reach the target)
      const addedAgents: string[] = [];
      const removedAgents: string[] = [];

      if (input.targetAgents > previousAgents) {
        // Scale up
        const count = input.targetAgents - previousAgents;
        const agentTypes = input.agentTypes || ['worker'];

        for (let i = 0; i < count; i++) {
          const agentType = agentTypes[i % agentTypes.length];
          const agentId = `agent-scaled-${Date.now()}-${i}`;

          await coordinator.spawnAgent({
            id: agentId,
            type: agentType as any,
            capabilities: [],
            priority: 3,
          });

          addedAgents.push(agentId);
        }
      } else if (input.targetAgents < previousAgents) {
        // Scale down
        const count = previousAgents - input.targetAgents;
        const agentsToRemove = beforeStatus.agents.slice(-count);

        for (const agent of agentsToRemove) {
          await coordinator.terminateAgent(agent.id);
          removedAgents.push(agent.id);
        }
      }

      // Get updated status
      const afterStatus = await coordinator.getStatus();

      return {
        swarmId: beforeStatus.swarmId,
        previousAgents,
        targetAgents: input.targetAgents,
        currentAgents: afterStatus.agents.length,
        scalingStatus: afterStatus.agents.length === input.targetAgents ? 'completed' : 'in-progress',
        scaledAt,
        addedAgents: addedAgents.length > 0 ? addedAgents : undefined,
        removedAgents: removedAgents.length > 0 ? removedAgents : undefined,
      };
    } catch (error) {
      // Fall through to simple implementation if coordinator fails
      console.error('Failed to scale swarm via coordinator:', error);
    }
  }

  // Simple implementation when no coordinator is available
  return {
    swarmId: 'swarm-not-initialized',
    previousAgents: 0,
    targetAgents: input.targetAgents,
    currentAgents: 0,
    scalingStatus: 'failed',
    scaledAt,
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * swarm/init tool
 */
export const initSwarmTool: MCPTool = {
  name: 'swarm/init',
  description: 'Initialize swarm coordination with specified topology and configuration',
  inputSchema: {
    type: 'object',
    properties: {
      topology: {
        type: 'string',
        enum: ['hierarchical', 'mesh', 'adaptive', 'collective', 'hierarchical-mesh'],
        description: 'Swarm coordination topology',
        default: 'hierarchical-mesh',
      },
      maxAgents: {
        type: 'number',
        description: 'Maximum number of agents in the swarm',
        minimum: 1,
        maximum: 1000,
        default: 15,
      },
      config: {
        type: 'object',
        description: 'Swarm configuration',
        properties: {
          communicationProtocol: {
            type: 'string',
            enum: ['direct', 'message-bus', 'pubsub'],
          },
          consensusMechanism: {
            type: 'string',
            enum: ['majority', 'unanimous', 'weighted', 'none'],
          },
          failureHandling: {
            type: 'string',
            enum: ['retry', 'failover', 'ignore'],
          },
          loadBalancing: { type: 'boolean' },
          autoScaling: { type: 'boolean' },
        },
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata',
        additionalProperties: true,
      },
    },
  },
  handler: async (input, context) => {
    const validated = initSwarmSchema.parse(input);
    return handleInitSwarm(validated, context);
  },
  category: 'swarm',
  tags: ['swarm', 'coordination', 'initialization'],
  version: '1.0.0',
};

/**
 * swarm/status tool
 */
export const swarmStatusTool: MCPTool = {
  name: 'swarm/status',
  description: 'Get current swarm status including agents, metrics, and topology',
  inputSchema: {
    type: 'object',
    properties: {
      includeAgents: {
        type: 'boolean',
        description: 'Include individual agent information',
        default: true,
      },
      includeMetrics: {
        type: 'boolean',
        description: 'Include performance metrics',
        default: false,
      },
      includeTopology: {
        type: 'boolean',
        description: 'Include topology graph',
        default: false,
      },
    },
  },
  handler: async (input, context) => {
    const validated = swarmStatusSchema.parse(input);
    return handleSwarmStatus(validated, context);
  },
  category: 'swarm',
  tags: ['swarm', 'status', 'monitoring'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 2000,
};

/**
 * swarm/scale tool
 */
export const scaleSwarmTool: MCPTool = {
  name: 'swarm/scale',
  description: 'Scale swarm up or down to target number of agents',
  inputSchema: {
    type: 'object',
    properties: {
      targetAgents: {
        type: 'number',
        description: 'Target number of agents',
        minimum: 1,
        maximum: 1000,
      },
      scaleStrategy: {
        type: 'string',
        enum: ['gradual', 'immediate', 'adaptive'],
        description: 'Scaling strategy',
        default: 'gradual',
      },
      agentTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific agent types to scale',
      },
      reason: {
        type: 'string',
        description: 'Reason for scaling',
      },
    },
    required: ['targetAgents'],
  },
  handler: async (input, context) => {
    const validated = scaleSwarmSchema.parse(input);
    return handleScaleSwarm(validated, context);
  },
  category: 'swarm',
  tags: ['swarm', 'scaling', 'coordination'],
  version: '1.0.0',
};

// ============================================================================
// Exports
// ============================================================================

export const swarmTools: MCPTool[] = [
  initSwarmTool,
  swarmStatusTool,
  scaleSwarmTool,
];

export default swarmTools;
