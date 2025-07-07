/**
 * SwarmOrchestrator Class
 * 
 * Orchestrates task distribution, agent coordination, and 
 * execution strategies within the Hive Mind swarm.
 */

import { EventEmitter } from 'events';
import { HiveMind } from '../core/HiveMind.js';
import { Agent } from '../core/Agent.js';
import { DatabaseManager } from '../core/DatabaseManager.js';
import { MCPToolWrapper } from './MCPToolWrapper.js';
import {
  Task,
  TaskStrategy,
  ExecutionPlan,
  OrchestrationResult,
  TaskAssignment
} from '../types.js';

export class SwarmOrchestrator extends EventEmitter {
  private hiveMind: HiveMind;
  private db!: DatabaseManager;
  private mcpWrapper!: MCPToolWrapper;
  private executionPlans: Map<string, ExecutionPlan>;
  private taskAssignments: Map<string, TaskAssignment[]>;
  private activeExecutions: Map<string, any>;
  private isActive: boolean = false;

  constructor(hiveMind: HiveMind) {
    super();
    this.hiveMind = hiveMind;
    this.executionPlans = new Map();
    this.taskAssignments = new Map();
    this.activeExecutions = new Map();
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    this.db = await DatabaseManager.getInstance();
    this.mcpWrapper = new MCPToolWrapper();
    await this.mcpWrapper.initialize();
    
    // Start orchestration loops
    this.startTaskDistributor();
    this.startProgressMonitor();
    this.startLoadBalancer();
    
    this.isActive = true;
    this.emit('initialized');
  }

  /**
   * Submit a task for orchestration
   */
  async submitTask(task: Task): Promise<void> {
    // Create execution plan based on strategy
    const plan = await this.createExecutionPlan(task);
    this.executionPlans.set(task.id, plan);
    
    // Orchestrate task using MCP tools
    const orchestrationResult = await this.mcpWrapper.orchestrateTask({
      task: task.description,
      priority: task.priority,
      strategy: task.strategy,
      dependencies: task.dependencies
    });
    
    if (orchestrationResult.success) {
      // Start task execution
      await this.executeTask(task, plan);
    } else {
      this.emit('orchestrationError', { task, error: orchestrationResult.error });
    }
  }

  /**
   * Create execution plan for a task
   */
  private async createExecutionPlan(task: Task): Promise<ExecutionPlan> {
    const strategy = this.getStrategyImplementation(task.strategy);
    
    // Analyze task complexity
    const analysis = await this.analyzeTaskComplexity(task);
    
    // Determine phases based on strategy and complexity
    const phases = strategy.determinePhases(task, analysis);
    
    // Create assignments for each phase
    const phaseAssignments = await Promise.all(
      phases.map((phase: any) => this.createPhaseAssignments(task, phase, analysis))
    );
    
    return {
      taskId: task.id,
      strategy: task.strategy,
      phases,
      phaseAssignments,
      dependencies: task.dependencies,
      checkpoints: this.createCheckpoints(phases),
      parallelizable: strategy.isParallelizable(task),
      estimatedDuration: analysis.estimatedDuration,
      resourceRequirements: analysis.resourceRequirements
    };
  }

  /**
   * Execute task according to plan
   */
  private async executeTask(task: Task, plan: ExecutionPlan): Promise<void> {
    const execution = {
      taskId: task.id,
      plan,
      startTime: Date.now(),
      currentPhase: 0,
      phaseResults: [],
      status: 'executing'
    };
    
    this.activeExecutions.set(task.id, execution);
    
    try {
      // Execute phases according to strategy
      if (plan.parallelizable) {
        await this.executeParallel(task, plan, execution);
      } else {
        await this.executeSequential(task, plan, execution);
      }
      
      // Mark task as completed
      execution.status = 'completed';
      await this.completeTask(task, execution);
      
    } catch (error) {
      execution.status = 'failed';
      (execution as any).error = error;
      await this.handleTaskFailure(task, execution, error);
    } finally {
      this.activeExecutions.delete(task.id);
    }
  }

