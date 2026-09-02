/**
 * SpecializedWorker - Domain-Specialized Worker Implementation
 *
 * Extends WorkerBase with domain-specific capabilities and
 * intelligent task matching using embedding-based similarity.
 *
 * Features:
 * - Domain specialization with configurable focus areas
 * - Embedding-based task matching for intelligent routing
 * - Capability verification and scoring
 * - Domain-specific execution strategies
 *
 * Compatible with agentic-flow's SpecializedAgent pattern.
 *
 * @module v3/integration/specialized-worker
 * @version 3.0.0-alpha.1
 */

import {
  WorkerBase,
  WorkerConfig,
  WorkerType,
  AgentOutput,
  WorkerArtifact,
} from './worker-base.js';
import type { Task } from './agentic-flow-agent.js';

/**
 * Domain specialization types
 */
export type DomainSpecialization =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'devops'
  | 'security'
  | 'performance'
  | 'testing'
  | 'documentation'
  | 'architecture'
  | 'machine-learning'
  | 'data-engineering'
  | 'mobile'
  | 'infrastructure'
  | 'api-design'
  | 'code-review'
  | 'custom';

/**
 * Specialized worker configuration
 */
export interface SpecializedWorkerConfig extends WorkerConfig {
  /** Primary domain specialization */
  domain: DomainSpecialization;
  /** Secondary domains (ordered by proficiency) */
  secondaryDomains?: DomainSpecialization[];
  /** Domain-specific skills with proficiency levels (0.0-1.0) */
  skills?: Map<string, number> | Record<string, number>;
  /** Preferred programming languages */
  languages?: string[];
  /** Preferred frameworks */
  frameworks?: string[];
  /** Preferred tools */
  tools?: string[];
  /** Domain expertise level (0.0-1.0) */
  expertiseLevel?: number;
  /** Enable domain-specific preprocessing */
  enablePreprocessing?: boolean;
  /** Enable domain-specific postprocessing */
  enablePostprocessing?: boolean;
  /** Custom domain handlers */
  handlers?: DomainHandlers;
}

/**
 * Domain-specific handlers for specialized processing
 */
export interface DomainHandlers {
  /** Preprocess task before execution */
  preprocess?: (task: Task, worker: SpecializedWorker) => Promise<Task>;
  /** Postprocess output after execution */
  postprocess?: (output: AgentOutput, task: Task, worker: SpecializedWorker) => Promise<AgentOutput>;
  /** Validate task for domain compatibility */
  validate?: (task: Task, worker: SpecializedWorker) => Promise<boolean>;
  /** Generate domain-specific artifacts */
  generateArtifacts?: (output: AgentOutput, task: Task, worker: SpecializedWorker) => Promise<WorkerArtifact[]>;
}

/**
 * Task matching result with detailed scoring
 */
export interface TaskMatchResult {
  /** Overall match score (0.0-1.0) */
  score: number;
  /** Breakdown of scoring components */
  breakdown: {
    /** Capability match score */
    capabilityScore: number;
    /** Domain match score */
    domainScore: number;
    /** Embedding similarity score */
    embeddingScore: number;
    /** Skill match score */
    skillScore: number;
  };
  /** Whether worker meets minimum requirements */
  meetsRequirements: boolean;
  /** Missing capabilities */
  missingCapabilities: string[];
  /** Matched capabilities */
  matchedCapabilities: string[];
  /** Recommendations for better matching */
  recommendations?: string[];
}

/**
 * Domain embedding configurations
 */
