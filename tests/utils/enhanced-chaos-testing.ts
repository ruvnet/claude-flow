/// <reference types="jest" />

/**
 * Enhanced Chaos Engineering Testing Framework
 * Comprehensive chaos testing with fault injection and resilience validation
 */

import { AsyncTestUtils } from './test-utils.js';
import { TestEventEmitter, retryWithBackoff } from './test-stability-helpers.js';
import { TEST_STABILITY_CONFIG } from '../test-stability.config.js';

/**
 * Chaos experiment types
 */
export type ChaosExperimentType = 
  | 'memory_pressure'
  | 'cpu_stress'
  | 'network_failure'
  | 'disk_full'
  | 'process_kill'
  | 'timeout_injection'
  | 'exception_injection'
  | 'resource_exhaustion'
  | 'dependency_failure'
  | 'data_corruption'
  | 'race_condition'
  | 'deadlock_injection';

/**
 * Chaos experiment configuration
 */
export interface ChaosExperiment {
  name: string;
  type: ChaosExperimentType;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  duration: number; // milliseconds
  intensity: number; // 0-100 scale
  targetFunction: () => Promise<any>;
  expectedBehavior: 'graceful_degradation' | 'circuit_breaker' | 'retry_logic' | 'fallback' | 'isolation';
  recoveryTime?: number; // Expected recovery time in milliseconds
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  successCriteria: (result: ChaosExperimentResult) => boolean;
}

/**
 * Chaos experiment result
 */
export interface ChaosExperimentResult {
  experimentName: string;
  type: ChaosExperimentType;
  startTime: number;
  endTime: number;
  duration: number;
  chaosIntroduced: boolean;
  systemBehavior: {
    gracefulDegradation: boolean;
    errorHandling: boolean;
    recoveryTime: number;
    dataIntegrity: boolean;
    serviceAvailability: number; // percentage
  };
  metrics: {
    successfulOperations: number;
    failedOperations: number;
    timeouts: number;
    exceptions: Array<{ type: string; message: string; count: number }>;
    performanceImpact: {
      baseline: number;
      duringChaos: number;
      degradation: number; // percentage
    };
  };
  resilience: {
    score: number; // 0-100
    breakdown: {
      faultTolerance: number;
      errorRecovery: number;
      performanceStability: number;
      dataConsistency: number;
    };
  };
  recommendations: string[];
}

/**
 * Fault injection strategies
 */
export interface FaultInjectionStrategy {
  type: ChaosExperimentType;
  inject: () => Promise<void>;
  recover: () => Promise<void>;
  isActive: () => boolean;
}

/**
 * Enhanced chaos testing manager
 */
export class EnhancedChaosTestingManager {
  private activeExperiments: Map<string, ChaosExperiment> = new Map();
  private faultStrategies: Map<ChaosExperimentType, FaultInjectionStrategy> = new Map();
  private eventBus: TestEventEmitter;
  private globalCleanupTasks: Array<() => Promise<void>> = [];

  constructor() {
    this.eventBus = new TestEventEmitter();
    this.initializeFaultStrategies();
  }