  /**
   * Execute phases in parallel
   */
  private async executeParallel(task: Task, plan: ExecutionPlan, execution: any): Promise<void> {
    const parallelPhases = plan.phases.filter((_, index) => 
      plan.phaseAssignments[index].some(a => a.canRunParallel)
    );
    
    const results = await Promise.all(
      parallelPhases.map(phase => 
        this.executePhase(task, phase, plan, execution)
      )
    );
    
    execution.phaseResults = results;
  }

  /**
   * Execute phases sequentially
   */
  private async executeSequential(task: Task, plan: ExecutionPlan, execution: any): Promise<void> {
    for (let i = 0; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      execution.currentPhase = i;
      
      const result = await this.executePhase(task, phase, plan, execution);
      execution.phaseResults.push(result);
      
      // Check checkpoint
      if (plan.checkpoints[i]) {
        await this.evaluateCheckpoint(task, plan.checkpoints[i], execution);
      }
    }
  }

  /**
   * Execute a single phase
   */
  private async executePhase(
    task: Task, 
    phase: string, 
    plan: ExecutionPlan, 
    execution: any
  ): Promise<any> {
    const phaseIndex = plan.phases.indexOf(phase);
    const assignments = plan.phaseAssignments[phaseIndex];
    
    // Assign agents to phase tasks
    const agentAssignments = await this.assignAgentsToPhase(task, phase, assignments);
    
    // Execute phase tasks
    const phaseResults = await Promise.all(
      agentAssignments.map(assignment => 
        this.executeAssignment(task, phase, assignment)
      )
    );
    
    // Aggregate phase results
    return this.aggregatePhaseResults(phase, phaseResults);
  }

  /**
   * Assign agents to phase tasks
   */
  private async assignAgentsToPhase(
    task: Task,
    phase: string,
    assignments: TaskAssignment[]
  ): Promise<any[]> {
    const agentAssignments = [];
    
    for (const assignment of assignments) {
      // Find suitable agent
      const agent = await this.findSuitableAgent(assignment.requiredCapabilities);
      
      if (agent) {
        await this.assignTaskToAgent(task.id, agent.id);
        agentAssignments.push({
          agent,
          assignment,
          phase
        });
      } else {
        // Queue for later assignment
        this.queueAssignment(task.id, assignment);
      }
    }
    
    return agentAssignments;
  }

  /**
   * Execute a specific assignment
   */
  private async executeAssignment(
    task: Task,
    phase: string,
    assignment: any
  ): Promise<any> {
    const { agent, assignment: taskAssignment } = assignment;
    
    // Send execution command to agent
    await agent.assignTask(task.id, {
      phase,
      role: taskAssignment.role,
      responsibilities: taskAssignment.responsibilities,
      expectedOutput: taskAssignment.expectedOutput
    });
    
    // Wait for completion or timeout
    return this.waitForAgentCompletion(agent, task.id, taskAssignment.timeout);
  }

