import { AIProviderManager } from './ai-provider.ts';
import { AIRequest, AIResponse } from '../types/ai-types.ts';
import {
  ParsedPRD,
  Requirement,
  Constraint,
  ComplexityAnalysis,
  GeneratedTask,
  TaskTree,
  SPARCWorkflow,
  SPARCPhase,
  Priority,
  Complexity,
  RequirementDependency,
  DependencyType
} from '../types/prd-types.ts';

export interface TaskGenerationOptions {
  includeSPARCMapping?: boolean;
  generateSubtasks?: boolean;
  maxTaskComplexity?: Complexity;
  preferredTeamSize?: number;
  timeConstraint?: number;
  budgetConstraint?: number;
  agentPreferences?: string[];
  detailLevel?: 'high' | 'medium' | 'low';
}

export class SmartTaskGenerator {
  private aiProvider: AIProviderManager;
  private taskIdCounter: number = 1;

  constructor(aiProvider: AIProviderManager) {
    this.aiProvider = aiProvider;
  }

  async generateTasks(
    prd: ParsedPRD,
    options: TaskGenerationOptions = {}
  ): Promise<TaskTree> {
    try {
      // Step 1: Generate initial tasks from requirements
      const initialTasks = await this.generateTasksFromRequirements(
        prd.requirements,
        prd.complexity,
        options
      );

      // Step 2: Detect and resolve dependencies
      const dependencies = await this.detectDependencies(initialTasks, prd.requirements);

      // Step 3: Optimize task breakdown
      const optimizedTasks = await this.optimizeTaskBreakdown(initialTasks, dependencies);

      // Step 4: Map to SPARC phases if requested
      let sparcMapping: Record<SPARCPhase, GeneratedTask[]> = {} as any;
      if (options.includeSPARCMapping) {
        sparcMapping = await this.mapToSPARCPhases(optimizedTasks);
      }

      // Step 5: Calculate effort estimates
      const totalEffort = this.calculateTotalEffort(optimizedTasks);

      // Step 6: Identify critical path
      const criticalPath = this.calculateCriticalPath(optimizedTasks, dependencies);

      return {
        rootTasks: optimizedTasks,
        dependencies,
        totalTasks: optimizedTasks.length,
        estimatedTotalEffort: totalEffort,
        criticalPath,
        phases: sparcMapping
      };
    } catch (error) {
      throw new Error(`Task generation failed: ${error}`);
    }
  }

  private async generateTasksFromRequirements(
    requirements: Requirement[],
    complexity: ComplexityAnalysis,
    options: TaskGenerationOptions
  ): Promise<GeneratedTask[]> {
    const tasks: GeneratedTask[] = [];

    for (const requirement of requirements) {
      const aiRequest: AIRequest = {
        type: 'structured-output',
        content: `Generate specific, actionable tasks for this requirement. Break down complex requirements into smaller, manageable tasks.

Requirement: ${requirement.title}
Description: ${requirement.description}
Type: ${requirement.type}
Priority: ${requirement.priority}
Complexity: ${requirement.complexity}
Estimated Effort: ${requirement.estimatedEffort}

Project Context:
- Overall Complexity: ${complexity.overallComplexity}
- Team Size: ${options.preferredTeamSize || 3}
- Time Constraint: ${options.timeConstraint || 'none'}

Generate tasks as JSON array where each task has:
- title: clear, actionable task title
- description: detailed description with acceptance criteria
- estimatedEffort: hours or story points
- complexity: low, medium, or high
- priority: inherit from requirement or adjust based on dependencies
- tags: relevant technology/domain tags
- suggestedAgent: recommended SPARC agent type
- subtasks: array of smaller tasks if complex

Focus on creating atomic, testable tasks that contribute to completing the requirement.`,
        systemPrompt: 'You are an expert project manager and software architect. Generate clear, actionable tasks that are properly scoped and realistic. Always return valid JSON array.'
      };

      try {
        const response = await this.aiProvider.executeWithFallback(aiRequest);
        const requirementTasks = JSON.parse(response.content);

        for (const taskData of requirementTasks) {
          const task: GeneratedTask = {
            id: this.generateTaskId(),
            title: taskData.title,
            description: taskData.description,
            sparcPhase: this.determineSparcPhase(taskData, requirement),
            requirementIds: [requirement.id],
            dependencies: [],
            estimatedEffort: taskData.estimatedEffort || requirement.estimatedEffort,
            priority: taskData.priority || requirement.priority,
            complexity: taskData.complexity || requirement.complexity,
            acceptanceCriteria: this.extractAcceptanceCriteria(taskData.description),
            suggestedAgent: taskData.suggestedAgent || this.suggestAgent(taskData, requirement),
            tags: this.generateTags(taskData, requirement)
          };

          tasks.push(task);

          // Generate subtasks if requested and task is complex
          if (options.generateSubtasks && task.complexity === 'high' && taskData.subtasks) {
            const subtasks = await this.generateSubtasks(task, taskData.subtasks, requirement);
            tasks.push(...subtasks);
          }
        }
      } catch (error) {
        console.warn(`Failed to generate tasks for requirement ${requirement.id}: ${error}`);
        // Fallback to basic task generation
        const fallbackTask = this.generateFallbackTask(requirement);
        tasks.push(fallbackTask);
      }
    }

    return this.deduplicateTasks(tasks);
  }

