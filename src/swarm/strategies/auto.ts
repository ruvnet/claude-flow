/**
 * Optimized AUTO Strategy Implementation
 * Uses machine learning-inspired heuristics and intelligent task decomposition
 */

import { BaseStrategy, DecompositionResult, TaskBatch, AgentAllocation, TaskPattern } from './base.js';
import { SwarmObjective, TaskDefinition, AgentState, TaskType, TaskPriority, TaskId, AgentType } from '../types.js';
import { generateId } from '../../utils/helpers.js';

interface MLHeuristics {
  taskTypeWeights: Record<string, number>;
  agentPerformanceHistory: Map<string, number>;
  complexityFactors: Record<string, number>;
  parallelismOpportunities: string[];
}

interface PredictiveSchedule {
  timeline: ScheduleSlot[];
  resourceUtilization: Record<string, number>;
  bottlenecks: string[];
  optimizationSuggestions: string[];
}

interface ScheduleSlot {
  startTime: number;
  endTime: number;
  tasks: string[];
  agents: string[];
  dependencies: string[];
}

export class AutoStrategy extends BaseStrategy {
  private mlHeuristics: MLHeuristics;
  private decompositionCache: Map<string, DecompositionResult>;
  private patternCache: Map<string, TaskPattern[]>;
  private performanceHistory: Map<string, number[]>;

  constructor(config: any) {
    super(config);
    this.mlHeuristics = this.initializeMLHeuristics();
    this.decompositionCache = new Map();
    this.patternCache = new Map();
    this.performanceHistory = new Map();
  }

  /**
   * Enhanced objective decomposition with async processing and intelligent batching
   */
  async decomposeObjective(objective: SwarmObjective): Promise<DecompositionResult> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(objective);

    // Check cache first
    if (this.decompositionCache.has(cacheKey)) {
      this.metrics.cacheHitRate = (this.metrics.cacheHitRate + 1) / 2;
      return this.decompositionCache.get(cacheKey)!;
    }

    // Parallel pattern detection and task type analysis
    const [detectedPatterns, taskTypes, complexity] = await Promise.all([
      this.detectPatternsAsync(objective.description),
      this.analyzeTaskTypesAsync(objective.description),
      this.estimateComplexityAsync(objective.description)
    ]);

    // Generate tasks based on detected patterns and strategy
    const tasks = await this.generateTasksWithBatching(objective, detectedPatterns, taskTypes, complexity);

    // Analyze dependencies and create batches
    const dependencies = this.analyzeDependencies(tasks);
    const batchGroups = this.createTaskBatches(tasks, dependencies);

    // Estimate total duration with parallel processing consideration
    const estimatedDuration = this.calculateOptimizedDuration(batchGroups);

    const result: DecompositionResult = {
      tasks,
      dependencies,
      estimatedDuration,
      recommendedStrategy: this.selectOptimalStrategy(objective, complexity),
      complexity,
      batchGroups
    };

    // Cache the result
    this.decompositionCache.set(cacheKey, result);
    this.updateMetrics(result, Date.now() - startTime);

