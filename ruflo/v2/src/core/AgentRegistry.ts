/**
 * AgentRegistry - Tracks and manages agent lifecycle
 * Provides centralized management for agent spawning, coordination, and monitoring
 */

import { IDatabaseProvider, IAgentCoordinator, Agent, AgentType, AgentConfig, Task, Result, Metrics, AgentMetrics, AgentPerformance } from '../types/interfaces.js';
import { nanoid } from 'nanoid';

export class AgentRegistry implements IAgentCoordinator {
  private agents: Map<string, Agent> = new Map();
  private tasks: Map<string, Task> = new Map();
  private activeAssignments: Map<string, string[]> = new Map(); // agentId -> taskIds

  constructor(private database: IDatabaseProvider) {}

  /**
   * Initialize the agent registry
   */
  async initialize(): Promise<void> {
    // Load existing agents from database
    try {
      const agentIds = await this.database.list('agents');
      for (const agentId of agentIds) {
        const agentData = await this.database.retrieve(agentId, 'agents');
        if (agentData) {
          const agent = typeof agentData === 'string' ? JSON.parse(agentData) : agentData;
          this.agents.set(agent.id, agent);
        }
      }
    } catch (error) {
      console.warn('Failed to load existing agents:', error);
    }
  }

  /**
   * Spawn a new agent
   */
  async spawn(type: AgentType, config: AgentConfig = {}): Promise<Agent> {
    const agent: Agent = {
      id: nanoid(),
      type,
      capabilities: config.capabilities || this.getDefaultCapabilities(type),
      status: 'idle',
      metadata: {
        ...config.metadata,
        spawnedAt: new Date().toISOString(),
        maxConcurrency: config.maxConcurrency || 1,
        timeout: config.timeout || 30000,
        resources: config.resources || {
          memory: 512,
          cpu: 1,
          storage: 100,
          network: 10
        }
      },
      connections: [],
      performance: {
        tasksCompleted: 0,
        averageResponseTime: 0,
        successRate: 1.0,
        resourceUtilization: {
          memory: 0,
          cpu: 0,
          storage: 0,
          network: 0
        },
        lastActivity: new Date()
      }
    };

    // Store agent
    this.agents.set(agent.id, agent);
    await this.database.store(agent.id, agent, 'agents');

    // Initialize task tracking
    this.activeAssignments.set(agent.id, []);

    return agent;
  }

  /**
   * Get default capabilities for agent type
   */
  private getDefaultCapabilities(type: AgentType): string[] {
    const capabilityMap: Record<AgentType, string[]> = {
      researcher: ['research', 'analysis', 'documentation', 'web-search'],
      coder: ['programming', 'debugging', 'refactoring', 'testing'],
      analyst: ['data-analysis', 'visualization', 'reporting', 'metrics'],
      optimizer: ['performance-tuning', 'resource-optimization', 'bottleneck-analysis'],
      coordinator: ['task-delegation', 'workflow-management', 'communication'],
      tester: ['unit-testing', 'integration-testing', 'quality-assurance'],
      reviewer: ['code-review', 'security-audit', 'compliance-check']
    };

    return capabilityMap[type] || ['general'];
  }

