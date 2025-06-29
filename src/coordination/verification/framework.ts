/**
 * Swarm Verification Framework - Core Framework
 * Orchestrates verification enforcement and command execution
 */

import { spawn } from '../../tracing/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { ILogger } from '../../core/logger.js';
import { StatusValidator } from './status-validator.js';
import type { 
  SwarmStatusSchema,
  VerificationCommand,
  VerificationResult,
  AgentVerificationRequirements,
  CoordinatorVerificationConfig
} from './schema.js';
import { VerificationEnforcementError } from './schema.js';

/**
 * Main verification framework
 */
export class SwarmVerificationFramework {
  private statusValidator: StatusValidator;
  private config: CoordinatorVerificationConfig;
  
  constructor(
    private logger: ILogger,
    config?: Partial<CoordinatorVerificationConfig>
  ) {
    this.statusValidator = new StatusValidator();
    this.config = {
      enforcement_enabled: true,
      default_commands: [
        {
          command: 'npm run typecheck',
          expectation: 'success',
          description: 'TypeScript compilation check',
          critical: true,
          timeout: 30000
        },
        {
          command: "grep -r spawn src --include='*.ts' | wc -l",
          expectation: 'success',
          description: 'Count spawn calls in codebase',
          critical: false,
          timeout: 10000
        }
      ],
      status_timeout_ms: 30000,
      fail_fast: false,
      status_directory: './.claude-flow/swarm-status',
      framework_version: '1.0.0',
      ...config
    };
  }
  
