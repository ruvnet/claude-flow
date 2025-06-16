/**
 * Smart Task Generator Service (Deno Compatible)
 * Generates intelligent task hierarchies from parsed PRDs
 */

import { ParsedPRD, Feature, Requirement } from './prd-parser-deno.ts';
import { TaskMasterTask } from '../adapters/task-adapter-deno.ts';

export interface GenerationOptions {
  depth?: number;
  sparcMapping?: boolean;
  assignAgents?: boolean;
  includeEstimates?: boolean;
  generateDependencies?: boolean;
}

export interface TaskTemplate {
  type: string;
  titlePattern: string;
  descriptionPattern: string;
  priority: string;
  sparc_mode?: string;
  subtaskTemplates?: TaskTemplate[];
}

export class SmartTaskGeneratorService {
  private taskTemplates: Map<string, TaskTemplate>;
  private sparcModeMapping: Map<string, string>;
  
  constructor() {
    this.initializeTemplates();
    this.initializeSparcMapping();
  }

  private initializeTemplates(): void {
    this.taskTemplates = new Map([
      ['architecture', {
        type: 'architecture',
        titlePattern: 'Design {feature} architecture',
        descriptionPattern: 'Create architectural design and technical specifications for {feature}',
        priority: 'high',
        sparc_mode: 'architect',
        subtaskTemplates: [
          {
            type: 'design',
            titlePattern: 'Create system diagrams',
            descriptionPattern: 'Design component diagrams and data flow',
            priority: 'high'
          },
          {
            type: 'design',
            titlePattern: 'Define API contracts',
            descriptionPattern: 'Specify API endpoints and data models',
            priority: 'high'
          }
        ]
      }],
      ['implementation', {
        type: 'implementation',
        titlePattern: 'Implement {feature}',
        descriptionPattern: 'Develop {feature} according to specifications',
        priority: 'medium',
        sparc_mode: 'code'
      }],
      ['testing', {
        type: 'testing',
        titlePattern: 'Test {feature}',
        descriptionPattern: 'Create comprehensive tests for {feature}',
        priority: 'high',
        sparc_mode: 'tdd',
        subtaskTemplates: [
          {
            type: 'testing',
            titlePattern: 'Write unit tests',
            descriptionPattern: 'Create unit tests with >80% coverage',
            priority: 'high'
          },
          {
            type: 'testing',
            titlePattern: 'Write integration tests',
            descriptionPattern: 'Test component interactions',
            priority: 'medium'
          }
        ]
      }],
      ['documentation', {
        type: 'documentation',
        titlePattern: 'Document {feature}',
        descriptionPattern: 'Create user and developer documentation',
        priority: 'medium',
        sparc_mode: 'docs-writer'
      }]
    ]);
  }

  private initializeSparcMapping(): void {
    this.sparcModeMapping = new Map([
      // Task type to SPARC mode mapping
      ['architecture', 'architect'],
      ['design', 'architect'],
      ['implementation', 'code'],
      ['api', 'api-only'],
      ['database', 'backend-only'],
      ['frontend', 'frontend-only'],
      ['ui', 'frontend-only'],
      ['testing', 'tdd'],
      ['security', 'security-review'],
      ['documentation', 'docs-writer'],
      ['deployment', 'devops'],
      ['monitoring', 'devops'],
      ['optimization', 'refinement-optimization-mode']
    ]);
  }

  async generateTasks(prd: ParsedPRD, options: GenerationOptions = {}): Promise<TaskMasterTask[]> {
    const tasks: TaskMasterTask[] = [];
    
    // Phase 1: Architecture tasks
    tasks.push(...this.generateArchitectureTasks(prd, options));
    
    // Phase 2: Feature implementation tasks
    tasks.push(...this.generateFeatureTasks(prd.features, options));
    
    // Phase 3: Technical requirement tasks
    tasks.push(...this.generateRequirementTasks(prd.requirements, options));
    
    // Phase 4: Testing tasks
    tasks.push(...this.generateTestingTasks(prd, options));
    
    // Phase 5: Documentation tasks
    tasks.push(...this.generateDocumentationTasks(prd, options));
    
    // Phase 6: Generate dependencies if requested
    if (options.generateDependencies) {
      this.generateDependencies(tasks);
    }
    
    return tasks;
  }

