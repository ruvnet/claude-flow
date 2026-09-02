/**
 * Verification Hooks Module
 * 
 * Comprehensive verification and validation system for claude-flow operations.
 * Provides pre-task verification, post-task validation, integration testing,
 * truth telemetry, and rollback capabilities.
 */

import { Logger } from '../core/logger.js';
import { agenticHookManager } from '../services/agentic-flow-hooks/index.js';
import type {
  AgenticHookContext,
  HookHandlerResult,
  HookRegistration,
  WorkflowHookPayload,
  PerformanceHookPayload,
  MemoryHookPayload,
} from '../services/agentic-flow-hooks/types.js';

const logger = new Logger({
  level: 'info',
  format: 'text',
  destination: 'console'
}, { prefix: 'VerificationHooks' });

// ===== Types & Interfaces =====

export interface VerificationConfig {
  preTask: {
    enabled: boolean;
    checkers: PreTaskChecker[];
    failureStrategy: 'abort' | 'warn' | 'continue';
  };
  postTask: {
    enabled: boolean;
    validators: PostTaskValidator[];
    accuracyThreshold: number;
  };
  integration: {
    enabled: boolean;
    testSuites: IntegrationTestSuite[];
    parallel: boolean;
  };
  telemetry: {
    enabled: boolean;
    truthValidators: TruthValidator[];
    reportingInterval: number;
  };
  rollback: {
    enabled: boolean;
    triggers: RollbackTrigger[];
    snapshotStrategy: 'automatic' | 'manual' | 'selective';
  };
}

export interface PreTaskChecker {
  id: string;
  name: string;
  description: string;
  priority: number;
  check: (context: VerificationContext) => Promise<VerificationResult>;
}

export interface PostTaskValidator {
  id: string;
  name: string;
  description: string;
  priority: number;
  validate: (context: VerificationContext, result: any) => Promise<ValidationResult>;
}

export interface IntegrationTestSuite {
  id: string;
  name: string;
  description: string;
  tests: IntegrationTest[];
  requirements: string[];
}

export interface IntegrationTest {
  id: string;
  name: string;
  description: string;
  execute: (context: VerificationContext) => Promise<TestResult>;
  cleanup?: (context: VerificationContext) => Promise<void>;
}

export interface TruthValidator {
  id: string;
  name: string;
  description: string;
  validate: (data: any, expected: any) => Promise<TruthResult>;
}

export interface RollbackTrigger {
  id: string;
  name: string;
  description: string;
  condition: (context: VerificationContext, error?: Error) => boolean;
  action: RollbackAction;
}

export interface VerificationContext {
  taskId: string;
  sessionId: string;
  timestamp: number;
  metadata: Record<string, any>;
  state: VerificationState;
  snapshots: StateSnapshot[];
  metrics: VerificationMetrics;
}

export interface VerificationState {
  phase: 'pre-task' | 'execution' | 'post-task' | 'validation' | 'complete' | 'failed';
  checksPassed: string[];
  checksFailed: string[];
  validationResults: ValidationResult[];
  testResults: TestResult[];
  truthResults: TruthResult[];
  errors: VerificationError[];
}

export interface StateSnapshot {
  id: string;
  timestamp: number;
  phase: string;
  state: any;
  metadata: Record<string, any>;
}

export interface VerificationMetrics {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  executionTime: number;
  accuracyScore: number;
  confidenceScore: number;
}

export interface VerificationResult {
  passed: boolean;
  score: number;
  message: string;
  details?: any;
  recommendations?: string[];
}

export interface ValidationResult {
  valid: boolean;
  accuracy: number;
  confidence: number;
  message: string;
  details?: any;
  evidence?: any[];
}

export interface TestResult {
  passed: boolean;
  duration: number;
  message: string;
  details?: any;
  logs?: string[];
}

export interface TruthResult {
  truthful: boolean;
  accuracy: number;
  confidence: number;
  discrepancies: string[];
  evidence: any[];
}

export interface VerificationError {
  type: 'check' | 'validation' | 'test' | 'truth' | 'system';
  phase: string;
  message: string;
  details?: any;
  recoverable: boolean;
}

