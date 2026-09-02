/**
 * Agent Capabilities System - Defines and manages agent skills and selection algorithms
 */

import type { AgentType, AgentCapabilities, TaskDefinition } from '../../swarm/types.js';
import type { AgentState } from './base-agent.js';

export interface CapabilityMatch {
  agent: AgentState;
  score: number;
  matchedCapabilities: string[];
  missingCapabilities: string[];
  confidence: number;
  reason: string;
}

export interface TaskRequirements {
  type: string;
  requiredCapabilities: string[];
  preferredCapabilities: string[];
  languages?: string[];
  frameworks?: string[];
  domains?: string[];
  tools?: string[];
  complexity: 'low' | 'medium' | 'high' | 'critical';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  estimatedDuration: number; // minutes
  dependencies: string[];
}

export interface CapabilityRegistry {
  [capability: string]: {
    description: string;
    category: 'technical' | 'domain' | 'soft' | 'system';
    prerequisites: string[];
    relatedCapabilities: string[];
    complexity: number; // 1-10
    importance: number; // 1-10
  };
}

/**
 * Agent Capability System
 */
export class AgentCapabilitySystem {
  private capabilityRegistry: CapabilityRegistry;
  private agentCapabilities: Map<string, AgentCapabilities>;
  private taskTypeRequirements: Map<string, TaskRequirements>;

  constructor() {
    this.capabilityRegistry = this.initializeCapabilityRegistry();
    this.agentCapabilities = new Map();
    this.taskTypeRequirements = this.initializeTaskRequirements();
  }

  /**
   * Get agent capabilities by agent ID
   */
  getAgentCapabilities(agentId: string): AgentCapabilities | undefined {
    return this.agentCapabilities.get(agentId);
  }

  /**
   * Register agent capabilities
   */
  registerAgentCapabilities(agentId: string, capabilities: AgentCapabilities): void {
    this.agentCapabilities.set(agentId, capabilities);
  }

