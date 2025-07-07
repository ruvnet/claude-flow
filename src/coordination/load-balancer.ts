import { getErrorMessage } from '../utils/error-handler.js';
/**
 * Advanced load balancing and work stealing implementation
 */

import { EventEmitter } from 'node:events';
import type { ILogger } from '../core/logger.js';
import type { IEventBus } from '../core/event-bus.js';
import type { 
  AgentId, 
  AgentState, 
  TaskDefinition, 
  TaskId,
  LoadBalancingStrategy 
} from '../swarm/types.js';
import { WorkStealingCoordinator } from './work-stealing.js';

// Event data interfaces for type safety
interface AgentLoadUpdateData {
  agentId: string;
  load: Partial<AgentLoad>;
}

interface TaskQueueData {
  agentId: string;
  task: TaskDefinition;
}

interface WorkStealingRequestData {
  sourceAgent: string;
  targetAgent: string;
  taskCount: number;
}

interface AgentPerformanceData {
  agentId: string;
  metrics: any;
}

export interface LoadBalancerConfig {
  strategy: LoadBalancingStrategy;
  enableWorkStealing: boolean;
  stealThreshold: number;
  maxStealBatch: number;
  rebalanceInterval: number;
  loadSamplingInterval: number;
  affinityWeight: number;
  performanceWeight: number;
  loadWeight: number;
  latencyWeight: number;
  queueDepthThreshold: number;
  adaptiveThresholds: boolean;
  predictiveEnabled: boolean;
  debugMode: boolean;
}

export interface AgentLoad {
  agentId: string;
  queueDepth: number;
  cpuUsage: number;
  memoryUsage: number;
  taskCount: number;
  averageResponseTime: number;
  throughput: number;
  lastUpdated: Date;
  capacity: number;
  utilization: number;
  efficiency: number;
  affinityScore: number;
}

export interface LoadBalancingDecision {
  selectedAgent: AgentId;
  reason: string;
  confidence: number;
  alternatives: Array<{
    agent: AgentId;
    score: number;
    reason: string;
  }>;
  loadBefore: Record<string, number>;
  predictedLoadAfter: Record<string, number>;
  timestamp: Date;
}

export interface WorkStealingOperation {
  id: string;
  sourceAgent: AgentId;
  targetAgent: AgentId;
  tasks: TaskId[];
  reason: string;
  status: 'planned' | 'executing' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  metrics: {
    tasksStolen: number;
    loadReduction: number;
    latencyImprovement: number;
  };
}

export interface LoadPrediction {
  agentId: string;
  currentLoad: number;
  predictedLoad: number;
  confidence: number;
  timeHorizon: number;
  factors: Record<string, number>;
}

/**
 * Advanced load balancing system with work stealing and predictive capabilities
 */
export class LoadBalancer extends EventEmitter {
  private logger: ILogger;
  private eventBus: IEventBus;
  private config: LoadBalancerConfig;
  private workStealer: WorkStealingCoordinator;

  // Load tracking
  private agentLoads = new Map<string, AgentLoad>();
  private loadHistory = new Map<string, Array<{ timestamp: Date; load: number }>>();
  private taskQueues = new Map<string, TaskDefinition[]>();

  // Monitoring and statistics
  private loadSamplingInterval?: NodeJS.Timeout;
  private rebalanceInterval?: NodeJS.Timeout;
  private decisions: LoadBalancingDecision[] = [];
  private stealOperations = new Map<string, WorkStealingOperation>();

  // Predictive modeling
  private loadPredictors = new Map<string, LoadPredictor>();
  private performanceBaselines = new Map<string, PerformanceBaseline>();