export type RollbackAction = 
  | 'restore-snapshot' 
  | 'revert-changes' 
  | 'reset-state' 
  | 'abort-task'
  | 'retry-with-fallback';

// ===== Default Configuration =====

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  preTask: {
    enabled: true,
    checkers: [],
    failureStrategy: 'abort',
  },
  postTask: {
    enabled: true,
    validators: [],
    accuracyThreshold: 0.8,
  },
  integration: {
    enabled: true,
    testSuites: [],
    parallel: true,
  },
  telemetry: {
    enabled: true,
    truthValidators: [],
    reportingInterval: 30000, // 30 seconds
  },
  rollback: {
    enabled: true,
    triggers: [],
    snapshotStrategy: 'automatic',
  },
};

// ===== Verification Hook Manager =====

export class VerificationHookManager {
  private config: VerificationConfig;
  private contexts: Map<string, VerificationContext> = new Map();
  private snapshots: Map<string, StateSnapshot[]> = new Map();

  constructor(config: Partial<VerificationConfig> = {}) {
    this.config = { ...DEFAULT_VERIFICATION_CONFIG, ...config };
    this.registerHooks();
    this.startTelemetryReporting();
  }

  /**
   * Register all verification hooks with the agentic hook manager
   */
  private registerHooks(): void {
    // Pre-task verification hook
    this.registerPreTaskHook();
    
    // Post-task validation hook
    this.registerPostTaskHook();
    
    // Integration test hook
    this.registerIntegrationTestHook();
    
    // Truth telemetry hook
    this.registerTruthTelemetryHook();
    
    // Rollback trigger hook
    this.registerRollbackTriggerHook();

    logger.info('Verification hooks registered successfully');
  }

  // ===== 1. Pre-Task Verification Hook =====

  private registerPreTaskHook(): void {
    const preTaskHook: HookRegistration = {
      id: 'verification-pre-task',
      type: 'workflow-start',
      priority: 100, // High priority to run early
      handler: async (payload: WorkflowHookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
        if (!this.config.preTask.enabled) {
          return { continue: true };
        }

        const verificationContext = this.createVerificationContext(payload, context);
        
        try {
          await this.executePreTaskChecks(verificationContext);
          
          const state = verificationContext.state;
          if (state.checksFailed.length > 0) {
            const strategy = this.config.preTask.failureStrategy;
            
            if (strategy === 'abort') {
              return {
                continue: false,
                metadata: {
                  verificationFailed: true,
                  failedChecks: state.checksFailed,
                  error: 'Pre-task verification failed'
                }
              };
            } else if (strategy === 'warn') {
              logger.warn('Pre-task verification warnings:', state.checksFailed);
            }
          }

          // Create initial snapshot
          await this.createSnapshot(verificationContext, 'pre-task-complete');

          return {
            continue: true,
            modified: true,
            payload: {
              ...payload,
              verificationContext: verificationContext.taskId
            },
            metadata: {
              verificationPassed: true,
              checksExecuted: state.checksPassed.length,
              warnings: state.checksFailed.length
            }
          };
        } catch (error) {
          logger.error('Pre-task verification error:', error);
          
          return {
            continue: this.config.preTask.failureStrategy !== 'abort',
            metadata: {
              verificationError: true,
              error: (error as Error).message
            }
          };
        }
      },
      options: {
        timeout: 30000, // 30 second timeout
        async: false,
      }
    };

    agenticHookManager.register(preTaskHook);
  }

  private async executePreTaskChecks(context: VerificationContext): Promise<void> {
    const checkers = this.config.preTask.checkers.sort((a, b) => b.priority - a.priority);
    
    for (const checker of checkers) {
      try {
        const result = await checker.check(context);
        
        if (result.passed) {
          context.state.checksPassed.push(checker.id);
        } else {
          context.state.checksFailed.push(checker.id);
          context.state.errors.push({
            type: 'check',
            phase: 'pre-task',
            message: result.message,
            details: result.details,
            recoverable: true
          });
        }

        // Update metrics
        context.metrics.totalChecks++;
        if (result.passed) {
          context.metrics.passedChecks++;
        } else {
          context.metrics.failedChecks++;
        }
      } catch (error) {
        logger.error(`Pre-task checker '${checker.id}' failed:`, error);
        context.state.checksFailed.push(checker.id);
        context.state.errors.push({
          type: 'check',
          phase: 'pre-task',
          message: `Checker '${checker.id}' threw an error: ${(error as Error).message}`,
          details: error,
          recoverable: false
        });
      }
    }
  }

