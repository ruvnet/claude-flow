/**
 * @claude-flow/testing - Mock Services
 *
 * Comprehensive mock implementations of V3 core services.
 * Provides realistic behavior for testing with full state tracking.
 */
import { vi, type Mock } from 'vitest';
import type { V3AgentType } from '../fixtures/agent-fixtures.js';

/**
 * Mock AgentDB - Vector database mock with HNSW simulation
 */
export class MockAgentDB {
  private vectors = new Map<string, { embedding: number[]; metadata: Record<string, unknown> }>();
  private indexConfig = {
    M: 16,
    efConstruction: 200,
    efSearch: 50,
    dimensions: 384,
  };

  // Mock methods for verification
  insert = vi.fn(async (id: string, embedding: number[], metadata?: Record<string, unknown>) => {
    if (embedding.length !== this.indexConfig.dimensions) {
      throw new Error(`Invalid embedding dimensions: expected ${this.indexConfig.dimensions}, got ${embedding.length}`);
    }
    this.vectors.set(id, { embedding, metadata: metadata ?? {} });
  });

  search = vi.fn(async (embedding: number[], k: number, threshold?: number) => {
    const results: Array<{ id: string; score: number; metadata: Record<string, unknown> }> = [];

    for (const [id, data] of this.vectors) {
      const score = this.cosineSimilarity(embedding, data.embedding);
      if (threshold === undefined || score >= threshold) {
        results.push({ id, score, metadata: data.metadata });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  });

  delete = vi.fn(async (id: string) => {
    this.vectors.delete(id);
  });

  update = vi.fn(async (id: string, embedding: number[], metadata?: Record<string, unknown>) => {
    const existing = this.vectors.get(id);
    if (!existing) {
      throw new Error(`Vector not found: ${id}`);
    }
    this.vectors.set(id, { embedding, metadata: metadata ?? existing.metadata });
  });

  getVector = vi.fn(async (id: string) => {
    return this.vectors.get(id) ?? null;
  });

  getStats = vi.fn(() => ({
    vectorCount: this.vectors.size,
    indexSize: this.vectors.size * this.indexConfig.dimensions * 4, // 4 bytes per float
    dimensions: this.indexConfig.dimensions,
    M: this.indexConfig.M,
    efConstruction: this.indexConfig.efConstruction,
  }));

  rebuildIndex = vi.fn(async () => {
    // Simulate index rebuild
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  clear = vi.fn(() => {
    this.vectors.clear();
  });

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Configure the mock index
   */
  configure(config: Partial<typeof this.indexConfig>): void {
    Object.assign(this.indexConfig, config);
  }

  /**
   * Get all stored vectors (for testing)
   */
  getAllVectors(): Map<string, { embedding: number[]; metadata: Record<string, unknown> }> {
    return new Map(this.vectors);
  }
}

/**
 * Mock Unified Swarm Coordinator
 */
export class MockSwarmCoordinator {
  private agents = new Map<string, MockSwarmAgent>();
  private state: SwarmState = {
    id: `swarm-${Date.now()}`,
    topology: 'hierarchical-mesh',
    status: 'idle',
    agentCount: 0,
    activeAgentCount: 0,
    leaderId: undefined,
    createdAt: new Date(),
  };
  private messageQueue: SwarmMessage[] = [];
  private taskQueue: SwarmTask[] = [];

  initialize = vi.fn(async (config: SwarmInitConfig) => {
    this.state = {
      ...this.state,
      topology: config.topology ?? 'hierarchical-mesh',
      status: 'active',
    };
    return this.state;
  });

  shutdown = vi.fn(async (graceful: boolean = true) => {
    if (graceful) {
      // Complete pending tasks
      await Promise.all(
        Array.from(this.agents.values()).map(agent => agent.terminate())
      );
    }
    this.state.status = 'shutdown';
    this.agents.clear();
  });

  addAgent = vi.fn(async (config: AgentConfig) => {
    const id = `agent-${config.type}-${Date.now()}`;
    const agent = new MockSwarmAgent(id, config);
    this.agents.set(id, agent);
    this.state.agentCount++;
    this.state.activeAgentCount++;

    if (config.type === 'queen-coordinator' && !this.state.leaderId) {
      this.state.leaderId = id;
    }

    return agent;
  });

  removeAgent = vi.fn(async (agentId: string) => {
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.terminate();
      this.agents.delete(agentId);
      this.state.agentCount--;
      this.state.activeAgentCount--;

      if (this.state.leaderId === agentId) {
        this.electNewLeader();
      }
    }
  });

  coordinate = vi.fn(async (task: SwarmTask) => {
    this.taskQueue.push(task);

    // Find suitable agents
    const suitableAgents = Array.from(this.agents.values())
      .filter(agent => agent.canHandle(task.type))
      .sort((a, b) => b.priority - a.priority);

    if (suitableAgents.length === 0) {
      return {
        success: false,
        error: 'No suitable agents available',
        taskId: task.id,
        duration: 0,
      };
    }

    const startTime = Date.now();
    const results: TaskResult[] = [];

    for (const agent of suitableAgents.slice(0, task.maxAgents ?? 1)) {
      const result = await agent.execute(task);
      results.push(result);
    }

    return {
      success: results.every(r => r.success),
      taskId: task.id,
      duration: Date.now() - startTime,
      results,
    };
  });

  broadcast = vi.fn(async (message: Omit<SwarmMessage, 'id' | 'timestamp'>) => {
    const fullMessage: SwarmMessage = {
      ...message,
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      to: 'broadcast',
    };
    this.messageQueue.push(fullMessage);

    for (const agent of this.agents.values()) {
      await agent.receive(fullMessage);
    }
  });

  sendMessage = vi.fn(async (message: SwarmMessage) => {
    this.messageQueue.push(message);

    if (message.to === 'broadcast') {
      for (const agent of this.agents.values()) {
        await agent.receive(message);
      }
    } else {
      const agent = this.agents.get(message.to);
      if (agent) {
        await agent.receive(message);
      }
    }
  });

  requestConsensus = vi.fn(async <T>(request: ConsensusRequest<T>): Promise<ConsensusResponse<T>> => {
    const voters = request.voters ?? Array.from(this.agents.keys());
    const votes = new Map<string, T>();

    for (const voterId of voters) {
      const agent = this.agents.get(voterId);
      if (agent) {
        // Simulate voting - random selection
        const vote = request.options[Math.floor(Math.random() * request.options.length)];
        votes.set(voterId, vote);
      }
    }

    const voteCounts = new Map<string, number>();
    for (const vote of votes.values()) {
      const key = JSON.stringify(vote);
      voteCounts.set(key, (voteCounts.get(key) ?? 0) + 1);
    }

    const majority = Math.floor(voters.length / 2) + 1;
    let decision: T | null = null;
    let consensus = false;

    for (const [key, count] of voteCounts) {
      if (count >= majority) {
        decision = JSON.parse(key);
        consensus = true;
        break;
      }
    }

    return {
      topic: request.topic,
      decision,
      votes,
      consensus,
      votingDuration: 100,
      participatingAgents: Array.from(votes.keys()),
    };
  });

  getState = vi.fn(() => ({ ...this.state }));

  getAgent = vi.fn((id: string) => this.agents.get(id));

  getAgents = vi.fn(() => Array.from(this.agents.values()));

  getMessageQueue = vi.fn(() => [...this.messageQueue]);

  getTaskQueue = vi.fn(() => [...this.taskQueue]);

  private electNewLeader(): void {
    const candidates = Array.from(this.agents.values())
      .filter(a => a.config.type === 'queen-coordinator')
      .sort((a, b) => b.priority - a.priority);

    this.state.leaderId = candidates[0]?.id;
  }

  reset(): void {
    this.agents.clear();
    this.messageQueue = [];
    this.taskQueue = [];
    this.state = {
      id: `swarm-${Date.now()}`,
      topology: 'hierarchical-mesh',
      status: 'idle',
      agentCount: 0,
      activeAgentCount: 0,
      leaderId: undefined,
      createdAt: new Date(),
    };
    vi.clearAllMocks();
  }
}

/**
 * Mock Swarm Agent
 */
export class MockSwarmAgent {
  readonly id: string;
  readonly config: AgentConfig;
  status: 'idle' | 'busy' | 'terminated' = 'idle';
  priority: number;
  private messages: SwarmMessage[] = [];
  private taskResults: TaskResult[] = [];

  execute = vi.fn();
  receive = vi.fn();
  send = vi.fn();
  terminate = vi.fn();

  constructor(id: string, config: AgentConfig) {
    this.id = id;
    this.config = config;
    this.priority = config.priority ?? 50;

    this.execute.mockImplementation(async (task: SwarmTask) => {
      this.status = 'busy';
      await new Promise(resolve => setTimeout(resolve, 10));
      this.status = 'idle';

      const result: TaskResult = {
        taskId: task.id,
        agentId: this.id,
        success: true,
        duration: Math.random() * 100 + 10,
      };
      this.taskResults.push(result);
      return result;
    });

    this.receive.mockImplementation(async (message: SwarmMessage) => {
      this.messages.push(message);
    });

    this.send.mockImplementation(async () => {});

    this.terminate.mockImplementation(async () => {
      this.status = 'terminated';
    });
  }

  canHandle(taskType: string): boolean {
    const capabilities = agentCapabilities[this.config.type] ?? [];
    return capabilities.some(cap =>
      cap.includes(taskType) || taskType.includes(cap)
    );
  }

  getMessages(): SwarmMessage[] {
    return [...this.messages];
  }

  getTaskResults(): TaskResult[] {
    return [...this.taskResults];
  }
}

/**
 * Mock Memory Service with caching
 */
export class MockMemoryService {
  private store = new Map<string, { value: unknown; metadata: MemoryMetadata; expiresAt?: Date }>();
  private cache = new Map<string, { value: unknown; accessCount: number }>();
  private cacheHits = 0;
  private cacheMisses = 0;

  set = vi.fn(async (key: string, value: unknown, metadata?: MemoryMetadata) => {
    const expiresAt = metadata?.ttl ? new Date(Date.now() + metadata.ttl) : undefined;
    this.store.set(key, { value, metadata: metadata ?? { type: 'short-term', tags: [] }, expiresAt });
    this.cache.delete(key); // Invalidate cache
  });

  get = vi.fn(async (key: string) => {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheHits++;
      cached.accessCount++;
      return cached.value;
    }

    this.cacheMisses++;
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.store.delete(key);
      return null;
    }

    // Add to cache
    this.cache.set(key, { value: entry.value, accessCount: 1 });

    return entry.value;
  });

  delete = vi.fn(async (key: string) => {
    this.store.delete(key);
    this.cache.delete(key);
  });

  search = vi.fn(async (query: VectorSearchQuery) => {
    // Simulate vector search with filtering
    const results: SearchResult[] = [];

    for (const [key, entry] of this.store) {
      if (query.filters) {
        const matches = Object.entries(query.filters).every(([k, v]) =>
          entry.metadata[k as keyof MemoryMetadata] === v
        );
        if (!matches) continue;
      }

      results.push({
        key,
        value: entry.value,
        score: Math.random() * 0.3 + 0.7, // Random score 0.7-1.0
        metadata: entry.metadata,
      });
    }

    return results
      .filter(r => !query.threshold || r.score >= query.threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, query.topK);
  });

  clear = vi.fn(async () => {
    this.store.clear();
    this.cache.clear();
  });

  getStats = vi.fn(() => ({
    totalEntries: this.store.size,
    cacheSize: this.cache.size,
    cacheHitRate: this.cacheHits / (this.cacheHits + this.cacheMisses) || 0,
    cacheHits: this.cacheHits,
    cacheMisses: this.cacheMisses,
  }));

  prune = vi.fn(async () => {
    const now = new Date();
    let pruned = 0;

    for (const [key, entry] of this.store) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key);
        this.cache.delete(key);
        pruned++;
      }
    }

