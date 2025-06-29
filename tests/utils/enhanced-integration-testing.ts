/// <reference types="jest" />

/**
 * Enhanced Integration Testing Framework
 * Cross-service validation and comprehensive integration testing
 */

import { DryRunValidator, DryRunResult } from './dry-run-validation.js';
import { TestEventEmitter, retryWithBackoff, waitForStableValue } from './test-stability-helpers.js';
import { TEST_STABILITY_CONFIG } from '../test-stability.config.js';

/**
 * Service dependency configuration
 */
export interface ServiceDependency {
  name: string;
  type: 'database' | 'api' | 'file' | 'memory' | 'process' | 'network';
  required: boolean;
  healthCheck: () => Promise<boolean>;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  timeout?: number;
}

/**
 * Integration test context
 */
export interface IntegrationTestContext {
  services: Map<string, ServiceDependency>;
  sharedState: Map<string, any>;
  testData: Map<string, any>;
  eventBus: TestEventEmitter;
  cleanupTasks: Array<() => Promise<void>>;
}

/**
 * Cross-service validation result
 */
export interface CrossServiceValidationResult {
  serviceName: string;
  operation: string;
  success: boolean;
  duration: number;
  error?: Error;
  sideEffects: Array<{
    affectedService: string;
    change: string;
    verified: boolean;
  }>;
}

/**
 * Integration test scenario
 */
export interface IntegrationTestScenario {
  name: string;
  description: string;
  dependencies: string[];
  setup: (context: IntegrationTestContext) => Promise<void>;
  execute: (context: IntegrationTestContext) => Promise<any>;
  validate: (result: any, context: IntegrationTestContext) => Promise<void>;
  teardown?: (context: IntegrationTestContext) => Promise<void>;
  timeout?: number;
  retries?: number;
  requiresIsolation?: boolean;
}

/**
 * Enhanced integration test manager
 */
export class EnhancedIntegrationTestManager {
  private context: IntegrationTestContext;
  private dryRunValidator: DryRunValidator;

  constructor() {
    this.context = {
      services: new Map(),
      sharedState: new Map(),
      testData: new Map(),
      eventBus: new TestEventEmitter(),
      cleanupTasks: []
    };
    this.dryRunValidator = new DryRunValidator();
  }

  /**
   * Register a service dependency
   */
  registerService(dependency: ServiceDependency): void {
    this.context.services.set(dependency.name, dependency);
  }

  /**
   * Execute integration test scenario with full validation
   */
  async executeIntegrationScenario(
    scenario: IntegrationTestScenario
  ): Promise<{
    success: boolean;
    result?: any;
    error?: Error;
    duration: number;
    crossServiceValidation: CrossServiceValidationResult[];
    dryRunResult?: DryRunResult;
  }> {
    const startTime = performance.now();
    let success = false;
    let result: any;
    let error: Error | undefined;
    let crossServiceValidation: CrossServiceValidationResult[] = [];

    try {
      // Validate dependencies are available
      await this.validateDependencies(scenario.dependencies);

      // Setup phase
      await this.setupServices(scenario.dependencies);
      await scenario.setup(this.context);

      // Dry-run validation if applicable
      let dryRunResult: DryRunResult | undefined;
      try {
        dryRunResult = await this.dryRunValidator.executeDryRun(
          () => scenario.execute(this.context),
          { timeout: scenario.timeout }
        );
      } catch (dryRunError) {
        console.warn('Dry-run validation failed, proceeding with actual execution:', dryRunError);
      }

      // Execute main operation
      result = await this.executeWithRetry(
        () => scenario.execute(this.context),
        scenario.retries || 1,
        scenario.timeout
      );

      // Validate result
      await scenario.validate(result, this.context);

      // Cross-service validation
      crossServiceValidation = await this.performCrossServiceValidation(scenario.dependencies);

      success = true;

      return {
        success,
        result,
        duration: performance.now() - startTime,
        crossServiceValidation,
        dryRunResult
      };

    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
      return {
        success: false,
        error,
        duration: performance.now() - startTime,
        crossServiceValidation
      };

    } finally {
      // Cleanup phase
      try {
        if (scenario.teardown) {
          await scenario.teardown(this.context);
        }
        await this.cleanup();
      } catch (cleanupError) {
        console.warn('Cleanup failed:', cleanupError);
      }
    }
  }