  private generateArchitectureTasks(prd: ParsedPRD, options: GenerationOptions): TaskMasterTask[] {
    const tasks: TaskMasterTask[] = [];
    
    // Main architecture task
    const archTask: TaskMasterTask = {
      id: crypto.randomUUID(),
      title: `Design ${prd.title} architecture`,
      description: `Create comprehensive architectural design for ${prd.title}`,
      type: 'architecture',
      priority: 'high',
      status: 'pending',
      assignee: null,
      sparc_mode: 'architect',
      subtasks: [],
      createdAt: new Date().toISOString()
    };
    
    // Add subtasks
    archTask.subtasks = [
      this.createTask('System design', 'Create high-level system architecture', 'design', 'high', 'architect'),
      this.createTask('Database design', 'Design database schema and relationships', 'database', 'high', 'backend-only'),
      this.createTask('API design', 'Design RESTful API endpoints', 'api', 'high', 'api-only'),
      this.createTask('Security design', 'Design security architecture', 'security', 'high', 'security-review')
    ];
    
    tasks.push(archTask);
    
    return tasks;
  }

  private generateFeatureTasks(features: Feature[], options: GenerationOptions): TaskMasterTask[] {
    const tasks: TaskMasterTask[] = [];
    
    for (const feature of features) {
      const task = this.createFeatureTask(feature, options);
      
      // Add subtasks based on feature complexity
      if (this.isComplexFeature(feature)) {
        task.subtasks = this.generateFeatureSubtasks(feature, options);
      }
      
      tasks.push(task);
    }
    
    return tasks;
  }

  private createFeatureTask(feature: Feature, options: GenerationOptions): TaskMasterTask {
    const taskType = this.detectTaskType(feature.description);
    const sparcMode = options.sparcMapping ? this.sparcModeMapping.get(taskType) : undefined;
    
    return {
      id: crypto.randomUUID(),
      title: feature.title || `Implement ${feature.description}`,
      description: feature.description,
      type: taskType,
      priority: feature.priority || 'medium',
      status: 'pending',
      assignee: null,
      sparc_mode: sparcMode,
      subtasks: [],
      metadata: {
        featureId: feature.id,
        category: feature.category,
        acceptanceCriteria: feature.acceptanceCriteria
      },
      createdAt: new Date().toISOString()
    };
  }

  private generateFeatureSubtasks(feature: Feature, options: GenerationOptions): TaskMasterTask[] {
    const subtasks: TaskMasterTask[] = [];
    
    // Backend task
    if (this.requiresBackend(feature)) {
      subtasks.push(this.createTask(
        `Backend: ${feature.title}`,
        `Implement backend logic for ${feature.title}`,
        'backend',
        'medium',
        options.sparcMapping ? 'backend-only' : undefined
      ));
    }
    
    // Frontend task
    if (this.requiresFrontend(feature)) {
      subtasks.push(this.createTask(
        `Frontend: ${feature.title}`,
        `Implement UI for ${feature.title}`,
        'frontend',
        'medium',
        options.sparcMapping ? 'frontend-only' : undefined
      ));
    }
    
    // API task
    if (this.requiresAPI(feature)) {
      subtasks.push(this.createTask(
        `API: ${feature.title}`,
        `Create API endpoints for ${feature.title}`,
        'api',
        'medium',
        options.sparcMapping ? 'api-only' : undefined
      ));
    }
    
    // Testing task
    subtasks.push(this.createTask(
      `Test: ${feature.title}`,
      `Write tests for ${feature.title}`,
      'testing',
      'high',
      options.sparcMapping ? 'tdd' : undefined
    ));
    
    return subtasks;
  }