  /**
   * Coordinate task execution
   */
  async coordinate(task: Task): Promise<Result> {
    const startTime = Date.now();

    try {
      // Find suitable agents
      const suitableAgents = this.findSuitableAgents(task);

      if (suitableAgents.length === 0) {
        return {
          success: false,
          error: `No suitable agents found for task ${task.id}. Required capabilities: ${task.requiredCapabilities.join(', ')}`
        };
      }

      // Select best agent based on availability and performance
      const selectedAgent = this.selectBestAgent(suitableAgents, task);

      // Assign task to agent
      await this.assignTask(selectedAgent.id, task);

      // Simulate task execution (in real implementation, this would communicate with actual agent)
      const executionResult = await this.executeTask(selectedAgent, task);

      // Update agent performance
      await this.updateAgentPerformance(selectedAgent.id, task, executionResult, Date.now() - startTime);

      return executionResult;

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Find agents with required capabilities
   */
  private findSuitableAgents(task: Task): Agent[] {
    return Array.from(this.agents.values()).filter(agent => {
      // Check if agent has required capabilities
      const hasCapabilities = task.requiredCapabilities.every(cap =>
        agent.capabilities.some(agentCap =>
          agentCap.toLowerCase().includes(cap.toLowerCase()) ||
          cap.toLowerCase().includes(agentCap.toLowerCase())
        )
      );

      // Check availability
      const isAvailable = agent.status === 'idle' || agent.status === 'active';

      // Check concurrency limits
      const currentTasks = this.activeAssignments.get(agent.id)?.length || 0;
      const maxConcurrency = agent.metadata.maxConcurrency || 1;
      const canTakeTask = currentTasks < maxConcurrency;

      return hasCapabilities && isAvailable && canTakeTask;
    });
  }

  /**
   * Select the best agent for a task
   */
  private selectBestAgent(candidates: Agent[], task: Task): Agent {
    // Score agents based on performance, availability, and specialization
    const scored = candidates.map(agent => {
      let score = 0;

      // Performance score (higher success rate and lower response time is better)
      score += agent.performance!.successRate * 40;
      score += Math.max(0, 20 - (agent.performance!.averageResponseTime / 1000)) * 2;

      // Availability score (fewer active tasks is better)
      const activeTasks = this.activeAssignments.get(agent.id)?.length || 0;
      score += Math.max(0, 10 - activeTasks) * 3;

      // Specialization score (exact capability matches are better)
      const exactMatches = task.requiredCapabilities.filter(cap =>
        agent.capabilities.includes(cap)
      ).length;
      score += exactMatches * 5;

      // Priority matching
      if (task.priority === 'critical' && agent.type === 'coordinator') score += 10;
      if (task.priority === 'high' && ['coordinator', 'optimizer'].includes(agent.type)) score += 5;

      return { agent, score };
    });

    // Return agent with highest score
    scored.sort((a, b) => b.score - a.score);
    return scored[0].agent;
  }

  /**
   * Assign task to agent
   */
  private async assignTask(agentId: string, task: Task): Promise<void> {
    // Update agent status
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'busy';
      await this.database.store(agentId, agent, 'agents');
    }

    // Add to active assignments
    const currentTasks = this.activeAssignments.get(agentId) || [];
    currentTasks.push(task.id);
    this.activeAssignments.set(agentId, currentTasks);

    // Store task
    this.tasks.set(task.id, task);
    await this.database.store(task.id, task, 'tasks');
  }

  /**
   * Execute task (simulation)
   */
  private async executeTask(agent: Agent, task: Task): Promise<Result> {
    // Simulate processing time based on task complexity and agent performance
    const baseTime = 1000 + Math.random() * 2000; // 1-3 seconds
    const complexityFactor = task.requiredCapabilities.length * 0.5;
    const performanceFactor = 2 - agent.performance!.successRate;

    const processingTime = baseTime * complexityFactor * performanceFactor;

    await new Promise(resolve => setTimeout(resolve, Math.min(processingTime, 5000)));

    // Simulate success/failure based on agent performance
    const successProbability = agent.performance!.successRate * 0.9 + 0.1;
    const success = Math.random() < successProbability;

    if (success) {
      return {
        success: true,
        data: {
          taskId: task.id,
          agentId: agent.id,
          result: `Task ${task.description} completed successfully by ${agent.type} agent`,
          processingTime: Math.round(processingTime)
        },
        metadata: {
          capabilities: agent.capabilities,
          performance: agent.performance
        }
      };
    } else {
      return {
        success: false,
        error: `Task ${task.id} failed during execution by agent ${agent.id}`,
        metadata: {
          processingTime: Math.round(processingTime)
        }
      };
    }
  }

  /**
   * Update agent performance metrics
   */
  private async updateAgentPerformance(agentId: string, task: Task, result: Result, duration: number): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.performance) return;

    const perf = agent.performance;

    // Update task count
    perf.tasksCompleted++;

    // Update success rate (exponential moving average)
    const alpha = 0.1; // Learning rate
    perf.successRate = perf.successRate * (1 - alpha) + (result.success ? 1 : 0) * alpha;

    // Update average response time
    perf.averageResponseTime = perf.averageResponseTime * (1 - alpha) + duration * alpha;

    // Update last activity
    perf.lastActivity = new Date();

    // Update resource utilization (simulated)
    perf.resourceUtilization = {
      memory: Math.min(100, perf.resourceUtilization.memory + Math.random() * 10),
      cpu: Math.min(100, perf.resourceUtilization.cpu + Math.random() * 15),
      storage: Math.min(100, perf.resourceUtilization.storage + Math.random() * 5),
      network: Math.min(100, perf.resourceUtilization.network + Math.random() * 8)
    };

    // Update agent status
    const currentTasks = this.activeAssignments.get(agentId) || [];
    const updatedTasks = currentTasks.filter(id => id !== task.id);
    this.activeAssignments.set(agentId, updatedTasks);

    agent.status = updatedTasks.length > 0 ? 'busy' : 'idle';

