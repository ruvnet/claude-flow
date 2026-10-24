/**
 * Spawn Agent Command - Application Layer (CQRS)
 *
 * Command for spawning a new agent in the swarm.
 *
 * @module v3/swarm/application/commands
 */

import { Agent, AgentRole, AgentProps } from '../../domain/entities/agent.js';
import { IAgentRepository } from '../../domain/repositories/agent-repository.interface.js';

/**
 * Spawn Agent Command Input
 */
export interface SpawnAgentInput {
  name: string;
  role: AgentRole;
  domain: string;
  capabilities: string[];
  parentId?: string;
  metadata?: Record<string, unknown>;
  maxConcurrentTasks?: number;
  autoStart?: boolean;
}

/**
 * Spawn Agent Command Result
 */
export interface SpawnAgentResult {
  success: boolean;
  agentId: string;
  agent: Agent;
  startedAutomatically: boolean;
}

/**
 * Spawn Agent Command Handler
 */
export class SpawnAgentCommandHandler {
  constructor(private readonly repository: IAgentRepository) {}

  async execute(input: SpawnAgentInput): Promise<SpawnAgentResult> {
    // Check if agent with same name exists
    const existing = await this.repository.findByName(input.name);
    if (existing) {
      throw new Error(`Agent with name '${input.name}' already exists`);
    }

    // Create agent
    const agent = Agent.create({
      name: input.name,
      role: input.role,
      domain: input.domain,
      capabilities: input.capabilities,
      parentId: input.parentId,
      metadata: input.metadata,
      maxConcurrentTasks: input.maxConcurrentTasks,
    });

    // Auto-start if requested
    let startedAutomatically = false;
    if (input.autoStart) {
      agent.start();
      startedAutomatically = true;
    }

    await this.repository.save(agent);

    return {
      success: true,
      agentId: agent.id,
      agent,
      startedAutomatically,
    };
  }
}

/**
 * Terminate Agent Command Input
 */
export interface TerminateAgentInput {
  agentId: string;
  force?: boolean;
}

/**
 * Terminate Agent Command Result
 */
export interface TerminateAgentResult {
  success: boolean;
  agentId: string;
  tasksReassigned: number;
}

/**
 * Terminate Agent Command Handler
 */
export class TerminateAgentCommandHandler {
  constructor(private readonly repository: IAgentRepository) {}

  async execute(input: TerminateAgentInput): Promise<TerminateAgentResult> {
    const agent = await this.repository.findById(input.agentId);
    if (!agent) {
      throw new Error(`Agent '${input.agentId}' not found`);
    }

    const currentTasks = agent.currentTaskCount;

    if (currentTasks > 0 && !input.force) {
      throw new Error(`Agent has ${currentTasks} active tasks. Use force=true to terminate anyway.`);
    }

    agent.terminate();
    await this.repository.save(agent);

    return {
      success: true,
      agentId: input.agentId,
      tasksReassigned: currentTasks,
    };
  }
}
