/**
 * V3 Lifecycle Manager
 * Decomposed from orchestrator.ts - Agent spawn/terminate
 * ~150 lines (target achieved)
 */

import type {
  IAgent,
  IAgentConfig,
  IAgentLifecycleManager,
  IAgentPool,
  AgentStatus,
} from '../interfaces/agent.interface.js';
import type { IEventBus } from '../interfaces/event.interface.js';
import { SystemEventTypes } from '../interfaces/event.interface.js';

/**
 * Agent pool implementation
 */
export class AgentPool implements IAgentPool {
  private agents = new Map<string, IAgent>();

  add(agent: IAgent): void {
    this.agents.set(agent.id, agent);
  }

  remove(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  get(agentId: string): IAgent | undefined {
    return this.agents.get(agentId);
  }

  getAll(): IAgent[] {
    return Array.from(this.agents.values());
  }

  getByStatus(status: AgentStatus): IAgent[] {
    return this.getAll().filter(agent => agent.status === status);
  }

  getByType(type: string): IAgent[] {
    return this.getAll().filter(agent => agent.type === type);
  }

  getAvailable(): IAgent[] {
    return this.getAll().filter(
      agent =>
        (agent.status === 'active' || agent.status === 'idle') &&
        agent.currentTaskCount < agent.config.maxConcurrentTasks,
    );
  }

  size(): number {
    return this.agents.size;
  }

  hasCapacity(maxSize: number): boolean {
    return this.agents.size < maxSize;
  }

  clear(): void {
    this.agents.clear();
  }
}

/**
 * Lifecycle manager configuration
 */
export interface LifecycleManagerConfig {
  maxConcurrentAgents: number;
  spawnTimeout: number;
  terminateTimeout: number;
  maxSpawnRetries: number;
}

/**
 * Lifecycle manager implementation
 */
export class LifecycleManager implements IAgentLifecycleManager {
  private pool: IAgentPool;

  constructor(
    private eventBus: IEventBus,
    private config: LifecycleManagerConfig,
    pool?: IAgentPool,
  ) {
    this.pool = pool ?? new AgentPool();
  }

  async spawn(config: IAgentConfig): Promise<IAgent> {
    // Validate capacity
    if (!this.pool.hasCapacity(this.config.maxConcurrentAgents)) {
      throw new Error('Maximum concurrent agents reached');
    }

    // Validate agent doesn't already exist
    if (this.pool.get(config.id)) {
      throw new Error(`Agent with ID ${config.id} already exists`);
    }

    const agent: IAgent = {
      id: config.id,
      name: config.name,
      type: config.type,
      config,
      createdAt: new Date(),
      status: 'spawning',
      currentTaskCount: 0,
      lastActivity: new Date(),
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        avgTaskDuration: 0,
        errorCount: 0,
        uptime: 0,
      },
    };

    // Add to pool
    this.pool.add(agent);

    // Mark as active
    agent.status = 'active';

    this.eventBus.emit(SystemEventTypes.AGENT_SPAWNED, {
      agentId: agent.id,
      profile: config,
      sessionId: undefined,
    });

    return agent;
  }

  async spawnBatch(configs: IAgentConfig[]): Promise<Map<string, IAgent>> {
    const results = new Map<string, IAgent>();

    // Check total capacity
    if (this.pool.size() + configs.length > this.config.maxConcurrentAgents) {
      throw new Error('Batch would exceed maximum concurrent agents');
    }

    // Spawn in parallel
    const spawnPromises = configs.map(async config => {
      try {
        const agent = await this.spawn(config);
        return { id: config.id, agent, error: null };
      } catch (error) {
        return { id: config.id, agent: null, error };
      }
    });

    const settled = await Promise.allSettled(spawnPromises);

    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value.agent) {
        results.set(result.value.id, result.value.agent);
      }
    }

    return results;
  }

  async terminate(agentId: string, reason?: string): Promise<void> {
    const agent = this.pool.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    agent.status = 'terminated';

    // Remove from pool
    this.pool.remove(agentId);

    this.eventBus.emit(SystemEventTypes.AGENT_TERMINATED, {
      agentId,
      reason: reason ?? 'User requested',
    });
  }

  async terminateAll(reason?: string): Promise<void> {
    const agents = this.pool.getAll();
    await Promise.allSettled(
      agents.map(agent => this.terminate(agent.id, reason)),
    );
  }

  async restart(agentId: string): Promise<IAgent> {
    const agent = this.pool.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const config = agent.config;
    await this.terminate(agentId, 'Restart requested');
    return this.spawn(config);
  }

  async updateConfig(agentId: string, config: Partial<IAgentConfig>): Promise<void> {
    const agent = this.pool.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    Object.assign(agent.config, config);
  }

  getAgent(agentId: string): IAgent | undefined {
    return this.pool.get(agentId);
  }

  getAllAgents(): IAgent[] {
    return this.pool.getAll();
  }

  getActiveCount(): number {
    return this.pool.getByStatus('active').length +
           this.pool.getByStatus('idle').length;
  }

  async checkHealth(agentId: string): Promise<IAgent['health']> {
    const agent = this.pool.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Simple health check based on metrics
    const errorRate = agent.metrics
      ? agent.metrics.errorCount / Math.max(1, agent.metrics.tasksCompleted + agent.metrics.tasksFailed)
      : 0;

    const health: IAgent['health'] = {
      status: errorRate > 0.5 ? 'unhealthy' : errorRate > 0.2 ? 'degraded' : 'healthy',
      lastCheck: new Date(),
      issues: [],
    };

    if (errorRate > 0.2) {
      health.issues?.push(`High error rate: ${(errorRate * 100).toFixed(1)}%`);
    }

    agent.health = health;

    if (health.status !== 'healthy') {
      this.eventBus.emit(SystemEventTypes.AGENT_HEALTH_CHANGED, {
        agentId,
        previousStatus: agent.status,
        currentStatus: agent.status,
        issues: health.issues,
      });
    }

    return health;
  }

  /**
   * Get agent pool
   */
  getPool(): IAgentPool {
    return this.pool;
  }
}
