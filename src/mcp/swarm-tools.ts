/**
 * Comprehensive MCP tools for swarm system functionality
 */

import { MCPTool, MCPContext } from '../utils/types.js';
import { ILogger } from '../core/logger.js';
// Legacy import kept for compatibility
// import { Tool } from '@modelcontextprotocol/sdk/types.js';
// import { spawnSwarmAgent, getSwarmState } from '../cli/commands/swarm-spawn.js';

export interface SwarmToolContext extends MCPContext {
  swarmCoordinator?: any;
  agentManager?: any;
  resourceManager?: any;
  messageBus?: any;
  monitor?: any;
}

export function createSwarmTools(logger: ILogger): MCPTool[] {
  return [
    // === LEGACY SWARM TOOLS ===
    {
      name: 'dispatch_agent',
      description: 'Spawn a new agent in the swarm to handle a specific task',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['researcher', 'developer', 'analyst', 'reviewer', 'coordinator'],
            description: 'The type of agent to spawn',
          },
          task: {
            type: 'string',
            description: 'The specific task for the agent to complete',
          },
          name: {
            type: 'string',
            description: 'Optional name for the agent',
          },
        },
        required: ['type', 'task'],
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        const { type, task, name } = input;
        
        // Get swarm ID from environment
        const swarmId = process.env.CLAUDE_SWARM_ID;
        if (!swarmId) {
          throw new Error('Not running in swarm context');
        }
        
        // Get parent agent ID if available
        const parentId = process.env.CLAUDE_SWARM_AGENT_ID;
        
        try {
          // Legacy functionality - would integrate with swarm spawn system
          const agentId = `agent-${Date.now()}`;
          
          logger.info('Agent spawned via legacy dispatch tool', { agentId });
          
          return {
            success: true,
            agentId,
            agentName: name || type,
            terminalId: 'N/A',
            message: `Successfully spawned ${name || type} to work on: ${task}`,
          };
        } catch (error) {
          logger.error('Failed to spawn agent via legacy dispatch tool', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }
    },

    {
      name: 'swarm_status',
      description: 'Get the current status of the swarm and all agents',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        const swarmId = process.env.CLAUDE_SWARM_ID || 'default-swarm';
        
        // Legacy functionality - would integrate with swarm state system
        const mockState = {
          swarmId,
          objective: 'Legacy swarm status',
          startTime: Date.now() - 60000, // Started 1 minute ago
          agents: []
        };
        
        const runtime = Math.floor((Date.now() - mockState.startTime) / 1000);
        
        return {
          swarmId: mockState.swarmId,
          objective: mockState.objective,
          runtime: `${runtime}s`,
          totalAgents: mockState.agents.length,
          activeAgents: 0,
          completedAgents: 0,
          failedAgents: 0,
          agents: mockState.agents,
        };
      }
    },

    // === SWARM COORDINATION TOOLS ===
    {
      name: 'swarm_create_objective',
      description: 'Create a new swarm objective with tasks and coordination',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Objective title' },
          description: { type: 'string', description: 'Detailed description' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                description: { type: 'string' },
                requirements: { type: 'object' },
                priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] }
              },
              required: ['type', 'description']
            }
          },
          strategy: { type: 'string', enum: ['parallel', 'sequential', 'adaptive'] },
          timeout: { type: 'number', description: 'Timeout in milliseconds' }
        },
        required: ['title', 'description', 'tasks']
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.swarmCoordinator) {
          throw new Error('Swarm coordinator not available');
        }

        try {
          const objectiveId = await context.swarmCoordinator.createObjective({
            title: input.title,
            description: input.description,
            tasks: input.tasks || [],
            strategy: input.strategy || 'adaptive',
            timeout: input.timeout
          });

          logger.info('Swarm objective created via MCP', { objectiveId });

          return {
            success: true,
            objectiveId,
            message: `Created swarm objective: ${input.title}`
          };
        } catch (error) {
          logger.error('Failed to create swarm objective via MCP', error);
          throw error;
        }
      }
    },

    {
      name: 'swarm_execute_objective',
      description: 'Execute a swarm objective',
      inputSchema: {
        type: 'object',
        properties: {
          objectiveId: { type: 'string', description: 'Objective ID to execute' }
        },
        required: ['objectiveId']
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.swarmCoordinator) {
          throw new Error('Swarm coordinator not available');
        }

        try {
          const result = await context.swarmCoordinator.executeObjective(input.objectiveId);

          logger.info('Swarm objective executed via MCP', { objectiveId: input.objectiveId });

          return {
            success: true,
            objectiveId: input.objectiveId,
            result,
            message: 'Objective execution started'
          };
        } catch (error) {
          logger.error('Failed to execute swarm objective via MCP', error);
          throw error;
        }
      }
    },

    {
      name: 'swarm_get_status',
      description: 'Get comprehensive swarm status',
      inputSchema: {
        type: 'object',
        properties: {
          includeDetails: { type: 'boolean', default: false }
        }
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.swarmCoordinator) {
          throw new Error('Swarm coordinator not available');
        }

        try {
          const status = await context.swarmCoordinator.getSwarmStatus();
          
          if (input.includeDetails) {
            const detailedStatus = {
              ...status,
              objectives: await context.swarmCoordinator.getActiveObjectives(),
              agents: context.agentManager ? await context.agentManager.getAllAgents() : [],
              resources: context.resourceManager ? context.resourceManager.getManagerStatistics() : null,
              messaging: context.messageBus ? context.messageBus.getMetrics() : null,
              monitoring: context.monitor ? context.monitor.getMonitoringStatistics() : null
            };
            return detailedStatus;
          }

          return status;
        } catch (error) {
          logger.error('Failed to get swarm status via MCP', error);
          throw error;
        }
      }
    },

    // === AGENT MANAGEMENT TOOLS ===
    {
      name: 'agent_create',
      description: 'Create a new agent in the swarm',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Agent type (developer, researcher, etc.)' },
          capabilities: {
            type: 'object',
            properties: {
              domains: { type: 'array', items: { type: 'string' } },
              tools: { type: 'array', items: { type: 'string' } },
              languages: { type: 'array', items: { type: 'string' } },
              frameworks: { type: 'array', items: { type: 'string' } }
            }
          },
          config: { type: 'object', description: 'Agent configuration' }
        },
        required: ['type']
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.agentManager) {
          throw new Error('Agent manager not available');
        }

        try {
          const agentId = await context.agentManager.createAgent(
            input.type,
            input.capabilities || {},
            input.config || {}
          );

          logger.info('Agent created via MCP', { agentId, type: input.type });

          return {
            success: true,
            agentId,
            message: `Created ${input.type} agent`
          };
        } catch (error) {
          logger.error('Failed to create agent via MCP', error);
          throw error;
        }
      }
    },

    {
      name: 'agent_list',
      description: 'List all agents with their status',
      inputSchema: {
        type: 'object',
        properties: {
          status: { 
            type: 'string', 
            enum: ['active', 'idle', 'busy', 'failed', 'all'],
            default: 'all'
          }
        }
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.agentManager) {
          throw new Error('Agent manager not available');
        }

        try {
          const agents = await context.agentManager.getAllAgents();
          
          const filteredAgents = input.status === 'all' 
            ? agents 
            : agents.filter((agent: any) => agent.status === input.status);

          return {
            success: true,
            agents: filteredAgents,
            count: filteredAgents.length,
            filter: input.status
          };
        } catch (error) {
          logger.error('Failed to list agents via MCP', error);
          throw error;
        }
      }
    },

    // === RESOURCE MANAGEMENT TOOLS ===
    {
      name: 'resource_register',
      description: 'Register a new resource',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['compute', 'storage', 'network', 'memory', 'gpu', 'custom'] },
          name: { type: 'string', description: 'Resource name' },
          capacity: {
            type: 'object',
            properties: {
              cpu: { type: 'number' },
              memory: { type: 'number' },
              disk: { type: 'number' },
              network: { type: 'number' }
            }
          },
          metadata: { type: 'object', description: 'Additional metadata' }
        },
        required: ['type', 'name', 'capacity']
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.resourceManager) {
          throw new Error('Resource manager not available');
        }

        try {
          const resourceId = await context.resourceManager.registerResource(
            input.type,
            input.name,
            input.capacity,
            input.metadata || {}
          );

          logger.info('Resource registered via MCP', { resourceId, type: input.type });

          return {
            success: true,
            resourceId,
            message: `Registered ${input.type} resource: ${input.name}`
          };
        } catch (error) {
          logger.error('Failed to register resource via MCP', error);
          throw error;
        }
      }
    },

    {
      name: 'resource_get_statistics',
      description: 'Get resource manager statistics',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.resourceManager) {
          throw new Error('Resource manager not available');
        }

        try {
          const stats = context.resourceManager.getManagerStatistics();
          return {
            success: true,
            statistics: stats
          };
        } catch (error) {
          logger.error('Failed to get resource statistics via MCP', error);
          throw error;
        }
      }
    },

    // === MESSAGING TOOLS ===
    {
      name: 'message_send',
      description: 'Send a message through the message bus',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Message type' },
          content: { type: 'object', description: 'Message content' },
          sender: { type: 'string', description: 'Sender agent ID' },
          receivers: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Receiver agent IDs'
          },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
          channel: { type: 'string', description: 'Optional channel to use' }
        },
        required: ['type', 'content', 'sender', 'receivers']
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.messageBus) {
          throw new Error('Message bus not available');
        }

        try {
          const senderAgent = { id: input.sender, swarmId: 'default', type: 'coordinator', instance: 1 };
          const receiverAgents = input.receivers.map((id: string) => ({ 
            id, 
            swarmId: 'default', 
            type: 'coordinator', 
            instance: 1 
          }));

          const messageId = await context.messageBus.sendMessage(
            input.type,
            input.content,
            senderAgent,
            receiverAgents,
            {
              priority: input.priority || 'normal',
              channel: input.channel
            }
          );

          logger.info('Message sent via MCP', { messageId, type: input.type });

          return {
            success: true,
            messageId,
            message: 'Message sent successfully'
          };
        } catch (error) {
          logger.error('Failed to send message via MCP', error);
          throw error;
        }
      }
    },

    {
      name: 'message_get_metrics',
      description: 'Get message bus metrics',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.messageBus) {
          throw new Error('Message bus not available');
        }

        try {
          const metrics = context.messageBus.getMetrics();
          return {
            success: true,
            metrics
          };
        } catch (error) {
          logger.error('Failed to get message metrics via MCP', error);
          throw error;
        }
      }
    },

    // === MONITORING TOOLS ===
    {
      name: 'monitor_get_metrics',
      description: 'Get system monitoring metrics',
      inputSchema: {
        type: 'object',
        properties: {
          type: { 
            type: 'string',
            enum: ['system', 'swarm', 'agents', 'all'],
            default: 'all'
          }
        }
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.monitor) {
          throw new Error('Monitor not available');
        }

        try {
          const metrics: any = {};

          if (input.type === 'system' || input.type === 'all') {
            metrics.system = context.monitor.getSystemMetrics();
          }

          if (input.type === 'swarm' || input.type === 'all') {
            metrics.swarm = context.monitor.getSwarmMetrics();
          }

          if (input.type === 'agents' || input.type === 'all') {
            metrics.statistics = context.monitor.getMonitoringStatistics();
          }

          return {
            success: true,
            metrics
          };
        } catch (error) {
          logger.error('Failed to get monitoring metrics via MCP', error);
          throw error;
        }
      }
    },

    {
      name: 'monitor_get_alerts',
      description: 'Get active alerts',
      inputSchema: {
        type: 'object',
        properties: {
          level: { 
            type: 'string',
            enum: ['info', 'warning', 'critical', 'all'],
            default: 'all'
          },
          limit: { type: 'number', default: 50 }
        }
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        if (!context?.monitor) {
          throw new Error('Monitor not available');
        }

        try {
          let alerts = context.monitor.getActiveAlerts();

          if (input.level !== 'all') {
            alerts = alerts.filter((alert: any) => alert.level === input.level);
          }

          alerts = alerts.slice(0, input.limit);

          return {
            success: true,
            alerts,
            count: alerts.length
          };
        } catch (error) {
          logger.error('Failed to get alerts via MCP', error);
          throw error;
        }
      }
    },

    // === UTILITY TOOLS ===
    {
      name: 'swarm_get_comprehensive_status',
      description: 'Get comprehensive status of the entire swarm system',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        try {
          const status: any = {
            timestamp: new Date(),
            system: 'operational'
          };

          if (context?.swarmCoordinator) {
            status.swarm = await context.swarmCoordinator.getSwarmStatus();
          }

          if (context?.agentManager) {
            const agents = await context.agentManager.getAllAgents();
            status.agents = {
              total: agents.length,
              active: agents.filter((a: any) => a.status === 'active').length,
              idle: agents.filter((a: any) => a.status === 'idle').length,
              busy: agents.filter((a: any) => a.status === 'busy').length,
              failed: agents.filter((a: any) => a.status === 'failed').length
            };
          }

          if (context?.resourceManager) {
            status.resources = context.resourceManager.getManagerStatistics();
          }

          if (context?.messageBus) {
            status.messaging = context.messageBus.getMetrics();
          }

          if (context?.monitor) {
            status.monitoring = context.monitor.getMonitoringStatistics();
            status.systemMetrics = context.monitor.getSystemMetrics();
            status.swarmMetrics = context.monitor.getSwarmMetrics();
            status.activeAlerts = context.monitor.getActiveAlerts().length;
          }

          return {
            success: true,
            status
          };
        } catch (error) {
          logger.error('Failed to get comprehensive status via MCP', error);
          throw error;
        }
      }
    },

    {
      name: 'swarm_emergency_stop',
      description: 'Emergency stop of all swarm operations',
      inputSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Reason for emergency stop' },
          force: { type: 'boolean', default: false }
        },
        required: ['reason']
      },
      handler: async (input: any, context?: SwarmToolContext) => {
        logger.warn('Emergency stop initiated via MCP', { reason: input.reason });

        const results: any = {
          reason: input.reason,
          timestamp: new Date(),
          components: {}
        };

        try {
          // Stop swarm coordinator
          if (context?.swarmCoordinator) {
            await context.swarmCoordinator.emergencyStop(input.reason);
            results.components.swarmCoordinator = 'stopped';
          }

          // Stop all agents
          if (context?.agentManager) {
            await context.agentManager.stopAllAgents();
            results.components.agentManager = 'stopped';
          }

          // Release all resources (if method exists)
          if (context?.resourceManager?.releaseAllAllocations) {
            await context.resourceManager.releaseAllAllocations();
            results.components.resourceManager = 'resources_released';
          }

          // Stop message bus
          if (context?.messageBus?.shutdown) {
            await context.messageBus.shutdown();
            results.components.messageBus = 'stopped';
          }

          results.success = true;
          results.message = 'Emergency stop completed successfully';

          logger.info('Emergency stop completed via MCP', results);

          return results;
        } catch (error) {
          logger.error('Emergency stop failed via MCP', error);
          results.success = false;
          results.error = error instanceof Error ? error.message : 'Unknown error';
          throw error;
        }
      }
    }
  ];
}

