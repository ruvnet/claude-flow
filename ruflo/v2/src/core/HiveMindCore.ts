/**
 * HiveMindCore - Collective intelligence coordination
 * Implements the Queen-Worker pattern for distributed AI coordination
 */

import { IDatabaseProvider, IHiveMindQueen, Objective, Strategy, Task, Assignment, QueenMetrics, Feedback, Agent } from '../types/interfaces.js';
import { AgentRegistry } from './AgentRegistry.js';
import { ConsensusEngine } from './ConsensusEngine.js';
import { MetricsCollector } from './MetricsCollector.js';
import { nanoid } from 'nanoid';

export interface WorkerPool {
  id: string;
  specialization: string;
  agents: Agent[];
  capacity: number;
  utilization: number;
  performance: {
    tasksCompleted: number;
    averageQuality: number;
    successRate: number;
  };
}

export interface HiveMindConfig {
  maxWorkerPools: number;
  queenEnabled: boolean;
  adaptationRate: number;
  consensusThreshold: number;
  specializations: string[];
}

export class HiveMindCore {
  private queen: QueenManager;
  private workerPools: Map<string, WorkerPool> = new Map();
  private objectives: Map<string, Objective> = new Map();
  private strategies: Map<string, Strategy> = new Map();
  private assignments: Map<string, Assignment> = new Map();
  private config: HiveMindConfig;

  constructor(
    private database: IDatabaseProvider,
    private agentRegistry: AgentRegistry,
    private consensusEngine: ConsensusEngine,
    private metricsCollector: MetricsCollector,
    config: Partial<HiveMindConfig> = {}
  ) {
    this.config = {
      maxWorkerPools: 5,
      queenEnabled: true,
      adaptationRate: 0.1,
      consensusThreshold: 0.7,
      specializations: ['research', 'development', 'testing', 'optimization', 'coordination'],
      ...config
    };

    this.queen = new QueenManager(
      this.database,
      this.agentRegistry,
      this.consensusEngine,
      this.metricsCollector
    );
  }

  /**
   * Initialize the Hive Mind system
   */
  async initialize(): Promise<void> {
    // Initialize Queen
    if (this.config.queenEnabled) {
      await this.queen.initialize();
    }

    // Create initial worker pools
    await this.createInitialWorkerPools();

    // Load existing objectives and strategies
    await this.loadPersistedState();

    console.log('🧠 Hive Mind Core initialized with collective intelligence capabilities');
  }

  /**
   * Create initial worker pools based on specializations
   */
  private async createInitialWorkerPools(): Promise<void> {
    for (const specialization of this.config.specializations) {
      const pool: WorkerPool = {
        id: nanoid(),
        specialization,
        agents: [],
        capacity: 5, // Default capacity
        utilization: 0,
        performance: {
          tasksCompleted: 0,
          averageQuality: 0.8,
          successRate: 1.0
        }
      };

      this.workerPools.set(pool.id, pool);
      await this.database.store(`worker-pool:${pool.id}`, pool, 'hive-mind');
    }
  }

  /**
   * Load persisted objectives and strategies
   */
  private async loadPersistedState(): Promise<void> {
    try {
      const objectiveKeys = await this.database.list('hive-mind');
      const objectiveItems = objectiveKeys.filter(key => key.startsWith('objective:'));

      for (const key of objectiveItems) {
        const objective = await this.database.retrieve(key, 'hive-mind');
        if (objective) {
          this.objectives.set(objective.id, objective);
        }
      }
    } catch (error) {
      console.warn('Failed to load persisted hive mind state:', error);
    }
  }

  /**
   * Set a new objective for the hive mind
   */
  async setObjective(objective: Omit<Objective, 'id'>): Promise<string> {
    const fullObjective: Objective = {
      ...objective,
      id: nanoid()
    };

    this.objectives.set(fullObjective.id, fullObjective);
    await this.database.store(`objective:${fullObjective.id}`, fullObjective, 'hive-mind');

    // Have the Queen strategize if enabled
    if (this.config.queenEnabled) {
      const strategy = await this.queen.strategize(fullObjective);
      this.strategies.set(fullObjective.id, strategy);
      await this.database.store(`strategy:${fullObjective.id}`, strategy, 'hive-mind');
    }

    return fullObjective.id;
  }

