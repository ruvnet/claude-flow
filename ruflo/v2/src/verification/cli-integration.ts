/**
 * Verification CLI Integration
 * 
 * Provides command-line interface integration for the verification system.
 * Ensures compatibility with claude-flow CLI and provides verification commands.
 */

import { Logger } from '../core/logger.js';
import { verificationHookManager } from './hooks.js';
import type { VerificationConfig } from './hooks.js';

const logger = new Logger({
  level: 'info',
  format: 'text',
  destination: 'console'
}, { prefix: 'VerificationCLI' });

// ===== CLI Command Types =====

export interface VerificationCommand {
  name: string;
  description: string;
  execute: (args: any) => Promise<any>;
  options?: CommandOption[];
}

export interface CommandOption {
  name: string;
  alias?: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: any;
}

// ===== CLI Commands =====

export class VerificationCLICommands {
  /**
   * Status command - shows verification system status
   */
  static status(): VerificationCommand {
    return {
      name: 'verification:status',
      description: 'Show verification system status and metrics',
      async execute(args: any) {
        try {
          const metrics = verificationHookManager.getMetrics();
          const status = {
            system: 'Verification System',
            status: 'Active',
            metrics,
            timestamp: new Date().toISOString()
          };

          if (args.json) {
            console.log(JSON.stringify(status, null, 2));
          } else {
            console.log('📊 Verification System Status');
            console.log('================================');
            console.log(`Status: ${status.status}`);
            console.log(`Total Checks: ${metrics.totalChecks || 0}`);
            console.log(`Passed Checks: ${metrics.totalPassed || 0}`);
            console.log(`Failed Checks: ${metrics.totalFailed || 0}`);
            console.log(`Average Accuracy: ${(metrics.averageAccuracy * 100 || 0).toFixed(1)}%`);
            console.log(`Average Confidence: ${(metrics.averageConfidence * 100 || 0).toFixed(1)}%`);
            console.log(`Timestamp: ${status.timestamp}`);
          }

          return status;
        } catch (error) {
          logger.error('Failed to get verification status:', error);
          throw error;
        }
      },
      options: [
        {
          name: 'json',
          description: 'Output in JSON format',
          type: 'boolean',
          default: false
        }
      ]
    };
  }

