/**
 * Swarm Application Service - Application Layer
 *
 * Orchestrates swarm operations and provides simplified interface.
 *
 * @module v3/swarm/application/services
 */

import { Agent, AgentRole, AgentStatus } from '../../domain/entities/agent.js';
import { Task, TaskStatus, TaskPriority } from '../../domain/entities/task.js';
import { IAgentRepository, AgentStatistics } from '../../domain/repositories/agent-repository.interface.js';
import { ITaskRepository, TaskStatistics } from '../../domain/repositories/task-repository.interface.js';
import { CoordinationService, LoadBalancingStrategy, SwarmHealth } from '../../domain/services/coordination-service.js';
import { SpawnAgentCommandHandler, SpawnAgentInput, TerminateAgentCommandHandler } from '../commands/spawn-agent.command.js';
import { CreateTaskCommandHandler, CreateTaskInput, CancelTaskCommandHandler } from '../commands/create-task.command.js';

/**
 * Swarm configuration
 */
export interface SwarmConfig {
  loadBalancingStrategy?: LoadBalancingStrategy;
  autoScaling?: boolean;
  minAgents?: number;
  maxAgents?: number;
}

/**
 * Swarm Application Service
 */
export class SwarmApplicationService {
  private readonly coordinationService: CoordinationService;
  private readonly spawnHandler: SpawnAgentCommandHandler;
  private readonly terminateHandler: TerminateAgentCommandHandler;
  private readonly createTaskHandler: CreateTaskCommandHandler;
  private readonly cancelTaskHandler: CancelTaskCommandHandler;

  constructor(
    private readonly agentRepository: IAgentRepository,
    private readonly taskRepository: ITaskRepository,
    private readonly config: SwarmConfig = {}
  ) {
    this.coordinationService = new CoordinationService(agentRepository, taskRepository);
    this.spawnHandler = new SpawnAgentCommandHandler(agentRepository);
    this.terminateHandler = new TerminateAgentCommandHandler(agentRepository);
    this.createTaskHandler = new CreateTaskCommandHandler(taskRepository);
    this.cancelTaskHandler = new CancelTaskCommandHandler(taskRepository);
  }

  // ============================================================================
  // Agent Operations
  // ============================================================================

  /**
   * Spawn a new agent
   */
  async spawnAgent(input: SpawnAgentInput): Promise<Agent> {
    const result = await this.spawnHandler.execute(input);
    return result.agent;
  }

  /**
   * Terminate an agent
   */
  async terminateAgent(agentId: string, force = false): Promise<void> {
    await this.terminateHandler.execute({ agentId, force });
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<Agent | null> {
    return this.agentRepository.findById(agentId);
  }

  /**
   * List all agents
   */
  async listAgents(options?: {
    status?: AgentStatus;
    role?: AgentRole;
    domain?: string;
  }): Promise<Agent[]> {
    return this.agentRepository.findAll(options);
  }

  /**
   * Get agent statistics
   */
  async getAgentStatistics(): Promise<AgentStatistics> {
    return this.agentRepository.getStatistics();
  }

  // ============================================================================
  // Task Operations
  // ============================================================================

  /**
   * Create a new task
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    const result = await this.createTaskHandler.execute(input);
    return result.task;
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<void> {
    await this.cancelTaskHandler.execute({ taskId });
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    return this.taskRepository.findById(taskId);
  }

  /**
   * List tasks
   */
  async listTasks(options?: {
    status?: TaskStatus;
    priority?: TaskPriority;
    assignedAgentId?: string;
  }): Promise<Task[]> {
    return this.taskRepository.findAll(options);
  }

  /**
   * Get task statistics
   */
  async getTaskStatistics(): Promise<TaskStatistics> {
    return this.taskRepository.getStatistics();
  }

  // ============================================================================
  // Orchestration
  // ============================================================================

  /**
   * Assign pending tasks to available agents
   */
  async processPendingTasks(): Promise<number> {
    const queuedTasks = await this.taskRepository.findQueued();
    let assigned = 0;

    for (const task of queuedTasks) {
      const result = await this.coordinationService.assignTask(
        task.id,
        this.config.loadBalancingStrategy ?? 'capability-match'
      );
      if (result.success) assigned++;
    }

    return assigned;
  }

  /**
   * Complete a task
   */
  async completeTask(taskId: string, output?: unknown): Promise<void> {
    await this.coordinationService.processTaskCompletion(taskId, output);
  }

  /**
   * Fail a task
   */
  async failTask(taskId: string, error: string): Promise<boolean> {
    return this.coordinationService.processTaskFailure(taskId, error);
  }

  /**
   * Get swarm health
   */
  async getHealth(): Promise<SwarmHealth> {
    return this.coordinationService.getSwarmHealth();
  }

  /**
   * Get scaling recommendation
   */
  async getScalingRecommendation() {
    return this.coordinationService.calculateScalingRecommendation();
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async initialize(): Promise<void> {
    await this.agentRepository.initialize();
    await this.taskRepository.initialize();
  }

  async shutdown(): Promise<void> {
    await this.agentRepository.shutdown();
    await this.taskRepository.shutdown();
  }
}
