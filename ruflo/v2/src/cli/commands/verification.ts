/**
 * Verification Commands for Claude Flow CLI
 * 
 * Provides CLI commands for verification system management and execution.
 * Integrates with the existing claude-flow command structure.
 */

import { Logger } from '../../core/logger.js';
import { 
  verificationHookManager,
  VerificationCLICommands,
  createVerificationCommand,
  executeVerificationFromCLI
} from '../../verification/index.js';

const logger = new Logger({
  level: 'info',
  format: 'text',
  destination: 'console'
}, { prefix: 'VerificationCLI' });

/**
 * Main verification command that provides subcommands
 */
export async function verificationCommand(args: any): Promise<any> {
  const { subcommand = 'status', ...subArgs } = args;
  
  try {
    logger.debug(`Executing verification subcommand: ${subcommand}`);
    
    switch (subcommand) {
      case 'status':
        return await executeStatusCommand(subArgs);
        
      case 'check':
        return await executeCheckCommand(subArgs);
        
      case 'config':
        return await executeConfigCommand(subArgs);
        
      case 'validate':
        return await executeValidateCommand(subArgs);
        
      case 'cleanup':
        return await executeCleanupCommand(subArgs);
        
      case 'pre-task':
        return await executePreTaskCommand(subArgs);
        
      case 'post-task':
        return await executePostTaskCommand(subArgs);
        
      case 'integration':
        return await executeIntegrationCommand(subArgs);
        
      case 'truth':
        return await executeTruthCommand(subArgs);
        
      case 'rollback':
        return await executeRollbackCommand(subArgs);
        
      case 'help':
        return showVerificationHelp();
        
      default:
        throw new Error(`Unknown verification subcommand: ${subcommand}`);
    }
  } catch (error) {
    logger.error(`Verification command failed:`, error);
    throw error;
  }
}

/**
 * Execute status command
 */
async function executeStatusCommand(args: any): Promise<any> {
  const command = VerificationCLICommands.status();
  return await command.execute(args);
}

/**
 * Execute check command
 */
async function executeCheckCommand(args: any): Promise<any> {
  const command = VerificationCLICommands.check();
  return await command.execute(args);
}

/**
 * Execute config command
 */
async function executeConfigCommand(args: any): Promise<any> {
  const command = VerificationCLICommands.config();
  return await command.execute(args);
}

/**
 * Execute validate command
 */
async function executeValidateCommand(args: any): Promise<any> {
  const command = VerificationCLICommands.validate();
  return await command.execute(args);
}

/**
 * Execute cleanup command
 */
async function executeCleanupCommand(args: any): Promise<any> {
  const command = VerificationCLICommands.cleanup();
  return await command.execute(args);
}

/**
 * Execute pre-task verification
 */
async function executePreTaskCommand(args: any): Promise<any> {
  return await executeVerificationFromCLI('pre-task', args);
}

/**
 * Execute post-task verification
 */
async function executePostTaskCommand(args: any): Promise<any> {
  return await executeVerificationFromCLI('post-task', args);
}

/**
 * Execute integration tests
 */
async function executeIntegrationCommand(args: any): Promise<any> {
  return await executeVerificationFromCLI('integration', args);
}

/**
 * Execute truth telemetry
 */
async function executeTruthCommand(args: any): Promise<any> {
  return await executeVerificationFromCLI('truth', args);
}

/**
 * Execute rollback
 */
async function executeRollbackCommand(args: any): Promise<any> {
  return await executeVerificationFromCLI('rollback', args);
}

/**
 * Show verification help
 */
function showVerificationHelp(): any {
  const help = `
🔍 Claude Flow Verification System

USAGE:
  npx claude-flow verification <subcommand> [options]

SUBCOMMANDS:
  status      Show verification system status and metrics
  check       Run verification checks for a specific task
  config      View or update verification configuration
  validate    Run post-task validation for a completed task
  cleanup     Cleanup old verification contexts and snapshots
  pre-task    Run pre-task verification hooks
  post-task   Run post-task verification hooks
  integration Run integration test hooks
  truth       Run truth telemetry hooks
  rollback    Execute rollback procedures
  help        Show this help message

EXAMPLES:
  npx claude-flow verification status
  npx claude-flow verification check --taskId task-123
  npx claude-flow verification config --action set --key preTask.enabled --value true
  npx claude-flow verification validate --taskId task-123
  npx claude-flow verification cleanup --force --maxAge 86400000
  npx claude-flow verification pre-task --taskId task-123 --sessionId session-456
  npx claude-flow verification post-task --taskId task-123
  npx claude-flow verification integration --parallel true
  npx claude-flow verification truth --metric accuracy --threshold 0.8
  npx claude-flow verification rollback --taskId task-123 --strategy automatic

GLOBAL OPTIONS:
  --json      Output results in JSON format
  --verbose   Enable verbose logging
  --help      Show help for specific subcommand

For more information about a specific subcommand:
  npx claude-flow verification <subcommand> --help
`;

  console.log(help);
  return { help: true };
}