    // Persist changes
    await this.database.store(agentId, agent, 'agents');
  }

  /**
   * Monitor all agents
   */
  async monitor(): Promise<Metrics> {
    const agentMetrics: AgentMetrics[] = Array.from(this.agents.values()).map(agent => ({
      agentId: agent.id,
      type: agent.type,
      performance: agent.performance!,
      status: agent.status
    }));

    // Calculate system metrics
    const totalMemory = agentMetrics.reduce((sum, m) => sum + m.performance.resourceUtilization.memory, 0);
    const totalCpu = agentMetrics.reduce((sum, m) => sum + m.performance.resourceUtilization.cpu, 0);
    const activeConnections = Array.from(this.agents.values()).reduce((sum, agent) => sum + (agent.connections?.length || 0), 0);

    const systemMetrics = {
      uptime: Date.now() - (this.getOldestAgent()?.metadata.spawnedAt ? new Date(this.getOldestAgent()!.metadata.spawnedAt).getTime() : Date.now()),
      memoryUsage: totalMemory / agentMetrics.length || 0,
      cpuUsage: totalCpu / agentMetrics.length || 0,
      networkLatency: Math.random() * 10 + 5, // Simulated
      activeConnections
    };

    // Calculate performance metrics
    const totalTasks = agentMetrics.reduce((sum, m) => sum + m.performance.tasksCompleted, 0);
    const avgSuccessRate = agentMetrics.reduce((sum, m) => sum + m.performance.successRate, 0) / agentMetrics.length || 0;
    const avgResponseTime = agentMetrics.reduce((sum, m) => sum + m.performance.averageResponseTime, 0) / agentMetrics.length || 0;

    const performanceMetrics = {
      throughput: totalTasks / (systemMetrics.uptime / 1000 / 60) || 0, // tasks per minute
      latency: avgResponseTime,
      errorRate: 1 - avgSuccessRate,
      bottlenecks: this.identifyBottlenecks(agentMetrics)
    };

    return {
      agents: agentMetrics,
      system: systemMetrics,
      performance: performanceMetrics
    };
  }

  /**
   * Identify performance bottlenecks
   */
  private identifyBottlenecks(agentMetrics: AgentMetrics[]): string[] {
    const bottlenecks: string[] = [];

    // High CPU usage
    const highCpuAgents = agentMetrics.filter(m => m.performance.resourceUtilization.cpu > 80);
    if (highCpuAgents.length > 0) {
      bottlenecks.push(`High CPU usage: ${highCpuAgents.map(a => a.agentId).join(', ')}`);
    }

    // High memory usage
    const highMemoryAgents = agentMetrics.filter(m => m.performance.resourceUtilization.memory > 80);
    if (highMemoryAgents.length > 0) {
      bottlenecks.push(`High memory usage: ${highMemoryAgents.map(a => a.agentId).join(', ')}`);
    }

    // Low success rate
    const lowSuccessAgents = agentMetrics.filter(m => m.performance.successRate < 0.8);
    if (lowSuccessAgents.length > 0) {
      bottlenecks.push(`Low success rate: ${lowSuccessAgents.map(a => a.agentId).join(', ')}`);
    }

    // High response time
    const slowAgents = agentMetrics.filter(m => m.performance.averageResponseTime > 5000);
    if (slowAgents.length > 0) {
      bottlenecks.push(`Slow response time: ${slowAgents.map(a => a.agentId).join(', ')}`);
    }

    return bottlenecks;
  }

  /**
   * Shutdown agent
   */
  async shutdown(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Cancel active tasks
    const activeTasks = this.activeAssignments.get(agentId) || [];
    for (const taskId of activeTasks) {
      await this.database.delete(taskId, 'tasks');
    }

    // Remove agent
    this.agents.delete(agentId);
    this.activeAssignments.delete(agentId);
    await this.database.delete(agentId, 'agents');
  }

  /**
   * Get active agents
   */
  async getActiveAgents(): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter(agent => agent.status !== 'offline');
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: AgentType): Agent[] {
    return Array.from(this.agents.values()).filter(agent => agent.type === type);
  }

  /**
   * Get agent count
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * Get oldest agent (for uptime calculation)
   */
  private getOldestAgent(): Agent | undefined {
    let oldest: Agent | undefined;
    let oldestTime = Date.now();

    for (const agent of this.agents.values()) {
      const spawnTime = new Date(agent.metadata.spawnedAt).getTime();
      if (spawnTime < oldestTime) {
        oldestTime = spawnTime;
        oldest = agent;
      }
    }

    return oldest;
  }
}