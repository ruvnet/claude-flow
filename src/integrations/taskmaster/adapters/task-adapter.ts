/**
 * Task Adapter Component
 * Handles conversion between TaskMaster and Claude-Flow task formats
 * Implements bidirectional mapping with validation and conflict resolution
 */

import {
  TaskMasterTask,
  ClaudeFlowTask,
  TaskMasterStatus,
  ClaudeFlowStatus,
  TaskMasterPriority,
  ClaudeFlowPriority,
  SPARCPhase,
  MappingConfig,
  MappingRule,
  ValidationResult,
  Conflict,
  Resolution
} from '../types/task-types.js';

export interface ITaskAdapter {
  // Core conversion methods
  toClaudeFlow(taskMasterTask: TaskMasterTask): ClaudeFlowTask;
  toTaskMaster(claudeFlowTask: ClaudeFlowTask): TaskMasterTask;
  
  // Batch operations
  batchToClaudeFlow(tasks: TaskMasterTask[]): ClaudeFlowTask[];
  batchToTaskMaster(tasks: ClaudeFlowTask[]): TaskMasterTask[];
  
  // Validation
  validateTaskConversion(task: any): ValidationResult;
  
  // Mapping configuration
  configureMappings(config: MappingConfig): void;
  
  // Conflict detection and resolution
  detectConflicts(tmTask: TaskMasterTask, cfTask: ClaudeFlowTask): Conflict[];
  resolveConflicts(conflicts: Conflict[], strategy?: 'taskmaster' | 'claudeflow' | 'merge'): Resolution[];
}

export class TaskAdapter implements ITaskAdapter {
  private mappingRules: MappingRule[];
  private statusMapping: Record<TaskMasterStatus, ClaudeFlowStatus>;
  private priorityMapping: Record<TaskMasterPriority, ClaudeFlowPriority>;
  private reverseStatusMapping: Record<ClaudeFlowStatus, TaskMasterStatus>;
  private reversePriorityMapping: Record<ClaudeFlowPriority, TaskMasterPriority>;

  constructor(config?: MappingConfig) {
    this.initializeDefaultMappings();
    if (config) {
      this.configureMappings(config);
    }
    this.setupMappingRules();
  }

  private initializeDefaultMappings(): void {
    // Status mappings
    this.statusMapping = {
      [TaskMasterStatus.TODO]: ClaudeFlowStatus.PENDING,
      [TaskMasterStatus.IN_PROGRESS]: ClaudeFlowStatus.IN_PROGRESS,
      [TaskMasterStatus.BLOCKED]: ClaudeFlowStatus.BLOCKED,
      [TaskMasterStatus.DONE]: ClaudeFlowStatus.COMPLETED,
      [TaskMasterStatus.CANCELLED]: ClaudeFlowStatus.CANCELLED
    };

    // Reverse status mappings
    this.reverseStatusMapping = {
      [ClaudeFlowStatus.PENDING]: TaskMasterStatus.TODO,
      [ClaudeFlowStatus.IN_PROGRESS]: TaskMasterStatus.IN_PROGRESS,
      [ClaudeFlowStatus.COMPLETED]: TaskMasterStatus.DONE,
      [ClaudeFlowStatus.BLOCKED]: TaskMasterStatus.BLOCKED,
      [ClaudeFlowStatus.CANCELLED]: TaskMasterStatus.CANCELLED
    };

    // Priority mappings  
    this.priorityMapping = {
      [TaskMasterPriority.LOW]: ClaudeFlowPriority.LOW,
      [TaskMasterPriority.MEDIUM]: ClaudeFlowPriority.MEDIUM,
      [TaskMasterPriority.HIGH]: ClaudeFlowPriority.HIGH,
      [TaskMasterPriority.CRITICAL]: ClaudeFlowPriority.HIGH // Map critical to high
    };

    // Reverse priority mappings
    this.reversePriorityMapping = {
      [ClaudeFlowPriority.LOW]: TaskMasterPriority.LOW,
      [ClaudeFlowPriority.MEDIUM]: TaskMasterPriority.MEDIUM,
      [ClaudeFlowPriority.HIGH]: TaskMasterPriority.HIGH
    };
  }

  private setupMappingRules(): void {
    this.mappingRules = [
      {
        source: 'taskmaster.priority',
        target: 'claudeflow.priority',
        transform: (value: TaskMasterPriority) => this.priorityMapping[value]
      },
      {
        source: 'taskmaster.status',
        target: 'claudeflow.status',
        transform: (value: TaskMasterStatus) => this.statusMapping[value]
      },
      {
        source: 'claudeflow.priority',
        target: 'taskmaster.priority', 
        transform: (value: ClaudeFlowPriority) => this.reversePriorityMapping[value]
      },
      {
        source: 'claudeflow.status',
        target: 'taskmaster.status',
        transform: (value: ClaudeFlowStatus) => this.reverseStatusMapping[value]
      }
    ];
  }