  /**
   * Execute an objective using collective intelligence
   */
  async executeObjective(objectiveId: string): Promise<{
    success: boolean;
    assignments: Assignment[];
    results: any[];
    metrics: any;
  }> {
    const objective = this.objectives.get(objectiveId);
    if (!objective) {
      throw new Error(`Objective ${objectiveId} not found`);
    }

    const strategy = this.strategies.get(objectiveId);
    if (!strategy) {
      throw new Error(`No strategy found for objective ${objectiveId}`);
    }

    // Extract tasks from strategy phases
    const allTasks: Task[] = [];
    strategy.phases.forEach(phase => {
      allTasks.push(...phase.tasks);
    });

    // Delegate tasks to worker pools
    const assignments = await this.delegateTasks(allTasks);

    // Execute assignments in parallel (with dependency management)
    const results = await this.executeAssignments(assignments);

    // Collect metrics
    const metrics = await this.collectExecutionMetrics(objectiveId, assignments, results);

    return {
      success: results.every(r => r.success),
      assignments,
      results,
      metrics
    };
  }

  /**
   * Delegate tasks to appropriate worker pools
   */
  private async delegateTasks(tasks: Task[]): Promise<Assignment[]> {
    const assignments: Assignment[] = [];

    for (const task of tasks) {
      // Find best worker pool for this task
      const bestPool = this.findBestWorkerPool(task);
      if (!bestPool) {
        console.warn(`No suitable worker pool found for task ${task.id}`);
        continue;
      }

      // Find best agent in the pool
      const bestAgent = await this.findBestAgentInPool(bestPool, task);
      if (!bestAgent) {
        console.warn(`No suitable agent found in pool ${bestPool.id} for task ${task.id}`);
        continue;
      }

      const assignment: Assignment = {
        agentId: bestAgent.id,
        task,
        deadline: task.deadline || new Date(Date.now() + 3600000), // 1 hour default
        resources: {
          memory: 256,
          cpu: 1,
          storage: 100,
          network: 10
        }
      };

      assignments.push(assignment);
      this.assignments.set(task.id, assignment);

      // Update pool utilization
      bestPool.utilization += 1;
    }

    return assignments;
  }

  /**
   * Find the best worker pool for a task
   */
  private findBestWorkerPool(task: Task): WorkerPool | null {
    let bestPool: WorkerPool | null = null;
    let bestScore = -1;

    for (const pool of this.workerPools.values()) {
      // Check if pool can handle the task's capabilities
      const canHandle = task.requiredCapabilities.some(capability =>
        capability.toLowerCase().includes(pool.specialization.toLowerCase()) ||
        pool.specialization.toLowerCase().includes(capability.toLowerCase())
      );

      if (!canHandle) continue;

      // Score based on performance, capacity, and utilization
      let score = pool.performance.successRate * 40;
      score += pool.performance.averageQuality * 30;
      score += Math.max(0, (pool.capacity - pool.utilization) / pool.capacity) * 30;

      if (score > bestScore) {
        bestScore = score;
        bestPool = pool;
      }
    }

    return bestPool;
  }

