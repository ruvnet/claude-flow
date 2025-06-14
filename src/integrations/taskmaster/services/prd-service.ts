/**
 * PRD Service Component
 * Handles parsing of Product Requirements Documents and task generation
 * Integrates with AI models and SPARC methodology
 */

import {
  ParsedPRD,
  PRDMetadata,
  Requirement,
  RequirementType,
  Constraint,
  ConstraintType,
  PRDSection,
  SectionType,
  ComplexityAnalysis,
  ParseOptions,
  GenerateOptions,
  SPARCWorkflow,
  SPARCPhaseMapping,
  TaskContext,
  RecommendedTask,
  ProjectContext
} from '../types/prd-types.js';

import {
  AIModel,
  TaskTree,
  TaskNode,
  TaskMasterTask,
  TaskMasterStatus,
  TaskMasterPriority,
  SPARCPhase
} from '../types/task-types.js';

export interface IPRDService {
  // PRD parsing
  parsePRD(content: string, options?: ParseOptions): Promise<ParsedPRD>;
  
  // Task generation
  generateTasks(prd: ParsedPRD, options: GenerateOptions): Promise<TaskTree>;
  
  // SPARC integration
  mapToSPARCPhases(tasks: TaskTree): SPARCWorkflow;
  
  // Validation
  validatePRD(content: string): ValidationResult;
  
  // Task recommendations
  getNextTask(context: ProjectContext): Promise<RecommendedTask>;
  
  // Complexity estimation
  estimateComplexity(prd: ParsedPRD): ComplexityAnalysis;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

interface IAIService {
  generateText(prompt: string, model: AIModel): Promise<string>;
  parseStructured(content: string, schema: any, model: AIModel): Promise<any>;
}

interface ISPARCEngine {
  mapTasksToPhases(tasks: TaskMasterTask[]): SPARCWorkflow;
  getPhaseDeliverables(phase: SPARCPhase): string[];
  estimatePhaseEffort(phase: SPARCPhase, tasks: TaskMasterTask[]): number;
}

// Mock implementations for development
class MockAIService implements IAIService {
  async generateText(prompt: string, model: AIModel): Promise<string> {
    // Mock implementation - would integrate with actual AI providers
    return `Generated response for: ${prompt.substring(0, 100)}...`;
  }

  async parseStructured(content: string, schema: any, model: AIModel): Promise<any> {
    // Mock structured parsing
    return { parsed: true, content: content.substring(0, 200) };
  }
}

class MockSPARCEngine implements ISPARCEngine {
  mapTasksToPhases(tasks: TaskMasterTask[]): SPARCWorkflow {
    const phases: SPARCPhaseMapping[] = [
      {
        phase: SPARCPhase.SPECIFICATION,
        tasks: tasks.filter(t => t.title.toLowerCase().includes('requirement')).map(t => t.id),
        estimatedHours: 16,
        dependencies: [],
        agents: ['spec-pseudocode'],
        deliverables: ['Requirements Document', 'User Stories']
      },
      {
        phase: SPARCPhase.ARCHITECTURE,
        tasks: tasks.filter(t => t.title.toLowerCase().includes('design')).map(t => t.id),
        estimatedHours: 24,
        dependencies: [SPARCPhase.SPECIFICATION],
        agents: ['architect'],
        deliverables: ['Architecture Diagram', 'API Specifications']
      }
    ];

    return {
      phases,
      totalTasks: tasks.length,
      estimatedDuration: 80,
      complexity: 'medium',
      recommendedAgents: ['spec-pseudocode', 'architect', 'code', 'tdd', 'integration']
    };
  }

  getPhaseDeliverables(phase: SPARCPhase): string[] {
    const deliverables: Record<SPARCPhase, string[]> = {
      [SPARCPhase.SPECIFICATION]: ['Requirements Document', 'User Stories', 'Acceptance Criteria'],
      [SPARCPhase.PSEUDOCODE]: ['Pseudocode', 'Algorithm Design', 'Data Flow'],
      [SPARCPhase.ARCHITECTURE]: ['System Architecture', 'Component Design', 'API Specs'],
      [SPARCPhase.REFINEMENT]: ['Implementation', 'Unit Tests', 'Integration Tests'],
      [SPARCPhase.COMPLETION]: ['Documentation', 'Deployment', 'Monitoring']
    };
    return deliverables[phase] || [];
  }