  /**
   * Execute verification commands for an agent
   */
  async executeVerificationCommands(
    commands: VerificationCommand[],
    workingDirectory?: string,
    environment?: Record<string, string>
  ): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];
    
    this.logger.info(`Executing ${commands.length} verification commands`);
    
    for (const command of commands) {
      const startTime = Date.now();
      
      try {
        this.logger.debug(`Executing verification command: ${command.command}`);
        
        const result = await this.executeCommand(
          command.command,
          workingDirectory,
          environment,
          command.timeout
        );
        
        const duration = Date.now() - startTime;
        const matches_expectation = command.expectation === 'success' 
          ? result.exitCode === 0 
          : result.exitCode !== 0;
        
        const verificationResult: VerificationResult = {
          command: command.command,
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          output: result.output,
          error: result.error,
          duration,
          matches_expectation
        };
        
        results.push(verificationResult);
        
        if (command.critical && !matches_expectation && this.config.fail_fast) {
          this.logger.error(`Critical verification command failed: ${command.command}`);
          break;
        }
        
      } catch (error) {
        const duration = Date.now() - startTime;
        
        const verificationResult: VerificationResult = {
          command: command.command,
          success: false,
          exitCode: -1,
          output: '',
          error: error instanceof Error ? error.message : String(error),
          duration,
          matches_expectation: false
        };
        
        results.push(verificationResult);
        
        if (command.critical && this.config.fail_fast) {
          this.logger.error(`Critical verification command failed with error: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
    }
    
    return results;
  }
  
  /**
   * Execute a single command
   */
  private executeCommand(
    command: string,
    workingDirectory?: string,
    environment?: Record<string, string>,
    timeout?: number
  ): Promise<{ exitCode: number; output: string; error: string }> {
    return new Promise((resolve, reject) => {
      const options = {
        cwd: workingDirectory || process.cwd(),
        env: { ...process.env, ...environment },
        shell: true as const
      };
      
      const child = spawn(command, [], options);
      
      let output = '';
      let error = '';
      
      child.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      child.stderr?.on('data', (data) => {
        error += data.toString();
      });
      
      child.on('close', (code) => {
        resolve({
          exitCode: code || 0,
          output,
          error
        });
      });
      
      child.on('error', (err) => {
        reject(err);
      });
      
      // Handle timeout
      if (timeout) {
        setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command timeout after ${timeout}ms: ${command}`));
        }, timeout);
      }
    });
  }
  
  /**
   * Create status.json file for an agent
   */
  async createAgentStatusFile(
    agentId: string,
    objective: string,
    verification_commands: string[],
    customPath?: string
  ): Promise<string> {
    const statusTemplate = this.statusValidator.createStatusTemplate(
      agentId,
      objective,
      verification_commands
    );
    
    const filePath = customPath || join(
      this.config.status_directory,
      `${agentId}-status.json`
    );
    
    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    
    await writeFile(filePath, JSON.stringify(statusTemplate, null, 2));
    
    this.logger.info(`Created status file for agent ${agentId}: ${filePath}`);
    return filePath;
  }
  
  /**
   * Update status.json file with verification results
   */
  async updateStatusFile(
    filePath: string,
    updates: {
      ok?: boolean;
      errors?: number;
      spawned?: number;
      verification_results?: VerificationResult[];
      details?: Partial<SwarmStatusSchema['details']>;
      error_details?: Partial<SwarmStatusSchema['error_details']>;
    }
  ): Promise<void> {
    const validation = await this.statusValidator.validateStatusFile(filePath);
    
    if (!validation.valid || !validation.status) {
      throw new Error(`Cannot update invalid status file: ${filePath}`);
    }
    
    const status = validation.status;
    
    // Update fields
    if (updates.ok !== undefined) status.ok = updates.ok;
    if (updates.errors !== undefined) status.errors = updates.errors;
    if (updates.spawned !== undefined) status.spawned = updates.spawned;
    
    // Update verification commands based on results
    if (updates.verification_results) {
      status.verification_commands = updates.verification_results.map(r => r.command);
      
      // Update error details with failed commands
      const failedCommands = updates.verification_results
        .filter(r => !r.matches_expectation)
        .map(r => r.command);
      
      if (failedCommands.length > 0) {
        status.error_details = status.error_details || {};
        status.error_details.failed_commands = failedCommands;
        status.error_details.command_outputs = {};
        
        updates.verification_results.forEach(r => {
          if (!r.matches_expectation && status.error_details?.command_outputs) {
            status.error_details.command_outputs[r.command] = r.error || r.output;
          }
        });
      }
    }
    
    // Update details
    if (updates.details) {
      status.details = { ...status.details, ...updates.details };
    }
    
    // Update error details
    if (updates.error_details) {
      status.error_details = { ...status.error_details, ...updates.error_details };
    }
    
    // Update timestamp
    status.timestamp = new Date().toISOString();
    
    // Update verification metadata
    if (status.verification) {
      status.verification.verified_at = new Date().toISOString();
    }
    
    await writeFile(filePath, JSON.stringify(status, null, 2));
    this.logger.debug(`Updated status file: ${filePath}`);
  }
  
  /**
   * Enforce verification for a swarm operation
   * This is the main enforcement method called by the coordinator
   */
  async enforceVerification(
    agentRequirements: AgentVerificationRequirements[]
  ): Promise<{
    success: boolean;
    results: Array<{
      agentId: string;
      verification_success: boolean;
      status_valid: boolean;
      verification_results?: VerificationResult[];
      status_file_path?: string;
      errors: string[];
    }>;
    summary: {
      total_agents: number;
      successful_agents: number;
      failed_agents: number;
      missing_status_files: number;
    };
  }> {
    if (!this.config.enforcement_enabled) {
      this.logger.warn('Verification enforcement is disabled');
      return {
        success: true,
        results: agentRequirements.map(req => ({
          agentId: req.agentId,
          verification_success: true,
          status_valid: true,
          errors: ['Verification enforcement disabled']
        })),
        summary: {
          total_agents: agentRequirements.length,
          successful_agents: agentRequirements.length,
          failed_agents: 0,
          missing_status_files: 0
        }
      };
    }
    
    this.logger.info(`Enforcing verification for ${agentRequirements.length} agents`);
    
    const results = [];
    let successful = 0;
    let failed = 0;
    let missing = 0;
    
    for (const requirement of agentRequirements) {
      const agentResult = await this.verifyAgent(requirement);
      results.push(agentResult);
      
      if (agentResult.verification_success && agentResult.status_valid) {
        successful++;
      } else {
        failed++;
        if (agentResult.errors.some(e => e.includes('does not exist'))) {
          missing++;
        }
      }
    }
    
    const success = failed === 0;
    
    this.logger.info(`Verification enforcement complete: ${successful}/${agentRequirements.length} agents passed`);
    
    return {
      success,
      results,
      summary: {
        total_agents: agentRequirements.length,
        successful_agents: successful,
        failed_agents: failed,
        missing_status_files: missing
      }
    };
  }
  
  /**
   * Verify a single agent
   */
  private async verifyAgent(requirement: AgentVerificationRequirements): Promise<{
    agentId: string;
    verification_success: boolean;
    status_valid: boolean;
    verification_results?: VerificationResult[];
    status_file_path?: string;
    errors: string[];
  }> {
    const errors: string[] = [];
    
    try {
      // Execute verification commands
      const verification_results = await this.executeVerificationCommands(
        requirement.required_commands,
        requirement.working_directory,
        requirement.environment
      );
      
      // Check if verification passed
      const verification_success = verification_results.every(r => r.matches_expectation);
      
      if (!verification_success) {
        const failedCommands = verification_results
          .filter(r => !r.matches_expectation)
          .map(r => r.command);
        errors.push(`Verification commands failed: ${failedCommands.join(', ')}`);
      }
      
      // Check status file
      const status_file_path = requirement.status_file_path || 
        join(this.config.status_directory, `${requirement.agentId}-status.json`);
      
      const statusValidation = await this.statusValidator.validateStatusFile(status_file_path);
      
      if (!statusValidation.valid) {
        errors.push(...statusValidation.errors);
      }
      
      // Additional enforcement rules
      if (statusValidation.valid && statusValidation.status) {
        if (!statusValidation.status.ok) {
          errors.push('Status file reports ok: false');
        }
        
        if (statusValidation.status.errors > 0) {
          errors.push(`Status file reports ${statusValidation.status.errors} errors`);
        }
      }
      
      return {
        agentId: requirement.agentId,
        verification_success,
        status_valid: statusValidation.valid,
        verification_results,
        status_file_path,
        errors
      };
      
    } catch (error) {
      errors.push(`Verification failed: ${error instanceof Error ? error.message : String(error)}`);
      
      return {
        agentId: requirement.agentId,
        verification_success: false,
        status_valid: false,
        errors
      };
    }
  }
  
  /**
   * Wait for status files to be created by agents
   */
  async waitForStatusFiles(
    expectedPaths: string[],
    timeoutMs?: number
  ): Promise<{
    found: string[];
    missing: string[];
    timedOut: boolean;
  }> {
    const timeout = timeoutMs || this.config.status_timeout_ms;
    const startTime = Date.now();
    const found: string[] = [];
    const missing: string[] = [...expectedPaths];
    
    this.logger.info(`Waiting for ${expectedPaths.length} status files (timeout: ${timeout}ms)`);
    
    while (missing.length > 0 && (Date.now() - startTime) < timeout) {
      for (let i = missing.length - 1; i >= 0; i--) {
        const path = missing[i];
        if (path && existsSync(path)) {
          const removedPaths = missing.splice(i, 1);
          if (removedPaths.length > 0) {
            const removedPath = removedPaths[0];
            if (removedPath) {
              found.push(removedPath);
              this.logger.debug(`Found status file: ${removedPath}`);
            }
          }
        }
      }
      
      if (missing.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Check every second
      }
    }
    
    const timedOut = missing.length > 0;
    
    if (timedOut) {
      this.logger.warn(`Timed out waiting for status files: ${missing.join(', ')}`);
    } else {
      this.logger.info('All status files found');
    }
    
    return { found, missing, timedOut };
  }
  
  /**
   * Get framework configuration
   */
  getConfig(): CoordinatorVerificationConfig {
    return { ...this.config };
  }
  
  /**
   * Update framework configuration
   */
  updateConfig(updates: Partial<CoordinatorVerificationConfig>): void {
    this.config = { ...this.config, ...updates };
    this.logger.info('Verification framework configuration updated');
  }
  
  /**
   * Generate verification report
   */
  generateVerificationReport(results: any): {
    summary: string;
    details: string;
    recommendations: string[];
  } {
    const summary = `Verification Results: ${results.summary.successful_agents}/${results.summary.total_agents} agents passed`;
    
    const details = results.results
      .map((r: any) => `Agent ${r.agentId}: ${r.verification_success ? 'PASS' : 'FAIL'}`)
      .join('\n');
    
    const recommendations: string[] = [];
    
    if (results.summary.failed_agents > 0) {
      recommendations.push('Review failed agent verification results');
      recommendations.push('Check agent logs for detailed error information');
    }
    
    if (results.summary.missing_status_files > 0) {
      recommendations.push('Ensure all agents create status.json files');
      recommendations.push('Verify agent completion detection logic');
    }
    
    return { summary, details, recommendations };
  }
}

