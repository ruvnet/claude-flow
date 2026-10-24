/**
 * Safe Executor Tests - HIGH-1 Remediation Validation
 *
 * Tests verify:
 * - Commands execute without shell
 * - Command allowlist enforcement
 * - Argument sanitization
 * - Dangerous pattern detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SafeExecutor,
  SafeExecutorError,
  createDevelopmentExecutor,
  createReadOnlyExecutor,
} from '../../security/safe-executor.js';

describe('SafeExecutor', () => {
  let executor: SafeExecutor;

  beforeEach(() => {
    executor = new SafeExecutor({
      allowedCommands: ['echo', 'ls', 'git', 'npm', 'node'],
      timeout: 5000,
    });
  });

  describe('Configuration', () => {
    it('should require at least one allowed command', () => {
      expect(() => new SafeExecutor({
        allowedCommands: [],
      })).toThrow(SafeExecutorError);
    });

    it('should reject dangerous commands in allowlist', () => {
      expect(() => new SafeExecutor({
        allowedCommands: ['rm'],
      })).toThrow(SafeExecutorError);
    });

    it('should reject multiple dangerous commands', () => {
      expect(() => new SafeExecutor({
        allowedCommands: ['chmod', 'chown', 'rm'],
      })).toThrow(SafeExecutorError);
    });

    it('should allow safe commands', () => {
      expect(() => new SafeExecutor({
        allowedCommands: ['git', 'npm', 'node'],
      })).not.toThrow();
    });
  });

  describe('Command Validation', () => {
    it('should allow commands in allowlist', async () => {
      const result = await executor.execute('echo', ['hello']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('should block commands not in allowlist', async () => {
      await expect(executor.execute('cat', ['/etc/passwd'])).rejects.toThrow(SafeExecutorError);
    });

    it('should block sudo commands by default', async () => {
      const sudoExecutor = new SafeExecutor({
        allowedCommands: ['sudo', 'ls'],
        allowSudo: false,
      });

      await expect(sudoExecutor.execute('sudo', ['ls'])).rejects.toThrow(SafeExecutorError);
    });

    it('should allow sudo when configured', async () => {
      const sudoExecutor = new SafeExecutor({
        allowedCommands: ['sudo', 'ls'],
        allowSudo: true,
      });

      // Will fail due to password requirement, but shouldn't throw allowlist error
      const error = await sudoExecutor.execute('sudo', ['-n', 'ls']).catch(e => e);
      if (error instanceof SafeExecutorError) {
        expect(error.code).not.toBe('SUDO_NOT_ALLOWED');
      }
    });
  });

  describe('Argument Validation', () => {
    it('should block null bytes in arguments', async () => {
      await expect(executor.execute('echo', ['hello\x00world'])).rejects.toThrow(SafeExecutorError);
    });

    it('should block semicolon (command chaining)', async () => {
      await expect(executor.execute('echo', ['hello; rm -rf /'])).rejects.toThrow(SafeExecutorError);
    });

    it('should block && (command chaining)', async () => {
      await expect(executor.execute('echo', ['hello && rm -rf /'])).rejects.toThrow(SafeExecutorError);
    });

    it('should block || (command chaining)', async () => {
      await expect(executor.execute('echo', ['hello || rm -rf /'])).rejects.toThrow(SafeExecutorError);
    });

    it('should block pipe character', async () => {
      await expect(executor.execute('echo', ['hello | cat'])).rejects.toThrow(SafeExecutorError);
    });

    it('should block backticks (command substitution)', async () => {
      await expect(executor.execute('echo', ['`whoami`'])).rejects.toThrow(SafeExecutorError);
    });

    it('should block $() (command substitution)', async () => {
      await expect(executor.execute('echo', ['$(whoami)'])).rejects.toThrow(SafeExecutorError);
    });

    it('should block redirect operators', async () => {
      await expect(executor.execute('echo', ['hello > /etc/passwd'])).rejects.toThrow(SafeExecutorError);
    });

    it('should block newlines', async () => {
      await expect(executor.execute('echo', ['hello\nrm -rf /'])).rejects.toThrow(SafeExecutorError);
    });

    it('should allow safe arguments', async () => {
      const result = await executor.execute('echo', ['hello', 'world']);
      expect(result.exitCode).toBe(0);
    });

    it('should allow arguments with dashes', async () => {
      const result = await executor.execute('echo', ['-n', 'hello']);
      expect(result.exitCode).toBe(0);
    });

    it('should allow arguments with equals', async () => {
      const result = await executor.execute('echo', ['KEY=value']);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Argument Sanitization', () => {
    it('should sanitize null bytes', () => {
      const sanitized = executor.sanitizeArgument('hello\x00world');
      expect(sanitized).not.toContain('\x00');
    });

    it('should sanitize shell metacharacters', () => {
      const sanitized = executor.sanitizeArgument('hello; rm -rf /');
      expect(sanitized).not.toContain(';');
    });
  });

  describe('Command Execution', () => {
    it('should return stdout', async () => {
      const result = await executor.execute('echo', ['hello']);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('should return stderr', async () => {
      // Use node to generate stderr
      const result = await executor.execute('node', ['-e', 'console.error("error")']);
      expect(result.stderr.trim()).toBe('error');
    });

    it('should return exit code', async () => {
      const result = await executor.execute('node', ['-e', 'process.exit(42)']);
      expect(result.exitCode).toBe(42);
    });

    it('should track execution duration', async () => {
      const result = await executor.execute('echo', ['hello']);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should include command in result', async () => {
      const result = await executor.execute('echo', ['hello']);
      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello']);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running commands', async () => {
      const shortTimeoutExecutor = new SafeExecutor({
        allowedCommands: ['node'],
        timeout: 100,
      });

      await expect(
        shortTimeoutExecutor.execute('node', ['-e', 'setTimeout(() => {}, 10000)'])
      ).rejects.toThrow(SafeExecutorError);
    });
  });

  describe('Streaming Execution', () => {
    it('should return process handle', () => {
      const streaming = executor.executeStreaming('echo', ['hello']);
      expect(streaming.process).toBeDefined();
      expect(streaming.promise).toBeInstanceOf(Promise);

      // Clean up
      streaming.process.kill();
    });

    it('should stream stdout', async () => {
      const streaming = executor.executeStreaming('echo', ['hello']);
      const result = await streaming.promise;
      expect(result.stdout.trim()).toBe('hello');
    });
  });

  describe('Dynamic Allowlist', () => {
    it('should check if command is allowed', () => {
      expect(executor.isCommandAllowed('echo')).toBe(true);
      expect(executor.isCommandAllowed('cat')).toBe(false);
    });

    it('should add commands at runtime', () => {
      expect(executor.isCommandAllowed('pwd')).toBe(false);
      executor.allowCommand('pwd');
      expect(executor.isCommandAllowed('pwd')).toBe(true);
    });

    it('should reject dangerous commands when adding', () => {
      expect(() => executor.allowCommand('rm')).toThrow(SafeExecutorError);
    });

    it('should return allowed commands', () => {
      const commands = executor.getAllowedCommands();
      expect(commands).toContain('echo');
      expect(commands).toContain('git');
    });
  });

  describe('Factory Functions', () => {
    it('should create development executor', () => {
      const devExecutor = createDevelopmentExecutor();
      expect(devExecutor.isCommandAllowed('git')).toBe(true);
      expect(devExecutor.isCommandAllowed('npm')).toBe(true);
      expect(devExecutor.isCommandAllowed('node')).toBe(true);
    });

    it('should create read-only executor', () => {
      const readOnlyExecutor = createReadOnlyExecutor();
      expect(readOnlyExecutor.isCommandAllowed('git')).toBe(true);
      expect(readOnlyExecutor.isCommandAllowed('cat')).toBe(true);
      expect(readOnlyExecutor.isCommandAllowed('ls')).toBe(true);
    });
  });

  describe('HIGH-1 Security Verification', () => {
    it('should NOT use shell for execution', async () => {
      // If shell were enabled, this would be interpreted as command chaining
      // With shell disabled, it's just a string argument
      const result = await executor.execute('echo', ['hello']);
      expect(result.exitCode).toBe(0);

      // This should fail validation before reaching execution
      await expect(executor.execute('echo', ['hello; cat /etc/passwd'])).rejects.toThrow();
    });

    it('should prevent command injection via arguments', async () => {
      // Classic injection attempts
      const injections = [
        'hello; rm -rf /',
        'hello && rm -rf /',
        'hello || rm -rf /',
        'hello | rm -rf /',
        '`rm -rf /`',
        '$(rm -rf /)',
        'hello\nrm -rf /',
        'hello\x00rm -rf /',
      ];

      for (const injection of injections) {
        await expect(executor.execute('echo', [injection])).rejects.toThrow(SafeExecutorError);
      }
    });

    it('should prevent environment variable injection', async () => {
      await expect(executor.execute('echo', ['${PATH}'])).rejects.toThrow(SafeExecutorError);
    });

    it('should not allow arbitrary commands', async () => {
      // Only commands in allowlist should execute
      await expect(executor.execute('wget', ['http://evil.com'])).rejects.toThrow(SafeExecutorError);
      await expect(executor.execute('curl', ['http://evil.com'])).rejects.toThrow(SafeExecutorError);
      await expect(executor.execute('bash', ['-c', 'rm -rf /'])).rejects.toThrow(SafeExecutorError);
    });
  });
});