    return pruned;
  });

  reset(): void {
    this.store.clear();
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    vi.clearAllMocks();
  }
}

/**
 * Mock Event Bus with history tracking
 */
export class MockEventBus {
  private subscribers = new Map<string, Set<EventHandler>>();
  private history: DomainEvent[] = [];
  private maxHistorySize = 1000;

  publish = vi.fn(async (event: DomainEvent) => {
    this.history.push(event);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    const handlers = this.subscribers.get(event.type) ?? new Set();
    const wildcardHandlers = this.subscribers.get('*') ?? new Set();

    const allHandlers = [...handlers, ...wildcardHandlers];

    await Promise.all(allHandlers.map(handler => handler(event)));
  });

  subscribe = vi.fn((eventType: string, handler: EventHandler) => {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(handler);

    return () => this.unsubscribe(eventType, handler);
  });

  unsubscribe = vi.fn((eventType: string, handler: EventHandler) => {
    this.subscribers.get(eventType)?.delete(handler);
  });

  getHistory(eventType?: string): DomainEvent[] {
    if (eventType) {
      return this.history.filter(e => e.type === eventType);
    }
    return [...this.history];
  }

  getSubscriberCount(eventType: string): number {
    return this.subscribers.get(eventType)?.size ?? 0;
  }

  clear(): void {
    this.history = [];
    vi.clearAllMocks();
  }

