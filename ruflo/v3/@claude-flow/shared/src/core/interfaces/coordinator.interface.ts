/**
 * V3 Coordinator Interfaces
 * Domain-Driven Design - Coordination Bounded Context
 * Aligned with ADR-003 (Single Coordination Engine)
 */

import type { ITask, ITaskResult } from './task.interface.js';
import type { IAgent, IAgentConfig } from './agent.interface.js';

/**
 * Swarm topology types
 */
export type SwarmTopology =
  | 'hierarchical'
  | 'mesh'
  | 'ring'
  | 'star'
  | 'adaptive'
  | 'hierarchical-mesh';

/**
 * Coordination status
 */
export type CoordinationStatus =
  | 'initializing'
  | 'ready'
  | 'coordinating'
  | 'degraded'
  | 'error'
  | 'shutdown';

/**
 * Swarm configuration
 */
export interface ISwarmConfig {
  topology: SwarmTopology;
  maxAgents: number;

  autoScale?: {
    enabled: boolean;
    minAgents: number;
    maxAgents: number;
    scaleUpThreshold: number;
    scaleDownThreshold: number;
  };

  coordination?: {
    consensusRequired: boolean;
    timeoutMs: number;
    retryPolicy: {
      maxRetries: number;
      backoffMs: number;
    };
  };

  communication?: {
    protocol: 'events' | 'messages' | 'shared-memory';
    batchSize: number;
    flushIntervalMs: number;
  };

  metadata?: Record<string, unknown>;
}

/**
 * Swarm state
 */
export interface ISwarmState {
  readonly id: string;
  readonly topology: SwarmTopology;
  readonly createdAt: Date;

  status: CoordinationStatus;
  agentCount: number;
  taskCount: number;

  metrics?: {
    throughput: number;
    latencyMs: number;
    successRate: number;
    resourceUtilization: number;
  };
}

/**
 * Coordinator interface - unified coordination engine
 */
export interface ICoordinator {
  /**
   * Initialize the coordinator
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the coordinator
   */
  shutdown(): Promise<void>;

  /**
   * Initialize a swarm with configuration
   */
  initializeSwarm(config: ISwarmConfig): Promise<ISwarmState>;

  /**
   * Get swarm state
   */
  getSwarmState(): ISwarmState | undefined;

  /**
   * Assign a task to an agent
   */
  assignTask(task: ITask, agentId: string): Promise<void>;

  /**
   * Get tasks assigned to an agent
   */
  getAgentTasks(agentId: string): Promise<ITask[]>;

  /**
   * Get task count for an agent
   */
  getAgentTaskCount(agentId: string): Promise<number>;

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): Promise<void>;

  /**
   * Report task completion
   */
  reportTaskComplete(taskId: string, result: ITaskResult): Promise<void>;

  /**
   * Get coordination health status
   */
  getHealthStatus(): Promise<{ healthy: boolean; error?: string; metrics?: Record<string, number> }>;

  /**
   * Perform maintenance tasks
   */
  performMaintenance(): Promise<void>;
}

/**
 * Coordination manager interface - higher-level orchestration
 */
export interface ICoordinationManager extends ICoordinator {
  /**
   * Register an agent with the coordinator
   */
  registerAgent(agent: IAgent): Promise<void>;

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): Promise<void>;

  /**
   * Get all registered agents
   */
  getRegisteredAgents(): IAgent[];

  /**
   * Request agent consensus on a decision
   */
  requestConsensus(topic: string, options: unknown[], timeout?: number): Promise<unknown>;

  /**
   * Broadcast message to all agents
   */
  broadcast(message: unknown): Promise<void>;

  /**
   * Send message to specific agent
   */
  sendToAgent(agentId: string, message: unknown): Promise<void>;

  /**
   * Acquire a distributed lock
   */
  acquireLock(resourceId: string, agentId: string, timeout?: number): Promise<boolean>;

  /**
   * Release a distributed lock
   */
  releaseLock(resourceId: string, agentId: string): Promise<void>;

  /**
   * Check for deadlocks
   */
  detectDeadlocks(): Promise<{ detected: boolean; agents?: string[]; resources?: string[] }>;
}

/**
 * Health status for components
 */
export interface IHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, IComponentHealth>;
  timestamp: Date;
}

/**
 * Component health details
 */
export interface IComponentHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  error?: string;
  metrics?: Record<string, number>;
}

/**
 * Health monitor interface
 */
export interface IHealthMonitor {
  /**
   * Start health monitoring
   */
  start(): void;

  /**
   * Stop health monitoring
   */
  stop(): void;

  /**
   * Get current health status
   */
  getStatus(): Promise<IHealthStatus>;

  /**
   * Register a health check
   */
  registerCheck(
    name: string,
    check: () => Promise<{ healthy: boolean; error?: string; metrics?: Record<string, number> }>
  ): void;

  /**
   * Unregister a health check
   */
  unregisterCheck(name: string): void;

  /**
   * Get health history
   */
  getHistory(limit?: number): IHealthStatus[];

  /**
   * Subscribe to health changes
   */
  onHealthChange(callback: (status: IHealthStatus) => void): () => void;
}

/**
 * Metrics collector interface
 */
export interface IMetricsCollector {
  /**
   * Start metrics collection
   */
  start(): void;

  /**
   * Stop metrics collection
   */
  stop(): void;

  /**
   * Record a metric value
   */
  record(name: string, value: number, tags?: Record<string, string>): void;

  /**
   * Increment a counter
   */
  increment(name: string, value?: number, tags?: Record<string, string>): void;

  /**
   * Record a timing
   */
  timing(name: string, durationMs: number, tags?: Record<string, string>): void;

  /**
   * Get current metrics
   */
  getMetrics(): Record<string, { value: number; count: number; avg: number; min: number; max: number }>;

  /**
   * Reset all metrics
   */
  reset(): void;
}

/**
 * Orchestrator metrics structure
 */
export interface IOrchestratorMetrics {
  uptime: number;
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  queuedTasks: number;
  avgTaskDuration: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  timestamp: Date;
}

/**
 * Main orchestrator interface - facade for all orchestration capabilities
 */
export interface IOrchestrator {
  /**
   * Initialize the orchestrator
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the orchestrator
   */
  shutdown(): Promise<void>;

  /**
   * Get health status
   */
  getHealthStatus(): Promise<IHealthStatus>;

  /**
   * Get orchestrator metrics
   */
  getMetrics(): Promise<IOrchestratorMetrics>;

  /**
   * Spawn a new agent
   */
  spawnAgent(config: IAgentConfig): Promise<IAgent>;

  /**
   * Terminate an agent
   */
  terminateAgent(agentId: string, reason?: string): Promise<void>;

  /**
   * Submit a task
   */
  submitTask(task: ITask): Promise<ITaskResult>;

  /**
   * Get task by ID
   */
  getTask(taskId: string): Promise<ITask | undefined>;

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): Promise<void>;
}