  /**
   * Assign task to a specific agent
   */
  async assignTaskToAgent(taskId: string, agentId: string): Promise<void> {
    // Update database
    const task = await this.db.getTask(taskId);
    const assignedAgents = JSON.parse(task.assigned_agents || '[]');
    
    if (!assignedAgents.includes(agentId)) {
      assignedAgents.push(agentId);
      await this.db.updateTask(taskId, {
        assigned_agents: JSON.stringify(assignedAgents),
        status: 'assigned'
      });
    }
    
    // Update agent
    await this.db.updateAgent(agentId, {
      current_task_id: taskId,
      status: 'busy'
    });
    
    this.emit('taskAssigned', { taskId, agentId });
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<void> {
    const execution = this.activeExecutions.get(taskId);
    
    if (execution) {
      execution.status = 'cancelled';
      
      // Notify assigned agents
      const task = await this.db.getTask(taskId);
      const assignedAgents = JSON.parse(task.assigned_agents || '[]');
      
      for (const agentId of assignedAgents) {
        await this.notifyAgentTaskCancelled(agentId, taskId);
      }
    }
    
    this.activeExecutions.delete(taskId);
    this.executionPlans.delete(taskId);
    
    this.emit('taskCancelled', { taskId });
  }

  /**
   * Rebalance agent assignments
   */
  async rebalance(): Promise<void> {
    // Get current load distribution
    const loadDistribution = await this.analyzeLoadDistribution();
    
    // Use MCP tool for load balancing
    const balanceResult = await this.mcpWrapper.loadBalance({
      tasks: loadDistribution.unassignedTasks
    });
    
    if (balanceResult.success && balanceResult.data.reassignments) {
      await this.applyReassignments(balanceResult.data.reassignments);
    }
    
    this.emit('rebalanced', { loadDistribution });
  }

  /**
   * Strategy implementations
   */
  private getStrategyImplementation(strategy: TaskStrategy): any {
    const strategies = {
      parallel: {
        determinePhases: (task: Task) => ['preparation', 'parallel-execution', 'aggregation'],
        isParallelizable: () => true,
        maxConcurrency: 5
      },
      sequential: {
        determinePhases: (task: Task) => ['analysis', 'planning', 'execution', 'validation'],
        isParallelizable: () => false,
        maxConcurrency: 1
      },
      adaptive: {
        determinePhases: (task: Task, analysis: any) => {
          if (analysis.complexity === 'high') {
            return ['deep-analysis', 'planning', 'phased-execution', 'integration', 'validation'];
          }
          return ['quick-analysis', 'execution', 'validation'];
        },
        isParallelizable: (task: Task) => !task.requireConsensus,
        maxConcurrency: 3
      },
      consensus: {
        determinePhases: () => ['proposal', 'discussion', 'voting', 'execution', 'ratification'],
        isParallelizable: () => false,
        maxConcurrency: 1
      }
    };
    
    return strategies[strategy] || strategies.adaptive;
  }

  /**
   * Analyze task complexity
   */
  private async analyzeTaskComplexity(task: Task): Promise<any> {
    const analysis = await this.mcpWrapper.analyzePattern({
      action: 'analyze',
      operation: 'task_complexity',
      metadata: {
        description: task.description,
        priority: task.priority,
        dependencies: task.dependencies.length,
        requiresConsensus: task.requireConsensus
      }
    });
    
    return {
      complexity: analysis.data?.complexity || 'medium',
      estimatedDuration: analysis.data?.estimatedDuration || 3600000,
      resourceRequirements: analysis.data?.resourceRequirements || {
        minAgents: 1,
        maxAgents: task.maxAgents,
        capabilities: task.requiredCapabilities
      }
    };
  }

  /**
   * Create phase assignments
   */
  private async createPhaseAssignments(
    task: Task,
    phase: string,
    analysis: any
  ): Promise<TaskAssignment[]> {
    const assignments: TaskAssignment[] = [];
    
    // Define assignments based on phase
    switch (phase) {
      case 'analysis':
      case 'deep-analysis':
        assignments.push({
          role: 'analyst',
          requiredCapabilities: ['data_analysis', 'pattern_recognition'],
          responsibilities: ['Analyze task requirements', 'Identify patterns', 'Assess complexity'],
          expectedOutput: 'Analysis report',
          timeout: 300000, // 5 minutes
          canRunParallel: false
        });
        break;
        
      case 'planning':
        assignments.push({
          role: 'architect',
          requiredCapabilities: ['system_design', 'architecture_patterns'],
          responsibilities: ['Design solution', 'Create implementation plan', 'Define interfaces'],
          expectedOutput: 'Implementation plan',
          timeout: 600000, // 10 minutes
          canRunParallel: false
        });
        break;
        
      case 'execution':
      case 'parallel-execution':
        // Multiple execution assignments based on complexity
        const executionCount = Math.min(analysis.resourceRequirements.maxAgents, 3);
        for (let i = 0; i < executionCount; i++) {
          assignments.push({
            role: 'executor',
            requiredCapabilities: task.requiredCapabilities,
            responsibilities: ['Implement solution', 'Execute plan', 'Handle errors'],
            expectedOutput: 'Execution results',
            timeout: 1800000, // 30 minutes
            canRunParallel: true
          });
        }
        break;
        
      case 'validation':
        assignments.push({
          role: 'validator',
          requiredCapabilities: ['quality_assurance', 'test_generation'],
          responsibilities: ['Validate results', 'Run tests', 'Ensure quality'],
          expectedOutput: 'Validation report',
          timeout: 600000, // 10 minutes
          canRunParallel: false
        });
        break;
        
      case 'consensus':
      case 'voting':
        assignments.push({
          role: 'consensus-coordinator',
          requiredCapabilities: ['consensus_building'],
          responsibilities: ['Coordinate voting', 'Collect opinions', 'Determine consensus'],
          expectedOutput: 'Consensus decision',
          timeout: 300000, // 5 minutes
          canRunParallel: false
        });
        break;
    }
    
    return assignments;
  }

  /**
   * Create execution checkpoints
   */
  private createCheckpoints(phases: string[]): any[] {
    return phases.map((phase, index) => ({
      phase,
      index,
      requiredProgress: Math.round((index + 1) / phases.length * 100),
      validationCriteria: this.getValidationCriteria(phase),
      failureThreshold: 0.3
    }));
  }

  /**
   * Get validation criteria for a phase
   */
  private getValidationCriteria(phase: string): any[] {
    const criteria: Record<string, any[]> = {
      analysis: [
        { name: 'completeness', weight: 0.4 },
        { name: 'accuracy', weight: 0.6 }
      ],
      planning: [
        { name: 'feasibility', weight: 0.5 },
        { name: 'completeness', weight: 0.5 }
      ],
      execution: [
        { name: 'correctness', weight: 0.7 },
        { name: 'performance', weight: 0.3 }
      ],
      validation: [
        { name: 'test_coverage', weight: 0.5 },
        { name: 'quality_score', weight: 0.5 }
      ]
    };
    
    return criteria[phase] || [{ name: 'completion', weight: 1.0 }];
  }

  /**
   * Find suitable agent for capabilities
   */
  private async findSuitableAgent(requiredCapabilities: string[]): Promise<Agent | null> {
    const agents = await this.hiveMind.getAgents();
    
    // Filter available agents with required capabilities
    const suitableAgents = agents.filter(agent => 
      agent.status === 'idle' &&
      requiredCapabilities.every(cap => agent.capabilities.includes(cap as any))
    );
    
    if (suitableAgents.length === 0) {
      return null;
    }
    
    // Select best agent based on performance history
    return this.selectBestAgent(suitableAgents, requiredCapabilities);
  }

  /**
   * Select best agent from candidates
   */
  private async selectBestAgent(agents: Agent[], capabilities: string[]): Promise<Agent> {
    // Simple selection - in production would use performance metrics
    const scores = await Promise.all(
      agents.map(async agent => {
        const performance = await this.db.getAgentPerformance(agent.id);
        return {
          agent,
          score: performance?.successRate || 0.5
        };
      })
    );
    
    scores.sort((a, b) => b.score - a.score);
    return scores[0].agent;
  }

  /**
   * Wait for agent to complete task
   */
  private async waitForAgentCompletion(
    agent: Agent,
    taskId: string,
    timeout: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent ${agent.id} timeout on task ${taskId}`));
      }, timeout);
      
      const checkCompletion = async () => {
        const agentState = await this.db.getAgent(agent.id);
        
        if (agentState.current_task_id !== taskId) {
          clearTimeout(timer);
          clearInterval(interval);
          
          // Get task result
          const task = await this.db.getTask(taskId);
          resolve(task.result ? JSON.parse(task.result) : {});
        }
      };
      
      const interval = setInterval(checkCompletion, 1000);
    });
  }

  /**
   * Aggregate results from phase execution
   */
  private aggregatePhaseResults(phase: string, results: any[]): any {
    return {
      phase,
      results,
      summary: this.summarizeResults(results),
      timestamp: new Date()
    };
  }

  /**
   * Summarize phase results
   */
  private summarizeResults(results: any[]): any {
    const successful = results.filter(r => r.success).length;
    const total = results.length;
    
    return {
      successRate: total > 0 ? successful / total : 0,
      totalExecutions: total,
      aggregatedData: results.map(r => r.data).filter(Boolean)
    };
  }

  /**
   * Queue assignment for later
   */
  private queueAssignment(taskId: string, assignment: TaskAssignment): void {
    if (!this.taskAssignments.has(taskId)) {
      this.taskAssignments.set(taskId, []);
    }
    
    this.taskAssignments.get(taskId)!.push(assignment);
    this.emit('assignmentQueued', { taskId, assignment });
  }

  /**
   * Evaluate checkpoint
   */
  private async evaluateCheckpoint(task: Task, checkpoint: any, execution: any): Promise<void> {
    const phaseResult = execution.phaseResults[checkpoint.index];
    
    if (!phaseResult) return;
    
    let score = 0;
    for (const criterion of checkpoint.validationCriteria) {
      const criterionScore = this.evaluateCriterion(phaseResult, criterion);
      score += criterionScore * criterion.weight;
    }
    
    if (score < checkpoint.failureThreshold) {
      throw new Error(`Checkpoint failed at phase ${checkpoint.phase}: score ${score}`);
    }
    
    this.emit('checkpointPassed', { task, checkpoint, score });
  }

  /**
   * Evaluate validation criterion
   */
  private evaluateCriterion(result: any, criterion: any): number {
    // Simplified evaluation - in production would be more sophisticated
    if (result.summary && result.summary.successRate !== undefined) {
      return result.summary.successRate;
    }
    return 0.7; // Default passing score
  }

  /**
   * Complete task execution
   */
  private async completeTask(task: Task, execution: any): Promise<void> {
    const finalResult = {
      success: true,
      executionTime: Date.now() - execution.startTime,
      phases: execution.phaseResults,
      summary: this.createExecutionSummary(execution)
    };
    
    await this.db.updateTask(task.id, {
      status: 'completed',
      result: JSON.stringify(finalResult),
      progress: 100,
      completed_at: new Date()
    });
    
    this.emit('taskCompleted', { task, result: finalResult });
  }

  /**
   * Handle task failure
   */
  private async handleTaskFailure(task: Task, execution: any, error: any): Promise<void> {
    await this.db.updateTask(task.id, {
      status: 'failed',
      error: error.message,
      completed_at: new Date()
    });
    
    this.emit('taskFailed', { task, error });
  }

  /**
   * Create execution summary
   */
  private createExecutionSummary(execution: any): any {
    const phaseCount = execution.phaseResults.length;
    const successfulPhases = execution.phaseResults.filter(r => r.summary?.successRate > 0.5).length;
    
    return {
      totalPhases: phaseCount,
      successfulPhases,
      overallSuccess: phaseCount > 0 ? successfulPhases / phaseCount : 0,
      executionTime: Date.now() - execution.startTime
    };
  }

  /**
   * Notify agent of task cancellation
   */
  private async notifyAgentTaskCancelled(agentId: string, taskId: string): Promise<void> {
    const status = await this.hiveMind.getFullStatus();
    // Send cancellation message to agent
    await this.db.createCommunication({
      from_agent_id: 'orchestrator',
      to_agent_id: agentId,
      swarm_id: status.swarmId,
      message_type: 'task_cancellation',
      content: JSON.stringify({ taskId, reason: 'User cancelled' }),
      priority: 'urgent'
    });
  }

  /**
   * Analyze load distribution
   */
  private async analyzeLoadDistribution(): Promise<any> {
    const agents = await this.hiveMind.getAgents();
    const status = await this.hiveMind.getFullStatus();
    const tasks = await this.db.getActiveTasks(status.swarmId);
    
    const busyAgents = agents.filter(a => a.status === 'busy');
    const idleAgents = agents.filter(a => a.status === 'idle');
    const unassignedTasks = tasks.filter(t => !t.assigned_agents || JSON.parse(t.assigned_agents).length === 0);
    
    return {
      totalAgents: agents.length,
      busyAgents: busyAgents.length,
      idleAgents: idleAgents.length,
      activeTasks: tasks.length,
      unassignedTasks: unassignedTasks.map(t => ({
        id: t.id,
        priority: t.priority,
        requiredCapabilities: JSON.parse(t.required_capabilities || '[]')
      })),
      loadFactor: agents.length > 0 ? busyAgents.length / agents.length : 0
    };
  }

  /**
   * Apply load balancing reassignments
   */
  private async applyReassignments(reassignments: any[]): Promise<void> {
    for (const reassignment of reassignments) {
      await this.reassignTask(reassignment.taskId, reassignment.fromAgent, reassignment.toAgent);
    }
  }

  /**
   * Reassign task from one agent to another
   */
  private async reassignTask(taskId: string, fromAgentId: string, toAgentId: string): Promise<void> {
    // Update task assignment
    await this.db.reassignTask(taskId, toAgentId);
    
    // Update agent states
    await this.db.updateAgent(fromAgentId, {
      current_task_id: null,
      status: 'idle'
    });
    
    await this.db.updateAgent(toAgentId, {
      current_task_id: taskId,
      status: 'busy'
    });
    
    // Notify agents
    await this.notifyAgentReassignment(fromAgentId, toAgentId, taskId);
  }

  /**
   * Notify agents of reassignment
   */
  private async notifyAgentReassignment(fromAgentId: string, toAgentId: string, taskId: string): Promise<void> {
    const status = await this.hiveMind.getFullStatus();
    // Notify source agent
    await this.db.createCommunication({
      from_agent_id: 'orchestrator',
      to_agent_id: fromAgentId,
      swarm_id: status.swarmId,
      message_type: 'task_reassignment',
      content: JSON.stringify({ taskId, reassignedTo: toAgentId }),
      priority: 'high'
    });
    
    // Notify target agent
    const task = await this.db.getTask(taskId);
    const plan = this.executionPlans.get(taskId);
    
    await this.db.createCommunication({
      from_agent_id: 'orchestrator',
      to_agent_id: toAgentId,
      swarm_id: status.swarmId,
      message_type: 'task_assignment',
      content: JSON.stringify({ 
        taskId, 
        task: task.description,
        executionPlan: plan 
      }),
      priority: 'high'
    });
  }

  /**
   * Start task distributor loop
   */
  private startTaskDistributor(): void {
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        // Check for queued assignments
        for (const [taskId, assignments] of this.taskAssignments) {
          for (const assignment of assignments) {
            const agent = await this.findSuitableAgent(assignment.requiredCapabilities);
            if (agent) {
              await this.assignTaskToAgent(taskId, agent.id);
              // Remove from queue
              const remaining = assignments.filter(a => a !== assignment);
              if (remaining.length === 0) {
                this.taskAssignments.delete(taskId);
              } else {
                this.taskAssignments.set(taskId, remaining);
              }
            }
          }
        }
      } catch (error) {
        this.emit('error', error);
      }
    }, 5000); // Every 5 seconds
  }

  /**
   * Start progress monitor loop
   */
  private startProgressMonitor(): void {
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        // Monitor active executions
        for (const [taskId, execution] of this.activeExecutions) {
          const task = await this.db.getTask(taskId);
          
          if (task.status === 'in_progress') {
            const progress = this.calculateProgress(execution);
            
            if (progress !== task.progress) {
              await this.db.updateTask(taskId, { progress });
              this.emit('progressUpdate', { taskId, progress });
            }
          }
        }
      } catch (error) {
        this.emit('error', error);
      }
    }, 2000); // Every 2 seconds
  }

  /**
   * Start load balancer loop
   */
  private startLoadBalancer(): void {
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        const load = await this.analyzeLoadDistribution();
        
        // Trigger rebalancing if needed
        if (load.loadFactor > 0.8 && load.idleAgents.length > 0 && load.unassignedTasks.length > 0) {
          await this.rebalance();
        }
      } catch (error) {
        this.emit('error', error);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Calculate task progress
   */
  private calculateProgress(execution: any): number {
    if (!execution.plan || !execution.plan.phases) return 0;
    
    const totalPhases = execution.plan.phases.length;
    const completedPhases = execution.currentPhase;
    
    return Math.round((completedPhases / totalPhases) * 100);
  }

  /**
   * Shutdown orchestrator
   */
  async shutdown(): Promise<void> {
    this.isActive = false;
    
    // Cancel all active executions
    for (const taskId of this.activeExecutions.keys()) {
      await this.cancelTask(taskId);
    }
    
    this.emit('shutdown');
  }
}