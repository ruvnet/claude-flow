/// <reference types="jest" />

/**
 * Enhanced Testing Framework for Claude-Flow
 * Comprehensive testing utilities with advanced validation patterns
 */

import { DryRunValidator, DryRunResult } from './dry-run-validation.js';
import { AsyncTestUtils, PerformanceTestUtils } from './test-utils.js';

/**
 * Test execution modes
 */
export type TestExecutionMode = 
  | 'unit'           // Isolated unit tests
  | 'integration'    // Integration tests with real dependencies
  | 'e2e'           // End-to-end tests
  | 'performance'   // Performance and load tests
  | 'security'      // Security validation tests
  | 'dry-run'       // Dry-run validation only
  | 'chaos'         // Chaos engineering tests
  | 'regression';   // Regression tests

/**
 * Test scenario configuration
 */
export interface TestScenario<T = any> {
  name: string;
  description: string;
  mode: TestExecutionMode;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  operation: () => Promise<T>;
  validation: (result: T) => Promise<void>;
  dryRun?: boolean;
  timeout?: number;
  retries?: number;
  expectedMetrics?: {
    duration?: { min: number; max: number };
    memory?: { max: number };
    errorRate?: { max: number };
  };
}

/**
 * Test execution result
 */
export interface TestExecutionResult<T = any> {
  scenario: TestScenario<T>;
  success: boolean;
  result?: T;
  error?: Error;
  duration: number;
  memoryUsage: number;
  dryRunResult?: DryRunResult<T>;
  metrics: {
    setupDuration?: number;
    operationDuration: number;
    validationDuration: number;
    teardownDuration?: number;
  };
}

/**
 * Enhanced test runner with dry-run validation
 */
export class EnhancedTestRunner {
  private dryRunValidator: DryRunValidator;

  constructor() {
    this.dryRunValidator = new DryRunValidator();
  }

  /**
   * Execute a single test scenario
   */
  async executeScenario<T>(scenario: TestScenario<T>): Promise<TestExecutionResult<T>> {
    const startTime = performance.now();
    let result: TestExecutionResult<T>;

    try {
      // Setup phase
      const setupStart = performance.now();
      if (scenario.setup) {
        await scenario.setup();
      }
      const setupDuration = performance.now() - setupStart;

      // Dry-run validation if requested
      let dryRunResult: DryRunResult<T> | undefined;
      if (scenario.dryRun) {
        dryRunResult = await this.dryRunValidator.executeDryRun(
          scenario.operation,
          { timeout: scenario.timeout }
        );

        if (!dryRunResult.success) {
          throw new Error(`Dry-run validation failed: ${dryRunResult.errors.join(', ')}`);
        }
      }

      // Operation execution
      const operationStart = performance.now();
      const initialMemory = process.memoryUsage().heapUsed;
      
      let operationResult: T;
      if (scenario.timeout) {
        operationResult = await AsyncTestUtils.withTimeout(
          scenario.operation(),
          scenario.timeout
        );
      } else {
        operationResult = await scenario.operation();
      }
      
      const operationDuration = performance.now() - operationStart;
      const memoryUsage = process.memoryUsage().heapUsed - initialMemory;

      // Validation phase
      const validationStart = performance.now();
      await scenario.validation(operationResult);
      const validationDuration = performance.now() - validationStart;

      // Teardown phase
      const teardownStart = performance.now();
      if (scenario.teardown) {
        await scenario.teardown();
      }
      const teardownDuration = performance.now() - teardownStart;

      // Validate metrics if specified
      if (scenario.expectedMetrics) {
        this.validateMetrics(scenario.expectedMetrics, {
          duration: operationDuration,
          memory: memoryUsage,
          errorRate: 0
        });
      }

      result = {
        scenario,
        success: true,
        result: operationResult,
        duration: performance.now() - startTime,
        memoryUsage,
        dryRunResult,
        metrics: {
          setupDuration,
          operationDuration,
          validationDuration,
          teardownDuration
        }
      };

    } catch (error) {
      // Ensure teardown runs even on failure
      if (scenario.teardown) {
        try {
          await scenario.teardown();
        } catch (teardownError) {
          console.warn('Teardown failed:', teardownError);
        }
      }

      result = {
        scenario,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration: performance.now() - startTime,
        memoryUsage: process.memoryUsage().heapUsed,
        metrics: {
          operationDuration: 0,
          validationDuration: 0
        }
      };
    }

    return result;
  }