  /**
   * Find the best agent in a worker pool for a task
   */
  private async findBestAgentInPool(pool: WorkerPool, task: Task): Promise<Agent | null> {
    if (pool.agents.length === 0) {
      // Spawn a new agent for this pool
      const agent = await this.agentRegistry.spawn(
        this.getAgentTypeForSpecialization(pool.specialization),
        {
          capabilities: task.requiredCapabilities,
          metadata: { workerPoolId: pool.id, specialization: pool.specialization }
        }
      );

      pool.agents.push(agent);
      await this.database.store(`worker-pool:${pool.id}`, pool, 'hive-mind');
      return agent;
    }

    // Find best existing agent
    let bestAgent: Agent | null = null;
    let bestScore = -1;

    for (const agent of pool.agents) {
      if (agent.status !== 'idle' && agent.status !== 'active') continue;

      // Score based on capability match and performance
      const capabilityMatch = task.requiredCapabilities.filter(cap =>
        agent.capabilities.includes(cap)
      ).length / task.requiredCapabilities.length;

      const performanceScore = agent.performance?.successRate || 0.5;

      const score = capabilityMatch * 60 + performanceScore * 40;

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestAgent;
  }

  /**
   * Get appropriate agent type for specialization
   */
  private getAgentTypeForSpecialization(specialization: string): any {
    const typeMap: Record<string, string> = {
      research: 'researcher',
      development: 'coder',
      testing: 'tester',
      optimization: 'optimizer',
      coordination: 'coordinator'
    };

    return typeMap[specialization] || 'researcher';
  }

  /**
   * Execute assignments
   */
  private async executeAssignments(assignments: Assignment[]): Promise<any[]> {
    const results: any[] = [];

    // Group assignments by dependencies
    const dependencyGroups = this.groupByDependencies(assignments);

    // Execute groups in order
    for (const group of dependencyGroups) {
      const groupResults = await Promise.all(
        group.map(async assignment => {
          try {
            return await this.agentRegistry.coordinate(assignment.task);
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : String(error),
              assignment
            };
          }
        })
      );

      results.push(...groupResults);
    }

    return results;
  }

  /**
   * Group assignments by dependencies
   */
  private groupByDependencies(assignments: Assignment[]): Assignment[][] {
    // Simplified dependency grouping - in production, this would be more sophisticated
    const groups: Assignment[][] = [];
    const remaining = [...assignments];

    while (remaining.length > 0) {
      const currentGroup = remaining.filter(assignment =>
        !assignment.task.dependencies?.some(dep =>
          remaining.some(other => other.task.id === dep)
        )
      );

      if (currentGroup.length === 0) {
        // Break circular dependencies by taking first item
        currentGroup.push(remaining[0]);
      }

      groups.push(currentGroup);
      remaining.splice(0, currentGroup.length);
    }

    return groups;
  }

  /**
   * Collect execution metrics
   */
  private async collectExecutionMetrics(
    objectiveId: string,
    assignments: Assignment[],
    results: any[]
  ): Promise<any> {
    const successCount = results.filter(r => r.success).length;
    const successRate = successCount / results.length;

    const totalTime = results.reduce((sum, r) => sum + (r.metadata?.executionTime || 0), 0);
    const averageTime = totalTime / results.length;

    const metrics = {
      objectiveId,
      totalTasks: assignments.length,
      successfulTasks: successCount,
      successRate,
      averageExecutionTime: averageTime,
      workerPoolUtilization: this.calculatePoolUtilization(),
      timestamp: new Date().toISOString()
    };

    await this.metricsCollector.recordSystemMetrics({
      cpuUsage: 50 + Math.random() * 30, // Simulated
      memoryUsage: 60 + Math.random() * 20,
      diskUsage: 30 + Math.random() * 10,
      networkLatency: 10 + Math.random() * 20,
      activeConnections: assignments.length
    });

    return metrics;
  }

  /**
   * Calculate worker pool utilization
   */
  private calculatePoolUtilization(): Record<string, number> {
    const utilization: Record<string, number> = {};

    for (const [poolId, pool] of this.workerPools) {
      utilization[pool.specialization] = pool.utilization / pool.capacity;
    }

    return utilization;
  }