  private generateRequirementTasks(requirements: Requirement[], options: GenerationOptions): TaskMasterTask[] {
    const tasks: TaskMasterTask[] = [];
    
    // Group requirements by type
    const grouped = this.groupRequirementsByType(requirements);
    
    for (const [type, reqs] of grouped.entries()) {
      if (reqs.length > 0) {
        const task = this.createRequirementGroupTask(type, reqs, options);
        tasks.push(task);
      }
    }
    
    return tasks;
  }

  private createRequirementGroupTask(type: string, requirements: Requirement[], options: GenerationOptions): TaskMasterTask {
    const task: TaskMasterTask = {
      id: crypto.randomUUID(),
      title: `Implement ${type} requirements`,
      description: `Address all ${type} requirements`,
      type: type,
      priority: 'high',
      status: 'pending',
      assignee: null,
      sparc_mode: options.sparcMapping ? this.getSparcModeForRequirementType(type) : undefined,
      subtasks: [],
      createdAt: new Date().toISOString()
    };
    
    // Create subtasks for each requirement
    task.subtasks = requirements.map(req => ({
      id: crypto.randomUUID(),
      title: this.createRequirementTitle(req),
      description: req.description,
      type: this.mapRequirementTypeToTaskType(req.type),
      priority: req.priority,
      status: 'pending',
      assignee: null,
      subtasks: [],
      createdAt: new Date().toISOString()
    }));
    
    return task;
  }

  private generateTestingTasks(prd: ParsedPRD, options: GenerationOptions): TaskMasterTask[] {
    const tasks: TaskMasterTask[] = [];
    
    const testingTask: TaskMasterTask = {
      id: crypto.randomUUID(),
      title: `Comprehensive testing for ${prd.title}`,
      description: 'Implement full test coverage',
      type: 'testing',
      priority: 'high',
      status: 'pending',
      assignee: null,
      sparc_mode: options.sparcMapping ? 'tdd' : undefined,
      subtasks: [
        this.createTask('Unit tests', 'Write unit tests for all components', 'testing', 'high', 'tdd'),
        this.createTask('Integration tests', 'Test component interactions', 'testing', 'high', 'tdd'),
        this.createTask('E2E tests', 'End-to-end user journey tests', 'testing', 'medium', 'tdd'),
        this.createTask('Performance tests', 'Load and stress testing', 'testing', 'medium', 'tdd'),
        this.createTask('Security tests', 'Security vulnerability testing', 'testing', 'high', 'security-review')
      ],
      createdAt: new Date().toISOString()
    };
    
    tasks.push(testingTask);
    
    return tasks;
  }

  private generateDocumentationTasks(prd: ParsedPRD, options: GenerationOptions): TaskMasterTask[] {
    const tasks: TaskMasterTask[] = [];
    
    const docTask: TaskMasterTask = {
      id: crypto.randomUUID(),
      title: `Documentation for ${prd.title}`,
      description: 'Create comprehensive documentation',
      type: 'documentation',
      priority: 'medium',
      status: 'pending',
      assignee: null,
      sparc_mode: options.sparcMapping ? 'docs-writer' : undefined,
      subtasks: [
        this.createTask('API documentation', 'Document all API endpoints', 'documentation', 'high', 'docs-writer'),
        this.createTask('User guide', 'Create end-user documentation', 'documentation', 'medium', 'docs-writer'),
        this.createTask('Developer guide', 'Technical documentation for developers', 'documentation', 'medium', 'docs-writer'),
        this.createTask('Deployment guide', 'Installation and deployment instructions', 'documentation', 'medium', 'devops')
      ],
      createdAt: new Date().toISOString()
    };
    
    tasks.push(docTask);
    
    return tasks;
  }

  private generateDependencies(tasks: TaskMasterTask[]): void {
    // Simple dependency generation based on task types
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const tasksByType = this.groupTasksByType(tasks);
    
    // Architecture tasks have no dependencies
    // Implementation tasks depend on architecture
    const archTasks = tasksByType.get('architecture') || [];
    const implTasks = tasksByType.get('implementation') || [];
    
    for (const implTask of implTasks) {
      if (archTasks.length > 0) {
        implTask.dependencies = [archTasks[0].id];
      }
    }
    
    // Testing tasks depend on implementation
    const testTasks = tasksByType.get('testing') || [];
    for (const testTask of testTasks) {
      if (implTasks.length > 0) {
        testTask.dependencies = implTasks.map(t => t.id);
      }
    }
    
    // Documentation can be done in parallel but benefits from completed implementation
    const docTasks = tasksByType.get('documentation') || [];
    for (const docTask of docTasks) {
      if (implTasks.length > 0) {
        docTask.dependencies = [implTasks[0].id];
      }
    }
  }

