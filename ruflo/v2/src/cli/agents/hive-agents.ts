/**
 * Hive Mind Agent Templates
 * Specialized agents for the Hive Mind swarm system
 */

import { BaseAgent } from './base-agent.js';
import type { AgentCapabilities, AgentConfig, TaskDefinition } from '../../swarm/types.js';

export interface HiveAgentConfig {
  type: 'queen' | 'worker' | 'scout' | 'guardian' | 'architect';
  specialization?: string;
  consensusWeight?: number;
  knowledgeDomains?: string[];
}

/**
 * Queen Agent - Orchestrator and decision maker
 */
export class QueenAgent extends BaseAgent {
  constructor(
    id: string,
    config: AgentConfig,
    environment: any,
    logger: any,
    eventBus: any,
    memory: any,
  ) {
    super(id, 'coordinator', config, environment, logger, eventBus, memory);
  }

  protected getDefaultCapabilities(): AgentCapabilities {
    return {
      // Core capabilities
      codeGeneration: false,
      codeReview: true,
      testing: false,
      documentation: true,
      research: true,
      analysis: true,

      // Communication capabilities
      webSearch: true,
      apiIntegration: true,
      fileSystem: true,
      terminalAccess: false,

      // Specialized capabilities
      languages: ['javascript', 'typescript'],
      frameworks: ['node.js'],
      domains: ['orchestration', 'coordination'],
      tools: ['consensus', 'delegation'],

      // Resource limits
      maxConcurrentTasks: 5,
      maxMemoryUsage: 512,
      maxExecutionTime: 300000,

      // Performance characteristics
      reliability: 0.95,
      speed: 0.8,
      quality: 0.9,
    };
  }

  protected getDefaultConfig(): Partial<AgentConfig> {
    return {
      autonomyLevel: 0.8,
      learningEnabled: true,
      adaptationEnabled: true,
      maxTasksPerHour: 20,
      maxConcurrentTasks: 5,
      timeoutThreshold: 30000,
      reportingInterval: 5000,
      heartbeatInterval: 10000,
      permissions: ['orchestrate', 'delegate', 'consensus'],
    };
  }

  public async executeTask(task: TaskDefinition): Promise<any> {
    // Queen agent execution logic
    return {
      result: 'orchestrated',
      taskId: task.id,
      timestamp: new Date().toISOString(),
    };
  }

  getSystemPrompt(): string {
    return `You are ${this.id}, a Queen agent in the Hive Mind swarm.

ROLE: Orchestrator and Decision Maker
- Coordinate all swarm activities
- Make final decisions after consensus
- Delegate tasks to appropriate agents
- Monitor overall progress and quality

RESPONSIBILITIES:
1. Task decomposition and planning
2. Agent assignment and coordination
3. Consensus facilitation
4. Quality assurance
5. Strategic decision making

CONSENSUS PROTOCOL:
- Propose major decisions for voting
- Facilitate discussion among agents
- Calculate consensus thresholds
- Make tie-breaking decisions when needed

COMMUNICATION STYLE:
- Clear and authoritative
- Balanced and fair
- Strategic thinking
- Focus on swarm objectives`;
  }

  async analyzeObjective(objective: string): Promise<any> {
    return {
      complexity: 'high',
      requiredAgents: ['architect', 'worker', 'scout', 'guardian'],
      estimatedTasks: 5,
      strategy: 'hierarchical',
      consensusRequired: true,
    };
  }
}

/**
 * Worker Agent - Implementation and execution
 */
export class WorkerAgent extends BaseAgent {
  private specialization: string;

  constructor(
    id: string,
    config: AgentConfig,
    environment: any,
    logger: any,
    eventBus: any,
    memory: any,
    specialization: string = 'general',
  ) {
    super(id, 'coder', config, environment, logger, eventBus, memory);
    this.specialization = specialization;
  }

  protected getDefaultCapabilities(): AgentCapabilities {
    return {
      // Core capabilities
      codeGeneration: true,
      codeReview: false,
      testing: true,
      documentation: false,
      research: false,
      analysis: false,

      // Communication capabilities
      webSearch: false,
      apiIntegration: true,
      fileSystem: true,
      terminalAccess: true,

      // Specialized capabilities
      languages: ['javascript', 'typescript', 'python'],
      frameworks: ['node.js', 'react', 'express'],
      domains: ['backend', 'frontend', 'fullstack'],
      tools: ['git', 'npm', 'docker'],

      // Resource limits
      maxConcurrentTasks: 3,
      maxMemoryUsage: 1024,
      maxExecutionTime: 600000,

      // Performance characteristics
      reliability: 0.9,
      speed: 0.9,
      quality: 0.85,
    };
  }

