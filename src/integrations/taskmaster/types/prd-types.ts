/**
 * TypeScript definitions for PRD (Product Requirements Document) processing
 * Used for parsing PRDs and generating tasks
 */

import { AIModel, TaskTree, SPARCPhase } from './task-types.ts';

export type DocumentFormat = 'markdown' | 'html' | 'pdf' | 'docx' | 'text';

// Enhanced PRD Structure
export interface ParsedPRD {
  id: string;
  title: string;
  version: string;
  createdAt: number;
  updatedAt: number;
  structure: DocumentStructure;
  requirements: Requirement[];
  constraints: Constraint[];
  acceptanceCriteria: AcceptanceCriteria[];
  complexity: ComplexityAnalysis;
  metadata: Record<string, any>;
  rawContent: string;
  format: DocumentFormat;
  // Legacy fields for compatibility
  sections?: PRDSection[];
}

export interface DocumentStructure {
  sections: DocumentSection[];
  hierarchy: any;
  totalSections: number;
  maxDepth: number;
}

export interface DocumentSection {
  id: string;
  title: string;
  type: SectionType;
  level: number;
  content: string;
  startIndex?: number;
  endIndex?: number;
  subsections?: DocumentSection[];
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
  title: string;
  description: string;
  type: RequirementType;
  priority: Priority;
  complexity: Complexity;
  dependencies: string[];
  acceptanceCriteria: string[];
  source: string;
  estimatedEffort: number;
  metadata: {
    extractedFrom: string;
    confidence: number;
    [key: string]: any;
  };
  // Legacy fields for compatibility
  section?: string;
}

export type Priority = 
  | 'must_have'
  | 'should_have'
  | 'could_have'
  | 'wont_have';

export type Complexity = 'low' | 'medium' | 'high';

export enum RequirementType {
  FUNCTIONAL = 'functional',
  NON_FUNCTIONAL = 'non_functional', 
  TECHNICAL = 'technical',
  BUSINESS = 'business',
  USER_STORY = 'user_story'
}

export interface Constraint {
  id: string;
  title: string;
  description: string;
  type: ConstraintType;
  impact: Impact;
  mandatory: boolean;
  workaround?: string;
  affectedRequirements: string[];
  source: string;
  // Legacy field for compatibility
  mitigation?: string;
}

export type Impact = 'low' | 'medium' | 'high';

export interface AcceptanceCriteria {
  id: string;
  requirementId: string;
  description: string;
  type: AcceptanceCriteriaType;
  testable: boolean;
  priority: Priority;
  method: TestMethod;
}

export type AcceptanceCriteriaType = 
  | 'functional'
  | 'non_functional'
  | 'usability'
  | 'performance'
  | 'security';

export type TestMethod = 
  | 'manual'
  | 'automated'
  | 'integration'
  | 'performance'
  | 'security';

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
  APPENDIX = 'appendix',
  BUSINESS_RULES = 'business_rules',
  DEPENDENCIES = 'dependencies',
  GLOSSARY = 'glossary',
  OTHER = 'other'
}

export interface ParseOptions {
  format?: DocumentFormat;
  preserveFormatting?: boolean;
  extractImages?: boolean;
  extractTables?: boolean;
  aiAnalysis?: boolean;
  customPrompts?: {
    requirementExtraction?: string;
    constraintExtraction?: string;
    complexityAnalysis?: string;
  };
  // Legacy fields for compatibility
  model?: AIModel;
  includeEstimates?: boolean;
  generateTasks?: boolean;
  mapToSparc?: boolean;
  maxDepth?: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
  suggestions?: string[];
}

// Enhanced Complexity Analysis
export interface ComplexityAnalysis {
  overallComplexity: 'low' | 'medium' | 'high' | 'very_high';
  factors: string[];
  scores: {
    technical: number;
    business: number;
    integration: number;
    ui: number;
  };
  estimatedDuration: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendedTeamSize: number;
  keyRisks: string[];
  mitigationStrategies: string[];
  // Legacy fields for compatibility
  overall?: 'low' | 'medium' | 'high' | 'enterprise';
  estimatedWeeks?: number;
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