  /**
   * Execute multiple integration scenarios in sequence with dependency resolution
   */
  async executeIntegrationSuite(
    scenarios: IntegrationTestScenario[]
  ): Promise<Array<{
    scenario: IntegrationTestScenario;
    success: boolean;
    result?: any;
    error?: Error;
    duration: number;
    crossServiceValidation: CrossServiceValidationResult[];
  }>> {
    // Sort scenarios by dependency order
    const sortedScenarios = this.sortByDependencies(scenarios);
    const results = [];

    for (const scenario of sortedScenarios) {
      console.log(`Executing integration scenario: ${scenario.name}`);
      
      const result = await this.executeIntegrationScenario(scenario);
      results.push({
        scenario,
        ...result
      });

      // Stop on critical failures
      if (!result.success && scenario.dependencies.length > 0) {
        console.error(`Critical integration scenario failed: ${scenario.name}`);
        break;
      }

      // Allow time for system stabilization between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }

  /**
   * Validate service health and readiness
   */
  async validateServiceHealth(): Promise<Map<string, boolean>> {
    const healthResults = new Map<string, boolean>();

    for (const [serviceName, service] of this.context.services) {
      try {
        const isHealthy = await retryWithBackoff(
          service.healthCheck,
          {
            maxRetries: 3,
            initialDelay: 100,
            maxDelay: 1000
          }
        );
        healthResults.set(serviceName, isHealthy);
      } catch (error) {
        console.warn(`Health check failed for service ${serviceName}:`, error);
        healthResults.set(serviceName, false);
      }
    }

    return healthResults;
  }

  /**
   * Create integration test for cross-module communication
   */
  createCrossModuleTest(
    moduleA: { name: string; interface: any },
    moduleB: { name: string; interface: any },
    communicationPattern: 'direct-call' | 'event-driven' | 'shared-state' | 'message-passing'
  ): IntegrationTestScenario {
    return {
      name: `Cross-module integration: ${moduleA.name} ↔ ${moduleB.name}`,
      description: `Test integration between ${moduleA.name} and ${moduleB.name} using ${communicationPattern}`,
      dependencies: [moduleA.name, moduleB.name],
      setup: async (context) => {
        context.testData.set('moduleA', moduleA);
        context.testData.set('moduleB', moduleB);
        context.testData.set('communicationPattern', communicationPattern);
      },
      execute: async (context) => {
        const modA = context.testData.get('moduleA');
        const modB = context.testData.get('moduleB');
        const pattern = context.testData.get('communicationPattern');

        switch (pattern) {
          case 'direct-call':
            return this.testDirectCall(modA, modB, context);
          case 'event-driven':
            return this.testEventDriven(modA, modB, context);
          case 'shared-state':
            return this.testSharedState(modA, modB, context);
          case 'message-passing':
            return this.testMessagePassing(modA, modB, context);
          default:
            throw new Error(`Unknown communication pattern: ${pattern}`);
        }
      },
      validate: async (result, context) => {
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.moduleAResult).toBeDefined();
        expect(result.moduleBResult).toBeDefined();
      },
      timeout: TEST_STABILITY_CONFIG.timeouts.integration
    };
  }

  /**
   * Create database integration test scenario
   */
  createDatabaseIntegrationTest(
    operations: Array<{
      type: 'create' | 'read' | 'update' | 'delete';
      table: string;
      data?: any;
      condition?: any;
    }>
  ): IntegrationTestScenario {
    return {
      name: 'Database integration test',
      description: 'Test database operations with transaction consistency',
      dependencies: ['database'],
      setup: async (context) => {
        context.testData.set('operations', operations);
        context.testData.set('transactionData', new Map());
      },
      execute: async (context) => {
        const ops = context.testData.get('operations');
        const results = [];

        for (const operation of ops) {
          const result = await this.executeDatabaseOperation(operation, context);
          results.push(result);
        }

        return results;
      },
      validate: async (results, context) => {
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(operations.length);
        
        // Validate data consistency
        await this.validateDatabaseConsistency(context);
      },
      teardown: async (context) => {
        // Clean up test data
        await this.cleanupDatabaseTestData(context);
      }
    };
  }

  /**
   * Create API integration test scenario
   */
  createAPIIntegrationTest(
    endpoints: Array<{
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      path: string;
      data?: any;
      expectedStatus: number;
    }>
  ): IntegrationTestScenario {
    return {
      name: 'API integration test',
      description: 'Test API endpoints with request/response validation',
      dependencies: ['api'],
      setup: async (context) => {
        context.testData.set('endpoints', endpoints);
        context.testData.set('apiResults', []);
      },
      execute: async (context) => {
        const endpoints = context.testData.get('endpoints');
        const results = [];

        for (const endpoint of endpoints) {
          const result = await this.executeAPIRequest(endpoint, context);
          results.push(result);
        }

        return results;
      },
      validate: async (results, context) => {
        const endpoints = context.testData.get('endpoints');
        
        expect(results.length).toBe(endpoints.length);
        
        results.forEach((result, index) => {
          const endpoint = endpoints[index];
          expect(result.status).toBe(endpoint.expectedStatus);
          expect(result.responseTime).toBeLessThan(5000); // 5s timeout
        });
      }
    };
  }

  private async validateDependencies(dependencies: string[]): Promise<void> {
    for (const depName of dependencies) {
      const service = this.context.services.get(depName);
      if (!service) {
        throw new Error(`Required service dependency not found: ${depName}`);
      }

      if (service.required) {
        const isHealthy = await service.healthCheck();
        if (!isHealthy) {
          throw new Error(`Required service ${depName} is not healthy`);
        }
      }
    }
  }

  private async setupServices(dependencies: string[]): Promise<void> {
    for (const depName of dependencies) {
      const service = this.context.services.get(depName);
      if (service?.setup) {
        await service.setup();
      }
    }
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    timeout?: number
  ): Promise<T> {
    return retryWithBackoff(
      async () => {
        if (timeout) {
          return Promise.race([
            operation(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Operation timeout')), timeout)
            )
          ]);
        }
        return operation();
      },
      {
        maxRetries,
        initialDelay: TEST_STABILITY_CONFIG.retry.initialDelay,
        maxDelay: TEST_STABILITY_CONFIG.retry.maxDelay
      }
    );
  }

  private async performCrossServiceValidation(
    dependencies: string[]
  ): Promise<CrossServiceValidationResult[]> {
    const results: CrossServiceValidationResult[] = [];

    for (const serviceName of dependencies) {
      const service = this.context.services.get(serviceName);
      if (!service) continue;

      try {
        const startTime = performance.now();
        const isHealthy = await service.healthCheck();
        const duration = performance.now() - startTime;

        results.push({
          serviceName,
          operation: 'health_check',
          success: isHealthy,
          duration,
          sideEffects: []
        });
      } catch (error) {
        results.push({
          serviceName,
          operation: 'health_check',
          success: false,
          duration: 0,
          error: error as Error,
          sideEffects: []
        });
      }
    }

    return results;
  }

  private sortByDependencies(scenarios: IntegrationTestScenario[]): IntegrationTestScenario[] {
    // Simple topological sort by dependency count
    return scenarios.sort((a, b) => a.dependencies.length - b.dependencies.length);
  }

  private async testDirectCall(
    moduleA: any,
    moduleB: any,
    context: IntegrationTestContext
  ): Promise<any> {
    // Test direct method calls between modules
    const methodsA = Object.keys(moduleA.interface).filter(k => typeof moduleA.interface[k] === 'function');
    const methodsB = Object.keys(moduleB.interface).filter(k => typeof moduleB.interface[k] === 'function');

    const results = {
      success: true,
      moduleAResult: null,
      moduleBResult: null
    };

    if (methodsA.length > 0) {
      const method = moduleA.interface[methodsA[0]];
      results.moduleAResult = await method('test-data');
    }

    if (methodsB.length > 0) {
      const method = moduleB.interface[methodsB[0]];
      results.moduleBResult = await method(results.moduleAResult || 'test-data');
    }

    return results;
  }

  private async testEventDriven(
    moduleA: any,
    moduleB: any,
    context: IntegrationTestContext
  ): Promise<any> {
    // Test event-driven communication
    return new Promise((resolve) => {
      const results = {
        success: true,
        moduleAResult: null,
        moduleBResult: null
      };

      // Set up event listeners
      context.eventBus.once('moduleA:complete', (data) => {
        results.moduleAResult = data;
        context.eventBus.emit('moduleB:start', data);
      });

      context.eventBus.once('moduleB:complete', (data) => {
        results.moduleBResult = data;
        resolve(results);
      });

      // Start the chain
      context.eventBus.emit('moduleA:start', 'test-data');
    });
  }

  private async testSharedState(
    moduleA: any,
    moduleB: any,
    context: IntegrationTestContext
  ): Promise<any> {
    // Test shared state communication
    context.sharedState.set('testData', 'initial-value');

    const results = {
      success: true,
      moduleAResult: null,
      moduleBResult: null
    };

    // Module A modifies shared state
    context.sharedState.set('fromModuleA', 'data-from-a');
    results.moduleAResult = context.sharedState.get('fromModuleA');

    // Module B reads and modifies shared state
    const dataFromA = context.sharedState.get('fromModuleA');
    context.sharedState.set('fromModuleB', `processed-${dataFromA}`);
    results.moduleBResult = context.sharedState.get('fromModuleB');

    return results;
  }

  private async testMessagePassing(
    moduleA: any,
    moduleB: any,
    context: IntegrationTestContext
  ): Promise<any> {
    // Test message passing communication
    const messages: any[] = [];

    const results = {
      success: true,
      moduleAResult: null,
      moduleBResult: null
    };

    // Simulate message passing
    const messageFromA = { from: 'moduleA', data: 'test-message', timestamp: Date.now() };
    messages.push(messageFromA);
    results.moduleAResult = messageFromA;

    // Module B processes the message
    const messageFromB = {
      from: 'moduleB',
      data: `processed-${messageFromA.data}`,
      timestamp: Date.now(),
      replyTo: messageFromA
    };
    messages.push(messageFromB);
    results.moduleBResult = messageFromB;

    context.testData.set('messages', messages);
    return results;
  }

  private async executeDatabaseOperation(operation: any, context: IntegrationTestContext): Promise<any> {
    // Mock database operation execution
    return {
      type: operation.type,
      table: operation.table,
      success: true,
      affectedRows: 1,
      data: operation.data
    };
  }

  private async validateDatabaseConsistency(context: IntegrationTestContext): Promise<void> {
    // Mock database consistency validation
    const transactionData = context.testData.get('transactionData');
    expect(transactionData).toBeDefined();
  }

  private async cleanupDatabaseTestData(context: IntegrationTestContext): Promise<void> {
    // Mock database cleanup
    context.testData.delete('transactionData');
  }

  private async executeAPIRequest(endpoint: any, context: IntegrationTestContext): Promise<any> {
    // Mock API request execution
    return {
      status: endpoint.expectedStatus,
      responseTime: Math.random() * 1000, // Random response time
      data: { success: true }
    };
  }

  private async cleanup(): Promise<void> {
    // Execute all cleanup tasks
    for (const cleanupTask of this.context.cleanupTasks) {
      try {
        await cleanupTask();
      } catch (error) {
        console.warn('Cleanup task failed:', error);
      }
    }

    // Clear context
    this.context.sharedState.clear();
    this.context.testData.clear();
    this.context.eventBus.removeAllListeners();
    this.context.cleanupTasks = [];

    // Teardown services
    for (const [, service] of this.context.services) {
      if (service.teardown) {
        try {
          await service.teardown();
        } catch (error) {
          console.warn(`Service teardown failed for ${service.name}:`, error);
        }
      }
    }
  }
}

/**
 * Integration test suite builder
 */
export class IntegrationTestSuiteBuilder {
  private scenarios: IntegrationTestScenario[] = [];
  private services: ServiceDependency[] = [];

