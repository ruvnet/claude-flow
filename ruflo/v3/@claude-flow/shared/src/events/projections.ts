/**
 * Event Projections for Read Models (ADR-007)
 *
 * Build read models from domain events using projections.
 * Projections listen to events and maintain queryable state.
 *
 * Implemented Projections:
 * - AgentStateProjection - Current state of all agents
 * - TaskHistoryProjection - Complete task execution history
 * - MemoryIndexProjection - Memory access patterns and index
 *
 * @module v3/shared/events/projections
 */

import { EventEmitter } from 'node:events';
import { DomainEvent } from './domain-events.js';
import { EventStore } from './event-store.js';
import { AgentId, TaskId, AgentStatus, TaskStatus } from '../types.js';

// =============================================================================
// Projection Base Class
// =============================================================================

export abstract class Projection extends EventEmitter {
  protected initialized: boolean = false;

  constructor(protected eventStore: EventStore) {
    super();
  }

  /**
   * Initialize the projection by replaying events
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Replay all events to build current state
    for await (const event of this.eventStore.replay()) {
      await this.handle(event);
    }

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Handle a domain event
   */
  abstract handle(event: DomainEvent): Promise<void>;

  /**
   * Reset the projection state
   */
  abstract reset(): void;
}

// =============================================================================
// Agent State Projection
// =============================================================================

export interface AgentProjectionState {
  id: AgentId;
  role: string;
  domain: string;
  status: AgentStatus;
  currentTask: TaskId | null;
  completedTasks: TaskId[];
  failedTasks: TaskId[];
  totalTaskDuration: number;
  taskCount: number;
  errorCount: number;
  spawnedAt: number;
  startedAt: number | null;
  stoppedAt: number | null;
  lastActivityAt: number;
}

export class AgentStateProjection extends Projection {
  private agents: Map<AgentId, AgentProjectionState> = new Map();

  /**
   * Get state for a specific agent
   */
  getAgent(agentId: AgentId): AgentProjectionState | null {
    return this.agents.get(agentId) || null;
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentProjectionState[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by status
   */
  getAgentsByStatus(status: AgentStatus): AgentProjectionState[] {
    return this.getAllAgents().filter((agent) => agent.status === status);
  }

  /**
   * Get agents by domain
   */
  getAgentsByDomain(domain: string): AgentProjectionState[] {
    return this.getAllAgents().filter((agent) => agent.domain === domain);
  }

  /**
   * Get active agent count
   */
  getActiveAgentCount(): number {
    return this.getAgentsByStatus('active').length;
  }

  async handle(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'agent:spawned':
        this.handleAgentSpawned(event);
        break;
      case 'agent:started':
        this.handleAgentStarted(event);
        break;
      case 'agent:stopped':
        this.handleAgentStopped(event);
        break;
      case 'agent:failed':
        this.handleAgentFailed(event);
        break;
      case 'agent:status-changed':
        this.handleAgentStatusChanged(event);
        break;
      case 'agent:task-assigned':
        this.handleAgentTaskAssigned(event);
        break;
      case 'agent:task-completed':
        this.handleAgentTaskCompleted(event);
        break;
    }
  }

  reset(): void {
    this.agents.clear();
    this.emit('reset');
  }

  private handleAgentSpawned(event: DomainEvent): void {
    const { agentId, role, domain } = event.payload;

    this.agents.set(agentId as AgentId, {
      id: agentId as AgentId,
      role: role as string,
      domain: domain as string,
      status: 'idle',
      currentTask: null,
      completedTasks: [],
      failedTasks: [],
      totalTaskDuration: 0,
      taskCount: 0,
      errorCount: 0,
      spawnedAt: event.timestamp,
      startedAt: null,
      stoppedAt: null,
      lastActivityAt: event.timestamp,
    });

    this.emit('agent:spawned', { agentId });
  }

  private handleAgentStarted(event: DomainEvent): void {
    const { agentId } = event.payload;
    const agent = this.agents.get(agentId as AgentId);

    if (agent) {
      agent.status = 'active';
      agent.startedAt = event.timestamp;
      agent.lastActivityAt = event.timestamp;
      this.emit('agent:started', { agentId });
    }
  }

  private handleAgentStopped(event: DomainEvent): void {
    const { agentId } = event.payload;
    const agent = this.agents.get(agentId as AgentId);

    if (agent) {
      agent.status = 'completed';
      agent.stoppedAt = event.timestamp;
      agent.lastActivityAt = event.timestamp;
      this.emit('agent:stopped', { agentId });
    }
  }

  private handleAgentFailed(event: DomainEvent): void {
    const { agentId } = event.payload;
    const agent = this.agents.get(agentId as AgentId);

    if (agent) {
      agent.status = 'error';
      agent.errorCount++;
      agent.lastActivityAt = event.timestamp;
      this.emit('agent:failed', { agentId });
    }
  }

  private handleAgentStatusChanged(event: DomainEvent): void {
    const { agentId, newStatus } = event.payload;
    const agent = this.agents.get(agentId as AgentId);

    if (agent) {
      agent.status = newStatus as AgentStatus;
      agent.lastActivityAt = event.timestamp;
      this.emit('agent:status-changed', { agentId, status: newStatus });
    }
  }

  private handleAgentTaskAssigned(event: DomainEvent): void {
    const { agentId, taskId } = event.payload;
    const agent = this.agents.get(agentId as AgentId);

    if (agent) {
      agent.currentTask = taskId as TaskId;
      agent.status = 'active';
      agent.lastActivityAt = event.timestamp;
      this.emit('agent:task-assigned', { agentId, taskId });
    }
  }

  private handleAgentTaskCompleted(event: DomainEvent): void {
    const { agentId, taskId, duration } = event.payload;
    const agent = this.agents.get(agentId as AgentId);

    if (agent) {
      agent.completedTasks.push(taskId as TaskId);
      agent.currentTask = null;
      agent.taskCount++;
      agent.totalTaskDuration += (duration as number) || 0;
      agent.status = 'idle';
      agent.lastActivityAt = event.timestamp;
      this.emit('agent:task-completed', { agentId, taskId });
    }
  }
}

// =============================================================================
// Task History Projection
// =============================================================================

export interface TaskProjectionState {
  id: TaskId;
  type: string;
  title: string;
  status: TaskStatus;
  priority: string;
  assignedAgent: AgentId | null;
  dependencies: TaskId[];
  blockedBy: TaskId[];
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  failedAt: number | null;
  duration: number | null;
  result: unknown;
  error: string | null;
  retryCount: number;
}

export class TaskHistoryProjection extends Projection {
  private tasks: Map<TaskId, TaskProjectionState> = new Map();

