/**
 * V3 Task Orchestrator
 * Manages task decomposition, dependency resolution, and parallel execution
 *
 * Based on ADR-003 (Single Coordination Engine) and ADR-001 (agentic-flow integration)
 */

import {
  TaskId,
  TaskType,
  TaskStatus,
  TaskPriority,
  TaskDefinition,
  TaskMetadata,
  TaskResult,
  TaskResultMetrics,
  AgentId,
  AgentDomain,
  PhaseId,
  SwarmEvent
} from '../shared/types.js';
import {
  IEventBus,
  taskCreatedEvent,
  taskQueuedEvent,
  taskAssignedEvent,
  taskStartedEvent,
  taskCompletedEvent,
  taskFailedEvent,
  taskBlockedEvent
} from '../shared/events.js';
import { IAgentRegistry } from './agent-registry.js';

// =============================================================================
// Task Orchestrator Interface
// =============================================================================

export interface ITaskOrchestrator {
  // Task Creation
  createTask(spec: TaskSpec): TaskDefinition;
  createBatchTasks(specs: TaskSpec[]): TaskDefinition[];

  // Task Lifecycle
  queueTask(taskId: TaskId): void;
  assignTask(taskId: TaskId, agentId: AgentId): void;
  startTask(taskId: TaskId): void;
  completeTask(taskId: TaskId, result: TaskResult): void;
  failTask(taskId: TaskId, error: Error): void;
  cancelTask(taskId: TaskId): void;

  // Dependency Management
  addDependency(taskId: TaskId, dependsOn: TaskId): void;
  removeDependency(taskId: TaskId, dependsOn: TaskId): void;
  getDependencies(taskId: TaskId): TaskId[];
  getDependents(taskId: TaskId): TaskId[];
  isBlocked(taskId: TaskId): boolean;
  getBlockingTasks(taskId: TaskId): TaskId[];

  // Queries
  getTask(taskId: TaskId): TaskDefinition | undefined;
  getAllTasks(): TaskDefinition[];
  getTasksByStatus(status: TaskStatus): TaskDefinition[];
  getTasksByAgent(agentId: AgentId): TaskDefinition[];
  getTasksByDomain(domain: AgentDomain): TaskDefinition[];
  getTasksByPhase(phase: PhaseId): TaskDefinition[];

  // Queue Management
  getNextTask(agentId?: AgentId): TaskDefinition | undefined;
  getPriorityQueue(): TaskDefinition[];

  // Metrics
  getTaskMetrics(): TaskOrchestratorMetrics;
}

export interface TaskSpec {
  type: TaskType;
  title: string;
  description: string;
  priority?: TaskPriority;
  dependencies?: TaskId[];
  domain: AgentDomain;
  phase: PhaseId;
  estimatedDuration?: number;
  tags?: string[];
}

export interface TaskOrchestratorMetrics {
  totalTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  tasksByPriority: Record<TaskPriority, number>;
  tasksByDomain: Record<AgentDomain, number>;
  averageQueueTime: number;
  averageExecutionTime: number;
  throughput: number;
}

// =============================================================================
// Task Orchestrator Implementation
// =============================================================================

export class TaskOrchestrator implements ITaskOrchestrator {
  private tasks: Map<TaskId, TaskDefinition> = new Map();
  private dependencyGraph: Map<TaskId, Set<TaskId>> = new Map();
  private dependentGraph: Map<TaskId, Set<TaskId>> = new Map();
  private taskCounter: number = 0;
  private eventBus: IEventBus;
  private agentRegistry: IAgentRegistry;

  constructor(eventBus: IEventBus, agentRegistry: IAgentRegistry) {
    this.eventBus = eventBus;
    this.agentRegistry = agentRegistry;

    this.eventBus.subscribe('agent:task-completed', this.handleAgentTaskCompleted.bind(this));
  }

  // ==========================================================================
  // Task Creation
  // ==========================================================================