const DOMAIN_EMBEDDINGS: Record<DomainSpecialization, number[]> = {
  frontend: [1, 0, 0, 0, 0, 0.2, 0.3, 0.5, 0.2, 0, 0, 0.4, 0, 0.3, 0.2, 0],
  backend: [0, 1, 0.3, 0, 0, 0.3, 0.2, 0.3, 0.5, 0, 0.3, 0, 0.2, 0.5, 0.2, 0],
  database: [0, 0.3, 1, 0, 0, 0.4, 0.2, 0.2, 0.3, 0, 0.5, 0, 0.3, 0.4, 0.1, 0],
  devops: [0, 0.2, 0.2, 1, 0.3, 0.3, 0.2, 0.4, 0.3, 0, 0.2, 0, 0.8, 0.2, 0.1, 0],
  security: [0, 0.3, 0.3, 0.4, 1, 0.4, 0.5, 0.3, 0.3, 0, 0, 0, 0.3, 0.4, 0.6, 0],
  performance: [0.3, 0.4, 0.4, 0.3, 0.2, 1, 0.3, 0.2, 0.3, 0, 0, 0, 0.2, 0.2, 0.2, 0],
  testing: [0.3, 0.3, 0.2, 0.3, 0.4, 0.3, 1, 0.4, 0.2, 0, 0, 0.3, 0.2, 0.2, 0.3, 0],
  documentation: [0.4, 0.3, 0.2, 0.2, 0.2, 0.1, 0.3, 1, 0.3, 0, 0, 0.3, 0.1, 0.5, 0.2, 0],
  architecture: [0.3, 0.4, 0.4, 0.4, 0.4, 0.4, 0.3, 0.5, 1, 0.2, 0.3, 0.2, 0.4, 0.6, 0.4, 0],
  'machine-learning': [0.2, 0.3, 0.3, 0.2, 0.2, 0.5, 0.3, 0.3, 0.3, 1, 0.6, 0.2, 0.3, 0.3, 0.2, 0],
  'data-engineering': [0, 0.3, 0.6, 0.3, 0.2, 0.4, 0.2, 0.2, 0.4, 0.5, 1, 0, 0.4, 0.4, 0.2, 0],
  mobile: [0.5, 0.3, 0.2, 0.3, 0.3, 0.4, 0.4, 0.3, 0.3, 0.2, 0, 1, 0.2, 0.3, 0.2, 0],
  infrastructure: [0, 0.2, 0.3, 0.7, 0.4, 0.3, 0.2, 0.3, 0.5, 0, 0.3, 0, 1, 0.2, 0.3, 0],
  'api-design': [0.2, 0.6, 0.3, 0.2, 0.3, 0.3, 0.2, 0.6, 0.5, 0, 0.2, 0.2, 0.2, 1, 0.3, 0],
  'code-review': [0.4, 0.4, 0.3, 0.3, 0.5, 0.4, 0.5, 0.4, 0.4, 0.2, 0.2, 0.3, 0.2, 0.4, 1, 0],
  custom: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
};

/**
 * SpecializedWorker - Domain-focused worker with intelligent matching
 *
 * Usage:
 * ```typescript
 * const worker = new SpecializedWorker({
 *   id: 'frontend-1',
 *   type: 'specialized',
 *   domain: 'frontend',
 *   capabilities: ['react', 'typescript', 'css'],
 *   skills: { react: 0.9, typescript: 0.85, css: 0.8 },
 *   languages: ['typescript', 'javascript'],
 *   frameworks: ['react', 'next.js'],
 * });
 *
 * await worker.initialize();
 *
 * // Match a task
 * const match = worker.matchTask(task);
 * if (match.score > 0.7) {
 *   const result = await worker.execute(task);
 * }
 * ```
 */
export class SpecializedWorker extends WorkerBase {
  /** Primary domain specialization */
  readonly domain: DomainSpecialization;

  /** Secondary domains */
  readonly secondaryDomains: DomainSpecialization[];

  /** Domain-specific skills with proficiency levels */
  protected skills: Map<string, number>;

  /** Preferred programming languages */
  protected languages: string[];

  /** Preferred frameworks */
  protected frameworks: string[];

  /** Preferred tools */
  protected tools: string[];

  /** Domain expertise level */
  protected expertiseLevel: number;

  /** Domain-specific handlers */
  protected handlers: DomainHandlers;

  /** Enable preprocessing */
  protected enablePreprocessing: boolean;

  /** Enable postprocessing */
  protected enablePostprocessing: boolean;

  /**
   * Create a new SpecializedWorker instance
   *
   * @param config - Specialized worker configuration
   */
  constructor(config: SpecializedWorkerConfig) {
    // Extend type to specialized if not already set
    const baseConfig: WorkerConfig = {
      ...config,
      type: config.type || 'specialized',
    };

    super(baseConfig);

    this.domain = config.domain;
    this.secondaryDomains = config.secondaryDomains || [];
    this.languages = config.languages || [];
    this.frameworks = config.frameworks || [];
    this.tools = config.tools || [];
    this.expertiseLevel = config.expertiseLevel ?? 0.8;
    this.enablePreprocessing = config.enablePreprocessing ?? true;
    this.enablePostprocessing = config.enablePostprocessing ?? true;
    this.handlers = config.handlers || {};

    // Convert skills to Map
    if (config.skills instanceof Map) {
      this.skills = config.skills;
    } else if (config.skills) {
      this.skills = new Map(Object.entries(config.skills));
    } else {
      this.skills = new Map();
    }

    // Generate domain-specific embedding
    this.specialization = this.generateDomainEmbedding();

    this.emit('specialized-worker-created', {
      workerId: this.id,
      domain: this.domain,
      expertiseLevel: this.expertiseLevel,
    });
  }