  public configureMappings(config: MappingConfig): void {
    if (config.statusMapping) {
      this.statusMapping = { ...this.statusMapping, ...config.statusMapping };
    }
    if (config.priorityMapping) {
      this.priorityMapping = { ...this.priorityMapping, ...config.priorityMapping };
    }
  }

  public toClaudeFlow(taskMasterTask: TaskMasterTask): ClaudeFlowTask {
    const validation = this.validateTaskConversion(taskMasterTask);
    if (!validation.isValid) {
      throw new Error(`Invalid TaskMaster task: ${validation.errors.join(', ')}`);
    }

    // Map SPARC phase from metadata or infer from task content
    let phase: SPARCPhase | undefined;
    if (taskMasterTask.metadata?.prd_section) {
      phase = this.inferSPARCPhase(taskMasterTask.metadata.prd_section);
    }

    // Determine appropriate agent based on task content and phase
    const agent = this.suggestAgent(taskMasterTask, phase);

    const claudeFlowTask: ClaudeFlowTask = {
      id: taskMasterTask.id,
      title: taskMasterTask.title,
      description: taskMasterTask.description,
      status: this.statusMapping[taskMasterTask.status],
      priority: this.priorityMapping[taskMasterTask.priority],
      phase,
      agent,
      dependencies: taskMasterTask.dependencies,
      estimatedHours: taskMasterTask.estimate,
      createdAt: taskMasterTask.createdAt,
      updatedAt: taskMasterTask.updatedAt,
      context: {
        sparc_phase: phase,
        assigned_agent: agent,
        project_context: this.extractProjectContext(taskMasterTask)
      }
    };

    return claudeFlowTask;
  }

  public toTaskMaster(claudeFlowTask: ClaudeFlowTask): TaskMasterTask {
    const validation = this.validateTaskConversion(claudeFlowTask);
    if (!validation.isValid) {
      throw new Error(`Invalid ClaudeFlow task: ${validation.errors.join(', ')}`);
    }

    const taskMasterTask: TaskMasterTask = {
      id: claudeFlowTask.id,
      title: claudeFlowTask.title,
      description: claudeFlowTask.description,
      status: this.reverseStatusMapping[claudeFlowTask.status],
      priority: this.reversePriorityMapping[claudeFlowTask.priority],
      tags: this.generateTagsFromClaudeFlow(claudeFlowTask),
      dependencies: claudeFlowTask.dependencies,
      estimate: claudeFlowTask.estimatedHours,
      assignee: claudeFlowTask.agent,
      createdAt: claudeFlowTask.createdAt,
      updatedAt: claudeFlowTask.updatedAt,
      metadata: {
        prd_section: claudeFlowTask.phase ? this.mapSPARCToSection(claudeFlowTask.phase) : undefined,
        complexity: this.estimateComplexity(claudeFlowTask),
        ai_generated: true,
        model_used: 'claude-flow-adapter'
      }
    };

    return taskMasterTask;
  }

  public batchToClaudeFlow(tasks: TaskMasterTask[]): ClaudeFlowTask[] {
    return tasks.map(task => {
      try {
        return this.toClaudeFlow(task);
      } catch (error) {
        console.warn(`Failed to convert task ${task.id}:`, error);
        return null;
      }
    }).filter(task => task !== null) as ClaudeFlowTask[];
  }

  public batchToTaskMaster(tasks: ClaudeFlowTask[]): TaskMasterTask[] {
    return tasks.map(task => {
      try {
        return this.toTaskMaster(task);
      } catch (error) {
        console.warn(`Failed to convert task ${task.id}:`, error);
        return null;
      }
    }).filter(task => task !== null) as TaskMasterTask[];
  }

