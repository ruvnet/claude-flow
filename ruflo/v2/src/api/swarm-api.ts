/**
 * Swarm API - RESTful API for swarm coordination and management
 * Provides HTTP endpoints for swarm operations, agent management, and task orchestration
 */

import { Router } from 'express';
import { ILogger } from '../core/logger.js';
import { ClaudeAPIClient } from './claude-client.js';
import { ConfigManager } from '../config/config-manager.js';
import { ICoordinationManager } from '../coordination/manager.js';
import { SwarmCoordinator } from '../swarm/coordinator.js';
import { AgentManager } from '../agents/agent-manager.js';
import { ResourceManager } from '../resources/resource-manager.js';
import { SwarmConfig } from '../utils/types.js';
import { ValidationError, SwarmError } from '../utils/errors.js';
import { nanoid } from 'nanoid';

export interface SwarmApiConfig {
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  authentication: {
    enabled: boolean;
    apiKeys?: string[];
    jwtSecret?: string;
  };
  cors: {
    origins: string[];
    methods: string[];
  };
  swagger: {
    enabled: boolean;
    title: string;
    version: string;
    description: string;
  };
}

export interface SwarmCreateRequest {
  name: string;
  topology: 'hierarchical' | 'mesh' | 'ring' | 'star';
  maxAgents?: number;
  strategy?: 'balanced' | 'specialized' | 'adaptive';
  config?: Partial<SwarmConfig>;
}

export interface AgentSpawnRequest {
  type: string;
  name?: string;
  capabilities?: string[];
  config?: Record<string, unknown>;
}

export interface TaskOrchestrationRequest {
  task: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  strategy?: 'parallel' | 'sequential' | 'adaptive';
  maxAgents?: number;
  requirements?: string[];
  metadata?: Record<string, unknown>;
}

export interface SwarmMetrics {
  swarmId: string;
  agentCount: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageResponseTime: number;
  resourceUtilization: Record<string, number>;
  healthScore: number;
}

/**
 * Swarm API implementation
 */
export class SwarmApi {
  private router: Router;
  private swarms = new Map<string, SwarmCoordinator>();

  constructor(
    private config: SwarmApiConfig,
    private logger: ILogger,
    private claudeClient: ClaudeAPIClient,
    private configManager: ConfigManager,
    private coordinationManager: ICoordinationManager,
    private agentManager: AgentManager,
    private resourceManager: ResourceManager,
  ) {
    this.router = Router();
    this.setupRoutes();
    this.setupMiddleware();
  }

  getRouter(): Router {
    return this.router;
  }

  private setupMiddleware(): void {
    // Request logging
    this.router.use((req, res, next) => {
      this.logger.info('Swarm API request', {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });
      next();
    });

    // Request validation
    this.router.use((req, res, next) => {
      if (req.method === 'POST' || req.method === 'PUT') {
        if (!req.body) {
          return res.status(400).json({
            error: 'Request body is required',
            code: 'MISSING_BODY',
          });
        }
      }
      next();
    });

    // Error handling
    this.router.use((err: Error, req: any, res: any, _next: any) => {
      this.logger.error('Swarm API error', {
        error: err.message,
        stack: err.stack,
        method: req.method,
        path: req.path,
      });

      if (err instanceof ValidationError) {
        return res.status(400).json({
          error: err.message,
          code: 'VALIDATION_ERROR',
          details: err.details,
        });
      }

      if (err instanceof SwarmError) {
        return res.status(409).json({
          error: err.message,
          code: 'SWARM_ERROR',
          details: err.details,
        });
      }

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    });
  }