  private async detectDependencies(
    tasks: GeneratedTask[],
    requirements: Requirement[]
  ): Promise<RequirementDependency[]> {
    const dependencies: RequirementDependency[] = [];

    // First, detect explicit dependencies from requirements
    for (const requirement of requirements) {
      for (const depId of requirement.dependencies) {
        dependencies.push({
          fromRequirement: requirement.id,
          toRequirement: depId,
          type: 'prerequisite',
          description: `${requirement.title} depends on completion of ${depId}`
        });
      }
    }

    // Then, use AI to detect implicit dependencies
    const aiRequest: AIRequest = {
      type: 'analysis',
      content: `Analyze these tasks and identify implicit dependencies between them. Look for logical sequences, shared resources, and technical dependencies.

Tasks:
${tasks.map(t => `- ${t.id}: ${t.title} (${t.sparcPhase})`).join('\n')}

Requirements Dependencies:
${dependencies.map(d => `- ${d.fromRequirement} -> ${d.toRequirement}`).join('\n')}

Return JSON array of additional dependencies with:
- fromTask: source task ID
- toTask: dependent task ID  
- type: prerequisite, dependent, related, conflicting, or alternative
- reasoning: why this dependency exists
- strength: low, medium, or high

Focus on identifying:
1. Technical dependencies (API before frontend)
2. Logical sequences (design before implementation)
3. Resource conflicts (parallel vs sequential)
4. SPARC phase ordering (spec before arch before implementation)`,
      systemPrompt: 'You are a project planning expert. Identify realistic task dependencies that ensure proper sequencing and resource allocation. Always return valid JSON array.'
    };

    try {
      const response = await this.aiProvider.executeWithFallback(aiRequest);
      const implicitDeps = JSON.parse(response.content);

      for (const dep of implicitDeps) {
        dependencies.push({
          fromRequirement: dep.fromTask,
          toRequirement: dep.toTask,
          type: dep.type as DependencyType,
          description: dep.reasoning
        });
      }
    } catch (error) {
      console.warn(`Failed to detect implicit dependencies: ${error}`);
      // Fallback to basic SPARC phase ordering
      this.addBasicSparcDependencies(tasks, dependencies);
    }

    return this.removeCyclicDependencies(dependencies);
  }

