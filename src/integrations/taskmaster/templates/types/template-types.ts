/**
 * Template system types for TaskMaster
 * Defines reusable task templates and workflows
 */

import { TaskMasterTask, SPARCPhase, TaskMasterPriority, TaskMasterStatus } from '../../types/task-types.ts';

// Template Types
export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  version: string;
  author?: string;
  tags: string[];
  variables: TemplateVariable[];
  tasks: TemplateTask[];
  metadata?: {
    icon?: string;
    color?: string;
    estimatedHours?: number;
    complexity?: 'low' | 'medium' | 'high';
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateTask {
  id: string;
  title: string;
  description?: string;
  status?: TaskMasterStatus;
  priority?: TaskMasterPriority;
  dependencies?: string[];
  estimate?: number;
  tags?: string[];
  sparcPhase?: SPARCPhase;
  variables?: Record<string, string>; // References to template variables
}

export interface TemplateVariable {
  name: string;
  type: VariableType;
  description: string;
  required: boolean;
  default?: any;
  options?: string[]; // For enum types
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
  };
}

export enum VariableType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  DATE = 'date',
  ENUM = 'enum',
  ARRAY = 'array'
}

export enum TemplateCategory {
  WEB_DEVELOPMENT = 'web_development',
  MOBILE_DEVELOPMENT = 'mobile_development',
  API_DEVELOPMENT = 'api_development',
  DATA_PROCESSING = 'data_processing',
  MACHINE_LEARNING = 'machine_learning',
  DEVOPS = 'devops',
  TESTING = 'testing',
  DOCUMENTATION = 'documentation',
  CUSTOM = 'custom'
}

// Workflow Types
export interface Workflow {
  id: string;
  name: string;
  description: string;
  templates: string[]; // Template IDs to apply in sequence
  triggers?: WorkflowTrigger[];
  conditions?: WorkflowCondition[];
  variables?: TemplateVariable[];
  metadata?: {
    autoApply?: boolean;
    requiresApproval?: boolean;
    notifyOnComplete?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowTrigger {
  type: TriggerType;
  config: Record<string, any>;
}

export enum TriggerType {
  PRD_CREATED = 'prd_created',
  PROJECT_STARTED = 'project_started',
  PHASE_COMPLETED = 'phase_completed',
  MANUAL = 'manual',
  SCHEDULED = 'scheduled'
}

export interface WorkflowCondition {
  field: string;
  operator: ConditionOperator;
  value: any;
}

export enum ConditionOperator {
  EQUALS = 'equals',
  NOT_EQUALS = 'not_equals',
  CONTAINS = 'contains',
  GREATER_THAN = 'greater_than',
  LESS_THAN = 'less_than',
  IN = 'in',
  NOT_IN = 'not_in'
}

// Template Application
export interface TemplateApplication {
  templateId: string;
  variables: Record<string, any>;
  targetProject?: string;
  options?: {
    skipDependencies?: boolean;
    overrideStatus?: TaskMasterStatus;
    addPrefix?: string;
    addSuffix?: string;
  };
}

export interface WorkflowExecution {
  workflowId: string;
  status: ExecutionStatus;
  currentStep: number;
  variables: Record<string, any>;
  results: TemplateApplicationResult[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export enum ExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface TemplateApplicationResult {
  templateId: string;
  success: boolean;
  tasksCreated: string[];
  errors?: string[];
  warnings?: string[];
}

// Template Storage
export interface TemplateStore {
  templates: Map<string, TaskTemplate>;
  workflows: Map<string, Workflow>;
  lastUpdated: Date;
}

// Template Validation
export interface TemplateValidationResult {
  valid: boolean;
  errors: TemplateError[];
  warnings: string[];
}

export interface TemplateError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

// Export all types
export type {
  TaskTemplate,
  TemplateTask,
  TemplateVariable,
  Workflow,
  WorkflowTrigger,
  WorkflowCondition,
  TemplateApplication,
  WorkflowExecution,
  TemplateApplicationResult,
  TemplateStore,
  TemplateValidationResult,
  TemplateError
};