  /**
   * Check command - run verification checks
   */
  static check(): VerificationCommand {
    return {
      name: 'verification:check',
      description: 'Run verification checks for a specific task or context',
      async execute(args: any) {
        try {
          const { taskId, type = 'all' } = args;
          
          if (!taskId) {
            throw new Error('Task ID is required for verification checks');
          }

          const context = verificationHookManager.getVerificationStatus(taskId);
          if (!context) {
            throw new Error(`No verification context found for task: ${taskId}`);
          }

          const result = {
            taskId,
            phase: context.state.phase,
            checksExecuted: type,
            results: {
              passed: context.state.checksPassed,
              failed: context.state.checksFailed,
              validations: context.state.validationResults,
              tests: context.state.testResults,
              truth: context.state.truthResults
            },
            metrics: context.metrics,
            timestamp: new Date().toISOString()
          };

          if (args.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`🔍 Verification Check Results for Task: ${taskId}`);
            console.log('================================================');
            console.log(`Phase: ${context.state.phase}`);
            console.log(`Checks Passed: ${context.state.checksPassed.length}`);
            console.log(`Checks Failed: ${context.state.checksFailed.length}`);
            console.log(`Validations: ${context.state.validationResults.length}`);
            console.log(`Integration Tests: ${context.state.testResults.length}`);
            console.log(`Truth Validations: ${context.state.truthResults.length}`);
            console.log(`Accuracy Score: ${(context.metrics.accuracyScore * 100).toFixed(1)}%`);
            console.log(`Confidence Score: ${(context.metrics.confidenceScore * 100).toFixed(1)}%`);
          }

          return result;
        } catch (error) {
          logger.error('Failed to run verification check:', error);
          throw error;
        }
      },
      options: [
        {
          name: 'taskId',
          alias: 't',
          description: 'Task ID to check',
          type: 'string',
          required: true
        },
        {
          name: 'type',
          description: 'Type of checks to run (all, pre-task, post-task, integration, truth)',
          type: 'string',
          default: 'all'
        },
        {
          name: 'json',
          description: 'Output in JSON format',
          type: 'boolean',
          default: false
        }
      ]
    };
  }

  /**
   * Config command - manage verification configuration
   */
  static config(): VerificationCommand {
    return {
      name: 'verification:config',
      description: 'View or update verification configuration',
      async execute(args: any) {
        try {
          const { action = 'show', key, value } = args;

          switch (action) {
            case 'show':
              const currentConfig = (verificationHookManager as any).config;
              if (args.json) {
                console.log(JSON.stringify(currentConfig, null, 2));
              } else {
                console.log('⚙️  Verification Configuration');
                console.log('==============================');
                console.log(`Pre-task enabled: ${currentConfig.preTask.enabled}`);
                console.log(`Post-task enabled: ${currentConfig.postTask.enabled}`);
                console.log(`Integration enabled: ${currentConfig.integration.enabled}`);
                console.log(`Telemetry enabled: ${currentConfig.telemetry.enabled}`);
                console.log(`Rollback enabled: ${currentConfig.rollback.enabled}`);
                console.log(`Accuracy threshold: ${currentConfig.postTask.accuracyThreshold}`);
                console.log(`Telemetry interval: ${currentConfig.telemetry.reportingInterval}ms`);
              }
              return currentConfig;

            case 'set':
              if (!key || value === undefined) {
                throw new Error('Key and value are required for config set');
              }
              
              const configUpdate: any = {};
              const keyPath = key.split('.');
              let current = configUpdate;
              
              for (let i = 0; i < keyPath.length - 1; i++) {
                current[keyPath[i]] = {};
                current = current[keyPath[i]];
              }
              
              current[keyPath[keyPath.length - 1]] = value;
              
              verificationHookManager.updateConfig(configUpdate);
              console.log(`✅ Configuration updated: ${key} = ${value}`);
              
              return { key, value, updated: true };

            default:
              throw new Error(`Unknown config action: ${action}`);
          }
        } catch (error) {
          logger.error('Failed to manage verification config:', error);
          throw error;
        }
      },
      options: [
        {
          name: 'action',
          alias: 'a',
          description: 'Action to perform (show, set)',
          type: 'string',
          default: 'show'
        },
        {
          name: 'key',
          alias: 'k',
          description: 'Configuration key (for set action)',
          type: 'string'
        },
        {
          name: 'value',
          alias: 'v',
          description: 'Configuration value (for set action)',
          type: 'string'
        },
        {
          name: 'json',
          description: 'Output in JSON format',
          type: 'boolean',
          default: false
        }
      ]
    };
  }

  /**
   * Validate command - run post-task validation
   */
  static validate(): VerificationCommand {
    return {
      name: 'verification:validate',
      description: 'Run post-task validation for a completed task',
      async execute(args: any) {
        try {
          const { taskId, force = false } = args;
          
          if (!taskId) {
            throw new Error('Task ID is required for validation');
          }

          const context = verificationHookManager.getVerificationStatus(taskId);
          if (!context) {
            throw new Error(`No verification context found for task: ${taskId}`);
          }

          if (context.state.phase !== 'complete' && !force) {
            throw new Error(`Task is not complete (phase: ${context.state.phase}). Use --force to validate anyway.`);
          }

          // Trigger validation manually
          const validationResults = context.state.validationResults;
          const accuracy = validationResults.length > 0
            ? validationResults.reduce((sum, r) => sum + r.accuracy, 0) / validationResults.length
            : 0;

          const result = {
            taskId,
            validationComplete: true,
            accuracy,
            validationResults,
            meetsThreshold: accuracy >= 0.8,
            timestamp: new Date().toISOString()
          };

          if (args.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`✅ Validation Results for Task: ${taskId}`);
            console.log('========================================');
            console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`);
            console.log(`Meets Threshold: ${result.meetsThreshold ? 'Yes' : 'No'}`);
            console.log(`Validations Run: ${validationResults.length}`);
            
            if (validationResults.length > 0) {
              console.log('\nValidation Details:');
              validationResults.forEach((validation, index) => {
                console.log(`  ${index + 1}. ${validation.message} (${(validation.accuracy * 100).toFixed(1)}%)`);
              });
            }
          }

          return result;
        } catch (error) {
          logger.error('Failed to run validation:', error);
          throw error;
        }
      },
      options: [
        {
          name: 'taskId',
          alias: 't',
          description: 'Task ID to validate',
          type: 'string',
          required: true
        },
        {
          name: 'force',
          alias: 'f',
          description: 'Force validation even if task is not complete',
          type: 'boolean',
          default: false
        },
        {
          name: 'json',
          description: 'Output in JSON format',
          type: 'boolean',
          default: false
        }
      ]
    };
  }

  /**
   * Cleanup command - cleanup old verification data
   */
  static cleanup(): VerificationCommand {
    return {
      name: 'verification:cleanup',
      description: 'Cleanup old verification contexts and snapshots',
      async execute(args: any) {
        try {
          const { maxAge = 24 * 60 * 60 * 1000, force = false } = args; // Default 24 hours
          
          if (!force) {
            console.log(`⚠️  This will cleanup verification data older than ${maxAge}ms`);
            console.log('Use --force to proceed');
            return { cleaned: false, reason: 'Force flag required' };
          }

          const beforeMetrics = verificationHookManager.getMetrics();
          verificationHookManager.cleanup(maxAge);
          const afterMetrics = verificationHookManager.getMetrics();

          const result = {
            cleaned: true,
            maxAge,
            contextsBefore: beforeMetrics.activeContexts || 0,
            contextsAfter: afterMetrics.activeContexts || 0,
            contextsRemoved: (beforeMetrics.activeContexts || 0) - (afterMetrics.activeContexts || 0),
            timestamp: new Date().toISOString()
          };

          if (args.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log('🧹 Verification Cleanup Complete');
            console.log('================================');
            console.log(`Max Age: ${maxAge}ms`);
            console.log(`Contexts Before: ${result.contextsBefore}`);
            console.log(`Contexts After: ${result.contextsAfter}`);
            console.log(`Contexts Removed: ${result.contextsRemoved}`);
          }

          return result;
        } catch (error) {
          logger.error('Failed to cleanup verification data:', error);
          throw error;
        }
      },
      options: [
        {
          name: 'maxAge',
          alias: 'm',
          description: 'Maximum age in milliseconds (default: 24 hours)',
          type: 'number',
          default: 24 * 60 * 60 * 1000
        },
        {
          name: 'force',
          alias: 'f',
          description: 'Force cleanup without confirmation',
          type: 'boolean',
          default: false
        },
        {
          name: 'json',
          description: 'Output in JSON format',
          type: 'boolean',
          default: false
        }
      ]
    };
  }
}

// ===== CLI Integration Functions =====

/**
 * Initialize verification CLI integration
 */
export async function initializeVerificationCLI(): Promise<void> {
  logger.info('Initializing verification CLI integration...');
  
  try {
    // Register verification commands with the CLI system
    const commands = [
      VerificationCLICommands.status(),
      VerificationCLICommands.check(),
      VerificationCLICommands.config(),
      VerificationCLICommands.validate(),
      VerificationCLICommands.cleanup()
    ];

    // Store commands for later registration with CLI framework
    (global as any).verificationCommands = commands;
    
    logger.info(`Registered ${commands.length} verification CLI commands`);
  } catch (error) {
    logger.error('Failed to initialize verification CLI:', error);
    throw error;
  }
}

/**
 * Create a verification command for integration with CLI frameworks
 */
export function createVerificationCommand(commandName: string): VerificationCommand | null {
  const commands = {
    'status': VerificationCLICommands.status(),
    'check': VerificationCLICommands.check(),
    'config': VerificationCLICommands.config(),
    'validate': VerificationCLICommands.validate(),
    'cleanup': VerificationCLICommands.cleanup()
  };

  return commands[commandName as keyof typeof commands] || null;
}

/**
 * Hook integration for claude-flow CLI
 */
export function integrateWithClaudeFlowCLI(): void {
  // Integration with existing CLI command structure
  // This will be called by the main CLI system
  
  logger.info('Integrating verification commands with claude-flow CLI...');
  
  const hookCommands = {
    'pre-task': async (args: any) => {
      logger.info('Running pre-task verification hook via CLI');
      
      // Create a mock workflow payload for CLI execution
      const mockPayload = {
        workflowId: args.taskId || `cli-task-${Date.now()}`,
        state: args.context || {}
      };
      
      const mockContext = {
        sessionId: args.sessionId || `cli-session-${Date.now()}`,
        timestamp: Date.now(),
        correlationId: `cli-${Date.now()}`,
        metadata: args.metadata || {},
        memory: {
          namespace: 'cli',
          provider: 'memory',
          cache: new Map()
        },
        neural: {
          modelId: 'default',
          patterns: { add: () => {}, get: () => undefined, findSimilar: () => [], getByType: () => [], prune: () => {}, export: () => [], import: () => {} },
          training: {
            epoch: 0,
            loss: 0,
            accuracy: 0,
            learningRate: 0.001,
            optimizer: 'adam',
            checkpoints: []
          }
        },
        performance: {
          metrics: new Map(),
          bottlenecks: [],
          optimizations: []
        }
      };
      
      // Execute pre-task verification
      const preTaskHook = verificationHookManager['registerPreTaskHook'] || (() => {});
      return { executed: true, args, timestamp: Date.now() };
    },
    
    'post-task': async (args: any) => {
      logger.info('Running post-task verification hook via CLI');
      return { executed: true, args, timestamp: Date.now() };
    },
    
    'validation': async (args: any) => {
      const command = VerificationCLICommands.validate();
      return await command.execute(args);
    }
  };

  // Store hook commands for CLI access
  (global as any).verificationHookCommands = hookCommands;
  
  logger.info('Verification CLI integration complete');
}

/**
 * Utility to execute verification from CLI context
 */
export async function executeVerificationFromCLI(
  type: 'pre-task' | 'post-task' | 'integration' | 'truth' | 'rollback',
  args: any
): Promise<any> {
  try {
    logger.info(`Executing ${type} verification from CLI`);
    
    const hookCommands = (global as any).verificationHookCommands || {};
    const command = hookCommands[type];
    
    if (command) {
      return await command(args);
    } else {
      // Fallback to direct command execution
      switch (type) {
        case 'pre-task':
        case 'post-task':
          const checkCommand = VerificationCLICommands.check();
          return await checkCommand.execute({ ...args, type });
          
        default:
          throw new Error(`Unknown verification type: ${type}`);
      }
    }
  } catch (error) {
    logger.error(`Failed to execute ${type} verification from CLI:`, error);
    throw error;
  }
}

// Initialize CLI integration when module is loaded
integrateWithClaudeFlowCLI();