  protected getDefaultConfig(): Partial<AgentConfig> {
    return {
      autonomyLevel: 0.7,
      learningEnabled: true,
      adaptationEnabled: true,
      maxTasksPerHour: 15,
      maxConcurrentTasks: 3,
      timeoutThreshold: 60000,
      reportingInterval: 10000,
      heartbeatInterval: 15000,
      permissions: ['code', 'test', 'debug', 'build'],
    };
  }

  public async executeTask(task: TaskDefinition): Promise<any> {
    // Worker agent execution logic
    return {
      result: 'implemented',
      taskId: task.id,
      specialization: this.specialization,
      timestamp: new Date().toISOString(),
    };
  }

  getSystemPrompt(): string {
    return `You are ${this.id}, a Worker agent in the Hive Mind swarm.

ROLE: Implementation and Execution Specialist
- Execute assigned tasks efficiently
- Implement solutions based on designs
- Collaborate with other workers
- Report progress and issues

SPECIALIZATION: ${this.specialization || 'general'}

RESPONSIBILITIES:
1. Task implementation
2. Code development
3. Testing and validation
4. Bug fixing
5. Performance optimization

WORK PROTOCOL:
- Accept tasks from Queen or consensus
- Provide effort estimates
- Request help when blocked
- Share knowledge with swarm

COMMUNICATION STYLE:
- Technical and precise
- Progress-focused
- Collaborative
- Solution-oriented`;
  }

  async estimateEffort(task: any): Promise<number> {
    // Estimate based on task type and specialization match
    const baseEffort = task.complexity || 5;
    const specializationBonus = task.type === this.specialization ? 0.8 : 1.0;
    return Math.round(baseEffort * specializationBonus);
  }
}

/**
 * Scout Agent - Research and exploration
 */
export class ScoutAgent extends BaseAgent {
  constructor(
    id: string,
    config: AgentConfig,
    environment: any,
    logger: any,
    eventBus: any,
    memory: any,
  ) {
    super(id, 'researcher', config, environment, logger, eventBus, memory);
  }

  protected getDefaultCapabilities(): AgentCapabilities {
    return {
      // Core capabilities
      codeGeneration: false,
      codeReview: false,
      testing: false,
      documentation: true,
      research: true,
      analysis: true,

      // Communication capabilities
      webSearch: true,
      apiIntegration: true,
      fileSystem: false,
      terminalAccess: false,

      // Specialized capabilities
      languages: [],
      frameworks: [],
      domains: ['research', 'analysis', 'discovery'],
      tools: ['web-search', 'data-analysis'],

      // Resource limits
      maxConcurrentTasks: 4,
      maxMemoryUsage: 768,
      maxExecutionTime: 300000,

      // Performance characteristics
      reliability: 0.85,
      speed: 0.95,
      quality: 0.9,
    };
  }

  protected getDefaultConfig(): Partial<AgentConfig> {
    return {
      autonomyLevel: 0.9,
      learningEnabled: true,
      adaptationEnabled: true,
      maxTasksPerHour: 25,
      maxConcurrentTasks: 4,
      timeoutThreshold: 45000,
      reportingInterval: 8000,
      heartbeatInterval: 12000,
      permissions: ['research', 'analyze', 'web-search'],
    };
  }

  public async executeTask(task: TaskDefinition): Promise<any> {
    // Scout agent execution logic
    return {
      result: 'researched',
      taskId: task.id,
      findings: [],
      timestamp: new Date().toISOString(),
    };
  }

  getSystemPrompt(): string {
    return `You are ${this.id}, a Scout agent in the Hive Mind swarm.

ROLE: Research and Exploration Specialist
- Explore new territories and solutions
- Research best practices and patterns
- Identify potential risks and opportunities
- Gather intelligence for the swarm

RESPONSIBILITIES:
1. Information gathering
2. Technology research
3. Risk assessment
4. Opportunity identification
5. Knowledge synthesis

SCOUTING PROTOCOL:
- Proactively investigate unknowns
- Report findings to swarm
- Suggest new approaches
- Validate assumptions

COMMUNICATION STYLE:
- Curious and investigative
- Evidence-based
- Forward-thinking
- Risk-aware`;
  }

  async scout(topic: string): Promise<any> {
    return {
      findings: [`Best practices for ${topic}`, `Common pitfalls in ${topic}`],
      risks: ['Technical debt', 'Scalability concerns'],
      opportunities: ['New framework available', 'Performance optimization possible'],
      recommendations: ['Consider microservices', 'Implement caching'],
    };
  }
}