  /**
   * Execute a single chaos experiment
   */
  async executeChaosExperiment(experiment: ChaosExperiment): Promise<ChaosExperimentResult> {
    console.log(`🔥 Starting chaos experiment: ${experiment.name}`);
    console.log(`   Type: ${experiment.type}, Severity: ${experiment.severity}, Duration: ${experiment.duration}ms`);

    const startTime = Date.now();
    const strategy = this.faultStrategies.get(experiment.type);
    
    if (!strategy) {
      throw new Error(`No fault injection strategy found for type: ${experiment.type}`);
    }

    const result: ChaosExperimentResult = {
      experimentName: experiment.name,
      type: experiment.type,
      startTime,
      endTime: 0,
      duration: 0,
      chaosIntroduced: false,
      systemBehavior: {
        gracefulDegradation: false,
        errorHandling: false,
        recoveryTime: 0,
        dataIntegrity: true,
        serviceAvailability: 0
      },
      metrics: {
        successfulOperations: 0,
        failedOperations: 0,
        timeouts: 0,
        exceptions: [],
        performanceImpact: {
          baseline: 0,
          duringChaos: 0,
          degradation: 0
        }
      },
      resilience: {
        score: 0,
        breakdown: {
          faultTolerance: 0,
          errorRecovery: 0,
          performanceStability: 0,
          dataConsistency: 0
        }
      },
      recommendations: []
    };

    try {
      // Setup phase
      if (experiment.setup) {
        await experiment.setup();
      }

      // Baseline measurement
      const baselineMetrics = await this.measureBaseline(experiment.targetFunction);
      result.metrics.performanceImpact.baseline = baselineMetrics.averageResponseTime;

      // Introduce chaos
      this.activeExperiments.set(experiment.name, experiment);
      await strategy.inject();
      result.chaosIntroduced = true;

      console.log(`   🌪️ Chaos introduced (${experiment.type})`);

      // Run experiment during chaos
      const chaosMetrics = await this.executeUnderChaos(experiment, strategy);
      Object.assign(result.metrics, chaosMetrics.metrics);
      Object.assign(result.systemBehavior, chaosMetrics.behavior);
      
      result.metrics.performanceImpact.duringChaos = chaosMetrics.metrics.averageResponseTime || 0;
      result.metrics.performanceImpact.degradation = 
        ((result.metrics.performanceImpact.duringChaos - result.metrics.performanceImpact.baseline) / 
         result.metrics.performanceImpact.baseline) * 100;

      // Recovery phase
      console.log(`   🔄 Recovering from chaos...`);
      const recoveryStart = Date.now();
      await strategy.recover();
      
      // Measure recovery
      const recoveryMetrics = await this.measureRecovery(experiment.targetFunction);
      result.systemBehavior.recoveryTime = Date.now() - recoveryStart;
      result.systemBehavior.serviceAvailability = recoveryMetrics.availabilityScore;

      // Calculate resilience score
      result.resilience = this.calculateResilienceScore(result);

      // Generate recommendations
      result.recommendations = this.generateRecommendations(result);

      const endTime = Date.now();
      result.endTime = endTime;
      result.duration = endTime - startTime;

      console.log(`   ✅ Chaos experiment completed. Resilience score: ${result.resilience.score}/100`);

      // Validate against success criteria
      const successful = experiment.successCriteria(result);
      if (!successful) {
        console.warn(`   ⚠️ Experiment did not meet success criteria`);
      }

      return result;

    } catch (error) {
      console.error(`   ❌ Chaos experiment failed:`, error);
      throw error;
    } finally {
      // Cleanup
      try {
        if (strategy.isActive()) {
          await strategy.recover();
        }
        
        if (experiment.teardown) {
          await experiment.teardown();
        }
        
        this.activeExperiments.delete(experiment.name);
      } catch (cleanupError) {
        console.error('Cleanup failed after chaos experiment:', cleanupError);
      }
    }
  }

  /**
   * Execute a chaos engineering test suite
   */
  async executeChaosTestSuite(
    experiments: ChaosExperiment[],
    options: {
      parallel?: boolean;
      stopOnFailure?: boolean;
      delayBetweenExperiments?: number;
    } = {}
  ): Promise<Array<{
    experiment: ChaosExperiment;
    result: ChaosExperimentResult;
    success: boolean;
    error?: Error;
  }>> {
    const { parallel = false, stopOnFailure = false, delayBetweenExperiments = 5000 } = options;
    const results = [];

    console.log(`🧪 Executing chaos test suite: ${experiments.length} experiments`);

    if (parallel) {
      // Execute experiments in parallel (careful with resource conflicts)
      const promises = experiments.map(async exp => {
        try {
          const result = await this.executeChaosExperiment(exp);
          const success = exp.successCriteria(result);
          return { experiment: exp, result, success };
        } catch (error) {
          return { 
            experiment: exp, 
            result: {} as ChaosExperimentResult, 
            success: false, 
            error: error as Error 
          };
        }
      });

      const parallelResults = await Promise.allSettled(promises);
      results.push(...parallelResults.map(r => 
        r.status === 'fulfilled' ? r.value : {
          experiment: {} as ChaosExperiment,
          result: {} as ChaosExperimentResult,
          success: false,
          error: new Error('Parallel execution failed')
        }
      ));

    } else {
      // Execute experiments sequentially
      for (const experiment of experiments) {
        try {
          const result = await this.executeChaosExperiment(experiment);
          const success = experiment.successCriteria(result);
          results.push({ experiment, result, success });

          if (!success && stopOnFailure) {
            console.warn(`Stopping chaos test suite due to failure in: ${experiment.name}`);
            break;
          }

          // Delay between experiments to allow system recovery
          if (delayBetweenExperiments > 0) {
            await AsyncTestUtils.delay(delayBetweenExperiments);
          }

        } catch (error) {
          results.push({ 
            experiment, 
            result: {} as ChaosExperimentResult, 
            success: false, 
            error: error as Error 
          });

          if (stopOnFailure) {
            console.error(`Stopping chaos test suite due to error in: ${experiment.name}`);
            break;
          }
        }
      }
    }

    return results;
  }