/**
 * Create verification enforcement error
 */
export function createVerificationEnforcementError(
  message: string,
  agentId: string,
  verification_failures: VerificationResult[],
  missing_status_file?: boolean
): VerificationEnforcementError {
  return new VerificationEnforcementError(
    message,
    agentId,
    verification_failures,
    missing_status_file
  );
}

/**
 * Default verification requirements for common agent types
 */
export function getDefaultVerificationRequirements(
  agentId: string,
  agentType: 'typescript' | 'test' | 'build' | 'general' = 'general'
): AgentVerificationRequirements {
  const baseCommands = [
    {
      command: 'npm run typecheck',
      expectation: 'success' as const,
      description: 'TypeScript compilation check',
      critical: true,
      timeout: 30000
    }
  ];
  
  const additionalCommands = {
    typescript: [],
    test: [
      {
        command: 'npm test',
        expectation: 'success' as const,
        description: 'Run test suite',
        critical: true,
        timeout: 120000
      }
    ],
    build: [
      {
        command: 'npm run build',
        expectation: 'success' as const,
        description: 'Project build',
        critical: true,
        timeout: 60000
      }
    ],
    general: [
      {
        command: "grep -r spawn src --include='*.ts' | wc -l",
        expectation: 'success' as const,
        description: 'Count spawn calls',
        critical: false,
        timeout: 10000
      }
    ]
  };
  
  return {
    agentId,
    required_commands: [...baseCommands, ...additionalCommands[agentType]],
    working_directory: process.cwd(),
    environment: {}
  };
}