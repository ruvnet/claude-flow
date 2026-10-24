/**
 * AgentTools
 *
 * MCP tools for agent management operations.
 */

import type {
  MCPTool,
  MCPToolProvider,
  MCPToolResult,
  AgentConfig
} from '../../../shared/types';
import type { SwarmCoordinator } from '../../../coordination/application/SwarmCoordinator';
import { ValidationError } from '../../../shared/types';

export class AgentTools implements MCPToolProvider {
  private coordinator: SwarmCoordinator;

  constructor(coordinator: SwarmCoordinator) {
    this.coordinator = coordinator;
  }

  /**
   * Get available tools
   */
  getTools(): MCPTool[] {
    return [
      {
        name: 'agent_spawn',
        description: 'Spawn a new agent in the swarm',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique agent identifier' },
            type: { type: 'string', description: 'Agent type (coder, tester, reviewer, etc.)' },
            capabilities: { type: 'array', items: { type: 'string' }, description: 'Agent capabilities' }
          },
          required: ['id', 'type']
        }
      },
      {
        name: 'agent_list',
        description: 'List all agents in the swarm',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'agent_terminate',
        description: 'Terminate an agent',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'ID of the agent to terminate' }
          },
          required: ['agentId']
        }
      },
      {
        name: 'agent_metrics',
        description: 'Get metrics for an agent',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'ID of the agent' }
          },
          required: ['agentId']
        }
      }
    ];
  }

  /**
   * Execute a tool
   */
  async execute(toolName: string, params: Record<string, unknown>): Promise<MCPToolResult> {
    try {
      switch (toolName) {
        case 'agent_spawn':
          return await this.spawnAgent(params as AgentConfig);

        case 'agent_list':
          return await this.listAgents();

        case 'agent_terminate':
          return await this.terminateAgent(params.agentId as string);

        case 'agent_metrics':
          return await this.getAgentMetrics(params.agentId as string);

        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async spawnAgent(config: AgentConfig): Promise<MCPToolResult> {
    // Validate parameters
    if (!config.id || config.id.trim() === '') {
      return { success: false, error: 'validation: id is required and cannot be empty' };
    }

    const validTypes = ['coder', 'tester', 'reviewer', 'coordinator', 'designer', 'deployer'];
    if (!validTypes.includes(config.type)) {
      return { success: false, error: `validation: type must be one of ${validTypes.join(', ')}` };
    }

    if (config.capabilities && !Array.isArray(config.capabilities)) {
      return { success: false, error: 'validation: capabilities must be an array' };
    }

    const agent = await this.coordinator.spawnAgent(config);
    return { success: true, agent };
  }

  private async listAgents(): Promise<MCPToolResult> {
    const agents = await this.coordinator.listAgents();
    return { success: true, agents };
  }

  private async terminateAgent(agentId: string): Promise<MCPToolResult> {
    await this.coordinator.terminateAgent(agentId);
    return { success: true };
  }

  private async getAgentMetrics(agentId: string): Promise<MCPToolResult> {
    const metrics = await this.coordinator.getAgentMetrics(agentId);
    return { success: true, metrics };
  }
}

export { AgentTools as default };