  public validateTaskConversion(task: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic required fields
    if (!task.id) errors.push('Task ID is required');
    if (!task.title) errors.push('Task title is required');
    if (!task.status) errors.push('Task status is required');
    if (!task.createdAt) errors.push('Created date is required');

    // Type-specific validation
    if (task.status && !Object.values(TaskMasterStatus).includes(task.status) && 
        !Object.values(ClaudeFlowStatus).includes(task.status)) {
      errors.push('Invalid task status');
    }

    // Warnings for optional fields
    if (!task.description) warnings.push('Task description is missing');
    if (!task.priority) warnings.push('Task priority not set');

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  public detectConflicts(tmTask: TaskMasterTask, cfTask: ClaudeFlowTask): Conflict[] {
    const conflicts: Conflict[] = [];

    // Check for conflicting updates
    if (tmTask.updatedAt > cfTask.updatedAt || cfTask.updatedAt > tmTask.updatedAt) {
      // Compare key fields
      if (this.statusMapping[tmTask.status] !== cfTask.status) {
        conflicts.push({
          taskId: tmTask.id,
          field: 'status',
          taskMasterValue: tmTask.status,
          claudeFlowValue: cfTask.status,
          source: tmTask.updatedAt > cfTask.updatedAt ? 'taskmaster' : 'claudeflow'
        });
      }

      if (this.priorityMapping[tmTask.priority] !== cfTask.priority) {
        conflicts.push({
          taskId: tmTask.id,
          field: 'priority',
          taskMasterValue: tmTask.priority,
          claudeFlowValue: cfTask.priority,
          source: tmTask.updatedAt > cfTask.updatedAt ? 'taskmaster' : 'claudeflow'
        });
      }

      if (tmTask.title !== cfTask.title) {
        conflicts.push({
          taskId: tmTask.id,
          field: 'title',
          taskMasterValue: tmTask.title,
          claudeFlowValue: cfTask.title,
          source: tmTask.updatedAt > cfTask.updatedAt ? 'taskmaster' : 'claudeflow'
        });
      }
    }

    return conflicts;
  }

  public resolveConflicts(conflicts: Conflict[], strategy: 'taskmaster' | 'claudeflow' | 'merge' = 'merge'): Resolution[] {
    return conflicts.map(conflict => {
      let resolvedValue: any;
      let resolutionStrategy: Resolution['strategy'];

      switch (strategy) {
        case 'taskmaster':
          resolvedValue = conflict.taskMasterValue;
          resolutionStrategy = 'taskmaster_wins';
          break;
        case 'claudeflow':
          resolvedValue = conflict.claudeFlowValue;
          resolutionStrategy = 'claudeflow_wins';
          break;
        case 'merge':
        default:
          // Use most recent source
          resolvedValue = conflict.source === 'taskmaster' ? 
            conflict.taskMasterValue : conflict.claudeFlowValue;
          resolutionStrategy = 'merge';
          break;
      }

      return {
        taskId: conflict.taskId,
        field: conflict.field,
        resolvedValue,
        strategy: resolutionStrategy
      };
    });
  }

  // Helper methods
  private inferSPARCPhase(prdSection: string): SPARCPhase {
    const section = prdSection.toLowerCase();
    if (section.includes('requirement') || section.includes('goal')) {
      return SPARCPhase.SPECIFICATION;
    } else if (section.includes('design') || section.includes('architecture')) {
      return SPARCPhase.ARCHITECTURE;
    } else if (section.includes('implement') || section.includes('code')) {
      return SPARCPhase.REFINEMENT;
    } else if (section.includes('test') || section.includes('validation')) {
      return SPARCPhase.COMPLETION;
    }
    return SPARCPhase.SPECIFICATION; // Default
  }

  private suggestAgent(task: TaskMasterTask, phase?: SPARCPhase): string | undefined {
    if (phase) {
      switch (phase) {
        case SPARCPhase.SPECIFICATION:
          return 'spec-pseudocode';
        case SPARCPhase.ARCHITECTURE:
          return 'architect';
        case SPARCPhase.REFINEMENT:
          return task.title.toLowerCase().includes('test') ? 'tdd' : 'code';
        case SPARCPhase.COMPLETION:
          return 'integration';
        default:
          return undefined;
      }
    }
    return undefined;
  }

  private extractProjectContext(task: TaskMasterTask): string {
    const context = [];
    if (task.metadata?.prd_section) {
      context.push(`PRD Section: ${task.metadata.prd_section}`);
    }
    if (task.tags?.length) {
      context.push(`Tags: ${task.tags.join(', ')}`);
    }
    return context.join(' | ');
  }

  private generateTagsFromClaudeFlow(task: ClaudeFlowTask): string[] {
    const tags = [];
    if (task.phase) {
      tags.push(task.phase);
    }
    if (task.agent) {
      tags.push(task.agent);
    }
    if (task.priority) {
      tags.push(`priority-${task.priority}`);
    }
    return tags;
  }

  private mapSPARCToSection(phase: SPARCPhase): string {
    switch (phase) {
      case SPARCPhase.SPECIFICATION:
        return 'Requirements';
      case SPARCPhase.PSEUDOCODE:
        return 'Logic Design';
      case SPARCPhase.ARCHITECTURE:
        return 'System Architecture';
      case SPARCPhase.REFINEMENT:
        return 'Implementation';
      case SPARCPhase.COMPLETION:
        return 'Testing & Integration';
      default:
        return 'General';
    }
  }

  private estimateComplexity(task: ClaudeFlowTask): number {
    let complexity = 1;
    
    if (task.estimatedHours) {
      if (task.estimatedHours > 8) complexity += 2;
      else if (task.estimatedHours > 4) complexity += 1;
    }
    
    if (task.dependencies?.length) {
      complexity += Math.min(task.dependencies.length, 3);
    }
    
    if (task.phase === SPARCPhase.ARCHITECTURE) complexity += 1;
    
    return Math.min(complexity, 10);
  }
}

export default TaskAdapter;