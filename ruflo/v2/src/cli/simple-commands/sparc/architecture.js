// SPARC Architecture Phase
// Design system architecture and component planning

import { SparcPhase } from './phase-base.js';

export class SparcArchitecture extends SparcPhase {
  constructor(taskDescription, options) {
    super('architecture', taskDescription, options);
    this.components = [];
    this.designPatterns = [];
    this.systemDesign = null;
    this.dataModel = null;
    this.apiDesign = null;
  }

  /**
   * Execute architecture phase
   */
  async execute() {
    console.log('🏗️ Starting Architecture Phase');

    await this.initializePhase();

    const result = {
      systemDesign: null,
      components: [],
      designPatterns: [],
      dataModel: null,
      apiDesign: null,
      deploymentArchitecture: null,
      securityArchitecture: null,
      scalabilityPlan: null,
      integrationPoints: [],
      qualityAttributes: {},
      architecturalDecisions: [],
      riskAssessment: [],
    };

    try {
      // Load previous phases
      const specification = await this.retrieveFromMemory('specification_complete');
      const pseudocode = await this.retrieveFromMemory('pseudocode_complete');

      if (!specification || !pseudocode) {
        throw new Error('Specification and Pseudocode phases must be completed first');
      }

      // Design system architecture
      result.systemDesign = await this.designSystemArchitecture(specification, pseudocode);

      // Define components
      result.components = await this.defineComponents(specification, pseudocode);

      // Select design patterns
      result.designPatterns = await this.selectDesignPatterns(specification, pseudocode);

      // Design data model
      result.dataModel = await this.designDataModel(specification);

      // Design API structure
      result.apiDesign = await this.designApiStructure(specification);

      // Plan deployment architecture
      result.deploymentArchitecture = await this.planDeploymentArchitecture(specification);

      // Design security architecture
      result.securityArchitecture = await this.designSecurityArchitecture(specification);

      // Plan scalability
      result.scalabilityPlan = await this.planScalability(specification);

      // Identify integration points
      result.integrationPoints = await this.identifyIntegrationPoints(specification);

      // Define quality attributes
      result.qualityAttributes = await this.defineQualityAttributes(specification);

      // Document architectural decisions
      result.architecturalDecisions = await this.documentArchitecturalDecisions(result);

      // Assess risks
      result.riskAssessment = await this.assessArchitecturalRisks(result);

      // Generate architecture document
      await this.generateArchitectureDocument(result);

      // Store in memory
      await this.storeInMemory('architecture_complete', result);

      console.log('✅ Architecture phase completed');
      return result;
    } catch (error) {
      console.error('❌ Architecture phase failed:', error.message);
      throw error;
    }
  }

  /**
   * Design system architecture
   */
  async designSystemArchitecture(specification, pseudocode) {
    const architecture = {
      style: 'layered',
      layers: [],
      components: [],
      dataFlow: [],
      controlFlow: [],
      boundaries: [],
    };

    // Determine architecture style based on requirements
    const requirements = specification.requirements || [];
    const hasApiRequirements = requirements.some((req) => req.toLowerCase().includes('api'));
    const hasUiRequirements = requirements.some((req) => req.toLowerCase().includes('ui'));
    const hasDataRequirements = requirements.some((req) => req.toLowerCase().includes('data'));
    const hasDistributedRequirements = requirements.some(
      (req) =>
        req.toLowerCase().includes('distributed') || req.toLowerCase().includes('microservice'),
    );

    if (hasDistributedRequirements) {
      architecture.style = 'microservices';
      architecture.layers = [
        { name: 'API Gateway', responsibility: 'Request routing and authentication' },
        { name: 'Service Layer', responsibility: 'Business logic microservices' },
        { name: 'Data Layer', responsibility: 'Database and storage services' },
        { name: 'Infrastructure Layer', responsibility: 'Monitoring and deployment' },
      ];
    } else if (hasApiRequirements && hasUiRequirements) {
      architecture.style = 'mvc';
      architecture.layers = [
        { name: 'Presentation Layer', responsibility: 'User interface and user experience' },
        { name: 'Controller Layer', responsibility: 'Request handling and routing' },
        { name: 'Service Layer', responsibility: 'Business logic and processing' },
        { name: 'Data Access Layer', responsibility: 'Database operations' },
        { name: 'Infrastructure Layer', responsibility: 'Cross-cutting concerns' },
      ];
    } else if (hasApiRequirements) {
      architecture.style = 'layered';
      architecture.layers = [
        { name: 'API Layer', responsibility: 'External interface and contracts' },
        { name: 'Business Layer', responsibility: 'Core business logic' },
        { name: 'Data Layer', responsibility: 'Data persistence and retrieval' },
        { name: 'Infrastructure Layer', responsibility: 'Logging, monitoring, security' },
      ];
    } else {
      architecture.style = 'modular';
      architecture.layers = [
        { name: 'Interface Layer', responsibility: 'External interactions' },
        { name: 'Processing Layer', responsibility: 'Core processing logic' },
        { name: 'Storage Layer', responsibility: 'Data management' },
        { name: 'Utility Layer', responsibility: 'Common utilities and helpers' },
      ];
    }

    // Define data flow
    architecture.dataFlow = this.defineDataFlow(architecture.layers);

    // Define control flow
    architecture.controlFlow = this.defineControlFlow(architecture.layers);

    // Define boundaries
    architecture.boundaries = this.defineBoundaries(architecture.layers);

    return architecture;
  }

  /**
   * Define data flow
   */
  defineDataFlow(layers) {
    const dataFlow = [];

    for (let i = 0; i < layers.length - 1; i++) {
      dataFlow.push({
        from: layers[i].name,
        to: layers[i + 1].name,
        direction: 'downstream',
        dataType: 'processed data',
      });

      dataFlow.push({
        from: layers[i + 1].name,
        to: layers[i].name,
        direction: 'upstream',
        dataType: 'results/responses',
      });
    }

    return dataFlow;
  }

  /**
   * Define control flow
   */
  defineControlFlow(layers) {
    return layers.map((layer, index) => ({
      layer: layer.name,
      order: index + 1,
      triggers: index === 0 ? ['external request'] : [`${layers[index - 1].name} completion`],
      actions: ['process', 'validate', 'transform', 'forward'],
      outcomes:
        index === layers.length - 1 ? ['final response'] : [`trigger ${layers[index + 1].name}`],
    }));
  }