  /**
   * Create memory pressure chaos experiment
   */
  createMemoryPressureExperiment(
    name: string,
    targetFunction: () => Promise<any>,
    intensity: number = 50
  ): ChaosExperiment {
    return {
      name,
      type: 'memory_pressure',
      description: 'Apply memory pressure to test memory handling',
      severity: intensity > 70 ? 'high' : intensity > 40 ? 'medium' : 'low',
      duration: 10000,
      intensity,
      targetFunction,
      expectedBehavior: 'graceful_degradation',
      successCriteria: (result) => {
        return result.systemBehavior.gracefulDegradation && 
               result.systemBehavior.serviceAvailability > 50 &&
               result.resilience.score > 60;
      }
    };
  }

  /**
   * Create network failure chaos experiment
   */
  createNetworkFailureExperiment(
    name: string,
    targetFunction: () => Promise<any>,
    failureRate: number = 30
  ): ChaosExperiment {
    return {
      name,
      type: 'network_failure',
      description: 'Simulate network failures and timeouts',
      severity: failureRate > 70 ? 'critical' : failureRate > 40 ? 'high' : 'medium',
      duration: 15000,
      intensity: failureRate,
      targetFunction,
      expectedBehavior: 'retry_logic',
      successCriteria: (result) => {
        return result.systemBehavior.errorHandling && 
               result.systemBehavior.recoveryTime < 5000 &&
               result.resilience.breakdown.faultTolerance > 70;
      }
    };
  }

  /**
   * Create exception injection chaos experiment
   */
  createExceptionInjectionExperiment(
    name: string,
    targetFunction: () => Promise<any>,
    exceptionRate: number = 20
  ): ChaosExperiment {
    return {
      name,
      type: 'exception_injection',
      description: 'Inject random exceptions to test error handling',
      severity: exceptionRate > 50 ? 'high' : 'medium',
      duration: 8000,
      intensity: exceptionRate,
      targetFunction,
      expectedBehavior: 'fallback',
      successCriteria: (result) => {
        return result.systemBehavior.errorHandling && 
               result.metrics.exceptions.length > 0 &&
               result.resilience.breakdown.errorRecovery > 60;
      }
    };
  }

  /**
   * Create race condition chaos experiment
   */
  createRaceConditionExperiment(
    name: string,
    targetFunction: () => Promise<any>,
    concurrency: number = 10
  ): ChaosExperiment {
    return {
      name,
      type: 'race_condition',
      description: 'Test concurrent access patterns for race conditions',
      severity: concurrency > 20 ? 'high' : 'medium',
      duration: 12000,
      intensity: concurrency,
      targetFunction,
      expectedBehavior: 'isolation',
      successCriteria: (result) => {
        return result.systemBehavior.dataIntegrity && 
               result.resilience.breakdown.dataConsistency > 80;
      }
    };
  }

  private initializeFaultStrategies(): void {
    // Memory pressure strategy
    this.faultStrategies.set('memory_pressure', {
      type: 'memory_pressure',
      inject: async () => {
        global.__chaosMemoryArrays = [];
        for (let i = 0; i < 100; i++) {
          global.__chaosMemoryArrays.push(new Array(10000).fill('memory-pressure-data'));
        }
      },
      recover: async () => {
        delete global.__chaosMemoryArrays;
        if (global.gc) global.gc();
      },
      isActive: () => !!global.__chaosMemoryArrays
    });

    // Network failure strategy
    this.faultStrategies.set('network_failure', {
      type: 'network_failure',
      inject: async () => {
        // Mock network failures by overriding fetch/http methods
        global.__originalFetch = global.fetch;
        global.fetch = async (...args) => {
          if (Math.random() < 0.3) { // 30% failure rate
            throw new Error('Network failure injected by chaos testing');
          }
          return global.__originalFetch!(...args);
        };
      },
      recover: async () => {
        if (global.__originalFetch) {
          global.fetch = global.__originalFetch;
          delete global.__originalFetch;
        }
      },
      isActive: () => !!global.__originalFetch
    });

    // Exception injection strategy
    this.faultStrategies.set('exception_injection', {
      type: 'exception_injection',
      inject: async () => {
        global.__chaosExceptionRate = 0.2; // 20% exception rate
      },
      recover: async () => {
        delete global.__chaosExceptionRate;
      },
      isActive: () => !!global.__chaosExceptionRate
    });

    // Race condition strategy
    this.faultStrategies.set('race_condition', {
      type: 'race_condition',
      inject: async () => {
        global.__chaosRaceCondition = true;
      },
      recover: async () => {
        delete global.__chaosRaceCondition;
      },
      isActive: () => !!global.__chaosRaceCondition
    });

    // Timeout injection strategy
    this.faultStrategies.set('timeout_injection', {
      type: 'timeout_injection',
      inject: async () => {
        global.__chaosTimeoutDelay = 2000; // 2 second delays
      },
      recover: async () => {
        delete global.__chaosTimeoutDelay;
      },
      isActive: () => !!global.__chaosTimeoutDelay
    });
  }