  reset(): void {
    this.subscribers.clear();
    this.history = [];
    vi.clearAllMocks();
  }
}

/**
 * Mock Security Service
 */
export class MockSecurityService {
  private blockedPaths = ['../', '~/', '/etc/', '/tmp/', '/var/', '/root/'];
  private allowedCommands = ['npm', 'npx', 'node', 'git'];
  private tokens = new Map<string, { payload: Record<string, unknown>; expiresAt: Date }>();

  validatePath = vi.fn((path: string) => {
    return !this.blockedPaths.some(blocked => path.includes(blocked));
  });

  validateInput = vi.fn((input: string, options?: InputValidationOptions) => {
    const errors: string[] = [];

    if (options?.maxLength && input.length > options.maxLength) {
      errors.push(`Input exceeds maximum length of ${options.maxLength}`);
    }

    if (options?.allowedChars && !options.allowedChars.test(input)) {
      errors.push('Input contains disallowed characters');
    }

    return {
      valid: errors.length === 0,
      sanitized: options?.sanitize ? this.sanitize(input) : input,
      errors: errors.length > 0 ? errors : undefined,
    };
  });

  hashPassword = vi.fn(async (password: string) => {
    // Simulate argon2 hash format
    return `$argon2id$v=19$m=65536,t=3,p=4$${Buffer.from(password).toString('base64')}`;
  });