/**
 * Guardian Agent - Quality and validation
 */
export class GuardianAgent extends BaseAgent {
  constructor(
    id: string,
    config: AgentConfig,
    environment: any,
    logger: any,
    eventBus: any,
    memory: any,
  ) {
    super(id, 'reviewer', config, environment, logger, eventBus, memory);
  }

  protected getDefaultCapabilities(): AgentCapabilities {
    return {
      // Core capabilities
      codeGeneration: false,
      codeReview: true,
      testing: true,
      documentation: false,
      research: false,
      analysis: true,

      // Communication capabilities
      webSearch: false,
      apiIntegration: false,
      fileSystem: true,
      terminalAccess: false,

      // Specialized capabilities
      languages: ['javascript', 'typescript'],
      frameworks: ['jest', 'eslint'],
      domains: ['quality-assurance', 'security', 'review'],
      tools: ['linting', 'testing', 'security-scan'],

      // Resource limits
      maxConcurrentTasks: 2,
      maxMemoryUsage: 512,
      maxExecutionTime: 180000,

      // Performance characteristics
      reliability: 0.98,
      speed: 0.7,
      quality: 0.95,
    };
  }

  protected getDefaultConfig(): Partial<AgentConfig> {
    return {
      autonomyLevel: 0.6,
      learningEnabled: true,
      adaptationEnabled: false,
      maxTasksPerHour: 10,
      maxConcurrentTasks: 2,
      timeoutThreshold: 90000,
      reportingInterval: 15000,
      heartbeatInterval: 20000,
      permissions: ['review', 'test', 'validate'],
    };
  }

  public async executeTask(task: TaskDefinition): Promise<any> {
    // Guardian agent execution logic
    return {
      result: 'reviewed',
      taskId: task.id,
      quality: 'high',
      timestamp: new Date().toISOString(),
    };
  }

  getSystemPrompt(): string {
    return `You are ${this.id}, a Guardian agent in the Hive Mind swarm.

ROLE: Quality Assurance and Protection
- Ensure code quality and standards
- Identify security vulnerabilities
- Validate implementations
- Protect swarm from errors

RESPONSIBILITIES:
1. Code review
2. Security analysis
3. Quality validation
4. Standard enforcement
5. Risk mitigation

GUARDIAN PROTOCOL:
- Review all implementations
- Flag potential issues
- Suggest improvements
- Enforce best practices

COMMUNICATION STYLE:
- Protective and thorough
- Constructive criticism
- Standards-focused
- Security-minded`;
  }

  async validateWork(work: any): Promise<any> {
    return {
      qualityScore: 0.85,
      issues: ['Missing error handling', 'Incomplete tests'],
      securityConcerns: ['Input validation needed'],
      recommendations: ['Add unit tests', 'Implement logging'],
      approved: true,
    };
  }
}

/**
 * Architect Agent - System design and planning
 */
export class ArchitectAgent extends BaseAgent {
  constructor(
    id: string,
    config: AgentConfig,
    environment: any,
    logger: any,
    eventBus: any,
    memory: any,
  ) {
    super(id, 'architect', config, environment, logger, eventBus, memory);
  }

  protected getDefaultCapabilities(): AgentCapabilities {
    return {
      // Core capabilities
      codeGeneration: false,
      codeReview: true,
      testing: false,
      documentation: true,
      research: true,
      analysis: true,

      // Communication capabilities
      webSearch: true,
      apiIntegration: false,
      fileSystem: true,
      terminalAccess: false,

      // Specialized capabilities
      languages: ['javascript', 'typescript'],
      frameworks: ['architecture-patterns'],
      domains: ['system-design', 'architecture', 'planning'],
      tools: ['design-patterns', 'documentation'],

      // Resource limits
      maxConcurrentTasks: 2,
      maxMemoryUsage: 1024,
      maxExecutionTime: 240000,

      // Performance characteristics
      reliability: 0.92,
      speed: 0.75,
      quality: 0.95,
    };
  }

  protected getDefaultConfig(): Partial<AgentConfig> {
    return {
      autonomyLevel: 0.85,
      learningEnabled: true,
      adaptationEnabled: true,
      maxTasksPerHour: 8,
      maxConcurrentTasks: 2,
      timeoutThreshold: 120000,
      reportingInterval: 20000,
      heartbeatInterval: 25000,
      permissions: ['design', 'plan', 'architect'],
    };
  }

  public async executeTask(task: TaskDefinition): Promise<any> {
    // Architect agent execution logic
    return {
      result: 'designed',
      taskId: task.id,
      architecture: 'planned',
      timestamp: new Date().toISOString(),
    };
  }

