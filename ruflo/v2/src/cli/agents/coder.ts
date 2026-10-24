/**
 * Coder Agent - Specialized in software development and code generation
 */

import { BaseAgent } from './base-agent.js';
import type {
  AgentCapabilities,
  AgentConfig,
  AgentEnvironment,
  TaskDefinition,
} from '../../swarm/types.js';
import type { ILogger } from '../../core/logger.js';
import type { IEventBus } from '../../core/event-bus.js';
import type { DistributedMemorySystem } from '../../memory/distributed-memory.js';

// Type definitions for coder activities
interface CodeFile {
  path: string;
  content: string;
  type: string;
}

interface TestFile {
  path: string;
  content: string;
  framework: string;
}

interface DatabaseTable {
  name: string;
  columns: string[];
}

export class CoderAgent extends BaseAgent {
  constructor(
    id: string,
    config: AgentConfig,
    environment: AgentEnvironment,
    logger: ILogger,
    eventBus: IEventBus,
    memory: DistributedMemorySystem,
  ) {
    super(id, 'coder', config, environment, logger, eventBus, memory);
  }

  protected getDefaultCapabilities(): AgentCapabilities {
    return {
      codeGeneration: true,
      codeReview: true,
      testing: true,
      documentation: true,
      research: false,
      analysis: true,
      webSearch: false,
      apiIntegration: true,
      fileSystem: true,
      terminalAccess: true,
      languages: [
        'typescript',
        'javascript',
        'python',
        'rust',
        'go',
        'java',
        'cpp',
        'csharp',
        'php',
        'ruby',
        'swift',
        'kotlin',
      ],
      frameworks: [
        'deno',
        'node',
        'react',
        'vue',
        'svelte',
        'angular',
        'express',
        'fastify',
        'nextjs',
        'nuxtjs',
        'django',
        'flask',
        'spring',
        'rails',
      ],
      domains: [
        'web-development',
        'backend-development',
        'frontend-development',
        'api-development',
        'database-design',
        'devops',
        'mobile-development',
        'microservices',
        'fullstack-development',
        'system-architecture',
      ],
      tools: [
        'git',
        'editor',
        'debugger',
        'linter',
        'formatter',
        'compiler',
        'bundler',
        'package-manager',
        'docker',
        'kubernetes',
        'ci-cd',
        'testing-framework',
      ],
      maxConcurrentTasks: 3,
      maxMemoryUsage: 1024 * 1024 * 1024, // 1GB
      maxExecutionTime: 1800000, // 30 minutes
      reliability: 0.95,
      speed: 0.75,
      quality: 0.95,
    };
  }

  protected getDefaultConfig(): Partial<AgentConfig> {
    return {
      autonomyLevel: 0.7,
      learningEnabled: true,
      adaptationEnabled: true,
      maxTasksPerHour: 12,
      maxConcurrentTasks: 3,
      timeoutThreshold: 1800000,
      reportingInterval: 60000,
      heartbeatInterval: 15000,
      permissions: [
        'file-read',
        'file-write',
        'terminal-access',
        'git-access',
        'package-install',
        'docker-access',
      ],
      trustedAgents: [],
      expertise: {
        'code-generation': 0.95,
        debugging: 0.9,
        testing: 0.85,
        refactoring: 0.92,
        architecture: 0.8,
        performance: 0.85,
      },
      preferences: {
        codeStyle: 'functional',
        testFramework: 'jest',
        lintingStrict: true,
        documentation: 'comprehensive',
        errorHandling: 'robust',
      },
    };
  }

