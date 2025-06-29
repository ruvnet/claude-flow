/**
 * Swarm Verification Framework - Status Validator
 * Validates status.json files against the mandatory schema
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { 
  SwarmStatusSchema, 
  StatusValidationError,
  VerificationResult 
} from './schema.js';

/**
 * Status file validator
 */
export class StatusValidator {
  
  /**
   * Validate a status.json file
   */
  async validateStatusFile(filePath: string): Promise<{
    valid: boolean;
    status?: SwarmStatusSchema;
    errors: string[];
  }> {
    const errors: string[] = [];
    
    try {
      // Check if file exists
      if (!existsSync(filePath)) {
        errors.push(`Status file does not exist: ${filePath}`);
        return { valid: false, errors };
      }
      
      // Read and parse JSON
      const content = await readFile(filePath, 'utf-8');
      let status: any;
      
      try {
        status = JSON.parse(content);
      } catch (parseError) {
        errors.push(`Invalid JSON in status file: ${parseError.message}`);
        return { valid: false, errors };
      }
      
      // Validate schema
      const schemaErrors = this.validateSchema(status);
      errors.push(...schemaErrors);
      
      // Validate business logic
      const logicErrors = this.validateBusinessLogic(status);
      errors.push(...logicErrors);
      
      return {
        valid: errors.length === 0,
        status: errors.length === 0 ? status : undefined,
        errors
      };
      
    } catch (error) {
      errors.push(`Error reading status file: ${error.message}`);
      return { valid: false, errors };
    }
  }
  