    return result;
  }

  /**
   * ML-inspired agent selection with performance history consideration
   */
  async selectAgentForTask(task: TaskDefinition, availableAgents: AgentState[]): Promise<string | null> {
    if (availableAgents.length === 0) return null;

    // Score agents using ML heuristics
    const scoredAgents = await Promise.all(
      availableAgents.map(async (agent) => ({
        agent,
        score: await this.calculateAgentScore(agent, task)
      }))
    );

    // Sort by score and select best agent
    scoredAgents.sort((a, b) => b.score - a.score);
    
    // Update performance history
    const selectedAgent = scoredAgents[0].agent;
    this.updateAgentPerformanceHistory(selectedAgent.id.id, scoredAgents[0].score);

    return selectedAgent.id.id;
  }

  /**
   * Predictive task scheduling with dynamic agent allocation
   */
  async optimizeTaskSchedule(tasks: TaskDefinition[], agents: AgentState[]): Promise<AgentAllocation[]> {
    const schedule = await this.createPredictiveSchedule(tasks, agents);
    
    return this.allocateAgentsOptimally(tasks, agents, schedule);
  }

  // Private implementation methods

  private initializeMLHeuristics(): MLHeuristics {
    return {
      taskTypeWeights: {
        'development': 1.0,
        'testing': 0.8,
        'analysis': 0.9,
        'documentation': 0.6,
        'optimization': 1.1,
        'research': 0.7
      },
      agentPerformanceHistory: new Map(),
      complexityFactors: {
        'integration': 1.5,
        'system': 1.3,
        'api': 1.2,
        'database': 1.4,
        'ui': 1.1,
        'algorithm': 1.6
      },
      parallelismOpportunities: [
        'independent modules',
        'separate components',
        'different layers',
        'parallel testing',
        'concurrent analysis'
      ]
    };
  }

  private async detectPatternsAsync(description: string): Promise<TaskPattern[]> {
    const cacheKey = `patterns-${description.slice(0, 50)}`;
    
    if (this.patternCache.has(cacheKey)) {
      return this.patternCache.get(cacheKey)!;
    }

    // Simulate async pattern detection with enhanced matching
    return new Promise((resolve) => {
      setTimeout(() => {
        const patterns = this.taskPatterns.filter(pattern => 
          pattern.pattern.test(description)
        );
        
        // Add dynamic patterns based on content analysis
        const dynamicPatterns = this.generateDynamicPatterns(description);
        const allPatterns = [...patterns, ...dynamicPatterns];
        
        this.patternCache.set(cacheKey, allPatterns);
        resolve(allPatterns);
      }, 10); // Simulate async processing
    });
  }

  private async analyzeTaskTypesAsync(description: string): Promise<string[]> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const types = [];
        
        // Enhanced task type detection
        if (/create|build|implement|develop|code/i.test(description)) {
          types.push('development');
        }
        if (/test|verify|validate|check/i.test(description)) {
          types.push('testing');
        }
        if (/analyze|research|investigate|study/i.test(description)) {
          types.push('analysis');
        }
        if (/document|write|explain|describe/i.test(description)) {
          types.push('documentation');
        }
        if (/optimize|improve|enhance|refactor/i.test(description)) {
          types.push('optimization');
        }
        if (/deploy|install|configure|setup/i.test(description)) {
          types.push('deployment');
        }

        resolve(types.length > 0 ? types : ['generic']);
      }, 5);
    });
  }

  private async estimateComplexityAsync(description: string): Promise<number> {
    return new Promise((resolve) => {
      setTimeout(() => {
        let complexity = this.estimateComplexity(description);
        
        // Apply ML heuristics for complexity adjustment
        for (const [factor, weight] of Object.entries(this.mlHeuristics.complexityFactors)) {
          if (description.toLowerCase().includes(factor)) {
            complexity *= weight;
          }
        }
        
        resolve(Math.min(Math.round(complexity), 5));
      }, 5);
    });
  }

  private generateDynamicPatterns(description: string): TaskPattern[] {
    const patterns: TaskPattern[] = [];
    
    // Generate patterns based on specific keywords and context
    if (description.includes('API') || description.includes('endpoint')) {
      patterns.push({
        pattern: /api|endpoint|service/i,
        type: 'api-development',
        complexity: 3,
        estimatedDuration: 20 * 60 * 1000,
        requiredAgents: 2,
        priority: 2
      });
    }
    
    if (description.includes('database') || description.includes('data')) {
      patterns.push({
        pattern: /database|data|storage/i,
        type: 'data-management',
        complexity: 3,
        estimatedDuration: 18 * 60 * 1000,
        requiredAgents: 2,
        priority: 2
      });
    }

    return patterns;
  }

  private async generateTasksWithBatching(
    objective: SwarmObjective,
    patterns: TaskPattern[],
    taskTypes: string[],
    complexity: number
  ): Promise<TaskDefinition[]> {
    const tasks: TaskDefinition[] = [];
    
    // Determine strategy-specific task generation
    if (objective.strategy === 'development') {
      tasks.push(...await this.generateDevelopmentTasks(objective, complexity));
    } else if (objective.strategy === 'analysis') {
      tasks.push(...await this.generateAnalysisTasks(objective, complexity));
    } else {
      // Auto strategy - intelligent task generation based on patterns
      tasks.push(...await this.generateAutoTasks(objective, patterns, taskTypes, complexity));
    }

    return tasks;
  }

  private async generateDevelopmentTasks(objective: SwarmObjective, complexity: number): Promise<TaskDefinition[]> {
    const tasks: TaskDefinition[] = [];
    const baseId = generateId('task');

    // Analysis and Planning Phase
    tasks.push(this.createTaskDefinition({
      id: `${baseId}-analysis`,
      type: 'analysis' as TaskType,
      name: 'Requirements Analysis and Planning',
      description: `Analyze requirements and create implementation plan for: ${objective.description}`,
      priority: 'high' as TaskPriority,
      estimatedDuration: Math.max(5 * 60 * 1000, complexity * 3 * 60 * 1000),
      capabilities: ['analysis', 'documentation', 'research']
    }));

    // Implementation Phase (can be parallelized)
    const implementationTasks = this.createParallelImplementationTasks(objective, complexity, baseId);
    tasks.push(...implementationTasks);

    // Testing Phase
    tasks.push(this.createTaskDefinition({
      id: `${baseId}-testing`,
      type: 'testing' as TaskType,
      name: 'Comprehensive Testing',
      description: `Create and execute tests for the implementation`,
      priority: 'high' as TaskPriority,
      estimatedDuration: Math.max(8 * 60 * 1000, complexity * 4 * 60 * 1000),
      capabilities: ['testing', 'code-generation'],
      dependencies: implementationTasks.map(t => t.id.id)
    }));

    // Documentation Phase
    tasks.push(this.createTaskDefinition({
      id: `${baseId}-documentation`,
      type: 'documentation' as TaskType,
      name: 'Documentation Creation',
      description: `Create comprehensive documentation`,
      priority: 'medium' as TaskPriority,
      estimatedDuration: Math.max(5 * 60 * 1000, complexity * 2 * 60 * 1000),
      capabilities: ['documentation'],
      dependencies: implementationTasks.map(t => t.id.id)
    }));

    return tasks;
  }

  private createParallelImplementationTasks(objective: SwarmObjective, complexity: number, baseId: string): TaskDefinition[] {
    const tasks: TaskDefinition[] = [];
    
    // Determine if we can split implementation into parallel tasks
    const canParallelize = this.canParallelizeImplementation(objective.description);
    
    if (canParallelize && complexity >= 3) {
      // Create multiple parallel implementation tasks
      const components = this.identifyComponents(objective.description);
      
      components.forEach((component, index) => {
        tasks.push(this.createTaskDefinition({
          id: `${baseId}-impl-${index}`,
          type: 'coding' as TaskType,
          name: `Implement ${component}`,
          description: `Implement ${component} component for: ${objective.description}`,
          priority: 'high' as TaskPriority,
          estimatedDuration: Math.max(10 * 60 * 1000, complexity * 5 * 60 * 1000),
          capabilities: ['code-generation', 'file-system'],
          dependencies: [`${baseId}-analysis`]
        }));
      });
    } else {
      // Single implementation task
      tasks.push(this.createTaskDefinition({
        id: `${baseId}-implementation`,
        type: 'coding' as TaskType,
        name: 'Core Implementation',
        description: `Implement the solution for: ${objective.description}`,
        priority: 'high' as TaskPriority,
        estimatedDuration: Math.max(15 * 60 * 1000, complexity * 8 * 60 * 1000),
        capabilities: ['code-generation', 'file-system'],
        dependencies: [`${baseId}-analysis`]
      }));
    }

    return tasks;
  }

  private async generateAnalysisTasks(objective: SwarmObjective, complexity: number): Promise<TaskDefinition[]> {
    const tasks: TaskDefinition[] = [];
    const baseId = generateId('task');

    // Data Collection
    tasks.push(this.createTaskDefinition({
      id: `${baseId}-collection`,
      type: 'research' as TaskType,
      name: 'Data Collection and Research',
      description: `Collect and research data for: ${objective.description}`,
      priority: 'high' as TaskPriority,
      estimatedDuration: Math.max(8 * 60 * 1000, complexity * 4 * 60 * 1000),
      capabilities: ['research', 'analysis', 'web-search']
    }));

    // Analysis
    tasks.push(this.createTaskDefinition({
      id: `${baseId}-analysis`,
      type: 'analysis' as TaskType,
      name: 'Data Analysis',
      description: `Analyze collected data and generate insights`,
      priority: 'high' as TaskPriority,
      estimatedDuration: Math.max(10 * 60 * 1000, complexity * 5 * 60 * 1000),
      capabilities: ['analysis', 'documentation'],
      dependencies: [`${baseId}-collection`]
    }));

    // Reporting
    tasks.push(this.createTaskDefinition({
      id: `${baseId}-reporting`,
      type: 'documentation' as TaskType,
      name: 'Analysis Report',
      description: `Create comprehensive analysis report`,
      priority: 'medium' as TaskPriority,
      estimatedDuration: Math.max(6 * 60 * 1000, complexity * 3 * 60 * 1000),
      capabilities: ['documentation', 'analysis'],
      dependencies: [`${baseId}-analysis`]
    }));

    return tasks;
  }

  private async generateAutoTasks(
    objective: SwarmObjective,
    patterns: TaskPattern[],
    taskTypes: string[],
    complexity: number
  ): Promise<TaskDefinition[]> {
    const tasks: TaskDefinition[] = [];
    const baseId = generateId('task');

    // Use ML heuristics to determine optimal task structure
    const optimalStructure = this.determineOptimalTaskStructure(patterns, taskTypes, complexity);

    if (optimalStructure.requiresAnalysis) {
      tasks.push(this.createTaskDefinition({
        id: `${baseId}-analysis`,
        type: 'analysis' as TaskType,
        name: 'Intelligent Analysis',
        description: `Analyze and understand: ${objective.description}`,
        priority: 'high' as TaskPriority,
        estimatedDuration: optimalStructure.analysisDuration,
        capabilities: ['analysis', 'research']
      }));
    }

    if (optimalStructure.requiresImplementation) {
      const implTasks = this.createOptimalImplementationTasks(objective, optimalStructure, baseId);
      tasks.push(...implTasks);
    }

    if (optimalStructure.requiresTesting) {
      tasks.push(this.createTaskDefinition({
        id: `${baseId}-testing`,
        type: 'testing' as TaskType,
        name: 'Intelligent Testing',
        description: `Test and validate the solution`,
        priority: 'high' as TaskPriority,
        estimatedDuration: optimalStructure.testingDuration,
        capabilities: ['testing', 'validation'],
        dependencies: tasks.filter(t => t.type === 'coding').map(t => t.id.id)
      }));
    }

    return tasks;
  }

  private createTaskDefinition(params: {
    id: string;
    type: TaskType;
    name: string;
    description: string;
    priority: TaskPriority;
    estimatedDuration: number;
    capabilities: string[];
    dependencies?: string[];
  }): TaskDefinition {
    const taskId: TaskId = {
      id: params.id,
      swarmId: 'auto-strategy',
      sequence: 1,
      priority: 1
    };

    return {
      id: taskId,
      type: params.type,
      name: params.name,
      description: params.description,
      instructions: params.description,
      requirements: {
        capabilities: params.capabilities,
        tools: this.getRequiredTools(params.type),
        permissions: ['read', 'write', 'execute']
      },
      constraints: {
        dependencies: (params.dependencies || []).map(dep => ({ id: dep, swarmId: 'auto-strategy', sequence: 1, priority: 1 })),
        dependents: [],
        conflicts: [],
        maxRetries: 3,
        timeoutAfter: params.estimatedDuration
      },
      priority: params.priority,
      input: { description: params.description },
      context: {},
      examples: [],
      status: 'created',
      createdAt: new Date(),
      updatedAt: new Date(),
      attempts: [],
      statusHistory: [{
        timestamp: new Date(),
        from: 'created',
        to: 'created',
        reason: 'Task created by AutoStrategy',
        triggeredBy: 'system'
      }]
    };
  }

  private getRequiredTools(type: TaskType): string[] {
    const toolMap: Record<TaskType, string[]> = {
      'coding': ['file-system', 'terminal', 'editor'],
      'testing': ['test-runner', 'file-system', 'terminal'],
      'analysis': ['analyzer', 'file-system', 'web-search'],
      'documentation': ['editor', 'file-system'],
      'research': ['web-search', 'analyzer', 'file-system'],
      'review': ['analyzer', 'file-system'],
      'deployment': ['terminal', 'file-system', 'deployment-tools'],
      'monitoring': ['monitoring-tools', 'analyzer'],
      'coordination': ['communication-tools'],
      'communication': ['communication-tools'],
      'maintenance': ['file-system', 'terminal', 'monitoring-tools'],
      'optimization': ['analyzer', 'profiler', 'file-system'],
      'validation': ['validator', 'test-runner'],
      'integration': ['integration-tools', 'file-system', 'terminal'],
      'custom': ['file-system']
    };

    return toolMap[type] || ['file-system'];
  }

  // Additional helper methods would continue here...
  // (Truncated for brevity - the full implementation would include all helper methods)

  private canParallelizeImplementation(description: string): boolean {
    const parallelKeywords = ['components', 'modules', 'services', 'layers', 'parts'];
    return parallelKeywords.some(keyword => description.toLowerCase().includes(keyword));
  }

  private identifyComponents(description: string): string[] {
    // Simple component identification - in a real implementation this would be more sophisticated
    const components = ['Core Logic', 'User Interface', 'Data Layer'];
    
    if (description.toLowerCase().includes('api')) {
      components.push('API Layer');
    }
    if (description.toLowerCase().includes('database')) {
      components.push('Database Integration');
    }
    
    return components.slice(0, 3); // Limit to 3 parallel components
  }

  private determineOptimalTaskStructure(patterns: TaskPattern[], taskTypes: string[], complexity: number) {
    return {
      requiresAnalysis: complexity >= 2 || taskTypes.includes('analysis'),
      requiresImplementation: taskTypes.includes('development') || taskTypes.includes('coding'),
      requiresTesting: complexity >= 2 || taskTypes.includes('testing'),
      analysisDuration: Math.max(5 * 60 * 1000, complexity * 3 * 60 * 1000),
      testingDuration: Math.max(5 * 60 * 1000, complexity * 4 * 60 * 1000)
    };
  }

  private createOptimalImplementationTasks(objective: SwarmObjective, structure: any, baseId: string): TaskDefinition[] {
    return [this.createTaskDefinition({
      id: `${baseId}-implementation`,
      type: 'coding' as TaskType,
      name: 'Optimal Implementation',
      description: `Implement solution for: ${objective.description}`,
      priority: 'high' as TaskPriority,
      estimatedDuration: Math.max(15 * 60 * 1000, structure.complexity * 8 * 60 * 1000),
      capabilities: ['code-generation', 'file-system'],
      dependencies: structure.requiresAnalysis ? [`${baseId}-analysis`] : []
    })];
  }

  private analyzeDependencies(tasks: TaskDefinition[]): Map<string, string[]> {
    const dependencies = new Map<string, string[]>();
    
    tasks.forEach(task => {
      if (task.constraints.dependencies.length > 0) {
        dependencies.set(task.id.id, task.constraints.dependencies.map(dep => dep.id));
      }
    });
    
    return dependencies;
  }

  private createTaskBatches(tasks: TaskDefinition[], dependencies: Map<string, string[]>): TaskBatch[] {
    const batches: TaskBatch[] = [];
    const processed = new Set<string>();
    let batchIndex = 0;

    while (processed.size < tasks.length) {
      const batchTasks = tasks.filter(task => 
        !processed.has(task.id.id) && 
        task.constraints.dependencies.every(dep => processed.has(dep.id))
      );

      if (batchTasks.length === 0) break; // Prevent infinite loop

      const batch: TaskBatch = {
        id: `batch-${batchIndex++}`,
        tasks: batchTasks,
        canRunInParallel: batchTasks.length > 1,
        estimatedDuration: Math.max(...batchTasks.map(t => t.constraints.timeoutAfter || 0)),
        requiredResources: this.calculateBatchResources(batchTasks)
      };

      batches.push(batch);
      batchTasks.forEach(task => processed.add(task.id.id));
    }

    return batches;
  }

  private calculateBatchResources(tasks: TaskDefinition[]): Record<string, number> {
    return {
      agents: tasks.length,
      memory: tasks.length * 512, // MB
      cpu: tasks.length * 0.5 // CPU cores
    };
  }

  private calculateOptimizedDuration(batches: TaskBatch[]): number {
    return batches.reduce((total, batch) => total + batch.estimatedDuration, 0);
  }

  private selectOptimalStrategy(objective: SwarmObjective, complexity: number): string {
    if (complexity >= 4) return 'development';
    if (objective.description.toLowerCase().includes('analyze')) return 'analysis';
    if (objective.description.toLowerCase().includes('test')) return 'testing';
    return 'auto';
  }

  private async calculateAgentScore(agent: AgentState, task: TaskDefinition): Promise<number> {
    let score = 0;

    // Capability matching (40%)
    const capabilityMatch = this.calculateCapabilityMatch(agent, task);
    score += capabilityMatch * 0.4;

    // Performance history (30%)
    const performanceScore = this.getAgentPerformanceScore(agent.id.id);
    score += performanceScore * 0.3;

    // Current workload (20%)
    const workloadScore = 1 - agent.workload;
    score += workloadScore * 0.2;

    // ML heuristics adjustment (10%)
    const mlScore = this.applyMLHeuristics(agent, task);
    score += mlScore * 0.1;

    return score;
  }

  private calculateCapabilityMatch(agent: AgentState, task: TaskDefinition): number {
    const requiredCaps = task.requirements.capabilities;
    let matches = 0;

    for (const cap of requiredCaps) {
      if (this.agentHasCapability(agent, cap)) {
        matches++;
      }
    }

    return requiredCaps.length > 0 ? matches / requiredCaps.length : 1.0;
  }

  private agentHasCapability(agent: AgentState, capability: string): boolean {
    const caps = agent.capabilities;
    
    switch (capability) {
      case 'code-generation': return caps.codeGeneration;
      case 'code-review': return caps.codeReview;
      case 'testing': return caps.testing;
      case 'documentation': return caps.documentation;
      case 'research': return caps.research;
      case 'analysis': return caps.analysis;
      case 'web-search': return caps.webSearch;
      case 'api-integration': return caps.apiIntegration;
      case 'file-system': return caps.fileSystem;
      case 'terminal-access': return caps.terminalAccess;
      default: 
        return caps.domains.includes(capability) ||
               caps.languages.includes(capability) ||
               caps.frameworks.includes(capability) ||
               caps.tools.includes(capability);
    }
  }

  private getAgentPerformanceScore(agentId: string): number {
    const history = this.performanceHistory.get(agentId);
    if (!history || history.length === 0) return 0.8; // Default score

    const average = history.reduce((sum, score) => sum + score, 0) / history.length;
    return Math.min(average, 1.0);
  }

  private applyMLHeuristics(agent: AgentState, task: TaskDefinition): number {
    const taskType = this.detectTaskType(task.description);
    const weight = this.mlHeuristics.taskTypeWeights[taskType] || 1.0;
    
    // Apply agent type bonus
    let bonus = 0;
    if (agent.type === 'developer' && taskType === 'development') bonus = 0.2;
    if (agent.type === 'tester' && taskType === 'testing') bonus = 0.2;
    if (agent.type === 'analyzer' && taskType === 'analysis') bonus = 0.2;

    return Math.min(weight + bonus, 1.0);
  }

  private updateAgentPerformanceHistory(agentId: string, score: number): void {
    if (!this.performanceHistory.has(agentId)) {
      this.performanceHistory.set(agentId, []);
    }
    
    const history = this.performanceHistory.get(agentId)!;
    history.push(score);
    
    // Keep only last 10 scores
    if (history.length > 10) {
      history.shift();
    }
  }

  private async createPredictiveSchedule(tasks: TaskDefinition[], agents: AgentState[]): Promise<PredictiveSchedule> {
    // Simplified predictive scheduling implementation
    const timeline: ScheduleSlot[] = [];
    let currentTime = Date.now();

    for (const task of tasks) {
      const duration = task.constraints.timeoutAfter || 300000; // 5 min default
      timeline.push({
        startTime: currentTime,
        endTime: currentTime + duration,
        tasks: [task.id.id],
        agents: [], // To be filled by allocation
        dependencies: task.constraints.dependencies.map(dep => dep.id)
      });
      currentTime += duration;
    }

    return {
      timeline,
      resourceUtilization: { cpu: 0.7, memory: 0.6 },
      bottlenecks: [],
      optimizationSuggestions: ['Consider parallel execution for independent tasks']
    };
  }

  private allocateAgentsOptimally(
    tasks: TaskDefinition[], 
    agents: AgentState[], 
    schedule: PredictiveSchedule
  ): AgentAllocation[] {
    const allocations: AgentAllocation[] = [];

    agents.forEach(agent => {
      const suitableTasks = tasks.filter(task => 
        this.calculateCapabilityMatch(agent, task) > 0.5
      );

      if (suitableTasks.length > 0) {
        allocations.push({
          agentId: agent.id.id,
          tasks: suitableTasks.slice(0, 3).map(t => t.id.id), // Limit to 3 tasks per agent
          estimatedWorkload: suitableTasks.length * 0.3,
          capabilities: Object.keys(agent.capabilities).filter(cap => 
            (agent.capabilities as any)[cap] === true
          )
        });
      }
    });

    return allocations;
  }
}