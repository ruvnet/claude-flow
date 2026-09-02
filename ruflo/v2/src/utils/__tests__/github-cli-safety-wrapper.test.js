/**
 * Test suite for GitHub CLI Safety Wrapper
 * 
 * Tests all security features, error handling, and functionality
 */

import { jest } from '@jest/globals';
import { 
  GitHubCliSafe, 
  createGitHubCliSafe, 
  githubCli,
  GitHubCliError,
  GitHubCliTimeoutError,
  GitHubCliValidationError,
  GitHubCliRateLimitError
} from '../github-cli-safety-wrapper.js';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

// Mock child_process and fs
jest.mock('child_process');
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
    unlink: jest.fn(),
  }
}));

describe('GitHubCliSafe', () => {
  let ghSafe;
  let mockSpawn;
  let mockChild;

  beforeEach(() => {
    ghSafe = new GitHubCliSafe({
      timeout: 5000,
      enableRateLimit: false,
      enableLogging: false
    });

    mockChild = {
      kill: jest.fn(),
      on: jest.fn(),
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() }
    };

    mockSpawn = spawn.mockReturnValue(mockChild);
    fs.writeFile.mockResolvedValue();
    fs.unlink.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    test('should validate allowed commands', () => {
      expect(() => ghSafe.validateCommand('issue create')).not.toThrow();
      expect(() => ghSafe.validateCommand('pr comment')).not.toThrow();
      
      expect(() => ghSafe.validateCommand('rm -rf /')).toThrow(GitHubCliValidationError);
      expect(() => ghSafe.validateCommand('maliciouscommand')).toThrow(GitHubCliValidationError);
    });

    test('should reject empty or invalid commands', () => {
      expect(() => ghSafe.validateCommand('')).toThrow(GitHubCliValidationError);
      expect(() => ghSafe.validateCommand(null)).toThrow(GitHubCliValidationError);
      expect(() => ghSafe.validateCommand(undefined)).toThrow(GitHubCliValidationError);
    });

    test('should sanitize dangerous input patterns', () => {
      const dangerousInputs = [
        '$(rm -rf /)',
        '`rm -rf /`',
        'test && rm -rf /',
        'test || rm -rf /',
        'test; rm -rf /',
        'test <(echo malicious)',
        'test > /dev/null',
        'test | sh',
        'eval("malicious")',
        'exec("malicious")'
      ];

      dangerousInputs.forEach(input => {
        expect(() => ghSafe.sanitizeInput(input)).toThrow(GitHubCliValidationError);
      });
    });

    test('should allow safe input', () => {
      const safeInputs = [
        'This is a normal comment',
        'Code example: console.log("hello")',
        'File path: /src/components/Button.jsx',
        'Numbers: 123, versions: v1.2.3',
        'Special chars: @#$%^&*()_+-=[]{}|;:,.<>?'
      ];

      safeInputs.forEach(input => {
        expect(() => ghSafe.sanitizeInput(input)).not.toThrow();
      });
    });

    test('should validate body size limits', () => {
      const largeBody = 'x'.repeat(1024 * 1024 + 1); // > 1MB
      expect(() => ghSafe.validateBodySize(largeBody)).toThrow(GitHubCliValidationError);
      
      const normalBody = 'x'.repeat(1000);
      expect(() => ghSafe.validateBodySize(normalBody)).not.toThrow();
    });
  });

  describe('Process Management', () => {
    test('should spawn process with correct arguments', async () => {
      const mockProcess = setupMockProcess(0, 'success', '');
      
      await ghSafe.execute('issue create', {
        title: 'Test Issue',
        body: 'Test body'
      });

      expect(spawn).toHaveBeenCalledWith('gh', 
        expect.arrayContaining(['issue', 'create', '--title', 'Test Issue']),
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false
        })
      );
    });

    test('should handle process timeout', async () => {
      setupMockProcess(null, '', '', true); // Never completes

      await expect(
        ghSafe.execute('issue create', { title: 'Test' })
      ).rejects.toThrow(GitHubCliTimeoutError);
    });

    test('should handle process failure', async () => {
      setupMockProcess(1, '', 'Command failed');

      await expect(
        ghSafe.execute('issue create', { title: 'Test' })
      ).rejects.toThrow(GitHubCliError);
    });

    test('should cleanup processes on timeout', async () => {
      setupMockProcess(null, '', '', true); // Never completes

      try {
        await ghSafe.execute('issue create', { title: 'Test' });
      } catch (error) {
        expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      }
    });
  });

  describe('Retry Logic', () => {
    test('should retry on transient failures', async () => {
      let attemptCount = 0;
      const operation = jest.fn(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new GitHubCliError('Transient error');
        }
        return { success: true };
      });

      const result = await ghSafe.withRetry(operation, 3);
      expect(result.success).toBe(true);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    test('should not retry validation errors', async () => {
      const operation = jest.fn(() => {
        throw new GitHubCliValidationError('Invalid input');
      });

      await expect(ghSafe.withRetry(operation, 3)).rejects.toThrow(GitHubCliValidationError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should not retry rate limit errors', async () => {
      const operation = jest.fn(() => {
        throw new GitHubCliRateLimitError('Rate limited');
      });

      await expect(ghSafe.withRetry(operation, 3)).rejects.toThrow(GitHubCliRateLimitError);
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits', async () => {
      const rateLimitedGh = new GitHubCliSafe({
        enableRateLimit: true,
        maxRequestsPerWindow: 2,
        rateLimitWindow: 1000
      });

      // Mock successful executions
      setupMockProcess(0, 'success', '');

      // First two requests should succeed
      await rateLimitedGh.execute('auth status');
      await rateLimitedGh.execute('auth status');

      // Third request should be rate limited
      await expect(
        rateLimitedGh.execute('auth status')
      ).rejects.toThrow(GitHubCliRateLimitError);
    });
  });

  describe('Temp File Handling', () => {
    test('should create secure temp files for body content', async () => {
      setupMockProcess(0, 'success', '');

      await ghSafe.execute('issue create', {
        title: 'Test',
        body: 'Test body'
      });

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/gh-safe-.*\.tmp$/),
        'Test body',
        { mode: 0o600 }
      );
    });

    test('should cleanup temp files even on error', async () => {
      setupMockProcess(1, '', 'Error');

      try {
        await ghSafe.execute('issue create', {
          title: 'Test',
          body: 'Test body'
        });
      } catch (error) {
        // Expected to fail
      }

      expect(fs.unlink).toHaveBeenCalled();
    });
  });

  describe('High-level Operations', () => {
    beforeEach(() => {
      setupMockProcess(0, 'Issue created successfully', '');
    });

    test('should create issue with proper arguments', async () => {
      await ghSafe.createIssue({
        title: 'Bug Report',
        body: 'Found a bug',
        labels: ['bug', 'high-priority'],
        assignees: ['user1', 'user2']
      });

      expect(spawn).toHaveBeenCalledWith('gh', 
        expect.arrayContaining([
          'issue', 'create',
          '--title', 'Bug Report',
          '--body-file', expect.stringMatching(/gh-safe-.*\.tmp$/),
          '--label', 'bug,high-priority',
          '--assignee', 'user1,user2'
        ]),
        expect.any(Object)
      );
    });

    test('should create PR with proper arguments', async () => {
      await ghSafe.createPR({
        title: 'Feature: Add new component',
        body: 'Adds new component',
        base: 'develop',
        head: 'feature/new-component',
        draft: true
      });

      expect(spawn).toHaveBeenCalledWith('gh',
        expect.arrayContaining([
          'pr', 'create',
          '--title', 'Feature: Add new component',
          '--body-file', expect.stringMatching(/gh-safe-.*\.tmp$/),
          '--base', 'develop',
          '--head', 'feature/new-component',
          '--draft'
        ]),
        expect.any(Object)
      );
    });

    test('should add issue comment', async () => {
      await ghSafe.addIssueComment(123, 'This is a comment');

      expect(spawn).toHaveBeenCalledWith('gh',
        expect.arrayContaining([
          'issue', 'comment', '123',
          '--body-file', expect.stringMatching(/gh-safe-.*\.tmp$/)
        ]),
        expect.any(Object)
      );
    });
  });

  describe('Utility Methods', () => {
    test('should check GitHub CLI availability', async () => {
      // Mock execSync for version check
      const { execSync } = require('child_process');
      jest.spyOn(require('child_process'), 'execSync').mockImplementation(() => 'gh version 2.0.0');

      const isAvailable = await ghSafe.checkGitHubCli();
      expect(isAvailable).toBe(true);
    });

    test('should get stats', () => {
      const stats = ghSafe.getStats();
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('successfulRequests');
      expect(stats).toHaveProperty('failedRequests');
    });

    test('should cleanup active processes', async () => {
      ghSafe.activeProcesses.set('test-process', mockChild);
      
      await ghSafe.cleanup();
      
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(ghSafe.activeProcesses.size).toBe(0);
    });
  });

  describe('Factory Function', () => {
    test('should create configured instance', () => {
      const instance = createGitHubCliSafe({
        timeout: 10000,
        maxRetries: 5
      });

      expect(instance).toBeInstanceOf(GitHubCliSafe);
      expect(instance.options.timeout).toBe(10000);
      expect(instance.options.maxRetries).toBe(5);
    });
  });

  describe('Singleton Instance', () => {
    test('should provide default singleton', () => {
      expect(githubCli).toBeInstanceOf(GitHubCliSafe);
    });
  });

  // Helper function to setup mock process behavior
  function setupMockProcess(exitCode, stdout = '', stderr = '', neverComplete = false) {
    let closeCallback, errorCallback;
    let stdoutCallback, stderrCallback;

    mockChild.on.mockImplementation((event, callback) => {
      if (event === 'close') closeCallback = callback;
      if (event === 'error') errorCallback = callback;
    });

    mockChild.stdout.on.mockImplementation((event, callback) => {
      if (event === 'data') stdoutCallback = callback;
    });

    mockChild.stderr.on.mockImplementation((event, callback) => {
      if (event === 'data') stderrCallback = callback;
    });

    // Simulate process execution
    if (!neverComplete) {
      setTimeout(() => {
        if (stdoutCallback && stdout) stdoutCallback(Buffer.from(stdout));
        if (stderrCallback && stderr) stderrCallback(Buffer.from(stderr));
        if (closeCallback) closeCallback(exitCode);
      }, 10);
    }
  }
});

describe('Error Classes', () => {
  test('GitHubCliError should contain proper details', () => {
    const error = new GitHubCliError('Test error', 'TEST_CODE', { test: true });
    
    expect(error.name).toBe('GitHubCliError');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toEqual({ test: true });
    expect(error.timestamp).toBeDefined();
  });

  test('GitHubCliTimeoutError should extend GitHubCliError', () => {
    const error = new GitHubCliTimeoutError(5000, 'gh issue create');
    
    expect(error).toBeInstanceOf(GitHubCliError);
    expect(error.name).toBe('GitHubCliTimeoutError');
    expect(error.code).toBe('TIMEOUT');
  });

  test('GitHubCliValidationError should contain field info', () => {
    const error = new GitHubCliValidationError('Invalid field', 'testField', 'testValue');
    
    expect(error.name).toBe('GitHubCliValidationError');
    expect(error.details.field).toBe('testField');
    expect(error.details.value).toBe('testValue');
  });
});