  /**
   * Define boundaries
   */
  defineBoundaries(layers) {
    return layers.map((layer) => ({
      layer: layer.name,
      type: 'logical',
      encapsulation: 'interface-based',
      dependencies: 'unidirectional',
      contracts: 'well-defined APIs',
    }));
  }

  /**
   * Define components
   */
  async defineComponents(specification, pseudocode) {
    const components = [];
    const requirements = specification.requirements || [];
    const functions = pseudocode.pseudocode || [];

    // Create components based on functional requirements
    for (const requirement of requirements) {
      const component = this.createComponentFromRequirement(requirement);
      components.push(component);
    }

    // Create components based on pseudocode functions
    for (const func of functions) {
      const component = this.createComponentFromFunction(func);
      components.push(component);
    }

    // Add infrastructure components
    components.push(...this.createInfrastructureComponents());

    // Remove duplicates and merge similar components
    const uniqueComponents = this.mergeComponents(components);

    return uniqueComponents;
  }

  /**
   * Create component from requirement
   */
  createComponentFromRequirement(requirement) {
    const reqLower = requirement.toLowerCase();

    if (reqLower.includes('api')) {
      return {
        name: 'APIController',
        type: 'controller',
        responsibility: 'Handle API requests and responses',
        interfaces: ['HTTP', 'REST'],
        dependencies: ['AuthenticationService', 'ValidationService'],
        patterns: ['Controller', 'Facade'],
        complexity: 'medium',
      };
    } else if (reqLower.includes('authenticate')) {
      return {
        name: 'AuthenticationService',
        type: 'service',
        responsibility: 'Manage user authentication and authorization',
        interfaces: ['IAuthenticationService'],
        dependencies: ['UserRepository', 'TokenManager'],
        patterns: ['Service', 'Strategy'],
        complexity: 'high',
      };
    } else if (reqLower.includes('data')) {
      return {
        name: 'DataRepository',
        type: 'repository',
        responsibility: 'Manage data persistence and retrieval',
        interfaces: ['IRepository'],
        dependencies: ['DatabaseConnection', 'DataMapper'],
        patterns: ['Repository', 'Unit of Work'],
        complexity: 'medium',
      };
    } else if (reqLower.includes('validate')) {
      return {
        name: 'ValidationService',
        type: 'service',
        responsibility: 'Validate input data and business rules',
        interfaces: ['IValidationService'],
        dependencies: ['ValidationRules', 'ErrorHandler'],
        patterns: ['Strategy', 'Chain of Responsibility'],
        complexity: 'low',
      };
    } else {
      return {
        name: 'GenericService',
        type: 'service',
        responsibility: 'Handle general business logic',
        interfaces: ['IService'],
        dependencies: ['CommonUtilities'],
        patterns: ['Service'],
        complexity: 'low',
      };
    }
  }

  /**
   * Create component from function
   */
  createComponentFromFunction(func) {
    return {
      name: this.toPascalCase(func.function) + 'Component',
      type: 'component',
      responsibility: func.description,
      interfaces: [`I${this.toPascalCase(func.function)}`],
      dependencies: this.extractDependencies(func.steps),
      patterns: this.inferPatterns(func.steps),
      complexity: func.complexity ? func.complexity.level : 'medium',
    };
  }

  /**
   * Create infrastructure components
   */
  createInfrastructureComponents() {
    return [
      {
        name: 'Logger',
        type: 'utility',
        responsibility: 'Centralized logging and monitoring',
        interfaces: ['ILogger'],
        dependencies: ['LoggingProvider'],
        patterns: ['Singleton', 'Factory'],
        complexity: 'low',
      },
      {
        name: 'ConfigurationManager',
        type: 'utility',
        responsibility: 'Manage application configuration',
        interfaces: ['IConfigurationManager'],
        dependencies: ['EnvironmentProvider'],
        patterns: ['Singleton'],
        complexity: 'low',
      },
      {
        name: 'ErrorHandler',
        type: 'utility',
        responsibility: 'Global error handling and reporting',
        interfaces: ['IErrorHandler'],
        dependencies: ['Logger'],
        patterns: ['Strategy', 'Chain of Responsibility'],
        complexity: 'medium',
      },
      {
        name: 'CacheManager',
        type: 'utility',
        responsibility: 'Caching and performance optimization',
        interfaces: ['ICacheManager'],
        dependencies: ['CacheProvider'],
        patterns: ['Proxy', 'Decorator'],
        complexity: 'medium',
      },
    ];
  }

  /**
   * Merge similar components
   */
  mergeComponents(components) {
    const componentMap = new Map();

    for (const component of components) {
      const key = component.name;

      if (componentMap.has(key)) {
        const existing = componentMap.get(key);
        // Merge dependencies and interfaces
        existing.dependencies = [...new Set([...existing.dependencies, ...component.dependencies])];
        existing.interfaces = [...new Set([...existing.interfaces, ...component.interfaces])];
        existing.patterns = [...new Set([...existing.patterns, ...component.patterns])];
      } else {
        componentMap.set(key, component);
      }
    }

    return Array.from(componentMap.values());
  }

  /**
   * Convert to PascalCase
   */
  toPascalCase(str) {
    return str
      .replace(/_([a-z])/g, (match, letter) => letter.toUpperCase())
      .replace(/^([a-z])/, (match, letter) => letter.toUpperCase());
  }

  /**
   * Extract dependencies from steps
   */
  extractDependencies(steps) {
    const dependencies = [];

    for (const step of steps) {
      if (step.includes('database')) dependencies.push('DatabaseConnection');
      if (step.includes('authenticate')) dependencies.push('AuthenticationService');
      if (step.includes('validate')) dependencies.push('ValidationService');
      if (step.includes('log')) dependencies.push('Logger');
      if (step.includes('cache')) dependencies.push('CacheManager');
    }

    return [...new Set(dependencies)];
  }

  /**
   * Infer patterns from steps
   */
  inferPatterns(steps) {
    const patterns = [];

    if (steps.some((step) => step.includes('CALL'))) patterns.push('Command');
    if (steps.some((step) => step.includes('IF'))) patterns.push('Strategy');
    if (steps.some((step) => step.includes('VALIDATE'))) patterns.push('Chain of Responsibility');
    if (steps.some((step) => step.includes('RETURN'))) patterns.push('Factory');

    return patterns.length > 0 ? patterns : ['Service'];
  }