  private async optimizeTaskBreakdown(
    tasks: GeneratedTask[],
    dependencies: RequirementDependency[]
  ): Promise<GeneratedTask[]> {
    const aiRequest: AIRequest = {
      type: 'structured-output',
      content: `Optimize this task breakdown for better execution. Consider task sizing, dependencies, and team efficiency.

Current Tasks:
${tasks.map(t => `${t.id}: ${t.title} (${t.estimatedEffort}h, ${t.complexity})`).join('\n')}

Dependencies:
${dependencies.map(d => `${d.fromRequirement} -> ${d.toRequirement}`).join('\n')}

Optimization Goals:
1. Ensure tasks are properly sized (4-16 hours ideal)
2. Minimize blocking dependencies
3. Enable parallel work streams
4. Balance complexity across team members
5. Group related tasks for efficiency

Return JSON with:
- optimizedTasks: array of task modifications
- newTasks: array of additional tasks needed
- removedTasks: array of task IDs to remove
- reasoning: explanation of changes

For each task modification include:
- taskId: ID of task to modify
- changes: object with fields to update
- reasoning: why this change improves the breakdown`,
      systemPrompt: 'You are an agile project optimization expert. Focus on creating realistic, well-sized tasks that teams can execute efficiently. Always return valid JSON.'
    };

    try {
      const response = await this.aiProvider.executeWithFallback(aiRequest);
      const optimization = JSON.parse(response.content);

      let optimizedTasks = [...tasks];

      // Apply task modifications
      if (optimization.optimizedTasks) {
        for (const mod of optimization.optimizedTasks) {
          const taskIndex = optimizedTasks.findIndex(t => t.id === mod.taskId);
          if (taskIndex >= 0) {
            optimizedTasks[taskIndex] = { ...optimizedTasks[taskIndex], ...mod.changes };
          }
        }
      }

      // Add new tasks
      if (optimization.newTasks) {
        for (const newTaskData of optimization.newTasks) {
          const newTask: GeneratedTask = {
            id: this.generateTaskId(),
            title: newTaskData.title,
            description: newTaskData.description,
            sparcPhase: newTaskData.sparcPhase || 'refinement',
            requirementIds: newTaskData.requirementIds || [],
            dependencies: newTaskData.dependencies || [],
            estimatedEffort: newTaskData.estimatedEffort || 4,
            priority: newTaskData.priority || 'should_have',
            complexity: newTaskData.complexity || 'medium',
            acceptanceCriteria: newTaskData.acceptanceCriteria || [],
            suggestedAgent: newTaskData.suggestedAgent,
            tags: newTaskData.tags || []
          };
          optimizedTasks.push(newTask);
        }
      }

      // Remove tasks
      if (optimization.removedTasks) {
        optimizedTasks = optimizedTasks.filter(t => !optimization.removedTasks.includes(t.id));
      }

      return optimizedTasks;
    } catch (error) {
      console.warn(`Failed to optimize task breakdown: ${error}`);
      return this.applyBasicOptimization(tasks);
    }
  }

  private async mapToSPARCPhases(tasks: GeneratedTask[]): Promise<Record<SPARCPhase, GeneratedTask[]>> {
    const phases: Record<SPARCPhase, GeneratedTask[]> = {
      specification: [],
      pseudocode: [],
      architecture: [],
      refinement: [],
      completion: []
    };

    for (const task of tasks) {
      // Use AI to refine phase mapping if not already set
      if (!task.sparcPhase || task.sparcPhase === 'refinement') {
        const refinedPhase = await this.refineSparcPhaseMapping(task);
        task.sparcPhase = refinedPhase;
      }

      phases[task.sparcPhase].push(task);
    }

    return phases;
  }

  private async refineSparcPhaseMapping(task: GeneratedTask): Promise<SPARCPhase> {
    const aiRequest: AIRequest = {
      type: 'analysis',
      content: `Determine the most appropriate SPARC phase for this task:

Task: ${task.title}
Description: ${task.description}
Tags: ${task.tags.join(', ')}

SPARC Phases:
- specification: Requirements analysis, planning, user stories
- pseudocode: Algorithm design, logic planning, data flow
- architecture: System design, component structure, technical architecture
- refinement: Implementation, coding, testing, debugging
- completion: Integration, deployment, documentation, validation

Return only the phase name (lowercase) that best fits this task.`,
      systemPrompt: 'You are a SPARC methodology expert. Choose the most appropriate phase based on the task content and nature.'
    };

    try {
      const response = await this.aiProvider.executeWithFallback(aiRequest);
      const phase = response.content.trim().toLowerCase() as SPARCPhase;
      
      // Validate the phase
      if (['specification', 'pseudocode', 'architecture', 'refinement', 'completion'].includes(phase)) {
        return phase;
      }
    } catch (error) {
      console.warn(`Failed to refine SPARC phase mapping for task ${task.id}: ${error}`);
    }

    // Fallback to basic heuristics
    return this.determineSparcPhase(task, null);
  }

  private determineSparcPhase(taskData: any, requirement: Requirement | null): SPARCPhase {
    const title = taskData.title?.toLowerCase() || '';
    const description = taskData.description?.toLowerCase() || '';
    const content = `${title} ${description}`;

    // Specification phase keywords
    if (content.includes('requirement') || content.includes('specify') || 
        content.includes('analyze') || content.includes('define') || 
        content.includes('plan') || content.includes('gather')) {
      return 'specification';
    }

    // Pseudocode phase keywords
    if (content.includes('algorithm') || content.includes('logic') || 
        content.includes('flow') || content.includes('pseudocode') || 
        content.includes('approach') || content.includes('method')) {
      return 'pseudocode';
    }

    // Architecture phase keywords
    if (content.includes('architecture') || content.includes('design') || 
        content.includes('structure') || content.includes('component') || 
        content.includes('system') || content.includes('model')) {
      return 'architecture';
    }

    // Completion phase keywords
    if (content.includes('deploy') || content.includes('integrate') || 
        content.includes('document') || content.includes('validate') || 
        content.includes('test') || content.includes('review')) {
      return 'completion';
    }

    // Default to refinement (implementation)
    return 'refinement';
  }

