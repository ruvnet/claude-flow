/**
 * TypeScript definitions for Task Master integration
 * Defines interfaces for task conversion and synchronization
 */

// Task Master Task Structure
export interface TaskMasterTask {
  id: string;
  title: string;
  description?: string;
  status: TaskMasterStatus;
  priority: TaskMasterPriority;
  tags?: string[];
  dependencies?: string[];
  estimate?: number; // in hours
  assignee?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: {
    prd_section?: string;
    complexity?: number;
    ai_generated?: boolean;
    model_used?: string;
  };
}

// Claude-Flow Task Structure (existing)  
export interface ClaudeFlowTask {
  id: string;
  title: string;
  description?: string;
  status: ClaudeFlowStatus;
  priority: ClaudeFlowPriority;
  phase?: SPARCPhase;
  agent?: string;
  dependencies?: string[];
  estimatedHours?: number;
  createdAt: Date;
  updatedAt: Date;
  context?: {
    sparc_phase?: SPARCPhase;
    assigned_agent?: string;
    project_context?: string;
  };
}

// Status Enums
export enum TaskMasterStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress', 
  BLOCKED = 'blocked',
  DONE = 'done',
  CANCELLED = 'cancelled'
}

export enum ClaudeFlowStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  BLOCKED = 'blocked',
  CANCELLED = 'cancelled'
}

// Priority Enums
export enum TaskMasterPriority {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4
}

export enum ClaudeFlowPriority {
  LOW = 'low',
  MEDIUM = 'medium', 
  HIGH = 'high'
}

// SPARC Phases
export enum SPARCPhase {
  SPECIFICATION = 'specification',
  PSEUDOCODE = 'pseudocode',
  ARCHITECTURE = 'architecture', 
  REFINEMENT = 'refinement',
  COMPLETION = 'completion'
}

// Adapter Configuration
export interface MappingConfig {
  statusMapping: Record<TaskMasterStatus, ClaudeFlowStatus>;
  priorityMapping: Record<TaskMasterPriority, ClaudeFlowPriority>;
  customMappings?: Record<string, any>;
}

export interface MappingRule {
  source: string;
  target: string;
  transform: (value: any) => any;
}

// Validation Results
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Sync Operations
export interface SyncResult {
  success: boolean;
  syncedTasks: number;
  conflicts: Conflict[];
  errors: string[];
  timestamp: Date;
}

export interface Conflict {
  taskId: string;
  field: string;
  taskMasterValue: any;
  claudeFlowValue: any;
  source: 'taskmaster' | 'claudeflow';
}

export interface Resolution {
  taskId: string;
  field: string;
  resolvedValue: any;
  strategy: 'taskmaster_wins' | 'claudeflow_wins' | 'merge' | 'manual';
}

// AI Model Types
export interface AIModel {
  provider: 'anthropic' | 'openai' | 'gemini' | 'perplexity' | 'xai' | 'mistral';
  model: string;
  apiKey?: string;
  settings?: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  };
}

// Task Tree Structure (for PRD parsing)
export interface TaskTree {
  root: TaskNode;
  totalTasks: number;
  estimatedHours: number;
  complexity: 'low' | 'medium' | 'high';
}

export interface TaskNode {
  task: TaskMasterTask;
  children: TaskNode[];
  depth: number;
  sparcPhase?: SPARCPhase;
}

// Export types for easier importing
export type {
  TaskMasterTask,
  ClaudeFlowTask,
  MappingConfig,
  ValidationResult,
  SyncResult,
  AIModel,
  TaskTree,
  TaskNode,
  MappingRule,
  Conflict,
  Resolution
};