  /**
   * Match a task to this worker
   *
   * Calculates a comprehensive match score based on:
   * - Capability overlap
   * - Domain compatibility
   * - Embedding similarity
   * - Skill proficiency
   *
   * @param task - Task to match
   * @returns Detailed match result with scores
   */
  matchTask(task: Task): TaskMatchResult {
    const requiredCapabilities = this.extractRequiredCapabilities(task);
    const taskDomain = this.inferTaskDomain(task);
    const taskEmbedding = this.generateTaskEmbedding(task);

    // Calculate capability score
    const { matched, missing, score: capabilityScore } =
      this.calculateCapabilityMatch(requiredCapabilities);

    // Calculate domain score
    const domainScore = this.calculateDomainMatch(taskDomain);

    // Calculate embedding similarity
    const embeddingScore = this.calculateSimilarity(taskEmbedding);

    // Calculate skill match score
    const skillScore = this.calculateSkillMatch(task);

    // Weighted overall score
    const overallScore =
      capabilityScore * 0.3 +
      domainScore * 0.25 +
      embeddingScore * 0.25 +
      skillScore * 0.2;

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      missing,
      taskDomain,
      overallScore
    );

    return {
      score: overallScore,
      breakdown: {
        capabilityScore,
        domainScore,
        embeddingScore,
        skillScore,
      },
      meetsRequirements: capabilityScore >= 0.5 && missing.length === 0,
      missingCapabilities: missing,
      matchedCapabilities: matched,
      recommendations,
    };
  }

  /**
   * Execute a task with domain-specific processing
   *
   * @param task - Task to execute
   * @returns Agent output with results
   */
  async execute(task: Task): Promise<AgentOutput> {
    const startTime = Date.now();
    let processedTask = task;
    let artifacts: WorkerArtifact[] = [];

    try {
      // Validate task for domain compatibility
      if (this.handlers.validate) {
        const isValid = await this.handlers.validate(task, this);
        if (!isValid) {
          return {
            content: { error: 'Task validation failed for domain' },
            success: false,
            error: new Error(`Task not compatible with ${this.domain} domain`),
            duration: Date.now() - startTime,
          };
        }
      }

      // Preprocess task
      if (this.enablePreprocessing && this.handlers.preprocess) {
        processedTask = await this.handlers.preprocess(task, this);
      }

      // Execute the core task
      const output = await this.executeCore(processedTask);

      // Generate domain-specific artifacts
      if (this.handlers.generateArtifacts) {
        artifacts = await this.handlers.generateArtifacts(output, processedTask, this);
      }

      // Postprocess output
      let finalOutput = output;
      if (this.enablePostprocessing && this.handlers.postprocess) {
        finalOutput = await this.handlers.postprocess(output, processedTask, this);
      }

      // Add artifacts to output
      if (artifacts.length > 0) {
        finalOutput.artifacts = [...(finalOutput.artifacts || []), ...artifacts];
      }

      return {
        ...finalOutput,
        duration: Date.now() - startTime,
        metadata: {
          ...finalOutput.metadata,
          domain: this.domain,
          expertiseLevel: this.expertiseLevel,
          workerId: this.id,
        },
      };
    } catch (error) {
      return {
        content: { error: (error as Error).message },
        success: false,
        error: error as Error,
        duration: Date.now() - startTime,
        metadata: {
          domain: this.domain,
          workerId: this.id,
        },
      };
    }
  }

  /**
   * Core task execution logic
   *
   * Override this in subclasses for domain-specific implementations.
   *
   * @param task - Preprocessed task
   * @returns Execution output
   */
  protected async executeCore(task: Task): Promise<AgentOutput> {
    // Default implementation with domain-aware processing
    const content = await this.processTaskForDomain(task);

    return {
      content,
      success: true,
      duration: 0, // Will be set by execute()
      metadata: {
        processedBy: this.id,
        domain: this.domain,
      },
    };
  }

  /**
   * Process task with domain-specific logic
   *
   * @param task - Task to process
   * @returns Processed content
   */
  protected async processTaskForDomain(task: Task): Promise<Record<string, unknown>> {
    // Domain-specific processing logic
    const result: Record<string, unknown> = {
      taskId: task.id,
      domain: this.domain,
      processed: true,
      input: task.input,
    };

    // Add domain-specific processing
    switch (this.domain) {
      case 'frontend':
        result.components = [];
        result.styles = {};
        break;
      case 'backend':
        result.endpoints = [];
        result.services = [];
        break;
      case 'database':
        result.queries = [];
        result.migrations = [];
        break;
      case 'testing':
        result.testCases = [];
        result.coverage = 0;
        break;
      case 'security':
        result.vulnerabilities = [];
        result.recommendations = [];
        break;
      case 'architecture':
        result.diagrams = [];
        result.decisions = [];
        break;
      default:
        result.output = task.description;
    }

    return result;
  }

  /**
   * Get worker's domain expertise
   */
  getDomainExpertise(): {
    primary: DomainSpecialization;
    secondary: DomainSpecialization[];
    expertiseLevel: number;
    skills: Record<string, number>;
  } {
    return {
      primary: this.domain,
      secondary: this.secondaryDomains,
      expertiseLevel: this.expertiseLevel,
      skills: Object.fromEntries(this.skills),
    };
  }

  /**
   * Update skill proficiency
   *
   * @param skill - Skill name
   * @param level - Proficiency level (0.0-1.0)
   */
  updateSkill(skill: string, level: number): void {
    const clampedLevel = Math.max(0, Math.min(1, level));
    this.skills.set(skill, clampedLevel);

    // Regenerate embedding with updated skills
    this.specialization = this.generateDomainEmbedding();

    this.emit('skill-updated', {
      workerId: this.id,
      skill,
      level: clampedLevel,
    });
  }

  // ===== Private Methods =====

  /**
   * Generate domain-specific embedding
   */
  private generateDomainEmbedding(): Float32Array {
    const baseDimension = 64;
    const embedding = new Float32Array(baseDimension);

    // Start with domain embedding
    const domainVec = DOMAIN_EMBEDDINGS[this.domain] || DOMAIN_EMBEDDINGS.custom;
    for (let i = 0; i < domainVec.length && i < baseDimension; i++) {
      embedding[i] = domainVec[i] * this.expertiseLevel;
    }

    // Add secondary domain influence
    for (let j = 0; j < this.secondaryDomains.length; j++) {
      const secondaryVec = DOMAIN_EMBEDDINGS[this.secondaryDomains[j]];
      const weight = 0.5 / (j + 1); // Diminishing weight
      for (let i = 0; i < secondaryVec.length && i < baseDimension; i++) {
        embedding[i] += secondaryVec[i] * weight * this.expertiseLevel;
      }
    }

    // Add skill influence
    let skillIdx = 16;
    for (const [skill, level] of Array.from(this.skills.entries())) {
      if (skillIdx < baseDimension) {
        embedding[skillIdx] = level;
        skillIdx++;
      }
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < baseDimension; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /**
   * Extract required capabilities from a task
   */
  private extractRequiredCapabilities(task: Task): string[] {
    const capabilities: string[] = [];

    // From metadata
    if (task.metadata?.requiredCapabilities) {
      capabilities.push(...(task.metadata.requiredCapabilities as string[]));
    }

    // Infer from task type
    const typeCapabilities = this.inferCapabilitiesFromType(task.type);
    capabilities.push(...typeCapabilities);

    // Infer from description keywords
    const descriptionCapabilities = this.inferCapabilitiesFromDescription(task.description);
    capabilities.push(...descriptionCapabilities);

    // Deduplicate
    return Array.from(new Set(capabilities));
  }

  /**
   * Infer capabilities from task type
   */
  private inferCapabilitiesFromType(type: string): string[] {
    const typeMap: Record<string, string[]> = {
      code: ['code-generation'],
      review: ['code-review'],
      test: ['testing'],
      fix: ['debugging', 'code-generation'],
      refactor: ['refactoring', 'code-review'],
      document: ['documentation'],
      design: ['architecture'],
      security: ['security-audit'],
      performance: ['performance-analysis'],
    };

    return typeMap[type.toLowerCase()] || [];
  }

  /**
   * Infer capabilities from task description
   */
  private inferCapabilitiesFromDescription(description: string): string[] {
    const capabilities: string[] = [];
    const lowerDesc = description.toLowerCase();

    const keywordMap: Record<string, string> = {
      react: 'react',
      vue: 'vue',
      angular: 'angular',
      typescript: 'typescript',
      javascript: 'javascript',
      python: 'python',
      api: 'api-design',
      database: 'database',
      sql: 'sql',
      test: 'testing',
      security: 'security',
      performance: 'performance',
      docker: 'docker',
      kubernetes: 'kubernetes',
      aws: 'aws',
      graphql: 'graphql',
      rest: 'rest-api',
    };

    for (const [keyword, capability] of Object.entries(keywordMap)) {
      if (lowerDesc.includes(keyword)) {
        capabilities.push(capability);
      }
    }

    return capabilities;
  }

  /**
   * Infer domain from task
   */
  private inferTaskDomain(task: Task): DomainSpecialization {
    const lowerDesc = task.description.toLowerCase();
    const lowerType = task.type.toLowerCase();

    const domainKeywords: Record<DomainSpecialization, string[]> = {
      frontend: ['ui', 'component', 'react', 'vue', 'angular', 'css', 'html', 'frontend'],
      backend: ['api', 'server', 'endpoint', 'service', 'backend', 'rest', 'graphql'],
      database: ['database', 'sql', 'query', 'migration', 'schema', 'postgres', 'mysql'],
      devops: ['deploy', 'ci', 'cd', 'pipeline', 'docker', 'kubernetes', 'terraform'],
      security: ['security', 'auth', 'vulnerability', 'penetration', 'encryption'],
      performance: ['performance', 'optimize', 'benchmark', 'profiling', 'speed'],
      testing: ['test', 'spec', 'coverage', 'unit', 'integration', 'e2e'],
      documentation: ['document', 'readme', 'api-doc', 'comment', 'guide'],
      architecture: ['architecture', 'design', 'pattern', 'structure', 'diagram'],
      'machine-learning': ['ml', 'model', 'training', 'neural', 'ai', 'tensorflow', 'pytorch'],
      'data-engineering': ['etl', 'pipeline', 'data', 'warehouse', 'spark', 'kafka'],
      mobile: ['mobile', 'ios', 'android', 'react-native', 'flutter', 'app'],
      infrastructure: ['infrastructure', 'cloud', 'aws', 'gcp', 'azure', 'network'],
      'api-design': ['api', 'rest', 'graphql', 'endpoint', 'schema', 'openapi'],
      'code-review': ['review', 'pr', 'pull-request', 'feedback', 'audit'],
      custom: [],
    };

    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      for (const keyword of keywords) {
        if (lowerDesc.includes(keyword) || lowerType.includes(keyword)) {
          return domain as DomainSpecialization;
        }
      }
    }

    return 'custom';
  }

  /**
   * Generate embedding for a task
   */
  private generateTaskEmbedding(task: Task): Float32Array {
    const dimension = 64;
    const embedding = new Float32Array(dimension);

    // Get domain embedding
    const taskDomain = this.inferTaskDomain(task);
    const domainVec = DOMAIN_EMBEDDINGS[taskDomain];

    for (let i = 0; i < domainVec.length && i < dimension; i++) {
      embedding[i] = domainVec[i];
    }

    // Add task type influence
    const typeHash = this.hashStringSpecialized(task.type);
    for (let i = 16; i < 32 && i < dimension; i++) {
      embedding[i] = ((typeHash >> (i % 32)) & 1) ? 0.5 : -0.5;
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /**
   * Calculate capability match
   */
  private calculateCapabilityMatch(required: string[]): {
    matched: string[];
    missing: string[];
    score: number;
  } {
    if (required.length === 0) {
      return { matched: [], missing: [], score: 1.0 };
    }

    const matched = required.filter((cap) => this.capabilities.includes(cap));
    const missing = required.filter((cap) => !this.capabilities.includes(cap));
    const score = matched.length / required.length;

    return { matched, missing, score };
  }

  /**
   * Calculate domain match score
   */
  private calculateDomainMatch(taskDomain: DomainSpecialization): number {
    if (taskDomain === this.domain) {
      return 1.0;
    }

    if (this.secondaryDomains.includes(taskDomain)) {
      const index = this.secondaryDomains.indexOf(taskDomain);
      return 0.8 - index * 0.1; // Diminishing score for later secondary domains
    }

    // Check domain embedding similarity
    const taskEmbedding = DOMAIN_EMBEDDINGS[taskDomain];
    const workerEmbedding = DOMAIN_EMBEDDINGS[this.domain];

    let similarity = 0;
    for (let i = 0; i < taskEmbedding.length; i++) {
      similarity += taskEmbedding[i] * workerEmbedding[i];
    }

    return Math.max(0, similarity * 0.5);
  }

  /**
   * Calculate skill match score
   */
  private calculateSkillMatch(task: Task): number {
    const requiredSkills = this.extractSkillsFromTask(task);

    if (requiredSkills.length === 0) {
      return 1.0;
    }

    let totalScore = 0;
    let matchedCount = 0;

    for (const skill of requiredSkills) {
      if (this.skills.has(skill)) {
        totalScore += this.skills.get(skill)!;
        matchedCount++;
      }
    }

    if (matchedCount === 0) {
      return 0;
    }

    return totalScore / requiredSkills.length;
  }

  /**
   * Extract skills from task
   */
  private extractSkillsFromTask(task: Task): string[] {
    const skills: string[] = [];
    const lowerDesc = task.description.toLowerCase();

    // Check for language/framework mentions
    const allSkillsArray = [
      ...this.languages,
      ...this.frameworks,
      ...this.tools,
      ...Array.from(this.skills.keys()),
    ];

    for (const skill of allSkillsArray) {
      if (lowerDesc.includes(skill.toLowerCase())) {
        skills.push(skill);
      }
    }

    return Array.from(new Set(skills));
  }

  /**
   * Generate recommendations for better matching
   */
  private generateRecommendations(
    missing: string[],
    taskDomain: DomainSpecialization,
    score: number
  ): string[] {
    const recommendations: string[] = [];

    if (missing.length > 0) {
      recommendations.push(`Consider acquiring capabilities: ${missing.join(', ')}`);
    }

    if (taskDomain !== this.domain && !this.secondaryDomains.includes(taskDomain)) {
      recommendations.push(`Task domain '${taskDomain}' differs from specialization '${this.domain}'`);
    }

    if (score < 0.5) {
      recommendations.push('Low match score - consider routing to a more specialized worker');
    }

    return recommendations;
  }

  /**
   * Simple string hash function for specialized worker
   */
  protected hashStringSpecialized(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }
}

/**
 * Create a specialized worker factory
 *
 * @param domain - Primary domain specialization
 * @param config - Additional configuration
 * @returns Configured SpecializedWorker
 */
export function createSpecializedWorker(
  domain: DomainSpecialization,
  config: Partial<Omit<SpecializedWorkerConfig, 'domain'>> = {}
): SpecializedWorker {
  return new SpecializedWorker({
    id: config.id || `${domain}-worker-${Date.now()}`,
    type: 'specialized',
    domain,
    capabilities: config.capabilities || [],
    ...config,
  });
}

/**
 * Create a frontend specialized worker
 */
export function createFrontendWorker(
  config: Partial<Omit<SpecializedWorkerConfig, 'domain'>> = {}
): SpecializedWorker {
  return createSpecializedWorker('frontend', {
    capabilities: ['react', 'typescript', 'css', 'html', 'code-generation'],
    languages: ['typescript', 'javascript'],
    frameworks: ['react', 'next.js', 'vue'],
    skills: { react: 0.9, typescript: 0.85, css: 0.8, html: 0.9 },
    ...config,
  });
}

/**
 * Create a backend specialized worker
 */
export function createBackendWorker(
  config: Partial<Omit<SpecializedWorkerConfig, 'domain'>> = {}
): SpecializedWorker {
  return createSpecializedWorker('backend', {
    capabilities: ['api-design', 'database', 'typescript', 'code-generation'],
    languages: ['typescript', 'python', 'go'],
    frameworks: ['express', 'fastify', 'nest.js'],
    skills: { typescript: 0.9, 'api-design': 0.85, database: 0.8 },
    ...config,
  });
}

/**
 * Create a testing specialized worker
 */
export function createTestingWorker(
  config: Partial<Omit<SpecializedWorkerConfig, 'domain'>> = {}
): SpecializedWorker {
  return createSpecializedWorker('testing', {
    capabilities: ['testing', 'code-review', 'typescript'],
    languages: ['typescript', 'javascript'],
    frameworks: ['jest', 'vitest', 'playwright'],
    skills: { testing: 0.95, 'test-automation': 0.9, 'code-review': 0.8 },
    ...config,
  });
}
