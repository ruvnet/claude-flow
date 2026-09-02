/**
 * System Status Tool
 *
 * Returns comprehensive system status including:
 * - Uptime and version information
 * - Active agents and tasks
 * - Memory usage
 * - Performance metrics
 */

import type { MCPTool, ClaudeFlowToolContext } from '../../types.js';
import type { ILogger } from '../../../interfaces/logger.js';

interface SystemStatusInput {
  includeMetrics?: boolean;
  includeAgents?: boolean;
  includeTasks?: boolean;
}

interface SystemStatusResult {
  success: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  timestamp: string;
  agents?: {
    total: number;
    active: number;
    idle: number;
  };
  tasks?: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
  metrics?: {
    memoryUsage: number;
    cpuUsage: number;
    avgResponseTime: number;
  };
}

export function createSystemStatusTool(logger: ILogger): MCPTool {
  return {
    name: 'system/status',
    description: 'Get comprehensive system status including uptime, active agents, tasks, and performance metrics. Use this to check system health.',

    inputSchema: {
      type: 'object',
      properties: {
        includeMetrics: {
          type: 'boolean',
          description: 'Include performance metrics',
          default: false,
        },
        includeAgents: {
          type: 'boolean',
          description: 'Include agent statistics',
          default: true,
        },
        includeTasks: {
          type: 'boolean',
          description: 'Include task statistics',
          default: true,
        },
      },
      required: [],
    },

    metadata: {
      category: 'system',
      tags: ['status', 'health', 'monitoring', 'metrics'],
      examples: [
        {
          description: 'Get basic system status',
          input: {},
          expectedOutput: {
            success: true,
            status: 'healthy',
            uptime: 3600000,
            version: '2.7.32',
          },
        },
        {
          description: 'Get full system status with metrics',
          input: {
            includeMetrics: true,
            includeAgents: true,
            includeTasks: true,
          },
          expectedOutput: {
            success: true,
            status: 'healthy',
            agents: { total: 5, active: 3, idle: 2 },
            tasks: { total: 20, running: 5, completed: 12, failed: 3 },
            metrics: { memoryUsage: 250, cpuUsage: 45, avgResponseTime: 150 },
          },
        },
      ],
      detailLevel: 'standard',
    },

    handler: async (
      input: any,
      context?: ClaudeFlowToolContext
    ): Promise<SystemStatusResult> => {
      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available in tool context');
      }

      const validatedInput = input as SystemStatusInput;

      logger.info('system/status invoked', {
        input: validatedInput,
        sessionId: context.sessionId,
      });

      try {
        // Get base status
        const result: SystemStatusResult = {
          success: true,
          status: 'healthy',
          uptime: process.uptime() * 1000, // Convert to milliseconds
          version: process.env.npm_package_version || '2.7.32',
          timestamp: new Date().toISOString(),
        };

        // Get agent statistics if requested
        if (validatedInput.includeAgents !== false) {
          try {
            const agentStats = await context.orchestrator.getAgentStats?.();
            if (agentStats) {
              result.agents = {
                total: agentStats.total || 0,
                active: agentStats.active || 0,
                idle: agentStats.idle || 0,
              };
            }
          } catch (error) {
            logger.warn('Failed to get agent statistics', { error });
          }
        }

        // Get task statistics if requested
        if (validatedInput.includeTasks !== false) {
          try {
            const taskStats = await context.orchestrator.getTaskStats?.();
            if (taskStats) {
              result.tasks = {
                total: taskStats.total || 0,
                running: taskStats.running || 0,
                completed: taskStats.completed || 0,
                failed: taskStats.failed || 0,
              };
            }
          } catch (error) {
            logger.warn('Failed to get task statistics', { error });
          }
        }

        // Get performance metrics if requested
        if (validatedInput.includeMetrics) {
          try {
            const memUsage = process.memoryUsage();
            result.metrics = {
              memoryUsage: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
              cpuUsage: Math.round(process.cpuUsage().user / 1000), // Approximate %
              avgResponseTime: 0, // TODO: Get from metrics store
            };
          } catch (error) {
            logger.warn('Failed to get performance metrics', { error });
          }
        }

        // Determine overall health status
        if (result.agents && result.agents.active === 0 && result.agents.total > 0) {
          result.status = 'degraded';
        }
        if (result.tasks && result.tasks.failed > result.tasks.completed / 2) {
          result.status = 'unhealthy';
        }

        logger.info('system/status completed successfully', {
          status: result.status,
          uptime: result.uptime,
        });

        return result;
      } catch (error) {
        logger.error('system/status failed', {
          error,
          input: validatedInput,
        });
        throw error;
      }
    },
  };
}

export const toolMetadata = {
  name: 'system/status',
  description: 'Get system health status and metrics',
  category: 'system',
  detailLevel: 'standard' as const,
};
