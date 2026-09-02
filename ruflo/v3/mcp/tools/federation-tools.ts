/**
 * V3 MCP Federation Tools
 *
 * MCP tools for federation hub and ephemeral agent management:
 * - federation/status - Get federation status
 * - federation/spawn-ephemeral - Spawn ephemeral agent
 * - federation/terminate-ephemeral - Terminate ephemeral agent
 * - federation/list-ephemeral - List ephemeral agents
 * - federation/register-swarm - Register swarm with federation
 * - federation/broadcast - Broadcast message to all swarms
 * - federation/propose - Propose federation-wide consensus
 * - federation/vote - Vote on consensus proposal
 *
 * Implements ADR-005: MCP-First API Design
 * Implements ADR-001: agentic-flow@alpha compatibility
 */

import { z } from 'zod';
import { MCPTool, ToolContext } from '../types.js';
import {
  FederationHub,
  getDefaultFederationHub,
  type FederationStats,
  type EphemeralAgent,
  type SpawnResult,
  type ConsensusProposal,
} from '../../@claude-flow/swarm/src/federation-hub.js';

// ============================================================================
// Input Schemas
// ============================================================================

const spawnEphemeralSchema = z.object({
  type: z.string()
    .describe('Agent type (e.g., "coder", "researcher", "tester")'),
  task: z.string()
    .describe('Task description for the ephemeral agent'),
  swarmId: z.string().optional()
    .describe('Target swarm ID (auto-select if not specified)'),
  ttl: z.number().optional()
    .describe('Time-to-live in milliseconds'),
  capabilities: z.array(z.string()).optional()
    .describe('Required capabilities'),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal')
    .describe('Priority for swarm selection'),
  waitForCompletion: z.boolean().default(false)
    .describe('Wait for agent to complete'),
  completionTimeout: z.number().optional()
    .describe('Timeout when waiting for completion (ms)'),
});

const terminateEphemeralSchema = z.object({
  agentId: z.string()
    .describe('Ephemeral agent ID to terminate'),
  reason: z.string().optional()
    .describe('Reason for termination'),
});

const listEphemeralSchema = z.object({
  swarmId: z.string().optional()
    .describe('Filter by swarm ID'),
  status: z.enum(['spawning', 'active', 'completing', 'terminated']).optional()
    .describe('Filter by status'),
  limit: z.number().default(50)
    .describe('Maximum results to return'),
});

const registerSwarmSchema = z.object({
  swarmId: z.string()
    .describe('Unique swarm identifier'),
  name: z.string()
    .describe('Human-readable swarm name'),
  capabilities: z.array(z.string())
    .describe('Swarm capabilities'),
  maxAgents: z.number().default(100)
    .describe('Maximum agents this swarm can handle'),
  endpoint: z.string().optional()
    .describe('Swarm communication endpoint'),
});

const broadcastSchema = z.object({
  sourceSwarmId: z.string()
    .describe('Source swarm ID'),
  message: z.unknown()
    .describe('Message payload to broadcast'),
});

const proposeSchema = z.object({
  proposerId: z.string()
    .describe('Proposer swarm ID'),
  type: z.string()
    .describe('Proposal type'),
  value: z.unknown()
    .describe('Proposal value'),
  timeoutMs: z.number().default(30000)
    .describe('Proposal timeout in milliseconds'),
});

const voteSchema = z.object({
  swarmId: z.string()
    .describe('Voting swarm ID'),
  proposalId: z.string()
    .describe('Proposal ID to vote on'),
  approve: z.boolean()
    .describe('Whether to approve the proposal'),
});

// ============================================================================
// Type Definitions
// ============================================================================

interface StatusResult {
  stats: FederationStats;
  swarms: Array<{
    swarmId: string;
    name: string;
    status: string;
    agentCount: number;
    maxAgents: number;
  }>;
}

interface EphemeralListResult {
  agents: Array<{
    id: string;
    swarmId: string;
    type: string;
    task: string;
    status: string;
    ttl: number;
    createdAt: string;
    expiresAt: string;
  }>;
  total: number;
}

// ============================================================================
// Global Hub Instance
// ============================================================================

let hubInstance: FederationHub | null = null;

