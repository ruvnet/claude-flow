/**
 * Swarm Verification Framework - Main Export
 * 
 * This verification framework enforces mandatory status.json validation
 * for all swarm operations to prevent aspirational reporting.
 */

export {
  // Core framework
  SwarmVerificationFramework,
  createVerificationEnforcementError,
  getDefaultVerificationRequirements
} from './framework.js';

export {
  // Status validation
  StatusValidator,
  findStatusFiles,
  createStatusValidationError
} from './status-validator.js';

export {
  // Types and schemas
  type SwarmStatusSchema,
  type VerificationCommand,
  type VerificationResult,
  type AgentVerificationRequirements,
  type CoordinatorVerificationConfig,
  VerificationEnforcementError,
  StatusValidationError,
  DEFAULT_VERIFICATION_COMMANDS
} from './schema.js';

// Framework version and metadata
export const VERIFICATION_FRAMEWORK_VERSION = '1.0.0';
export const VERIFICATION_FRAMEWORK_NAME = 'Claude-Flow Swarm Verification Framework';

/**
 * Quick setup function for basic verification
 */
export function createBasicVerificationFramework(logger: any): SwarmVerificationFramework {
  const { SwarmVerificationFramework } = require('./framework.js');
  
  return new SwarmVerificationFramework(logger, {
    enforcement_enabled: true,
    fail_fast: false,
    status_timeout_ms: 30000,
    status_directory: './.claude-flow/swarm-status'
  });
}

/**
 * Framework documentation and usage
 */
export const FRAMEWORK_DOCUMENTATION = {
  purpose: 'Enforce verification before reporting for swarm operations',
  
  usage: {
    coordinator: 'Call enforceVerification() before completing swarm operations',
    agents: 'Create and update status.json files with verification results',
    validation: 'Use StatusValidator to check status.json files'
  },
  
  required_status_fields: [
    'ok: boolean - Overall operation success',
    'errors: number - Number of errors (must be 0 for ok: true)',
    'spawned: number - Number of agents/processes spawned',
    'timestamp: string - ISO timestamp',
    'verification_commands: string[] - Commands executed for verification'
  ],
  
  enforcement_rules: [
    'Missing status.json file = operation failure',
    'Invalid status.json schema = operation failure',
    'ok: false or errors > 0 = operation failure',
    'Failed verification commands = operation failure'
  ],
  
  examples: {
    valid_status: {
      ok: true,
      errors: 0,
      spawned: 3,
      timestamp: '2025-06-29T12:00:00.000Z',
      verification_commands: ['npm run typecheck', 'npm test']
    },
    
    invalid_status: {
      ok: false,
      errors: 2,
      spawned: 1,
      timestamp: '2025-06-29T12:00:00.000Z',
      verification_commands: ['npm run typecheck'],
      error_details: {
        critical: ['TypeScript compilation failed'],
        failed_commands: ['npm run typecheck']
      }
    }
  }
};

/**
 * Memory storage key patterns for coordination
 */
export const MEMORY_KEYS = {
  VERIFICATION_FRAMEWORK: 'swarm-development-hierarchical-1751174468691/verification-system/framework',
  VERIFICATION_CONFIG: 'swarm-development-hierarchical-1751174468691/verification-system/config',
  VERIFICATION_TEMPLATES: 'swarm-development-hierarchical-1751174468691/verification-system/templates',
  VERIFICATION_PATTERNS: 'swarm-development-hierarchical-1751174468691/verification-system/patterns'
} as const;