  /**
   * Adapt hive mind based on feedback
   */
  async adapt(feedback: Feedback[]): Promise<void> {
    if (this.config.queenEnabled) {
      await this.queen.adapt(feedback);
    }

    // Adapt worker pools based on performance
    for (const pool of this.workerPools.values()) {
      const poolFeedback = feedback.filter(f =>
        pool.agents.some(agent => agent.id === f.source)
      );

      if (poolFeedback.length > 0) {
        const avgRating = poolFeedback.reduce((sum, f) => sum + f.rating, 0) / poolFeedback.length;

        // Adjust pool performance metrics
        const alpha = this.config.adaptationRate;
        pool.performance.averageQuality = pool.performance.averageQuality * (1 - alpha) + (avgRating / 5) * alpha;

        await this.database.store(`worker-pool:${pool.id}`, pool, 'hive-mind');
      }
    }
  }

  /**
   * Get hive mind status
   */
  async getStatus(): Promise<{
    queen: any;
    workerPools: WorkerPool[];
    activeObjectives: number;
    totalAssignments: number;
    overallPerformance: number;
  }> {
    const queenMetrics = this.config.queenEnabled ? await this.queen.monitor() : null;

    const overallPerformance = Array.from(this.workerPools.values())
      .reduce((sum, pool) => sum + pool.performance.averageQuality, 0) / this.workerPools.size;

    return {
      queen: queenMetrics,
      workerPools: Array.from(this.workerPools.values()),
      activeObjectives: this.objectives.size,
      totalAssignments: this.assignments.size,
      overallPerformance
    };
  }

  /**
   * Get worker pool by specialization
   */
  getWorkerPoolBySpecialization(specialization: string): WorkerPool | undefined {
    return Array.from(this.workerPools.values())
      .find(pool => pool.specialization === specialization);
  }

  /**
   * Scale worker pool
   */
  async scaleWorkerPool(poolId: string, newCapacity: number): Promise<void> {
    const pool = this.workerPools.get(poolId);
    if (!pool) return;

    pool.capacity = newCapacity;
    await this.database.store(`worker-pool:${poolId}`, pool, 'hive-mind');
  }
}

/**
 * Queen Manager - Implements the strategic intelligence layer
 */
class QueenManager implements IHiveMindQueen {
  private strategies: Map<string, Strategy> = new Map();
  private metrics: QueenMetrics = {
    strategiesCreated: 0,
    tasksAssigned: 0,
    successRate: 1.0,
    adaptationCount: 0,
    performanceScore: 100
  };

  constructor(
    private database: IDatabaseProvider,
    private agentRegistry: AgentRegistry,
    private consensusEngine: ConsensusEngine,
    private metricsCollector: MetricsCollector
  ) {}

  async initialize(): Promise<void> {
    console.log('👑 Queen Manager initialized - Strategic intelligence online');
  }

  async strategize(objective: Objective): Promise<Strategy> {
    // Analyze objective complexity and requirements
    const complexity = this.analyzeComplexity(objective);
    const riskLevel = this.assessRisk(objective);

    // Create strategy phases
    const phases = this.createStrategyPhases(objective, complexity);

    // Estimate resource requirements
    const resourceAllocation = this.estimateResources(objective, phases);

    // Assess risks
    const riskAssessment = this.identifyRisks(objective, riskLevel);

    const strategy: Strategy = {
      approach: this.selectApproach(complexity, riskLevel),
      phases,
      resourceAllocation,
      expectedOutcome: `Complete objective: ${objective.description}`,
      riskAssessment
    };

    this.strategies.set(objective.id, strategy);
    this.metrics.strategiesCreated++;

    return strategy;
  }

  async delegate(tasks: Task[]): Promise<Assignment[]> {
    // This would be handled by the main HiveMindCore
    // Queen focuses on high-level strategy
    this.metrics.tasksAssigned += tasks.length;
    return [];
  }

  async monitor(): Promise<QueenMetrics> {
    // Update performance score based on recent strategies
    const recentStrategies = Array.from(this.strategies.values()).slice(-10);
    if (recentStrategies.length > 0) {
      // Simulate performance based on strategy complexity and success
      this.metrics.performanceScore = Math.min(100, 70 + Math.random() * 30);
    }

    return { ...this.metrics };
  }