function getHub(): FederationHub {
  if (!hubInstance) {
    hubInstance = getDefaultFederationHub();
  }
  return hubInstance;
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Get federation status
 */
async function handleFederationStatus(
  input: Record<string, never>,
  context?: ToolContext
): Promise<StatusResult> {
  const hub = getHub();
  const stats = hub.getStats();
  const swarms = hub.getSwarms();

  return {
    stats,
    swarms: swarms.map(s => ({
      swarmId: s.swarmId,
      name: s.name,
      status: s.status,
      agentCount: s.currentAgents,
      maxAgents: s.maxAgents,
    })),
  };
}

/**
 * Spawn an ephemeral agent
 */
async function handleSpawnEphemeral(
  input: z.infer<typeof spawnEphemeralSchema>,
  context?: ToolContext
): Promise<SpawnResult> {
  const hub = getHub();
  return hub.spawnEphemeralAgent({
    type: input.type,
    task: input.task,
    swarmId: input.swarmId,
    ttl: input.ttl,
    capabilities: input.capabilities,
    priority: input.priority,
    waitForCompletion: input.waitForCompletion,
    completionTimeout: input.completionTimeout,
  });
}

/**
 * Terminate an ephemeral agent
 */
async function handleTerminateEphemeral(
  input: z.infer<typeof terminateEphemeralSchema>,
  context?: ToolContext
): Promise<{ terminated: boolean; agentId: string; reason?: string }> {
  const hub = getHub();
  const error = input.reason ? new Error(input.reason) : undefined;
  const terminated = await hub.terminateAgent(input.agentId, error);

  return {
    terminated,
    agentId: input.agentId,
    reason: input.reason,
  };
}

/**
 * List ephemeral agents
 */
async function handleListEphemeral(
  input: z.infer<typeof listEphemeralSchema>,
  context?: ToolContext
): Promise<EphemeralListResult> {
  const hub = getHub();
  let agents = hub.getAgents(input.swarmId);

  // Filter by status
  if (input.status) {
    agents = agents.filter(a => a.status === input.status);
  }

  // Limit results
  agents = agents.slice(0, input.limit);

  return {
    agents: agents.map(a => ({
      id: a.id,
      swarmId: a.swarmId,
      type: a.type,
      task: a.task,
      status: a.status,
      ttl: a.ttl,
      createdAt: a.createdAt.toISOString(),
      expiresAt: a.expiresAt.toISOString(),
    })),
    total: agents.length,
  };
}

/**
 * Register a swarm with the federation
 */
async function handleRegisterSwarm(
  input: z.infer<typeof registerSwarmSchema>,
  context?: ToolContext
): Promise<{ registered: boolean; swarmId: string }> {
  const hub = getHub();

  hub.registerSwarm({
    swarmId: input.swarmId,
    name: input.name,
    capabilities: input.capabilities,
    maxAgents: input.maxAgents,
    currentAgents: 0,
    status: 'active',
    endpoint: input.endpoint,
  });

  return {
    registered: true,
    swarmId: input.swarmId,
  };
}

/**
 * Broadcast message to all swarms
 */
async function handleBroadcast(
  input: z.infer<typeof broadcastSchema>,
  context?: ToolContext
): Promise<{ sent: number; sourceSwarmId: string }> {
  const hub = getHub();
  const sent = await hub.broadcast(input.sourceSwarmId, input.message);

  return {
    sent,
    sourceSwarmId: input.sourceSwarmId,
  };
}

/**
 * Propose federation-wide consensus
 */
async function handlePropose(
  input: z.infer<typeof proposeSchema>,
  context?: ToolContext
): Promise<{
  proposalId: string;
  status: string;
  expiresAt: string;
}> {
  const hub = getHub();
  const proposal = await hub.propose(
    input.proposerId,
    input.type,
    input.value,
    input.timeoutMs
  );

  return {
    proposalId: proposal.id,
    status: proposal.status,
    expiresAt: proposal.expiresAt.toISOString(),
  };
}

/**
 * Vote on a consensus proposal
 */
async function handleVote(
  input: z.infer<typeof voteSchema>,
  context?: ToolContext
): Promise<{
  voted: boolean;
  proposalId: string;
  swarmId: string;
  approve: boolean;
}> {
  const hub = getHub();
  const voted = hub.vote(input.swarmId, input.proposalId, input.approve);

  return {
    voted,
    proposalId: input.proposalId,
    swarmId: input.swarmId,
    approve: input.approve,
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const federationStatusTool: MCPTool = {
  name: 'federation/status',
  description: 'Get federation hub status including swarms and ephemeral agents',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (input, context) => {
    return handleFederationStatus({}, context);
  },
  category: 'federation',
  tags: ['federation', 'status', 'monitoring'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

export const spawnEphemeralTool: MCPTool = {
  name: 'federation/spawn-ephemeral',
  description: 'Spawn an ephemeral agent for a short-lived task',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Agent type',
      },
      task: {
        type: 'string',
        description: 'Task description',
      },
      swarmId: {
        type: 'string',
        description: 'Target swarm ID (optional)',
      },
      ttl: {
        type: 'number',
        description: 'Time-to-live in milliseconds',
      },
      capabilities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required capabilities',
      },
      priority: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'critical'],
        description: 'Priority for swarm selection',
        default: 'normal',
      },
      waitForCompletion: {
        type: 'boolean',
        description: 'Wait for agent completion',
        default: false,
      },
      completionTimeout: {
        type: 'number',
        description: 'Completion timeout (ms)',
      },
    },
    required: ['type', 'task'],
  },
  handler: async (input, context) => {
    const validated = spawnEphemeralSchema.parse(input);
    return handleSpawnEphemeral(validated, context);
  },
  category: 'federation',
  tags: ['federation', 'ephemeral', 'spawn', 'agent'],
  version: '1.0.0',
};