  /**
   * Find best matching agents for a task
   */
  findBestAgents(
    task: TaskDefinition,
    availableAgents: AgentState[],
    maxResults: number = 5,
  ): CapabilityMatch[] {
    const requirements = this.getTaskRequirements(task);
    const matches: CapabilityMatch[] = [];

    for (const agent of availableAgents) {
      const match = this.evaluateAgentMatch(agent, requirements);
      if (match.score > 0) {
        matches.push(match);
      }
    }

    // Sort by score (highest first) and return top results
    return matches.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  /**
   * Get capability requirements for a task type
   */
  getTaskRequirements(task: TaskDefinition): TaskRequirements {
    const baseRequirements = this.taskTypeRequirements.get(task.type);

    if (!baseRequirements) {
      // Infer requirements from task parameters
      return this.inferTaskRequirements(task);
    }

    // Merge with task-specific parameters
    return {
      ...baseRequirements,
      languages: task.parameters?.languages || baseRequirements.languages,
      frameworks: task.parameters?.frameworks || baseRequirements.frameworks,
      complexity: task.parameters?.complexity || baseRequirements.complexity,
      urgency: task.parameters?.urgency || baseRequirements.urgency,
      estimatedDuration: task.parameters?.estimatedDuration || baseRequirements.estimatedDuration,
    };
  }

  /**
   * Evaluate how well an agent matches task requirements
   */
  private evaluateAgentMatch(agent: AgentState, requirements: TaskRequirements): CapabilityMatch {
    const capabilities = agent.capabilities;
    let score = 0;
    let maxScore = 0;
    const matchedCapabilities: string[] = [];
    const missingCapabilities: string[] = [];

    // Evaluate required capabilities
    for (const required of requirements.requiredCapabilities) {
      maxScore += 20; // Each required capability is worth 20 points

      if (this.agentHasCapability(capabilities, required)) {
        score += 20;
        matchedCapabilities.push(required);
      } else {
        missingCapabilities.push(required);
        score -= 5; // Penalty for missing required capability
      }
    }

    // Evaluate preferred capabilities
    for (const preferred of requirements.preferredCapabilities) {
      maxScore += 10; // Each preferred capability is worth 10 points

      if (this.agentHasCapability(capabilities, preferred)) {
        score += 10;
        matchedCapabilities.push(preferred);
      }
    }

    // Evaluate language compatibility
    if (requirements.languages) {
      maxScore += 15;
      const languageMatch = requirements.languages.some((lang) =>
        capabilities.languages.includes(lang),
      );
      if (languageMatch) {
        score += 15;
      }
    }

    // Evaluate framework compatibility
    if (requirements.frameworks) {
      maxScore += 15;
      const frameworkMatch = requirements.frameworks.some((framework) =>
        capabilities.frameworks.includes(framework),
      );
      if (frameworkMatch) {
        score += 15;
      }
    }

    // Evaluate domain expertise
    if (requirements.domains) {
      maxScore += 10;
      const domainMatch = requirements.domains.some((domain) =>
        capabilities.domains.includes(domain),
      );
      if (domainMatch) {
        score += 10;
      }
    }

    // Agent health and availability bonus
    maxScore += 20;
    score += agent.health * 10; // Health contributes up to 10 points
    score += (1 - agent.workload) * 10; // Low workload contributes up to 10 points

    // Agent reliability bonus
    maxScore += 10;
    score += capabilities.reliability * 10;

    // Complexity matching
    const complexityScore = this.evaluateComplexityMatch(capabilities, requirements.complexity);
    maxScore += 10;
    score += complexityScore;

    // Calculate final score as percentage
    const finalScore = maxScore > 0 ? (score / maxScore) * 100 : 0;
    const confidence = this.calculateConfidence(
      matchedCapabilities,
      missingCapabilities,
      requirements,
    );
    const reason = this.generateMatchReason(matchedCapabilities, missingCapabilities, finalScore);

    return {
      agent,
      score: Math.max(0, Math.min(100, finalScore)),
      matchedCapabilities,
      missingCapabilities,
      confidence,
      reason,
    };
  }

  /**
   * Check if agent has a specific capability
   */
  private agentHasCapability(capabilities: AgentCapabilities, capability: string): boolean {
    // Check direct capabilities
    const capabilityFields = [
      'codeGeneration',
      'codeReview',
      'testing',
      'documentation',
      'research',
      'analysis',
      'webSearch',
      'apiIntegration',
      'fileSystem',
      'terminalAccess',
    ] as const;

    for (const field of capabilityFields) {
      if (capability === field && capabilities[field]) {
        return true;
      }
    }

    // Check arrays
    const arrayFields = ['languages', 'frameworks', 'domains', 'tools'] as const;
    for (const field of arrayFields) {
      if (capabilities[field].includes(capability)) {
        return true;
      }
    }

    // Check for semantic matches
    return this.checkSemanticCapabilityMatch(capabilities, capability);
  }

  /**
   * Check for semantic capability matches
   */
  private checkSemanticCapabilityMatch(
    capabilities: AgentCapabilities,
    capability: string,
  ): boolean {
    const semanticMappings: Record<string, string[]> = {
      'web-development': ['react', 'vue', 'angular', 'javascript', 'typescript', 'html', 'css'],
      'backend-development': ['node', 'express', 'fastify', 'python', 'django', 'flask'],
      database: ['sql', 'postgresql', 'mysql', 'mongodb', 'redis'],
      cloud: ['aws', 'azure', 'gcp', 'docker', 'kubernetes'],
      testing: ['jest', 'mocha', 'cypress', 'playwright', 'selenium'],
      'data-science': ['python', 'r', 'pandas', 'numpy', 'sklearn'],
      mobile: ['react-native', 'flutter', 'swift', 'kotlin', 'ionic'],
    };

    for (const [concept, related] of Object.entries(semanticMappings)) {
      if (capability.includes(concept)) {
        return related.some(
          (item) =>
            capabilities.languages.includes(item) ||
            capabilities.frameworks.includes(item) ||
            capabilities.tools.includes(item),
        );
      }
    }

    return false;
  }

  /**
   * Evaluate complexity matching
   */
  private evaluateComplexityMatch(capabilities: AgentCapabilities, complexity: string): number {
    const complexityScores = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };

    const agentComplexity = this.calculateAgentComplexityLevel(capabilities);
    const taskComplexity = complexityScores[complexity as keyof typeof complexityScores] || 2;

    // Perfect match gets full points, close matches get partial points
    const diff = Math.abs(agentComplexity - taskComplexity);
    if (diff === 0) return 10;
    if (diff === 1) return 7;
    if (diff === 2) return 4;
    return 1;
  }

  /**
   * Calculate agent's complexity handling level
   */
  private calculateAgentComplexityLevel(capabilities: AgentCapabilities): number {
    let level = 1;

    // Advanced capabilities increase complexity level
    if (capabilities.codeGeneration) level += 0.5;
    if (capabilities.analysis) level += 0.5;
    if (capabilities.terminalAccess) level += 0.5;

    // Multiple languages/frameworks indicate higher complexity handling
    if (capabilities.languages.length > 3) level += 0.5;
    if (capabilities.frameworks.length > 3) level += 0.5;
    if (capabilities.domains.length > 5) level += 0.5;

    // Reliability indicates ability to handle complex tasks
    level += capabilities.reliability;

    return Math.min(4, Math.max(1, Math.round(level)));
  }

