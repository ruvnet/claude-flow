/**
 * V3 Task Lifecycle Hooks
 *
 * Provides pre-task and post-task hooks for task execution lifecycle.
 * Integrates with ReasoningBank for learning and pattern recognition.
 *
 * @module v3/shared/hooks/task-hooks
 */

import {
  HookEvent,
  HookContext,
  HookResult,
  HookPriority,
  TaskInfo,
} from './types.js';
import { HookRegistry } from './registry.js';

/**
 * Pre-task hook result with agent suggestions
 */
export interface PreTaskHookResult extends HookResult {
  /** Suggested agents for the task */
  suggestedAgents?: AgentSuggestion[];
  /** Task complexity estimation */
  complexity?: 'low' | 'medium' | 'high';
  /** Estimated duration in milliseconds */
  estimatedDuration?: number;
  /** Related patterns from ReasoningBank */
  patterns?: TaskPattern[];
  /** Potential risks */
  risks?: string[];
  /** Recommendations */
  recommendations?: string[];
}

/**
 * Post-task hook result with learning data
 */
export interface PostTaskHookResult extends HookResult {
  /** Task outcome */
  outcome?: TaskOutcome;
  /** Learning updates applied */
  learningUpdates?: LearningUpdate;
  /** Pattern ID if a new pattern was created */
  patternId?: string;
  /** Trajectory ID for ReasoningBank */
  trajectoryId?: string;
}

/**
 * Agent suggestion for task routing
 */
export interface AgentSuggestion {
  /** Agent type */
  type: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Reason for suggestion */
  reason: string;
  /** Capabilities relevant to this task */
  capabilities?: string[];
}

/**
 * Task pattern from ReasoningBank
 */
export interface TaskPattern {
  /** Pattern identifier */
  id: string;
  /** Pattern description */
  description: string;
  /** Match score (0-1) */
  matchScore: number;
  /** Historical success rate */
  successRate: number;
  /** Average duration in ms */
  avgDuration: number;
  /** Recommended strategies */
  strategies?: string[];
}

/**
 * Task outcome for learning
 */
export interface TaskOutcome {
  /** Whether the task succeeded */
  success: boolean;
  /** Duration in milliseconds */
  duration: number;
  /** Quality score (0-1) */
  quality?: number;
  /** Error details if failed */
  error?: string;
  /** Output artifacts */
  artifacts?: string[];
  /** Agent that executed the task */
  agent?: string;
}

/**
 * Learning update result
 */
export interface LearningUpdate {
  /** Number of patterns updated */
  patternsUpdated: number;
  /** Number of new patterns created */
  newPatterns: number;
  /** Confidence adjustments made */
  confidenceAdjusted: number;
  /** Trajectories recorded */
  trajectoriesRecorded: number;
}

/**
 * Task store for tracking active tasks
 */
interface TaskStore {
  taskId: string;
  description: string;
  startTime: number;
  metadata?: Record<string, unknown>;
  suggestedAgents?: AgentSuggestion[];
}

/**
 * Task Hooks Manager
 *
 * Manages pre-task and post-task hooks with ReasoningBank integration.
 */
export class TaskHooksManager {
  private registry: HookRegistry;
  private activeTasks: Map<string, TaskStore> = new Map();
  private taskPatterns: Map<string, TaskPattern[]> = new Map();

  constructor(registry: HookRegistry) {
    this.registry = registry;
    this.registerDefaultHooks();
  }

  /**
   * Register default task hooks
   */
  private registerDefaultHooks(): void {
    // Pre-task hook for agent suggestion
    this.registry.register(
      HookEvent.PreTaskExecute,
      this.handlePreTask.bind(this),
      HookPriority.Normal,
      { name: 'task-hooks:pre-task' }
    );

    // Post-task hook for learning
    this.registry.register(
      HookEvent.PostTaskExecute,
      this.handlePostTask.bind(this),
      HookPriority.Normal,
      { name: 'task-hooks:post-task' }
    );
  }

  /**
   * Handle pre-task execution
   */
  async handlePreTask(context: HookContext): Promise<PreTaskHookResult> {
    const task = context.task;
    if (!task) {
      return { success: false, error: new Error('No task in context') };
    }

    // Store task for tracking
    const taskStore: TaskStore = {
      taskId: task.id,
      description: task.description,
      startTime: Date.now(),
      metadata: task.metadata,
    };

    // Analyze task and suggest agents
    const analysis = await this.analyzeTask(task);

    taskStore.suggestedAgents = analysis.suggestedAgents;
    this.activeTasks.set(task.id, taskStore);

    // Store patterns for this task
    if (analysis.patterns.length > 0) {
      this.taskPatterns.set(task.id, analysis.patterns);
    }

    return {
      success: true,
      suggestedAgents: analysis.suggestedAgents,
      complexity: analysis.complexity,
      estimatedDuration: analysis.estimatedDuration,
      patterns: analysis.patterns,
      risks: analysis.risks,
      recommendations: analysis.recommendations,
      data: {
        task: {
          ...task,
          metadata: {
            ...task.metadata,
            suggestedAgents: analysis.suggestedAgents.map(a => a.type),
            complexity: analysis.complexity,
          },
        },
      },
    };
  }