  estimatePhaseEffort(phase: SPARCPhase, tasks: TaskMasterTask[]): number {
    const baseEffort: Record<SPARCPhase, number> = {
      [SPARCPhase.SPECIFICATION]: 2,
      [SPARCPhase.PSEUDOCODE]: 3,
      [SPARCPhase.ARCHITECTURE]: 4,
      [SPARCPhase.REFINEMENT]: 6,
      [SPARCPhase.COMPLETION]: 2
    };
    
    const phaseTasks = tasks.filter(t => t.metadata?.prd_section?.toLowerCase().includes(phase));
    return (baseEffort[phase] || 3) * Math.max(phaseTasks.length, 1);
  }
}

export class PRDService implements IPRDService {
  private aiService: IAIService;
  private sparcEngine: ISPARCEngine;

  constructor(
    aiService?: IAIService,
    sparcEngine?: ISPARCEngine
  ) {
    this.aiService = aiService || new MockAIService();
    this.sparcEngine = sparcEngine || new MockSPARCEngine();
  }

  public async parsePRD(content: string, options: ParseOptions = {}): Promise<ParsedPRD> {
    const validation = this.validatePRD(content);
    if (!validation.isValid) {
      throw new Error(`Invalid PRD: ${validation.errors.join(', ')}`);
    }

    try {
      // Extract metadata
      const metadata = await this.extractMetadata(content);
      
      // Parse sections
      const sections = await this.parseSections(content, options);
      
      // Extract requirements
      const requirements = await this.extractRequirements(sections, options);
      
      // Identify constraints
      const constraints = await this.extractConstraints(sections, options);
      
      // Analyze complexity
      const complexity = this.estimateComplexity({ 
        metadata, 
        requirements, 
        constraints, 
        sections,
        complexity: { overall: 'medium', factors: [], estimatedWeeks: 8, recommendedTeamSize: 4, riskLevel: 'medium' }
      });

      return {
        metadata,
        requirements,
        constraints,
        sections,
        complexity
      };

    } catch (error) {
      console.error('PRD parsing failed:', error);
      throw new Error(`Failed to parse PRD: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public async generateTasks(prd: ParsedPRD, options: GenerateOptions): Promise<TaskTree> {
    try {
      const tasks: TaskMasterTask[] = [];
      let taskCounter = 1;

      // Generate tasks for each requirement
      for (const requirement of prd.requirements) {
        const task = await this.generateTaskFromRequirement(requirement, taskCounter++, options);
        tasks.push(task);

        // Generate subtasks if needed
        if (requirement.acceptanceCriteria.length > 0) {
          for (const criteria of requirement.acceptanceCriteria) {
            const subtask = await this.generateSubtask(criteria, requirement, taskCounter++, options);
            tasks.push(subtask);
          }
        }
      }

      // Generate constraint-based tasks
      for (const constraint of prd.constraints) {
        if (constraint.impact === 'high') {
          const task = await this.generateConstraintTask(constraint, taskCounter++, options);
          tasks.push(task);
        }
      }

      // Create task tree structure
      const root = this.buildTaskTree(tasks);
      
      return {
        root,
        totalTasks: tasks.length,
        estimatedHours: tasks.reduce((sum, task) => sum + (task.estimate || 0), 0),
        complexity: this.mapComplexityLevel(prd.complexity.overall)
      };

    } catch (error) {
      console.error('Task generation failed:', error);
      throw new Error(`Failed to generate tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public mapToSPARCPhases(tasks: TaskTree): SPARCWorkflow {
    const flatTasks = this.flattenTaskTree(tasks.root);
    return this.sparcEngine.mapTasksToPhases(flatTasks);
  }

  public validatePRD(content: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Basic validation
    if (!content || content.trim().length === 0) {
      errors.push('PRD content is empty');
      return { isValid: false, errors, warnings, suggestions };
    }

    if (content.length < 100) {
      warnings.push('PRD content seems very short');
    }

    // Check for essential sections
    const requiredSections = ['goal', 'requirement', 'objective'];
    const hasRequiredSection = requiredSections.some(section => 
      content.toLowerCase().includes(section)
    );

    if (!hasRequiredSection) {
      warnings.push('PRD should include goals, requirements, or objectives');
      suggestions.push('Add a section describing the project goals and requirements');
    }

    // Check for acceptance criteria
    if (!content.toLowerCase().includes('accept')) {
      suggestions.push('Consider adding acceptance criteria for requirements');
    }

    // Check for technical constraints
    if (!content.toLowerCase().includes('constrain') && !content.toLowerCase().includes('limitation')) {
      suggestions.push('Consider documenting technical constraints and limitations');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions
    };
  }

  public async getNextTask(context: ProjectContext): Promise<RecommendedTask> {
    // Analyze context and recommend next task
    const availableTasks = await this.getAvailableTasks(context);
    
    if (availableTasks.length === 0) {
      throw new Error('No available tasks found');
    }

    // Simple recommendation logic - prioritize by current phase and dependencies
    const recommended = availableTasks.reduce((best, current) => {
      const currentScore = this.calculateTaskScore(current, context);
      const bestScore = this.calculateTaskScore(best, context);
      return currentScore > bestScore ? current : best;
    });

    return {
      task: recommended,
      reasoning: this.generateRecommendationReasoning(recommended, context),
      confidence: 0.8,
      prerequisites: recommended.dependencies || [],
      estimatedDuration: recommended.estimate || 4,
      suggestedAgent: this.suggestAgentForTask(recommended),
      priority: this.calculatePriority(recommended, context)
    };
  }

  public estimateComplexity(prd: ParsedPRD): ComplexityAnalysis {
    const factors = [
      {
        factor: 'Number of Requirements',
        score: Math.min(prd.requirements.length / 10, 10),
        weight: 0.3,
        reasoning: `${prd.requirements.length} requirements identified`
      },
      {
        factor: 'High-Impact Constraints',
        score: prd.constraints.filter(c => c.impact === 'high').length * 2,
        weight: 0.2,
        reasoning: `${prd.constraints.filter(c => c.impact === 'high').length} high-impact constraints`
      },
      {
        factor: 'Functional Complexity',
        score: prd.requirements.filter(r => r.type === RequirementType.FUNCTIONAL).length / 5,
        weight: 0.3,
        reasoning: `${prd.requirements.filter(r => r.type === RequirementType.FUNCTIONAL).length} functional requirements`
      },
      {
        factor: 'Technical Requirements',
        score: prd.requirements.filter(r => r.type === RequirementType.TECHNICAL).length / 3,
        weight: 0.2,
        reasoning: `${prd.requirements.filter(r => r.type === RequirementType.TECHNICAL).length} technical requirements`
      }
    ];

    const weightedScore = factors.reduce((sum, factor) => 
      sum + (factor.score * factor.weight), 0
    );

    let overall: ComplexityAnalysis['overall'];
    let estimatedWeeks: number;
    let recommendedTeamSize: number;
    let riskLevel: ComplexityAnalysis['riskLevel'];

    if (weightedScore < 3) {
      overall = 'low';
      estimatedWeeks = 2;
      recommendedTeamSize = 2;
      riskLevel = 'low';
    } else if (weightedScore < 6) {
      overall = 'medium';
      estimatedWeeks = 6;
      recommendedTeamSize = 3;
      riskLevel = 'medium';
    } else if (weightedScore < 9) {
      overall = 'high';
      estimatedWeeks = 12;
      recommendedTeamSize = 5;
      riskLevel = 'medium';
    } else {
      overall = 'enterprise';
      estimatedWeeks = 20;
      recommendedTeamSize = 8;
      riskLevel = 'high';
    }

    return {
      overall,
      factors,
      estimatedWeeks,
      recommendedTeamSize,
      riskLevel
    };
  }

  // Private helper methods
  private async extractMetadata(content: string): Promise<PRDMetadata> {
    // Simple metadata extraction - in real implementation would use AI
    const lines = content.split('\n').slice(0, 10);
    let title = 'Untitled Project';
    
    // Look for title in first few lines
    for (const line of lines) {
      if (line.trim().startsWith('#')) {
        title = line.replace(/^#+\s*/, '').trim();
        break;
      }
    }

    return {
      title,
      version: '1.0',
      createdAt: new Date(),
      projectType: this.inferProjectType(content),
      estimatedSize: this.inferProjectSize(content)
    };
  }

  private async parseSections(content: string, options: ParseOptions): Promise<PRDSection[]> {
    const sections: PRDSection[] = [];
    const lines = content.split('\n');
    let currentSection: Partial<PRDSection> | null = null;
    let sectionContent: string[] = [];
    let order = 0;

    for (const line of lines) {
      if (line.trim().startsWith('#')) {
        // Save previous section
        if (currentSection) {
          sections.push({
            ...currentSection,
            content: sectionContent.join('\n'),
            requirements: [] // Will be populated later
          } as PRDSection);
        }

        // Start new section
        currentSection = {
          id: this.generateSectionId(line),
          title: line.replace(/^#+\s*/, '').trim(),
          type: this.inferSectionType(line),
          order: order++
        };
        sectionContent = [];
      } else {
        sectionContent.push(line);
      }
    }

    // Save last section
    if (currentSection) {
      sections.push({
        ...currentSection,
        content: sectionContent.join('\n'),
        requirements: []
      } as PRDSection);
    }

    return sections;
  }

  private async extractRequirements(sections: PRDSection[], options: ParseOptions): Promise<Requirement[]> {
    const requirements: Requirement[] = [];
    let reqCounter = 1;

    for (const section of sections) {
      // Look for requirement patterns
      const reqLines = section.content.split('\n').filter(line => 
        line.includes('must') || 
        line.includes('should') || 
        line.includes('shall') ||
        line.trim().startsWith('-') ||
        line.trim().startsWith('*')
      );

      for (const reqLine of reqLines) {
        const requirement: Requirement = {
          id: `REQ-${reqCounter++}`,
          type: this.inferRequirementType(reqLine, section.type),
          title: this.extractRequirementTitle(reqLine),
          description: reqLine.trim(),
          priority: this.inferPriority(reqLine),
          acceptanceCriteria: this.extractAcceptanceCriteria(reqLine),
          section: section.title
        };
        requirements.push(requirement);
      }
    }

    return requirements;
  }

  private async extractConstraints(sections: PRDSection[], options: ParseOptions): Promise<Constraint[]> {
    const constraints: Constraint[] = [];
    let constraintCounter = 1;

    for (const section of sections) {
      // Look for constraint patterns
      const constraintLines = section.content.split('\n').filter(line => 
        line.toLowerCase().includes('constraint') ||
        line.toLowerCase().includes('limitation') ||
        line.toLowerCase().includes('restriction') ||
        line.toLowerCase().includes('cannot') ||
        line.toLowerCase().includes('must not')
      );

      for (const constraintLine of constraintLines) {
        const constraint: Constraint = {
          id: `CON-${constraintCounter++}`,
          type: this.inferConstraintType(constraintLine),
          description: constraintLine.trim(),
          impact: this.inferConstraintImpact(constraintLine)
        };
        constraints.push(constraint);
      }
    }

    return constraints;
  }

  // Additional helper methods would continue here...
  // For brevity, including key methods only

  private generateTaskFromRequirement(requirement: Requirement, id: number, options: GenerateOptions): Promise<TaskMasterTask> {
    const task: TaskMasterTask = {
      id: `TASK-${id}`,
      title: requirement.title,
      description: requirement.description,
      status: TaskMasterStatus.TODO,
      priority: this.mapPriorityToTaskMaster(requirement.priority),
      tags: [requirement.type, requirement.section || 'general'],
      dependencies: requirement.dependencies,
      estimate: this.estimateTaskHours(requirement),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        prd_section: requirement.section,
        complexity: this.estimateTaskComplexity(requirement),
        ai_generated: true,
        model_used: options.model.model
      }
    };

    return Promise.resolve(task);
  }

  private generateSubtask(criteria: string, parent: Requirement, id: number, options: GenerateOptions): Promise<TaskMasterTask> {
    const task: TaskMasterTask = {
      id: `SUBTASK-${id}`,
      title: `Implement: ${criteria}`,
      description: `Subtask for ${parent.title}: ${criteria}`,
      status: TaskMasterStatus.TODO,
      priority: TaskMasterPriority.MEDIUM,
      tags: ['subtask', parent.type],
      estimate: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        prd_section: parent.section,
        complexity: 3,
        ai_generated: true,
        model_used: options.model.model
      }
    };

    return Promise.resolve(task);
  }

  private generateConstraintTask(constraint: Constraint, id: number, options: GenerateOptions): Promise<TaskMasterTask> {
    const task: TaskMasterTask = {
      id: `CONSTRAINT-${id}`,
      title: `Address Constraint: ${constraint.type}`,
      description: constraint.description,
      status: TaskMasterStatus.TODO,
      priority: constraint.impact === 'high' ? TaskMasterPriority.HIGH : TaskMasterPriority.MEDIUM,
      tags: ['constraint', constraint.type],
      estimate: constraint.impact === 'high' ? 8 : 4,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        complexity: constraint.impact === 'high' ? 7 : 4,
        ai_generated: true,
        model_used: options.model.model
      }
    };

    return Promise.resolve(task);
  }

  private buildTaskTree(tasks: TaskMasterTask[]): TaskNode {
    // Build a hierarchical task tree
    const rootTask: TaskMasterTask = {
      id: 'ROOT',
      title: 'Project Root',
      status: TaskMasterStatus.TODO,
      priority: TaskMasterPriority.HIGH,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const root: TaskNode = {
      task: rootTask,
      children: tasks.map(task => ({
        task,
        children: [],
        depth: 1,
        sparcPhase: this.inferSPARCPhaseFromTask(task)
      })),
      depth: 0
    };

    return root;
  }

  private flattenTaskTree(node: TaskNode): TaskMasterTask[] {
    const tasks = [node.task];
    for (const child of node.children) {
      tasks.push(...this.flattenTaskTree(child));
    }
    return tasks.filter(task => task.id !== 'ROOT');
  }

  private mapComplexityLevel(level: string): 'low' | 'medium' | 'high' {
    switch (level) {
      case 'enterprise': return 'high';
      case 'high': return 'high';
      case 'medium': return 'medium';
      default: return 'low';
    }
  }

  // Utility methods for inference and mapping
  private inferProjectType(content: string): string {
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('web') || lowerContent.includes('frontend')) return 'web';
    if (lowerContent.includes('mobile') || lowerContent.includes('app')) return 'mobile';
    if (lowerContent.includes('api') || lowerContent.includes('backend')) return 'api';
    if (lowerContent.includes('data') || lowerContent.includes('analytics')) return 'data';
    return 'general';
  }

  private inferProjectSize(content: string): PRDMetadata['estimatedSize'] {
    const wordCount = content.split(/\s+/).length;
    if (wordCount < 500) return 'small';
    if (wordCount < 2000) return 'medium';
    if (wordCount < 5000) return 'large';
    return 'enterprise';
  }

  private generateSectionId(line: string): string {
    return line.replace(/^#+\s*/, '').trim().toLowerCase().replace(/\s+/g, '-');
  }

  private inferSectionType(line: string): SectionType {
    const title = line.toLowerCase();
    if (title.includes('goal') || title.includes('objective')) return SectionType.GOALS;
    if (title.includes('user') && title.includes('story')) return SectionType.USER_STORIES;
    if (title.includes('functional')) return SectionType.FUNCTIONAL_REQUIREMENTS;
    if (title.includes('technical')) return SectionType.TECHNICAL_REQUIREMENTS;
    if (title.includes('constraint')) return SectionType.CONSTRAINTS;
    if (title.includes('acceptance')) return SectionType.ACCEPTANCE_CRITERIA;
    return SectionType.OVERVIEW;
  }

  private inferRequirementType(line: string, sectionType: SectionType): RequirementType {
    const lowerLine = line.toLowerCase();
    if (sectionType === SectionType.TECHNICAL_REQUIREMENTS) return RequirementType.TECHNICAL;
    if (sectionType === SectionType.USER_STORIES) return RequirementType.USER_STORY;
    if (lowerLine.includes('perform') || lowerLine.includes('function')) return RequirementType.FUNCTIONAL;
    if (lowerLine.includes('business') || lowerLine.includes('revenue')) return RequirementType.BUSINESS;
    return RequirementType.FUNCTIONAL;
  }

  private extractRequirementTitle(line: string): string {
    // Extract title from requirement line
    const cleaned = line.replace(/^[-*]\s*/, '').trim();
    return cleaned.split('.')[0] || cleaned.substring(0, 50);
  }

  private inferPriority(line: string): Requirement['priority'] {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('must') || lowerLine.includes('critical')) return 'must-have';
    if (lowerLine.includes('should') || lowerLine.includes('important')) return 'should-have';
    if (lowerLine.includes('could') || lowerLine.includes('nice')) return 'could-have';
    return 'should-have';
  }

  private extractAcceptanceCriteria(line: string): string[] {
    // Extract acceptance criteria from line - simplified implementation
    return [];
  }

  private inferConstraintType(line: string): ConstraintType {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('security') || lowerLine.includes('auth')) return ConstraintType.SECURITY;
    if (lowerLine.includes('budget') || lowerLine.includes('cost')) return ConstraintType.BUDGET;
    if (lowerLine.includes('time') || lowerLine.includes('deadline')) return ConstraintType.TIME;
    if (lowerLine.includes('technical') || lowerLine.includes('technology')) return ConstraintType.TECHNICAL;
    if (lowerLine.includes('business') || lowerLine.includes('policy')) return ConstraintType.BUSINESS;
    return ConstraintType.TECHNICAL;
  }

  private inferConstraintImpact(line: string): Constraint['impact'] {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('critical') || lowerLine.includes('must not')) return 'high';
    if (lowerLine.includes('important') || lowerLine.includes('avoid')) return 'medium';
    return 'low';
  }

