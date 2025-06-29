/**
 * Swarm Verification Framework - Status Schema
 * Mandatory validation schema for swarm operations
 */

export interface SwarmStatusSchema {
  /** Overall operation success status - MANDATORY */
  ok: boolean;
  
  /** Number of errors found - MANDATORY (must be 0 for ok: true) */
  errors: number;
  
  /** Number of agents/processes spawned - MANDATORY */
  spawned: number;
  
  /** ISO timestamp of status generation - MANDATORY */
  timestamp: string;
  
  /** Verification commands that were executed - MANDATORY */
  verification_commands: string[];
  
  /** Optional details about the operation */
  details?: {
    /** Operation objective/description */
    objective?: string;
    
    /** Strategy used */
    strategy?: string;
    
    /** Mode of operation */
    mode?: string;
    
    /** Agent details */
    agents?: {
      total: number;
      active: number;
      failed: number;
      completed: number;
    };
    
    /** Task status */
    tasks?: {
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
    
    /** Memory namespace used */
    memoryNamespace?: string;
    
    /** Duration in milliseconds */
    duration?: number;
  };
  
  /** Error details if errors > 0 */
  error_details?: {
    /** Critical errors that prevent operation */
    critical?: string[];
    
    /** Non-critical warnings */
    warnings?: string[];
    
    /** Failed verification commands */
    failed_commands?: string[];
    
    /** Command outputs for debugging */
    command_outputs?: Record<string, string>;
  };
  
  /** Verification metadata */
  verification?: {
    /** Framework version used */
    framework_version: string;
    
    /** Verification enforcement enabled */
    enforcement_enabled: boolean;
    
    /** Coordinator that performed verification */
    verified_by: string;
    
    /** Verification timestamp */
    verified_at: string;
  };
}

/**
 * Verification command interface
 */
export interface VerificationCommand {
  /** Command to execute for verification */
  command: string;
  
  /** Expected behavior (success/failure) */
  expectation: 'success' | 'failure';
  
  /** Description of what this command verifies */
  description: string;
  
  /** Whether this command is critical for operation success */
  critical: boolean;
  
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Verification result for a single command
 */
export interface VerificationResult {
  /** The command that was executed */
  command: string;
  
  /** Whether the command succeeded */
  success: boolean;
  
  /** Exit code */
  exitCode: number;
  
  /** Command output (stdout) */
  output: string;
  
  /** Command errors (stderr) */
  error: string;
  
  /** Execution duration in milliseconds */
  duration: number;
  
  /** Whether this matches the expected result */
  matches_expectation: boolean;
}

/**
 * Agent verification requirements
 */
export interface AgentVerificationRequirements {
  /** Agent ID */
  agentId: string;
  
  /** Required verification commands for this agent */
  required_commands: VerificationCommand[];
  
  /** Custom status file path (if not status.json) */
  status_file_path?: string;
  
  /** Working directory for command execution */
  working_directory?: string;
  
  /** Environment variables for verification commands */
  environment?: Record<string, string>;
}

/**
 * Coordinator verification settings
 */
export interface CoordinatorVerificationConfig {
  /** Whether verification is mandatory */
  enforcement_enabled: boolean;
  
  /** Default verification commands */
  default_commands: VerificationCommand[];
  
  /** Maximum time to wait for status files */
  status_timeout_ms: number;
  
  /** Whether to fail fast on first verification failure */
  fail_fast: boolean;
  
  /** Directory where status files are expected */
  status_directory: string;
  
  /** Framework version */
  framework_version: string;
}

/**
 * Verification enforcement error
 */
export class VerificationEnforcementError extends Error {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly verification_failures: VerificationResult[],
    public readonly missing_status_file?: boolean
  ) {
    super(message);
    this.name = 'VerificationEnforcementError';
  }
}

/**
 * Status file validation error
 */
export class StatusValidationError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly validation_errors: string[]
  ) {
    super(message);
    this.name = 'StatusValidationError';
  }
}

/**
 * Default verification commands for common scenarios
 */
export const DEFAULT_VERIFICATION_COMMANDS: Record<string, VerificationCommand[]> = {
  typescript: [
    {
      command: 'npm run typecheck',
      expectation: 'success',
      description: 'TypeScript compilation check',
      critical: true,
      timeout: 30000
    }
  ],
  
  spawn_count: [
    {
      command: "grep -r spawn src --include='*.ts' | wc -l",
      expectation: 'success',
      description: 'Count spawn calls in codebase',
      critical: false,
      timeout: 10000
    }
  ],
  
  tests: [
    {
      command: 'npm test',
      expectation: 'success',
      description: 'Run test suite',
      critical: true,
      timeout: 120000
    }
  ],
  
  lint: [
    {
      command: 'npm run lint',
      expectation: 'success',
      description: 'Code linting check',
      critical: false,
      timeout: 30000
    }
  ],
  
  build: [
    {
      command: 'npm run build',
      expectation: 'success',
      description: 'Project build check',
      critical: true,
      timeout: 60000
    }
  ]
};