  /**
   * Select design patterns
   */
  async selectDesignPatterns(specification, pseudocode) {
    const patterns = [];
    const requirements = specification.requirements || [];

    // Creational patterns
    if (
      requirements.some(
        (req) => req.toLowerCase().includes('create') || req.toLowerCase().includes('instantiate'),
      )
    ) {
      patterns.push({
        name: 'Factory Pattern',
        type: 'creational',
        purpose: 'Create objects without specifying exact classes',
        applicability: 'Object creation with varying configurations',
        implementation: 'Factory classes with creation methods',
        benefits: ['Loose coupling', 'Easy extensibility', 'Centralized creation logic'],
      });
    }

    // Structural patterns
    if (
      requirements.some(
        (req) => req.toLowerCase().includes('interface') || req.toLowerCase().includes('adapt'),
      )
    ) {
      patterns.push({
        name: 'Adapter Pattern',
        type: 'structural',
        purpose: 'Allow incompatible interfaces to work together',
        applicability: 'Integration with external systems',
        implementation: 'Wrapper classes implementing target interfaces',
        benefits: ['Code reuse', 'Separation of concerns', 'Easy integration'],
      });
    }

    // Behavioral patterns
    if (
      requirements.some(
        (req) => req.toLowerCase().includes('strategy') || req.toLowerCase().includes('algorithm'),
      )
    ) {
      patterns.push({
        name: 'Strategy Pattern',
        type: 'behavioral',
        purpose: 'Define family of algorithms and make them interchangeable',
        applicability: 'Multiple ways to perform operations',
        implementation: 'Strategy interfaces with concrete implementations',
        benefits: ['Flexibility', 'Open/closed principle', 'Runtime selection'],
      });
    }

    // Common patterns for all systems
    patterns.push({
      name: 'Repository Pattern',
      type: 'architectural',
      purpose: 'Separate data access logic from business logic',
      applicability: 'Data persistence operations',
      implementation: 'Repository interfaces with concrete implementations',
      benefits: ['Testability', 'Loose coupling', 'Centralized data access'],
    });

    patterns.push({
      name: 'Dependency Injection',
      type: 'architectural',
      purpose: 'Manage dependencies between objects',
      applicability: 'All components requiring external dependencies',
      implementation: 'Constructor injection with DI container',
      benefits: ['Testability', 'Loose coupling', 'Flexibility'],
    });

    patterns.push({
      name: 'Observer Pattern',
      type: 'behavioral',
      purpose: 'Notify multiple objects about state changes',
      applicability: 'Event-driven communication',
      implementation: 'Subject-observer relationships with event notifications',
      benefits: ['Loose coupling', 'Dynamic relationships', 'Broadcast communication'],
    });

    return patterns;
  }

  /**
   * Design data model
   */
  async designDataModel(specification) {
    const dataModel = {
      entities: [],
      relationships: [],
      constraints: [],
      indexes: [],
      views: [],
    };

    // Extract entities from requirements
    const requirements = specification.requirements || [];
    const entities = this.extractEntities(requirements);

    for (const entityName of entities) {
      const entity = {
        name: entityName,
        attributes: this.generateAttributes(entityName),
        primaryKey: 'id',
        foreignKeys: [],
        constraints: this.generateConstraints(entityName),
        indexes: this.generateIndexes(entityName),
      };

      dataModel.entities.push(entity);
    }

    // Define relationships
    dataModel.relationships = this.defineRelationships(dataModel.entities);

    // Define global constraints
    dataModel.constraints = this.defineGlobalConstraints();

    // Define indexes
    dataModel.indexes = this.defineGlobalIndexes(dataModel.entities);

    // Define views
    dataModel.views = this.defineViews(dataModel.entities);

    return dataModel;
  }

  /**
   * Extract entities from requirements
   */
  extractEntities(requirements) {
    const entities = new Set();

    for (const requirement of requirements) {
      const words = requirement.split(' ');

      for (const word of words) {
        // Look for nouns that could be entities
        if (
          word.length > 3 &&
          !['system', 'must', 'should', 'will', 'data', 'user', 'interface'].includes(
            word.toLowerCase(),
          )
        ) {
          if (word[0] === word[0].toUpperCase()) {
            entities.add(word);
          }
        }
      }
    }

    // Add default entities if none found
    if (entities.size === 0) {
      entities.add('User');
      entities.add('Session');
      entities.add('Configuration');
    }

    return Array.from(entities);
  }