  constructor(
    config: Partial<LoadBalancerConfig>,
    logger: ILogger,
    eventBus: IEventBus
  ) {
    super();
    this.logger = logger;
    this.eventBus = eventBus;

    this.config = {
      strategy: 'hybrid',
      enableWorkStealing: true,
      stealThreshold: 3,
      maxStealBatch: 5,
      rebalanceInterval: 10000,
      loadSamplingInterval: 5000,
      affinityWeight: 0.3,
      performanceWeight: 0.3,
      loadWeight: 0.25,
      latencyWeight: 0.15,
      queueDepthThreshold: 10,
      adaptiveThresholds: true,
      predictiveEnabled: true,
      debugMode: false,
      ...config
    };

    this.workStealer = new WorkStealingCoordinator(
      {
        enabled: this.config.enableWorkStealing,
        stealThreshold: this.config.stealThreshold,
        maxStealBatch: this.config.maxStealBatch,
        stealInterval: this.config.rebalanceInterval
      },
      this.eventBus,
      this.logger
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.eventBus.on('agent:load-update', (data: AgentLoadUpdateData) => {
      this.updateAgentLoad(data.agentId, data.load);
    });

    this.eventBus.on('task:queued', (data: TaskQueueData) => {
      this.updateTaskQueue(data.agentId, data.task, 'add');
    });

    this.eventBus.on('task:started', (data: TaskQueueData) => {
      this.updateTaskQueue(data.agentId, data.task, 'remove');
    });

    this.eventBus.on('workstealing:request', (data: WorkStealingRequestData) => {
      this.executeWorkStealing(data.sourceAgent, data.targetAgent, data.taskCount);
    });

    this.eventBus.on('agent:performance-update', (data: AgentPerformanceData) => {
      this.updatePerformanceBaseline(data.agentId, data.metrics);
    });
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing load balancer', {
      strategy: this.config.strategy,
      workStealing: this.config.enableWorkStealing,
      predictive: this.config.predictiveEnabled
    });

    // Initialize work stealer
    await this.workStealer.initialize();

    // Start monitoring
    this.startLoadSampling();
    this.startRebalancing();

    this.emit('loadbalancer:initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down load balancer');

    // Stop monitoring
    if (this.loadSamplingInterval) clearInterval(this.loadSamplingInterval);
    if (this.rebalanceInterval) clearInterval(this.rebalanceInterval);

    // Shutdown work stealer
    await this.workStealer.shutdown();