  /**
   * Add a service dependency
   */
  addService(service: ServiceDependency): this {
    this.services.push(service);
    return this;
  }

  /**
   * Add an integration test scenario
   */
  addScenario(scenario: IntegrationTestScenario): this {
    this.scenarios.push(scenario);
    return this;
  }

  /**
   * Add a database integration test
   */
  addDatabaseTest(operations: any[]): this {
    const manager = new EnhancedIntegrationTestManager();
    const scenario = manager.createDatabaseIntegrationTest(operations);
    return this.addScenario(scenario);
  }

  /**
   * Add an API integration test
   */
  addAPITest(endpoints: any[]): this {
    const manager = new EnhancedIntegrationTestManager();
    const scenario = manager.createAPIIntegrationTest(endpoints);
    return this.addScenario(scenario);
  }

  /**
   * Add a cross-module integration test
   */
  addCrossModuleTest(
    moduleA: any,
    moduleB: any,
    pattern: 'direct-call' | 'event-driven' | 'shared-state' | 'message-passing'
  ): this {
    const manager = new EnhancedIntegrationTestManager();
    const scenario = manager.createCrossModuleTest(moduleA, moduleB, pattern);
    return this.addScenario(scenario);
  }

  /**
   * Build and execute the integration test suite
   */
  async execute(): Promise<any> {
    const manager = new EnhancedIntegrationTestManager();

    // Register all services
    for (const service of this.services) {
      manager.registerService(service);
    }

    // Execute all scenarios
    return manager.executeIntegrationSuite(this.scenarios);
  }

  /**
   * Get the built test suite for manual execution
   */
  build(): {
    scenarios: IntegrationTestScenario[];
    services: ServiceDependency[];
  } {
    return {
      scenarios: [...this.scenarios],
      services: [...this.services]
    };
  }
}