  /**
   * Handle post-task execution
   */
  async handlePostTask(context: HookContext): Promise<PostTaskHookResult> {
    const task = context.task;
    if (!task) {
      return { success: false, error: new Error('No task in context') };
    }

    const taskStore = this.activeTasks.get(task.id);
    const patterns = this.taskPatterns.get(task.id);

    // Calculate duration
    const duration = taskStore ? Date.now() - taskStore.startTime : 0;

    // Extract outcome from context metadata
    const success = context.metadata?.success !== false;
    const quality = context.metadata?.quality as number | undefined;
    const error = context.metadata?.error as string | undefined;
    const agent = context.metadata?.agent as string | undefined;

    const outcome: TaskOutcome = {
      success,
      duration,
      quality,
      error,
      agent,
      artifacts: context.metadata?.artifacts as string[] | undefined,
    };

    // Record learning trajectory
    const learningUpdates = await this.recordLearning(task, outcome, patterns);

    // Clean up
    this.activeTasks.delete(task.id);
    this.taskPatterns.delete(task.id);

    return {
      success: true,
      outcome,
      learningUpdates,
      patternId: learningUpdates.newPatterns > 0 ? `pattern-${task.id}` : undefined,
      trajectoryId: `trajectory-${task.id}-${Date.now()}`,
    };
  }