    this.emit('loadbalancer:shutdown');
  }

  // === AGENT SELECTION ===

  async selectAgent(
    task: TaskDefinition,
    availableAgents: AgentState[],
    constraints?: {
      excludeAgents?: AgentId[];
      preferredAgents?: AgentId[];
      maxLoad?: number;
      requireCapabilities?: string[];
    }
  ): Promise<LoadBalancingDecision> {
    const startTime = Date.now();

    try {
      // Filter agents based on constraints
      let candidates = this.filterAgentsByConstraints(availableAgents, task, constraints);
      
      if (candidates.length === 0) {
        throw new Error('No suitable agents available for task');
      }

      // Apply selection strategy
      const decision = await this.applySelectionStrategy(task, candidates);

      // Record decision
      this.decisions.push(decision);
      
      // Keep only last 1000 decisions
      if (this.decisions.length > 1000) {
        this.decisions.shift();
      }

      const selectionTime = Date.now() - startTime;
      this.logger.debug('Agent selected', {
        taskId: task.id.id,
        selectedAgent: decision.selectedAgent.id,
        reason: decision.reason,
        confidence: decision.confidence,
        selectionTime
      });

      this.emit('agent:selected', { task, decision, selectionTime });

      return decision;

    } catch (error) {
      this.logger.error('Agent selection failed', { taskId: task.id.id, error });
      throw error;
    }
  }

  private filterAgentsByConstraints(
    agents: AgentState[],
    task: TaskDefinition,
    constraints?: {
      excludeAgents?: AgentId[];
      preferredAgents?: AgentId[];
      maxLoad?: number;
      requireCapabilities?: string[];
    }
  ): AgentState[] {
    return agents.filter(agent => {
      // Exclude specific agents
      if (constraints?.excludeAgents?.some(excluded => excluded.id === agent.id.id)) {
        return false;
      }

      // Check maximum load
      const load = this.agentLoads.get(agent.id.id);
      if (constraints?.maxLoad && load && load.utilization > constraints.maxLoad) {
        return false;
      }

      // Check required capabilities
      if (constraints?.requireCapabilities) {
        const hasAllCapabilities = constraints.requireCapabilities.every(cap =>
          agent.capabilities.domains.includes(cap) ||
          agent.capabilities.tools.includes(cap) ||
          agent.capabilities.languages.includes(cap)
        );
        if (!hasAllCapabilities) {
          return false;
        }
      }

      // Check task type compatibility
      if (!this.isAgentCompatible(agent, task)) {
        return false;
      }

      return true;
    });
  }

  private async applySelectionStrategy(
    task: TaskDefinition,
    candidates: AgentState[]
  ): Promise<LoadBalancingDecision> {
    const scores = new Map<string, number>();
    const reasons = new Map<string, string>();
    const loadBefore: Record<string, number> = {};
    const predictedLoadAfter: Record<string, number> = {};

    // Calculate scores for each candidate
    for (const agent of candidates) {
      const agentId = agent.id.id;
      const load = this.agentLoads.get(agentId) || this.createDefaultLoad(agentId);
      
      loadBefore[agentId] = load.utilization;

      let score = 0;
      const scoreComponents: string[] = [];

      switch (this.config.strategy) {
        case 'load-based':
          score = this.calculateLoadScore(agent, load);
          scoreComponents.push(`load:${score.toFixed(2)}`);
          break;

        case 'performance-based':
          score = this.calculatePerformanceScore(agent, load);
          scoreComponents.push(`perf:${score.toFixed(2)}`);
          break;

        case 'capability-based':
          score = this.calculateCapabilityScore(agent, task);
          scoreComponents.push(`cap:${score.toFixed(2)}`);
          break;

        case 'affinity-based':
          score = this.calculateAffinityScore(agent, task);
          scoreComponents.push(`affinity:${score.toFixed(2)}`);
          break;

        case 'cost-based':
          score = this.calculateCostScore(agent, task);
          scoreComponents.push(`cost:${score.toFixed(2)}`);
          break;

        case 'hybrid':
          score = this.calculateHybridScore(agent, task, load);
          scoreComponents.push(`hybrid:${score.toFixed(2)}`);
          break;

        default:
          score = Math.random(); // Random fallback
          scoreComponents.push(`random:${score.toFixed(2)}`);
      }

      // Apply predictive modeling if enabled
      if (this.config.predictiveEnabled) {
        const prediction = this.predictLoad(agentId, task);
        const predictiveScore = this.calculatePredictiveScore(prediction);
        score = score * 0.7 + predictiveScore * 0.3;
        predictedLoadAfter[agentId] = prediction.predictedLoad;
        scoreComponents.push(`pred:${predictiveScore.toFixed(2)}`);
      } else {
        predictedLoadAfter[agentId] = load.utilization + 0.1; // Simple estimate
      }

      scores.set(agentId, score);
      reasons.set(agentId, scoreComponents.join(','));
    }

    // Select agent with highest score
    const sortedCandidates = candidates.sort((a, b) => {
      const scoreA = scores.get(a.id.id) || 0;
      const scoreB = scores.get(b.id.id) || 0;
      return scoreB - scoreA;
    });

    const selectedAgent = sortedCandidates[0];
    const selectedScore = scores.get(selectedAgent.id.id) || 0;
    const selectedReason = reasons.get(selectedAgent.id.id) || 'unknown';

    // Build alternatives list
    const alternatives = sortedCandidates.slice(1, 4).map(agent => ({
      agent: agent.id,
      score: scores.get(agent.id.id) || 0,
      reason: reasons.get(agent.id.id) || 'unknown'
    }));

    // Calculate confidence based on score gap
    const secondBestScore = alternatives.length > 0 ? alternatives[0].score : 0;
    const confidence = Math.min(1, (selectedScore - secondBestScore) + 0.5);

    return {
      selectedAgent: selectedAgent.id,
      reason: selectedReason,
      confidence,
      alternatives,
      loadBefore,
      predictedLoadAfter,
      timestamp: new Date()
    };
  }

  // === SCORING ALGORITHMS ===

  private calculateLoadScore(agent: AgentState, load: AgentLoad): number {
    // Higher score for lower load (inverted)
    return 1 - load.utilization;
  }

  private calculatePerformanceScore(agent: AgentState, load: AgentLoad): number {
    const baseline = this.performanceBaselines.get(agent.id.id);
    if (!baseline) return 0.5;

    // Combine throughput, efficiency, and response time
    const throughputScore = Math.min(1, load.throughput / baseline.expectedThroughput);
    const efficiencyScore = load.efficiency;
    const responseScore = Math.min(1, baseline.expectedResponseTime / load.averageResponseTime);

    return (throughputScore + efficiencyScore + responseScore) / 3;
  }

  private calculateCapabilityScore(agent: AgentState, task: TaskDefinition): number {
    let score = 0;
    let totalChecks = 0;

    // Check language compatibility
    if (task.requirements.capabilities.includes('coding')) {
      const hasLanguage = agent.capabilities.languages.some(lang =>
        task.context.language === lang
      );
      score += hasLanguage ? 1 : 0;
      totalChecks++;
    }

    // Check framework compatibility
    if (task.context.framework) {
      const hasFramework = agent.capabilities.frameworks.includes(task.context.framework);
      score += hasFramework ? 1 : 0;
      totalChecks++;
    }

    // Check domain expertise
    const domainMatch = agent.capabilities.domains.some(domain =>
      task.type.includes(domain) || task.requirements.capabilities.includes(domain)
    );
    score += domainMatch ? 1 : 0;
    totalChecks++;

    // Check required tools
    const hasTools = task.requirements.tools.every(tool =>
      agent.capabilities.tools.includes(tool)
    );
    score += hasTools ? 1 : 0;
    totalChecks++;

    return totalChecks > 0 ? score / totalChecks : 0;
  }

  private calculateAffinityScore(agent: AgentState, task: TaskDefinition): number {
    const load = this.agentLoads.get(agent.id.id);
    if (!load) return 0;

    return load.affinityScore || 0.5;
  }

  private calculateCostScore(agent: AgentState, task: TaskDefinition): number {
    // Simple cost model - could be enhanced
    const baseCost = 1.0;
    const performanceFactor = agent.capabilities.speed;
    const reliabilityFactor = agent.capabilities.reliability;

    const cost = baseCost / (performanceFactor * reliabilityFactor);
    return Math.max(0, 1 - (cost / 2)); // Normalize and invert
  }

  private calculateHybridScore(agent: AgentState, task: TaskDefinition, load: AgentLoad): number {
    const loadScore = this.calculateLoadScore(agent, load);
    const performanceScore = this.calculatePerformanceScore(agent, load);
    const capabilityScore = this.calculateCapabilityScore(agent, task);
    const affinityScore = this.calculateAffinityScore(agent, task);

    return (
      loadScore * this.config.loadWeight +
      performanceScore * this.config.performanceWeight +
      capabilityScore * this.config.affinityWeight +
      affinityScore * this.config.latencyWeight
    );
  }

  private calculatePredictiveScore(prediction: LoadPrediction): number {
    // Higher score for lower predicted load
    const loadScore = 1 - prediction.predictedLoad;
    const confidenceBonus = prediction.confidence * 0.2;
    return Math.min(1, loadScore + confidenceBonus);
  }

  // === WORK STEALING ===

  private async executeWorkStealing(
    sourceAgentId: string,
    targetAgentId: string,
    taskCount: number
  ): Promise<void> {
    const operationId = `steal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const operation: WorkStealingOperation = {
      id: operationId,
      sourceAgent: { id: sourceAgentId, swarmId: 'default', type: 'coordinator', instance: 1 },
      targetAgent: { id: targetAgentId, swarmId: 'default', type: 'coordinator', instance: 1 },
      tasks: [],
      reason: 'load_imbalance',
      status: 'planned',
      startTime: new Date(),
      metrics: {
        tasksStolen: 0,
        loadReduction: 0,
        latencyImprovement: 0
      }
    };

    this.stealOperations.set(operationId, operation);

    try {
      operation.status = 'executing';

      // Get source queue
      const sourceQueue = this.taskQueues.get(sourceAgentId) || [];
      if (sourceQueue.length === 0) {
        throw new Error('Source agent has no tasks to steal');
      }

      // Select tasks to steal (lowest priority first)
      const tasksToSteal = sourceQueue
        .sort((a, b) => a.priority === b.priority ? 0 : (a.priority === 'low' ? -1 : 1))
        .slice(0, Math.min(taskCount, this.config.maxStealBatch));

      // Remove tasks from source
      for (const task of tasksToSteal) {
        this.updateTaskQueue(sourceAgentId, task, 'remove');
        this.updateTaskQueue(targetAgentId, task, 'add');
        operation.tasks.push(task.id);
      }

      // Update metrics
      operation.metrics.tasksStolen = tasksToSteal.length;
      operation.metrics.loadReduction = this.calculateLoadReduction(sourceAgentId, tasksToSteal.length);
      operation.status = 'completed';
      operation.endTime = new Date();

      this.logger.info('Work stealing completed', {
        operationId,
        sourceAgent: sourceAgentId,
        targetAgent: targetAgentId,
        tasksStolen: operation.metrics.tasksStolen
      });

      this.emit('workstealing:completed', { operation });

    } catch (error) {
      operation.status = 'failed';
      operation.endTime = new Date();
      
      this.logger.error('Work stealing failed', {
        operationId,
        sourceAgent: sourceAgentId,
        targetAgent: targetAgentId,
        error
      });

      this.emit('workstealing:failed', { operation, error });
    }
  }

  // === LOAD MONITORING ===

  private startLoadSampling(): void {
    this.loadSamplingInterval = setInterval(() => {
      this.sampleAgentLoads();
    }, this.config.loadSamplingInterval);

    this.logger.info('Started load sampling', { 
      interval: this.config.loadSamplingInterval 
    });
  }

  private startRebalancing(): void {
    this.rebalanceInterval = setInterval(() => {
      this.performRebalancing();
    }, this.config.rebalanceInterval);

    this.logger.info('Started rebalancing', { 
      interval: this.config.rebalanceInterval 
    });
  }

  private async sampleAgentLoads(): Promise<void> {
    // Sample current loads from all agents
    for (const [agentId, load] of Array.from(this.agentLoads.entries())) {
      // Update load history
      const history = this.loadHistory.get(agentId) || [];
      history.push({ timestamp: new Date(), load: load.utilization });
      
      // Keep only last 100 samples
      if (history.length > 100) {
        history.shift();
      }
      
      this.loadHistory.set(agentId, history);

      // Update predictive models
      if (this.config.predictiveEnabled) {
        this.updateLoadPredictor(agentId, load);
      }
    }
  }

  private async performRebalancing(): Promise<void> {
    if (!this.config.enableWorkStealing) return;

    try {
      // Find overloaded and underloaded agents
      const loads = Array.from(this.agentLoads.entries());
      const overloaded = loads.filter(([_, load]) => 
        load.utilization > 0.8 && load.queueDepth > this.config.queueDepthThreshold
      );
      const underloaded = loads.filter(([_, load]) => 
        load.utilization < 0.3 && load.queueDepth < 2
      );

      if (overloaded.length === 0 || underloaded.length === 0) {
        return; // No rebalancing needed
      }

      // Perform work stealing
      for (const [overloadedId, overloadedLoad] of overloaded) {
        // Find best underloaded target
        const target = underloaded
          .sort((a, b) => a[1].utilization - b[1].utilization)[0];
        
        if (target) {
          const [targetId] = target;
          const tasksToSteal = Math.min(
            Math.floor((overloadedLoad.queueDepth - targetId.length) / 2),
            this.config.maxStealBatch
          );

          if (tasksToSteal > 0) {
            await this.executeWorkStealing(overloadedId, targetId, tasksToSteal);
          }
        }
      }

    } catch (error) {
      this.logger.error('Rebalancing failed', error);
    }
  }

  // === PREDICTIVE MODELING ===

  private predictLoad(agentId: string, task: TaskDefinition): LoadPrediction {
    const predictor = this.loadPredictors.get(agentId);
    const currentLoad = this.agentLoads.get(agentId)?.utilization || 0;

    if (!predictor) {
      // Simple fallback prediction
      return {
        agentId,
        currentLoad,
        predictedLoad: Math.min(1, currentLoad + 0.1),
        confidence: 0.5,
        timeHorizon: 60000, // 1 minute
        factors: { task_complexity: 0.1 }
      };
    }

    return predictor.predict(task);
  }

  private updateLoadPredictor(agentId: string, load: AgentLoad): void {
    let predictor = this.loadPredictors.get(agentId);
    if (!predictor) {
      predictor = new LoadPredictor(agentId);
      this.loadPredictors.set(agentId, predictor);
    }

    predictor.update(load);
  }

  // === UTILITY METHODS ===

  private isAgentCompatible(agent: AgentState, task: TaskDefinition): boolean {
    // Check basic type compatibility
    const typeCompatible = this.checkTypeCompatibility(agent.type, task.type);
    if (!typeCompatible) return false;

    // Check capability requirements
    const hasRequiredCapabilities = task.requirements.capabilities.every(cap => {
      return agent.capabilities.domains.includes(cap) ||
             agent.capabilities.tools.includes(cap) ||
             agent.capabilities.languages.includes(cap);
    });

    return hasRequiredCapabilities;
  }

  private checkTypeCompatibility(agentType: string, taskType: string): boolean {
    const compatibilityMap: Record<string, string[]> = {
      'researcher': ['research', 'analysis', 'documentation'],
      'coder': ['coding', 'testing', 'integration', 'deployment'],
      'analyst': ['analysis', 'validation', 'review'],
      'reviewer': ['review', 'validation', 'documentation'],
      'coordinator': ['coordination', 'monitoring', 'management'],
      'tester': ['testing', 'validation', 'integration'],
      'specialist': ['custom', 'optimization', 'maintenance']
    };

    const compatibleTypes = compatibilityMap[agentType] || [];
    return compatibleTypes.some(type => taskType.includes(type));
  }

  private updateAgentLoad(agentId: string, loadData: Partial<AgentLoad>): void {
    const existing = this.agentLoads.get(agentId) || this.createDefaultLoad(agentId);
    const updated = { ...existing, ...loadData, lastUpdated: new Date() };
    
    // Recalculate utilization
    updated.utilization = this.calculateUtilization(updated);
    
    this.agentLoads.set(agentId, updated);
  }

  private updateTaskQueue(agentId: string, task: TaskDefinition, operation: 'add' | 'remove'): void {
    const queue = this.taskQueues.get(agentId) || [];
    
    if (operation === 'add') {
      queue.push(task);
    } else {
      const index = queue.findIndex(t => t.id.id === task.id.id);
      if (index >= 0) {
        queue.splice(index, 1);
      }
    }
    
    this.taskQueues.set(agentId, queue);

    // Update agent load
    this.updateAgentLoad(agentId, {
      queueDepth: queue.length,
      taskCount: queue.length
    });
  }

  private updatePerformanceBaseline(agentId: string, metrics: any): void {
    const baseline = this.performanceBaselines.get(agentId) || {
      expectedThroughput: 10,
      expectedResponseTime: 5000,
      expectedQuality: 0.8
    };

    // Update baseline with exponential moving average
    const alpha = 0.1;
    baseline.expectedThroughput = baseline.expectedThroughput * (1 - alpha) + metrics.throughput * alpha;
    baseline.expectedResponseTime = baseline.expectedResponseTime * (1 - alpha) + metrics.responseTime * alpha;

    this.performanceBaselines.set(agentId, baseline);
  }

  private calculateUtilization(load: AgentLoad): number {
    // Combine multiple factors to calculate overall utilization
    const queueFactor = Math.min(1, load.queueDepth / 10);
    const cpuFactor = load.cpuUsage / 100;
    const memoryFactor = load.memoryUsage / 100;
    const taskFactor = Math.min(1, load.taskCount / load.capacity);

    return (queueFactor + cpuFactor + memoryFactor + taskFactor) / 4;
  }

  private calculateLoadReduction(agentId: string, tasksRemoved: number): number {
    const load = this.agentLoads.get(agentId);
    if (!load) return 0;

    const oldUtilization = load.utilization;
    const newUtilization = this.calculateUtilization({
      ...load,
      queueDepth: load.queueDepth - tasksRemoved,
      taskCount: load.taskCount - tasksRemoved
    });

    return oldUtilization - newUtilization;
  }

  private createDefaultLoad(agentId: string): AgentLoad {
    return {
      agentId,
      queueDepth: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      taskCount: 0,
      averageResponseTime: 5000,
      throughput: 0,
      lastUpdated: new Date(),
      capacity: 10,
      utilization: 0,
      efficiency: 1.0,
      affinityScore: 0.5
    };
  }

  // === PUBLIC API ===

  getAgentLoad(agentId: string): AgentLoad | undefined {
    return this.agentLoads.get(agentId);
  }

  getAllLoads(): AgentLoad[] {
    return Array.from(this.agentLoads.values());
  }

  getRecentDecisions(limit: number = 10): LoadBalancingDecision[] {
    return this.decisions.slice(-limit);
  }

  getStealOperations(): WorkStealingOperation[] {
    return Array.from(this.stealOperations.values());
  }

  getLoadStatistics(): {
    totalAgents: number;
    averageUtilization: number;
    overloadedAgents: number;
    underloadedAgents: number;
    totalStealOperations: number;
    successfulSteals: number;
  } {
    const loads = Array.from(this.agentLoads.values());
    const avgUtilization = loads.reduce((sum, load) => sum + load.utilization, 0) / loads.length || 0;
    const overloaded = loads.filter(load => load.utilization > 0.8).length;
    const underloaded = loads.filter(load => load.utilization < 0.3).length;
    const successfulSteals = Array.from(this.stealOperations.values())
      .filter(op => op.status === 'completed').length;

    return {
      totalAgents: loads.length,
      averageUtilization: avgUtilization,
      overloadedAgents: overloaded,
      underloadedAgents: underloaded,
      totalStealOperations: this.stealOperations.size,
      successfulSteals
    };
  }

  // Force rebalance
  async forceRebalance(): Promise<void> {
    await this.performRebalancing();
  }
}

// === HELPER CLASSES ===

class LoadPredictor {
  private agentId: string;
  private history: Array<{ timestamp: Date; load: number }> = [];
  private model: SimpleLinearModel;

  constructor(agentId: string) {
    this.agentId = agentId;
    this.model = new SimpleLinearModel();
  }

  update(load: AgentLoad): void {
    this.history.push({ timestamp: new Date(), load: load.utilization });
    
    // Keep only last 50 samples
    if (this.history.length > 50) {
      this.history.shift();
    }

    // Update model if we have enough data
    if (this.history.length >= 10) {
      this.model.train(this.history);
    }
  }

  predict(task: TaskDefinition): LoadPrediction {
    const currentLoad = this.history.length > 0 ? 
      this.history[this.history.length - 1].load : 0;

    let predictedLoad = currentLoad;
    let confidence = 0.5;

    if (this.history.length >= 10) {
      const prediction = this.model.predict();
      predictedLoad = prediction.value;
      confidence = prediction.confidence;
    }

    // Adjust for task complexity
    const taskComplexity = this.estimateTaskComplexity(task);
    predictedLoad = Math.min(1, predictedLoad + taskComplexity * 0.1);

    return {
      agentId: this.agentId,
      currentLoad,
      predictedLoad,
      confidence,
      timeHorizon: 60000,
      factors: {
        task_complexity: taskComplexity,
        historical_trend: predictedLoad - currentLoad
      }
    };
  }

  private estimateTaskComplexity(task: TaskDefinition): number {
    // Simple complexity estimation
    let complexity = 0.5;

    if (task.requirements.estimatedDuration && task.requirements.estimatedDuration > 300000) {
      complexity += 0.3; // Long-running task
    }

    if (task.requirements.memoryRequired && task.requirements.memoryRequired > 512 * 1024 * 1024) {
      complexity += 0.2; // Memory-intensive
    }

    if (task.requirements.capabilities.length > 3) {
      complexity += 0.2; // Requires multiple capabilities
    }

    return Math.min(1, complexity);
  }
}

class SimpleLinearModel {
  private slope = 0;
  private intercept = 0;
  private r2 = 0;

  train(data: Array<{ timestamp: Date; load: number }>): void {
    if (data.length < 2) return;

    // Convert timestamps to relative time points
    const startTime = data[0].timestamp.getTime();
    const points = data.map((point, index) => ({
      x: index, // Use index as x for simplicity
      y: point.load
    }));

    // Calculate linear regression
    const n = points.length;
    const sumX = points.reduce((sum, p) => sum + p.x, 0);
    const sumY = points.reduce((sum, p) => sum + p.y, 0);
    const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
    const sumXX = points.reduce((sum, p) => sum + p.x * p.x, 0);

    this.slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    this.intercept = (sumY - this.slope * sumX) / n;

    // Calculate R²
    const meanY = sumY / n;
    const ssTotal = points.reduce((sum, p) => sum + Math.pow(p.y - meanY, 2), 0);
    const ssRes = points.reduce((sum, p) => {
      const predicted = this.slope * p.x + this.intercept;
      return sum + Math.pow(p.y - predicted, 2);
    }, 0);

    this.r2 = 1 - (ssRes / ssTotal);
  }

  predict(): { value: number; confidence: number } {
    // Predict next value (x = n)
    const nextValue = this.slope * 1 + this.intercept; // Predict 1 step ahead
    const confidence = Math.max(0, this.r2); // Use R² as confidence

    return {
      value: Math.max(0, Math.min(1, nextValue)),
      confidence
    };
  }
}

interface PerformanceBaseline {
  expectedThroughput: number;
  expectedResponseTime: number;
  expectedQuality: number;
}