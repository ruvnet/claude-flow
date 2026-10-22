/**
 * V3 Agent Registry
 * Manages registration, lifecycle, and capabilities of all 15 agents
 *
 * Based on ADR-002 (DDD) and 15-Agent Swarm Architecture
 */

import {
  AgentId,
  AgentRole,
  AgentDomain,
  AgentStatus,
  AgentDefinition,
  AgentState,
  AgentCapability,
  AgentMetrics,
  TaskType,
  TaskId,
  SwarmEvent,
  EventHandler
} from '../shared/types.js';
import {
  IEventBus,
  agentSpawnedEvent,
  agentStatusChangedEvent,
  agentErrorEvent
} from '../shared/events.js';

// =============================================================================
// Agent Registry Interface
// =============================================================================

export interface IAgentRegistry {
  // Registration
  register(definition: AgentDefinition): void;
  unregister(agentId: AgentId): boolean;
  isRegistered(agentId: AgentId): boolean;

  // Lifecycle
  spawn(agentId: AgentId): Promise<AgentState>;
  terminate(agentId: AgentId): Promise<boolean>;

  // State Management
  getState(agentId: AgentId): AgentState | undefined;
  updateStatus(agentId: AgentId, status: AgentStatus): void;
  assignTask(agentId: AgentId, taskId: TaskId): void;
  completeTask(agentId: AgentId, taskId: TaskId): void;

  // Queries
  getDefinition(agentId: AgentId): AgentDefinition | undefined;
  getAllAgents(): AgentDefinition[];
  getActiveAgents(): AgentState[];
  getAgentsByDomain(domain: AgentDomain): AgentDefinition[];
  getAgentsByCapability(taskType: TaskType): AgentDefinition[];

  // Health
  heartbeat(agentId: AgentId): void;
  getHealthStatus(): Map<AgentId, HealthStatus>;

  // Events
  onAgentEvent(handler: EventHandler): () => void;
}

export interface HealthStatus {
  agentId: AgentId;
  healthy: boolean;
  lastHeartbeat: number;
  consecutiveMisses: number;
  status: AgentStatus;
}

// =============================================================================
// Agent Registry Implementation
// =============================================================================

export class AgentRegistry implements IAgentRegistry {
  private definitions: Map<AgentId, AgentDefinition> = new Map();
  private states: Map<AgentId, AgentState> = new Map();
  private healthChecks: Map<AgentId, HealthStatus> = new Map();
  private eventBus: IEventBus;
  private healthCheckInterval: number = 5000;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private maxMissedHeartbeats: number = 3;

  constructor(eventBus: IEventBus) {
    this.eventBus = eventBus;
    this.registerDefaultAgents();
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  register(definition: AgentDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Agent ${definition.id} is already registered`);
    }

    this.definitions.set(definition.id, definition);

    this.healthChecks.set(definition.id, {
      agentId: definition.id,
      healthy: false,
      lastHeartbeat: 0,
      consecutiveMisses: 0,
      status: 'idle'
    });
  }

  unregister(agentId: AgentId): boolean {
    if (this.states.has(agentId)) {
      throw new Error(`Cannot unregister active agent ${agentId}`);
    }

    this.healthChecks.delete(agentId);
    return this.definitions.delete(agentId);
  }

  isRegistered(agentId: AgentId): boolean {
    return this.definitions.has(agentId);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async spawn(agentId: AgentId): Promise<AgentState> {
    const definition = this.definitions.get(agentId);
    if (!definition) {
      throw new Error(`Agent ${agentId} is not registered`);
    }

    if (this.states.has(agentId)) {
      throw new Error(`Agent ${agentId} is already spawned`);
    }

    const state: AgentState = {
      id: agentId,
      role: definition.role,
      status: 'idle',
      currentTask: null,
      completedTasks: [],
      metrics: this.createInitialMetrics(),
      lastHeartbeat: Date.now()
    };

    this.states.set(agentId, state);

    const healthStatus = this.healthChecks.get(agentId)!;
    healthStatus.healthy = true;
    healthStatus.lastHeartbeat = Date.now();
    healthStatus.status = 'idle';

    await this.eventBus.emit(agentSpawnedEvent(agentId, definition.role));

    return state;
  }

  async terminate(agentId: AgentId): Promise<boolean> {
    const state = this.states.get(agentId);
    if (!state) {
      return false;
    }

    if (state.currentTask) {
      throw new Error(`Cannot terminate agent ${agentId} with active task ${state.currentTask}`);
    }

    this.states.delete(agentId);

    const healthStatus = this.healthChecks.get(agentId);
    if (healthStatus) {
      healthStatus.healthy = false;
      healthStatus.status = 'idle';
    }

    await this.eventBus.emit(agentStatusChangedEvent(agentId, state.status, 'terminated'));

    return true;
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  getState(agentId: AgentId): AgentState | undefined {
    return this.states.get(agentId);
  }

  updateStatus(agentId: AgentId, status: AgentStatus): void {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Agent ${agentId} is not spawned`);
    }