export const terminateEphemeralTool: MCPTool = {
  name: 'federation/terminate-ephemeral',
  description: 'Terminate an ephemeral agent',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'Ephemeral agent ID',
      },
      reason: {
        type: 'string',
        description: 'Termination reason',
      },
    },
    required: ['agentId'],
  },
  handler: async (input, context) => {
    const validated = terminateEphemeralSchema.parse(input);
    return handleTerminateEphemeral(validated, context);
  },
  category: 'federation',
  tags: ['federation', 'ephemeral', 'terminate', 'agent'],
  version: '1.0.0',
};

export const listEphemeralTool: MCPTool = {
  name: 'federation/list-ephemeral',
  description: 'List ephemeral agents in the federation',
  inputSchema: {
    type: 'object',
    properties: {
      swarmId: {
        type: 'string',
        description: 'Filter by swarm ID',
      },
      status: {
        type: 'string',
        enum: ['spawning', 'active', 'completing', 'terminated'],
        description: 'Filter by status',
      },
      limit: {
        type: 'number',
        description: 'Maximum results',
        default: 50,
      },
    },
  },
  handler: async (input, context) => {
    const validated = listEphemeralSchema.parse(input);
    return handleListEphemeral(validated, context);
  },
  category: 'federation',
  tags: ['federation', 'ephemeral', 'list', 'agent'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 2000,
};

export const registerSwarmTool: MCPTool = {
  name: 'federation/register-swarm',
  description: 'Register a swarm with the federation hub',
  inputSchema: {
    type: 'object',
    properties: {
      swarmId: {
        type: 'string',
        description: 'Unique swarm identifier',
      },
      name: {
        type: 'string',
        description: 'Human-readable swarm name',
      },
      capabilities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Swarm capabilities',
      },
      maxAgents: {
        type: 'number',
        description: 'Maximum agents',
        default: 100,
      },
      endpoint: {
        type: 'string',
        description: 'Communication endpoint',
      },
    },
    required: ['swarmId', 'name', 'capabilities'],
  },
  handler: async (input, context) => {
    const validated = registerSwarmSchema.parse(input);
    return handleRegisterSwarm(validated, context);
  },
  category: 'federation',
  tags: ['federation', 'swarm', 'register'],
  version: '1.0.0',
};

export const broadcastTool: MCPTool = {
  name: 'federation/broadcast',
  description: 'Broadcast a message to all swarms in the federation',
  inputSchema: {
    type: 'object',
    properties: {
      sourceSwarmId: {
        type: 'string',
        description: 'Source swarm ID',
      },
      message: {
        description: 'Message payload',
      },
    },
    required: ['sourceSwarmId', 'message'],
  },
  handler: async (input, context) => {
    const validated = broadcastSchema.parse(input);
    return handleBroadcast(validated, context);
  },
  category: 'federation',
  tags: ['federation', 'broadcast', 'message'],
  version: '1.0.0',
};

export const proposeTool: MCPTool = {
  name: 'federation/propose',
  description: 'Propose a value for federation-wide consensus',
  inputSchema: {
    type: 'object',
    properties: {
      proposerId: {
        type: 'string',
        description: 'Proposer swarm ID',
      },
      type: {
        type: 'string',
        description: 'Proposal type',
      },
      value: {
        description: 'Proposal value',
      },
      timeoutMs: {
        type: 'number',
        description: 'Proposal timeout (ms)',
        default: 30000,
      },
    },
    required: ['proposerId', 'type', 'value'],
  },
  handler: async (input, context) => {
    const validated = proposeSchema.parse(input);
    return handlePropose(validated, context);
  },
  category: 'federation',
  tags: ['federation', 'consensus', 'propose'],
  version: '1.0.0',
};

export const voteTool: MCPTool = {
  name: 'federation/vote',
  description: 'Vote on a federation consensus proposal',
  inputSchema: {
    type: 'object',
    properties: {
      swarmId: {
        type: 'string',
        description: 'Voting swarm ID',
      },
      proposalId: {
        type: 'string',
        description: 'Proposal ID',
      },
      approve: {
        type: 'boolean',
        description: 'Approve or reject',
      },
    },
    required: ['swarmId', 'proposalId', 'approve'],
  },
  handler: async (input, context) => {
    const validated = voteSchema.parse(input);
    return handleVote(validated, context);
  },
  category: 'federation',
  tags: ['federation', 'consensus', 'vote'],
  version: '1.0.0',
};

// ============================================================================
// Exports
// ============================================================================

export const federationTools: MCPTool[] = [
  federationStatusTool,
  spawnEphemeralTool,
  terminateEphemeralTool,
  listEphemeralTool,
  registerSwarmTool,
  broadcastTool,
  proposeTool,
  voteTool,
];

export default federationTools;
