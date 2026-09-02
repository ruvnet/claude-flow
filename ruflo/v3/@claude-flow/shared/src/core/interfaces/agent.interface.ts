/**
 * V3 Agent Interfaces
 * Domain-Driven Design - Agent Lifecycle Bounded Context
 */

/**
 * Agent status in the system
 */
export type AgentStatus = 'spawning' | 'active' | 'idle' | 'busy' | 'error' | 'terminated';

/**
 * Agent type classification
 */
export type AgentType =
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'researcher'
  | 'planner'
  | 'architect'
  | 'coordinator'
  | 'security'
  | 'performance'
  | 'custom';

/**
 * Agent capability declaration
 */
export interface IAgentCapability {
  name: string;
  level: 'basic' | 'intermediate' | 'advanced' | 'expert';
  description?: string;
}

/**
 * Agent configuration for spawning
 */
export interface IAgentConfig {
  readonly id: string;
  readonly name: string;
  readonly type: AgentType | string;

  capabilities: string[];
  maxConcurrentTasks: number;
  priority: number;

  timeout?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
    backoffMultiplier: number;
  };

  resources?: {
    maxMemoryMb?: number;
    maxCpuPercent?: number;
  };

  metadata?: Record<string, unknown>;
}

/**
 * Core agent entity
 */
export interface IAgent {
  readonly id: string;
  readonly name: string;
  readonly type: AgentType | string;
  readonly config: IAgentConfig;
  readonly createdAt: Date;

  status: AgentStatus;
  currentTaskCount: number;
  lastActivity: Date;

  sessionId?: string;
  terminalId?: string;
  memoryBankId?: string;

  metrics?: {
    tasksCompleted: number;
    tasksFailed: number;
    avgTaskDuration: number;
    errorCount: number;
    uptime: number;
  };

  health?: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    lastCheck: Date;
    issues?: string[];
  };
}

/**
 * Agent session for tracking active work
 */
export interface IAgentSession {
  readonly id: string;
  readonly agentId: string;
  readonly startTime: Date;

  status: 'active' | 'idle' | 'terminated';
  terminalId: string;
  memoryBankId: string;

  lastActivity: Date;
  endTime?: Date;

  metadata?: Record<string, unknown>;
}

/**
 * Agent pool for managing multiple agents
 */
export interface IAgentPool {
  /**
   * Add an agent to the pool
   */
  add(agent: IAgent): void;

  /**
   * Remove an agent from the pool
   */
  remove(agentId: string): boolean;

  /**
   * Get an agent by ID
   */
  get(agentId: string): IAgent | undefined;

  /**
   * Get all agents in the pool
   */
  getAll(): IAgent[];

  /**
   * Get agents by status
   */
  getByStatus(status: AgentStatus): IAgent[];

  /**
   * Get agents by type
   */
  getByType(type: AgentType | string): IAgent[];

  /**
   * Get available agents (can accept more tasks)
   */
  getAvailable(): IAgent[];

  /**
   * Get pool size
   */
  size(): number;

  /**
   * Check if pool has capacity
   */
  hasCapacity(maxSize: number): boolean;

  /**
   * Clear all agents
   */
  clear(): void;
}

/**
 * Agent lifecycle manager interface
 */
export interface IAgentLifecycleManager {
  /**
   * Spawn a new agent
   */
  spawn(config: IAgentConfig): Promise<IAgent>;

  /**
   * Spawn multiple agents in parallel
   */
  spawnBatch(configs: IAgentConfig[]): Promise<Map<string, IAgent>>;

  /**
   * Terminate an agent
   */
  terminate(agentId: string, reason?: string): Promise<void>;

  /**
   * Terminate all agents
   */
  terminateAll(reason?: string): Promise<void>;

  /**
   * Restart an agent
   */
  restart(agentId: string): Promise<IAgent>;

  /**
   * Update agent configuration
   */
  updateConfig(agentId: string, config: Partial<IAgentConfig>): Promise<void>;

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): IAgent | undefined;

  /**
   * Get all agents
   */
  getAllAgents(): IAgent[];

  /**
   * Get active agents count
   */
  getActiveCount(): number;

  /**
   * Check agent health
   */
  checkHealth(agentId: string): Promise<IAgent['health']>;
}

/**
 * Agent registry for type definitions
 */
export interface IAgentRegistry {
  /**
   * Register an agent type with default config
   */
  register(type: string, defaultConfig: Partial<IAgentConfig>): void;

  /**
   * Unregister an agent type
   */
  unregister(type: string): boolean;

  /**
   * Get default config for a type
   */
  getDefaultConfig(type: string): Partial<IAgentConfig> | undefined;

  /**
   * Get all registered types
   */
  getRegisteredTypes(): string[];

  /**
   * Check if a type is registered
   */
  isRegistered(type: string): boolean;
}
