/**
 * V3 Claude-Flow Test Application Factory
 *
 * Creates isolated test instances of the application
 * Following London School principles for dependency injection
 */
import { vi, type Mock } from 'vitest';
import { createMock, type MockedInterface } from './create-mock.js';

/**
 * Core domain interfaces for testing
 */
export interface IEventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): void;
  unsubscribe(eventType: string, handler: EventHandler): void;
}

export interface ITaskManager {
  create(task: TaskDefinition): Promise<Task>;
  execute(taskId: string): Promise<TaskResult>;
  cancel(taskId: string): Promise<void>;
  getStatus(taskId: string): Promise<TaskStatus>;
}

export interface IAgentLifecycle {
  spawn(config: AgentConfig): Promise<Agent>;
  terminate(agentId: string): Promise<void>;
  getAgent(agentId: string): Promise<Agent | null>;
  listAgents(): Promise<Agent[]>;
}

export interface IMemoryService {
  store(key: string, value: unknown, metadata?: MemoryMetadata): Promise<void>;
  retrieve(key: string): Promise<unknown>;
  search(query: VectorQuery): Promise<SearchResult[]>;
  delete(key: string): Promise<void>;
}

export interface ISecurityService {
  validatePath(path: string): boolean;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  executeSecurely(command: string, options?: ExecuteOptions): Promise<ExecuteResult>;
}

export interface ISwarmCoordinator {
  initialize(config: SwarmConfig): Promise<void>;
  coordinate(agents: Agent[], task: Task): Promise<CoordinationResult>;
  shutdown(): Promise<void>;
}

/**
 * Type definitions for domain objects
 */
export interface DomainEvent {
  type: string;
  payload: unknown;
  timestamp: Date;
  correlationId?: string;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

export interface TaskDefinition {
  name: string;
  type: string;
  payload: unknown;
  priority?: number;
}

export interface Task {
  id: string;
  name: string;
  type: string;
  status: TaskStatus;
  payload: unknown;
  createdAt: Date;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskResult {
  taskId: string;
  success: boolean;
  output?: unknown;
  error?: Error;
  duration: number;
}

export interface AgentConfig {
  type: string;
  name: string;
  capabilities: string[];
}

export interface Agent {
  id: string;
  type: string;
  name: string;
  status: 'idle' | 'busy' | 'terminated';
}

export interface MemoryMetadata {
  ttl?: number;
  tags?: string[];
  embedding?: number[];
}

export interface VectorQuery {
  embedding: number[];
  topK: number;
  threshold?: number;
}

export interface SearchResult {
  key: string;
  value: unknown;
  score: number;
}

export interface ExecuteOptions {
  timeout?: number;
  cwd?: string;
  shell?: boolean;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SwarmConfig {
  topology: 'hierarchical' | 'mesh' | 'adaptive';
  maxAgents: number;
}

export interface CoordinationResult {
  success: boolean;
  results: TaskResult[];
  duration: number;
}

/**
 * Test application builder with full dependency injection
 *
 * @example
 * const app = createTestApplication()
 *   .withMockEventBus()
 *   .withMockTaskManager()
 *   .build();
 *
 * await app.services.taskManager.create(task);
 * expect(app.mocks.eventBus.publish).toHaveBeenCalled();
 */
export function createTestApplication(): TestApplicationBuilder {
  return new TestApplicationBuilder();
}

/**
 * Test application structure with mocked services
 */
export interface TestApplication {
  services: {
    eventBus: IEventBus;
    taskManager: ITaskManager;
    agentLifecycle: IAgentLifecycle;
    memoryService: IMemoryService;
    securityService: ISecurityService;
    swarmCoordinator: ISwarmCoordinator;
  };
  mocks: {
    eventBus: MockedInterface<IEventBus>;
    taskManager: MockedInterface<ITaskManager>;
    agentLifecycle: MockedInterface<IAgentLifecycle>;
    memoryService: MockedInterface<IMemoryService>;
    securityService: MockedInterface<ISecurityService>;
    swarmCoordinator: MockedInterface<ISwarmCoordinator>;
  };
}

/**
 * Builder class for constructing test applications
 */
class TestApplicationBuilder {
  private eventBus: MockedInterface<IEventBus> = createMock<IEventBus>();
  private taskManager: MockedInterface<ITaskManager> = createMock<ITaskManager>();
  private agentLifecycle: MockedInterface<IAgentLifecycle> = createMock<IAgentLifecycle>();
  private memoryService: MockedInterface<IMemoryService> = createMock<IMemoryService>();
  private securityService: MockedInterface<ISecurityService> = createMock<ISecurityService>();
  private swarmCoordinator: MockedInterface<ISwarmCoordinator> = createMock<ISwarmCoordinator>();