  override async executeTask(task: TaskDefinition): Promise<any> {
    this.logger.info('Coder executing task', {
      agentId: this.id,
      taskType: task.type,
      taskId: task.id,
    });

    try {
      switch (task.type) {
        case 'code-generation':
          return await this.generateCode(task);
        case 'code-review':
          return await this.reviewCode(task);
        case 'refactoring':
          return await this.refactorCode(task);
        case 'testing':
          return await this.writeTests(task);
        case 'debugging':
          return await this.debugCode(task);
        case 'api-development':
          return await this.developAPI(task);
        case 'database-design':
          return await this.designDatabase(task);
        case 'performance-optimization':
          return await this.optimizePerformance(task);
        default:
          return await this.performGeneralDevelopment(task);
      }
    } catch (error) {
      this.logger.error('Coding task failed', {
        agentId: this.id,
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async generateCode(task: TaskDefinition): Promise<any> {
    const requirements = task.input?.requirements || task.description;
    const language = task.input?.language || 'typescript';
    const framework = task.input?.framework;
    const style = task.input?.style || 'functional';

    this.logger.info('Generating code', {
      requirements,
      language,
      framework,
      style,
    });

    const result = {
      requirements,
      language,
      framework,
      style,
      files: [] as CodeFile[],
      tests: [] as TestFile[],
      documentation: '',
      metrics: {
        linesOfCode: 0,
        complexity: 0,
        testCoverage: 0,
        quality: 0,
      },
      dependencies: [] as string[],
      buildInstructions: [] as string[],
      timestamp: new Date(),
    };

    // Store development progress
    await this.memory.store(
      `code:${task.id}:progress`,
      {
        status: 'generating',
        startTime: new Date(),
        requirements,
      },
      {
        type: 'code-progress',
        tags: ['coding', this.id, language],
        partition: 'tasks',
      },
    );

    // Simulate code generation
    await this.delay(3000);

    result.files = [
      {
        path: `src/main.${this.getFileExtension(language)}`,
        content: this.generateSampleCode(language, requirements),
        type: 'main',
      },
      {
        path: `src/types.${this.getFileExtension(language)}`,
        content: this.generateTypesCode(language),
        type: 'types',
      },
    ];

    result.tests = [
      {
        path: `tests/main.test.${this.getFileExtension(language)}`,
        content: this.generateTestCode(language, requirements),
        framework: 'jest',
      },
    ];

    result.documentation = this.generateDocumentation(requirements, language);
    result.metrics = {
      linesOfCode: 150,
      complexity: 3.2,
      testCoverage: 85,
      quality: 0.92,
    };

    result.dependencies = this.suggestDependencies(language, framework) as any[];
    result.buildInstructions = this.generateBuildInstructions(language, framework) as string[];

    // Store final results
    await this.memory.store(`code:${task.id}:results`, result, {
      type: 'code-results',
      tags: ['coding', 'completed', this.id, language],
      partition: 'tasks',
    });

    return result;
  }

  private async reviewCode(task: TaskDefinition): Promise<any> {
    const code = task.input?.code;
    const files = task.input?.files || [];
    const focus = task.input?.focus || ['quality', 'security', 'performance'];

    this.logger.info('Reviewing code', {
      filesCount: files.length,
      focus,
    });

    const review = {
      files: [] as any[],
      overallScore: 0,
      issues: [] as any[],
      suggestions: [] as any[],
      metrics: {
        maintainability: 0,
        readability: 0,
        performance: 0,
        security: 0,
        testability: 0,
      },
      recommendations: [] as any[],
      priorityFixes: [] as any[],
      timestamp: new Date(),
    };

    // Simulate code review
    await this.delay(2500);

    review.overallScore = 0.88;
    review.issues = [
      {
        type: 'performance',
        severity: 'medium',
        message: 'Potential memory leak in async handler',
        file: 'src/handlers.ts',
        line: 45,
        suggestion: 'Add proper cleanup in finally block',
      },
      {
        type: 'security',
        severity: 'high',
        message: 'Input validation missing',
        file: 'src/api.ts',
        line: 23,
        suggestion: 'Implement input sanitization',
      },
    ];

    review.metrics = {
      maintainability: 0.85,
      readability: 0.9,
      performance: 0.82,
      security: 0.75,
      testability: 0.88,
    };

    return review;
  }

  private async refactorCode(task: TaskDefinition): Promise<any> {
    const code = task.input?.code;
    const goals = task.input?.goals || ['maintainability', 'performance'];
    const preserveAPI = task.input?.preserveAPI || true;

    this.logger.info('Refactoring code', {
      goals,
      preserveAPI,
    });

    const refactoring = {
      originalFiles: [] as any[],
      refactoredFiles: [] as any[],
      changes: [] as string[],
      improvements: {
        maintainability: 0,
        performance: 0,
        readability: 0,
        testability: 0,
      },
      breakingChanges: [] as any[],
      migrationGuide: '',
      testResults: {
        passed: 0,
        failed: 0,
        coverage: 0,
      },
      timestamp: new Date(),
    };

    // Simulate refactoring
    await this.delay(4000);

    refactoring.changes = [
      'Extracted common functionality into utility functions',
      'Improved error handling with custom error classes',
      'Optimized database queries using connection pooling',
      'Added comprehensive type definitions',
    ];

    refactoring.improvements = {
      maintainability: 0.25,
      performance: 0.15,
      readability: 0.3,
      testability: 0.2,
    };

    return refactoring;
  }

  private async writeTests(task: TaskDefinition): Promise<any> {
    const code = task.input?.code;
    const testType = task.input?.type || 'unit';
    const coverage = task.input?.coverage || 80;
    const framework = task.input?.framework || 'jest';

    this.logger.info('Writing tests', {
      testType,
      coverage,
      framework,
    });

    const testing = {
      testType,
      framework,
      targetCoverage: coverage,
      testFiles: [] as any[],
      testSuites: [] as any[],
      coverage: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
      testResults: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
      },
      mockingStrategy: '',
      timestamp: new Date(),
    };

    // Simulate test writing
    await this.delay(2000);

    testing.testFiles = [
      {
        path: 'tests/unit/service.test.ts',
        content: this.generateTestCode('typescript', 'service tests'),
        testCount: 12,
      },
      {
        path: 'tests/integration/api.test.ts',
        content: this.generateTestCode('typescript', 'API integration tests'),
        testCount: 8,
      },
    ];

    testing.coverage = {
      lines: 87,
      functions: 92,
      branches: 78,
      statements: 89,
    };

    testing.testResults = {
      total: 20,
      passed: 19,
      failed: 1,
      skipped: 0,
    };

    return testing;
  }

  private async debugCode(task: TaskDefinition): Promise<any> {
    const code = task.input?.code;
    const error = task.input?.error;
    const symptoms = task.input?.symptoms || [];
    const environment = task.input?.environment || 'development';

    this.logger.info('Debugging code', {
      error: error?.message,
      symptoms,
      environment,
    });

    const debugging = {
      error,
      symptoms,
      environment,
      investigation: [] as string[],
      rootCause: '',
      solution: '',
      fixes: [] as any[],
      preventionMeasures: [] as string[],
      testCases: [] as any[],
      confidence: 0,
      timestamp: new Date(),
    };

    // Simulate debugging
    await this.delay(3500);

    debugging.investigation = [
      'Analyzed stack trace and error context',
      'Reviewed recent code changes',
      'Checked environment configuration',
      'Examined dependency versions',
    ];

    debugging.rootCause = 'Race condition in async event handler';
    debugging.solution = 'Implement proper synchronization using mutex';
    debugging.confidence = 0.92;

    return debugging;
  }

  private async developAPI(task: TaskDefinition): Promise<any> {
    const spec = task.input?.spec;
    const framework = task.input?.framework || 'express';
    const database = task.input?.database || 'postgresql';
    const auth = task.input?.auth || 'jwt';

    this.logger.info('Developing API', {
      framework,
      database,
      auth,
    });

    const api = {
      framework,
      database,
      auth,
      endpoints: [] as any[],
      models: [] as any[],
      middleware: [] as any[],
      documentation: '',
      security: {
        authentication: auth,
        authorization: 'rbac',
        inputValidation: true,
        rateLimiting: true,
        cors: true,
      },
      testing: {
        unit: true,
        integration: true,
        e2e: false,
      },
      deployment: {
        containerized: true,
        scalable: true,
        monitoring: true,
      },
      timestamp: new Date(),
    };

    // Simulate API development
    await this.delay(5000);

    api.endpoints = [
      { method: 'GET', path: '/api/users', description: 'List users' },
      { method: 'POST', path: '/api/users', description: 'Create user' },
      { method: 'GET', path: '/api/users/:id', description: 'Get user by ID' },
      { method: 'PUT', path: '/api/users/:id', description: 'Update user' },
      { method: 'DELETE', path: '/api/users/:id', description: 'Delete user' },
    ];

    return api;
  }

  private async designDatabase(task: TaskDefinition): Promise<any> {
    const requirements = task.input?.requirements;
    const dbType = task.input?.type || 'relational';
    const engine = task.input?.engine || 'postgresql';

    this.logger.info('Designing database', {
      dbType,
      engine,
    });

    const design = {
      type: dbType,
      engine,
      schema: {},
      tables: [] as DatabaseTable[],
      relationships: [],
      indexes: [],
      constraints: [],
      migrations: [],
      performance: {
        queryOptimization: true,
        indexingStrategy: 'balanced',
        cachingLayer: 'redis',
      },
      timestamp: new Date(),
    };

    // Simulate database design
    await this.delay(3000);

    design.tables = [
      { name: 'users', columns: ['id', 'email', 'password', 'created_at'] },
      { name: 'posts', columns: ['id', 'user_id', 'title', 'content', 'created_at'] },
      { name: 'comments', columns: ['id', 'post_id', 'user_id', 'content', 'created_at'] },
    ];

    return design;
  }

  private async optimizePerformance(task: TaskDefinition): Promise<any> {
    const code = task.input?.code;
    const metrics = task.input?.metrics;
    const targets = task.input?.targets || ['speed', 'memory'];

    this.logger.info('Optimizing performance', {
      targets,
    });

    const optimization = {
      targets,
      analysis: {
        bottlenecks: [] as string[],
        hotspots: [] as string[],
        recommendations: [] as string[],
      },
      optimizations: [],
      results: {
        speedImprovement: 0,
        memoryReduction: 0,
        throughputIncrease: 0,
      },
      tradeoffs: [],
      timestamp: new Date(),
    };

    // Simulate performance optimization
    await this.delay(4000);

    optimization.analysis.bottlenecks = [
      'Database queries in loops',
      'Large object instantiation',
      'Inefficient algorithms',
    ];

    optimization.results = {
      speedImprovement: 0.35,
      memoryReduction: 0.22,
      throughputIncrease: 0.45,
    };

    return optimization;
  }

  private async performGeneralDevelopment(task: TaskDefinition): Promise<any> {
    this.logger.info('Performing general development', {
      description: task.description,
    });

    // Default to code generation
    return await this.generateCode(task);
  }

  // Helper methods
  private getFileExtension(language: string): string {
    const extensions = {
      typescript: 'ts',
      javascript: 'js',
      python: 'py',
      rust: 'rs',
      go: 'go',
      java: 'java',
      cpp: 'cpp',
      csharp: 'cs',
      php: 'php',
      ruby: 'rb',
      swift: 'swift',
      kotlin: 'kt',
    };
    return extensions[language as keyof typeof extensions] || 'txt';
  }

  private generateSampleCode(language: string, requirements: string): string {
    const templates = {
      typescript: `
// ${requirements}
export class Application {
  constructor() {
    console.log('Application initialized');
  }

  public start(): void {
    // Implementation here
  }
}
`,
      javascript: `
// ${requirements}
class Application {
  constructor() {
    console.log('Application initialized');
  }

  start() {
    // Implementation here
  }
}

module.exports = Application;
`,
      python: `
# ${requirements}
class Application:
    def __init__(self):
        print('Application initialized')
    
    def start(self):
        # Implementation here
        pass
`,
    };
    return (
      templates[language as keyof typeof templates] ||
      `// ${requirements}\n// Code implementation\n`
    );
  }

  private generateTypesCode(language: string): string {
    if (language === 'typescript') {
      return `
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}
`;
    }
    return '// Type definitions\n';
  }

  private generateTestCode(language: string, description: string): string {
    const templates = {
      typescript: `
import { Application } from '../src/main';

describe('${description}', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application();
  });

  test('should initialize correctly', () => {
    expect(app).toBeDefined();
  });

  test('should start successfully', () => {
    expect(() => app.start()).not.toThrow();
  });
});
`,
      javascript: `
const Application = require('../src/main');

describe('${description}', () => {
  let app;

  beforeEach(() => {
    app = new Application();
  });

  test('should initialize correctly', () => {
    expect(app).toBeDefined();
  });

  test('should start successfully', () => {
    expect(() => app.start()).not.toThrow();
  });
});
`,
    };
    return templates[language as keyof typeof templates] || `// Test code for ${description}\n`;
  }

  private generateDocumentation(requirements: string, language: string): string {
    return `
# ${requirements}

## Overview
This ${language} application implements the specified requirements.

## Installation
\`\`\`bash
npm install
\`\`\`

## Usage
\`\`\`${language}
// Example usage
\`\`\`

## API Reference
- Method 1: Description
- Method 2: Description

## Testing
\`\`\`bash
npm test
\`\`\`
`;
  }

  private suggestDependencies(language: string, framework?: string): string[] {
    const baseDeps = {
      typescript: ['typescript', '@types/node'],
      javascript: ['lodash', 'axios'],
      python: ['requests', 'pytest'],
      rust: ['serde', 'tokio'],
      go: ['gin', 'gorm'],
    };

    const frameworkDeps = {
      express: ['express', 'cors', 'helmet'],
      react: ['react', 'react-dom', '@types/react'],
      vue: ['vue', 'vue-router'],
      django: ['django', 'djangorestframework'],
      spring: ['spring-boot', 'spring-data-jpa'],
    };

    const deps = baseDeps[language as keyof typeof baseDeps] || [];
    if (framework && frameworkDeps[framework as keyof typeof frameworkDeps]) {
      deps.push(...frameworkDeps[framework as keyof typeof frameworkDeps]);
    }

    return deps;
  }

  private generateBuildInstructions(language: string, framework?: string): string[] {
    const instructions = {
      typescript: ['npm install', 'npm run build', 'npm start'],
      javascript: ['npm install', 'npm start'],
      python: ['python -m pip install -r requirements.txt', 'python main.py'],
      rust: ['cargo build --release', 'cargo run'],
      go: ['go mod tidy', 'go build', './main'],
    };

    return (
      instructions[language as keyof typeof instructions] || ['Build instructions not available']
    );
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  override getAgentStatus(): any {
    return {
      ...super.getAgentStatus(),
      specialization: 'Software Development & Code Generation',
      programmingLanguages: this.capabilities.languages,
      frameworks: this.capabilities.frameworks,
      currentProjects: this.getCurrentTasks().length,
      averageDevelopmentTime: '15-30 minutes',
      codeQualityScore: this.metrics.codeQuality,
      testCoverage: this.metrics.testCoverage,
      lastCodeGenerated: this.getLastTaskCompletedTime(),
      preferredStyle: this.config.preferences?.codeStyle || 'functional',
    };
  }
}

export const createCoderAgent = (
  id: string,
  config: Partial<AgentConfig>,
  environment: Partial<AgentEnvironment>,
  logger: ILogger,
  eventBus: IEventBus,
  memory: DistributedMemorySystem,
): CoderAgent => {
  const defaultConfig = {
    autonomyLevel: 0.7,
    learningEnabled: true,
    adaptationEnabled: true,
    maxTasksPerHour: 15,
    maxConcurrentTasks: 2,
    timeoutThreshold: 300000,
    reportingInterval: 45000,
    heartbeatInterval: 20000,
    permissions: [
      'file-read',
      'file-write',
      'directory-create',
      'code-execution',
      'package-management',
      'git-operations',
    ],
    trustedAgents: [],
    expertise: {
      'code-generation': 0.95,
      debugging: 0.9,
      refactoring: 0.88,
      testing: 0.85,
      'performance-optimization': 0.87,
    },
    preferences: {
      codingStyle: 'clean',
      testingApproach: 'comprehensive',
      documentationLevel: 'moderate',
      refactoringFrequency: 'regular',
    },
  };
  const defaultEnv = {
    runtime: 'deno' as const,
    version: '1.40.0',
    workingDirectory: './agents/coder',
    tempDirectory: './tmp/coder',
    logDirectory: './logs/coder',
    apiEndpoints: {},
    credentials: {},
    availableTools: ['git', 'editor', 'debugger', 'linter', 'formatter', 'compiler'],
    toolConfigs: {
      git: { autoCommit: false, autoSync: true },
      linter: { strict: true, autoFix: true },
      formatter: { style: 'prettier', tabSize: 2 },
    },
  };

  return new CoderAgent(
    id,
    { ...defaultConfig, ...config } as AgentConfig,
    { ...defaultEnv, ...environment } as AgentEnvironment,
    logger,
    eventBus,
    memory,
  );
};