  verifyPassword = vi.fn(async (password: string, hash: string) => {
    const parts = hash.split('$');
    if (parts.length < 5) return false;
    return Buffer.from(parts[4], 'base64').toString() === password;
  });

  generateToken = vi.fn(async (payload: Record<string, unknown>, expiresIn: number = 3600000) => {
    const token = `token_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.tokens.set(token, {
      payload,
      expiresAt: new Date(Date.now() + expiresIn),
    });
    return token;
  });

  verifyToken = vi.fn(async (token: string) => {
    const entry = this.tokens.get(token);
    if (!entry) {
      throw new Error('Invalid token');
    }
    if (entry.expiresAt < new Date()) {
      this.tokens.delete(token);
      throw new Error('Token expired');
    }
    return entry.payload;
  });

  executeSecurely = vi.fn(async (command: string, options?: ExecuteOptions) => {
    const [cmd] = command.split(' ');

    if (!this.allowedCommands.includes(cmd)) {
      throw new Error(`Command not allowed: ${cmd}`);
    }

    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
      duration: Math.random() * 100,
    };
  });

  private sanitize(input: string): string {
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  reset(): void {
    this.tokens.clear();
    vi.clearAllMocks();
  }
}

// Supporting types
interface SwarmState {
  id: string;
  topology: string;
  status: string;
  agentCount: number;
  activeAgentCount: number;
  leaderId?: string;
  createdAt: Date;
}

interface SwarmInitConfig {
  topology?: string;
  maxAgents?: number;
}

interface AgentConfig {
  type: V3AgentType;
  name?: string;
  capabilities?: string[];
  priority?: number;
}

interface SwarmTask {
  id: string;
  type: string;
  payload: unknown;
  priority?: number;
  maxAgents?: number;
}

interface SwarmMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  payload: unknown;
  timestamp: Date;
}

interface TaskResult {
  taskId: string;
  agentId: string;
  success: boolean;
  output?: unknown;
  error?: Error;
  duration: number;
}

interface ConsensusRequest<T> {
  topic: string;
  options: T[];
  voters?: string[];
  timeout?: number;
}

interface ConsensusResponse<T> {
  topic: string;
  decision: T | null;
  votes: Map<string, T>;
  consensus: boolean;
  votingDuration: number;
  participatingAgents: string[];
}

interface MemoryMetadata {
  type: 'short-term' | 'long-term' | 'semantic' | 'episodic';
  tags: string[];
  ttl?: number;
  [key: string]: unknown;
}

interface VectorSearchQuery {
  embedding?: number[];
  topK: number;
  threshold?: number;
  filters?: Record<string, unknown>;
}

interface SearchResult {
  key: string;
  value: unknown;
  score: number;
  metadata: MemoryMetadata;
}

interface DomainEvent {
  id: string;
  type: string;
  payload: unknown;
  timestamp: Date;
  correlationId?: string;
}

type EventHandler = (event: DomainEvent) => Promise<void>;

interface InputValidationOptions {
  maxLength?: number;
  allowedChars?: RegExp;
  sanitize?: boolean;
}

interface ExecuteOptions {
  timeout?: number;
  cwd?: string;
  shell?: boolean;
}

// Agent capabilities mapping
const agentCapabilities: Record<V3AgentType, string[]> = {
  'queen-coordinator': ['orchestration', 'coordination', 'task-distribution'],
  'security-architect': ['security', 'design', 'threat-modeling'],
  'security-auditor': ['security', 'audit', 'vulnerability'],
  'memory-specialist': ['memory', 'optimization', 'caching'],
  'swarm-specialist': ['coordination', 'consensus', 'communication'],
  'integration-architect': ['integration', 'api', 'compatibility'],
  'performance-engineer': ['performance', 'optimization', 'benchmarking'],
  'core-architect': ['architecture', 'design', 'domain'],
  'test-architect': ['testing', 'tdd', 'quality'],
  'project-coordinator': ['project', 'planning', 'scheduling'],
  'coder': ['coding', 'implementation', 'debugging'],
  'reviewer': ['review', 'quality', 'suggestions'],
  'tester': ['testing', 'execution', 'coverage'],
  'planner': ['planning', 'estimation', 'roadmap'],
  'researcher': ['research', 'analysis', 'documentation'],
};

/**
 * Create all mock services as a bundle
 */
export function createMockServices(): MockServiceBundle {
  return {
    agentDB: new MockAgentDB(),
    swarmCoordinator: new MockSwarmCoordinator(),
    memoryService: new MockMemoryService(),
    eventBus: new MockEventBus(),
    securityService: new MockSecurityService(),
  };
}

/**
 * Mock service bundle interface
 */
export interface MockServiceBundle {
  agentDB: MockAgentDB;
  swarmCoordinator: MockSwarmCoordinator;
  memoryService: MockMemoryService;
  eventBus: MockEventBus;
  securityService: MockSecurityService;
}

/**
 * Reset all mock services
 */
export function resetMockServices(services: MockServiceBundle): void {
  services.agentDB.clear();
  services.swarmCoordinator.reset();
  services.memoryService.reset();
  services.eventBus.reset();
  services.securityService.reset();
}
