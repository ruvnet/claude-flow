/**
 * Task Adapter Component (Deno Compatible)
 * Handles conversion between TaskMaster and Claude-Flow task formats
 * Implements bidirectional mapping with validation and conflict resolution
 */

// Define types locally for Deno compatibility
export interface TaskMasterTask {
  id: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  assignee: string | null;
  sparc_mode?: string;
  subtasks: TaskMasterTask[];
  dependencies?: string[];
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, any>;
}

export interface ClaudeFlowTask {
  id: string;
  type: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  priority: 'low' | 'normal' | 'high' | 'critical';
  assignedAgent?: string;
  dependencies: string[];
  metadata: {
    sparcPhase?: string;
    estimatedDuration?: number;
    actualDuration?: number;
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}

export type TaskMasterStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
export type ClaudeFlowStatus = 'pending' | 'in-progress' | 'completed' | 'failed';
export type TaskMasterPriority = 'low' | 'medium' | 'high';
export type ClaudeFlowPriority = 'low' | 'normal' | 'high' | 'critical';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface Conflict {
  field: string;
  tmValue: any;
  cfValue: any;
  severity: 'low' | 'medium' | 'high';
}

export interface Resolution {
  field: string;
  resolvedValue: any;
  strategy: string;
}

export interface MappingConfig {
  strictMode?: boolean;
  customMappings?: Record<string, any>;
  validationRules?: any[];
}

export interface MappingRule {
  source: string;
  target: string;
  transform?: (value: any) => any;
}

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
    this.mappingRules = [];
    