  /**
   * Configure mock event bus with default behavior
   */
  withMockEventBus(configure?: (mock: MockedInterface<IEventBus>) => void): this {
    this.eventBus = createMock<IEventBus>();
    this.eventBus.publish.mockResolvedValue(undefined);
    configure?.(this.eventBus);
    return this;
  }

  /**
   * Configure mock task manager with default behavior
   */
  withMockTaskManager(configure?: (mock: MockedInterface<ITaskManager>) => void): this {
    this.taskManager = createMock<ITaskManager>();
    this.taskManager.create.mockImplementation(async (def: TaskDefinition) => ({
      id: `task-${Date.now()}`,
      name: def.name,
      type: def.type,
      status: 'pending' as TaskStatus,
      payload: def.payload,
      createdAt: new Date(),
    }));
    this.taskManager.execute.mockResolvedValue({
      taskId: 'test-task',
      success: true,
      duration: 100,
    });
    configure?.(this.taskManager);
    return this;
  }

  /**
   * Configure mock agent lifecycle with default behavior
   */
  withMockAgentLifecycle(configure?: (mock: MockedInterface<IAgentLifecycle>) => void): this {
    this.agentLifecycle = createMock<IAgentLifecycle>();
    this.agentLifecycle.spawn.mockImplementation(async (config: AgentConfig) => ({
      id: `agent-${Date.now()}`,
      type: config.type,
      name: config.name,
      status: 'idle' as const,
    }));
    this.agentLifecycle.listAgents.mockResolvedValue([]);
    configure?.(this.agentLifecycle);
    return this;
  }

  /**
   * Configure mock memory service with default behavior
   */
  withMockMemoryService(configure?: (mock: MockedInterface<IMemoryService>) => void): this {
    this.memoryService = createMock<IMemoryService>();
    this.memoryService.store.mockResolvedValue(undefined);
    this.memoryService.retrieve.mockResolvedValue(null);
    this.memoryService.search.mockResolvedValue([]);
    configure?.(this.memoryService);
    return this;
  }

  /**
   * Configure mock security service with default behavior
   */
  withMockSecurityService(configure?: (mock: MockedInterface<ISecurityService>) => void): this {
    this.securityService = createMock<ISecurityService>();
    this.securityService.validatePath.mockReturnValue(true);
    this.securityService.hashPassword.mockResolvedValue('hashed');
    this.securityService.verifyPassword.mockResolvedValue(true);
    this.securityService.executeSecurely.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
    configure?.(this.securityService);
    return this;
  }

  /**
   * Configure mock swarm coordinator with default behavior
   */
  withMockSwarmCoordinator(configure?: (mock: MockedInterface<ISwarmCoordinator>) => void): this {
    this.swarmCoordinator = createMock<ISwarmCoordinator>();
    this.swarmCoordinator.initialize.mockResolvedValue(undefined);
    this.swarmCoordinator.coordinate.mockResolvedValue({
      success: true,
      results: [],
      duration: 0,
    });
    this.swarmCoordinator.shutdown.mockResolvedValue(undefined);
    configure?.(this.swarmCoordinator);
    return this;
  }

  /**
   * Build the test application with all configured mocks
   */
  build(): TestApplication {
    return {
      services: {
        eventBus: this.eventBus as IEventBus,
        taskManager: this.taskManager as ITaskManager,
        agentLifecycle: this.agentLifecycle as IAgentLifecycle,
        memoryService: this.memoryService as IMemoryService,
        securityService: this.securityService as ISecurityService,
        swarmCoordinator: this.swarmCoordinator as ISwarmCoordinator,
      },
      mocks: {
        eventBus: this.eventBus,
        taskManager: this.taskManager,
        agentLifecycle: this.agentLifecycle,
        memoryService: this.memoryService,
        securityService: this.securityService,
        swarmCoordinator: this.swarmCoordinator,
      },
    };
  }
}
