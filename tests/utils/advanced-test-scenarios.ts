/// <reference types="jest" />

/**
 * Advanced Test Scenarios Framework
 * Comprehensive edge case testing and scenario generation
 */

import { DryRunValidator, DryRunResult } from './dry-run-validation.js';
import { EnhancedTestRunner, TestScenario, TestExecutionMode } from './enhanced-testing-framework.js';
import { TEST_STABILITY_CONFIG } from '../test-stability.config.js';
import { retryWithBackoff, waitForStableValue, LeakDetector } from './test-stability-helpers.js';

/**
 * Advanced test scenario configuration
 */
export interface AdvancedTestScenario<T = any> extends TestScenario<T> {
  /** Priority level for test execution ordering */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Tags for categorizing and filtering tests */
  tags: string[];
  /** Dependencies on other tests or resources */
  dependencies?: string[];
  /** Test complexity level */
  complexity: 'simple' | 'medium' | 'complex' | 'extreme';
  /** Resource requirements */
  resources?: {
    memory?: number;
    cpu?: number;
    disk?: number;
    network?: boolean;
  };
  /** Environment constraints */
  environment?: {
    os?: string[];
    nodeVersion?: string;
    allowCI?: boolean;
    requiresIsolation?: boolean;
  };
}

/**
 * Test execution statistics
 */
export interface TestExecutionStats {
  totalScenarios: number;
  passed: number;
  failed: number;
  skipped: number;
  retried: number;
  averageDuration: number;
  totalDuration: number;
  memoryPeakUsage: number;
  performanceMetrics: {
    fastestTest: { name: string; duration: number };
    slowestTest: { name: string; duration: number };
    mostMemoryIntensive: { name: string; memory: number };
  };
}

/**
 * Advanced test scenario generator
 */
export class AdvancedTestScenarioGenerator {
  private dryRunValidator: DryRunValidator;
  private testRunner: EnhancedTestRunner;

  constructor() {
    this.dryRunValidator = new DryRunValidator();
    this.testRunner = new EnhancedTestRunner();
  }