  /**
   * Calculate confidence in the match
   */
  private calculateConfidence(
    matched: string[],
    missing: string[],
    requirements: TaskRequirements,
  ): number {
    const totalRequired = requirements.requiredCapabilities.length;
    if (totalRequired === 0) return 0.8; // Default confidence

    const matchRate = matched.length / (matched.length + missing.length);
    const criticalMissing = missing.filter((cap) =>
      requirements.requiredCapabilities.includes(cap),
    ).length;

    let confidence = matchRate;

    // Reduce confidence for missing critical capabilities
    if (criticalMissing > 0) {
      confidence *= 1 - (criticalMissing / totalRequired) * 0.5;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Generate human-readable match reason
   */
  private generateMatchReason(matched: string[], missing: string[], score: number): string {
    if (score >= 90) {
      return `Excellent match with ${matched.length} matching capabilities`;
    } else if (score >= 75) {
      return `Good match, minor gaps in ${missing.slice(0, 2).join(', ')}`;
    } else if (score >= 50) {
      return `Partial match, missing key capabilities: ${missing.slice(0, 3).join(', ')}`;
    } else {
      return `Poor match, significant capability gaps`;
    }
  }

  /**
   * Infer task requirements from task description and parameters
   */
  private inferTaskRequirements(task: TaskDefinition): TaskRequirements {
    const description = task.description.toLowerCase();
    const requiredCapabilities: string[] = [];
    const preferredCapabilities: string[] = [];
    const languages: string[] = [];
    const frameworks: string[] = [];
    const domains: string[] = [];

    // Analyze description for keywords
    if (description.includes('code') || description.includes('develop')) {
      requiredCapabilities.push('codeGeneration');
      domains.push('development');
    }

    if (description.includes('test')) {
      requiredCapabilities.push('testing');
      domains.push('testing');
    }

    if (description.includes('analyze') || description.includes('analysis')) {
      requiredCapabilities.push('analysis');
      domains.push('analysis');
    }

    if (description.includes('research')) {
      requiredCapabilities.push('research');
      domains.push('research');
    }

    // Check for language mentions
    const commonLanguages = ['javascript', 'typescript', 'python', 'java', 'go', 'rust'];
    for (const lang of commonLanguages) {
      if (description.includes(lang)) {
        languages.push(lang);
      }
    }

    return {
      type: task.type,
      requiredCapabilities,
      preferredCapabilities,
      languages,
      frameworks,
      domains,
      tools: [],
      complexity: 'medium',
      urgency: 'medium',
      estimatedDuration: 30, // Default 30 minutes
      dependencies: [],
    };
  }

  /**
   * Initialize capability registry
   */
  private initializeCapabilityRegistry(): CapabilityRegistry {
    return {
      codeGeneration: {
        description: 'Ability to generate code in various programming languages',
        category: 'technical',
        prerequisites: [],
        relatedCapabilities: ['codeReview', 'testing'],
        complexity: 8,
        importance: 9,
      },
      codeReview: {
        description: 'Ability to review and analyze code for quality and security',
        category: 'technical',
        prerequisites: ['codeGeneration'],
        relatedCapabilities: ['testing', 'security'],
        complexity: 7,
        importance: 8,
      },
      testing: {
        description: 'Ability to create and execute various types of tests',
        category: 'technical',
        prerequisites: [],
        relatedCapabilities: ['codeGeneration', 'analysis'],
        complexity: 6,
        importance: 9,
      },
      documentation: {
        description: 'Ability to create comprehensive documentation',
        category: 'technical',
        prerequisites: [],
        relatedCapabilities: ['research', 'analysis'],
        complexity: 4,
        importance: 7,
      },
      research: {
        description: 'Ability to gather and analyze information from various sources',
        category: 'domain',
        prerequisites: [],
        relatedCapabilities: ['analysis', 'webSearch'],
        complexity: 5,
        importance: 8,
      },
      analysis: {
        description: 'Ability to analyze data, patterns, and systems',
        category: 'technical',
        prerequisites: [],
        relatedCapabilities: ['research', 'documentation'],
        complexity: 7,
        importance: 8,
      },
      webSearch: {
        description: 'Ability to search and retrieve information from the web',
        category: 'system',
        prerequisites: [],
        relatedCapabilities: ['research'],
        complexity: 3,
        importance: 6,
      },
      apiIntegration: {
        description: 'Ability to integrate with external APIs and services',
        category: 'technical',
        prerequisites: [],
        relatedCapabilities: ['codeGeneration', 'testing'],
        complexity: 6,
        importance: 7,
      },
      fileSystem: {
        description: 'Ability to read, write, and manipulate files',
        category: 'system',
        prerequisites: [],
        relatedCapabilities: [],
        complexity: 3,
        importance: 6,
      },
      terminalAccess: {
        description: 'Ability to execute commands in terminal/shell',
        category: 'system',
        prerequisites: [],
        relatedCapabilities: ['fileSystem'],
        complexity: 5,
        importance: 6,
      },
    };
  }

  /**
   * Initialize task type requirements
   */
  private initializeTaskRequirements(): Map<string, TaskRequirements> {
    const requirements = new Map<string, TaskRequirements>();

    requirements.set('code-generation', {
      type: 'code-generation',
      requiredCapabilities: ['codeGeneration'],
      preferredCapabilities: ['codeReview', 'testing'],
      complexity: 'medium',
      urgency: 'medium',
      estimatedDuration: 30,
      dependencies: [],
    });

    requirements.set('testing', {
      type: 'testing',
      requiredCapabilities: ['testing'],
      preferredCapabilities: ['codeGeneration', 'codeReview'],
      complexity: 'medium',
      urgency: 'medium',
      estimatedDuration: 25,
      dependencies: [],
    });

    requirements.set('research', {
      type: 'research',
      requiredCapabilities: ['research'],
      preferredCapabilities: ['webSearch', 'analysis', 'documentation'],
      complexity: 'low',
      urgency: 'low',
      estimatedDuration: 20,
      dependencies: [],
    });

    requirements.set('analysis', {
      type: 'analysis',
      requiredCapabilities: ['analysis'],
      preferredCapabilities: ['research', 'documentation'],
      complexity: 'medium',
      urgency: 'medium',
      estimatedDuration: 35,
      dependencies: [],
    });

    requirements.set('system-design', {
      type: 'system-design',
      requiredCapabilities: ['analysis', 'documentation'],
      preferredCapabilities: ['research', 'codeReview'],
      complexity: 'high',
      urgency: 'low',
      estimatedDuration: 60,
      dependencies: [],
    });

    return requirements;
  }

  /**
   * Get agent type capabilities
   */
  static getAgentTypeCapabilities(agentType: AgentType): AgentCapabilities {
    const baseCapabilities: AgentCapabilities = {
      codeGeneration: false,
      codeReview: false,
      testing: false,
      documentation: false,
      research: false,
      analysis: false,
      webSearch: false,
      apiIntegration: false,
      fileSystem: false,
      terminalAccess: false,
      languages: [],
      frameworks: [],
      domains: [],
      tools: [],
      maxConcurrentTasks: 3,
      maxMemoryUsage: 512 * 1024 * 1024,
      maxExecutionTime: 300000,
      reliability: 0.8,
      speed: 0.8,
      quality: 0.8,
    };

    switch (agentType) {
      case 'researcher':
        return {
          ...baseCapabilities,
          research: true,
          analysis: true,
          webSearch: true,
          documentation: true,
          domains: ['research', 'analysis', 'information-gathering'],
          tools: ['web-search', 'document-analyzer', 'data-extractor'],
        };

      case 'coder':
        return {
          ...baseCapabilities,
          codeGeneration: true,
          codeReview: true,
          testing: true,
          terminalAccess: true,
          fileSystem: true,
          languages: ['typescript', 'javascript', 'python'],
          frameworks: ['deno', 'node', 'react'],
          domains: ['web-development', 'backend-development'],
          tools: ['git', 'editor', 'debugger', 'linter'],
        };

      case 'analyst':
        return {
          ...baseCapabilities,
          analysis: true,
          research: true,
          documentation: true,
          languages: ['python', 'r', 'sql'],
          frameworks: ['pandas', 'numpy', 'matplotlib'],
          domains: ['data-analysis', 'statistics', 'visualization'],
          tools: ['data-processor', 'chart-generator', 'statistical-analyzer'],
        };

      case 'architect':
        return {
          ...baseCapabilities,
          analysis: true,
          research: true,
          documentation: true,
          codeReview: true,
          domains: ['system-architecture', 'software-architecture', 'cloud-architecture'],
          tools: ['architecture-diagrams', 'system-modeler', 'design-patterns'],
        };

      case 'tester':
        return {
          ...baseCapabilities,
          testing: true,
          codeGeneration: true,
          codeReview: true,
          terminalAccess: true,
          frameworks: ['jest', 'cypress', 'playwright'],
          domains: ['testing', 'quality-assurance', 'automation'],
          tools: ['test-runner', 'coverage-analyzer', 'browser-automation'],
        };

      case 'coordinator':
        return {
          ...baseCapabilities,
          analysis: true,
          documentation: true,
          research: true,
          domains: ['project-management', 'coordination', 'planning'],
          tools: ['task-manager', 'workflow-orchestrator', 'communication-hub'],
        };

      default:
        return baseCapabilities;
    }
  }
}
