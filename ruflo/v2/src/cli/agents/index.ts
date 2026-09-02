/**
 * Agent System Index - Central exports and agent factory
 */

// Agent Classes
export { BaseAgent } from './base-agent.js';
export { ResearcherAgent, createResearcherAgent } from './researcher.js';
export { CoderAgent, createCoderAgent } from './coder.js';
export { AnalystAgent, createAnalystAgent } from './analyst.js';
export { ArchitectAgent, createArchitectAgent } from './architect.js';
export { TesterAgent, createTesterAgent } from './tester.js';
export { CoordinatorAgent, createCoordinatorAgent } from './coordinator.js';

// Systems
export { AgentCapabilitySystem } from './capabilities.js';
export { AgentManager } from '../../agents/agent-manager.js';
export { AgentRegistry } from '../../agents/agent-registry.js';

// Types
export type { AgentState } from './base-agent.js';
export type { CapabilityMatch, TaskRequirements, CapabilityRegistry } from './capabilities.js';

// Agent Factory
import type { AgentType, AgentConfig, AgentEnvironment } from '../../swarm/types.js';
import type { ILogger } from '../../core/logger.js';
import type { IEventBus } from '../../core/event-bus.js';
import type { DistributedMemorySystem } from '../../memory/distributed-memory.js';
import { BaseAgent } from './base-agent.js';
import { createResearcherAgent } from './researcher.js';
import { createCoderAgent } from './coder.js';
import { createAnalystAgent } from './analyst.js';
import { createArchitectAgent } from './architect.js';
import { createTesterAgent } from './tester.js';
import { createCoordinatorAgent } from './coordinator.js';
import { generateId } from '../../utils/helpers.js';

export interface AgentFactoryConfig {
  logger: ILogger;
  eventBus: IEventBus;
  memory: DistributedMemorySystem;
}

/**
 * Agent Factory - Creates specialized agents based on type
 */
export class AgentFactory {
  private logger: ILogger;
  private eventBus: IEventBus;
  private memory: DistributedMemorySystem;
  private agentCounter = 0;

  constructor(config: AgentFactoryConfig) {
    this.logger = config.logger;
    this.eventBus = config.eventBus;
    this.memory = config.memory;
  }

