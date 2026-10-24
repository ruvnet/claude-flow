/**
 * V3 Claude-Flow Swarm Test Instance
 *
 * Creates isolated swarm instances for testing
 * Supports 15-agent V3 swarm topology testing
 */
import { vi, type Mock } from 'vitest';
import { createMock, type MockedInterface, InteractionRecorder } from './create-mock.js';

/**
 * Agent types for V3 15-agent swarm
 */
export type V3AgentType =
  | 'queen-coordinator'
  | 'security-architect'
  | 'security-auditor'
  | 'memory-specialist'
  | 'swarm-specialist'
  | 'integration-architect'
  | 'performance-engineer'
  | 'core-architect'
  | 'test-architect'
  | 'project-coordinator'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'planner'
  | 'researcher';

/**
 * Swarm topology types
 */
export type SwarmTopology = 'hierarchical' | 'mesh' | 'adaptive' | 'hierarchical-mesh';

/**
 * Agent interface for swarm testing
 */
export interface SwarmAgent {
  id: string;
  type: V3AgentType;
  status: 'idle' | 'busy' | 'terminated';
  capabilities: string[];
  execute(task: SwarmTask): Promise<SwarmTaskResult>;
  communicate(message: SwarmMessage): Promise<void>;
}

/**
 * Swarm message interface
 */
export interface SwarmMessage {
  from: string;
  to: string | 'broadcast';
  type: 'task' | 'result' | 'status' | 'coordination';
  payload: unknown;
  timestamp: Date;
}

/**
 * Swarm task interface
 */
export interface SwarmTask {
  id: string;
  type: string;
  payload: unknown;
  priority: number;
  assignedTo?: string;
}

/**
 * Swarm task result
 */
export interface SwarmTaskResult {
  taskId: string;
  agentId: string;
  success: boolean;
  output?: unknown;
  error?: Error;
  duration: number;
}

/**
 * Swarm coordination result
 */
export interface SwarmCoordinationResult {
  success: boolean;
  completedTasks: number;
  failedTasks: number;
  totalDuration: number;
  agentMetrics: Map<string, AgentMetrics>;
}

/**
 * Agent metrics
 */
export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  averageTaskDuration: number;
  totalDuration: number;
}

/**
 * Create a test swarm instance with mocked agents
 */
export function createSwarmTestInstance(config?: {
  topology?: SwarmTopology;
  agentTypes?: V3AgentType[];
}): SwarmTestInstance {
  const topology = config?.topology ?? 'hierarchical-mesh';
  const agentTypes = config?.agentTypes ?? [
    'queen-coordinator',
    'security-architect',
    'security-auditor',
    'memory-specialist',
    'swarm-specialist',
  ];

  return new SwarmTestInstance(topology, agentTypes);
}

/**
 * Swarm test instance class
 */
export class SwarmTestInstance {
  private agents: Map<string, MockedInterface<SwarmAgent>> = new Map();
  private messages: SwarmMessage[] = [];
  private taskResults: SwarmTaskResult[] = [];
  private interactionRecorder: InteractionRecorder;
  private isInitialized = false;

  constructor(
    public readonly topology: SwarmTopology,
    private readonly agentTypes: V3AgentType[]
  ) {
    this.interactionRecorder = new InteractionRecorder();
    this.initializeAgents();
  }

  private initializeAgents(): void {
    for (const type of this.agentTypes) {
      const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const agent = this.createMockAgent(id, type);
      this.agents.set(id, agent);
      this.interactionRecorder.track(id, agent);
    }
  }

  private createMockAgent(id: string, type: V3AgentType): MockedInterface<SwarmAgent> {
    const mock = createMock<SwarmAgent>();

    // Set default properties
    Object.defineProperty(mock, 'id', { value: id, writable: false });
    Object.defineProperty(mock, 'type', { value: type, writable: false });
    Object.defineProperty(mock, 'status', { value: 'idle', writable: true });
    Object.defineProperty(mock, 'capabilities', {
      value: this.getCapabilitiesForType(type),
      writable: false
    });

    // Configure default behavior
    mock.execute.mockImplementation(async (task: SwarmTask) => {
      const result: SwarmTaskResult = {
        taskId: task.id,
        agentId: id,
        success: true,
        duration: Math.random() * 100 + 10,
      };
      this.taskResults.push(result);
      return result;
    });

    mock.communicate.mockImplementation(async (message: SwarmMessage) => {
      this.messages.push(message);
    });

    return mock;
  }