  /**
   * Get task by ID
   */
  getTask(taskId: TaskId): TaskProjectionState | null {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): TaskProjectionState[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: TaskStatus): TaskProjectionState[] {
    return this.getAllTasks().filter((task) => task.status === status);
  }

  /**
   * Get tasks by agent
   */
  getTasksByAgent(agentId: AgentId): TaskProjectionState[] {
    return this.getAllTasks().filter((task) => task.assignedAgent === agentId);
  }

  /**
   * Get completed task count
   */
  getCompletedTaskCount(): number {
    return this.getTasksByStatus('completed').length;
  }

  /**
   * Get average task duration
   */
  getAverageTaskDuration(): number {
    const completed = this.getTasksByStatus('completed').filter((t) => t.duration !== null);

    if (completed.length === 0) return 0;

    const total = completed.reduce((sum, task) => sum + (task.duration || 0), 0);
    return total / completed.length;
  }

  async handle(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'task:created':
        this.handleTaskCreated(event);
        break;
      case 'task:queued':
        this.handleTaskQueued(event);
        break;
      case 'task:started':
        this.handleTaskStarted(event);
        break;
      case 'task:completed':
        this.handleTaskCompleted(event);
        break;
      case 'task:failed':
        this.handleTaskFailed(event);
        break;
      case 'task:blocked':
        this.handleTaskBlocked(event);
        break;
    }
  }

  reset(): void {
    this.tasks.clear();
    this.emit('reset');
  }

  private handleTaskCreated(event: DomainEvent): void {
    const { taskId, taskType, title, priority, dependencies } = event.payload;

    this.tasks.set(taskId as TaskId, {
      id: taskId as TaskId,
      type: taskType as string,
      title: title as string,
      status: 'pending',
      priority: priority as string,
      assignedAgent: null,
      dependencies: (dependencies as TaskId[]) || [],
      blockedBy: [],
      createdAt: event.timestamp,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      duration: null,
      result: null,
      error: null,
      retryCount: 0,
    });

    this.emit('task:created', { taskId });
  }

  private handleTaskQueued(event: DomainEvent): void {
    const { taskId } = event.payload;
    const task = this.tasks.get(taskId as TaskId);

    if (task) {
      task.status = 'queued';
      this.emit('task:queued', { taskId });
    }
  }

  private handleTaskStarted(event: DomainEvent): void {
    const { taskId, agentId } = event.payload;
    const task = this.tasks.get(taskId as TaskId);

    if (task) {
      task.status = 'in-progress';
      task.assignedAgent = agentId as AgentId;
      task.startedAt = event.timestamp;
      this.emit('task:started', { taskId, agentId });
    }
  }