  private mapPriorityToTaskMaster(priority: Requirement['priority']): TaskMasterPriority {
    switch (priority) {
      case 'must-have': return TaskMasterPriority.CRITICAL;
      case 'should-have': return TaskMasterPriority.HIGH;
      case 'could-have': return TaskMasterPriority.MEDIUM;
      default: return TaskMasterPriority.LOW;
    }
  }

  private estimateTaskHours(requirement: Requirement): number {
    const basehours = 4;
    let multiplier = 1;
    
    if (requirement.type === RequirementType.TECHNICAL) multiplier += 0.5;
    if (requirement.priority === 'must-have') multiplier += 0.3;
    if (requirement.acceptanceCriteria.length > 3) multiplier += 0.5;
    
    return Math.ceil(basehours * multiplier);
  }

  private estimateTaskComplexity(requirement: Requirement): number {
    let complexity = 3;
    
    if (requirement.type === RequirementType.TECHNICAL) complexity += 2;
    if (requirement.acceptanceCriteria.length > 5) complexity += 2;
    if (requirement.dependencies && requirement.dependencies.length > 0) complexity += 1;
    
    return Math.min(complexity, 10);
  }

  private inferSPARCPhaseFromTask(task: TaskMasterTask): SPARCPhase | undefined {
    const title = task.title.toLowerCase();
    if (title.includes('requirement') || title.includes('spec')) return SPARCPhase.SPECIFICATION;
    if (title.includes('design') || title.includes('architect')) return SPARCPhase.ARCHITECTURE;
    if (title.includes('implement') || title.includes('code')) return SPARCPhase.REFINEMENT;
    if (title.includes('test') || title.includes('validation')) return SPARCPhase.COMPLETION;
    return undefined;
  }