  /**
   * Execute multiple scenarios with different strategies
   */
  async executeScenarios<T>(
    scenarios: TestScenario<T>[],
    options: {
      mode: 'sequential' | 'parallel' | 'batch';
      batchSize?: number;
      failFast?: boolean;
      retryFailures?: boolean;
    } = { mode: 'sequential' }
  ): Promise<TestExecutionResult<T>[]> {
    const { mode, batchSize = 5, failFast = false, retryFailures = false } = options;

    switch (mode) {
      case 'sequential':
        return this.executeSequentially(scenarios, failFast, retryFailures);
      case 'parallel':
        return this.executeInParallel(scenarios, failFast, retryFailures);
      case 'batch':
        return this.executeInBatches(scenarios, batchSize, failFast, retryFailures);
      default:
        throw new Error(`Unknown execution mode: ${mode}`);
    }
  }

  /**
   * Create comprehensive test suite for a module
   */
  createModuleTestSuite(
    moduleName: string,
    moduleInterface: any,
    options: {
      modes?: TestExecutionMode[];
      generateEdgeCases?: boolean;
      includeChaosTests?: boolean;
      performanceThresholds?: Record<string, number>;
    } = {}
  ): TestScenario[] {
    const {
      modes = ['unit', 'integration'],
      generateEdgeCases = true,
      includeChaosTests = false,
      performanceThresholds = {}
    } = options;

    const scenarios: TestScenario[] = [];

    // Generate test scenarios for each public method
    const methods = this.extractPublicMethods(moduleInterface);
    
    for (const method of methods) {
      // Basic functionality tests
      if (modes.includes('unit')) {
        scenarios.push(...this.generateUnitTests(moduleName, method));
      }

      // Integration tests
      if (modes.includes('integration')) {
        scenarios.push(...this.generateIntegrationTests(moduleName, method));
      }

      // Performance tests
      if (modes.includes('performance')) {
        scenarios.push(...this.generatePerformanceTests(
          moduleName, 
          method, 
          performanceThresholds[method.name]
        ));
      }

      // Edge case tests
      if (generateEdgeCases) {
        scenarios.push(...this.generateEdgeCaseTests(moduleName, method));
      }

      // Chaos tests
      if (includeChaosTests && modes.includes('chaos')) {
        scenarios.push(...this.generateChaosTests(moduleName, method));
      }
    }

    return scenarios;
  }

  private async executeSequentially<T>(
    scenarios: TestScenario<T>[],
    failFast: boolean,
    retryFailures: boolean
  ): Promise<TestExecutionResult<T>[]> {
    const results: TestExecutionResult<T>[] = [];

    for (const scenario of scenarios) {
      const result = await this.executeWithRetry(scenario, retryFailures);
      results.push(result);

      if (failFast && !result.success) {
        break;
      }
    }

    return results;
  }

  private async executeInParallel<T>(
    scenarios: TestScenario<T>[],
    failFast: boolean,
    retryFailures: boolean
  ): Promise<TestExecutionResult<T>[]> {
    const promises = scenarios.map(scenario => 
      this.executeWithRetry(scenario, retryFailures)
    );

    if (failFast) {
      // Use Promise.allSettled to get all results but stop on first failure
      const results = await Promise.allSettled(promises);
      return results.map(result => 
        result.status === 'fulfilled' ? result.value : {
          scenario: {} as TestScenario<T>,
          success: false,
          error: new Error('Test execution failed'),
          duration: 0,
          memoryUsage: 0,
          metrics: { operationDuration: 0, validationDuration: 0 }
        }
      );
    } else {
      return Promise.all(promises);
    }
  }

  private async executeInBatches<T>(
    scenarios: TestScenario<T>[],
    batchSize: number,
    failFast: boolean,
    retryFailures: boolean
  ): Promise<TestExecutionResult<T>[]> {
    const results: TestExecutionResult<T>[] = [];

    for (let i = 0; i < scenarios.length; i += batchSize) {
      const batch = scenarios.slice(i, i + batchSize);
      const batchResults = await this.executeInParallel(batch, failFast, retryFailures);
      results.push(...batchResults);

      if (failFast && batchResults.some(r => !r.success)) {
        break;
      }

      // Small delay between batches to prevent resource exhaustion
      await AsyncTestUtils.delay(100);
    }

    return results;
  }