  /**
   * Validate status against schema
   */
  private validateSchema(status: any): string[] {
    const errors: string[] = [];
    
    // Check required fields
    const requiredFields = ['ok', 'errors', 'spawned', 'timestamp', 'verification_commands'];
    
    for (const field of requiredFields) {
      if (!(field in status)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Validate field types
    if ('ok' in status && typeof status.ok !== 'boolean') {
      errors.push('Field "ok" must be a boolean');
    }
    
    if ('errors' in status && typeof status.errors !== 'number') {
      errors.push('Field "errors" must be a number');
    }
    
    if ('spawned' in status && typeof status.spawned !== 'number') {
      errors.push('Field "spawned" must be a number');
    }
    
    if ('timestamp' in status && typeof status.timestamp !== 'string') {
      errors.push('Field "timestamp" must be a string');
    }
    
    if ('verification_commands' in status && !Array.isArray(status.verification_commands)) {
      errors.push('Field "verification_commands" must be an array');
    }
    
    // Validate timestamp format
    if ('timestamp' in status && typeof status.timestamp === 'string') {
      try {
        const date = new Date(status.timestamp);
        if (isNaN(date.getTime())) {
          errors.push('Field "timestamp" must be a valid ISO date string');
        }
      } catch {
        errors.push('Field "timestamp" must be a valid ISO date string');
      }
    }
    
    // Validate verification_commands array
    if ('verification_commands' in status && Array.isArray(status.verification_commands)) {
      for (let i = 0; i < status.verification_commands.length; i++) {
        if (typeof status.verification_commands[i] !== 'string') {
          errors.push(`verification_commands[${i}] must be a string`);
        }
      }
    }
    
    return errors;
  }
  
  /**
   * Validate business logic rules
   */
  private validateBusinessLogic(status: any): string[] {
    const errors: string[] = [];
    
    // Rule: If ok is true, errors must be 0
    if (status.ok === true && status.errors !== 0) {
      errors.push('When "ok" is true, "errors" must be 0');
    }
    
    // Rule: If ok is false, errors should be > 0
    if (status.ok === false && status.errors === 0) {
      errors.push('When "ok" is false, "errors" should be greater than 0');
    }
    
    // Rule: errors must be non-negative
    if (typeof status.errors === 'number' && status.errors < 0) {
      errors.push('Field "errors" must be non-negative');
    }
    
    // Rule: spawned must be non-negative
    if (typeof status.spawned === 'number' && status.spawned < 0) {
      errors.push('Field "spawned" must be non-negative');
    }
    
    // Rule: verification_commands should not be empty
    if (Array.isArray(status.verification_commands) && status.verification_commands.length === 0) {
      errors.push('Field "verification_commands" should not be empty');
    }
    
    // Validate error_details if present
    if (status.error_details) {
      if (status.errors === 0) {
        errors.push('Field "error_details" should not be present when errors is 0');
      }
      
      if (!status.error_details.critical && !status.error_details.warnings && !status.error_details.failed_commands) {
        errors.push('Field "error_details" must contain at least one of: critical, warnings, failed_commands');
      }
    }
    
    // Validate details if present
    if (status.details) {
      if (status.details.agents) {
        const agents = status.details.agents;
        const totalAgents = (agents.active || 0) + (agents.failed || 0) + (agents.completed || 0);
        if (agents.total !== totalAgents) {
          errors.push('Agent totals do not match (total !== active + failed + completed)');
        }
      }
      
      if (status.details.tasks) {
        const tasks = status.details.tasks;
        const totalTasks = (tasks.pending || 0) + (tasks.running || 0) + (tasks.completed || 0) + (tasks.failed || 0);
        if (tasks.total !== totalTasks) {
          errors.push('Task totals do not match (total !== pending + running + completed + failed)');
        }
      }
    }
    
    return errors;
  }
  
  /**
   * Create a template status.json for agents to use
   */
  createStatusTemplate(
    agentId: string,
    objective: string,
    verification_commands: string[]
  ): SwarmStatusSchema {
    return {
      ok: false, // Agents must set this to true after verification
      errors: 1, // Start with 1 error, agents must set to 0
      spawned: 0, // Agents must update this
      timestamp: new Date().toISOString(),
      verification_commands,
      details: {
        objective,
        strategy: 'unknown',
        mode: 'unknown',
        agents: {
          total: 0,
          active: 0,
          failed: 0,
          completed: 0
        },
        tasks: {
          total: 0,
          pending: 0,
          running: 0,
          completed: 0,
          failed: 0
        },
        duration: 0
      },
      error_details: {
        critical: ['Status file not yet completed by agent'],
        warnings: [],
        failed_commands: [],
        command_outputs: {}
      },
      verification: {
        framework_version: '1.0.0',
        enforcement_enabled: true,
        verified_by: agentId,
        verified_at: new Date().toISOString()
      }
    };
  }
  
  /**
   * Validate multiple status files from different agents
   */
  async validateMultipleStatusFiles(
    statusFiles: string[]
  ): Promise<{
    allValid: boolean;
    results: Array<{
      filePath: string;
      valid: boolean;
      status?: SwarmStatusSchema;
      errors: string[];
    }>;
    summary: {
      total: number;
      valid: number;
      invalid: number;
      missing: number;
    };
  }> {
    const results = [];
    let validCount = 0;
    let missingCount = 0;
    
    for (const filePath of statusFiles) {
      const result = await this.validateStatusFile(filePath);
      results.push({ ...result, filePath });
      
      if (result.valid) {
        validCount++;
      }
      
      if (result.errors.some(error => error.includes('does not exist'))) {
        missingCount++;
      }
    }
    
    return {
      allValid: validCount === statusFiles.length,
      results,
      summary: {
        total: statusFiles.length,
        valid: validCount,
        invalid: statusFiles.length - validCount,
        missing: missingCount
      }
    };
  }
  
  /**
   * Extract verification status from multiple status files
   */
  extractVerificationSummary(results: Array<{
    filePath: string;
    valid: boolean;
    status?: SwarmStatusSchema;
    errors: string[];
  }>): {
    overall_ok: boolean;
    total_errors: number;
    total_spawned: number;
    verification_commands_used: string[];
    failed_agents: string[];
    error_summary: string[];
  } {
    let overall_ok = true;
    let total_errors = 0;
    let total_spawned = 0;
    const verification_commands_used = new Set<string>();
    const failed_agents: string[] = [];
    const error_summary: string[] = [];
    
    for (const result of results) {
      if (!result.valid) {
        overall_ok = false;
        failed_agents.push(result.filePath);
        error_summary.push(...result.errors);
        continue;
      }
      
      if (result.status) {
        if (!result.status.ok) {
          overall_ok = false;
        }
        
        total_errors += result.status.errors;
        total_spawned += result.status.spawned;
        
        result.status.verification_commands.forEach(cmd => 
          verification_commands_used.add(cmd)
        );
        
        if (result.status.error_details?.critical) {
          error_summary.push(...result.status.error_details.critical);
        }
      }
    }
    
    return {
      overall_ok,
      total_errors,
      total_spawned,
      verification_commands_used: Array.from(verification_commands_used),
      failed_agents,
      error_summary
    };
  }
}

/**
 * Utility function to find status files in a directory
 */
export async function findStatusFiles(directory: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const statusFiles: string[] = [];
  
  try {
    const files = await readdir(directory, { recursive: true });
    
    for (const file of files) {
      if (typeof file === 'string' && file.endsWith('status.json')) {
        statusFiles.push(join(directory, file));
      }
    }
  } catch (error) {
    // Directory might not exist, return empty array
  }
  
  return statusFiles;
}

/**
 * Create a status validation error
 */
export function createStatusValidationError(
  message: string,
  filePath: string,
  validation_errors: string[]
): StatusValidationError {
  const error = new Error(message) as StatusValidationError;
  error.name = 'StatusValidationError';
  error.filePath = filePath;
  error.validation_errors = validation_errors;
  return error;
}