    if (config) {
      this.configureMappings(config);
    }
  }

  private initializeDefaultMappings(): void {
    // Status mappings
    this.statusMapping = {
      'pending': 'pending',
      'in_progress': 'in-progress',
      'completed': 'completed',
      'blocked': 'failed'
    };

    this.reverseStatusMapping = {
      'pending': 'pending',
      'in-progress': 'in_progress',
      'completed': 'completed',
      'failed': 'blocked'
    };

    // Priority mappings
    this.priorityMapping = {
      'low': 'low',
      'medium': 'normal',
      'high': 'high'
    };

    this.reversePriorityMapping = {
      'low': 'low',
      'normal': 'medium',
      'high': 'high',
      'critical': 'high'
    };
  }

  toClaudeFlow(taskMasterTask: TaskMasterTask): ClaudeFlowTask {
    const claudeFlowTask: ClaudeFlowTask = {
      id: taskMasterTask.id,
      type: this.mapTaskType(taskMasterTask.type),
      title: taskMasterTask.title,
      description: taskMasterTask.description,
      status: this.statusMapping[taskMasterTask.status as TaskMasterStatus] || 'pending',
      priority: this.priorityMapping[taskMasterTask.priority as TaskMasterPriority] || 'normal',
      assignedAgent: taskMasterTask.assignee || undefined,
      dependencies: taskMasterTask.dependencies || [],
      metadata: {
        sparcPhase: taskMasterTask.sparc_mode,
        ...taskMasterTask.metadata
      },
      createdAt: taskMasterTask.createdAt || new Date().toISOString(),
      updatedAt: taskMasterTask.updatedAt || new Date().toISOString()
    };

    return claudeFlowTask;
  }

  toTaskMaster(claudeFlowTask: ClaudeFlowTask): TaskMasterTask {
    const taskMasterTask: TaskMasterTask = {
      id: claudeFlowTask.id,
      title: claudeFlowTask.title,
      description: claudeFlowTask.description,
      type: this.reverseMapTaskType(claudeFlowTask.type),
      priority: this.reversePriorityMapping[claudeFlowTask.priority] || 'medium',
      status: this.reverseStatusMapping[claudeFlowTask.status] || 'pending',
      assignee: claudeFlowTask.assignedAgent || null,
      sparc_mode: claudeFlowTask.metadata?.sparcPhase,
      subtasks: [],
      dependencies: claudeFlowTask.dependencies,
      createdAt: claudeFlowTask.createdAt,
      updatedAt: claudeFlowTask.updatedAt,
      metadata: claudeFlowTask.metadata
    };

    return taskMasterTask;
  }

  batchToClaudeFlow(tasks: TaskMasterTask[]): ClaudeFlowTask[] {
    return tasks.map(task => this.toClaudeFlow(task));
  }

  batchToTaskMaster(tasks: ClaudeFlowTask[]): TaskMasterTask[] {
    return tasks.map(task => this.toTaskMaster(task));
  }

  validateTaskConversion(task: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields validation
    if (!task.id) errors.push('Task ID is required');
    if (!task.title) errors.push('Task title is required');
    if (!task.description) warnings.push('Task description is recommended');

    // Type validation
    if (task.status && !this.isValidStatus(task.status)) {
      warnings.push(`Invalid status: ${task.status}`);
    }

    if (task.priority && !this.isValidPriority(task.priority)) {
      warnings.push(`Invalid priority: ${task.priority}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  configureMappings(config: MappingConfig): void {
    if (config.customMappings) {
      // Apply custom mappings
      Object.assign(this.statusMapping, config.customMappings.status || {});
      Object.assign(this.priorityMapping, config.customMappings.priority || {});
    }
  }

  detectConflicts(tmTask: TaskMasterTask, cfTask: ClaudeFlowTask): Conflict[] {
    const conflicts: Conflict[] = [];

    // Check status conflicts
    if (tmTask.status !== this.reverseStatusMapping[cfTask.status]) {
      conflicts.push({
        field: 'status',
        tmValue: tmTask.status,
        cfValue: cfTask.status,
        severity: 'high'
      });
    }

    // Check priority conflicts
    if (tmTask.priority !== this.reversePriorityMapping[cfTask.priority]) {
      conflicts.push({
        field: 'priority',
        tmValue: tmTask.priority,
        cfValue: cfTask.priority,
        severity: 'medium'
      });
    }

    // Check assignee conflicts
    if (tmTask.assignee !== cfTask.assignedAgent) {
      conflicts.push({
        field: 'assignee',
        tmValue: tmTask.assignee,
        cfValue: cfTask.assignedAgent,
        severity: 'low'
      });
    }

    return conflicts;
  }

  resolveConflicts(conflicts: Conflict[], strategy: 'taskmaster' | 'claudeflow' | 'merge' = 'merge'): Resolution[] {
    return conflicts.map(conflict => {
      let resolvedValue: any;

      switch (strategy) {
        case 'taskmaster':
          resolvedValue = conflict.tmValue;
          break;
        case 'claudeflow':
          resolvedValue = conflict.cfValue;
          break;
        case 'merge':
          // Default merge strategy: use most recent or higher priority value
          resolvedValue = this.mergeValues(conflict);
          break;
      }

      return {
        field: conflict.field,
        resolvedValue,
        strategy
      };
    });
  }

  private mapTaskType(tmType: string): string {
    const typeMapping: Record<string, string> = {
      'implementation': 'development',
      'testing': 'testing',
      'documentation': 'documentation',
      'architecture': 'design',
      'security': 'security-review',
      'api': 'api-development',
      'database': 'database-design',
      'frontend': 'ui-development'
    };

    return typeMapping[tmType] || tmType;
  }

  private reverseMapTaskType(cfType: string): string {
    const reverseTypeMapping: Record<string, string> = {
      'development': 'implementation',
      'testing': 'testing',
      'documentation': 'documentation',
      'design': 'architecture',
      'security-review': 'security',
      'api-development': 'api',
      'database-design': 'database',
      'ui-development': 'frontend'
    };

    return reverseTypeMapping[cfType] || cfType;
  }

  private isValidStatus(status: string): boolean {
    const validStatuses = ['pending', 'in_progress', 'completed', 'blocked', 'in-progress', 'failed'];
    return validStatuses.includes(status);
  }

  private isValidPriority(priority: string): boolean {
    const validPriorities = ['low', 'medium', 'high', 'normal', 'critical'];
    return validPriorities.includes(priority);
  }

  private mergeValues(conflict: Conflict): any {
    // Implement smart merge logic based on conflict type
    if (conflict.field === 'priority') {
      // For priority, choose the higher one
      const priorityOrder = ['low', 'medium', 'normal', 'high', 'critical'];
      const tmIndex = priorityOrder.indexOf(conflict.tmValue);
      const cfIndex = priorityOrder.indexOf(conflict.cfValue);
      return tmIndex > cfIndex ? conflict.tmValue : conflict.cfValue;
    }

    // For other fields, prefer non-null values
    return conflict.tmValue || conflict.cfValue;
  }
}