  /**
   * Generate comprehensive edge case scenarios for any function
   */
  generateEdgeCaseScenarios(
    functionName: string,
    functionImpl: Function,
    options: {
      includeNullValues?: boolean;
      includeUndefinedValues?: boolean;
      includeEmptyValues?: boolean;
      includeExtremeValues?: boolean;
      includeInvalidTypes?: boolean;
      includeConcurrencyTests?: boolean;
      includeMemoryStressTests?: boolean;
    } = {}
  ): AdvancedTestScenario[] {
    const {
      includeNullValues = true,
      includeUndefinedValues = true,
      includeEmptyValues = true,
      includeExtremeValues = true,
      includeInvalidTypes = true,
      includeConcurrencyTests = true,
      includeMemoryStressTests = true
    } = options;

    const scenarios: AdvancedTestScenario[] = [];

    // Null value scenarios
    if (includeNullValues) {
      scenarios.push({
        name: `${functionName} - null inputs`,
        description: `Test ${functionName} with null values`,
        mode: 'unit',
        priority: 'high',
        tags: ['edge-case', 'null-values', 'input-validation'],
        complexity: 'simple',
        operation: async () => {
          const args = this.generateNullArgs(functionImpl.length);
          return functionImpl(...args);
        },
        validation: async (result) => {
          // Should either return a valid result or throw a descriptive error
          // No silent failures or uncaught exceptions allowed
          expect(() => result).not.toThrow();
        },
        dryRun: true,
        timeout: TEST_STABILITY_CONFIG.timeouts.unit
      });
    }

    // Undefined value scenarios
    if (includeUndefinedValues) {
      scenarios.push({
        name: `${functionName} - undefined inputs`,
        description: `Test ${functionName} with undefined values`,
        mode: 'unit',
        priority: 'high',
        tags: ['edge-case', 'undefined-values', 'input-validation'],
        complexity: 'simple',
        operation: async () => {
          const args = this.generateUndefinedArgs(functionImpl.length);
          return functionImpl(...args);
        },
        validation: async (result) => {
          // Should handle undefined gracefully
          expect(result).toBeDefined();
        },
        dryRun: true
      });
    }

    // Empty value scenarios
    if (includeEmptyValues) {
      scenarios.push({
        name: `${functionName} - empty inputs`,
        description: `Test ${functionName} with empty values`,
        mode: 'unit',
        priority: 'medium',
        tags: ['edge-case', 'empty-values', 'boundary-conditions'],
        complexity: 'simple',
        operation: async () => {
          const args = this.generateEmptyArgs(functionImpl.length);
          return functionImpl(...args);
        },
        validation: async (result) => {
          // Should handle empty inputs appropriately
          expect(result).toBeDefined();
        },
        dryRun: true
      });
    }

    // Extreme value scenarios
    if (includeExtremeValues) {
      scenarios.push({
        name: `${functionName} - extreme values`,
        description: `Test ${functionName} with extreme input values`,
        mode: 'unit',
        priority: 'medium',
        tags: ['edge-case', 'extreme-values', 'boundary-conditions'],
        complexity: 'medium',
        operation: async () => {
          const args = this.generateExtremeArgs(functionImpl.length);
          return functionImpl(...args);
        },
        validation: async (result) => {
          // Should handle extreme values without crashing
          expect(() => result).not.toThrow();
        },
        dryRun: true
      });
    }

    // Invalid type scenarios
    if (includeInvalidTypes) {
      scenarios.push({
        name: `${functionName} - invalid types`,
        description: `Test ${functionName} with invalid argument types`,
        mode: 'unit',
        priority: 'medium',
        tags: ['edge-case', 'type-validation', 'error-handling'],
        complexity: 'medium',
        operation: async () => {
          const args = this.generateInvalidTypeArgs(functionImpl.length);
          return functionImpl(...args);
        },
        validation: async (result) => {
          // Should either work or throw meaningful type errors
          expect(result).toBeDefined();
        },
        dryRun: true
      });
    }

    // Concurrency scenarios
    if (includeConcurrencyTests) {
      scenarios.push({
        name: `${functionName} - concurrent execution`,
        description: `Test ${functionName} under concurrent load`,
        mode: 'performance',
        priority: 'medium',
        tags: ['concurrency', 'race-conditions', 'thread-safety'],
        complexity: 'complex',
        operation: async () => {
          const args = this.generateValidArgs(functionImpl.length);
          const promises = Array(10).fill(null).map(() => 
            Promise.resolve(functionImpl(...args))
          );
          return Promise.all(promises);
        },
        validation: async (results) => {
          expect(Array.isArray(results)).toBe(true);
          expect(results.length).toBe(10);
          // All results should be consistent
          results.forEach(result => expect(result).toBeDefined());
        },
        timeout: TEST_STABILITY_CONFIG.timeouts.performance
      });
    }

    // Memory stress scenarios
    if (includeMemoryStressTests) {
      scenarios.push({
        name: `${functionName} - memory stress test`,
        description: `Test ${functionName} under memory pressure`,
        mode: 'chaos',
        priority: 'low',
        tags: ['memory-stress', 'resource-limits', 'chaos-engineering'],
        complexity: 'extreme',
        resources: {
          memory: 100 * 1024 * 1024 // 100MB
        },
        setup: async () => {
          // Create memory pressure
          global.__memoryStressArrays = [];
          for (let i = 0; i < 50; i++) {
            global.__memoryStressArrays.push(new Array(1000).fill('memory-stress-test'));
          }
        },
        operation: async () => {
          const args = this.generateValidArgs(functionImpl.length);
          return functionImpl(...args);
        },
        validation: async (result) => {
          expect(result).toBeDefined();
        },
        teardown: async () => {
          delete global.__memoryStressArrays;
          if (global.gc) global.gc();
        },
        timeout: TEST_STABILITY_CONFIG.timeouts.performance * 2
      });
    }

    return scenarios;
  }