  /**
   * Generate attributes for entity
   */
  generateAttributes(entityName) {
    const commonAttributes = [
      { name: 'id', type: 'UUID', nullable: false, unique: true },
      { name: 'created_at', type: 'TIMESTAMP', nullable: false, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', nullable: false, default: 'CURRENT_TIMESTAMP' },
      { name: 'version', type: 'INTEGER', nullable: false, default: '1' },
    ];

    const specificAttributes = [];
    const entityLower = entityName.toLowerCase();

    if (entityLower.includes('user')) {
      specificAttributes.push(
        { name: 'username', type: 'VARCHAR(50)', nullable: false, unique: true },
        { name: 'email', type: 'VARCHAR(255)', nullable: false, unique: true },
        { name: 'password_hash', type: 'VARCHAR(255)', nullable: false },
        { name: 'is_active', type: 'BOOLEAN', nullable: false, default: 'true' },
        { name: 'last_login', type: 'TIMESTAMP', nullable: true },
      );
    } else if (entityLower.includes('session')) {
      specificAttributes.push(
        { name: 'user_id', type: 'UUID', nullable: false },
        { name: 'token', type: 'VARCHAR(255)', nullable: false, unique: true },
        { name: 'expires_at', type: 'TIMESTAMP', nullable: false },
        { name: 'ip_address', type: 'INET', nullable: true },
        { name: 'user_agent', type: 'TEXT', nullable: true },
      );
    } else {
      specificAttributes.push(
        { name: 'name', type: 'VARCHAR(255)', nullable: false },
        { name: 'description', type: 'TEXT', nullable: true },
        { name: 'status', type: 'VARCHAR(50)', nullable: false, default: "'active'" },
      );
    }

    return [...commonAttributes, ...specificAttributes];
  }

  /**
   * Generate constraints for entity
   */
  generateConstraints(entityName) {
    const constraints = [
      { name: `${entityName.toLowerCase()}_id_pk`, type: 'PRIMARY KEY', column: 'id' },
      {
        name: `${entityName.toLowerCase()}_version_positive`,
        type: 'CHECK',
        condition: 'version > 0',
      },
      {
        name: `${entityName.toLowerCase()}_created_before_updated`,
        type: 'CHECK',
        condition: 'created_at <= updated_at',
      },
    ];

    const entityLower = entityName.toLowerCase();

    if (entityLower.includes('user')) {
      constraints.push(
        {
          name: 'user_email_format',
          type: 'CHECK',
          condition: "email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'",
        },
        { name: 'user_username_length', type: 'CHECK', condition: 'length(username) >= 3' },
      );
    }

    return constraints;
  }

  /**
   * Generate indexes for entity
   */
  generateIndexes(entityName) {
    const indexes = [
      {
        name: `idx_${entityName.toLowerCase()}_created_at`,
        type: 'BTREE',
        columns: ['created_at'],
      },
      {
        name: `idx_${entityName.toLowerCase()}_updated_at`,
        type: 'BTREE',
        columns: ['updated_at'],
      },
    ];

    const entityLower = entityName.toLowerCase();

    if (entityLower.includes('user')) {
      indexes.push(
        { name: 'idx_user_email', type: 'BTREE', columns: ['email'] },
        { name: 'idx_user_username', type: 'BTREE', columns: ['username'] },
        { name: 'idx_user_active', type: 'BTREE', columns: ['is_active'] },
      );
    }

    return indexes;
  }

  /**
   * Define relationships between entities
   */
  defineRelationships(entities) {
    const relationships = [];

    // Look for entities that could have relationships
    const userEntity = entities.find((e) => e.name.toLowerCase().includes('user'));
    const sessionEntity = entities.find((e) => e.name.toLowerCase().includes('session'));

    if (userEntity && sessionEntity) {
      relationships.push({
        name: 'user_sessions',
        type: 'one-to-many',
        parent: userEntity.name,
        child: sessionEntity.name,
        parentKey: 'id',
        childKey: 'user_id',
        onDelete: 'CASCADE',
        onUpdate: 'RESTRICT',
      });
    }

    return relationships;
  }

  /**
   * Define global constraints
   */
  defineGlobalConstraints() {
    return [
      { name: 'no_future_created_at', type: 'CHECK', condition: 'created_at <= CURRENT_TIMESTAMP' },
      { name: 'no_future_updated_at', type: 'CHECK', condition: 'updated_at <= CURRENT_TIMESTAMP' },
    ];
  }

  /**
   * Define global indexes
   */
  defineGlobalIndexes(entities) {
    const indexes = [];

    // Add composite indexes for common query patterns
    for (const entity of entities) {
      indexes.push({
        name: `idx_${entity.name.toLowerCase()}_status_created`,
        type: 'BTREE',
        table: entity.name,
        columns: ['status', 'created_at'],
      });
    }

    return indexes;
  }

  /**
   * Define views
   */
  defineViews(entities) {
    const views = [];

    // Create a view for active entities
    for (const entity of entities) {
      if (entity.attributes.some((attr) => attr.name === 'is_active' || attr.name === 'status')) {
        views.push({
          name: `active_${entity.name.toLowerCase()}s`,
          definition: `SELECT * FROM ${entity.name} WHERE ${entity.attributes.some((attr) => attr.name === 'is_active') ? 'is_active = true' : "status = 'active'"}`,
          purpose: `Show only active ${entity.name.toLowerCase()} records`,
        });
      }
    }

    return views;
  }

  /**
   * Design API structure
   */
  async designApiStructure(specification) {
    const apiDesign = {
      version: 'v1',
      baseUrl: '/api/v1',
      authentication: 'Bearer Token',
      endpoints: [],
      schemas: [],
      errorHandling: {},
      rateLimiting: {},
      versioning: {},
    };

    // Generate endpoints based on requirements
    const requirements = specification.requirements || [];

    for (const requirement of requirements) {
      if (requirement.toLowerCase().includes('api')) {
        const endpoints = this.generateEndpoints(requirement);
        apiDesign.endpoints.push(...endpoints);
      }
    }

    // Generate schemas
    apiDesign.schemas = this.generateApiSchemas(apiDesign.endpoints);

    // Define error handling
    apiDesign.errorHandling = this.defineApiErrorHandling();

    // Define rate limiting
    apiDesign.rateLimiting = this.defineApiRateLimiting();

    // Define versioning strategy
    apiDesign.versioning = this.defineApiVersioning();

    return apiDesign;
  }

  /**
   * Generate endpoints from requirement
   */
  generateEndpoints(requirement) {
    const endpoints = [];

    // Basic CRUD endpoints
    endpoints.push(
      {
        path: '/resources',
        method: 'GET',
        summary: 'List all resources',
        parameters: [
          { name: 'page', type: 'integer', description: 'Page number' },
          { name: 'limit', type: 'integer', description: 'Items per page' },
          { name: 'sort', type: 'string', description: 'Sort field' },
        ],
        responses: {
          200: { description: 'Success', schema: 'ResourceList' },
          400: { description: 'Bad Request', schema: 'Error' },
          401: { description: 'Unauthorized', schema: 'Error' },
        },
      },
      {
        path: '/resources/{id}',
        method: 'GET',
        summary: 'Get resource by ID',
        parameters: [{ name: 'id', type: 'string', description: 'Resource ID', required: true }],
        responses: {
          200: { description: 'Success', schema: 'Resource' },
          404: { description: 'Not Found', schema: 'Error' },
          401: { description: 'Unauthorized', schema: 'Error' },
        },
      },
      {
        path: '/resources',
        method: 'POST',
        summary: 'Create new resource',
        requestBody: { schema: 'CreateResourceRequest' },
        responses: {
          201: { description: 'Created', schema: 'Resource' },
          400: { description: 'Bad Request', schema: 'Error' },
          401: { description: 'Unauthorized', schema: 'Error' },
        },
      },
      {
        path: '/resources/{id}',
        method: 'PUT',
        summary: 'Update resource',
        parameters: [{ name: 'id', type: 'string', description: 'Resource ID', required: true }],
        requestBody: { schema: 'UpdateResourceRequest' },
        responses: {
          200: { description: 'Updated', schema: 'Resource' },
          404: { description: 'Not Found', schema: 'Error' },
          400: { description: 'Bad Request', schema: 'Error' },
          401: { description: 'Unauthorized', schema: 'Error' },
        },
      },
      {
        path: '/resources/{id}',
        method: 'DELETE',
        summary: 'Delete resource',
        parameters: [{ name: 'id', type: 'string', description: 'Resource ID', required: true }],
        responses: {
          204: { description: 'Deleted' },
          404: { description: 'Not Found', schema: 'Error' },
          401: { description: 'Unauthorized', schema: 'Error' },
        },
      },
    );

    return endpoints;
  }

  /**
   * Generate API schemas
   */
  generateApiSchemas(endpoints) {
    const schemas = [];

    // Basic resource schema
    schemas.push({
      name: 'Resource',
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['active', 'inactive'] },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
      required: ['id', 'name', 'status'],
    });

    // Resource list schema
    schemas.push({
      name: 'ResourceList',
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/schemas/Resource' } },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            pages: { type: 'integer' },
          },
        },
      },
    });

    // Error schema
    schemas.push({
      name: 'Error',
      type: 'object',
      properties: {
        error: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'array', items: { type: 'string' } },
        timestamp: { type: 'string', format: 'date-time' },
      },
      required: ['error', 'message'],
    });

    return schemas;
  }

  /**
   * Define API error handling
   */
  defineApiErrorHandling() {
    return {
      strategy: 'Consistent error responses with proper HTTP status codes',
      errorCodes: {
        400: 'Bad Request - Invalid input data',
        401: 'Unauthorized - Authentication required',
        403: 'Forbidden - Insufficient permissions',
        404: 'Not Found - Resource not found',
        409: 'Conflict - Resource already exists',
        422: 'Unprocessable Entity - Validation errors',
        429: 'Too Many Requests - Rate limit exceeded',
        500: 'Internal Server Error - Server error',
        503: 'Service Unavailable - Service temporarily unavailable',
      },
      errorFormat: {
        error: 'Error type',
        message: 'Human-readable error message',
        details: 'Array of specific error details',
        timestamp: 'ISO 8601 timestamp',
      },
      logging: 'All errors logged with request ID and stack trace',
    };
  }

  /**
   * Define API rate limiting
   */
  defineApiRateLimiting() {
    return {
      strategy: 'Token bucket algorithm with per-user and per-IP limits',
      limits: {
        authenticated: { requests: 1000, window: '1 hour' },
        anonymous: { requests: 100, window: '1 hour' },
        burst: { requests: 10, window: '1 minute' },
      },
      headers: {
        'X-RateLimit-Limit': 'Request limit for current window',
        'X-RateLimit-Remaining': 'Remaining requests in current window',
        'X-RateLimit-Reset': 'Unix timestamp when limit resets',
      },
      handling: 'Return 429 status with retry-after header',
    };
  }

  /**
   * Define API versioning
   */
  defineApiVersioning() {
    return {
      strategy: 'URL path versioning with backward compatibility',
      format: '/api/v{major}',
      lifecycle: {
        development: 'Active development with breaking changes',
        stable: 'Stable API with backward compatibility',
        deprecated: 'Deprecated with migration guide',
        retired: 'No longer supported',
      },
      migration: 'Gradual migration with parallel support periods',
    };
  }

  /**
   * Plan deployment architecture
   */
  async planDeploymentArchitecture(specification) {
    const deployment = {
      strategy: 'containerized',
      environments: [],
      infrastructure: {},
      monitoring: {},
      security: {},
      scalability: {},
    };

    // Define environments
    deployment.environments = [
      {
        name: 'development',
        purpose: 'Development and testing',
        resources: 'Single node with shared resources',
        database: 'SQLite or embedded database',
        monitoring: 'Basic logging',
      },
      {
        name: 'staging',
        purpose: 'Pre-production testing',
        resources: 'Production-like environment with reduced capacity',
        database: 'Managed database service',
        monitoring: 'Full monitoring stack',
      },
      {
        name: 'production',
        purpose: 'Live application serving users',
        resources: 'Multiple nodes with load balancing',
        database: 'High-availability managed database',
        monitoring: 'Comprehensive monitoring and alerting',
      },
    ];

    // Define infrastructure
    deployment.infrastructure = {
      platform: 'Container orchestration (Kubernetes/Docker Swarm)',
      compute: 'Auto-scaling container instances',
      storage: 'Persistent volumes with backup',
      networking: 'Load balancer with SSL termination',
      dns: 'Managed DNS with health checks',
    };

    // Define monitoring
    deployment.monitoring = {
      metrics: 'Application and infrastructure metrics',
      logging: 'Centralized logging with log aggregation',
      tracing: 'Distributed tracing for request flow',
      alerting: 'Multi-channel alerting for critical issues',
      dashboards: 'Real-time dashboards for system health',
    };

    // Define security
    deployment.security = {
      secrets: 'Encrypted secrets management',
      network: 'Network policies and firewall rules',
      access: 'Role-based access control',
      scanning: 'Container and dependency vulnerability scanning',
      compliance: 'Security compliance monitoring',
    };

    // Define scalability
    deployment.scalability = {
      horizontal: 'Auto-scaling based on CPU/memory/requests',
      vertical: 'Resource limits and requests optimization',
      database: 'Database scaling with read replicas',
      caching: 'Multi-layer caching strategy',
      cdn: 'Content delivery network for static assets',
    };

    return deployment;
  }

  /**
   * Design security architecture
   */
  async designSecurityArchitecture(specification) {
    const security = {
      authentication: {},
      authorization: {},
      dataProtection: {},
      networkSecurity: {},
      monitoring: {},
      compliance: {},
    };

    // Authentication design
    security.authentication = {
      mechanism: 'JWT tokens with refresh token rotation',
      providers: ['Local credentials', 'OAuth2/OpenID Connect'],
      session: 'Stateless with secure token storage',
      mfa: 'Multi-factor authentication for sensitive operations',
      passwordPolicy: 'Strong password requirements with complexity rules',
    };

    // Authorization design
    security.authorization = {
      model: 'Role-based access control (RBAC)',
      permissions: 'Fine-grained permissions with resource-level access',
      policies: 'Attribute-based access control for complex rules',
      delegation: 'Secure delegation with time-limited tokens',
      auditing: 'Complete audit trail of access decisions',
    };

    // Data protection design
    security.dataProtection = {
      encryption: {
        atRest: 'AES-256 encryption for stored data',
        inTransit: 'TLS 1.3 for all network communication',
        keys: 'Hardware security module or managed key service',
      },
      privacy: {
        pii: 'Personal information identification and protection',
        anonymization: 'Data anonymization for analytics',
        retention: 'Data retention policies with automatic deletion',
      },
      backup: {
        encryption: 'Encrypted backups with separate key management',
        testing: 'Regular backup restoration testing',
        offsite: 'Geographically distributed backup storage',
      },
    };

    // Network security design
    security.networkSecurity = {
      firewall: 'Web application firewall with DDoS protection',
      segmentation: 'Network segmentation with micro-segmentation',
      monitoring: 'Network traffic monitoring and analysis',
      vpn: 'VPN access for administrative operations',
      certificates: 'Automated certificate management and renewal',
    };

    // Security monitoring design
    security.monitoring = {
      siem: 'Security information and event management',
      ids: 'Intrusion detection and prevention systems',
      behavior: 'User and entity behavior analytics',
      threat: 'Threat intelligence integration',
      incident: 'Automated incident response workflows',
    };

    // Compliance design
    security.compliance = {
      frameworks: ['GDPR', 'SOC 2', 'ISO 27001'],
      auditing: 'Regular security audits and penetration testing',
      documentation: 'Security policies and procedures documentation',
      training: 'Security awareness training for all personnel',
      reporting: 'Compliance reporting and evidence collection',
    };

    return security;
  }

  /**
   * Plan scalability
   */
  async planScalability(specification) {
    const scalability = {
      horizontalScaling: {},
      verticalScaling: {},
      dataScaling: {},
      performanceOptimization: {},
      monitoring: {},
    };

    // Horizontal scaling plan
    scalability.horizontalScaling = {
      strategy: 'Auto-scaling based on demand metrics',
      triggers: ['CPU utilization > 70%', 'Memory utilization > 80%', 'Request queue length > 10'],
      limits: { minimum: 2, maximum: 20, scaleUpRate: 2, scaleDownRate: 1 },
      loadBalancing: 'Round-robin with health checks',
      sessionAffinity: 'Stateless design with external session storage',
    };

    // Vertical scaling plan
    scalability.verticalScaling = {
      strategy: 'Resource optimization based on usage patterns',
      monitoring: 'Continuous resource utilization monitoring',
      recommendations: 'Automated resource recommendation engine',
      limits: 'Resource limits to prevent resource exhaustion',
      optimization: 'Container resource optimization',
    };

    // Data scaling plan
    scalability.dataScaling = {
      database: {
        readReplicas: 'Read replicas for read-heavy workloads',
        sharding: 'Database sharding for large datasets',
        caching: 'Multi-layer caching with Redis/Memcached',
        indexing: 'Optimized indexing strategies',
      },
      storage: {
        tiering: 'Storage tiering based on access patterns',
        compression: 'Data compression for storage efficiency',
        archiving: 'Automatic archiving of old data',
        partitioning: 'Data partitioning for improved performance',
      },
    };

    // Performance optimization plan
    scalability.performanceOptimization = {
      caching: {
        application: 'In-memory application caching',
        database: 'Database query result caching',
        cdn: 'Content delivery network for static assets',
        browser: 'Browser caching with appropriate headers',
      },
      optimization: {
        queries: 'Database query optimization',
        algorithms: 'Algorithm complexity optimization',
        resources: 'Resource usage optimization',
        networking: 'Network latency optimization',
      },
    };

    // Monitoring plan
    scalability.monitoring = {
      metrics: [
        'Response time and latency',
        'Throughput and requests per second',
        'Error rates and success rates',
        'Resource utilization (CPU, memory, disk)',
        'Database performance metrics',
      ],
      alerting: 'Proactive alerting for performance degradation',
      capacity: 'Capacity planning based on growth projections',
      testing: 'Regular performance testing and load testing',
    };

    return scalability;
  }

  /**
   * Identify integration points
   */
  async identifyIntegrationPoints(specification) {
    const integrations = [];
    const requirements = specification.requirements || [];

    // Analyze requirements for integration needs
    for (const requirement of requirements) {
      const reqLower = requirement.toLowerCase();

      if (reqLower.includes('external') || reqLower.includes('third-party')) {
        integrations.push({
          name: 'External API Integration',
          type: 'REST API',
          purpose: 'Integrate with external services',
          protocol: 'HTTPS',
          authentication: 'API Key or OAuth2',
          dataFormat: 'JSON',
          errorHandling: 'Retry with exponential backoff',
          monitoring: 'API health checks and response time monitoring',
        });
      }

      if (reqLower.includes('database') || reqLower.includes('data')) {
        integrations.push({
          name: 'Database Integration',
          type: 'Database',
          purpose: 'Data persistence and retrieval',
          protocol: 'Database-specific protocol',
          authentication: 'Connection string with credentials',
          dataFormat: 'SQL or NoSQL',
          errorHandling: 'Connection pooling and retry logic',
          monitoring: 'Database performance and connection monitoring',
        });
      }

      if (reqLower.includes('message') || reqLower.includes('event')) {
        integrations.push({
          name: 'Message Queue Integration',
          type: 'Message Queue',
          purpose: 'Asynchronous communication',
          protocol: 'AMQP or proprietary',
          authentication: 'Queue-specific authentication',
          dataFormat: 'JSON or Binary',
          errorHandling: 'Dead letter queues and retry policies',
          monitoring: 'Queue depth and processing time monitoring',
        });
      }
    }

    // Add common integrations
    integrations.push({
      name: 'Logging Integration',
      type: 'Logging Service',
      purpose: 'Centralized logging and monitoring',
      protocol: 'HTTP/HTTPS',
      authentication: 'API Key',
      dataFormat: 'Structured logs (JSON)',
      errorHandling: 'Local buffering with batch sending',
      monitoring: 'Log ingestion and processing monitoring',
    });

    return integrations;
  }

  /**
   * Define quality attributes
   */
  async defineQualityAttributes(specification) {
    return {
      performance: {
        responseTime: 'API responses under 200ms for 95th percentile',
        throughput: 'Handle 1000+ requests per second',
        scalability: 'Scale horizontally to handle load increases',
        efficiency: 'Optimize resource usage and minimize waste',
      },
      reliability: {
        availability: '99.9% uptime with planned maintenance windows',
        faultTolerance: 'Graceful degradation when components fail',
        recoverability: 'Automatic recovery from transient failures',
        durability: 'Data persistence with backup and recovery',
      },
      security: {
        confidentiality: 'Protect sensitive data with encryption',
        integrity: 'Ensure data accuracy and prevent tampering',
        authentication: 'Verify user identity before access',
        authorization: 'Control access based on user permissions',
      },
      usability: {
        learnability: 'Intuitive interfaces requiring minimal training',
        efficiency: 'Allow experienced users to work efficiently',
        memorability: 'Easy to remember after periods of non-use',
        errors: 'Minimize user errors and provide clear error messages',
      },
      maintainability: {
        modifiability: 'Easy to modify and extend functionality',
        testability: 'Comprehensive test coverage and automated testing',
        reusability: 'Modular design with reusable components',
        analyzability: 'Clear code structure and documentation',
      },
    };
  }

  /**
   * Document architectural decisions
   */
  async documentArchitecturalDecisions(result) {
    const decisions = [];

    // Architecture style decision
    decisions.push({
      id: 'AD-001',
      title: `Use ${result.systemDesign.style} Architecture`,
      status: 'Accepted',
      context: 'Need to choose appropriate architectural style for the system',
      decision: `Implement ${result.systemDesign.style} architecture with ${result.systemDesign.layers.length} layers`,
      consequences: {
        positive: [
          'Clear separation of concerns',
          'Maintainable code structure',
          'Scalable design',
        ],
        negative: ['Potential performance overhead', 'Added complexity for simple operations'],
      },
      alternatives: ['Monolithic', 'Microservices', 'Event-driven'],
      date: new Date().toISOString(),
    });

    // Design patterns decision
    decisions.push({
      id: 'AD-002',
      title: 'Apply Standard Design Patterns',
      status: 'Accepted',
      context: 'Need to ensure consistent and well-understood design patterns',
      decision: `Implement ${result.designPatterns.length} design patterns including Repository, Factory, and Strategy patterns`,
      consequences: {
        positive: [
          'Improved code maintainability',
          'Better testability',
          'Consistent design approach',
        ],
        negative: ['Learning curve for developers', 'Potential over-engineering'],
      },
      alternatives: ['Ad-hoc design', 'Framework-specific patterns'],
      date: new Date().toISOString(),
    });

    // Data model decision
    decisions.push({
      id: 'AD-003',
      title: 'Relational Database Design',
      status: 'Accepted',
      context: 'Need to choose appropriate data storage and modeling approach',
      decision: `Use relational database with ${result.dataModel.entities.length} entities and normalized schema`,
      consequences: {
        positive: ['ACID compliance', 'Strong consistency', 'Mature ecosystem'],
        negative: ['Potential scalability limitations', 'Schema migration complexity'],
      },
      alternatives: ['NoSQL database', 'Document database', 'Graph database'],
      date: new Date().toISOString(),
    });

    return decisions;
  }

  /**
   * Assess architectural risks
   */
  async assessArchitecturalRisks(result) {
    const risks = [];

    // Complexity risk
    risks.push({
      id: 'AR-001',
      category: 'Complexity',
      description: 'System complexity may lead to maintenance challenges',
      probability: 'Medium',
      impact: 'High',
      riskLevel: 'High',
      mitigation: [
        'Implement comprehensive documentation',
        'Provide developer training',
        'Establish coding standards',
        'Regular code reviews',
      ],
      monitoring: 'Code complexity metrics and maintainability index',
    });

    // Performance risk
    risks.push({
      id: 'AR-002',
      category: 'Performance',
      description: 'Layered architecture may introduce performance overhead',
      probability: 'Low',
      impact: 'Medium',
      riskLevel: 'Medium',
      mitigation: [
        'Performance testing and profiling',
        'Caching strategies',
        'Database optimization',
        'Load balancing',
      ],
      monitoring: 'Response time and throughput monitoring',
    });

    // Security risk
    risks.push({
      id: 'AR-003',
      category: 'Security',
      description: 'Multiple integration points increase attack surface',
      probability: 'Medium',
      impact: 'High',
      riskLevel: 'High',
      mitigation: [
        'Security architecture review',
        'Regular security testing',
        'Input validation and sanitization',
        'Secure communication protocols',
      ],
      monitoring: 'Security event monitoring and alerting',
    });

    // Scalability risk
    risks.push({
      id: 'AR-004',
      category: 'Scalability',
      description: 'Database may become bottleneck under high load',
      probability: 'Medium',
      impact: 'High',
      riskLevel: 'High',
      mitigation: [
        'Database optimization',
        'Read replicas and caching',
        'Connection pooling',
        'Horizontal scaling strategies',
      ],
      monitoring: 'Database performance and connection monitoring',
    });

    return risks;
  }

  /**
   * Generate architecture document
   */
  async generateArchitectureDocument(result) {
    const document = `# ${this.taskDescription} - Architecture Design

## System Architecture

### Architecture Style
**Style**: ${result.systemDesign.style}
**Layers**: ${result.systemDesign.layers.length}

${result.systemDesign.layers
  .map(
    (layer, index) => `
#### ${index + 1}. ${layer.name}
**Responsibility**: ${layer.responsibility}
`,
  )
  .join('\n')}

### Data Flow
${result.systemDesign.dataFlow.map((flow) => `- ${flow.from} → ${flow.to} (${flow.direction}): ${flow.dataType}`).join('\n')}

### Control Flow
${result.systemDesign.controlFlow
  .map(
    (flow) => `
#### ${flow.layer}
- **Order**: ${flow.order}
- **Triggers**: ${flow.triggers.join(', ')}
- **Actions**: ${flow.actions.join(', ')}
- **Outcomes**: ${flow.outcomes.join(', ')}
`,
  )
  .join('\n')}

## Components

${result.components
  .map(
    (component, index) => `
### ${index + 1}. ${component.name}
**Type**: ${component.type}
**Responsibility**: ${component.responsibility}
**Interfaces**: ${component.interfaces.join(', ')}
**Dependencies**: ${component.dependencies.join(', ')}
**Patterns**: ${component.patterns.join(', ')}
**Complexity**: ${component.complexity}
`,
  )
  .join('\n')}

## Design Patterns

${result.designPatterns
  .map(
    (pattern, index) => `
### ${index + 1}. ${pattern.name}
**Type**: ${pattern.type}
**Purpose**: ${pattern.purpose}
**Applicability**: ${pattern.applicability}
**Implementation**: ${pattern.implementation}
**Benefits**: ${pattern.benefits.join(', ')}
`,
  )
  .join('\n')}

## Data Model

### Entities
${result.dataModel.entities
  .map(
    (entity, index) => `
#### ${index + 1}. ${entity.name}
**Primary Key**: ${entity.primaryKey}
**Attributes**:
${entity.attributes.map((attr) => `- ${attr.name}: ${attr.type}${attr.nullable ? '' : ' NOT NULL'}${attr.unique ? ' UNIQUE' : ''}${attr.default ? ` DEFAULT ${attr.default}` : ''}`).join('\n')}

**Constraints**:
${entity.constraints.map((constraint) => `- ${constraint.name}: ${constraint.type}${constraint.condition ? ` (${constraint.condition})` : ''}`).join('\n')}

**Indexes**:
${entity.indexes.map((index) => `- ${index.name}: ${index.type} (${index.columns.join(', ')})`).join('\n')}
`,
  )
  .join('\n')}

### Relationships
${result.dataModel.relationships
  .map(
    (rel, index) => `
#### ${index + 1}. ${rel.name}
**Type**: ${rel.type}
**Parent**: ${rel.parent} (${rel.parentKey})
**Child**: ${rel.child} (${rel.childKey})
**On Delete**: ${rel.onDelete}
**On Update**: ${rel.onUpdate}
`,
  )
  .join('\n')}

## API Design

### General Information
**Version**: ${result.apiDesign.version}
**Base URL**: ${result.apiDesign.baseUrl}
**Authentication**: ${result.apiDesign.authentication}

### Endpoints
${result.apiDesign.endpoints
  .map(
    (endpoint, index) => `
#### ${index + 1}. ${endpoint.method} ${endpoint.path}
**Summary**: ${endpoint.summary}
**Parameters**: ${endpoint.parameters ? endpoint.parameters.map((p) => `${p.name} (${p.type})`).join(', ') : 'None'}
**Request Body**: ${endpoint.requestBody ? endpoint.requestBody.schema : 'None'}
**Responses**: ${Object.entries(endpoint.responses)
      .map(([code, resp]) => `${code}: ${resp.description}`)
      .join(', ')}
`,
  )
  .join('\n')}

### Schemas
${result.apiDesign.schemas
  .map(
    (schema, index) => `
#### ${index + 1}. ${schema.name}
**Type**: ${schema.type}
**Properties**:
${Object.entries(schema.properties)
  .map(
    ([name, prop]) =>
      `- ${name}: ${prop.type}${prop.format ? ` (${prop.format})` : ''}${prop.enum ? ` [${prop.enum.join(', ')}]` : ''}`,
  )
  .join('\n')}
**Required**: ${schema.required ? schema.required.join(', ') : 'None'}
`,
  )
  .join('\n')}

## Deployment Architecture

### Environments
${result.deploymentArchitecture.environments
  .map(
    (env, index) => `
#### ${index + 1}. ${env.name}
**Purpose**: ${env.purpose}
**Resources**: ${env.resources}
**Database**: ${env.database}
**Monitoring**: ${env.monitoring}
`,
  )
  .join('\n')}

### Infrastructure
**Platform**: ${result.deploymentArchitecture.infrastructure.platform}
**Compute**: ${result.deploymentArchitecture.infrastructure.compute}
**Storage**: ${result.deploymentArchitecture.infrastructure.storage}
**Networking**: ${result.deploymentArchitecture.infrastructure.networking}
**DNS**: ${result.deploymentArchitecture.infrastructure.dns}

## Security Architecture

### Authentication
**Mechanism**: ${result.securityArchitecture.authentication.mechanism}
**Providers**: ${result.securityArchitecture.authentication.providers.join(', ')}
**Session**: ${result.securityArchitecture.authentication.session}
**MFA**: ${result.securityArchitecture.authentication.mfa}

### Authorization
**Model**: ${result.securityArchitecture.authorization.model}
**Permissions**: ${result.securityArchitecture.authorization.permissions}
**Policies**: ${result.securityArchitecture.authorization.policies}

### Data Protection
**Encryption at Rest**: ${result.securityArchitecture.dataProtection.encryption.atRest}
**Encryption in Transit**: ${result.securityArchitecture.dataProtection.encryption.inTransit}
**Key Management**: ${result.securityArchitecture.dataProtection.encryption.keys}

## Scalability Plan

### Horizontal Scaling
**Strategy**: ${result.scalabilityPlan.horizontalScaling.strategy}
**Triggers**: ${result.scalabilityPlan.horizontalScaling.triggers.join(', ')}
**Limits**: Min: ${result.scalabilityPlan.horizontalScaling.limits.minimum}, Max: ${result.scalabilityPlan.horizontalScaling.limits.maximum}

### Data Scaling
**Read Replicas**: ${result.scalabilityPlan.dataScaling.database.readReplicas}
**Sharding**: ${result.scalabilityPlan.dataScaling.database.sharding}
**Caching**: ${result.scalabilityPlan.dataScaling.database.caching}

## Quality Attributes

${Object.entries(result.qualityAttributes)
  .map(
    ([category, attributes]) => `
### ${category.charAt(0).toUpperCase() + category.slice(1)}
${Object.entries(attributes)
  .map(([attr, desc]) => `- **${attr}**: ${desc}`)
  .join('\n')}
`,
  )
  .join('\n')}

## Architectural Decisions

${result.architecturalDecisions
  .map(
    (decision, index) => `
### ${decision.id}: ${decision.title}
**Status**: ${decision.status}
**Context**: ${decision.context}
**Decision**: ${decision.decision}
**Positive Consequences**: ${decision.consequences.positive.join(', ')}
**Negative Consequences**: ${decision.consequences.negative.join(', ')}
**Alternatives Considered**: ${decision.alternatives.join(', ')}
**Date**: ${decision.date}
`,
  )
  .join('\n')}

## Risk Assessment

${result.riskAssessment
  .map(
    (risk, index) => `
### ${risk.id}: ${risk.category}
**Description**: ${risk.description}
**Probability**: ${risk.probability}
**Impact**: ${risk.impact}
**Risk Level**: ${risk.riskLevel}
**Mitigation**: ${risk.mitigation.join(', ')}
**Monitoring**: ${risk.monitoring}
`,
  )
  .join('\n')}

## Integration Points

${result.integrationPoints
  .map(
    (integration, index) => `
### ${index + 1}. ${integration.name}
**Type**: ${integration.type}
**Purpose**: ${integration.purpose}
**Protocol**: ${integration.protocol}
**Authentication**: ${integration.authentication}
**Data Format**: ${integration.dataFormat}
**Error Handling**: ${integration.errorHandling}
**Monitoring**: ${integration.monitoring}
`,
  )
  .join('\n')}
`;

    // Save document
    await this.saveArtifact('architecture.md', document);
    return document;
  }
}

export default SparcArchitecture;