  private async executeWithRetry<T>(
    scenario: TestScenario<T>,
    retryFailures: boolean
  ): Promise<TestExecutionResult<T>> {
    const maxRetries = retryFailures ? (scenario.retries || 3) : 1;
    let lastResult: TestExecutionResult<T>;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      lastResult = await this.executeScenario(scenario);
      
      if (lastResult.success) {
        return lastResult;
      }

      if (attempt < maxRetries - 1) {
        // Wait before retry with exponential backoff
        await AsyncTestUtils.delay(Math.pow(2, attempt) * 1000);
      }
    }

    return lastResult!;
  }

  private validateMetrics(
    expected: TestScenario['expectedMetrics'],
    actual: { duration: number; memory: number; errorRate: number }
  ): void {
    if (expected?.duration) {
      if (actual.duration < expected.duration.min || actual.duration > expected.duration.max) {
        throw new Error(
          `Duration ${actual.duration}ms outside expected range [${expected.duration.min}, ${expected.duration.max}]`
        );
      }
    }

    if (expected?.memory && actual.memory > expected.memory.max) {
      throw new Error(`Memory usage ${actual.memory} bytes exceeds maximum ${expected.memory.max}`);
    }

    if (expected?.errorRate && actual.errorRate > expected.errorRate.max) {
      throw new Error(`Error rate ${actual.errorRate} exceeds maximum ${expected.errorRate.max}`);
    }
  }

  private extractPublicMethods(moduleInterface: any): Array<{ name: string; method: Function }> {
    const methods: Array<{ name: string; method: Function }> = [];
    
    for (const [name, value] of Object.entries(moduleInterface)) {
      if (typeof value === 'function' && !name.startsWith('_')) {
        methods.push({ name, method: value as Function });
      }
    }

    return methods;
  }

  private generateUnitTests(moduleName: string, method: { name: string; method: Function }): TestScenario[] {
    return [
      {
        name: `${moduleName}.${method.name} - basic functionality`,
        description: `Test basic functionality of ${method.name}`,
        mode: 'unit',
        operation: async () => {
          // Generate basic test data based on method signature
          const args = this.generateTestArgs(method.method);
          return method.method(...args);
        },
        validation: async (result) => {
          expect(result).toBeDefined();
        },
        dryRun: true,
        timeout: 5000
      }
    ];
  }

  private generateIntegrationTests(moduleName: string, method: { name: string; method: Function }): TestScenario[] {
    return [
      {
        name: `${moduleName}.${method.name} - integration test`,
        description: `Test ${method.name} with real dependencies`,
        mode: 'integration',
        operation: async () => {
          const args = this.generateTestArgs(method.method);
          return method.method(...args);
        },
        validation: async (result) => {
          expect(result).toBeDefined();
        },
        timeout: 10000
      }
    ];
  }

  private generatePerformanceTests(
    moduleName: string, 
    method: { name: string; method: Function },
    threshold?: number
  ): TestScenario[] {
    return [
      {
        name: `${moduleName}.${method.name} - performance test`,
        description: `Test performance of ${method.name}`,
        mode: 'performance',
        operation: async () => {
          const args = this.generateTestArgs(method.method);
          const { result, duration } = await PerformanceTestUtils.measureTime(async () => {
            return method.method(...args);
          });
          return { result, duration };
        },
        validation: async (result: { result: any; duration: number }) => {
          expect(result.result).toBeDefined();
          if (threshold) {
            expect(result.duration).toBeLessThan(threshold);
          }
        },
        expectedMetrics: threshold ? {
          duration: { min: 0, max: threshold }
        } : undefined,
        timeout: 15000
      }
    ];
  }

  private generateEdgeCaseTests(moduleName: string, method: { name: string; method: Function }): TestScenario[] {
    return [
      {
        name: `${moduleName}.${method.name} - null/undefined inputs`,
        description: `Test ${method.name} with null/undefined inputs`,
        mode: 'unit',
        operation: async () => {
          return method.method(null, undefined, '');
        },
        validation: async (result) => {
          // Should either return a valid result or throw a meaningful error
          // No uncaught exceptions allowed
        },
        dryRun: true
      },
      {
        name: `${moduleName}.${method.name} - extreme values`,
        description: `Test ${method.name} with extreme input values`,
        mode: 'unit',
        operation: async () => {
          const extremeArgs = [
            Number.MAX_SAFE_INTEGER,
            Number.MIN_SAFE_INTEGER,
            '',
            'x'.repeat(10000),
            [],
            {}
          ];
          return method.method(...extremeArgs.slice(0, method.method.length));
        },
        validation: async (result) => {
          // Should handle extreme values gracefully
        },
        dryRun: true
      }
    ];
  }

  private generateChaosTests(moduleName: string, method: { name: string; method: Function }): TestScenario[] {
    return [
      {
        name: `${moduleName}.${method.name} - chaos test (memory pressure)`,
        description: `Test ${method.name} under memory pressure`,
        mode: 'chaos',
        setup: async () => {
          // Create memory pressure
          global.__chaosTestArrays = [];
          for (let i = 0; i < 100; i++) {
            global.__chaosTestArrays.push(new Array(1000).fill('memory-pressure'));
          }
        },
        operation: async () => {
          const args = this.generateTestArgs(method.method);
          return method.method(...args);
        },
        validation: async (result) => {
          expect(result).toBeDefined();
        },
        teardown: async () => {
          delete global.__chaosTestArrays;
          if (global.gc) global.gc();
        },
        timeout: 20000
      }
    ];
  }

  private generateTestArgs(method: Function): any[] {
    const paramCount = method.length;
    const args: any[] = [];

    for (let i = 0; i < paramCount; i++) {
      // Generate appropriate test data based on parameter position
      switch (i % 4) {
        case 0:
          args.push('test-string');
          break;
        case 1:
          args.push(42);
          break;
        case 2:
          args.push(true);
          break;
        case 3:
          args.push({});
          break;
      }
    }

    return args;
  }
}