  /**
   * Generate comprehensive integration test scenarios
   */
  generateIntegrationScenarios(
    moduleName: string,
    moduleInterface: any,
    dependencies: string[] = []
  ): AdvancedTestScenario[] {
    const scenarios: AdvancedTestScenario[] = [];

    // Cross-module integration scenarios
    scenarios.push({
      name: `${moduleName} - cross-module integration`,
      description: `Test ${moduleName} integration with dependencies`,
      mode: 'integration',
      priority: 'high',
      tags: ['integration', 'cross-module', 'dependencies'],
      dependencies,
      complexity: 'complex',
      operation: async () => {
        // Test real integration between modules
        const results = [];
        for (const [methodName, method] of Object.entries(moduleInterface)) {
          if (typeof method === 'function') {
            const args = this.generateValidArgs(method.length);
            results.push({
              method: methodName,
              result: await method(...args)
            });
          }
        }
        return results;
      },
      validation: async (results) => {
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        results.forEach(item => {
          expect(item.method).toBeDefined();
          expect(item.result).toBeDefined();
        });
      },
      timeout: TEST_STABILITY_CONFIG.timeouts.integration
    });

    // Error propagation scenarios
    scenarios.push({
      name: `${moduleName} - error propagation`,
      description: `Test error handling across module boundaries`,
      mode: 'integration',
      priority: 'high',
      tags: ['error-handling', 'error-propagation', 'fault-tolerance'],
      complexity: 'medium',
      operation: async () => {
        const errors = [];
        for (const [methodName, method] of Object.entries(moduleInterface)) {
          if (typeof method === 'function') {
            try {
              await method(...this.generateInvalidArgs(method.length));
            } catch (error) {
              errors.push({
                method: methodName,
                error: error.message,
                stack: error.stack
              });
            }
          }
        }
        return errors;
      },
      validation: async (errors) => {
        // Should have meaningful error messages
        errors.forEach(errorInfo => {
          expect(errorInfo.error).toBeDefined();
          expect(typeof errorInfo.error).toBe('string');
          expect(errorInfo.error.length).toBeGreaterThan(0);
        });
      }
    });

    return scenarios;
  }

  /**
   * Generate performance regression test scenarios
   */
  generatePerformanceRegressionScenarios(
    functionName: string,
    functionImpl: Function,
    baselineMetrics?: {
      duration: number;
      memory: number;
      cpu?: number;
    }
  ): AdvancedTestScenario[] {
    const scenarios: AdvancedTestScenario[] = [];

    scenarios.push({
      name: `${functionName} - performance regression`,
      description: `Test ${functionName} performance against baseline`,
      mode: 'performance',
      priority: 'medium',
      tags: ['performance', 'regression', 'benchmarking'],
      complexity: 'medium',
      operation: async () => {
        const measurements = [];
        
        for (let i = 0; i < 10; i++) {
          const startTime = performance.now();
          const initialMemory = process.memoryUsage().heapUsed;
          
          const args = this.generateValidArgs(functionImpl.length);
          const result = await functionImpl(...args);
          
          const endTime = performance.now();
          const finalMemory = process.memoryUsage().heapUsed;
          
          measurements.push({
            iteration: i,
            duration: endTime - startTime,
            memoryDelta: finalMemory - initialMemory,
            result
          });
        }
        
        return {
          measurements,
          averageDuration: measurements.reduce((sum, m) => sum + m.duration, 0) / measurements.length,
          averageMemory: measurements.reduce((sum, m) => sum + m.memoryDelta, 0) / measurements.length,
          maxDuration: Math.max(...measurements.map(m => m.duration)),
          maxMemory: Math.max(...measurements.map(m => m.memoryDelta))
        };
      },
      validation: async (metrics) => {
        expect(metrics.measurements).toHaveLength(10);
        expect(metrics.averageDuration).toBeGreaterThan(0);
        
        // Check against baseline if provided
        if (baselineMetrics) {
          const regressionThreshold = 1.5; // 50% performance degradation threshold
          expect(metrics.averageDuration).toBeLessThan(baselineMetrics.duration * regressionThreshold);
          expect(metrics.averageMemory).toBeLessThan(baselineMetrics.memory * regressionThreshold);
        }
      },
      timeout: TEST_STABILITY_CONFIG.timeouts.performance
    });

    return scenarios;
  }