/**
 * Hook command for direct hook execution (for backward compatibility)
 */
export async function hookCommand(args: any): Promise<any> {
  const { type, ...hookArgs } = args;
  
  try {
    logger.info(`Executing hook command: ${type}`);
    
    switch (type) {
      case 'pre-task':
      case 'pre_task':
        return await executeVerificationFromCLI('pre-task', hookArgs);
        
      case 'post-task':
      case 'post_task':
        return await executeVerificationFromCLI('post-task', hookArgs);
        
      case 'validation':
        const validateCommand = VerificationCLICommands.validate();
        return await validateCommand.execute(hookArgs);
        
      case 'integration':
      case 'integration-test':
        return await executeVerificationFromCLI('integration', hookArgs);
        
      case 'truth':
      case 'truth-telemetry':
        return await executeVerificationFromCLI('truth', hookArgs);
        
      case 'rollback':
        return await executeVerificationFromCLI('rollback', hookArgs);
        
      default:
        throw new Error(`Unknown hook type: ${type}`);
    }
  } catch (error) {
    logger.error(`Hook command failed:`, error);
    throw error;
  }
}

/**
 * Command definitions for CLI integration
 */
export const VERIFICATION_COMMANDS = {
  verification: {
    name: 'verification',
    description: 'Verification system management and execution',
    handler: verificationCommand,
    subcommands: {
      status: {
        name: 'status',
        description: 'Show verification system status',
        options: {
          json: { type: 'boolean', description: 'Output in JSON format' }
        }
      },
      check: {
        name: 'check',
        description: 'Run verification checks',
        options: {
          taskId: { type: 'string', required: true, description: 'Task ID to check' },
          type: { type: 'string', description: 'Type of checks to run' },
          json: { type: 'boolean', description: 'Output in JSON format' }
        }
      },
      config: {
        name: 'config',
        description: 'Manage verification configuration',
        options: {
          action: { type: 'string', description: 'Action to perform (show, set)' },
          key: { type: 'string', description: 'Configuration key' },
          value: { type: 'string', description: 'Configuration value' },
          json: { type: 'boolean', description: 'Output in JSON format' }
        }
      },
      validate: {
        name: 'validate',
        description: 'Run post-task validation',
        options: {
          taskId: { type: 'string', required: true, description: 'Task ID to validate' },
          force: { type: 'boolean', description: 'Force validation even if not complete' },
          json: { type: 'boolean', description: 'Output in JSON format' }
        }
      },
      cleanup: {
        name: 'cleanup',
        description: 'Cleanup old verification data',
        options: {
          maxAge: { type: 'number', description: 'Maximum age in milliseconds' },
          force: { type: 'boolean', description: 'Force cleanup without confirmation' },
          json: { type: 'boolean', description: 'Output in JSON format' }
        }
      }
    }
  },
  
  hook: {
    name: 'hook',
    description: 'Execute verification hooks directly',
    handler: hookCommand,
    options: {
      type: { type: 'string', required: true, description: 'Hook type to execute' },
      taskId: { type: 'string', description: 'Task ID for context' },
      sessionId: { type: 'string', description: 'Session ID for context' },
      json: { type: 'boolean', description: 'Output in JSON format' }
    }
  }
};

/**
 * Integration function for registering commands with CLI framework
 */
export function registerVerificationCommands(commandRegistry: any): void {
  try {
    // Register main verification command
    commandRegistry.register({
      name: 'verification',
      description: 'Verification system management',
      handler: verificationCommand,
      examples: [
        'npx claude-flow verification status',
        'npx claude-flow verification check --taskId task-123',
        'npx claude-flow verification validate --taskId task-123'
      ]
    });

    // Register hook command for backward compatibility
    commandRegistry.register({
      name: 'hook',
      description: 'Execute verification hooks',
      handler: hookCommand,
      examples: [
        'npx claude-flow hook --type pre-task --taskId task-123',
        'npx claude-flow hook --type post-task --taskId task-123'
      ]
    });

    logger.info('Verification commands registered successfully');
  } catch (error) {
    logger.error('Failed to register verification commands:', error);
    throw error;
  }
}

/**
 * Default export for CLI integration
 */
export default {
  commands: VERIFICATION_COMMANDS,
  register: registerVerificationCommands,
  handlers: {
    verification: verificationCommand,
    hook: hookCommand
  }
};