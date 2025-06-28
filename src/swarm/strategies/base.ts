/**
 * Base Strategy Interface for Swarm Task Execution
 * Provides the foundation for different task execution strategies
 */

import { TaskDefinition, SwarmObjective, AgentState, SwarmConfig } from '../types.js';

export interface StrategyMetrics {
  tasksCompleted: number;
  averageExecutionTime: number;
  successRate: number;
  resourceUtilization: number;
  parallelismEfficiency: number;
  cacheHitRate: number;
  predictionAccuracy: number;
  cacheHits?: number;
  cacheMisses?: number;
  queriesExecuted?: number;
  averageResponseTime?: number;
  credibilityScores?: number[];
}

export interface TaskPattern {
  pattern: RegExp;
  type: string;
  complexity: number;
  estimatedDuration: number;
  requiredAgents: number;
  priority: number;
}

export interface DecompositionResult {
  tasks: TaskDefinition[];
  dependencies: Map<string, string[]>;
  estimatedDuration: number;
  recommendedStrategy: string;
  complexity: number;
  batchGroups: TaskBatch[];
}

export interface TaskBatch {
  id: string;
  tasks: TaskDefinition[];
  canRunInParallel: boolean;
  estimatedDuration: number;
  requiredResources: Record<string, number>;
}

export interface AgentAllocation {
  agentId: string;
  tasks: string[];
  estimatedWorkload: number;
  capabilities: string[];
}

export abstract class BaseStrategy {
  protected metrics: StrategyMetrics;
  protected taskPatterns: TaskPattern[];
  protected cache: Map<string, DecompositionResult>;
  protected config: SwarmConfig;

  constructor(config: SwarmConfig) {
    this.config = config;
    this.metrics = this.initializeMetrics();
    this.taskPatterns = this.initializeTaskPatterns();
    this.cache = new Map();
  }

  // Abstract methods that must be implemented by concrete strategies
  abstract decomposeObjective(objective: SwarmObjective): Promise<DecompositionResult>;
  abstract selectAgentForTask(task: TaskDefinition, availableAgents: AgentState[]): Promise<string | null>;
  abstract optimizeTaskSchedule(tasks: TaskDefinition[], agents: AgentState[]): Promise<AgentAllocation[]>;

  // Common utility methods
  protected initializeMetrics(): StrategyMetrics {
    return {
      tasksCompleted: 0,
      averageExecutionTime: 0,
      successRate: 0,
      resourceUtilization: 0,
      parallelismEfficiency: 0,
      cacheHitRate: 0,
      predictionAccuracy: 0
    };
  }

  protected initializeTaskPatterns(): TaskPattern[] {
    return [
      {
        pattern: /create|build|implement|develop/i,
        type: 'development',
        complexity: 3,
        estimatedDuration: 15 * 60 * 1000,
        requiredAgents: 2,
        priority: 2
      },
      {
        pattern: /test|verify|validate/i,
        type: 'testing',
        complexity: 2,
        estimatedDuration: 8 * 60 * 1000,
        requiredAgents: 1,
        priority: 1
      },
      {
        pattern: /analyze|research|investigate/i,
        type: 'analysis',
        complexity: 2,
        estimatedDuration: 10 * 60 * 1000,
        requiredAgents: 1,
        priority: 1
      },
      {
        pattern: /document|write|explain/i,
        type: 'documentation',
        complexity: 1,
        estimatedDuration: 5 * 60 * 1000,
        requiredAgents: 1,
        priority: 0
      },
      {
        pattern: /optimize|improve|refactor/i,
        type: 'optimization',
        complexity: 3,
        estimatedDuration: 12 * 60 * 1000,
        requiredAgents: 2,
        priority: 1
      }
    ];
  }

  protected detectTaskType(description: string): string {
    for (const pattern of this.taskPatterns) {
      if (pattern.pattern.test(description)) {
        return pattern.type;
      }
    }
    return 'generic';
  }

  protected estimateComplexity(description: string): number {
    const pattern = this.taskPatterns.find(p => p.pattern.test(description));
    if (pattern) {
      return pattern.complexity;
    }

    // Fallback complexity estimation based on description length and keywords
    let complexity = 1;
    const words = description.split(' ').length;
    
    if (words > 50) complexity += 1;
    if (words > 100) complexity += 1;
    
    const complexKeywords = ['integrate', 'complex', 'advanced', 'multiple', 'system'];
    const foundKeywords = complexKeywords.filter(keyword => 
      description.toLowerCase().includes(keyword)
    ).length;
    
    complexity += foundKeywords;
    
    return Math.min(complexity, 5); // Cap at 5
  }

  protected getCacheKey(objective: SwarmObjective): string {
    return `${objective.strategy}-${objective.description.slice(0, 100)}`;
  }

  protected updateMetrics(result: DecompositionResult, executionTime: number): void {
    this.metrics.tasksCompleted += result.tasks.length;
    this.metrics.averageExecutionTime = 
      (this.metrics.averageExecutionTime + executionTime) / 2;
  }

  public getMetrics(): StrategyMetrics {
    return { ...this.metrics };
  }

  public clearCache(): void {
    this.cache.clear();
  }
}