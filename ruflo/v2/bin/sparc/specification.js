// SPARC Specification Phase
// Gather requirements, define acceptance criteria, and establish project scope

import { SparcPhase } from './phase-base.js';

export class SparcSpecification extends SparcPhase {
  constructor(taskDescription, options) {
    super('specification', taskDescription, options);
    this.requirements = [];
    this.acceptanceCriteria = [];
    this.userStories = [];
    this.constraints = [];
    this.assumptions = [];
  }

  /**
   * Execute specification phase
   */
  async execute() {
    console.log('📋 Starting Specification Phase');

    await this.initializePhase();

    const result = {
      requirements: [],
      acceptanceCriteria: [],
      userStories: [],
      constraints: [],
      assumptions: [],
      stakeholders: [],
      businessValue: '',
      scope: {
        included: [],
        excluded: [],
      },
      timeline: {
        estimated: '',
        phases: [],
      },
      risks: [],
      dependencies: [],
    };

    try {
      // Analyze task description
      const analysis = await this.analyzeTaskDescription();
      result.analysis = analysis;

      // Extract requirements
      result.requirements = await this.extractRequirements(analysis);

      // Define acceptance criteria
      result.acceptanceCriteria = await this.defineAcceptanceCriteria(result.requirements);

      // Create user stories
      result.userStories = await this.createUserStories(result.requirements);

      // Identify constraints
      result.constraints = await this.identifyConstraints();

      // Document assumptions
      result.assumptions = await this.documentAssumptions();

      // Identify stakeholders
      result.stakeholders = await this.identifyStakeholders();

      // Define business value
      result.businessValue = await this.defineBusiness();

      // Define scope
      result.scope = await this.defineScope(result.requirements);

      // Estimate timeline
      result.timeline = await this.estimateTimeline(result.requirements);

      // Identify risks
      result.risks = await this.identifyRisks(result.requirements);

      // Identify dependencies
      result.dependencies = await this.identifyDependencies(result.requirements);

      // Generate specification document
      await this.generateSpecificationDocument(result);

      // Store in memory
      await this.storeInMemory('specification_complete', result);

      console.log('✅ Specification phase completed');
      return result;
    } catch (error) {
      console.error('❌ Specification phase failed:', error.message);
      throw error;
    }
  }

  /**
   * Analyze task description to extract key information
   */
  async analyzeTaskDescription() {
    const analysis = {
      type: this.categorizeTask(),
      complexity: this.assessComplexity(),
      domain: this.identifyDomain(),
      keywords: this.extractKeywords(),
      verbs: this.extractActionVerbs(),
      entities: this.extractEntities(),
    };

    return analysis;
  }

  /**
   * Categorize the task type
   */
  categorizeTask() {
    const taskLower = this.taskDescription.toLowerCase();

    if (
      taskLower.includes('api') ||
      taskLower.includes('endpoint') ||
      taskLower.includes('service')
    ) {
      return 'api_development';
    } else if (
      taskLower.includes('ui') ||
      taskLower.includes('frontend') ||
      taskLower.includes('interface')
    ) {
      return 'frontend_development';
    } else if (
      taskLower.includes('database') ||
      taskLower.includes('data') ||
      taskLower.includes('storage')
    ) {
      return 'data_management';
    } else if (taskLower.includes('test') || taskLower.includes('testing')) {
      return 'testing';
    } else if (taskLower.includes('deploy') || taskLower.includes('infrastructure')) {
      return 'deployment';
    } else if (taskLower.includes('refactor') || taskLower.includes('optimize')) {
      return 'refactoring';
    } else {
      return 'general_development';
    }
  }