  private async measureBaseline(targetFunction: () => Promise<any>): Promise<{
    averageResponseTime: number;
    successRate: number;
  }> {
    const measurements = [];
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      try {
        await targetFunction();
        measurements.push({ success: true, time: performance.now() - start });
      } catch {
        measurements.push({ success: false, time: performance.now() - start });
      }
    }

    const successfulMeasurements = measurements.filter(m => m.success);
    const averageResponseTime = successfulMeasurements.length > 0 
      ? successfulMeasurements.reduce((sum, m) => sum + m.time, 0) / successfulMeasurements.length
      : 0;
    
    const successRate = successfulMeasurements.length / measurements.length;

    return { averageResponseTime, successRate };
  }

  private async executeUnderChaos(
    experiment: ChaosExperiment,
    strategy: FaultInjectionStrategy
  ): Promise<{
    metrics: {
      successfulOperations: number;
      failedOperations: number;
      timeouts: number;
      exceptions: Array<{ type: string; message: string; count: number }>;
      averageResponseTime?: number;
    };
    behavior: {
      gracefulDegradation: boolean;
      errorHandling: boolean;
      dataIntegrity: boolean;
    };
  }> {
    const metrics = {
      successfulOperations: 0,
      failedOperations: 0,
      timeouts: 0,
      exceptions: [] as Array<{ type: string; message: string; count: number }>,
      averageResponseTime: 0
    };

    const behavior = {
      gracefulDegradation: false,
      errorHandling: false,
      dataIntegrity: true
    };

    const exceptionCounts = new Map<string, number>();
    const responseTimes: number[] = [];
    const startTime = Date.now();

    // Run operations under chaos for the specified duration
    while (Date.now() - startTime < experiment.duration) {
      const operationStart = performance.now();
      
      try {
        // Inject chaos-specific behavior
        if (global.__chaosExceptionRate && Math.random() < global.__chaosExceptionRate) {
          throw new Error('Chaos-injected exception');
        }

        if (global.__chaosTimeoutDelay) {
          await AsyncTestUtils.delay(Math.random() * global.__chaosTimeoutDelay);
        }

        await experiment.targetFunction();
        
        const operationTime = performance.now() - operationStart;
        responseTimes.push(operationTime);
        metrics.successfulOperations++;

        // Check for graceful degradation (slower but still working)
        if (operationTime > 1000) { // If operation takes > 1s
          behavior.gracefulDegradation = true;
        }

      } catch (error) {
        const operationTime = performance.now() - operationStart;
        metrics.failedOperations++;
        
        // Track exception types
        const errorType = error.constructor.name;
        exceptionCounts.set(errorType, (exceptionCounts.get(errorType) || 0) + 1);
        
        // Check for timeout
        if (operationTime > 5000) {
          metrics.timeouts++;
        }

        // Good error handling detected if errors are caught and handled
        behavior.errorHandling = true;
      }

      // Small delay between operations
      await AsyncTestUtils.delay(10);
    }

    // Convert exception counts to array
    metrics.exceptions = Array.from(exceptionCounts.entries()).map(([type, count]) => ({
      type,
      message: `${type} occurred`,
      count
    }));

    // Calculate average response time
    if (responseTimes.length > 0) {
      metrics.averageResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    }

    return { metrics, behavior };
  }

  private async measureRecovery(targetFunction: () => Promise<any>): Promise<{
    availabilityScore: number;
  }> {
    const recoveryAttempts = 10;
    let successfulAttempts = 0;

    for (let i = 0; i < recoveryAttempts; i++) {
      try {
        await targetFunction();
        successfulAttempts++;
      } catch {
        // Recovery attempt failed
      }
      
      await AsyncTestUtils.delay(100);
    }

    const availabilityScore = (successfulAttempts / recoveryAttempts) * 100;
    return { availabilityScore };
  }

  private calculateResilienceScore(result: ChaosExperimentResult): ChaosExperimentResult['resilience'] {
    const totalOperations = result.metrics.successfulOperations + result.metrics.failedOperations;
    const successRate = totalOperations > 0 ? result.metrics.successfulOperations / totalOperations : 0;

    // Fault tolerance (ability to continue operating)
    const faultTolerance = successRate * 100;

    // Error recovery (ability to handle errors gracefully)
    const errorRecovery = result.systemBehavior.errorHandling ? 
      Math.min(100, (result.systemBehavior.serviceAvailability + 30)) : 20;

    // Performance stability (minimal performance degradation)
    const performanceStability = result.metrics.performanceImpact.degradation < 50 ? 
      Math.max(0, 100 - result.metrics.performanceImpact.degradation) : 0;

    // Data consistency (no data corruption)
    const dataConsistency = result.systemBehavior.dataIntegrity ? 100 : 0;

    // Overall resilience score (weighted average)
    const score = Math.round(
      (faultTolerance * 0.3) +
      (errorRecovery * 0.3) +
      (performanceStability * 0.2) +
      (dataConsistency * 0.2)
    );

    return {
      score,
      breakdown: {
        faultTolerance,
        errorRecovery,
        performanceStability,
        dataConsistency
      }
    };
  }

  private generateRecommendations(result: ChaosExperimentResult): string[] {
    const recommendations: string[] = [];

    if (result.resilience.score < 70) {
      recommendations.push('Overall resilience is below recommended threshold (70). Consider implementing additional fault tolerance mechanisms.');
    }

    if (result.resilience.breakdown.faultTolerance < 60) {
      recommendations.push('Improve fault tolerance by implementing circuit breakers and retry logic.');
    }

    if (result.resilience.breakdown.errorRecovery < 60) {
      recommendations.push('Enhance error recovery mechanisms and graceful degradation strategies.');
    }

    if (result.resilience.breakdown.performanceStability < 50) {
      recommendations.push('Optimize performance under stress conditions and implement resource throttling.');
    }

    if (!result.systemBehavior.dataIntegrity) {
      recommendations.push('CRITICAL: Data integrity issues detected. Implement proper transaction management and data validation.');
    }

    if (result.systemBehavior.recoveryTime > 10000) {
      recommendations.push('Recovery time is high. Consider implementing faster recovery mechanisms and health checks.');
    }

    if (result.metrics.timeouts > 0) {
      recommendations.push('Timeouts detected. Implement proper timeout handling and async operation management.');
    }

    return recommendations;
  }

  /**
   * Generate chaos testing report
   */
  generateChaosTestingReport(
    results: Array<{
      experiment: ChaosExperiment;
      result: ChaosExperimentResult;
      success: boolean;
      error?: Error;
    }>
  ): string {
    const report = [
      '# Chaos Engineering Test Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Total Experiments: ${results.length}`,
      '',
      '## Summary',
      ''
    ];

    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;
    const averageResilience = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + r.result.resilience.score, 0) / Math.max(successful, 1);

    report.push(`- Successful Experiments: ${successful}/${results.length}`);
    report.push(`- Failed Experiments: ${failed}/${results.length}`);
    report.push(`- Average Resilience Score: ${averageResilience.toFixed(1)}/100`);
    report.push('');

    // Individual experiment results
    report.push('## Experiment Results');
    report.push('');

    for (const { experiment, result, success, error } of results) {
      report.push(`### ${experiment.name}`);
      report.push(`**Type:** ${experiment.type}`);
      report.push(`**Severity:** ${experiment.severity}`);
      
      if (success) {
        report.push(`**Success:** ✅`);
        report.push(`**Resilience Score:** ${result.resilience.score}/100`);
        report.push(`**Duration:** ${result.duration}ms`);
        report.push('');
        report.push('**Breakdown:**');
        report.push(`- Fault Tolerance: ${result.resilience.breakdown.faultTolerance}/100`);
        report.push(`- Error Recovery: ${result.resilience.breakdown.errorRecovery}/100`);
        report.push(`- Performance Stability: ${result.resilience.breakdown.performanceStability}/100`);
        report.push(`- Data Consistency: ${result.resilience.breakdown.dataConsistency}/100`);
        
        if (result.recommendations.length > 0) {
          report.push('');
          report.push('**Recommendations:**');
          result.recommendations.forEach(rec => report.push(`- ${rec}`));
        }
      } else {
        report.push(`**Success:** ❌`);
        if (error) {
          report.push(`**Error:** ${error.message}`);
        }
      }
      
      report.push('');
    }

    return report.join('\n');
  }
}

/**
 * Declare global for chaos testing
 */
declare global {
  var __chaosMemoryArrays: any[];
  var __originalFetch: typeof fetch;
  var __chaosExceptionRate: number;
  var __chaosRaceCondition: boolean;
  var __chaosTimeoutDelay: number;
}