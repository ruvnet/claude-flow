/**
 * Queen Coordinator Class
 * 
 * The Queen manages high-level coordination, decision-making,
 * and strategic planning for the Hive Mind swarm.
 */

import { EventEmitter } from 'events';
// @ts-ignore
import { v4 as uuidv4 } from 'uuid';
import { Agent } from './Agent.js';
import { DatabaseManager } from './DatabaseManager.js';
import { MCPToolWrapper } from '../integration/MCPToolWrapper.js';
import {
  SwarmTopology,
  Task,
  AgentType,
  QueenMode,
  ConsensusProposal,
  QueenDecision,
  CoordinationStrategy
} from '../types.js';

interface QueenConfig {
  swarmId: string;
  mode: QueenMode;
  topology: SwarmTopology;
}

export class Queen extends EventEmitter {
  private id: string;
  private config: QueenConfig;
  private agents: Map<string, Agent>;
  private taskQueue: Map<string, Task>;
  private strategies: Map<string, CoordinationStrategy>;
  private db!: DatabaseManager;
  private mcpWrapper!: MCPToolWrapper;
  private isActive: boolean = false;

  constructor(config: QueenConfig) {
    super();
    this.id = uuidv4();
    this.config = config;
    this.agents = new Map();
    this.taskQueue = new Map();
    this.strategies = new Map();
    this.initializeStrategies();
  }

  /**
   * Initialize the Queen and her coordination capabilities
   */
  async initialize(): Promise<void> {
    this.db = await DatabaseManager.getInstance();
    this.mcpWrapper = new MCPToolWrapper();
    
    // Create Queen as a special coordinator agent
    await this.db.createAgent({
      id: this.id,
      swarmId: this.config.swarmId,
      name: 'Queen',
      type: 'coordinator',
      capabilities: JSON.stringify([
        'strategic_planning',
        'task_allocation',
        'consensus_coordination',
        'performance_optimization',
        'swarm_governance'
      ]),
      status: 'active',
      metadata: JSON.stringify({ role: 'queen', mode: this.config.mode })
    });
    
    this.isActive = true;
    
    // Start coordination loops
    this.startCoordinationLoop();
    this.startOptimizationLoop();
    
    this.emit('initialized');
  }

  /**
   * Register a new agent with the Queen
   */
  async registerAgent(agent: Agent): Promise<void> {
    this.agents.set(agent.id, agent);
    
    // Analyze agent capabilities and update strategies
    await this.analyzeAgentCapabilities(agent);
    
    // Notify other agents in distributed mode
    if (this.config.mode === 'distributed') {
      await this.broadcastAgentRegistration(agent);
    }
    
    this.emit('agentRegistered', { agent });
  }

  /**
   * Handle task submission
   */
  async onTaskSubmitted(task: Task): Promise<QueenDecision> {
    this.taskQueue.set(task.id, task);
    
    // Analyze task requirements
    const analysis = await this.analyzeTask(task);
    
    // Make strategic decision
    const decision = await this.makeStrategicDecision(task, analysis);
    
    // If consensus required, initiate consensus process
    if (task.requireConsensus) {
      await this.initiateConsensus(task, decision);
    }
    
    // Apply decision
    await this.applyDecision(decision);
    
    this.emit('taskDecision', { task, decision });
    
    return decision;
  }

  /**
   * Make a strategic decision about task execution
   */
  private async makeStrategicDecision(task: Task, analysis: any): Promise<QueenDecision> {
    // Use MCP neural capabilities for decision making
    const neuralAnalysis = await this.mcpWrapper.analyzePattern({
      action: 'analyze',
      operation: 'task_strategy',
      metadata: {
        task: task.description,
        priority: task.priority,
        topology: this.config.topology,
        availableAgents: this.getAvailableAgents().length
      }
    });
    
    // Select optimal strategy
    const strategy = this.selectOptimalStrategy(task, analysis, neuralAnalysis);
    
    // Identify best agents for the task
    const selectedAgents = await this.selectAgentsForTask(task, strategy);
    
    // Create execution plan
    const executionPlan = this.createExecutionPlan(task, selectedAgents, strategy);
    
    return {
      id: uuidv4(),
      taskId: task.id,
      strategy,
      selectedAgents: selectedAgents.map(a => a.id),
      executionPlan,
      confidence: analysis.confidence || 0.85,
      rationale: analysis.rationale || 'Strategic analysis completed',
      timestamp: new Date()
    };
  }