  /**
   * Assess task complexity
   */
  assessComplexity() {
    const wordCount = this.taskDescription.split(' ').length;
    const complexityKeywords = [
      'integrate',
      'complex',
      'multiple',
      'advanced',
      'enterprise',
      'scalable',
    ];
    const hasComplexityKeywords = complexityKeywords.some((keyword) =>
      this.taskDescription.toLowerCase().includes(keyword),
    );

    if (wordCount > 20 || hasComplexityKeywords) {
      return 'high';
    } else if (wordCount > 10) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Identify domain
   */
  identifyDomain() {
    const domains = {
      web: ['web', 'website', 'html', 'css', 'javascript'],
      mobile: ['mobile', 'app', 'android', 'ios'],
      data: ['data', 'analytics', 'ml', 'ai', 'machine learning'],
      security: ['security', 'auth', 'authentication', 'encryption'],
      devops: ['deploy', 'ci/cd', 'docker', 'kubernetes'],
      backend: ['api', 'server', 'database', 'backend'],
      frontend: ['ui', 'ux', 'frontend', 'interface'],
    };

    const taskLower = this.taskDescription.toLowerCase();

    for (const [domain, keywords] of Object.entries(domains)) {
      if (keywords.some((keyword) => taskLower.includes(keyword))) {
        return domain;
      }
    }

    return 'general';
  }

  /**
   * Extract keywords from task description
   */
  extractKeywords() {
    const words = this.taskDescription.toLowerCase().split(/\s+/);
    const stopWords = [
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
    ];

    return words
      .filter((word) => word.length > 2 && !stopWords.includes(word))
      .filter((word, index, arr) => arr.indexOf(word) === index) // Remove duplicates
      .slice(0, 10); // Top 10 keywords
  }

  /**
   * Extract action verbs
   */
  extractActionVerbs() {
    const verbs = [
      'create',
      'build',
      'develop',
      'implement',
      'design',
      'setup',
      'configure',
      'deploy',
      'test',
      'optimize',
      'refactor',
      'integrate',
    ];
    const taskLower = this.taskDescription.toLowerCase();

    return verbs.filter((verb) => taskLower.includes(verb));
  }

  /**
   * Extract entities
   */
  extractEntities() {
    const entities = [];
    const words = this.taskDescription.split(/\s+/);

    // Look for capitalized words (potential entities)
    for (const word of words) {
      if (
        word.length > 2 &&
        word[0] === word[0].toUpperCase() &&
        word.slice(1) === word.slice(1).toLowerCase()
      ) {
        entities.push(word);
      }
    }

    return entities;
  }

  /**
   * Extract requirements from analysis
   */
  async extractRequirements(analysis) {
    const requirements = [];

    // Functional requirements based on task type
    switch (analysis.type) {
      case 'api_development':
        requirements.push(
          'System must provide REST API endpoints',
          'API must handle authentication and authorization',
          'API must return appropriate HTTP status codes',
          'API must validate input data',
          'API must handle errors gracefully',
        );
        break;

      case 'frontend_development':
        requirements.push(
          'Interface must be responsive and mobile-friendly',
          'User interface must be intuitive and accessible',
          'Application must handle user input validation',
          'Interface must provide feedback for user actions',
          'Application must be cross-browser compatible',
        );
        break;

      case 'data_management':
        requirements.push(
          'System must ensure data integrity',
          'Data must be properly normalized',
          'System must handle concurrent access',
          'Data must be backed up regularly',
          'System must provide data recovery mechanisms',
        );
        break;

      case 'testing':
        requirements.push(
          'Test suite must achieve minimum 80% code coverage',
          'Tests must be automated and repeatable',
          'Tests must validate all critical paths',
          'Test data must be properly managed',
          'Tests must run efficiently',
        );
        break;

      default:
        requirements.push(
          'System must be reliable and performant',
          'Code must be maintainable and well-documented',
          'System must handle edge cases gracefully',
          'Implementation must follow best practices',
          'System must be secure and robust',
        );
    }

    // Add complexity-specific requirements
    if (analysis.complexity === 'high') {
      requirements.push(
        'System must be scalable and handle high load',
        'Architecture must be modular and extensible',
        'System must have comprehensive monitoring',
        'Implementation must include performance optimization',
      );
    }

    return requirements;
  }

  /**
   * Define acceptance criteria
   */
  async defineAcceptanceCriteria(requirements) {
    const criteria = [];

    for (const requirement of requirements) {
      const criterion = {
        requirement: requirement,
        given: this.generateGivenCondition(requirement),
        when: this.generateWhenCondition(requirement),
        then: this.generateThenCondition(requirement),
        priority: this.assessRequirementPriority(requirement),
        testable: true,
      };

      criteria.push(criterion);
    }

    return criteria;
  }

  /**
   * Generate Given condition for acceptance criteria
   */
  generateGivenCondition(requirement) {
    if (requirement.includes('API')) {
      return 'Given a valid API client';
    } else if (requirement.includes('user')) {
      return 'Given a valid user session';
    } else if (requirement.includes('data')) {
      return 'Given valid input data';
    } else {
      return 'Given a properly configured system';
    }
  }

  /**
   * Generate When condition for acceptance criteria
   */
  generateWhenCondition(requirement) {
    if (requirement.includes('provide')) {
      return 'When the service is requested';
    } else if (requirement.includes('handle')) {
      return 'When the condition occurs';
    } else if (requirement.includes('ensure')) {
      return 'When the system operates';
    } else {
      return 'When the feature is used';
    }
  }

  /**
   * Generate Then condition for acceptance criteria
   */
  generateThenCondition(requirement) {
    if (requirement.includes('must')) {
      return 'Then the requirement must be satisfied';
    } else {
      return 'Then the expected behavior occurs';
    }
  }

  /**
   * Assess requirement priority
   */
  assessRequirementPriority(requirement) {
    const highPriorityKeywords = [
      'must',
      'critical',
      'security',
      'authentication',
      'data integrity',
    ];
    const mediumPriorityKeywords = ['should', 'performance', 'optimization', 'monitoring'];

    const reqLower = requirement.toLowerCase();

    if (highPriorityKeywords.some((keyword) => reqLower.includes(keyword))) {
      return 'high';
    } else if (mediumPriorityKeywords.some((keyword) => reqLower.includes(keyword))) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Create user stories
   */
  async createUserStories(requirements) {
    const stories = [];

    for (const requirement of requirements) {
      const story = {
        title: this.generateStoryTitle(requirement),
        narrative: this.generateStoryNarrative(requirement),
        acceptanceCriteria: this.generateStoryAcceptanceCriteria(requirement),
        priority: this.assessRequirementPriority(requirement),
        estimation: this.estimateStoryPoints(requirement),
      };

      stories.push(story);
    }

    return stories;
  }

  /**
   * Generate story title
   */
  generateStoryTitle(requirement) {
    const words = requirement.split(' ');
    const actionWord = words.find((word) =>
      ['provide', 'handle', 'ensure', 'validate'].includes(word.toLowerCase()),
    );
    const objectWord = words.find((word) => ['API', 'data', 'user', 'system'].includes(word));

    return `${actionWord || 'Implement'} ${objectWord || 'functionality'}`;
  }

  /**
   * Generate story narrative
   */
  generateStoryNarrative(requirement) {
    return `As a user, I want the system to ${requirement.toLowerCase()} so that I can achieve my goals effectively.`;
  }

  /**
   * Generate story acceptance criteria
   */
  generateStoryAcceptanceCriteria(requirement) {
    return [`The system ${requirement.toLowerCase()}`];
  }

  /**
   * Estimate story points
   */
  estimateStoryPoints(requirement) {
    const complexity = this.assessComplexity();
    const priority = this.assessRequirementPriority(requirement);

    if (complexity === 'high' && priority === 'high') {
      return 8;
    } else if (complexity === 'high' || priority === 'high') {
      return 5;
    } else if (complexity === 'medium' || priority === 'medium') {
      return 3;
    } else {
      return 1;
    }
  }

  /**
   * Identify constraints
   */
  async identifyConstraints() {
    return [
      'Files must be under 500 lines',
      'No hardcoded environment variables',
      'Must follow security best practices',
      'Must be compatible with existing systems',
      'Must maintain backward compatibility',
      'Must handle concurrent users',
      'Must have proper error handling',
      'Must include comprehensive logging',
    ];
  }

  /**
   * Document assumptions
   */
  async documentAssumptions() {
    return [
      'Development environment is properly configured',
      'Required dependencies are available',
      'Database schema is stable',
      'Network connectivity is reliable',
      'Third-party APIs are stable',
      'Security protocols are established',
      'Backup procedures are in place',
      'Monitoring systems are operational',
    ];
  }

  /**
   * Identify stakeholders
   */
  async identifyStakeholders() {
    return [
      { role: 'Product Owner', responsibility: 'Requirements definition' },
      { role: 'Development Team', responsibility: 'Implementation' },
      { role: 'QA Team', responsibility: 'Testing and validation' },
      { role: 'DevOps Team', responsibility: 'Deployment and operations' },
      { role: 'Security Team', responsibility: 'Security review' },
      { role: 'End Users', responsibility: 'Feedback and acceptance' },
    ];
  }

  /**
   * Define business value
   */
  async defineBusiness() {
    const analysis = await this.analyzeTaskDescription();

    switch (analysis.type) {
      case 'api_development':
        return 'Enables system integration and data exchange, improving operational efficiency';
      case 'frontend_development':
        return 'Improves user experience and engagement, potentially increasing user satisfaction';
      case 'data_management':
        return 'Ensures data integrity and availability, supporting business decisions';
      case 'testing':
        return 'Reduces bugs and improves software quality, minimizing support costs';
      default:
        return 'Addresses business requirements and improves system capabilities';
    }
  }

  /**
   * Define scope
   */
  async defineScope(requirements) {
    const included = requirements.slice(0, Math.ceil(requirements.length * 0.8));
    const excluded = [
      'Performance optimization beyond basic requirements',
      'Advanced security features not specified',
      'Integration with non-specified external systems',
      'Custom UI themes and branding',
      'Advanced analytics and reporting',
      'Mobile-specific optimizations',
      'Legacy system migration',
      'Third-party plugin development',
    ];

    return { included, excluded };
  }

  /**
   * Estimate timeline
   */
  async estimateTimeline(requirements) {
    const totalStoryPoints = requirements.length * 3; // Average 3 points per requirement
    const developmentVelocity = 10; // Points per sprint
    const sprintsNeeded = Math.ceil(totalStoryPoints / developmentVelocity);

    return {
      estimated: `${sprintsNeeded * 2} weeks`,
      phases: [
        { name: 'Specification', duration: '1 week' },
        { name: 'Architecture', duration: '1 week' },
        { name: 'Development', duration: `${sprintsNeeded} weeks` },
        { name: 'Testing', duration: '1 week' },
        { name: 'Deployment', duration: '1 week' },
      ],
    };
  }

  /**
   * Identify risks
   */
  async identifyRisks(requirements) {
    return [
      {
        risk: 'Technical complexity higher than estimated',
        probability: 'Medium',
        impact: 'High',
        mitigation: 'Conduct proof of concept before full implementation',
      },
      {
        risk: 'Requirements change during development',
        probability: 'High',
        impact: 'Medium',
        mitigation: 'Implement agile development with regular reviews',
      },
      {
        risk: 'Integration issues with external systems',
        probability: 'Medium',
        impact: 'High',
        mitigation: 'Early integration testing and API validation',
      },
      {
        risk: 'Performance issues under load',
        probability: 'Low',
        impact: 'High',
        mitigation: 'Load testing and performance monitoring',
      },
    ];
  }

  /**
   * Identify dependencies
   */
  async identifyDependencies(requirements) {
    const dependencies = [];

    for (const requirement of requirements) {
      if (requirement.includes('API')) {
        dependencies.push('Database schema definition');
        dependencies.push('Authentication service');
      }
      if (requirement.includes('data')) {
        dependencies.push('Data model design');
        dependencies.push('Database setup');
      }
      if (requirement.includes('security')) {
        dependencies.push('Security policy definition');
        dependencies.push('Certificate management');
      }
    }

    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Generate specification document
   */
  async generateSpecificationDocument(result) {
    const document = `# ${this.taskDescription} - Specification

## Overview
${result.businessValue}

## Requirements
${result.requirements.map((req, index) => `${index + 1}. ${req}`).join('\n')}

## Acceptance Criteria
${result.acceptanceCriteria
  .map(
    (criteria, index) => `
### ${index + 1}. ${criteria.requirement}
- **Given**: ${criteria.given}
- **When**: ${criteria.when}
- **Then**: ${criteria.then}
- **Priority**: ${criteria.priority}
`,
  )
  .join('\n')}

## User Stories
${result.userStories
  .map(
    (story, index) => `
### ${index + 1}. ${story.title}
${story.narrative}
**Acceptance Criteria**: ${story.acceptanceCriteria.join(', ')}
**Priority**: ${story.priority}
**Estimation**: ${story.estimation} points
`,
  )
  .join('\n')}

## Constraints
${result.constraints.map((constraint, index) => `${index + 1}. ${constraint}`).join('\n')}

## Assumptions
${result.assumptions.map((assumption, index) => `${index + 1}. ${assumption}`).join('\n')}

## Scope
### Included
${result.scope.included.map((item, index) => `${index + 1}. ${item}`).join('\n')}

### Excluded
${result.scope.excluded.map((item, index) => `${index + 1}. ${item}`).join('\n')}

## Timeline
**Estimated Duration**: ${result.timeline.estimated}

${result.timeline.phases.map((phase) => `- ${phase.name}: ${phase.duration}`).join('\n')}

## Risks
${result.risks
  .map(
    (risk, index) => `
### ${index + 1}. ${risk.risk}
- **Probability**: ${risk.probability}
- **Impact**: ${risk.impact}
- **Mitigation**: ${risk.mitigation}
`,
  )
  .join('\n')}

## Dependencies
${result.dependencies.map((dep, index) => `${index + 1}. ${dep}`).join('\n')}

## Stakeholders
${result.stakeholders.map((stakeholder) => `- **${stakeholder.role}**: ${stakeholder.responsibility}`).join('\n')}
`;

    // Save document
    await this.saveArtifact('specification.md', document);
    return document;
  }
}

export default SparcSpecification;