  // ===== 2. Post-Task Validation Hook =====

  private registerPostTaskHook(): void {
    const postTaskHook: HookRegistration = {
      id: 'verification-post-task',
      type: 'workflow-complete',
      priority: 90,
      handler: async (payload: WorkflowHookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
        if (!this.config.postTask.enabled) {
          return { continue: true };
        }

        const verificationContext = this.getVerificationContext(payload.workflowId) || 
                                   this.createVerificationContext(payload, context);
        
        try {
          await this.executePostTaskValidation(verificationContext, payload);
          
          const accuracy = this.calculateAccuracy(verificationContext);
          const meetsThreshold = accuracy >= this.config.postTask.accuracyThreshold;

          // Create completion snapshot
          await this.createSnapshot(verificationContext, 'post-task-complete');

          return {
            continue: true,
            modified: true,
            payload: {
              ...payload,
              validationResults: verificationContext.state.validationResults,
              accuracy,
              meetsThreshold
            },
            metadata: {
              validationComplete: true,
              accuracy,
              meetsThreshold,
              validationCount: verificationContext.state.validationResults.length
            },
            sideEffects: [{
              type: 'metric',
              action: 'update',
              data: {
                name: 'verification.accuracy',
                value: accuracy
              }
            }]
          };
        } catch (error) {
          logger.error('Post-task validation error:', error);
          
          return {
            continue: true,
            metadata: {
              validationError: true,
              error: (error as Error).message
            }
          };
        }
      },
      options: {
        timeout: 60000, // 60 second timeout
        async: true,
      }
    };

    agenticHookManager.register(postTaskHook);
  }

  private async executePostTaskValidation(
    context: VerificationContext, 
    payload: WorkflowHookPayload
  ): Promise<void> {
    const validators = this.config.postTask.validators.sort((a, b) => b.priority - a.priority);
    
    for (const validator of validators) {
      try {
        const result = await validator.validate(context, payload.state);
        context.state.validationResults.push(result);
        
        // Update metrics
        if (result.valid) {
          context.metrics.accuracyScore += result.accuracy;
          context.metrics.confidenceScore += result.confidence;
        }
      } catch (error) {
        logger.error(`Post-task validator '${validator.id}' failed:`, error);
        context.state.errors.push({
          type: 'validation',
          phase: 'post-task',
          message: `Validator '${validator.id}' threw an error: ${(error as Error).message}`,
          details: error,
          recoverable: false
        });
      }
    }
  }

  // ===== 3. Integration Test Hook =====

  private registerIntegrationTestHook(): void {
    const integrationTestHook: HookRegistration = {
      id: 'verification-integration-test',
      type: 'workflow-step',
      priority: 80,
      filter: {
        patterns: [/integration.*test/i, /test.*integration/i]
      },
      handler: async (payload: WorkflowHookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
        if (!this.config.integration.enabled) {
          return { continue: true };
        }

        const verificationContext = this.getVerificationContext(payload.workflowId) || 
                                   this.createVerificationContext(payload, context);
        
        try {
          await this.executeIntegrationTests(verificationContext);
          
          const allTestsPassed = verificationContext.state.testResults.every(r => r.passed);
          const testCount = verificationContext.state.testResults.length;
          const passedCount = verificationContext.state.testResults.filter(r => r.passed).length;

          return {
            continue: true,
            modified: true,
            payload: {
              ...payload,
              testResults: verificationContext.state.testResults,
              allTestsPassed,
              testSummary: {
                total: testCount,
                passed: passedCount,
                failed: testCount - passedCount
              }
            },
            metadata: {
              integrationTestsComplete: true,
              allTestsPassed,
              testCount,
              passedCount
            },
            sideEffects: [{
              type: 'metric',
              action: 'update',
              data: {
                name: 'verification.integration.success_rate',
                value: passedCount / testCount
              }
            }]
          };
        } catch (error) {
          logger.error('Integration test execution error:', error);
          
          return {
            continue: true,
            metadata: {
              integrationTestError: true,
              error: (error as Error).message
            }
          };
        }
      },
      options: {
        timeout: 120000, // 2 minute timeout for tests
        async: true,
      }
    };

    agenticHookManager.register(integrationTestHook);
  }