  private getCapabilitiesForType(type: V3AgentType): string[] {
    const capabilities: Record<V3AgentType, string[]> = {
      'queen-coordinator': ['orchestration', 'task-distribution', 'agent-management'],
      'security-architect': ['security-design', 'threat-modeling', 'security-review'],
      'security-auditor': ['cve-detection', 'vulnerability-scanning', 'security-testing'],
      'memory-specialist': ['memory-optimization', 'agentdb-integration', 'caching'],
      'swarm-specialist': ['coordination', 'consensus', 'communication'],
      'integration-architect': ['api-design', 'system-integration', 'compatibility'],
      'performance-engineer': ['optimization', 'benchmarking', 'profiling'],
      'core-architect': ['ddd-design', 'architecture', 'domain-modeling'],
      'test-architect': ['tdd', 'test-design', 'quality-assurance'],
      'project-coordinator': ['project-management', 'scheduling', 'reporting'],
      'coder': ['coding', 'implementation', 'debugging'],
      'reviewer': ['code-review', 'quality-check', 'suggestions'],
      'tester': ['testing', 'test-execution', 'coverage'],
      'planner': ['planning', 'estimation', 'roadmap'],
      'researcher': ['research', 'analysis', 'documentation'],
    };
    return capabilities[type];
  }

  /**
   * Initialize the swarm
   */
  async initialize(): Promise<void> {
    this.isInitialized = true;
    // Simulate initialization delay
    await new Promise(resolve => setTimeout(resolve, 1));
  }

  /**
   * Get an agent by type
   */
  getAgent(type: V3AgentType): MockedInterface<SwarmAgent> | undefined {
    for (const [_, agent] of this.agents) {
      if ((agent as unknown as SwarmAgent).type === type) {
        return agent;
      }
    }
    return undefined;
  }

  /**
   * Get all agents
   */
  getAllAgents(): MockedInterface<SwarmAgent>[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by ID
   */
  getAgentById(id: string): MockedInterface<SwarmAgent> | undefined {
    return this.agents.get(id);
  }

  /**
   * Get all messages
   */
  getMessages(): SwarmMessage[] {
    return [...this.messages];
  }

  /**
   * Get task results
   */
  getTaskResults(): SwarmTaskResult[] {
    return [...this.taskResults];
  }

  /**
   * Get interaction order for behavior verification
   */
  getInteractionOrder(): string[] {
    return this.interactionRecorder.getInteractionOrder();
  }

  /**
   * Get all interactions
   */
  getInteractions(): Array<{ name: string; method: string; args: unknown[] }> {
    return this.interactionRecorder.getInteractions();
  }

  /**
   * Coordinate a task across agents
   */
  async coordinate(task: SwarmTask): Promise<SwarmCoordinationResult> {
    if (!this.isInitialized) {
      throw new Error('Swarm not initialized');
    }

    const startTime = Date.now();
    const results: SwarmTaskResult[] = [];

    // Simulate coordination based on topology
    const queen = this.getAgent('queen-coordinator');
    if (queen && this.topology.includes('hierarchical')) {
      await queen.communicate({
        from: 'coordinator',
        to: 'broadcast',
        type: 'task',
        payload: task,
        timestamp: new Date(),
      });
    }

    // Execute task on appropriate agent
    for (const agent of this.agents.values()) {
      const result = await agent.execute(task);
      results.push(result);
    }

    const completedTasks = results.filter(r => r.success).length;
    const failedTasks = results.filter(r => !r.success).length;

    return {
      success: failedTasks === 0,
      completedTasks,
      failedTasks,
      totalDuration: Date.now() - startTime,
      agentMetrics: new Map(),
    };
  }

  /**
   * Shutdown the swarm
   */
  async shutdown(): Promise<void> {
    for (const agent of this.agents.values()) {
      Object.defineProperty(agent, 'status', { value: 'terminated', writable: true });
    }
    this.isInitialized = false;
  }

  /**
   * Reset the swarm state
   */
  reset(): void {
    this.messages = [];
    this.taskResults = [];
    this.interactionRecorder.clear();

    for (const agent of this.agents.values()) {
      vi.clearAllMocks();
    }
  }
}