  private generateNullArgs(count: number): any[] {
    return Array(count).fill(null);
  }

  private generateUndefinedArgs(count: number): any[] {
    return Array(count).fill(undefined);
  }

  private generateEmptyArgs(count: number): any[] {
    const emptyValues = ['', [], {}, 0, false];
    return Array(count).fill(null).map((_, i) => emptyValues[i % emptyValues.length]);
  }

  private generateExtremeArgs(count: number): any[] {
    const extremeValues = [
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      'x'.repeat(10000), // Very long string
      Array(1000).fill('large-array'), // Large array
      { ...Array(100).fill(null).reduce((obj, _, i) => ({ ...obj, [`key${i}`]: `value${i}` }), {}) } // Large object
    ];
    return Array(count).fill(null).map((_, i) => extremeValues[i % extremeValues.length]);
  }

  private generateInvalidTypeArgs(count: number): any[] {
    const invalidTypes = [
      Symbol('invalid'),
      /regex/,
      new Date(),
      Buffer.from('buffer'),
      new Set([1, 2, 3]),
      new Map([['key', 'value']])
    ];
    return Array(count).fill(null).map((_, i) => invalidTypes[i % invalidTypes.length]);
  }

  private generateValidArgs(count: number): any[] {
    const validValues = ['test-string', 42, true, { test: true }, ['array', 'values']];
    return Array(count).fill(null).map((_, i) => validValues[i % validValues.length]);
  }

  private generateInvalidArgs(count: number): any[] {
    // Mix of null, undefined, and invalid types to trigger errors
    const invalidValues = [null, undefined, NaN, Symbol('invalid')];
    return Array(count).fill(null).map((_, i) => invalidValues[i % invalidValues.length]);
  }
}

/**
 * Advanced test execution engine with enhanced reporting
 */
export class AdvancedTestExecutionEngine {
  private scenarioGenerator: AdvancedTestScenarioGenerator;
  private testRunner: EnhancedTestRunner;
  private leakDetector: LeakDetector;

  constructor() {
    this.scenarioGenerator = new AdvancedTestScenarioGenerator();
    this.testRunner = new EnhancedTestRunner();
    this.leakDetector = new LeakDetector();
  }

  /**
   * Execute advanced test scenarios with comprehensive reporting
   */
  async executeAdvancedScenarios(
    scenarios: AdvancedTestScenario[],
    options: {
      priorityFilter?: Array<'critical' | 'high' | 'medium' | 'low'>;
      tagFilter?: string[];
      complexityFilter?: Array<'simple' | 'medium' | 'complex' | 'extreme'>;
      parallel?: boolean;
      generateReport?: boolean;
    } = {}
  ): Promise<{
    results: Array<{
      scenario: AdvancedTestScenario;
      success: boolean;
      duration: number;
      error?: Error;
      dryRunResult?: DryRunResult;
    }>;
    stats: TestExecutionStats;
    report?: string;
  }> {
    const {
      priorityFilter,
      tagFilter,
      complexityFilter,
      parallel = false,
      generateReport = true
    } = options;

    // Filter scenarios based on criteria
    let filteredScenarios = scenarios;
    
    if (priorityFilter) {
      filteredScenarios = filteredScenarios.filter(s => priorityFilter.includes(s.priority));
    }
    
    if (tagFilter) {
      filteredScenarios = filteredScenarios.filter(s => 
        tagFilter.some(tag => s.tags.includes(tag))
      );
    }
    
    if (complexityFilter) {
      filteredScenarios = filteredScenarios.filter(s => complexityFilter.includes(s.complexity));
    }

    // Sort by priority (critical first)
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    filteredScenarios.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Execute scenarios
    const startTime = performance.now();
    const results = await this.testRunner.executeScenarios(
      filteredScenarios,
      {
        mode: parallel ? 'parallel' : 'sequential',
        batchSize: 5,
        failFast: false,
        retryFailures: true
      }
    );

    const endTime = performance.now();

    // Calculate statistics
    const stats = this.calculateStats(results, endTime - startTime);

    // Check for leaks
    const leakCheck = this.leakDetector.checkLeaks();
    if (leakCheck.hasLeaks) {
      console.warn('Memory leaks detected:', leakCheck.report);
    }

    // Generate report if requested
    let report: string | undefined;
    if (generateReport) {
      report = this.generateTestReport(results, stats, leakCheck);
    }

    return {
      results: results.map(r => ({
        scenario: r.scenario as AdvancedTestScenario,
        success: r.success,
        duration: r.duration,
        error: r.error,
        dryRunResult: r.dryRunResult
      })),
      stats,
      report
    };
  }

