/**
 * In-Memory Repositories - CLI Infrastructure
 *
 * Lightweight in-memory implementations for CLI use.
 *
 * @module v3/cli/infrastructure
 */

import { Agent, AgentStatus, AgentRole } from '../../../swarm/src/domain/entities/agent.js';
import { Task, TaskStatus, TaskPriority } from '../../../swarm/src/domain/entities/task.js';
import {
  IAgentRepository,
  AgentQueryOptions,
  AgentStatistics,
} from '../../../swarm/src/domain/repositories/agent-repository.interface.js';
import {
  ITaskRepository,
  TaskQueryOptions,
  TaskStatistics,
} from '../../../swarm/src/domain/repositories/task-repository.interface.js';

/**
 * In-Memory Agent Repository
 */
export class InMemoryAgentRepository implements IAgentRepository {
  private agents: Map<string, Agent> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.agents.clear();
    this.initialized = false;
  }

  async clear(): Promise<void> {
    this.agents.clear();
  }

  async save(agent: Agent): Promise<void> {
    this.agents.set(agent.id, agent);
  }

  async findById(id: string): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async findByName(name: string): Promise<Agent | null> {
    for (const agent of this.agents.values()) {
      if (agent.name === name) return agent;
    }
    return null;
  }

  async delete(id: string): Promise<boolean> {
    return this.agents.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.agents.has(id);
  }

  async saveMany(agents: Agent[]): Promise<void> {
    for (const agent of agents) {
      this.agents.set(agent.id, agent);
    }
  }

  async findByIds(ids: string[]): Promise<Agent[]> {
    return ids.map((id) => this.agents.get(id)).filter((a): a is Agent => a !== undefined);
  }

  async deleteMany(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (this.agents.delete(id)) deleted++;
    }
    return deleted;
  }

  async findAll(options?: AgentQueryOptions): Promise<Agent[]> {
    let result = Array.from(this.agents.values());
    if (options?.status) result = result.filter((a) => a.status === options.status);
    if (options?.role) result = result.filter((a) => a.role === options.role);
    if (options?.domain) result = result.filter((a) => a.domain === options.domain);
    if (options?.limit) result = result.slice(0, options.limit);
    return result;
  }

  async findByStatus(status: AgentStatus): Promise<Agent[]> {
    return this.findAll({ status });
  }

  async findByRole(role: AgentRole): Promise<Agent[]> {
    return this.findAll({ role });
  }

  async findByDomain(domain: string): Promise<Agent[]> {
    return this.findAll({ domain });
  }

  async findByParent(parentId: string): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter((a) => a.parentId === parentId);
  }

  async findByCapability(capability: string): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter((a) => a.hasCapability(capability));
  }

  async findAvailable(): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter((a) => a.isAvailable());
  }

  async getStatistics(): Promise<AgentStatistics> {
    const agents = Array.from(this.agents.values());
    const byStatus: Record<AgentStatus, number> = {
      idle: 0,
      active: 0,
      busy: 0,
      paused: 0,
      terminated: 0,
      error: 0,
    };
    const byRole: Record<string, number> = {};
    const byDomain: Record<string, number> = {};
    let totalCompleted = 0;
    let totalUtilization = 0;

    for (const agent of agents) {
      byStatus[agent.status]++;
      byRole[agent.role] = (byRole[agent.role] ?? 0) + 1;
      byDomain[agent.domain] = (byDomain[agent.domain] ?? 0) + 1;
      totalCompleted += agent.completedTaskCount;
      totalUtilization += agent.getUtilization();
    }

    return {
      total: agents.length,
      byStatus,
      byRole,
      byDomain,
      totalTasksCompleted: totalCompleted,
      averageUtilization: agents.length > 0 ? totalUtilization / agents.length : 0,
    };
  }

  async count(options?: AgentQueryOptions): Promise<number> {
    return (await this.findAll(options)).length;
  }
}

/**
 * In-Memory Task Repository
 */
export class InMemoryTaskRepository implements ITaskRepository {
  private tasks: Map<string, Task> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.tasks.clear();
    this.initialized = false;
  }

  async clear(): Promise<void> {
    this.tasks.clear();
  }

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
  }

  async findById(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async delete(id: string): Promise<boolean> {
    return this.tasks.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.tasks.has(id);
  }

  async saveMany(tasks: Task[]): Promise<void> {
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
  }

  async findByIds(ids: string[]): Promise<Task[]> {
    return ids.map((id) => this.tasks.get(id)).filter((t): t is Task => t !== undefined);
  }

  async deleteMany(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (this.tasks.delete(id)) deleted++;
    }
    return deleted;
  }

  async findAll(options?: TaskQueryOptions): Promise<Task[]> {
    let result = Array.from(this.tasks.values());
    if (options?.status) result = result.filter((t) => t.status === options.status);
    if (options?.priority) result = result.filter((t) => t.priority === options.priority);
    if (options?.type) result = result.filter((t) => t.type === options.type);
    if (options?.assignedAgentId) result = result.filter((t) => t.assignedAgentId === options.assignedAgentId);
    if (options?.limit) result = result.slice(0, options.limit);
    return result;
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    return this.findAll({ status });
  }

  async findByPriority(priority: TaskPriority): Promise<Task[]> {
    return this.findAll({ priority });
  }

  async findByAgent(agentId: string): Promise<Task[]> {
    return this.findAll({ assignedAgentId: agentId });
  }

  async findPending(): Promise<Task[]> {
    return this.findByStatus('pending');
  }

  async findQueued(): Promise<Task[]> {
    return this.findByStatus('queued');
  }

  async findRunning(): Promise<Task[]> {
    return this.findByStatus('running');
  }

  async findTimedOut(): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter((t) => t.isTimedOut());
  }

  async getNextTask(agentCapabilities?: string[]): Promise<Task | null> {
    const queued = await this.findQueued();
    if (queued.length === 0) return null;
    queued.sort((a, b) => a.comparePriority(b));
    return queued[0];
  }

  async getTaskQueue(limit = 10): Promise<Task[]> {
    const queued = await this.findQueued();
    queued.sort((a, b) => a.comparePriority(b));
    return queued.slice(0, limit);
  }

  async getStatistics(): Promise<TaskStatistics> {
    const tasks = Array.from(this.tasks.values());
    const byStatus: Record<TaskStatus, number> = {
      pending: 0,
      queued: 0,
      assigned: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    const byPriority: Record<TaskPriority, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
    };
    const byType: Record<string, number> = {};
    let totalDuration = 0;
    let completedCount = 0;
    let failedCount = 0;
    let retryTotal = 0;

    for (const task of tasks) {
      byStatus[task.status]++;
      byPriority[task.priority]++;
      byType[task.type] = (byType[task.type] ?? 0) + 1;

      if (task.status === 'completed') {
        completedCount++;
        const duration = task.getExecutionDuration();
        if (duration) totalDuration += duration;
      }
      if (task.status === 'failed') failedCount++;
      retryTotal += task.retryCount;
    }

    return {
      total: tasks.length,
      byStatus,
      byPriority,
      byType,
      averageExecutionTime: completedCount > 0 ? totalDuration / completedCount : 0,
      successRate: tasks.length > 0 ? completedCount / tasks.length : 0,
      retryRate: tasks.length > 0 ? retryTotal / tasks.length : 0,
    };
  }

  async count(options?: TaskQueryOptions): Promise<number> {
    return (await this.findAll(options)).length;
  }
}