  /**
   * Create an agent of the specified type
   */
  createAgent(
    type: AgentType,
    config: Partial<AgentConfig> = {},
    environment: Partial<AgentEnvironment> = {},
    customId?: string,
  ): BaseAgent {
    const id = customId || this.generateAgentId(type);

    this.logger.info('Creating agent', {
      id,
      type,
      factory: 'AgentFactory',
    });

    switch (type) {
      case 'researcher':
        return createResearcherAgent(
          id,
          config,
          environment,
          this.logger,
          this.eventBus,
          this.memory,
        );

      case 'coder':
        return createCoderAgent(id, config, environment, this.logger, this.eventBus, this.memory);

      case 'analyst':
        return createAnalystAgent(id, config, environment, this.logger, this.eventBus, this.memory);

      case 'architect':
        return createArchitectAgent(
          id,
          config,
          environment,
          this.logger,
          this.eventBus,
          this.memory,
        );

      case 'tester':
        return createTesterAgent(id, config, environment, this.logger, this.eventBus, this.memory);

      case 'coordinator':
        return createCoordinatorAgent(
          id,
          config,
          environment,
          this.logger,
          this.eventBus,
          this.memory,
        );

      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }

  /**
   * Create multiple agents of different types
   */
  createAgents(
    specs: Array<{
      type: AgentType;
      count?: number;
      config?: Partial<AgentConfig>;
      environment?: Partial<AgentEnvironment>;
    }>,
  ): BaseAgent[] {
    const agents: BaseAgent[] = [];

    for (const spec of specs) {
      const count = spec.count || 1;
      for (let i = 0; i < count; i++) {
        const agent = this.createAgent(spec.type, spec.config, spec.environment);
        agents.push(agent);
      }
    }

    this.logger.info('Created multiple agents', {
      totalAgents: agents.length,
      specs: specs.map((s) => ({ type: s.type, count: s.count || 1 })),
    });

    return agents;
  }

  /**
   * Create a balanced swarm of agents
   */
  createBalancedSwarm(
    size: number = 5,
    strategy: 'research' | 'development' | 'analysis' | 'balanced' = 'balanced',
  ): BaseAgent[] {
    const compositions = {
      research: {
        researcher: 0.4,
        analyst: 0.3,
        coordinator: 0.2,
        architect: 0.1,
      },
      development: {
        coder: 0.4,
        tester: 0.25,
        architect: 0.2,
        coordinator: 0.15,
      },
      analysis: {
        analyst: 0.4,
        researcher: 0.3,
        coordinator: 0.2,
        architect: 0.1,
      },
      balanced: {
        coder: 0.25,
        researcher: 0.2,
        analyst: 0.2,
        tester: 0.15,
        architect: 0.1,
        coordinator: 0.1,
      },
    };

    const composition = compositions[strategy];
    const specs: Array<{ type: AgentType; count: number }> = [];

    for (const [type, ratio] of Object.entries(composition)) {
      const count = Math.max(1, Math.round(size * ratio));
      specs.push({ type: type as AgentType, count });
    }

    // Adjust if we have too many agents
    const totalCount = specs.reduce((sum, spec) => sum + spec.count, 0);
    if (totalCount > size) {
      // Remove from largest groups first
      specs.sort((a, b) => b.count - a.count);
      let excess = totalCount - size;
      for (const spec of specs) {
        if (excess <= 0) break;
        const reduction = Math.min(excess, spec.count - 1);
        spec.count -= reduction;
        excess -= reduction;
      }
    }

    return this.createAgents(specs.map((spec) => ({ type: spec.type, count: spec.count })));
  }

  /**
   * Get supported agent types
   */
  getSupportedTypes(): AgentType[] {
    return [
      'researcher', 'coder', 'analyst', 'architect', 'tester', 'coordinator',
      'reviewer', 'optimizer', 'documenter', 'monitor', 'specialist',
      'requirements_analyst', 'design_architect', 'task_planner', 
      'implementation_coder', 'quality_reviewer', 'steering_documenter'
    ];
  }

  /**
   * Get agent type descriptions
   */
  getAgentTypeDescriptions(): Record<AgentType, string> {
    return {
      researcher: 'Specialized in information gathering, web research, and data collection',
      coder: 'Expert in software development, code generation, and implementation',
      analyst: 'Focused on data analysis, performance optimization, and insights',
      architect: 'Designs system architecture, technical specifications, and solutions',
      tester: 'Specializes in testing, quality assurance, and validation',
      coordinator: 'Manages task orchestration, planning, and team coordination',
      reviewer: 'Reviews and validates work quality and standards',
      optimizer: 'Optimizes performance and efficiency across systems',
      documenter: 'Creates and maintains comprehensive documentation',
      monitor: 'Monitors system health and performance metrics',
      specialist: 'Provides domain-specific expertise and specialized knowledge',
      requirements_analyst: 'Analyzes requirements and creates user stories with acceptance criteria',
      design_architect: 'Creates technical designs and system architecture for features',
      'system-architect': 'High-level system architecture and design patterns',
      task_planner: 'Plans implementation tasks and orchestrates workflow execution', 
      'task-planner': 'Plans implementation tasks and orchestrates workflow execution',
      implementation_coder: 'Implements code based on designs with quality focus',
      developer: 'General purpose software development and implementation',
      quality_reviewer: 'Reviews code quality and ensures standards compliance',
      steering_documenter: 'Maintains governance documentation and project steering'
    };
  }

  /**
   * Generate unique agent ID
   */
  private generateAgentId(type: AgentType): string {
    this.agentCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.agentCounter.toString(36).padStart(2, '0');
    return `${type}-${timestamp}-${counter}`;
  }
}

/**
 * Create default agent factory instance
 */
export function createAgentFactory(
  logger: ILogger,
  eventBus: IEventBus,
  memory: DistributedMemorySystem,
): AgentFactory {
  return new AgentFactory({ logger, eventBus, memory });
}

/**
 * Agent lifecycle management utilities
 */
export class AgentLifecycle {
  private agents = new Map<string, BaseAgent>();
  private logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  /**
   * Register an agent for lifecycle management
   */
  register(agent: BaseAgent): void {
    const info = agent.getAgentInfo();
    this.agents.set(info.id.id, agent);
    this.logger.info('Agent registered for lifecycle management', {
      agentId: info.id.id,
      type: info.type,
    });
  }

  /**
   * Initialize all registered agents
   */
  async initializeAll(): Promise<void> {
    const initPromises = Array.from(this.agents.values()).map((agent) =>
      agent.initialize().catch((error) => {
        const info = agent.getAgentInfo();
        this.logger.error('Agent initialization failed', {
          agentId: info.id.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }),
    );

    await Promise.all(initPromises);
    this.logger.info('All agents initialized', {
      count: this.agents.size,
    });
  }

  /**
   * Shutdown all registered agents
   */
  async shutdownAll(): Promise<void> {
    const shutdownPromises = Array.from(this.agents.values()).map((agent) =>
      agent.shutdown().catch((error) => {
        const info = agent.getAgentInfo();
        this.logger.error('Agent shutdown failed', {
          agentId: info.id.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    );

    await Promise.all(shutdownPromises);
    this.agents.clear();
    this.logger.info('All agents shutdown');
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all registered agents
   */
  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: AgentType): BaseAgent[] {
    return Array.from(this.agents.values()).filter((agent) => {
      const info = agent.getAgentInfo();
      return info.type === type;
    });
  }

  /**
   * Get agent statistics
   */
  getStatistics(): {
    total: number;
    byType: Record<AgentType, number>;
    byStatus: Record<string, number>;
    healthy: number;
    active: number;
  } {
    const stats = {
      total: this.agents.size,
      byType: {} as Record<AgentType, number>,
      byStatus: {} as Record<string, number>,
      healthy: 0,
      active: 0,
    };

    for (const agent of this.agents.values()) {
      const info = agent.getAgentInfo();

      // Count by type
      stats.byType[info.type] = (stats.byType[info.type] || 0) + 1;

      // Count by status
      stats.byStatus[info.status] = (stats.byStatus[info.status] || 0) + 1;

      // Count healthy agents (health > 0.7)
      if (info.health > 0.7) {
        stats.healthy++;
      }

      // Count active agents
      if (info.status === 'idle' || info.status === 'busy') {
        stats.active++;
      }
    }

    return stats;
  }
}