  private async executeIntegrationTests(context: VerificationContext): Promise<void> {
    const testSuites = this.config.integration.testSuites;
    
    for (const suite of testSuites) {
      // Check if requirements are met
      const requirementsMet = await this.checkTestRequirements(suite.requirements, context);
      if (!requirementsMet) {
        logger.warn(`Skipping test suite '${suite.id}' - requirements not met`);
        continue;
      }

      if (this.config.integration.parallel) {
        // Execute tests in parallel
        const testPromises = suite.tests.map(test => this.executeIntegrationTest(test, context));
        const results = await Promise.allSettled(testPromises);
        
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            context.state.testResults.push(result.value);
          } else {
            context.state.testResults.push({
              passed: false,
              duration: 0,
              message: `Test '${suite.tests[index].id}' failed: ${result.reason}`,
              details: result.reason
            });
          }
        });
      } else {
        // Execute tests sequentially
        for (const test of suite.tests) {
          try {
            const result = await this.executeIntegrationTest(test, context);
            context.state.testResults.push(result);
          } catch (error) {
            context.state.testResults.push({
              passed: false,
              duration: 0,
              message: `Test '${test.id}' failed: ${(error as Error).message}`,
              details: error
            });
          }
        }
      }
    }
  }

  private async executeIntegrationTest(
    test: IntegrationTest, 
    context: VerificationContext
  ): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      const result = await test.execute(context);
      result.duration = Date.now() - startTime;
      
      // Cleanup if provided
      if (test.cleanup) {
        try {
          await test.cleanup(context);
        } catch (cleanupError) {
          logger.warn(`Test cleanup failed for '${test.id}':`, cleanupError);
        }
      }
      
      return result;
    } catch (error) {
      return {
        passed: false,
        duration: Date.now() - startTime,
        message: `Test execution failed: ${(error as Error).message}`,
        details: error
      };
    }
  }

  private async checkTestRequirements(
    requirements: string[], 
    context: VerificationContext
  ): Promise<boolean> {
    // Simple requirement checking - can be extended
    for (const requirement of requirements) {
      if (requirement.startsWith('env:')) {
        const envVar = requirement.substring(4);
        if (!process.env[envVar]) {
          return false;
        }
      } else if (requirement.startsWith('check:')) {
        const checkId = requirement.substring(6);
        if (!context.state.checksPassed.includes(checkId)) {
          return false;
        }
      }
    }
    return true;
  }

  // ===== 4. Truth Telemetry Hook =====

  private registerTruthTelemetryHook(): void {
    const truthTelemetryHook: HookRegistration = {
      id: 'verification-truth-telemetry',
      type: 'performance-metric',
      priority: 70,
      handler: async (payload: PerformanceHookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
        if (!this.config.telemetry.enabled) {
          return { continue: true };
        }

        const verificationContext = this.getOrCreateVerificationContext(payload, context);
        
        try {
          await this.executeTruthValidation(verificationContext, payload);
          
          const truthfulness = this.calculateTruthfulness(verificationContext);
          
          return {
            continue: true,
            modified: true,
            payload: {
              ...payload,
              truthResults: verificationContext.state.truthResults,
              truthfulness
            },
            metadata: {
              truthValidationComplete: true,
              truthfulness,
              validatorCount: this.config.telemetry.truthValidators.length
            },
            sideEffects: [
              {
                type: 'metric',
                action: 'update',
                data: {
                  name: 'verification.truthfulness',
                  value: truthfulness
                }
              },
              {
                type: 'memory',
                action: 'store',
                data: {
                  key: `truth_telemetry_${Date.now()}`,
                  value: {
                    timestamp: Date.now(),
                    truthfulness,
                    results: verificationContext.state.truthResults
                  }
                }
              }
            ]
          };
        } catch (error) {
          logger.error('Truth telemetry execution error:', error);
          
          return {
            continue: true,
            metadata: {
              truthTelemetryError: true,
              error: (error as Error).message
            }
          };
        }
      },
      options: {
        timeout: 45000, // 45 second timeout
        async: true,
      }
    };

    agenticHookManager.register(truthTelemetryHook);
  }

  private async executeTruthValidation(
    context: VerificationContext, 
    payload: PerformanceHookPayload
  ): Promise<void> {
    const validators = this.config.telemetry.truthValidators;
    
    for (const validator of validators) {
      try {
        // Extract data and expected values from payload
        const data = payload.context.metrics || payload.value;
        const expected = payload.threshold; // Use threshold as expected value
        
        const result = await validator.validate(data, expected);
        context.state.truthResults.push(result);
      } catch (error) {
        logger.error(`Truth validator '${validator.id}' failed:`, error);
        context.state.errors.push({
          type: 'truth',
          phase: 'telemetry',
          message: `Truth validator '${validator.id}' threw an error: ${(error as Error).message}`,
          details: error,
          recoverable: false
        });
      }
    }
  }

  private calculateTruthfulness(context: VerificationContext): number {
    const truthResults = context.state.truthResults;
    if (truthResults.length === 0) return 1.0;
    
    const totalAccuracy = truthResults.reduce((sum, result) => sum + result.accuracy, 0);
    return totalAccuracy / truthResults.length;
  }

  // ===== 5. Rollback Trigger Hook =====

  private registerRollbackTriggerHook(): void {
    const rollbackTriggerHook: HookRegistration = {
      id: 'verification-rollback-trigger',
      type: 'workflow-error',
      priority: 95, // Very high priority for error handling
      handler: async (payload: WorkflowHookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
        if (!this.config.rollback.enabled) {
          return { continue: true };
        }

        const verificationContext = this.getVerificationContext(payload.workflowId);
        if (!verificationContext) {
          logger.warn('No verification context found for rollback evaluation');
          return { continue: true };
        }

        try {
          const shouldRollback = await this.evaluateRollbackTriggers(verificationContext, payload.error);
          
          if (shouldRollback) {
            const rollbackResult = await this.executeRollback(verificationContext);
            
            return {
              continue: rollbackResult.success,
              modified: true,
              payload: {
                ...payload,
                rollbackExecuted: true,
                rollbackResult
              },
              metadata: {
                rollbackTriggered: true,
                rollbackSuccess: rollbackResult.success,
                rollbackAction: rollbackResult.action
              },
              sideEffects: [
                {
                  type: 'log',
                  action: 'warn',
                  data: {
                    level: 'warn',
                    message: 'Rollback triggered due to verification failure',
                    data: rollbackResult
                  }
                },
                {
                  type: 'metric',
                  action: 'increment',
                  data: {
                    name: 'verification.rollbacks.triggered'
                  }
                }
              ]
            };
          }

          return { continue: true };
        } catch (error) {
          logger.error('Rollback trigger evaluation error:', error);
          
          return {
            continue: true,
            metadata: {
              rollbackError: true,
              error: (error as Error).message
            }
          };
        }
      },
      options: {
        timeout: 30000, // 30 second timeout
        async: false, // Critical for error handling
      }
    };

    agenticHookManager.register(rollbackTriggerHook);
  }

  private async evaluateRollbackTriggers(
    context: VerificationContext, 
    error?: Error
  ): Promise<boolean> {
    const triggers = this.config.rollback.triggers;
    
    for (const trigger of triggers) {
      try {
        if (trigger.condition(context, error)) {
          logger.info(`Rollback trigger '${trigger.id}' activated`);
          return true;
        }
      } catch (triggerError) {
        logger.error(`Rollback trigger '${trigger.id}' evaluation failed:`, triggerError);
      }
    }
    
    return false;
  }

  private async executeRollback(context: VerificationContext): Promise<{
    success: boolean;
    action: string;
    details?: any;
  }> {
    try {
      const snapshots = this.snapshots.get(context.taskId) || [];
      const latestSnapshot = snapshots[snapshots.length - 1];
      
      if (!latestSnapshot) {
        throw new Error('No snapshots available for rollback');
      }

      // Execute rollback based on strategy
      switch (this.config.rollback.snapshotStrategy) {
        case 'automatic':
          await this.restoreSnapshot(context, latestSnapshot);
          break;
          
        case 'selective':
          // Find the best snapshot to restore to
          const bestSnapshot = this.findBestRollbackSnapshot(snapshots);
          await this.restoreSnapshot(context, bestSnapshot);
          break;
          
        default:
          await this.restoreSnapshot(context, latestSnapshot);
      }

      return {
        success: true,
        action: 'snapshot-restored',
        details: {
          snapshotId: latestSnapshot.id,
          timestamp: latestSnapshot.timestamp
        }
      };
    } catch (error) {
      logger.error('Rollback execution failed:', error);
      
      return {
        success: false,
        action: 'rollback-failed',
        details: (error as Error).message
      };
    }
  }

  // ===== Helper Methods =====

  private createVerificationContext(
    payload: WorkflowHookPayload, 
    context: AgenticHookContext
  ): VerificationContext {
    const verificationContext: VerificationContext = {
      taskId: payload.workflowId,
      sessionId: context.sessionId,
      timestamp: Date.now(),
      metadata: { ...payload.state, ...context.metadata },
      state: {
        phase: 'pre-task',
        checksPassed: [],
        checksFailed: [],
        validationResults: [],
        testResults: [],
        truthResults: [],
        errors: []
      },
      snapshots: [],
      metrics: {
        totalChecks: 0,
        passedChecks: 0,
        failedChecks: 0,
        executionTime: 0,
        accuracyScore: 0,
        confidenceScore: 0
      }
    };

    this.contexts.set(verificationContext.taskId, verificationContext);
    return verificationContext;
  }

  private getVerificationContext(taskId: string): VerificationContext | undefined {
    return this.contexts.get(taskId);
  }

  private getOrCreateVerificationContext(
    payload: any, 
    context: AgenticHookContext
  ): VerificationContext {
    const taskId = payload.workflowId || payload.context?.taskId || context.correlationId;
    
    let verificationContext = this.contexts.get(taskId);
    if (!verificationContext) {
      verificationContext = this.createVerificationContext(
        { workflowId: taskId, state: payload.context || {} } as WorkflowHookPayload,
        context
      );
    }
    
    return verificationContext;
  }

  private async createSnapshot(
    context: VerificationContext, 
    phase: string
  ): Promise<void> {
    const snapshot: StateSnapshot = {
      id: `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      phase,
      state: JSON.parse(JSON.stringify(context.state)),
      metadata: JSON.parse(JSON.stringify(context.metadata))
    };

    if (!this.snapshots.has(context.taskId)) {
      this.snapshots.set(context.taskId, []);
    }

    this.snapshots.get(context.taskId)!.push(snapshot);
    context.snapshots.push(snapshot);

    logger.debug(`Created snapshot '${snapshot.id}' for task '${context.taskId}' in phase '${phase}'`);
  }

  private async restoreSnapshot(
    context: VerificationContext, 
    snapshot: StateSnapshot
  ): Promise<void> {
    context.state = JSON.parse(JSON.stringify(snapshot.state));
    context.metadata = JSON.parse(JSON.stringify(snapshot.metadata));
    
    logger.info(`Restored snapshot '${snapshot.id}' for task '${context.taskId}'`);
  }

  private findBestRollbackSnapshot(snapshots: StateSnapshot[]): StateSnapshot {
    // Find the latest snapshot with successful state
    const successfulSnapshots = snapshots.filter(s => 
      s.phase.includes('complete') && !s.phase.includes('error')
    );
    
    return successfulSnapshots.length > 0 
      ? successfulSnapshots[successfulSnapshots.length - 1]
      : snapshots[snapshots.length - 1];
  }

  private calculateAccuracy(context: VerificationContext): number {
    const validationResults = context.state.validationResults;
    if (validationResults.length === 0) return 1.0;
    
    const totalAccuracy = validationResults.reduce((sum, result) => sum + result.accuracy, 0);
    return totalAccuracy / validationResults.length;
  }

  private startTelemetryReporting(): void {
    if (!this.config.telemetry.enabled) return;

    setInterval(() => {
      this.generateTelemetryReport();
    }, this.config.telemetry.reportingInterval);
  }

  private generateTelemetryReport(): void {
    const report = {
      timestamp: Date.now(),
      activeContexts: this.contexts.size,
      totalSnapshots: Array.from(this.snapshots.values()).reduce((sum, arr) => sum + arr.length, 0),
      metrics: this.aggregateMetrics()
    };

    logger.info('Verification telemetry report:', report);
    
    // Emit telemetry event for external systems
    agenticHookManager.emit('verification:telemetry', report);
  }

  private aggregateMetrics(): any {
    const allContexts = Array.from(this.contexts.values());
    
    return {
      totalChecks: allContexts.reduce((sum, ctx) => sum + ctx.metrics.totalChecks, 0),
      totalPassed: allContexts.reduce((sum, ctx) => sum + ctx.metrics.passedChecks, 0),
      totalFailed: allContexts.reduce((sum, ctx) => sum + ctx.metrics.failedChecks, 0),
      averageAccuracy: allContexts.length > 0 
        ? allContexts.reduce((sum, ctx) => sum + ctx.metrics.accuracyScore, 0) / allContexts.length
        : 0,
      averageConfidence: allContexts.length > 0
        ? allContexts.reduce((sum, ctx) => sum + ctx.metrics.confidenceScore, 0) / allContexts.length
        : 0
    };
  }

  // ===== Public API =====

  /**
   * Add a pre-task checker
   */
  public addPreTaskChecker(checker: PreTaskChecker): void {
    this.config.preTask.checkers.push(checker);
    logger.info(`Added pre-task checker: ${checker.name}`);
  }

  /**
   * Add a post-task validator
   */
  public addPostTaskValidator(validator: PostTaskValidator): void {
    this.config.postTask.validators.push(validator);
    logger.info(`Added post-task validator: ${validator.name}`);
  }

  /**
   * Add an integration test suite
   */
  public addIntegrationTestSuite(testSuite: IntegrationTestSuite): void {
    this.config.integration.testSuites.push(testSuite);
    logger.info(`Added integration test suite: ${testSuite.name}`);
  }

  /**
   * Add a truth validator
   */
  public addTruthValidator(validator: TruthValidator): void {
    this.config.telemetry.truthValidators.push(validator);
    logger.info(`Added truth validator: ${validator.name}`);
  }

  /**
   * Add a rollback trigger
   */
  public addRollbackTrigger(trigger: RollbackTrigger): void {
    this.config.rollback.triggers.push(trigger);
    logger.info(`Added rollback trigger: ${trigger.name}`);
  }

  /**
   * Get verification status for a task
   */
  public getVerificationStatus(taskId: string): VerificationContext | undefined {
    return this.contexts.get(taskId);
  }

  /**
   * Get verification metrics
   */
  public getMetrics(): any {
    return this.aggregateMetrics();
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<VerificationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Verification configuration updated');
  }

  /**
   * Cleanup old contexts and snapshots
   */
  public cleanup(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAge;
    
    // Cleanup contexts
    for (const [taskId, context] of this.contexts.entries()) {
      if (context.timestamp < cutoff) {
        this.contexts.delete(taskId);
        this.snapshots.delete(taskId);
      }
    }
    
    logger.info(`Cleaned up verification data older than ${maxAge}ms`);
  }
}

// ===== Default Verification Components =====

export const DEFAULT_PRE_TASK_CHECKERS: PreTaskChecker[] = [
  {
    id: 'environment-check',
    name: 'Environment Validation',
    description: 'Validates that required environment variables and dependencies are available',
    priority: 100,
    check: async (context: VerificationContext): Promise<VerificationResult> => {
      // Basic environment validation
      const requiredEnvVars = ['NODE_ENV'];
      const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
      
      return {
        passed: missing.length === 0,
        score: missing.length === 0 ? 1.0 : 0.5,
        message: missing.length === 0 
          ? 'Environment validation passed' 
          : `Missing environment variables: ${missing.join(', ')}`,
        details: { missing, available: requiredEnvVars.filter(envVar => process.env[envVar]) },
        recommendations: missing.length > 0 
          ? [`Set missing environment variables: ${missing.join(', ')}`]
          : undefined
      };
    }
  },
  {
    id: 'resource-check',
    name: 'Resource Availability',
    description: 'Checks system resources and capacity',
    priority: 90,
    check: async (context: VerificationContext): Promise<VerificationResult> => {
      // Simple memory check
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
      const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
      const usageRatio = heapUsedMB / heapTotalMB;
      
      return {
        passed: usageRatio < 0.9, // Less than 90% memory usage
        score: Math.max(0, 1 - usageRatio),
        message: `Memory usage: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (${(usageRatio * 100).toFixed(1)}%)`,
        details: { memUsage, usageRatio },
        recommendations: usageRatio > 0.8 
          ? ['Consider freeing memory before proceeding']
          : undefined
      };
    }
  }
];

export const DEFAULT_POST_TASK_VALIDATORS: PostTaskValidator[] = [
  {
    id: 'completion-validator',
    name: 'Task Completion Validation',
    description: 'Validates that the task completed successfully',
    priority: 100,
    validate: async (context: VerificationContext, result: any): Promise<ValidationResult> => {
      const hasErrors = context.state.errors.length > 0;
      const hasFailedChecks = context.state.checksFailed.length > 0;
      
      return {
        valid: !hasErrors && !hasFailedChecks,
        accuracy: hasErrors || hasFailedChecks ? 0.5 : 1.0,
        confidence: 0.9,
        message: hasErrors || hasFailedChecks 
          ? 'Task completed with errors or failed checks'
          : 'Task completed successfully',
        details: {
          errorCount: context.state.errors.length,
          failedCheckCount: context.state.checksFailed.length
        }
      };
    }
  }
];

export const DEFAULT_TRUTH_VALIDATORS: TruthValidator[] = [
  {
    id: 'data-consistency-validator',
    name: 'Data Consistency Validation',
    description: 'Validates data consistency and integrity',
    validate: async (data: any, expected: any): Promise<TruthResult> => {
      // Simple JSON comparison for data consistency
      const dataStr = JSON.stringify(data);
      const expectedStr = JSON.stringify(expected);
      const isEqual = dataStr === expectedStr;
      
      return {
        truthful: isEqual,
        accuracy: isEqual ? 1.0 : 0.0,
        confidence: 0.95,
        discrepancies: isEqual ? [] : ['Data does not match expected structure'],
        evidence: [{ data, expected, match: isEqual }]
      };
    }
  }
];

export const DEFAULT_ROLLBACK_TRIGGERS: RollbackTrigger[] = [
  {
    id: 'error-threshold-trigger',
    name: 'Error Threshold Trigger',
    description: 'Triggers rollback when error count exceeds threshold',
    condition: (context: VerificationContext, error?: Error): boolean => {
      return context.state.errors.filter(e => !e.recoverable).length > 3;
    },
    action: 'restore-snapshot'
  },
  {
    id: 'accuracy-threshold-trigger',
    name: 'Accuracy Threshold Trigger',
    description: 'Triggers rollback when accuracy falls below threshold',
    condition: (context: VerificationContext, error?: Error): boolean => {
      return context.metrics.accuracyScore < 0.5 && context.state.validationResults.length > 0;
    },
    action: 'restore-snapshot'
  }
];

// ===== Export Singleton Instance =====

export const verificationHookManager = new VerificationHookManager({
  preTask: {
    enabled: true,
    checkers: DEFAULT_PRE_TASK_CHECKERS,
    failureStrategy: 'abort'
  },
  postTask: {
    enabled: true,
    validators: DEFAULT_POST_TASK_VALIDATORS,
    accuracyThreshold: 0.8
  },
  integration: {
    enabled: true,
    testSuites: [],
    parallel: true
  },
  telemetry: {
    enabled: true,
    truthValidators: DEFAULT_TRUTH_VALIDATORS,
    reportingInterval: 30000
  },
  rollback: {
    enabled: true,
    triggers: DEFAULT_ROLLBACK_TRIGGERS,
    snapshotStrategy: 'automatic'
  }
});

// Initialize default components
logger.info('Verification hooks module initialized with default configuration');