  private suggestAgent(taskData: any, requirement: Requirement): string {
    const content = `${taskData.title} ${taskData.description}`.toLowerCase();
    
    if (content.includes('test') || content.includes('quality')) return 'tdd';
    if (content.includes('security') || content.includes('audit')) return 'security-review';
    if (content.includes('architecture') || content.includes('design')) return 'architect';
    if (content.includes('document') || content.includes('spec')) return 'docs-writer';
    if (content.includes('deploy') || content.includes('infrastructure')) return 'devops';
    if (content.includes('debug') || content.includes('fix')) return 'debug';
    if (content.includes('optimize') || content.includes('performance')) return 'refinement-optimization-mode';
    
    return 'code'; // Default agent
  }

  private generateTags(taskData: any, requirement: Requirement): string[] {
    const tags: string[] = [];
    const content = `${taskData.title} ${taskData.description}`.toLowerCase();
    
    // Technology tags
    if (content.includes('api') || content.includes('rest')) tags.push('api');
    if (content.includes('database') || content.includes('sql')) tags.push('database');
    if (content.includes('frontend') || content.includes('ui')) tags.push('frontend');
    if (content.includes('backend') || content.includes('server')) tags.push('backend');
    if (content.includes('test') || content.includes('testing')) tags.push('testing');
    if (content.includes('security') || content.includes('auth')) tags.push('security');
    if (content.includes('performance') || content.includes('optimize')) tags.push('performance');
    
    // Requirement type tag
    tags.push(requirement.type);
    
    // Priority tag
    tags.push(requirement.priority);
    
    return tags;
  }

  private extractAcceptanceCriteria(description: string): string[] {
    const criteria: string[] = [];
    
    // Look for Given/When/Then patterns
    const gwtRegex = /(?:given|when|then)\s+([^.!?]+[.!?])/gi;
    let match;
    while ((match = gwtRegex.exec(description)) !== null) {
      criteria.push(match[0].trim());
    }
    
    // Look for bullet points with criteria keywords
    const bulletRegex = /[•\-*]\s+([^.\n]+(?:should|must|will|can)[^.\n]*)/gi;
    while ((match = bulletRegex.exec(description)) !== null) {
      criteria.push(match[1].trim());
    }
    
    // If no specific criteria found, generate basic ones
    if (criteria.length === 0) {
      criteria.push('Task should be completed successfully');
      criteria.push('All requirements should be met');
      criteria.push('Quality standards should be maintained');
    }
    
    return criteria;
  }

  private async generateSubtasks(
    parentTask: GeneratedTask,
    subtaskData: any[],
    requirement: Requirement
  ): Promise<GeneratedTask[]> {
    const subtasks: GeneratedTask[] = [];

    for (const subData of subtaskData) {
      const subtask: GeneratedTask = {
        id: this.generateTaskId(),
        title: `${parentTask.title} - ${subData.title}`,
        description: subData.description,
        sparcPhase: parentTask.sparcPhase,
        requirementIds: [requirement.id],
        dependencies: [parentTask.id],
        estimatedEffort: subData.estimatedEffort || Math.ceil(parentTask.estimatedEffort / subtaskData.length),
        priority: parentTask.priority,
        complexity: 'low', // Subtasks should be simpler
        acceptanceCriteria: this.extractAcceptanceCriteria(subData.description),
        suggestedAgent: parentTask.suggestedAgent,
        tags: [...parentTask.tags, 'subtask']
      };

      subtasks.push(subtask);
    }

    return subtasks;
  }

  private generateFallbackTask(requirement: Requirement): GeneratedTask {
    return {
      id: this.generateTaskId(),
      title: `Implement ${requirement.title}`,
      description: requirement.description,
      sparcPhase: 'refinement',
      requirementIds: [requirement.id],
      dependencies: [],
      estimatedEffort: requirement.estimatedEffort,
      priority: requirement.priority,
      complexity: requirement.complexity,
      acceptanceCriteria: requirement.acceptanceCriteria,
      suggestedAgent: 'code',
      tags: [requirement.type, requirement.priority]
    };
  }

