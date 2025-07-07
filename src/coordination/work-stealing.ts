import { getErrorMessage } from '../utils/error-handler.js';
/**
 * Work stealing algorithm for load balancing between agents
 */

import type { Task, AgentProfile } from '../utils/types.js';
import type { IEventBus } from '../core/event-bus.js';
import type { ILogger } from '../core/logger.js';

export interface WorkStealingConfig {
  enabled: boolean;
  stealThreshold: number; // Min difference in task count to trigger stealing
  maxStealBatch: number; // Max tasks to steal at once
  stealInterval: number; // How often to check for steal opportunities (ms)
}

export interface AgentWorkload {
  agentId: string;
  taskCount: number;
  avgTaskDuration: number;
  cpuUsage: number;
  memoryUsage: number;
  priority: number;
  capabilities: string[];
}

/**
 * Work stealing coordinator for load balancing
 */
export class WorkStealingCoordinator {
  private workloads = new Map<string, AgentWorkload>();
  private stealInterval?: ReturnType<typeof setInterval>;
  private taskDurations = new Map<string, number[]>(); // agentId -> task durations

  constructor(
    private config: WorkStealingConfig,
    private eventBus: IEventBus,
    private logger: ILogger,
  ) {}

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Work stealing is disabled');
      return;
    }

    this.logger.info('Initializing work stealing coordinator');
    
    // Start periodic steal checks
    this.stealInterval = setInterval(
      () => this.checkAndSteal(),
      this.config.stealInterval,
    );
  }

  async shutdown(): Promise<void> {
    if (this.stealInterval) {
      clearInterval(this.stealInterval);
    }
    
    this.workloads.clear();
    this.taskDurations.clear();
  }

  updateAgentWorkload(agentId: string, workload: Partial<AgentWorkload>): void {
    const existing = this.workloads.get(agentId) || {
      agentId,
      taskCount: 0,
      avgTaskDuration: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      priority: 0,
      capabilities: [],
    };

    this.workloads.set(agentId, { ...existing, ...workload });
  }

  recordTaskDuration(agentId: string, duration: number): void {
    if (!this.taskDurations.has(agentId)) {
      this.taskDurations.set(agentId, []);
    }

    const durations = this.taskDurations.get(agentId)!;
    durations.push(duration);

    // Keep only last 100 durations
    if (durations.length > 100) {
      durations.shift();
    }

    // Update average duration
    const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    this.updateAgentWorkload(agentId, { avgTaskDuration: avg });
  }

  async checkAndSteal(): Promise<void> {
    const workloads = Array.from(this.workloads.values());
    if (workloads.length < 2) {
      return; // Need at least 2 agents
    }

    // Sort by task count (ascending)
    workloads.sort((a, b) => a.taskCount - b.taskCount);

    const minLoaded = workloads[0];
    const maxLoaded = workloads[workloads.length - 1];

    // Check if stealing is warranted
    const difference = maxLoaded.taskCount - minLoaded.taskCount;
    if (difference < this.config.stealThreshold) {
      return; // Not enough imbalance
    }

    // Calculate how many tasks to steal
    const tasksToSteal = Math.min(
      Math.floor(difference / 2),
      this.config.maxStealBatch,
    );

    this.logger.info('Initiating work stealing', {
      from: maxLoaded.agentId,
      to: minLoaded.agentId,
      tasksToSteal,
      difference,
    });

    // Emit steal request event
    this.eventBus.emit('workstealing:request', {
      sourceAgent: maxLoaded.agentId,
      targetAgent: minLoaded.agentId,
      taskCount: tasksToSteal,
    });
  }

  /**
   * Find the best agent for a task based on capabilities and load
   */
  findBestAgent(task: Task, agents: AgentProfile[]): string | null {
    const candidates: Array<{
      agentId: string;
      score: number;
    }> = [];

    for (const agent of agents) {
      const workload = this.workloads.get(agent.id);
      if (!workload) {
        continue;
      }

      // Calculate score based on multiple factors
      let score = 100;

      // Factor 1: Task count (lower is better)
      score -= workload.taskCount * 10;

      // Factor 2: CPU usage (lower is better)
      score -= workload.cpuUsage * 0.5;

      // Factor 3: Memory usage (lower is better)
      score -= workload.memoryUsage * 0.3;

      // Factor 4: Agent priority (higher is better)
      score += agent.priority * 5;

      // Factor 5: Capability match
      const taskType = task.type;
      if (agent.capabilities.includes(taskType)) {
        score += 20; // Bonus for capability match
      }

      // Factor 6: Average task duration (predictive load)
      const predictedLoad = workload.avgTaskDuration * workload.taskCount;
      score -= predictedLoad / 1000; // Convert to seconds

      candidates.push({ agentId: agent.id, score });
    }

    if (candidates.length === 0) {
      return null;
    }

    // Sort by score (descending) and return best
    candidates.sort((a, b) => b.score - a.score);
    
    this.logger.debug('Agent selection scores', {
      taskId: task.id,
      candidates: candidates.slice(0, 5), // Top 5
    });

    return candidates[0].agentId;
  }

  getWorkloadStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {
      totalAgents: this.workloads.size,
      workloads: {},
    };

    let totalTasks = 0;
    let minTasks = Infinity;
    let maxTasks = 0;

    for (const [agentId, workload] of Array.from(this.workloads.entries())) {
      totalTasks += workload.taskCount;
      minTasks = Math.min(minTasks, workload.taskCount);
      maxTasks = Math.max(maxTasks, workload.taskCount);

      (stats.workloads as Record<string, unknown>)[agentId] = {
        taskCount: workload.taskCount,
        avgTaskDuration: workload.avgTaskDuration,
        cpuUsage: workload.cpuUsage,
        memoryUsage: workload.memoryUsage,
      };
    }

    stats.totalTasks = totalTasks;
    stats.avgTasksPerAgent = totalTasks / this.workloads.size;
    stats.minTasks = minTasks === Infinity ? 0 : minTasks;
    stats.maxTasks = maxTasks;
    stats.imbalance = maxTasks - (minTasks === Infinity ? 0 : minTasks);

    return stats;
  }
}