  // Helper methods
  private createTask(
    title: string, 
    description: string, 
    type: string, 
    priority: string, 
    sparcMode?: string
  ): TaskMasterTask {
    return {
      id: crypto.randomUUID(),
      title,
      description,
      type,
      priority,
      status: 'pending',
      assignee: null,
      sparc_mode: sparcMode,
      subtasks: [],
      createdAt: new Date().toISOString()
    };
  }

  private detectTaskType(description: string): string {
    const lower = description.toLowerCase();
    
    if (lower.includes('api') || lower.includes('endpoint')) return 'api';
    if (lower.includes('database') || lower.includes('schema')) return 'database';
    if (lower.includes('ui') || lower.includes('interface') || lower.includes('frontend')) return 'frontend';
    if (lower.includes('security') || lower.includes('auth')) return 'security';
    if (lower.includes('test')) return 'testing';
    if (lower.includes('document')) return 'documentation';
    
    return 'implementation';
  }

  private isComplexFeature(feature: Feature): boolean {
    // Consider a feature complex if it has multiple components or mentions multiple systems
    const indicators = ['and', 'with', 'including', 'multiple', 'various', 'system'];
    const lower = feature.description.toLowerCase();
    
    return indicators.some(indicator => lower.includes(indicator));
  }

  private requiresBackend(feature: Feature): boolean {
    const backendIndicators = ['data', 'database', 'api', 'server', 'process', 'calculate', 'store'];
    return backendIndicators.some(ind => feature.description.toLowerCase().includes(ind));
  }

  private requiresFrontend(feature: Feature): boolean {
    const frontendIndicators = ['ui', 'interface', 'display', 'show', 'view', 'form', 'button'];
    return frontendIndicators.some(ind => feature.description.toLowerCase().includes(ind));
  }

  private requiresAPI(feature: Feature): boolean {
    const apiIndicators = ['api', 'endpoint', 'service', 'integration', 'external'];
    return apiIndicators.some(ind => feature.description.toLowerCase().includes(ind));
  }

  private groupRequirementsByType(requirements: Requirement[]): Map<string, Requirement[]> {
    const grouped = new Map<string, Requirement[]>();
    
    for (const req of requirements) {
      const type = req.type;
      if (!grouped.has(type)) {
        grouped.set(type, []);
      }
      grouped.get(type)!.push(req);
    }
    
    return grouped;
  }

  private getSparcModeForRequirementType(type: string): string {
    const mapping: Record<string, string> = {
      'technical': 'architect',
      'functional': 'code',
      'non-functional': 'refinement-optimization-mode',
      'business': 'spec-pseudocode'
    };
    
    return mapping[type] || 'code';
  }

  private createRequirementTitle(req: Requirement): string {
    // Create concise title from requirement description
    const words = req.description.split(' ').slice(0, 5);
    return words.join(' ') + (words.length < req.description.split(' ').length ? '...' : '');
  }

  private mapRequirementTypeToTaskType(reqType: string): string {
    const mapping: Record<string, string> = {
      'technical': 'implementation',
      'functional': 'implementation',
      'non-functional': 'optimization',
      'business': 'planning'
    };
    
    return mapping[reqType] || 'implementation';
  }

  private groupTasksByType(tasks: TaskMasterTask[]): Map<string, TaskMasterTask[]> {
    const grouped = new Map<string, TaskMasterTask[]>();
    
    for (const task of tasks) {
      if (!grouped.has(task.type)) {
        grouped.set(task.type, []);
      }
      grouped.get(task.type)!.push(task);
    }
    
    return grouped;
  }
}