  private async getAvailableTasks(context: ProjectContext): Promise<TaskMasterTask[]> {
    // Mock implementation - would query actual task storage
    return [];
  }

  private calculateTaskScore(task: TaskMasterTask, context: ProjectContext): number {
    let score = 0;
    
    // Priority scoring
    score += task.priority * 10;
    
    // Phase alignment
    if (task.metadata?.prd_section && context.currentPhase) {
      // Bonus for current phase tasks
      score += 20;
    }
    
    // Dependency scoring (prefer tasks with no dependencies)
    if (!task.dependencies || task.dependencies.length === 0) {
      score += 15;
    }
    
    return score;
  }

  private generateRecommendationReasoning(task: TaskMasterTask, context: ProjectContext): string {
    const reasons = [];
    
    if (task.priority >= TaskMasterPriority.HIGH) {
      reasons.push('High priority task');
    }
    
    if (!task.dependencies || task.dependencies.length === 0) {
      reasons.push('No blocking dependencies');
    }
    
    if (task.estimate && task.estimate <= 4) {
      reasons.push('Quick win - estimated under 4 hours');
    }
    
    return reasons.join(', ') || 'Recommended based on current project state';
  }

  private suggestAgentForTask(task: TaskMasterTask): string | undefined {
    const title = task.title.toLowerCase();
    
    if (title.includes('requirement') || title.includes('spec')) return 'spec-pseudocode';
    if (title.includes('design') || title.includes('architect')) return 'architect';
    if (title.includes('test')) return 'tdd';
    if (title.includes('security')) return 'security-review';
    if (title.includes('deploy')) return 'devops';
    if (title.includes('document')) return 'docs-writer';
    
    return 'code'; // Default
  }

  private calculatePriority(task: TaskMasterTask, context: ProjectContext): number {
    return task.priority;
  }
}

export default PRDService;