  /**
   * Analyze task for agent suggestions and patterns
   */
  private async analyzeTask(task: TaskInfo): Promise<{
    suggestedAgents: AgentSuggestion[];
    complexity: 'low' | 'medium' | 'high';
    estimatedDuration: number;
    patterns: TaskPattern[];
    risks: string[];
    recommendations: string[];
  }> {
    const description = task.description.toLowerCase();

    // Pattern-based agent suggestion
    const suggestedAgents: AgentSuggestion[] = [];
    const patterns: TaskPattern[] = [];
    const risks: string[] = [];
    const recommendations: string[] = [];

    // Analyze task keywords for agent routing
    const agentPatterns: Array<{
      keywords: string[];
      agent: string;
      capabilities: string[];
    }> = [
      {
        keywords: ['implement', 'code', 'create', 'build', 'develop', 'write'],
        agent: 'coder',
        capabilities: ['code-generation', 'implementation', 'debugging'],
      },
      {
        keywords: ['test', 'spec', 'coverage', 'unit', 'integration'],
        agent: 'tester',
        capabilities: ['unit-testing', 'integration-testing', 'coverage-analysis'],
      },
      {
        keywords: ['review', 'check', 'audit', 'analyze'],
        agent: 'reviewer',
        capabilities: ['code-review', 'quality-analysis', 'best-practices'],
      },
      {
        keywords: ['research', 'investigate', 'explore', 'study'],
        agent: 'researcher',
        capabilities: ['research', 'analysis', 'documentation'],
      },
      {
        keywords: ['security', 'vulnerability', 'cve', 'threat'],
        agent: 'security-architect',
        capabilities: ['security-analysis', 'vulnerability-detection', 'threat-modeling'],
      },
      {
        keywords: ['performance', 'optimize', 'speed', 'memory'],
        agent: 'performance-engineer',
        capabilities: ['performance-optimization', 'profiling', 'benchmarking'],
      },
      {
        keywords: ['architect', 'design', 'structure', 'pattern'],
        agent: 'core-architect',
        capabilities: ['architecture-design', 'pattern-application', 'system-design'],
      },
      {
        keywords: ['memory', 'storage', 'database', 'cache'],
        agent: 'memory-specialist',
        capabilities: ['memory-management', 'data-persistence', 'caching'],
      },
      {
        keywords: ['swarm', 'coordinate', 'orchestrate', 'agent'],
        agent: 'swarm-specialist',
        capabilities: ['swarm-coordination', 'agent-orchestration', 'distributed-systems'],
      },
    ];

    // Score each agent based on keyword matches
    for (const pattern of agentPatterns) {
      let matchCount = 0;
      for (const keyword of pattern.keywords) {
        if (description.includes(keyword)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const confidence = Math.min(0.3 + matchCount * 0.2, 0.95);
        suggestedAgents.push({
          type: pattern.agent,
          confidence,
          reason: `Matched keywords: ${pattern.keywords.filter(k => description.includes(k)).join(', ')}`,
          capabilities: pattern.capabilities,
        });
      }
    }

    // Sort by confidence
    suggestedAgents.sort((a, b) => b.confidence - a.confidence);

    // If no matches, default to coder
    if (suggestedAgents.length === 0) {
      suggestedAgents.push({
        type: 'coder',
        confidence: 0.5,
        reason: 'Default agent for unclassified tasks',
        capabilities: ['code-generation', 'implementation'],
      });
    }

    // Estimate complexity based on description length and keywords
    let complexity: 'low' | 'medium' | 'high' = 'medium';
    const complexityKeywords = ['complex', 'large', 'multiple', 'refactor', 'redesign', 'critical'];
    const simpleKeywords = ['simple', 'small', 'quick', 'fix', 'minor', 'typo'];

    const hasComplexKeywords = complexityKeywords.some(k => description.includes(k));
    const hasSimpleKeywords = simpleKeywords.some(k => description.includes(k));

    if (hasComplexKeywords) {
      complexity = 'high';
    } else if (hasSimpleKeywords) {
      complexity = 'low';
    } else if (description.length > 200) {
      complexity = 'high';
    } else if (description.length < 50) {
      complexity = 'low';
    }

    // Estimate duration based on complexity
    const durationMap = {
      low: 5 * 60 * 1000,      // 5 minutes
      medium: 30 * 60 * 1000,  // 30 minutes
      high: 2 * 60 * 60 * 1000, // 2 hours
    };
    const estimatedDuration = durationMap[complexity];

    // Detect risks
    if (description.includes('production') || description.includes('live')) {
      risks.push('Task involves production environment');
    }
    if (description.includes('delete') || description.includes('remove')) {
      risks.push('Task involves destructive operations');
    }
    if (description.includes('security') || description.includes('auth')) {
      risks.push('Task involves security-sensitive operations');
    }
    if (description.includes('database') || description.includes('migration')) {
      risks.push('Task involves database changes');
    }

    // Add recommendations
    if (complexity === 'high') {
      recommendations.push('Consider breaking this task into smaller subtasks');
    }
    if (suggestedAgents.length > 1) {
      recommendations.push('Consider using multiple agents for better coverage');
    }
    if (risks.length > 0) {
      recommendations.push('Review risks before proceeding');
    }

    return {
      suggestedAgents,
      complexity,
      estimatedDuration,
      patterns,
      risks,
      recommendations,
    };
  }

  /**
   * Record learning trajectory
   */
  private async recordLearning(
    task: TaskInfo,
    outcome: TaskOutcome,
    patterns?: TaskPattern[]
  ): Promise<LearningUpdate> {
    // In a real implementation, this would integrate with ReasoningBank
    // For now, we track basic statistics

    const learningUpdate: LearningUpdate = {
      patternsUpdated: patterns?.length || 0,
      newPatterns: outcome.success ? 1 : 0,
      confidenceAdjusted: patterns?.length || 0,
      trajectoriesRecorded: 1,
    };

    return learningUpdate;
  }

  /**
   * Execute pre-task hook manually
   */
  async executePreTask(
    taskId: string,
    description: string,
    metadata?: Record<string, unknown>
  ): Promise<PreTaskHookResult> {
    const context: HookContext = {
      event: HookEvent.PreTaskExecute,
      timestamp: new Date(),
      task: {
        id: taskId,
        description,
        metadata,
      },
    };

    return this.handlePreTask(context);
  }

  /**
   * Execute post-task hook manually
   */
  async executePostTask(
    taskId: string,
    success: boolean,
    metadata?: Record<string, unknown>
  ): Promise<PostTaskHookResult> {
    const taskStore = this.activeTasks.get(taskId);

    const context: HookContext = {
      event: HookEvent.PostTaskExecute,
      timestamp: new Date(),
      task: {
        id: taskId,
        description: taskStore?.description || 'Unknown task',
        metadata: taskStore?.metadata,
      },
      metadata: {
        ...metadata,
        success,
      },
    };

    return this.handlePostTask(context);
  }

  /**
   * Get active tasks
   */
  getActiveTasks(): Map<string, TaskStore> {
    return new Map(this.activeTasks);
  }

  /**
   * Clear all active tasks
   */
  clearActiveTasks(): void {
    this.activeTasks.clear();
    this.taskPatterns.clear();
  }
}

/**
 * Create task hooks manager
 */
export function createTaskHooksManager(registry: HookRegistry): TaskHooksManager {
  return new TaskHooksManager(registry);
}