  private deduplicateTasks(tasks: GeneratedTask[]): GeneratedTask[] {
    const seen = new Set<string>();
    const deduplicated: GeneratedTask[] = [];

    for (const task of tasks) {
      const key = task.title.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(task);
      }
    }

    return deduplicated;
  }

  private addBasicSparcDependencies(
    tasks: GeneratedTask[],
    dependencies: RequirementDependency[]
  ): void {
    const phaseOrder: SPARCPhase[] = ['specification', 'pseudocode', 'architecture', 'refinement', 'completion'];
    
    // Add phase-based dependencies
    for (let i = 0; i < phaseOrder.length - 1; i++) {
      const currentPhase = phaseOrder[i];
      const nextPhase = phaseOrder[i + 1];
      
      const currentTasks = tasks.filter(t => t.sparcPhase === currentPhase);
      const nextTasks = tasks.filter(t => t.sparcPhase === nextPhase);
      
      for (const currentTask of currentTasks) {
        for (const nextTask of nextTasks) {
          // Check if they share requirements
          const sharedReqs = currentTask.requirementIds.some(id => 
            nextTask.requirementIds.includes(id)
          );
          
          if (sharedReqs) {
            dependencies.push({
              fromRequirement: nextTask.id,
              toRequirement: currentTask.id,
              type: 'prerequisite',
              description: `${nextPhase} phase depends on ${currentPhase} phase completion`
            });
          }
        }
      }
    }
  }

  private removeCyclicDependencies(dependencies: RequirementDependency[]): RequirementDependency[] {
    // Simple cycle detection and removal
    const graph = new Map<string, Set<string>>();
    
    // Build adjacency list
    for (const dep of dependencies) {
      if (!graph.has(dep.fromRequirement)) {
        graph.set(dep.fromRequirement, new Set());
      }
      graph.get(dep.fromRequirement)!.add(dep.toRequirement);
    }
    
    // Remove cycles using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cyclicEdges = new Set<string>();
    
    const hasCycle = (node: string): boolean => {
      visited.add(node);
      recursionStack.add(node);
      
      const neighbors = graph.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) {
            cyclicEdges.add(`${node}->${neighbor}`);
            return true;
          }
        } else if (recursionStack.has(neighbor)) {
          cyclicEdges.add(`${node}->${neighbor}`);
          return true;
        }
      }
      
      recursionStack.delete(node);
      return false;
    };
    
    // Check all nodes
    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        hasCycle(node);
      }
    }
    
    // Remove cyclic dependencies
    return dependencies.filter(dep => 
      !cyclicEdges.has(`${dep.fromRequirement}->${dep.toRequirement}`)
    );
  }

  private applyBasicOptimization(tasks: GeneratedTask[]): GeneratedTask[] {
    return tasks.map(task => {
      // Ensure tasks are reasonably sized (4-16 hours)
      if (task.estimatedEffort > 16) {
        task.complexity = 'high';
        task.description += '\n\nNote: This task may need to be broken down further.';
      } else if (task.estimatedEffort < 2) {
        task.estimatedEffort = 2; // Minimum viable task size
      }
      
      return task;
    });
  }

  private calculateTotalEffort(tasks: GeneratedTask[]): number {
    return tasks.reduce((total, task) => total + task.estimatedEffort, 0);
  }

  private calculateCriticalPath(
    tasks: GeneratedTask[],
    dependencies: RequirementDependency[]
  ): string[] {
    // Simplified critical path calculation
    // In a real implementation, this would use proper CPM algorithm
    
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const dependencyMap = new Map<string, string[]>();
    
    // Build dependency map
    for (const dep of dependencies) {
      if (!dependencyMap.has(dep.fromRequirement)) {
        dependencyMap.set(dep.fromRequirement, []);
      }
      dependencyMap.get(dep.fromRequirement)!.push(dep.toRequirement);
    }
    
    // Find tasks with highest effort and most dependencies
    const criticalTasks = tasks
      .sort((a, b) => b.estimatedEffort - a.estimatedEffort)
      .slice(0, Math.ceil(tasks.length * 0.3))
      .map(t => t.id);
    
    return criticalTasks;
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${this.taskIdCounter++}`;
  }
}