  /**
   * Select optimal coordination strategy
   */
  private selectOptimalStrategy(task: Task, analysis: any, neuralAnalysis: any): CoordinationStrategy {
    // Strategy selection based on multiple factors
    const factors = {
      taskComplexity: analysis.complexity || 'medium',
      agentAvailability: this.getAvailableAgents().length,
      topology: this.config.topology,
      priority: task.priority,
      consensusRequired: task.requireConsensus
    };
    
    // Use topology-specific strategies
    if (this.config.topology === 'hierarchical' && factors.taskComplexity === 'high') {
      return this.strategies.get('hierarchical-cascade')!;
    }
    
    if (this.config.topology === 'mesh' && factors.consensusRequired) {
      return this.strategies.get('mesh-consensus')!;
    }
    
    if (factors.priority === 'critical') {
      return this.strategies.get('priority-fast-track')!;
    }
    
    // Default adaptive strategy
    return this.strategies.get('adaptive-default')!;
  }

  /**
   * Select best agents for a task
   */
  private async selectAgentsForTask(task: Task, strategy: CoordinationStrategy): Promise<Agent[]> {
    const availableAgents = this.getAvailableAgents();
    const requiredCapabilities = task.requiredCapabilities || [];
    
    // Score agents based on capabilities and current load
    const scoredAgents = await Promise.all(
      availableAgents.map(async (agent) => {
        const score = await this.scoreAgentForTask(agent, task, requiredCapabilities);
        return { agent, score };
      })
    );
    
    // Sort by score and select top agents
    scoredAgents.sort((a, b) => b.score - a.score);
    
    const maxAgents = Math.min(task.maxAgents, strategy.maxAgents || 3);
    return scoredAgents.slice(0, maxAgents).map(sa => sa.agent);
  }

  /**
   * Score an agent for a specific task
   */
  private async scoreAgentForTask(agent: Agent, task: Task, requiredCapabilities: string[]): Promise<number> {
    let score = 0;
    
    // Capability match
    const capabilityMatches = requiredCapabilities.filter(cap => 
      agent.capabilities.includes(cap as any)
    ).length;
    score += capabilityMatches * 10;
    
    // Agent type suitability
    const typeSuitability = this.getTypeSuitabilityForTask(agent.type, task);
    score += typeSuitability * 5;
    
    // Current workload (prefer less busy agents)
    if (agent.status === 'idle') score += 8;
    else if (agent.status === 'active') score += 4;
    
    // Historical performance (from database)
    const performance = await this.db.getAgentPerformance(agent.id);
    if (performance) {
      score += performance.successRate * 10;
    }
    
    // Specialty bonus
    if (agent.type === 'specialist' && requiredCapabilities.length > 0) {
      score += 5;
    }
    
    return score;
  }

  /**
   * Get type suitability score for a task
   */
  private getTypeSuitabilityForTask(agentType: AgentType, task: Task): number {
    const suitabilityMap: Record<string, Record<AgentType, number>> = {
      research: { researcher: 10, analyst: 8, specialist: 6, coder: 4, coordinator: 5, architect: 5, tester: 3, reviewer: 4, optimizer: 4, documenter: 6, monitor: 3 },
      development: { coder: 10, architect: 8, tester: 7, reviewer: 6, coordinator: 5, specialist: 6, researcher: 4, analyst: 4, optimizer: 5, documenter: 4, monitor: 3 },
      analysis: { analyst: 10, researcher: 8, specialist: 6, reviewer: 5, coordinator: 5, architect: 4, coder: 4, tester: 3, optimizer: 5, documenter: 4, monitor: 4 },
      testing: { tester: 10, reviewer: 8, analyst: 6, coder: 5, coordinator: 4, specialist: 5, researcher: 3, architect: 4, optimizer: 4, documenter: 3, monitor: 4 },
      optimization: { optimizer: 10, analyst: 8, coder: 7, architect: 6, coordinator: 5, specialist: 6, researcher: 4, tester: 4, reviewer: 5, documenter: 3, monitor: 4 }
    };
    
    // Detect task type from description
    const taskType = this.detectTaskType(task.description);
    return suitabilityMap[taskType]?.[agentType] || 5;
  }

