/**
 * @claude-flow/testing - Mock Factory
 *
 * Factory functions for creating comprehensive mocks of V3 services and components.
 * Implements London School TDD patterns with behavior verification.
 */
import { vi, type Mock } from 'vitest';
import { createMock, createMockWithBehavior, type MockedInterface } from './create-mock.js';
import type { V3AgentType, AgentInstance, AgentMetrics } from '../fixtures/agent-fixtures.js';
import type { MemoryEntry, SearchResult, VectorQuery } from '../fixtures/memory-fixtures.js';
import type { SwarmState, SwarmConfig, SwarmTask, SwarmTaskResult, CoordinationResult } from '../fixtures/swarm-fixtures.js';
import type { MCPTool, MCPToolResult, MCPServerConfig, MCPSessionContext } from '../fixtures/mcp-fixtures.js';

/**
 * Event bus interface for DDD events
 */
export interface IEventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): () => void;
  unsubscribe(eventType: string, handler: EventHandler): void;
  getSubscriberCount(eventType: string): number;
}

/**
 * Domain event interface
 */
export interface DomainEvent {
  id: string;
  type: string;
  payload: unknown;
  timestamp: Date;
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Event handler type
 */
export type EventHandler = (event: DomainEvent) => Promise<void>;

/**
 * Task manager interface
 */
export interface ITaskManager {
  create(definition: TaskDefinition): Promise<Task>;
  execute(taskId: string): Promise<TaskResult>;
  cancel(taskId: string): Promise<void>;
  getStatus(taskId: string): Promise<TaskStatus>;
  getTask(taskId: string): Promise<Task | null>;
  listTasks(filters?: TaskFilters): Promise<Task[]>;
}

/**
 * Task definition interface
 */
export interface TaskDefinition {
  name: string;
  type: string;
  payload: unknown;
  priority?: number;
  dependencies?: string[];
  deadline?: Date;
}

/**
 * Task interface
 */
export interface Task {
  id: string;
  name: string;
  type: string;
  status: TaskStatus;
  payload: unknown;
  priority: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Task status type
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Task result interface
 */
export interface TaskResult {
  taskId: string;
  success: boolean;
  output?: unknown;
  error?: Error;
  duration: number;
}

/**
 * Task filters interface
 */
export interface TaskFilters {
  status?: TaskStatus;
  type?: string;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}

/**
 * Agent lifecycle interface
 */
export interface IAgentLifecycle {
  spawn(config: AgentConfig): Promise<AgentSpawnResult>;
  terminate(agentId: string, options?: TerminateOptions): Promise<void>;
  getAgent(agentId: string): Promise<AgentInstance | null>;
  listAgents(filters?: AgentFilters): Promise<AgentInstance[]>;
  getMetrics(agentId: string): Promise<AgentMetrics>;
  healthCheck(agentId: string): Promise<AgentHealthCheck>;
}

/**
 * Agent config interface
 */
export interface AgentConfig {
  type: V3AgentType;
  name: string;
  capabilities?: string[];
  priority?: number;
}

/**
 * Agent spawn result interface
 */
export interface AgentSpawnResult {
  agent: AgentInstance;
  sessionId: string;
  startupTime: number;
  success: boolean;
}

/**
 * Terminate options interface
 */
export interface TerminateOptions {
  graceful?: boolean;
  timeout?: number;
  cancelTasks?: boolean;
}

/**
 * Agent filters interface
 */
export interface AgentFilters {
  type?: V3AgentType;
  status?: string;
  capability?: string;
}

/**
 * Agent health check interface
 */
export interface AgentHealthCheck {
  healthy: boolean;
  issues?: string[];
  lastActivity: Date;
  metrics: AgentMetrics;
}

/**
 * Memory service interface
 */
export interface IMemoryService {
  store(key: string, value: unknown, metadata?: Record<string, unknown>): Promise<void>;
  retrieve(key: string): Promise<unknown>;
  search(query: VectorQuery): Promise<SearchResult[]>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  getStats(): Promise<MemoryStats>;
  createIndex(name: string, config: IndexConfig): Promise<void>;
}

/**
 * Memory stats interface
 */
export interface MemoryStats {
  totalEntries: number;
  totalSizeBytes: number;
  vectorCount: number;
  cacheHitRate: number;
}

/**
 * Index config interface
 */
export interface IndexConfig {
  dimensions: number;
  metric: 'cosine' | 'euclidean' | 'dot';
  M?: number;
  efConstruction?: number;
}

/**
 * Security service interface
 */
export interface ISecurityService {
  validatePath(path: string): boolean;
  validateInput(input: string, options?: InputValidationOptions): { valid: boolean; errors?: string[] };
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  generateToken(payload: Record<string, unknown>, expiresIn?: number): Promise<string>;
  verifyToken(token: string): Promise<Record<string, unknown>>;
  executeSecurely(command: string, options?: ExecuteOptions): Promise<ExecuteResult>;
}

/**
 * Input validation options
 */
export interface InputValidationOptions {
  maxLength?: number;
  allowedChars?: RegExp;
  sanitize?: boolean;
}

/**
 * Execute options interface
 */
export interface ExecuteOptions {
  timeout?: number;
  cwd?: string;
  shell?: boolean;
  allowedCommands?: string[];
}

/**
 * Execute result interface
 */
export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

/**
 * Swarm coordinator interface
 */
export interface ISwarmCoordinator {
  initialize(config: SwarmConfig): Promise<SwarmState>;
  coordinate(agents: string[], task: SwarmTask): Promise<CoordinationResult>;
  shutdown(graceful?: boolean): Promise<void>;
  getState(): SwarmState;
  addAgent(agentId: string): Promise<void>;
  removeAgent(agentId: string): Promise<void>;
  broadcast(message: unknown): Promise<void>;
}

/**
 * MCP client interface
 */
export interface IMCPClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  callTool(name: string, params: Record<string, unknown>): Promise<MCPToolResult>;
  listTools(): Promise<MCPTool[]>;
  isConnected(): boolean;
  getSession(): MCPSessionContext | null;
}

/**
 * Logger interface
 */
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

/**
 * Create mock event bus with behavior tracking
 */
export function createMockEventBus(): MockedInterface<IEventBus> & { publishedEvents: DomainEvent[] } {
  const publishedEvents: DomainEvent[] = [];
  const subscribers = new Map<string, Set<EventHandler>>();

  const mock = createMock<IEventBus>();

  mock.publish.mockImplementation(async (event: DomainEvent) => {
    publishedEvents.push(event);
    const handlers = subscribers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        await handler(event);
      }
    }
  });

  mock.subscribe.mockImplementation((eventType: string, handler: EventHandler) => {
    if (!subscribers.has(eventType)) {
      subscribers.set(eventType, new Set());
    }
    subscribers.get(eventType)!.add(handler);
    return () => subscribers.get(eventType)?.delete(handler);
  });

  mock.unsubscribe.mockImplementation((eventType: string, handler: EventHandler) => {
    subscribers.get(eventType)?.delete(handler);
  });

  mock.getSubscriberCount.mockImplementation((eventType: string) => {
    return subscribers.get(eventType)?.size ?? 0;
  });

  return Object.assign(mock, { publishedEvents });
}