  createTask(spec: TaskSpec): TaskDefinition {
    const taskId: TaskId = `task-${Date.now()}-${++this.taskCounter}`;

    const task: TaskDefinition = {
      id: taskId,
      type: spec.type,
      title: spec.title,
      description: spec.description,
      assignedAgent: null,
      status: 'pending',
      priority: spec.priority ?? 'medium',
      dependencies: spec.dependencies ?? [],
      blockedBy: [],
      metadata: {
        domain: spec.domain,
        phase: spec.phase,
        estimatedDuration: spec.estimatedDuration ?? 0,
        actualDuration: null,
        retryCount: 0,
        maxRetries: 3,
        artifacts: [],
        tags: spec.tags ?? []
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null
    };

    this.tasks.set(taskId, task);
    this.dependencyGraph.set(taskId, new Set(task.dependencies));
    this.dependentGraph.set(taskId, new Set());

    for (const depId of task.dependencies) {
      if (this.dependentGraph.has(depId)) {
        this.dependentGraph.get(depId)!.add(taskId);
      }
    }

    this.updateBlockedStatus(taskId);

    this.eventBus.emitSync(taskCreatedEvent(taskId, { type: spec.type, title: spec.title }));

    return task;
  }

  createBatchTasks(specs: TaskSpec[]): TaskDefinition[] {
    return specs.map(spec => this.createTask(spec));
  }

  // ==========================================================================
  // Task Lifecycle
  // ==========================================================================

  queueTask(taskId: TaskId): void {
    const task = this.getTaskOrThrow(taskId);

    if (this.isBlocked(taskId)) {
      this.updateTaskStatus(taskId, 'blocked');
      return;
    }

    this.updateTaskStatus(taskId, 'queued');
    this.eventBus.emitSync(taskQueuedEvent(taskId, this.getQueuePosition(taskId)));
  }

  assignTask(taskId: TaskId, agentId: AgentId): void {
    const task = this.getTaskOrThrow(taskId);

    if (task.status !== 'queued') {
      throw new Error(`Task ${taskId} is not queued (status: ${task.status})`);
    }

    if (this.isBlocked(taskId)) {
      throw new Error(`Task ${taskId} is blocked by dependencies`);
    }

    task.assignedAgent = agentId;
    this.updateTaskStatus(taskId, 'assigned');

    this.agentRegistry.assignTask(agentId, taskId);

    this.eventBus.emitSync(taskAssignedEvent(taskId, agentId));
  }

  startTask(taskId: TaskId): void {
    const task = this.getTaskOrThrow(taskId);

    if (task.status !== 'assigned') {
      throw new Error(`Task ${taskId} is not assigned (status: ${task.status})`);
    }

    this.updateTaskStatus(taskId, 'in-progress');

    if (task.assignedAgent) {
      this.eventBus.emitSync(taskStartedEvent(taskId, task.assignedAgent));
    }
  }

  completeTask(taskId: TaskId, result: TaskResult): void {
    const task = this.getTaskOrThrow(taskId);

    if (task.status !== 'in-progress') {
      throw new Error(`Task ${taskId} is not in progress (status: ${task.status})`);
    }

    task.metadata.actualDuration = result.duration;
    task.completedAt = Date.now();

    this.updateTaskStatus(taskId, 'completed');

    if (task.assignedAgent) {
      this.agentRegistry.completeTask(task.assignedAgent, taskId);
    }

    this.eventBus.emitSync(taskCompletedEvent(taskId, result));

    this.unblockDependentTasks(taskId);
  }

  failTask(taskId: TaskId, error: Error): void {
    const task = this.getTaskOrThrow(taskId);

    task.metadata.retryCount++;

    if (task.metadata.retryCount < task.metadata.maxRetries) {
      this.updateTaskStatus(taskId, 'queued');
      task.assignedAgent = null;
    } else {
      this.updateTaskStatus(taskId, 'failed');

      if (task.assignedAgent) {
        const agentState = this.agentRegistry.getState(task.assignedAgent);
        if (agentState) {
          agentState.metrics.tasksFailed++;
        }
      }
    }

    this.eventBus.emitSync(taskFailedEvent(taskId, error));
  }

  cancelTask(taskId: TaskId): void {
    const task = this.getTaskOrThrow(taskId);

    if (task.status === 'completed' || task.status === 'failed') {
      throw new Error(`Cannot cancel ${task.status} task ${taskId}`);
    }

    if (task.assignedAgent) {
      this.agentRegistry.updateStatus(task.assignedAgent, 'idle');
    }

    this.updateTaskStatus(taskId, 'cancelled');
  }

  // ==========================================================================
  // Dependency Management
  // ==========================================================================

  addDependency(taskId: TaskId, dependsOn: TaskId): void {
    const task = this.getTaskOrThrow(taskId);
    this.getTaskOrThrow(dependsOn);

    if (this.wouldCreateCycle(taskId, dependsOn)) {
      throw new Error(`Adding dependency ${dependsOn} to ${taskId} would create a cycle`);
    }

    task.dependencies.push(dependsOn);
    this.dependencyGraph.get(taskId)!.add(dependsOn);
    this.dependentGraph.get(dependsOn)!.add(taskId);

    this.updateBlockedStatus(taskId);
  }

  removeDependency(taskId: TaskId, dependsOn: TaskId): void {
    const task = this.getTaskOrThrow(taskId);

    const index = task.dependencies.indexOf(dependsOn);
    if (index > -1) {
      task.dependencies.splice(index, 1);
    }

    this.dependencyGraph.get(taskId)?.delete(dependsOn);
    this.dependentGraph.get(dependsOn)?.delete(taskId);

    this.updateBlockedStatus(taskId);
  }

  getDependencies(taskId: TaskId): TaskId[] {
    return Array.from(this.dependencyGraph.get(taskId) ?? []);
  }

  getDependents(taskId: TaskId): TaskId[] {
    return Array.from(this.dependentGraph.get(taskId) ?? []);
  }

  isBlocked(taskId: TaskId): boolean {
    const blockingTasks = this.getBlockingTasks(taskId);
    return blockingTasks.length > 0;
  }

  getBlockingTasks(taskId: TaskId): TaskId[] {
    const dependencies = this.dependencyGraph.get(taskId);
    if (!dependencies) {
      return [];
    }

    return Array.from(dependencies).filter(depId => {
      const depTask = this.tasks.get(depId);
      return depTask && depTask.status !== 'completed';
    });
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  getTask(taskId: TaskId): TaskDefinition | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): TaskDefinition[] {
    return Array.from(this.tasks.values());
  }

  getTasksByStatus(status: TaskStatus): TaskDefinition[] {
    return this.getAllTasks().filter(t => t.status === status);
  }

  getTasksByAgent(agentId: AgentId): TaskDefinition[] {
    return this.getAllTasks().filter(t => t.assignedAgent === agentId);
  }

  getTasksByDomain(domain: AgentDomain): TaskDefinition[] {
    return this.getAllTasks().filter(t => t.metadata.domain === domain);
  }

  getTasksByPhase(phase: PhaseId): TaskDefinition[] {
    return this.getAllTasks().filter(t => t.metadata.phase === phase);
  }

  // ==========================================================================
  // Queue Management
  // ==========================================================================

  getNextTask(agentId?: AgentId): TaskDefinition | undefined {
    const queuedTasks = this.getTasksByStatus('queued')
      .filter(t => !this.isBlocked(t.id))
      .sort((a, b) => {
        const priorityOrder: Record<TaskPriority, number> = {
          'critical': 0,
          'high': 1,
          'medium': 2,
          'low': 3
        };

        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;

        return a.createdAt - b.createdAt;
      });

    if (!agentId) {
      return queuedTasks[0];
    }

    const agentDef = this.agentRegistry.getDefinition(agentId);
    if (!agentDef) {
      return queuedTasks[0];
    }

    const supportedTypes = agentDef.capabilities.flatMap(c => c.supportedTaskTypes);

    return queuedTasks.find(t => supportedTypes.includes(t.type));
  }

  getPriorityQueue(): TaskDefinition[] {
    return this.getTasksByStatus('queued')
      .filter(t => !this.isBlocked(t.id))
      .sort((a, b) => {
        const priorityOrder: Record<TaskPriority, number> = {
          'critical': 0,
          'high': 1,
          'medium': 2,
          'low': 3
        };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }

  // ==========================================================================
  // Metrics
  // ==========================================================================

  getTaskMetrics(): TaskOrchestratorMetrics {
    const allTasks = this.getAllTasks();

    const tasksByStatus: Record<TaskStatus, number> = {
      'pending': 0,
      'queued': 0,
      'assigned': 0,
      'in-progress': 0,
      'blocked': 0,
      'completed': 0,
      'failed': 0,
      'cancelled': 0
    };

    const tasksByPriority: Record<TaskPriority, number> = {
      'critical': 0,
      'high': 0,
      'medium': 0,
      'low': 0
    };

    const tasksByDomain: Record<AgentDomain, number> = {
      'security': 0,
      'core': 0,
      'integration': 0,
      'quality': 0,
      'performance': 0,
      'deployment': 0
    };

    let totalQueueTime = 0;
    let totalExecutionTime = 0;
    let completedCount = 0;

    for (const task of allTasks) {
      tasksByStatus[task.status]++;
      tasksByPriority[task.priority]++;
      tasksByDomain[task.metadata.domain]++;

      if (task.status === 'completed' && task.metadata.actualDuration) {
        totalExecutionTime += task.metadata.actualDuration;
        completedCount++;
      }
    }

    const now = Date.now();
    const firstTask = allTasks[0];
    const runtimeMs = firstTask ? now - firstTask.createdAt : 1;
    const throughput = completedCount / (runtimeMs / 1000 / 60);

    return {
      totalTasks: allTasks.length,
      tasksByStatus,
      tasksByPriority,
      tasksByDomain,
      averageQueueTime: totalQueueTime / (completedCount || 1),
      averageExecutionTime: totalExecutionTime / (completedCount || 1),
      throughput
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private getTaskOrThrow(taskId: TaskId): TaskDefinition {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return task;
  }

  private updateTaskStatus(taskId: TaskId, status: TaskStatus): void {
    const task = this.getTaskOrThrow(taskId);
    task.status = status;
    task.updatedAt = Date.now();

    if (status === 'blocked') {
      task.blockedBy = this.getBlockingTasks(taskId);
    } else {
      task.blockedBy = [];
    }
  }

  private updateBlockedStatus(taskId: TaskId): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'failed') {
      return;
    }

    const isBlocked = this.isBlocked(taskId);

    if (isBlocked && task.status !== 'blocked') {
      this.updateTaskStatus(taskId, 'blocked');
      const blockingTasks = this.getBlockingTasks(taskId);
      this.eventBus.emitSync(taskBlockedEvent(taskId, 'Blocked by dependencies', blockingTasks[0]));
    } else if (!isBlocked && task.status === 'blocked') {
      this.updateTaskStatus(taskId, 'queued');
    }
  }

  private unblockDependentTasks(taskId: TaskId): void {
    const dependents = this.getDependents(taskId);

    for (const dependentId of dependents) {
      this.updateBlockedStatus(dependentId);
    }
  }

  private wouldCreateCycle(taskId: TaskId, newDependency: TaskId): boolean {
    const visited = new Set<TaskId>();
    const stack = [newDependency];

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (current === taskId) {
        return true;
      }

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      const deps = this.dependencyGraph.get(current);
      if (deps) {
        stack.push(...deps);
      }
    }

    return false;
  }

  private handleAgentTaskCompleted(event: SwarmEvent): void {
    const payload = event.payload as { taskId: TaskId; result: unknown };

    if (payload.taskId && this.tasks.has(payload.taskId)) {
      const task = this.tasks.get(payload.taskId)!;
      if (task.status === 'in-progress') {
        this.completeTask(payload.taskId, {
          taskId: payload.taskId,
          success: true,
          output: payload.result,
          error: null,
          duration: Date.now() - task.updatedAt,
          metrics: this.createDefaultMetrics()
        });
      }
    }
  }

  private createDefaultMetrics(): TaskResultMetrics {
    return {
      linesOfCode: 0,
      testsWritten: 0,
      testsPassed: 0,
      coveragePercent: 0,
      performanceImpact: 0
    };
  }

  private getQueuePosition(taskId: TaskId): number {
    const priorityOrder: Record<string, number> = {
      critical: 5,
      high: 4,
      normal: 3,
      low: 2,
      background: 1,
    };

    const queuedTasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'queued')
      .sort((a, b) => (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0));

    const position = queuedTasks.findIndex(t => t.id === taskId);
    return position >= 0 ? position + 1 : queuedTasks.length + 1;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createTaskOrchestrator(
  eventBus: IEventBus,
  agentRegistry: IAgentRegistry
): ITaskOrchestrator {
  return new TaskOrchestrator(eventBus, agentRegistry);
}