    const previousStatus = state.status;
    state.status = status;

    const healthStatus = this.healthChecks.get(agentId);
    if (healthStatus) {
      healthStatus.status = status;
    }

    this.eventBus.emitSync(agentStatusChangedEvent(agentId, previousStatus, status));
  }

  assignTask(agentId: AgentId, taskId: TaskId): void {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Agent ${agentId} is not spawned`);
    }

    if (state.currentTask) {
      throw new Error(`Agent ${agentId} already has task ${state.currentTask}`);
    }

    state.currentTask = taskId;
    this.updateStatus(agentId, 'active');
  }

  completeTask(agentId: AgentId, taskId: TaskId): void {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Agent ${agentId} is not spawned`);
    }

    if (state.currentTask !== taskId) {
      throw new Error(`Agent ${agentId} current task is ${state.currentTask}, not ${taskId}`);
    }

    state.completedTasks.push(taskId);
    state.currentTask = null;
    state.metrics.tasksCompleted++;

    this.updateStatus(agentId, 'idle');
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  getDefinition(agentId: AgentId): AgentDefinition | undefined {
    return this.definitions.get(agentId);
  }

  getAllAgents(): AgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  getActiveAgents(): AgentState[] {
    return Array.from(this.states.values()).filter(s => s.status === 'active');
  }

  getAgentsByDomain(domain: AgentDomain): AgentDefinition[] {
    return Array.from(this.definitions.values()).filter(d => d.domain === domain);
  }

  getAgentsByCapability(taskType: TaskType): AgentDefinition[] {
    return Array.from(this.definitions.values()).filter(d =>
      d.capabilities.some(c => c.supportedTaskTypes.includes(taskType))
    );
  }

  // ==========================================================================
  // Health Management
  // ==========================================================================

  heartbeat(agentId: AgentId): void {
    const state = this.states.get(agentId);
    if (state) {
      state.lastHeartbeat = Date.now();
    }

    const healthStatus = this.healthChecks.get(agentId);
    if (healthStatus) {
      healthStatus.lastHeartbeat = Date.now();
      healthStatus.consecutiveMisses = 0;
      healthStatus.healthy = true;
    }
  }

  getHealthStatus(): Map<AgentId, HealthStatus> {
    return new Map(this.healthChecks);
  }

  startHealthChecks(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckInterval);
  }

  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private performHealthCheck(): void {
    const now = Date.now();

    for (const [agentId, healthStatus] of this.healthChecks) {
      const state = this.states.get(agentId);
      if (!state) {
        continue;
      }

      const timeSinceHeartbeat = now - healthStatus.lastHeartbeat;

      if (timeSinceHeartbeat > this.healthCheckInterval) {
        healthStatus.consecutiveMisses++;

        if (healthStatus.consecutiveMisses >= this.maxMissedHeartbeats) {
          healthStatus.healthy = false;
          this.updateStatus(agentId, 'error');

          this.eventBus.emitSync(agentErrorEvent(
            agentId,
            new Error(`Agent ${agentId} missed ${healthStatus.consecutiveMisses} heartbeats`)
          ));
        }
      }
    }
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  onAgentEvent(handler: EventHandler): () => void {
    const unsubscribers = [
      this.eventBus.subscribe('agent:spawned', handler),
      this.eventBus.subscribe('agent:status-changed', handler),
      this.eventBus.subscribe('agent:task-assigned', handler),
      this.eventBus.subscribe('agent:task-completed', handler),
      this.eventBus.subscribe('agent:error', handler)
    ];

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }

  // ==========================================================================
  // Default Agent Registration
  // ==========================================================================

  private registerDefaultAgents(): void {
    const agentDefinitions: AgentDefinition[] = [
      {
        id: 'agent-1',
        role: 'queen-coordinator',
        domain: 'core',
        description: 'Orchestration & GitHub Issue management for all 15 agents',
        capabilities: [
          { name: 'orchestration', description: 'Coordinate all agents', supportedTaskTypes: ['architecture-design'] },
          { name: 'github-management', description: 'Manage GitHub issues and PRs', supportedTaskTypes: ['documentation'] }
        ],
        dependencies: [],
        priority: 1
      },
      {
        id: 'agent-2',
        role: 'security-architect',
        domain: 'security',
        description: 'Security architecture review and design',
        capabilities: [
          { name: 'security-design', description: 'Design security architecture', supportedTaskTypes: ['security-audit', 'architecture-design'] }
        ],
        dependencies: [],
        priority: 2
      },
      {
        id: 'agent-3',
        role: 'security-implementer',
        domain: 'security',
        description: 'CVE fixes and security code implementation',
        capabilities: [
          { name: 'security-implementation', description: 'Implement security fixes', supportedTaskTypes: ['security-fix', 'implementation'] }
        ],
        dependencies: ['agent-2'],
        priority: 2
      },
      {
        id: 'agent-4',
        role: 'security-tester',
        domain: 'security',
        description: 'Security testing using TDD London School methodology',
        capabilities: [
          { name: 'security-testing', description: 'Write and run security tests', supportedTaskTypes: ['security-test', 'test-writing'] }
        ],
        dependencies: ['agent-2'],
        priority: 2
      },
      {
        id: 'agent-5',
        role: 'core-architect',
        domain: 'core',
        description: 'Core module DDD architecture design',
        capabilities: [
          { name: 'architecture', description: 'Design core architecture', supportedTaskTypes: ['architecture-design'] }
        ],
        dependencies: ['agent-2'],
        priority: 3
      },
      {
        id: 'agent-6',
        role: 'core-implementer',
        domain: 'core',
        description: 'Core module implementation and type system modernization',
        capabilities: [
          { name: 'core-implementation', description: 'Implement core modules', supportedTaskTypes: ['implementation'] }
        ],
        dependencies: ['agent-5'],
        priority: 3
      },
      {
        id: 'agent-7',
        role: 'memory-specialist',
        domain: 'core',
        description: 'Memory system unification with AgentDB (150x-12500x improvement)',
        capabilities: [
          { name: 'memory-optimization', description: 'Optimize memory systems', supportedTaskTypes: ['memory-optimization', 'implementation'] }
        ],
        dependencies: ['agent-5'],
        priority: 4
      },
      {
        id: 'agent-8',
        role: 'swarm-specialist',
        domain: 'core',
        description: 'Single SwarmCoordinator (merge 4 systems)',
        capabilities: [
          { name: 'swarm-coordination', description: 'Design swarm coordination', supportedTaskTypes: ['swarm-coordination', 'implementation'] }
        ],
        dependencies: ['agent-5'],
        priority: 4
      },
      {
        id: 'agent-9',
        role: 'mcp-specialist',
        domain: 'core',
        description: 'MCP server optimization and enhancement',
        capabilities: [
          { name: 'mcp-optimization', description: 'Optimize MCP server', supportedTaskTypes: ['mcp-enhancement', 'implementation'] }
        ],
        dependencies: ['agent-5'],
        priority: 4
      },
      {
        id: 'agent-10',
        role: 'integration-architect',
        domain: 'integration',
        description: 'agentic-flow@alpha deep integration',
        capabilities: [
          { name: 'integration', description: 'Integrate with agentic-flow', supportedTaskTypes: ['integration', 'architecture-design'] }
        ],
        dependencies: ['agent-5', 'agent-7', 'agent-8', 'agent-9'],
        priority: 5
      },
      {
        id: 'agent-11',
        role: 'cli-hooks-developer',
        domain: 'integration',
        description: 'CLI modernization and hooks system development',
        capabilities: [
          { name: 'cli-development', description: 'Develop CLI and hooks', supportedTaskTypes: ['cli-development', 'implementation'] }
        ],
        dependencies: ['agent-9', 'agent-10'],
        priority: 5
      },
      {
        id: 'agent-12',
        role: 'neural-learning-dev',
        domain: 'integration',
        description: 'Neural and SONA learning system integration',
        capabilities: [
          { name: 'neural-training', description: 'Implement neural features', supportedTaskTypes: ['neural-training', 'implementation'] }
        ],
        dependencies: ['agent-7', 'agent-10'],
        priority: 5
      },
      {
        id: 'agent-13',
        role: 'tdd-test-engineer',
        domain: 'quality',
        description: 'TDD London School methodology implementation',
        capabilities: [
          { name: 'testing', description: 'Write comprehensive tests', supportedTaskTypes: ['test-writing'] }
        ],
        dependencies: [],
        priority: 3
      },
      {
        id: 'agent-14',
        role: 'performance-engineer',
        domain: 'performance',
        description: 'Benchmarking and performance optimization (2.49x-7.47x target)',
        capabilities: [
          { name: 'benchmarking', description: 'Run performance benchmarks', supportedTaskTypes: ['benchmark'] }
        ],
        dependencies: ['agent-7', 'agent-8'],
        priority: 6
      },
      {
        id: 'agent-15',
        role: 'release-engineer',
        domain: 'deployment',
        description: 'Deployment pipeline and release management',
        capabilities: [
          { name: 'deployment', description: 'Manage releases', supportedTaskTypes: ['deployment', 'documentation'] }
        ],
        dependencies: ['agent-10', 'agent-13', 'agent-14'],
        priority: 7
      }
    ];

    for (const definition of agentDefinitions) {
      this.register(definition);
    }
  }

  private createInitialMetrics(): AgentMetrics {
    return {
      tasksCompleted: 0,
      tasksFailed: 0,
      averageTaskDuration: 0,
      utilization: 0,
      startTime: Date.now()
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createAgentRegistry(eventBus: IEventBus): IAgentRegistry {
  return new AgentRegistry(eventBus);
}