/**
 * Create mock task manager with realistic behavior
 */
export function createMockTaskManager(): MockedInterface<ITaskManager> & { tasks: Map<string, Task> } {
  const tasks = new Map<string, Task>();
  let taskCounter = 0;

  const mock = createMock<ITaskManager>();

  mock.create.mockImplementation(async (definition: TaskDefinition) => {
    const task: Task = {
      id: `task-${++taskCounter}`,
      name: definition.name,
      type: definition.type,
      status: 'pending',
      payload: definition.payload,
      priority: definition.priority ?? 50,
      createdAt: new Date(),
    };
    tasks.set(task.id, task);
    return task;
  });

  mock.execute.mockImplementation(async (taskId: string) => {
    const task = tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    task.status = 'running';
    task.startedAt = new Date();

    // Simulate execution
    await new Promise(resolve => setTimeout(resolve, 10));

    task.status = 'completed';
    task.completedAt = new Date();

    return {
      taskId,
      success: true,
      duration: task.completedAt.getTime() - task.startedAt.getTime(),
    };
  });

  mock.cancel.mockImplementation(async (taskId: string) => {
    const task = tasks.get(taskId);
    if (task) {
      task.status = 'cancelled';
    }
  });

  mock.getStatus.mockImplementation(async (taskId: string) => {
    const task = tasks.get(taskId);
    return task?.status ?? 'pending';
  });

  mock.getTask.mockImplementation(async (taskId: string) => {
    return tasks.get(taskId) ?? null;
  });

  mock.listTasks.mockImplementation(async (filters?: TaskFilters) => {
    let result = Array.from(tasks.values());

    if (filters?.status) {
      result = result.filter(t => t.status === filters.status);
    }
    if (filters?.type) {
      result = result.filter(t => t.type === filters.type);
    }
    if (filters?.limit) {
      result = result.slice(filters.offset ?? 0, (filters.offset ?? 0) + filters.limit);
    }

    return result;
  });

  return Object.assign(mock, { tasks });
}

/**
 * Create mock agent lifecycle
 */