  getSystemPrompt(): string {
    return `You are ${this.id}, an Architect agent in the Hive Mind swarm.

ROLE: System Design and Architecture
- Design system architecture
- Plan technical solutions
- Define interfaces and contracts
- Ensure scalability and maintainability

RESPONSIBILITIES:
1. System architecture design
2. Technical planning
3. Interface definition
4. Pattern selection
5. Documentation

ARCHITECTURE PROTOCOL:
- Design before implementation
- Consider all requirements
- Plan for scalability
- Document decisions

COMMUNICATION STYLE:
- Strategic and systematic
- Pattern-focused
- Future-oriented
- Technically detailed`;
  }

  async designSystem(requirements: any): Promise<any> {
    return {
      architecture: 'microservices',
      components: ['API Gateway', 'Auth Service', 'Business Logic', 'Database'],
      patterns: ['Repository', 'Factory', 'Observer'],
      technologies: ['Node.js', 'PostgreSQL', 'Redis', 'Docker'],
      interfaces: ['REST API', 'WebSocket', 'Message Queue'],
    };
  }
}

/**
 * Factory for creating Hive agents
 */
export class HiveAgentFactory {
  static createAgent(
    config: HiveAgentConfig & { name: string },
    agentConfig: AgentConfig,
    environment: any,
    logger: any,
    eventBus: any,
    memory: any,
  ): BaseAgent {
    switch (config.type) {
      case 'queen':
        return new QueenAgent(config.name, agentConfig, environment, logger, eventBus, memory);

      case 'worker':
        return new WorkerAgent(
          config.name,
          agentConfig,
          environment,
          logger,
          eventBus,
          memory,
          config.specialization,
        );

      case 'scout':
        return new ScoutAgent(config.name, agentConfig, environment, logger, eventBus, memory);

      case 'guardian':
        return new GuardianAgent(config.name, agentConfig, environment, logger, eventBus, memory);

      case 'architect':
        return new ArchitectAgent(config.name, agentConfig, environment, logger, eventBus, memory);

      default:
        throw new Error(`Unknown Hive agent type: ${config.type}`);
    }
  }

  /**
   * Create a balanced swarm for an objective
   */
  static createBalancedSwarm(
    objective: string,
    maxAgents: number = 8,
    agentConfig: AgentConfig,
    environment: any,
    logger: any,
    eventBus: any,
    memory: any,
  ): BaseAgent[] {
    const agents: BaseAgent[] = [];

    // Always include a Queen
    agents.push(
      new QueenAgent('Queen-Genesis', agentConfig, environment, logger, eventBus, memory),
    );

    // Determine agent composition based on objective
    const needsDesign =
      objective.toLowerCase().includes('build') || objective.toLowerCase().includes('create');
    const needsResearch =
      objective.toLowerCase().includes('research') || objective.toLowerCase().includes('analyze');

    if (needsDesign && agents.length < maxAgents) {
      agents.push(
        new ArchitectAgent('Architect-Prime', agentConfig, environment, logger, eventBus, memory),
      );
    }

    if (needsResearch && agents.length < maxAgents) {
      agents.push(
        new ScoutAgent('Scout-Alpha', agentConfig, environment, logger, eventBus, memory),
      );
    }

    // Add workers based on remaining slots
    const workerCount = Math.min(3, maxAgents - agents.length - 1); // -1 for Guardian
    for (let i = 0; i < workerCount; i++) {
      const specializations = ['backend', 'frontend', 'database', 'integration'];
      const spec = specializations[i % specializations.length];
      agents.push(
        new WorkerAgent(
          `Worker-${i + 1}`,
          agentConfig,
          environment,
          logger,
          eventBus,
          memory,
          spec,
        ),
      );
    }

    // Always include a Guardian if space
    if (agents.length < maxAgents) {
      agents.push(
        new GuardianAgent('Guardian-Omega', agentConfig, environment, logger, eventBus, memory),
      );
    }

    return agents;
  }

  /**
   * Get agent capabilities matrix
   */
  static getCapabilitiesMatrix(): Map<string, string[]> {
    return new Map([
      ['queen', ['orchestration', 'consensus', 'decision-making', 'delegation']],
      ['worker', ['implementation', 'coding', 'testing', 'debugging']],
      ['scout', ['research', 'exploration', 'analysis', 'discovery']],
      ['guardian', ['validation', 'security', 'quality', 'review']],
      ['architect', ['design', 'planning', 'architecture', 'patterns']],
    ]);
  }
}