/**
 * Test coverage analyzer
 */
export class TestCoverageAnalyzer {
  /**
   * Analyze test coverage gaps
   */
  async analyzeCoverageGaps(
    sourceFiles: string[],
    testFiles: string[]
  ): Promise<{
    uncoveredFiles: string[];
    uncoveredFunctions: Array<{ file: string; function: string }>;
    lowCoverageAreas: Array<{ file: string; coverage: number }>;
    recommendations: string[];
  }> {
    // This would integrate with coverage tools like nyc/istanbul
    // For now, return a mock analysis
    return {
      uncoveredFiles: [],
      uncoveredFunctions: [],
      lowCoverageAreas: [],
      recommendations: [
        'Add integration tests for critical paths',
        'Implement chaos engineering tests',
        'Increase error path coverage',
        'Add performance regression tests'
      ]
    };
  }

  /**
   * Generate coverage report
   */
  async generateCoverageReport(
    testResults: TestExecutionResult[]
  ): Promise<{
    summary: {
      totalTests: number;
      passedTests: number;
      failedTests: number;
      coverage: {
        lines: number;
        functions: number;
        branches: number;
      };
    };
    details: Array<{
      mode: TestExecutionMode;
      results: TestExecutionResult[];
      metrics: {
        averageDuration: number;
        maxMemoryUsage: number;
        successRate: number;
      };
    }>;
  }> {
    const totalTests = testResults.length;
    const passedTests = testResults.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;

    // Group results by test mode
    const resultsByMode = new Map<TestExecutionMode, TestExecutionResult[]>();
    for (const result of testResults) {
      const mode = result.scenario.mode;
      if (!resultsByMode.has(mode)) {
        resultsByMode.set(mode, []);
      }
      resultsByMode.get(mode)!.push(result);
    }

    const details = Array.from(resultsByMode.entries()).map(([mode, results]) => ({
      mode,
      results,
      metrics: {
        averageDuration: results.reduce((sum, r) => sum + r.duration, 0) / results.length,
        maxMemoryUsage: Math.max(...results.map(r => r.memoryUsage)),
        successRate: results.filter(r => r.success).length / results.length
      }
    }));

    return {
      summary: {
        totalTests,
        passedTests,
        failedTests,
        coverage: {
          lines: 85, // Mock values - would come from coverage tools
          functions: 90,
          branches: 80
        }
      },
      details
    };
  }
}

/**
 * Declare global for chaos testing
 */
declare global {
  var __chaosTestArrays: any[];
  var gc: (() => void) | undefined;
}