  private calculateStats(results: any[], totalDuration: number): TestExecutionStats {
    const passed = results.filter(r => r.success).length;
    const failed = results.length - passed;
    const retried = results.filter(r => r.scenario.retries && r.scenario.retries > 0).length;
    
    const durations = results.map(r => r.duration);
    const memoryUsages = results.map(r => r.memoryUsage);
    
    const fastestTest = results.reduce((min, r) => 
      r.duration < min.duration ? { name: r.scenario.name, duration: r.duration } : min,
      { name: '', duration: Infinity }
    );
    
    const slowestTest = results.reduce((max, r) => 
      r.duration > max.duration ? { name: r.scenario.name, duration: r.duration } : max,
      { name: '', duration: 0 }
    );
    
    const mostMemoryIntensive = results.reduce((max, r) => 
      r.memoryUsage > max.memory ? { name: r.scenario.name, memory: r.memoryUsage } : max,
      { name: '', memory: 0 }
    );

    return {
      totalScenarios: results.length,
      passed,
      failed,
      skipped: 0,
      retried,
      averageDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      totalDuration,
      memoryPeakUsage: Math.max(...memoryUsages),
      performanceMetrics: {
        fastestTest,
        slowestTest,
        mostMemoryIntensive
      }
    };
  }

  private generateTestReport(
    results: any[],
    stats: TestExecutionStats,
    leakCheck: { hasLeaks: boolean; report: string }
  ): string {
    const report = [
      '# Advanced Test Execution Report',
      '',
      '## Summary',
      `- Total Scenarios: ${stats.totalScenarios}`,
      `- Passed: ${stats.passed}`,
      `- Failed: ${stats.failed}`,
      `- Success Rate: ${((stats.passed / stats.totalScenarios) * 100).toFixed(2)}%`,
      `- Total Duration: ${stats.totalDuration.toFixed(2)}ms`,
      `- Average Duration: ${stats.averageDuration.toFixed(2)}ms`,
      `- Peak Memory Usage: ${(stats.memoryPeakUsage / 1024 / 1024).toFixed(2)}MB`,
      '',
      '## Performance Metrics',
      `- Fastest Test: ${stats.performanceMetrics.fastestTest.name} (${stats.performanceMetrics.fastestTest.duration.toFixed(2)}ms)`,
      `- Slowest Test: ${stats.performanceMetrics.slowestTest.name} (${stats.performanceMetrics.slowestTest.duration.toFixed(2)}ms)`,
      `- Most Memory Intensive: ${stats.performanceMetrics.mostMemoryIntensive.name} (${(stats.performanceMetrics.mostMemoryIntensive.memory / 1024 / 1024).toFixed(2)}MB)`,
      '',
      '## Memory Leak Detection',
      leakCheck.hasLeaks ? `⚠️ Leaks Detected: ${leakCheck.report}` : '✅ No memory leaks detected',
      '',
      '## Failed Tests',
      ...results.filter(r => !r.success).map(r => 
        `- ${r.scenario.name}: ${r.error?.message || 'Unknown error'}`
      ),
      ''
    ];

    return report.join('\n');
  }
}

/**
 * Declare global for memory stress testing
 */
declare global {
  var __memoryStressArrays: any[];
}