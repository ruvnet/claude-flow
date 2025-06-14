/**
 * TypeScript definitions for PRD (Product Requirements Document) processing
 * Used for parsing PRDs and generating tasks
 */

import { AIModel, TaskTree, SPARCPhase } from './task-types.js';

// PRD Structure
export interface ParsedPRD {
  metadata: PRDMetadata;
  requirements: Requirement[];
  constraints: Constraint[];
  sections: PRDSection[];
  complexity: ComplexityAnalysis;
}

export interface PRDMetadata {
  title: string;
  version: string;
  author?: string;
  createdAt: Date;
  updatedAt?: Date;
  projectType?: string;
  estimatedSize?: 'small' | 'medium' | 'large' | 'enterprise';
}

export interface Requirement {
  id: string;
  type: RequirementType;
  title: string;
  description: string;
  priority: 'must-have' | 'should-have' | 'could-have' | 'wont-have';
  acceptanceCriteria: string[];
  dependencies?: string[];
  section?: string;
}

export enum RequirementType {
  FUNCTIONAL = 'functional',
  NON_FUNCTIONAL = 'non_functional', 
  TECHNICAL = 'technical',
  BUSINESS = 'business',
  USER_STORY = 'user_story'
}

export interface Constraint {
  id: string;
  type: ConstraintType;
  description: string;
  impact: 'low' | 'medium' | 'high';
  mitigation?: string;
}

export enum ConstraintType {
  TECHNICAL = 'technical',
  BUSINESS = 'business',
  TIME = 'time',
  BUDGET = 'budget',
  REGULATORY = 'regulatory',
  SECURITY = 'security'
}

export interface PRDSection {
  id: string;
  title: string;
  content: string;
  type: SectionType;
  order: number;
  requirements: string[]; // requirement IDs
}

export enum SectionType {
  OVERVIEW = 'overview',
  GOALS = 'goals',
  USER_STORIES = 'user_stories',
  FUNCTIONAL_REQUIREMENTS = 'functional_requirements',
  NON_FUNCTIONAL_REQUIREMENTS = 'non_functional_requirements',
  TECHNICAL_REQUIREMENTS = 'technical_requirements',
  CONSTRAINTS = 'constraints',
  ASSUMPTIONS = 'assumptions',
  ACCEPTANCE_CRITERIA = 'acceptance_criteria',
  APPENDIX = 'appendix'
}

// Complexity Analysis
export interface ComplexityAnalysis {
  overall: 'low' | 'medium' | 'high' | 'enterprise';
  factors: ComplexityFactor[];
  estimatedWeeks: number;
  recommendedTeamSize: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ComplexityFactor {
  factor: string;
  score: number; // 1-10 scale
  weight: number;
  reasoning: string;
}

// Parse Options
export interface ParseOptions {
  model?: AIModel;
  includeEstimates?: boolean;
  generateTasks?: boolean;
  mapToSparc?: boolean;
  maxDepth?: number;
  customPrompts?: {
    requirementExtraction?: string;
    taskGeneration?: string;
    complexityAnalysis?: string;
  };
}

// Generation Options
export interface GenerateOptions {
  model: AIModel;
  taskDepth: number;
  sparcMapping: boolean;
  agentAssignment: boolean;
  estimateHours: boolean;
  includeDependencies: boolean;
  customization?: {
    taskTemplate?: string;
    namingConvention?: string;
    prioritization?: 'user_defined' | 'ai_determined' | 'complexity_based';
  };
}

// SPARC Workflow Mapping
export interface SPARCWorkflow {
  phases: SPARCPhaseMapping[];
  totalTasks: number;
  estimatedDuration: number;
  complexity: 'low' | 'medium' | 'high';
  recommendedAgents: string[];
}

export interface SPARCPhaseMapping {
  phase: SPARCPhase;
  tasks: string[]; // task IDs
  estimatedHours: number;
  dependencies: SPARCPhase[];
  agents: string[];
  deliverables: string[];
}

// Task Generation Context
export interface TaskContext {
  projectType: string;
  teamSize?: number;
  timeline?: number;
  constraints?: Constraint[];
  existingCodebase?: boolean;
  techStack?: string[];
  preferredMethodology?: 'agile' | 'waterfall' | 'sparc' | 'hybrid';
}

// Recommended Task
export interface RecommendedTask {
  task: any; // Will be TaskMasterTask when imported
  reasoning: string;
  confidence: number; // 0-1
  prerequisites: string[];
  estimatedDuration: number;
  suggestedAgent?: string;
  priority: number;
}

// Project Context for task recommendations
export interface ProjectContext {
  currentPhase?: SPARCPhase;
  completedTasks: string[];
  blockedTasks: string[];
  availableAgents: string[];
  deadlines?: Date[];
  teamCapacity?: number;
  preferences?: {
    workingHours?: [number, number];
    preferredTechnologies?: string[];
    avoidedTechnologies?: string[];
  };
}

// Export types for easier importing
export type {
  ParsedPRD,
  PRDMetadata,
  Requirement,
  Constraint,
  PRDSection,
  ComplexityAnalysis,
  ComplexityFactor,
  ParseOptions,
  GenerateOptions,
  SPARCWorkflow,
  SPARCPhaseMapping,
  TaskContext,
  RecommendedTask,
  ProjectContext
};