export function createMockAgentLifecycle(): MockedInterface<IAgentLifecycle> & { agents: Map<string, AgentInstance> } {
  const agents = new Map<string, AgentInstance>();
  let agentCounter = 0;

  const mock = createMock<IAgentLifecycle>();

  mock.spawn.mockImplementation(async (config: AgentConfig) => {
    const agent: AgentInstance = {
      id: `agent-${config.type}-${++agentCounter}`,
      type: config.type,
      name: config.name,
      status: 'idle',
      capabilities: config.capabilities ?? [],
      createdAt: new Date(),
    };
    agents.set(agent.id, agent);

    return {
      agent,
      sessionId: `session-${Date.now()}`,
      startupTime: Math.random() * 100 + 50,
      success: true,
    };
  });

  mock.terminate.mockImplementation(async (agentId: string) => {
    const agent = agents.get(agentId);
    if (agent) {
      agent.status = 'terminated';
    }
  });

  mock.getAgent.mockImplementation(async (agentId: string) => {
    return agents.get(agentId) ?? null;
  });

  mock.listAgents.mockImplementation(async (filters?: AgentFilters) => {
    let result = Array.from(agents.values());

    if (filters?.type) {
      result = result.filter(a => a.type === filters.type);
    }
    if (filters?.status) {
      result = result.filter(a => a.status === filters.status);
    }
    if (filters?.capability) {
      result = result.filter(a => a.capabilities.includes(filters.capability!));
    }

    return result;
  });

  mock.getMetrics.mockImplementation(async () => ({
    tasksCompleted: Math.floor(Math.random() * 100),
    tasksFailed: Math.floor(Math.random() * 10),
    avgTaskDuration: Math.random() * 1000,
    totalDuration: Math.random() * 10000,
    errorRate: Math.random() * 0.1,
    memoryUsageMb: Math.random() * 256,
  }));

  mock.healthCheck.mockImplementation(async (agentId: string) => {
    const agent = agents.get(agentId);
    return {
      healthy: agent?.status !== 'error' && agent?.status !== 'terminated',
      lastActivity: new Date(),
      metrics: {
        tasksCompleted: 50,
        tasksFailed: 1,
        avgTaskDuration: 200,
        totalDuration: 10000,
        errorRate: 0.02,
        memoryUsageMb: 128,
      },
    };
  });

  return Object.assign(mock, { agents });
}

/**
 * Create mock memory service
 */
export function createMockMemoryService(): MockedInterface<IMemoryService> & { entries: Map<string, { value: unknown; metadata?: Record<string, unknown> }> } {
  const entries = new Map<string, { value: unknown; metadata?: Record<string, unknown> }>();

  const mock = createMock<IMemoryService>();

  mock.store.mockImplementation(async (key: string, value: unknown, metadata?: Record<string, unknown>) => {
    entries.set(key, { value, metadata });
  });

  mock.retrieve.mockImplementation(async (key: string) => {
    return entries.get(key)?.value ?? null;
  });

  mock.search.mockImplementation(async () => []);

  mock.delete.mockImplementation(async (key: string) => {
    entries.delete(key);
  });

  mock.clear.mockImplementation(async () => {
    entries.clear();
  });

  mock.getStats.mockImplementation(async () => ({
    totalEntries: entries.size,
    totalSizeBytes: entries.size * 100,
    vectorCount: 0,
    cacheHitRate: 0.85,
  }));

  mock.createIndex.mockResolvedValue(undefined);

  return Object.assign(mock, { entries });
}

/**
 * Create mock security service
 */