  private setupRoutes(): void {
    // Health check
    this.router.get('/health', async (req, res) => {
      try {
        const health = await this.getSystemHealth();
        res.json(health);
      } catch (error) {
        res.status(500).json({
          healthy: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Swarm management
    this.router.post('/swarms', this.createSwarm.bind(this));
    this.router.get('/swarms', this.listSwarms.bind(this));
    this.router.get('/swarms/:swarmId', this.getSwarm.bind(this));
    this.router.delete('/swarms/:swarmId', this.destroySwarm.bind(this));
    this.router.post('/swarms/:swarmId/scale', this.scaleSwarm.bind(this));

    // Agent management
    this.router.post('/swarms/:swarmId/agents', this.spawnAgent.bind(this));
    this.router.get('/swarms/:swarmId/agents', this.listAgents.bind(this));
    this.router.get('/swarms/:swarmId/agents/:agentId', this.getAgent.bind(this));
    this.router.delete('/swarms/:swarmId/agents/:agentId', this.terminateAgent.bind(this));

    // Task orchestration
    this.router.post('/swarms/:swarmId/tasks', this.orchestrateTask.bind(this));
    this.router.get('/swarms/:swarmId/tasks', this.listTasks.bind(this));
    this.router.get('/swarms/:swarmId/tasks/:taskId', this.getTask.bind(this));
    this.router.delete('/swarms/:swarmId/tasks/:taskId', this.cancelTask.bind(this));

    // Metrics and monitoring
    this.router.get('/swarms/:swarmId/metrics', this.getSwarmMetrics.bind(this));
    this.router.get('/swarms/:swarmId/status', this.getSwarmStatus.bind(this));
    this.router.get('/system/metrics', this.getSystemMetrics.bind(this));
  }

  private async createSwarm(req: any, res: any): Promise<void> {
    try {
      const request = req.body as SwarmCreateRequest;
      
      // Validate request
      if (!request.name || !request.topology) {
        return res.status(400).json({
          error: 'Name and topology are required',
          code: 'VALIDATION_ERROR',
        });
      }

      // Create swarm configuration
      const swarmConfig: SwarmConfig = {
        name: request.name,
        topology: request.topology,
        maxAgents: request.maxAgents || 8,
        strategy: request.strategy || 'balanced',
        ...request.config,
      };

      // Generate swarm ID
      const swarmId = `swarm_${Date.now()}_${nanoid(10)}`;

      // Create swarm coordinator
      const swarm = new SwarmCoordinator(
        swarmId,
        swarmConfig,
        this.logger,
        this.claudeClient,
        this.configManager,
        this.coordinationManager,
        this.agentManager,
        this.resourceManager,
      );

      // Initialize swarm
      await swarm.initialize();

      // Store swarm
      this.swarms.set(swarmId, swarm);

      this.logger.info('Swarm created', {
        swarmId,
        name: request.name,
        topology: request.topology,
      });

      res.status(201).json({
        swarmId,
        name: request.name,
        topology: request.topology,
        maxAgents: swarmConfig.maxAgents,
        strategy: swarmConfig.strategy,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      throw error;
    }
  }

  private async listSwarms(req: any, res: any): Promise<void> {
    try {
      const swarmList = Array.from(this.swarms.entries()).map(([swarmId, swarm]) => ({
        swarmId,
        name: swarm.getConfig().name,
        topology: swarm.getConfig().topology,
        agentCount: swarm.getAgentCount(),
        status: swarm.getStatus(),
        createdAt: swarm.getCreatedAt(),
      }));

      res.json({
        swarms: swarmList,
        total: swarmList.length,
      });
    } catch (error) {
      throw error;
    }
  }

  private async getSwarm(req: any, res: any): Promise<void> {
    try {
      const { swarmId } = req.params;
      const swarm = this.swarms.get(swarmId);

      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      const config = swarm.getConfig();
      const status = swarm.getStatus();
      const agents = await swarm.getAgents();
      const metrics = await swarm.getMetrics();

      res.json({
        swarmId,
        config,
        status,
        agents: agents.map(agent => ({
          id: agent.id,
          type: agent.type,
          name: agent.name,
          status: agent.status,
          capabilities: agent.capabilities,
        })),
        metrics,
        createdAt: swarm.getCreatedAt(),
      });
    } catch (error) {
      throw error;
    }
  }

  private async destroySwarm(req: any, res: any): Promise<void> {
    try {
      const { swarmId } = req.params;
      const swarm = this.swarms.get(swarmId);

      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      await swarm.destroy();
      this.swarms.delete(swarmId);

      this.logger.info('Swarm destroyed', { swarmId });

      res.json({
        message: 'Swarm destroyed successfully',
        swarmId,
      });
    } catch (error) {
      throw error;
    }
  }

  private async scaleSwarm(req: any, res: any): Promise<void> {
    try {
      const { swarmId } = req.params;
      const { targetSize } = req.body;

      if (!targetSize || targetSize < 1) {
        return res.status(400).json({
          error: 'Valid targetSize is required',
          code: 'VALIDATION_ERROR',
        });
      }

      const swarm = this.swarms.get(swarmId);
      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      await swarm.scale(targetSize);

      res.json({
        message: 'Swarm scaled successfully',
        swarmId,
        newSize: targetSize,
      });
    } catch (error) {
      throw error;
    }
  }

  private async spawnAgent(req: any, res: any): Promise<void> {
    try {
      const { swarmId } = req.params;
      const request = req.body as AgentSpawnRequest;

      if (!request.type) {
        return res.status(400).json({
          error: 'Agent type is required',
          code: 'VALIDATION_ERROR',
        });
      }

      const swarm = this.swarms.get(swarmId);
      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      const agent = await swarm.spawnAgent({
        type: request.type,
        name: request.name,
        capabilities: request.capabilities || [],
        config: request.config,
      });

      res.status(201).json({
        agent: {
          id: agent.id,
          type: agent.type,
          name: agent.name,
          status: agent.status,
          capabilities: agent.capabilities,
        },
        swarmId,
      });
    } catch (error) {
      throw error;
    }
  }

  private async orchestrateTask(req: any, res: any): Promise<void> {
    try {
      const { swarmId } = req.params;
      const request = req.body as TaskOrchestrationRequest;

      if (!request.task) {
        return res.status(400).json({
          error: 'Task description is required',
          code: 'VALIDATION_ERROR',
        });
      }

      const swarm = this.swarms.get(swarmId);
      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      const task = await swarm.orchestrateTask({
        description: request.task,
        priority: request.priority || 'medium',
        strategy: request.strategy || 'adaptive',
        maxAgents: request.maxAgents,
        requirements: request.requirements,
        metadata: request.metadata,
      });

      res.status(201).json({
        task: {
          id: task.id,
          description: task.description,
          status: task.status,
          priority: task.priority,
          strategy: task.strategy,
        },
        swarmId,
      });
    } catch (error) {
      throw error;
    }
  }

  private async getSwarmMetrics(req: any, res: any): Promise<void> {
    try {
      const { swarmId } = req.params;
      const swarm = this.swarms.get(swarmId);

      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      const metrics = await swarm.getMetrics();
      res.json(metrics);
    } catch (error) {
      throw error;
    }
  }

  private async getSwarmStatus(req: any, res: any): Promise<void> {
    try {
      const { swarmId } = req.params;
      const swarm = this.swarms.get(swarmId);

      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      const status = await swarm.getDetailedStatus();
      res.json(status);
    } catch (error) {
      throw error;
    }
  }

  private async getSystemHealth(): Promise<{
    healthy: boolean;
    services: Record<string, { healthy: boolean; error?: string }>;
    metrics: Record<string, number>;
  }> {
    const services: Record<string, { healthy: boolean; error?: string }> = {};
    let allHealthy = true;

    // Check Claude API health
    const claudeHealth = this.claudeClient.getHealthStatus();
    services.claude = {
      healthy: claudeHealth?.healthy || false,
      error: claudeHealth?.error,
    };
    allHealthy = allHealthy && services.claude.healthy;

    // Check coordination manager health
    const coordHealth = await this.coordinationManager.getHealthStatus();
    services.coordination = {
      healthy: coordHealth.healthy,
      error: coordHealth.error,
    };
    allHealthy = allHealthy && services.coordination.healthy;

    // Check agent manager health
    const agentHealth = await this.agentManager.getHealthStatus();
    services.agents = {
      healthy: agentHealth.healthy,
      error: agentHealth.error,
    };
    allHealthy = allHealthy && services.agents.healthy;

    // Collect metrics
    const metrics = {
      totalSwarms: this.swarms.size,
      ...coordHealth.metrics,
      ...agentHealth.metrics,
    };

    return {
      healthy: allHealthy,
      services,
      metrics,
    };
  }

  private async getSystemMetrics(req: any, res: any): Promise<void> {
    try {
      const systemMetrics = await this.getSystemHealth();
      const swarmMetrics = await Promise.all(
        Array.from(this.swarms.values()).map(async (swarm) => {
          const metrics = await swarm.getMetrics();
          return {
            swarmId: swarm.getId(),
            ...metrics,
          };
        }),
      );

      res.json({
        system: systemMetrics,
        swarms: swarmMetrics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      throw error;
    }
  }

  // Additional helper methods
  private async listAgents(req: any, res: any): Promise<void> {
    try {
      const { swarmId } = req.params;
      const swarm = this.swarms.get(swarmId);

      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      const agents = await swarm.getAgents();
      res.json({
        agents: agents.map(agent => ({
          id: agent.id,
          type: agent.type,
          name: agent.name,
          status: agent.status,
          capabilities: agent.capabilities,
          createdAt: agent.createdAt,
        })),
        total: agents.length,
      });
    } catch (error) {
      throw error;
    }
  }

  private async getAgent(req: any, res: any): Promise<void> {
    try {
      const { swarmId, agentId } = req.params;
      const swarm = this.swarms.get(swarmId);

      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      const agent = await swarm.getAgent(agentId);
      if (!agent) {
        return res.status(404).json({
          error: 'Agent not found',
          code: 'AGENT_NOT_FOUND',
        });
      }

      res.json(agent);
    } catch (error) {
      throw error;
    }
  }

  private async terminateAgent(req: any, res: any): Promise<void> {
    try {
      const { swarmId, agentId } = req.params;
      const swarm = this.swarms.get(swarmId);

      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      await swarm.terminateAgent(agentId);
      res.json({
        message: 'Agent terminated successfully',
        agentId,
        swarmId,
      });
    } catch (error) {
      throw error;
    }
  }

  private async listTasks(req: any, res: any): Promise<void> {
    try {
      const { swarmId } = req.params;
      const swarm = this.swarms.get(swarmId);

      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      const tasks = await swarm.getTasks();
      res.json({
        tasks: tasks.map(task => ({
          id: task.id,
          description: task.description,
          status: task.status,
          priority: task.priority,
          assignedTo: task.assignedTo,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
        })),
        total: tasks.length,
      });
    } catch (error) {
      throw error;
    }
  }

  private async getTask(req: any, res: any): Promise<void> {
    try {
      const { swarmId, taskId } = req.params;
      const swarm = this.swarms.get(swarmId);

      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      const task = await swarm.getTask(taskId);
      if (!task) {
        return res.status(404).json({
          error: 'Task not found',
          code: 'TASK_NOT_FOUND',
        });
      }

      res.json(task);
    } catch (error) {
      throw error;
    }
  }

  private async cancelTask(req: any, res: any): Promise<void> {
    try {
      const { swarmId, taskId } = req.params;
      const { reason } = req.body;
      const swarm = this.swarms.get(swarmId);

      if (!swarm) {
        return res.status(404).json({
          error: 'Swarm not found',
          code: 'SWARM_NOT_FOUND',
        });
      }

      await swarm.cancelTask(taskId, reason || 'User requested cancellation');
      res.json({
        message: 'Task cancelled successfully',
        taskId,
        swarmId,
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    this.logger.info('Destroying Swarm API');

    // Destroy all swarms
    for (const [swarmId, swarm] of this.swarms) {
      try {
        await swarm.destroy();
      } catch (error) {
        this.logger.error('Error destroying swarm', { swarmId, error });
      }
    }

    this.swarms.clear();
  }
}