  /**
   * Detect task type from description
   */
  private detectTaskType(description: string): string {
    const lower = description.toLowerCase();
    
    if (lower.includes('research') || lower.includes('investigate') || lower.includes('explore')) {
      return 'research';
    }
    if (lower.includes('develop') || lower.includes('implement') || lower.includes('build') || lower.includes('create')) {
      return 'development';
    }
    if (lower.includes('analyze') || lower.includes('review') || lower.includes('assess')) {
      return 'analysis';
    }
    if (lower.includes('test') || lower.includes('validate') || lower.includes('verify')) {
      return 'testing';
    }
    if (lower.includes('optimize') || lower.includes('improve') || lower.includes('enhance')) {
      return 'optimization';
    }
    
    return 'general';
  }

  /**
   * Create execution plan for task
   */
  private createExecutionPlan(task: Task, agents: Agent[], strategy: CoordinationStrategy): any {
    return {
      phases: strategy.phases || ['preparation', 'execution', 'validation'],
      agentAssignments: agents.map(agent => ({
        agentId: agent.id,
        role: this.determineAgentRole(agent, task),
        responsibilities: this.getAgentResponsibilities(agent, task)
      })),
      coordinationPoints: strategy.coordinationPoints || ['start', 'midpoint', 'completion'],
      checkpoints: this.createCheckpoints(task, strategy),
      fallbackPlan: this.createFallbackPlan(task, agents)
    };
  }

  /**
   * Initiate consensus process
   */
  private async initiateConsensus(task: Task, decision: QueenDecision): Promise<void> {
    const proposal: ConsensusProposal = {
      id: uuidv4(),
      swarmId: this.config.swarmId,
      taskId: task.id,
      proposal: {
        decision,
        task: task.description,
        rationale: decision.rationale
      },
      requiredThreshold: 0.66,
      deadline: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    };
    
    await this.db.createConsensusProposal(proposal);
    
    // Notify all agents to vote
    await this.broadcastConsensusRequest(proposal);
  }

  /**
   * Apply Queen's decision
   */
  private async applyDecision(decision: QueenDecision): Promise<void> {
    // Update task with assignments
    await this.db.updateTask(decision.taskId, {
      assigned_agents: JSON.stringify(decision.selectedAgents),
      status: 'assigned',
      assigned_at: new Date()
    });
    
    // Notify selected agents
    for (const agentId of decision.selectedAgents) {
      const agent = this.agents.get(agentId);
      if (agent) {
        await agent.assignTask(decision.taskId, decision.executionPlan);
      }
    }
    
    // Store decision in memory for learning
    await this.mcpWrapper.storeMemory({
      action: 'store',
      key: `decision/${decision.taskId}`,
      value: JSON.stringify(decision),
      namespace: 'queen-decisions',
      ttl: 86400 * 7 // 7 days
    });
  }