  async adapt(feedback: Feedback[]): Promise<void> {
    // Adapt strategy creation based on feedback
    const avgRating = feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length;

    // Update success rate
    const alpha = 0.1;
    this.metrics.successRate = this.metrics.successRate * (1 - alpha) + (avgRating / 5) * alpha;
    this.metrics.adaptationCount++;
  }

  private analyzeComplexity(objective: Objective): 'low' | 'medium' | 'high' {
    const factors = [
      objective.goals.length,
      objective.constraints.length,
      objective.priority === 'critical' ? 2 : 1
    ];

    const complexity = factors.reduce((sum, factor) => sum + factor, 0);

    if (complexity <= 3) return 'low';
    if (complexity <= 6) return 'medium';
    return 'high';
  }

  private assessRisk(objective: Objective): 'low' | 'medium' | 'high' {
    // Assess risk based on constraints and deadline
    const hasDeadline = !!objective.deadline;
    const constraintCount = objective.constraints.length;
    const isCritical = objective.priority === 'critical';

    if (isCritical || constraintCount > 3 || (hasDeadline && new Date(objective.deadline!) < new Date(Date.now() + 86400000))) {
      return 'high';
    }

    if (constraintCount > 1 || hasDeadline) {
      return 'medium';
    }

    return 'low';
  }

  private createStrategyPhases(objective: Objective, complexity: string): any[] {
    const basePhases = [
      { name: 'Analysis', description: 'Analyze requirements and constraints' },
      { name: 'Planning', description: 'Create detailed execution plan' },
      { name: 'Execution', description: 'Implement the solution' },
      { name: 'Validation', description: 'Validate outcomes against goals' }
    ];

    if (complexity === 'high') {
      basePhases.splice(2, 0, { name: 'Prototyping', description: 'Create and test prototypes' });
    }

    return basePhases.map((phase, index) => ({
      ...phase,
      tasks: this.createTasksForPhase(phase, objective),
      dependencies: index > 0 ? [basePhases[index - 1].name] : [],
      duration: complexity === 'high' ? 3600 : complexity === 'medium' ? 1800 : 900 // seconds
    }));
  }

  private createTasksForPhase(phase: any, objective: Objective): Task[] {
    // Generate tasks based on phase and objective
    return [{
      id: nanoid(),
      type: phase.name.toLowerCase(),
      description: `${phase.description} for objective: ${objective.description}`,
      priority: objective.priority,
      requiredCapabilities: this.inferCapabilities(phase.name),
      deadline: objective.deadline
    }];
  }

  private inferCapabilities(phaseName: string): string[] {
    const capabilityMap: Record<string, string[]> = {
      'Analysis': ['research', 'analysis'],
      'Planning': ['planning', 'coordination'],
      'Prototyping': ['programming', 'testing'],
      'Execution': ['programming', 'implementation'],
      'Validation': ['testing', 'quality-assurance']
    };

    return capabilityMap[phaseName] || ['general'];
  }

  private selectApproach(complexity: string, riskLevel: string): string {
    if (complexity === 'high' && riskLevel === 'high') {
      return 'Incremental development with continuous validation';
    }

    if (complexity === 'high') {
      return 'Phased implementation with parallel workstreams';
    }

    if (riskLevel === 'high') {
      return 'Risk-first approach with contingency planning';
    }

    return 'Standard agile approach with regular checkpoints';
  }

  private estimateResources(objective: Objective, phases: any[]): any {
    return {
      memory: phases.length * 512, // MB
      cpu: phases.length * 2, // cores
      storage: phases.length * 100, // MB
      network: 10 // Mbps
    };
  }

  private identifyRisks(objective: Objective, riskLevel: string): any[] {
    const baseRisks = [
      {
        description: 'Requirement changes during execution',
        probability: 0.3,
        impact: 0.6,
        mitigation: 'Regular stakeholder communication and flexible planning'
      }
    ];

    if (riskLevel === 'high') {
      baseRisks.push({
        description: 'Resource constraints affecting timeline',
        probability: 0.5,
        impact: 0.8,
        mitigation: 'Resource monitoring and contingency planning'
      });
    }

    return baseRisks;
  }
}