/**
 * JSON Output Aggregator for Non-Interactive Swarm Execution
 * Collects and formats swarm results into a comprehensive JSON structure
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'node:fs';
import { generateId } from '../utils/helpers.js';
import { Logger } from '../core/logger.js';
import type {
  SwarmId,
  AgentId,
  TaskId,
  AgentState,
  TaskDefinition,
  SwarmResults,
  SwarmMetrics,
  TaskResult,
} from './types.js';

export interface SwarmOutputAggregate {
  swarmId: string;
  objective: string;
  startTime: string;
  endTime: string;
  duration: number;
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  summary: {
    totalAgents: number;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    successRate: number;
  };
  agents: AgentOutputData[];
  tasks: TaskOutputData[];
  results: {
    artifacts: Record<string, any>;
    outputs: string[];
    errors: string[];
    insights: string[];
  };
  metrics: SwarmMetrics;
  metadata: {
    strategy: string;
    mode: string;
    configuration: Record<string, any>;
    version: string;
  };
}

export interface AgentOutputData {
  agentId: string;
  name: string;
  type: string;
  status: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  tasksCompleted: number;
  outputs: string[];
  errors: string[];
  metrics: {
    tokensUsed?: number;
    memoryAccess: number;
    operationsPerformed: number;
  };
}

export interface TaskOutputData {
  taskId: string;
  name: string;
  type: string;
  status: string;
  assignedAgent?: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  priority: string;
  output?: string;
  result?: TaskResult;
  artifacts?: Record<string, any>;
  error?: string;
}

export class SwarmJsonOutputAggregator extends EventEmitter {
  private logger: Logger;
  private swarmId: string;
  private objective: string;
  private startTime: Date;
  private endTime?: Date;
  private configuration: Record<string, any>;

  // Data collection
  private agents: Map<string, AgentOutputData> = new Map();
  private tasks: Map<string, TaskOutputData> = new Map();
  private outputs: string[] = [];
  private errors: string[] = [];
  private insights: string[] = [];
  private artifacts: Record<string, any> = {};
  private metrics: SwarmMetrics = this.initializeMetrics();

  constructor(swarmId: string, objective: string, configuration: Record<string, any> = {}) {
    super();
    this.swarmId = swarmId;
    this.objective = objective;
    this.configuration = configuration;
    this.startTime = new Date();

    this.logger = new Logger(
      { level: 'info', format: 'json', destination: 'console' },
      { component: 'SwarmJsonAggregator' },
    );

    this.logger.info('JSON output aggregator initialized', {
      swarmId,
      objective,
      timestamp: this.startTime.toISOString(),
    });
  }

  // Agent tracking methods
  addAgent(agent: AgentState): void {
    // Handle null/undefined agent IDs gracefully
    if (!agent || !agent.id) {
      this.logger.warn('Attempted to add agent with null/undefined ID, skipping');
      return;
    }

    const agentIdStr = typeof agent.id === 'string' ? agent.id : agent.id.id;
    const agentData: AgentOutputData = {
      agentId: agentIdStr,
      name: agent.name || agentIdStr,
      type: agent.type,
      status: agent.status,
      startTime: new Date().toISOString(),
      tasksCompleted: 0,
      outputs: [],
      errors: [],
      metrics: {
        memoryAccess: 0,
        operationsPerformed: 0,
      },
    };

    this.agents.set(agentIdStr, agentData);
    this.logger.debug('Agent added to output tracking', { agentId: agentIdStr });
  }

  updateAgent(agentId: string, updates: Partial<AgentOutputData>): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      Object.assign(agent, updates);
      this.logger.debug('Agent updated in output tracking', { agentId, updates });
    }
  }

  addAgentOutput(agentId: string, output: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.outputs.push(output);
      agent.metrics.operationsPerformed++;
    }
    this.outputs.push(`[${agentId}] ${output}`);
  }

  addAgentError(agentId: string, error: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.errors.push(error);
    }
    this.errors.push(`[${agentId}] ${error}`);
  }

  // Task tracking methods
  addTask(task: TaskDefinition): void {
    // Handle null/undefined task IDs gracefully
    if (!task || !task.id) {
      this.logger.warn('Attempted to add task with null/undefined ID, skipping');
      return;
    }

    const taskIdStr = typeof task.id === 'string' ? task.id : task.id.id;
    const taskData: TaskOutputData = {
      taskId: taskIdStr,
      name: task.name || taskIdStr,
      type: task.type,
      status: task.status,
      assignedAgent: task.assignedAt
        ? typeof task.assignedAt === 'string'
          ? task.assignedAt
          : task.assignedAt.toString()
        : undefined,
      startTime: new Date().toISOString(),
      priority: task.priority || 'normal',
    };

    this.tasks.set(taskIdStr, taskData);
    this.logger.debug('Task added to output tracking', { taskId: taskIdStr });
  }

  updateTask(taskId: string, updates: Partial<TaskOutputData>): void {
    const task = this.tasks.get(taskId);
    if (task) {
      Object.assign(task, updates);
      this.logger.debug('Task updated in output tracking', { taskId, updates });
    }
  }

  completeTask(taskId: string, result: TaskResult): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.endTime = new Date().toISOString();
      task.duration = task.startTime ? Date.now() - new Date(task.startTime).getTime() : 0;
      task.result = result;
      task.output = result.output;
      task.artifacts = result.artifacts;

      // Update agent completion count
      if (task.assignedAgent) {
        const agent = this.agents.get(task.assignedAgent);
        if (agent) {
          agent.tasksCompleted++;
        }
      }
    }
  }

  // Global tracking methods
  addInsight(insight: string): void {
    this.insights.push(insight);
    this.logger.debug('Insight added', { insight });
  }

  addArtifact(key: string, artifact: any): void {
    this.artifacts[key] = artifact;
    this.logger.debug('Artifact added', { key });
  }

  updateMetrics(updates: Partial<SwarmMetrics>): void {
    Object.assign(this.metrics, updates);
  }

  // Finalization and output
  finalize(
    status: 'completed' | 'failed' | 'timeout' | 'cancelled' = 'completed',
  ): SwarmOutputAggregate {
    this.endTime = new Date();
    const duration = this.endTime.getTime() - this.startTime.getTime();

    // Calculate summary statistics
    const totalTasks = this.tasks.size;
    const completedTasks = Array.from(this.tasks.values()).filter(
      (task) => task.status === 'completed',
    ).length;
    const failedTasks = Array.from(this.tasks.values()).filter(
      (task) => task.status === 'failed',
    ).length;
    const successRate = totalTasks > 0 ? completedTasks / totalTasks : 0;

    // Finalize agent data
    this.agents.forEach((agent) => {
      if (!agent.endTime) {
        agent.endTime = this.endTime.toISOString();
        agent.duration = Date.now() - new Date(agent.startTime).getTime();
      }
    });

    const aggregate: SwarmOutputAggregate = {
      swarmId: this.swarmId,
      objective: this.objective,
      startTime: this.startTime.toISOString(),
      endTime: this.endTime.toISOString(),
      duration,
      status,
      summary: {
        totalAgents: this.agents.size,
        totalTasks,
        completedTasks,
        failedTasks,
        successRate,
      },
      agents: Array.from(this.agents.values()),
      tasks: Array.from(this.tasks.values()),
      results: {
        artifacts: this.artifacts,
        outputs: this.outputs,
        errors: this.errors,
        insights: this.insights,
      },
      metrics: this.metrics,
      metadata: {
        strategy: this.configuration.strategy || 'auto',
        mode: this.configuration.mode || 'centralized',
        configuration: this.configuration,
        version: '2.0.0-alpha',
      },
    };

    this.logger.info('Swarm output aggregation finalized', {
      swarmId: this.swarmId,
      status,
      duration,
      summary: aggregate.summary,
    });

    return aggregate;
  }

  async saveToFile(
    filePath: string,
    status: 'completed' | 'failed' | 'timeout' | 'cancelled' = 'completed',
  ): Promise<void> {
    const aggregate = this.finalize(status);
    const json = JSON.stringify(aggregate, this.circularReplacer(), 2);
    await fs.writeFile(filePath, json, 'utf8');
    this.logger.info('Swarm output saved to file', { filePath, size: json.length });
  }

  getJsonOutput(status: 'completed' | 'failed' | 'timeout' | 'cancelled' = 'completed'): string {
    const aggregate = this.finalize(status);
    return JSON.stringify(aggregate, this.circularReplacer(), 2);
  }

  // Handle circular references in JSON serialization
  private circularReplacer(): (key: string, value: any) => any {
    const seen = new WeakSet();
    return (key: string, value: any) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    };
  }

  private initializeMetrics(): SwarmMetrics {
    return {
      // Performance metrics
      throughput: 0,
      latency: 0,
      efficiency: 0,
      reliability: 0,

      // Quality metrics
      averageQuality: 0,
      defectRate: 0,
      reworkRate: 0,

      // Resource metrics
      resourceUtilization: {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: 0,
      },
      costEfficiency: 0,

      // Agent metrics
      agentUtilization: 0,
      agentSatisfaction: 0,
      collaborationEffectiveness: 0,

      // Timeline metrics
      scheduleVariance: 0,
      deadlineAdherence: 0,
    };
  }
}