  /**
   * Start coordination loop
   */
  private startCoordinationLoop(): void {
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        // Monitor agent health
        await this.monitorAgentHealth();
        
        // Check task progress
        await this.checkTaskProgress();
        
        // Rebalance if needed
        await this.checkRebalancing();
        
      } catch (error) {
        this.emit('error', error);
      }
    }, 5000); // Every 5 seconds
  }

  /**
   * Start optimization loop
   */
  private startOptimizationLoop(): void {
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        // Analyze performance patterns
        await this.analyzePerformancePatterns();
        
        // Optimize strategies
        await this.optimizeStrategies();
        
        // Train neural patterns
        await this.trainNeuralPatterns();
        
      } catch (error) {
        this.emit('error', error);
      }
    }, 60000); // Every minute
  }

  /**
   * Initialize coordination strategies
   */
  private initializeStrategies(): void {
    // Hierarchical cascade strategy
    this.strategies.set('hierarchical-cascade', {
      name: 'Hierarchical Cascade',
      description: 'Top-down task distribution with clear delegation',
      phases: ['planning', 'delegation', 'execution', 'aggregation'],
      maxAgents: 5,
      coordinationPoints: ['phase-transition', 'milestone', 'completion'],
      suitable_for: ['complex-tasks', 'multi-phase-projects']
    });
    
    // Mesh consensus strategy
    this.strategies.set('mesh-consensus', {
      name: 'Mesh Consensus',
      description: 'Peer-to-peer coordination with consensus requirements',
      phases: ['proposal', 'discussion', 'consensus', 'execution'],
      maxAgents: 7,
      coordinationPoints: ['consensus-check', 'progress-sync', 'final-vote'],
      suitable_for: ['critical-decisions', 'collaborative-tasks']
    });
    
    // Priority fast-track strategy
    this.strategies.set('priority-fast-track', {
      name: 'Priority Fast Track',
      description: 'Rapid execution for critical tasks',
      phases: ['immediate-assignment', 'parallel-execution', 'quick-validation'],
      maxAgents: 3,
      coordinationPoints: ['start', 'critical-path', 'completion'],
      suitable_for: ['urgent-tasks', 'critical-fixes']
    });
    
    // Adaptive default strategy
    this.strategies.set('adaptive-default', {
      name: 'Adaptive Default',
      description: 'Flexible strategy that adapts to task requirements',
      phases: ['analysis', 'planning', 'execution', 'review'],
      maxAgents: 4,
      coordinationPoints: ['checkpoint', 'adaptation-point', 'completion'],
      suitable_for: ['general-tasks', 'unknown-complexity']
    });
  }

  /**
   * Helper methods
   */
  
  private getAvailableAgents(): Agent[] {
    return Array.from(this.agents.values()).filter(
      agent => agent.status === 'idle' || agent.status === 'active'
    );
  }

  private async analyzeTask(task: Task): Promise<any> {
    // Use MCP tools to analyze task complexity and requirements
    return this.mcpWrapper.analyzePattern({
      action: 'analyze',
      operation: 'task_analysis',
      metadata: {
        description: task.description,
        priority: task.priority,
        dependencies: task.dependencies
      }
    });
  }

  private async analyzeAgentCapabilities(agent: Agent): Promise<void> {
    // Analyze and store agent capability patterns
    await this.mcpWrapper.storeMemory({
      action: 'store',
      key: `agent-capabilities/${agent.id}`,
      value: JSON.stringify({
        type: agent.type,
        capabilities: agent.capabilities,
        registeredAt: new Date()
      }),
      namespace: 'agent-registry'
    });
  }

  private async broadcastAgentRegistration(agent: Agent): Promise<void> {
    // In distributed mode, notify other Queens/coordinators
    await this.db.createCommunication({
      from_agent_id: this.id,
      to_agent_id: null, // broadcast
      swarm_id: this.config.swarmId,
      message_type: 'broadcast',
      content: JSON.stringify({
        type: 'agent_registered',
        agent: {
          id: agent.id,
          type: agent.type,
          capabilities: agent.capabilities
        }
      }),
      priority: 'high'
    });
  }

  private async broadcastConsensusRequest(proposal: ConsensusProposal): Promise<void> {
    await this.db.createCommunication({
      from_agent_id: this.id,
      to_agent_id: null, // broadcast
      swarm_id: this.config.swarmId,
      message_type: 'consensus',
      content: JSON.stringify(proposal),
      priority: 'urgent',
      requires_response: true
    });
  }

  private determineAgentRole(agent: Agent, task: Task): string {
    // Determine specific role based on agent type and task
    const roleMap: Record<AgentType, string> = {
      coordinator: 'lead',
      researcher: 'investigator',
      coder: 'implementer',
      analyst: 'evaluator',
      architect: 'designer',
      tester: 'validator',
      reviewer: 'auditor',
      optimizer: 'enhancer',
      documenter: 'recorder',
      monitor: 'observer',
      specialist: 'expert'
    };
    
    return roleMap[agent.type] || 'contributor';
  }

  private getAgentResponsibilities(agent: Agent, task: Task): string[] {
    // Define specific responsibilities based on role
    const responsibilityMap: Record<AgentType, string[]> = {
      coordinator: ['coordinate team', 'track progress', 'resolve conflicts'],
      researcher: ['gather information', 'identify patterns', 'provide insights'],
      coder: ['implement solution', 'write tests', 'debug issues'],
      analyst: ['analyze data', 'identify bottlenecks', 'suggest improvements'],
      architect: ['design system', 'define interfaces', 'ensure scalability'],
      tester: ['write tests', 'find bugs', 'validate functionality'],
      reviewer: ['review code', 'ensure quality', 'suggest improvements'],
      optimizer: ['improve performance', 'reduce complexity', 'optimize resources'],
      documenter: ['create documentation', 'update guides', 'maintain clarity'],
      monitor: ['track metrics', 'alert on issues', 'ensure health'],
      specialist: ['provide expertise', 'solve complex problems', 'guide implementation']
    };
    
    return responsibilityMap[agent.type] || ['contribute to task'];
  }

  private createCheckpoints(task: Task, strategy: CoordinationStrategy): any[] {
    return strategy.coordinationPoints.map((point, index) => ({
      name: point,
      expectedProgress: Math.round((index + 1) / strategy.coordinationPoints.length * 100),
      actions: ['status_check', 'sync_progress', 'adjust_strategy']
    }));
  }

  private createFallbackPlan(task: Task, agents: Agent[]): any {
    return {
      triggers: ['agent_failure', 'deadline_approaching', 'consensus_failure'],
      actions: [
        'reassign_to_available_agents',
        'escalate_to_queen',
        'activate_backup_agents',
        'simplify_task_requirements'
      ],
      escalation_path: ['team_lead', 'queen', 'human_operator']
    };
  }

  private async monitorAgentHealth(): Promise<void> {
    for (const agent of this.agents.values()) {
      if (agent.status === 'error' || !agent.isResponsive()) {
        await this.handleAgentFailure(agent);
      }
    }
  }

  private async checkTaskProgress(): Promise<void> {
    const activeTasks = await this.db.getActiveTasks(this.config.swarmId);
    
    for (const task of activeTasks) {
      if (this.isTaskStalled(task)) {
        await this.handleStalledTask(task);
      }
    }
  }

  private async checkRebalancing(): Promise<void> {
    const stats = await this.db.getSwarmStats(this.config.swarmId);
    
    if (stats.agentUtilization > 0.9 || stats.taskBacklog > stats.agentCount * 2) {
      this.emit('rebalanceNeeded', stats);
    }
  }

  private async analyzePerformancePatterns(): Promise<void> {
    const patterns = await this.mcpWrapper.analyzePattern({
      action: 'analyze',
      operation: 'performance_patterns',
      metadata: {
        swarmId: this.config.swarmId,
        timeframe: '1h'
      }
    });
    
    if (patterns.recommendations) {
      await this.applyPerformanceRecommendations(patterns.recommendations);
    }
  }

  private async optimizeStrategies(): Promise<void> {
    // Analyze strategy effectiveness and adjust
    const strategyPerformance = await this.db.getStrategyPerformance(this.config.swarmId);
    
    for (const [strategyName, performance] of Object.entries(strategyPerformance)) {
      if ((performance as any).successRate < 0.7) {
        await this.adjustStrategy(strategyName, performance);
      }
    }
  }

  private async trainNeuralPatterns(): Promise<void> {
    // Train neural network on successful patterns
    const successfulDecisions = await this.db.getSuccessfulDecisions(this.config.swarmId);
    
    if (successfulDecisions.length > 10) {
      await this.mcpWrapper.trainNeural({
        pattern_type: 'coordination',
        training_data: JSON.stringify(successfulDecisions),
        epochs: 50
      });
    }
  }

  private async handleAgentFailure(agent: Agent): Promise<void> {
    // Reassign agent's tasks
    if (agent.currentTask) {
      await this.reassignTask(agent.currentTask, agent.id);
    }
    
    // Mark agent as offline
    await this.db.updateAgentStatus(agent.id, 'offline');
    
    this.emit('agentFailed', { agent });
  }

  private async handleStalledTask(task: any): Promise<void> {
    // Implement stalled task recovery
    this.emit('taskStalled', { task });
  }

  private isTaskStalled(task: any): boolean {
    // Check if task hasn't progressed in reasonable time
    const stalledThreshold = 10 * 60 * 1000; // 10 minutes
    return task.last_progress_update && 
           Date.now() - new Date(task.last_progress_update).getTime() > stalledThreshold;
  }

  private async reassignTask(taskId: string, fromAgentId: string): Promise<void> {
    const availableAgents = this.getAvailableAgents().filter(a => a.id !== fromAgentId);
    
    if (availableAgents.length > 0) {
      const newAgent = availableAgents[0]; // Simple selection, could be more sophisticated
      await this.db.reassignTask(taskId, newAgent.id);
      await newAgent.assignTask(taskId, {});
    }
  }

  private async applyPerformanceRecommendations(recommendations: any[]): Promise<void> {
    // Apply recommended optimizations
    for (const rec of recommendations) {
      this.emit('performanceRecommendation', rec);
    }
  }

  private async adjustStrategy(strategyName: string, performance: any): Promise<void> {
    const strategy = this.strategies.get(strategyName);
    if (strategy) {
      // Adjust strategy parameters based on performance
      if (performance.avgCompletionTime > performance.targetTime) {
        strategy.maxAgents = Math.min(strategy.maxAgents + 1, 10);
      }
      
      this.emit('strategyAdjusted', { strategyName, performance });
    }
  }

  /**
   * Shutdown the Queen
   */
  async shutdown(): Promise<void> {
    this.isActive = false;
    this.emit('shutdown');
  }
}