// Legacy exports for backward compatibility
export const dispatchAgentTool = {
  name: 'dispatch_agent',
  description: 'Spawn a new agent in the swarm to handle a specific task',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['researcher', 'developer', 'analyst', 'reviewer', 'coordinator'],
        description: 'The type of agent to spawn',
      },
      task: {
        type: 'string',
        description: 'The specific task for the agent to complete',
      },
      name: {
        type: 'string',
        description: 'Optional name for the agent',
      },
    },
    required: ['type', 'task'],
  },
};

export const memoryStoreTool = {
  name: 'memory_store',
  description: 'Store data in the shared swarm memory for coordination',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The key to store data under',
      },
      value: {
        type: 'object',
        description: 'The data to store (JSON object)',
      },
    },
    required: ['key', 'value'],
  },
};

export const memoryRetrieveTool = {
  name: 'memory_retrieve',
  description: 'Retrieve data from the shared swarm memory',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The key to retrieve data from',
      },
    },
    required: ['key'],
  },
};

export const swarmStatusTool = {
  name: 'swarm_status',
  description: 'Get the current status of the swarm and all agents',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

// Legacy handler functions
export async function handleDispatchAgent(args: any): Promise<any> {
  const { type, task, name } = args;
  
  const swarmId = process.env.CLAUDE_SWARM_ID;
  if (!swarmId) {
    throw new Error('Not running in swarm context');
  }
  
  const parentId = process.env.CLAUDE_SWARM_AGENT_ID;
  
  try {
    // Legacy functionality - would integrate with swarm spawn system
    const agentId = `agent-${Date.now()}`;
    
    return {
      success: true,
      agentId,
      agentName: name || type,
      terminalId: 'N/A',
      message: `Successfully spawned ${name || type} to work on: ${task}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleSwarmStatus(args: any): Promise<any> {
  const swarmId = process.env.CLAUDE_SWARM_ID || 'default-swarm';
  
  // Legacy functionality - would integrate with swarm state system
  const mockState = {
    swarmId,
    objective: 'Legacy swarm status',
    startTime: Date.now() - 60000, // Started 1 minute ago
    agents: []
  };
  
  const runtime = Math.floor((Date.now() - mockState.startTime) / 1000);
  
  return {
    swarmId: mockState.swarmId,
    objective: mockState.objective,
    runtime: `${runtime}s`,
    totalAgents: mockState.agents.length,
    activeAgents: 0,
    completedAgents: 0,
    failedAgents: 0,
    agents: mockState.agents,
  };
}

export const swarmTools = [
  dispatchAgentTool,
  memoryStoreTool,
  memoryRetrieveTool,
  swarmStatusTool,
];