export function createMockSecurityService(): MockedInterface<ISecurityService> {
  const mock = createMock<ISecurityService>();

  mock.validatePath.mockImplementation((path: string) => {
    const blocked = ['../', '~/', '/etc/', '/tmp/', '/var/'];
    return !blocked.some(pattern => path.includes(pattern));
  });

  mock.validateInput.mockImplementation((input: string, options?: InputValidationOptions) => {
    const maxLength = options?.maxLength ?? 10000;
    if (input.length > maxLength) {
      return { valid: false, errors: [`Input exceeds maximum length of ${maxLength}`] };
    }
    return { valid: true };
  });

  mock.hashPassword.mockImplementation(async (password: string) => {
    return `hashed:${Buffer.from(password).toString('base64')}`;
  });

  mock.verifyPassword.mockImplementation(async (password: string, hash: string) => {
    return hash === `hashed:${Buffer.from(password).toString('base64')}`;
  });

  mock.generateToken.mockImplementation(async (payload: Record<string, unknown>) => {
    return `token:${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
  });

  mock.verifyToken.mockImplementation(async (token: string) => {
    if (!token.startsWith('token:')) {
      throw new Error('Invalid token');
    }
    return JSON.parse(Buffer.from(token.slice(6), 'base64').toString());
  });

  mock.executeSecurely.mockImplementation(async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
    duration: 100,
  }));

  return mock;
}

/**
 * Create mock swarm coordinator
 */
export function createMockSwarmCoordinator(): MockedInterface<ISwarmCoordinator> & { state: SwarmState } {
  const state: SwarmState = {
    id: 'swarm-test',
    topology: 'hierarchical-mesh',
    status: 'active',
    agentCount: 0,
    activeAgentCount: 0,
    createdAt: new Date(),
  };

  const mock = createMock<ISwarmCoordinator>();

  mock.initialize.mockImplementation(async (config: SwarmConfig) => {
    state.topology = config.topology;
    state.status = 'active';
    return state;
  });

  mock.coordinate.mockImplementation(async (agents: string[], task: SwarmTask) => ({
    success: true,
    completedTasks: 1,
    failedTasks: 0,
    totalDuration: 1000,
    agentMetrics: new Map(),
  }));

  mock.shutdown.mockImplementation(async () => {
    state.status = 'shutdown';
    state.activeAgentCount = 0;
  });

  mock.getState.mockImplementation(() => state);

  mock.addAgent.mockImplementation(async () => {
    state.agentCount++;
    state.activeAgentCount++;
  });

  mock.removeAgent.mockImplementation(async () => {
    state.agentCount--;
    state.activeAgentCount--;
  });

  mock.broadcast.mockResolvedValue(undefined);

  return Object.assign(mock, { state });
}

/**
 * Create mock MCP client
 */
export function createMockMCPClient(): MockedInterface<IMCPClient> & { connected: boolean } {
  let connected = false;

  const mock = createMock<IMCPClient>();

  mock.connect.mockImplementation(async () => {
    connected = true;
  });

  mock.disconnect.mockImplementation(async () => {
    connected = false;
  });

  mock.callTool.mockImplementation(async () => ({
    content: [{ type: 'text', text: 'Success' }],
  }));

  mock.listTools.mockResolvedValue([]);

  mock.isConnected.mockImplementation(() => connected);

  mock.getSession.mockReturnValue(null);

  return Object.assign(mock, { connected });
}

/**
 * Create mock logger with captured logs
 */
export function createMockLogger(): MockedInterface<ILogger> & { logs: Array<{ level: string; message: string; context?: Record<string, unknown>; error?: Error }> } {
  const logs: Array<{ level: string; message: string; context?: Record<string, unknown>; error?: Error }> = [];

  const mock = createMock<ILogger>();

  mock.debug.mockImplementation((message: string, context?: Record<string, unknown>) => {
    logs.push({ level: 'debug', message, context });
  });

  mock.info.mockImplementation((message: string, context?: Record<string, unknown>) => {
    logs.push({ level: 'info', message, context });
  });

  mock.warn.mockImplementation((message: string, context?: Record<string, unknown>) => {
    logs.push({ level: 'warn', message, context });
  });

  mock.error.mockImplementation((message: string, error?: Error, context?: Record<string, unknown>) => {
    logs.push({ level: 'error', message, context, error });
  });

  return Object.assign(mock, { logs });
}

/**
 * Create a complete test application with all mock services
 */
export function createMockApplication(): MockApplication {
  return {
    eventBus: createMockEventBus(),
    taskManager: createMockTaskManager(),
    agentLifecycle: createMockAgentLifecycle(),
    memoryService: createMockMemoryService(),
    securityService: createMockSecurityService(),
    swarmCoordinator: createMockSwarmCoordinator(),
    mcpClient: createMockMCPClient(),
    logger: createMockLogger(),
  };
}

/**
 * Mock application type
 */
export interface MockApplication {
  eventBus: ReturnType<typeof createMockEventBus>;
  taskManager: ReturnType<typeof createMockTaskManager>;
  agentLifecycle: ReturnType<typeof createMockAgentLifecycle>;
  memoryService: ReturnType<typeof createMockMemoryService>;
  securityService: ReturnType<typeof createMockSecurityService>;
  swarmCoordinator: ReturnType<typeof createMockSwarmCoordinator>;
  mcpClient: ReturnType<typeof createMockMCPClient>;
  logger: ReturnType<typeof createMockLogger>;
}

/**
 * Reset all mocks in the application
 */
export function resetMockApplication(app: MockApplication): void {
  vi.clearAllMocks();
  app.eventBus.publishedEvents.length = 0;
  app.taskManager.tasks.clear();
  app.agentLifecycle.agents.clear();
  app.memoryService.entries.clear();
  app.logger.logs.length = 0;
}