  private handleTaskCompleted(event: DomainEvent): void {
    const { taskId, result, duration } = event.payload;
    const task = this.tasks.get(taskId as TaskId);

    if (task) {
      task.status = 'completed';
      task.completedAt = event.timestamp;
      task.duration = (duration as number) || (task.startedAt ? event.timestamp - task.startedAt : null);
      task.result = result;
      this.emit('task:completed', { taskId });
    }
  }

  private handleTaskFailed(event: DomainEvent): void {
    const { taskId, error, retryCount } = event.payload;
    const task = this.tasks.get(taskId as TaskId);

    if (task) {
      task.status = 'failed';
      task.failedAt = event.timestamp;
      task.error = error as string;
      task.retryCount = retryCount as number;
      this.emit('task:failed', { taskId });
    }
  }

  private handleTaskBlocked(event: DomainEvent): void {
    const { taskId, blockedBy } = event.payload;
    const task = this.tasks.get(taskId as TaskId);

    if (task) {
      task.status = 'blocked';
      task.blockedBy = blockedBy as TaskId[];
      this.emit('task:blocked', { taskId, blockedBy });
    }
  }
}

// =============================================================================
// Memory Index Projection
// =============================================================================

export interface MemoryProjectionState {
  id: string;
  namespace: string;
  key: string;
  type: string;
  size: number;
  accessCount: number;
  storedAt: number;
  lastAccessedAt: number;
  deletedAt: number | null;
  isDeleted: boolean;
}

export class MemoryIndexProjection extends Projection {
  private memories: Map<string, MemoryProjectionState> = new Map();

  /**
   * Get memory by ID
   */
  getMemory(memoryId: string): MemoryProjectionState | null {
    return this.memories.get(memoryId) || null;
  }

  /**
   * Get all active memories (not deleted)
   */
  getActiveMemories(): MemoryProjectionState[] {
    return Array.from(this.memories.values()).filter((m) => !m.isDeleted);
  }

  /**
   * Get memories by namespace
   */
  getMemoriesByNamespace(namespace: string): MemoryProjectionState[] {
    return this.getActiveMemories().filter((m) => m.namespace === namespace);
  }

  /**
   * Get most accessed memories
   */
  getMostAccessedMemories(limit: number = 10): MemoryProjectionState[] {
    return this.getActiveMemories()
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit);
  }

  /**
   * Get total memory size by namespace
   */
  getTotalSizeByNamespace(namespace: string): number {
    return this.getMemoriesByNamespace(namespace).reduce((sum, m) => sum + m.size, 0);
  }

  async handle(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'memory:stored':
        this.handleMemoryStored(event);
        break;
      case 'memory:retrieved':
        this.handleMemoryRetrieved(event);
        break;
      case 'memory:deleted':
        this.handleMemoryDeleted(event);
        break;
      case 'memory:expired':
        this.handleMemoryExpired(event);
        break;
    }
  }

  reset(): void {
    this.memories.clear();
    this.emit('reset');
  }

  private handleMemoryStored(event: DomainEvent): void {
    const { memoryId, namespace, key, memoryType, size } = event.payload;

    this.memories.set(memoryId as string, {
      id: memoryId as string,
      namespace: namespace as string,
      key: key as string,
      type: memoryType as string,
      size: (size as number) || 0,
      accessCount: 0,
      storedAt: event.timestamp,
      lastAccessedAt: event.timestamp,
      deletedAt: null,
      isDeleted: false,
    });

    this.emit('memory:stored', { memoryId });
  }

  private handleMemoryRetrieved(event: DomainEvent): void {
    const { memoryId, accessCount } = event.payload;
    const memory = this.memories.get(memoryId as string);

    if (memory && !memory.isDeleted) {
      memory.accessCount = accessCount as number;
      memory.lastAccessedAt = event.timestamp;
      this.emit('memory:retrieved', { memoryId });
    }
  }

  private handleMemoryDeleted(event: DomainEvent): void {
    const { memoryId } = event.payload;
    const memory = this.memories.get(memoryId as string);

    if (memory) {
      memory.isDeleted = true;
      memory.deletedAt = event.timestamp;
      this.emit('memory:deleted', { memoryId });
    }
  }

  private handleMemoryExpired(event: DomainEvent): void {
    const { memoryId } = event.payload;
    const memory = this.memories.get(memoryId as string);

    if (memory) {
      memory.isDeleted = true;
      memory.deletedAt = event.timestamp;
      this.emit('memory:expired', { memoryId });
    }
  }
}
