/**
 * Verification Framework Tests
 * Tests the mandatory status.json validation system
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SwarmVerificationFramework, StatusValidator, getDefaultVerificationRequirements } from '../index.js';
import type { SwarmStatusSchema } from '../index.js';

// Mock logger for testing
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('Swarm Verification Framework', () => {
  let framework: SwarmVerificationFramework;
  let validator: StatusValidator;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(process.cwd(), '.test-verification');
    await mkdir(testDir, { recursive: true });
    
    framework = new SwarmVerificationFramework(mockLogger as any, {
      enforcement_enabled: true,
      status_directory: testDir,
      status_timeout_ms: 5000,
      fail_fast: false
    });
    
    validator = new StatusValidator();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('StatusValidator', () => {
    it('should validate a correct status.json file', async () => {
      const validStatus: SwarmStatusSchema = {
        ok: true,
        errors: 0,
        spawned: 3,
        timestamp: new Date().toISOString(),
        verification_commands: ['npm run typecheck', 'npm test']
      };

      const statusFile = join(testDir, 'valid-status.json');
      await writeFile(statusFile, JSON.stringify(validStatus, null, 2));

      const result = await validator.validateStatusFile(statusFile);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.status).toEqual(validStatus);
    });

    it('should reject status.json with missing required fields', async () => {
      const invalidStatus = {
        ok: true,
        errors: 0
        // Missing: spawned, timestamp, verification_commands
      };

      const statusFile = join(testDir, 'invalid-status.json');
      await writeFile(statusFile, JSON.stringify(invalidStatus, null, 2));

      const result = await validator.validateStatusFile(statusFile);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: spawned');
      expect(result.errors).toContain('Missing required field: timestamp');
      expect(result.errors).toContain('Missing required field: verification_commands');
    });

    it('should enforce business logic: ok=true requires errors=0', async () => {
      const invalidStatus: SwarmStatusSchema = {
        ok: true,
        errors: 2, // Invalid: ok=true but errors > 0
        spawned: 1,
        timestamp: new Date().toISOString(),
        verification_commands: ['npm run typecheck']
      };

      const statusFile = join(testDir, 'business-logic-invalid.json');
      await writeFile(statusFile, JSON.stringify(invalidStatus, null, 2));

      const result = await validator.validateStatusFile(statusFile);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('When "ok" is true, "errors" must be 0');
    });

    it('should reject non-existent status files', async () => {
      const nonExistentFile = join(testDir, 'does-not-exist.json');

      const result = await validator.validateStatusFile(nonExistentFile);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(`Status file does not exist: ${nonExistentFile}`);
    });
  });

  describe('SwarmVerificationFramework', () => {
    it('should create agent status file with template', async () => {
      const agentId = 'test-agent-1';
      const objective = 'Test objective';
      const commands = ['npm run typecheck'];

      const statusFilePath = await framework.createAgentStatusFile(
        agentId,
        objective,
        commands
      );

      const result = await validator.validateStatusFile(statusFilePath);
      
      expect(result.valid).toBe(true);
      expect(result.status?.ok).toBe(false); // Template starts with false
      expect(result.status?.errors).toBe(1); // Template starts with 1 error
      expect(result.status?.spawned).toBe(0); // Template starts with 0
      expect(result.status?.verification_commands).toEqual(commands);
    });

    it('should update status file with verification results', async () => {
      const agentId = 'test-agent-2';
      const statusFilePath = await framework.createAgentStatusFile(
        agentId,
        'Test objective',
        ['npm run typecheck']
      );

      // Update with successful verification
      await framework.updateStatusFile(statusFilePath, {
        ok: true,
        errors: 0,
        spawned: 2,
        details: {
          objective: 'Updated objective',
          duration: 5000
        }
      });

      const result = await validator.validateStatusFile(statusFilePath);
      
      expect(result.valid).toBe(true);
      expect(result.status?.ok).toBe(true);
      expect(result.status?.errors).toBe(0);
      expect(result.status?.spawned).toBe(2);
      expect(result.status?.details?.duration).toBe(5000);
    });

    it('should execute verification commands', async () => {
      const commands = [
        {
          command: 'echo "test"',
          expectation: 'success' as const,
          description: 'Simple echo test',
          critical: false,
          timeout: 5000
        },
        {
          command: 'false', // This command always fails
          expectation: 'failure' as const,
          description: 'Expected failure test',
          critical: false,
          timeout: 5000
        }
      ];

      const results = await framework.executeVerificationCommands(commands);
      
      expect(results).toHaveLength(2);
      
      // First command should succeed and match expectation
      expect(results[0].success).toBe(true);
      expect(results[0].matches_expectation).toBe(true);
      expect(results[0].output.trim()).toBe('test');
      
      // Second command should fail but match expectation (we expected it to fail)
      expect(results[1].success).toBe(false);
      expect(results[1].matches_expectation).toBe(true);
    });

    it('should enforce verification for multiple agents', async () => {
      // Create status files for multiple agents
      const agent1Requirements = getDefaultVerificationRequirements('agent-1', 'general');
      const agent2Requirements = getDefaultVerificationRequirements('agent-2', 'general');
      
      // Modify commands to use simple echo for testing
      agent1Requirements.required_commands = [
        {
          command: 'echo "agent1"',
          expectation: 'success',
          description: 'Agent 1 test',
          critical: true,
          timeout: 5000
        }
      ];
      
      agent2Requirements.required_commands = [
        {
          command: 'echo "agent2"',
          expectation: 'success',
          description: 'Agent 2 test',
          critical: true,
          timeout: 5000
        }
      ];

      // Create status files for both agents
      const statusFile1 = await framework.createAgentStatusFile(
        'agent-1',
        'Test objective 1',
        ['echo "agent1"']
      );
      
      const statusFile2 = await framework.createAgentStatusFile(
        'agent-2',
        'Test objective 2',
        ['echo "agent2"']
      );

      // Update both status files to show success
      await framework.updateStatusFile(statusFile1, {
        ok: true,
        errors: 0,
        spawned: 1
      });
      
      await framework.updateStatusFile(statusFile2, {
        ok: true,
        errors: 0,
        spawned: 1
      });

      // Enforce verification
      const result = await framework.enforceVerification([
        agent1Requirements,
        agent2Requirements
      ]);

      expect(result.success).toBe(true);
      expect(result.summary.successful_agents).toBe(2);
      expect(result.summary.failed_agents).toBe(0);
    });

    it('should fail enforcement when status files are missing', async () => {
      const agentRequirements = getDefaultVerificationRequirements('missing-agent', 'general');
      
      // Modify to use simple command for testing
      agentRequirements.required_commands = [
        {
          command: 'echo "test"',
          expectation: 'success',
          description: 'Test command',
          critical: true,
          timeout: 5000
        }
      ];

      // Don't create the status file - this should fail enforcement
      const result = await framework.enforceVerification([agentRequirements]);

      expect(result.success).toBe(false);
      expect(result.summary.successful_agents).toBe(0);
      expect(result.summary.failed_agents).toBe(1);
      expect(result.summary.missing_status_files).toBe(1);
    });

    it('should fail enforcement when verification commands fail', async () => {
      const agentRequirements = getDefaultVerificationRequirements('failing-agent', 'general');
      
      // Use a command that will fail
      agentRequirements.required_commands = [
        {
          command: 'false', // Always fails
          expectation: 'success', // But we expect success
          description: 'Failing command',
          critical: true,
          timeout: 5000
        }
      ];

      // Create status file
      const statusFile = await framework.createAgentStatusFile(
        'failing-agent',
        'Test objective',
        ['false']
      );

      // Even if we mark the status as successful, verification should fail
      await framework.updateStatusFile(statusFile, {
        ok: true,
        errors: 0,
        spawned: 1
      });

      const result = await framework.enforceVerification([agentRequirements]);

      expect(result.success).toBe(false);
      expect(result.summary.successful_agents).toBe(0);
      expect(result.summary.failed_agents).toBe(1);
    });
  });

  describe('Default verification requirements', () => {
    it('should provide different requirements for different agent types', () => {
      const typescriptReqs = getDefaultVerificationRequirements('ts-agent', 'typescript');
      const testReqs = getDefaultVerificationRequirements('test-agent', 'test');
      const buildReqs = getDefaultVerificationRequirements('build-agent', 'build');
      const generalReqs = getDefaultVerificationRequirements('general-agent', 'general');

      // All should have typecheck command
      expect(typescriptReqs.required_commands.some(cmd => cmd.command.includes('typecheck'))).toBe(true);
      expect(testReqs.required_commands.some(cmd => cmd.command.includes('typecheck'))).toBe(true);
      expect(buildReqs.required_commands.some(cmd => cmd.command.includes('typecheck'))).toBe(true);
      expect(generalReqs.required_commands.some(cmd => cmd.command.includes('typecheck'))).toBe(true);

      // Test type should also have test command
      expect(testReqs.required_commands.some(cmd => cmd.command.includes('npm test'))).toBe(true);

      // Build type should also have build command
      expect(buildReqs.required_commands.some(cmd => cmd.command.includes('npm run build'))).toBe(true);

      // General should have spawn count command
      expect(generalReqs.required_commands.some(cmd => cmd.command.includes('grep -r spawn'))).toBe(true);
    });
  });
});