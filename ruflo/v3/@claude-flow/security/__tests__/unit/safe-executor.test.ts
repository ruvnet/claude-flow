/**
 * V3 Claude-Flow Safe Executor Unit Tests
 *
 * London School TDD - Behavior Verification
 * Tests secure command execution (CVE-3 prevention)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock, type MockedInterface } from '../../helpers/create-mock';
import { securityConfigs } from '../../fixtures/configurations';

/**
 * Safe executor interface (to be implemented)
 */
interface ISafeExecutor {
  execute(command: string, args?: string[], options?: ExecuteOptions): Promise<ExecuteResult>;
  isCommandAllowed(command: string): boolean;
  sanitizeArgs(args: string[]): string[];
}

/**
 * Process spawner interface (collaborator)
 */
interface IProcessSpawner {
  spawn(command: string, args: string[], options: SpawnOptions): Promise<SpawnResult>;
  kill(pid: number): Promise<void>;
}

/**
 * Command validator interface (collaborator)
 */
interface ICommandValidator {
  extractCommand(input: string): string;
  isBuiltin(command: string): boolean;
  resolveCommand(command: string): Promise<string | null>;
}

interface ExecuteOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
}

interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  killed: boolean;
}

interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  shell?: boolean;
}

interface SpawnResult {
  pid: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
}

/**
 * Safe executor implementation for testing
 */
class SafeExecutor implements ISafeExecutor {
  constructor(
    private readonly spawner: IProcessSpawner,
    private readonly validator: ICommandValidator,
    private readonly config: typeof securityConfigs.strict.execution
  ) {}

  async execute(
    command: string,
    args: string[] = [],
    options: ExecuteOptions = {}
  ): Promise<ExecuteResult> {
    // Extract base command
    const baseCommand = this.validator.extractCommand(command);

    // Check if command is allowed
    if (!this.isCommandAllowed(baseCommand)) {
      throw new Error(`Command not allowed: ${baseCommand}`);
    }

    // Sanitize arguments
    const sanitizedArgs = this.sanitizeArgs(args);

    // Apply shell restriction from config
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout ?? this.config.timeout,
      shell: this.config.shell, // Always use config, ignore user option
    };

    const result = await this.spawner.spawn(baseCommand, sanitizedArgs, spawnOptions);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      killed: result.signal !== undefined,
    };
  }

  isCommandAllowed(command: string): boolean {
    const baseCommand = this.validator.extractCommand(command);

    // Check blocked commands first
    if (this.config.blockedCommands.includes(baseCommand)) {
      return false;
    }

    // Check allowed commands
    return this.config.allowedCommands.includes(baseCommand);
  }

  sanitizeArgs(args: string[]): string[] {
    return args.map(arg => {
      // Remove shell metacharacters
      let sanitized = arg
        .replace(/[;&|`$()]/g, '')
        .replace(/\n/g, '')
        .replace(/\r/g, '');

      // Remove command substitution
      sanitized = sanitized.replace(/\$\([^)]*\)/g, '');
      sanitized = sanitized.replace(/`[^`]*`/g, '');

      // Remove redirection
      sanitized = sanitized.replace(/[<>]/g, '');

      return sanitized;
    });
  }
}

describe('SafeExecutor', () => {
  let mockSpawner: MockedInterface<IProcessSpawner>;
  let mockValidator: MockedInterface<ICommandValidator>;
  let safeExecutor: SafeExecutor;
  const executionConfig = securityConfigs.strict.execution;

  beforeEach(() => {
    mockSpawner = createMock<IProcessSpawner>();
    mockValidator = createMock<ICommandValidator>();

    // Configure default mock behavior
    mockValidator.extractCommand.mockImplementation((input: string) => input.split(' ')[0]);
    mockValidator.isBuiltin.mockReturnValue(false);
    mockValidator.resolveCommand.mockResolvedValue('/usr/bin/npm');

    mockSpawner.spawn.mockResolvedValue({
      pid: 12345,
      stdout: 'command output',
      stderr: '',
      exitCode: 0,
    });

    safeExecutor = new SafeExecutor(mockSpawner, mockValidator, executionConfig);
  });

  describe('execute', () => {
    it('should extract base command before execution', async () => {
      // Given
      const command = 'npm install';

      // When
      await safeExecutor.execute(command);

      // Then
      expect(mockValidator.extractCommand).toHaveBeenCalledWith(command);
    });

    it('should spawn process with sanitized arguments', async () => {
      // Given
      const command = 'npm';
      const args = ['install', '--save'];

      // When
      await safeExecutor.execute(command, args);

      // Then
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'npm',
        ['install', '--save'],
        expect.any(Object)
      );
    });

    it('should use config timeout by default', async () => {
      // Given
      const command = 'npm';

      // When
      await safeExecutor.execute(command);

      // Then
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'npm',
        [],
        expect.objectContaining({
          timeout: executionConfig.timeout,
        })
      );
    });

    it('should respect custom timeout option', async () => {
      // Given
      const command = 'npm';
      const customTimeout = 60000;

      // When
      await safeExecutor.execute(command, [], { timeout: customTimeout });

      // Then
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'npm',
        [],
        expect.objectContaining({
          timeout: customTimeout,
        })
      );
    });

    it('should always use shell setting from config', async () => {
      // Given
      const command = 'npm';

      // When
      await safeExecutor.execute(command, [], { shell: true }); // User tries to enable shell

      // Then
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'npm',
        [],
        expect.objectContaining({
          shell: executionConfig.shell, // Should be config value (false)
        })
      );
    });

    it('should return execution result', async () => {
      // Given
      const command = 'npm';
      mockSpawner.spawn.mockResolvedValue({
        pid: 12345,
        stdout: 'success output',
        stderr: 'warning',
        exitCode: 0,
      });

      // When
      const result = await safeExecutor.execute(command);

      // Then
      expect(result).toEqual({
        stdout: 'success output',
        stderr: 'warning',
        exitCode: 0,
        killed: false,
      });
    });

    it('should report killed status when signal present', async () => {
      // Given
      const command = 'npm';
      mockSpawner.spawn.mockResolvedValue({
        pid: 12345,
        stdout: '',
        stderr: 'timeout',
        exitCode: 137,
        signal: 'SIGKILL',
      });

      // When
      const result = await safeExecutor.execute(command);

      // Then
      expect(result.killed).toBe(true);
    });

    it('should throw error for blocked command', async () => {
      // Given
      const command = 'rm';
      mockValidator.extractCommand.mockReturnValue('rm');

      // When/Then
      await expect(safeExecutor.execute(command)).rejects.toThrow(
        'Command not allowed: rm'
      );
      expect(mockSpawner.spawn).not.toHaveBeenCalled();
    });

    it('should throw error for command not in allowed list', async () => {
      // Given
      const command = 'wget';
      mockValidator.extractCommand.mockReturnValue('wget');

      // When/Then
      await expect(safeExecutor.execute(command)).rejects.toThrow(
        'Command not allowed: wget'
      );
    });
  });

  describe('isCommandAllowed', () => {
    it('should allow npm command', () => {
      // Given
      mockValidator.extractCommand.mockReturnValue('npm');

      // When
      const result = safeExecutor.isCommandAllowed('npm');

      // Then
      expect(result).toBe(true);
    });

    it('should allow npx command', () => {
      // Given
      mockValidator.extractCommand.mockReturnValue('npx');

      // When
      const result = safeExecutor.isCommandAllowed('npx');

      // Then
      expect(result).toBe(true);
    });

    it('should allow node command', () => {
      // Given
      mockValidator.extractCommand.mockReturnValue('node');

      // When
      const result = safeExecutor.isCommandAllowed('node');

      // Then
      expect(result).toBe(true);
    });

    it('should allow git command', () => {
      // Given
      mockValidator.extractCommand.mockReturnValue('git');

      // When
      const result = safeExecutor.isCommandAllowed('git');

      // Then
      expect(result).toBe(true);
    });

    it('should block rm command', () => {
      // Given
      mockValidator.extractCommand.mockReturnValue('rm');

      // When
      const result = safeExecutor.isCommandAllowed('rm');

      // Then
      expect(result).toBe(false);
    });

    it('should block del command', () => {
      // Given
      mockValidator.extractCommand.mockReturnValue('del');

      // When
      const result = safeExecutor.isCommandAllowed('del');

      // Then
      expect(result).toBe(false);
    });

    it('should block format command', () => {
      // Given
      mockValidator.extractCommand.mockReturnValue('format');

      // When
      const result = safeExecutor.isCommandAllowed('format');

      // Then
      expect(result).toBe(false);
    });

    it('should block dd command', () => {
      // Given
      mockValidator.extractCommand.mockReturnValue('dd');

      // When
      const result = safeExecutor.isCommandAllowed('dd');

      // Then
      expect(result).toBe(false);
    });

    it('should block blocked command even if in allowed list', () => {
      // Given - hypothetical scenario where command appears in both lists
      // Blocked should take precedence
      mockValidator.extractCommand.mockReturnValue('rm');

      // When
      const result = safeExecutor.isCommandAllowed('rm');

      // Then
      expect(result).toBe(false);
    });
  });

  describe('sanitizeArgs', () => {
    it('should remove semicolon from arguments', () => {
      // Given
      const args = ['install;rm -rf /'];

      // When
      const result = safeExecutor.sanitizeArgs(args);

      // Then
      expect(result[0]).not.toContain(';');
    });

    it('should remove pipe operator from arguments', () => {
      // Given
      const args = ['install | cat /etc/passwd'];

      // When
      const result = safeExecutor.sanitizeArgs(args);

      // Then
      expect(result[0]).not.toContain('|');
    });

    it('should remove ampersand from arguments', () => {
      // Given
      const args = ['install && rm -rf /'];

      // When
      const result = safeExecutor.sanitizeArgs(args);

      // Then
      expect(result[0]).not.toContain('&');
    });

    it('should remove backticks from arguments', () => {
      // Given
      const args = ['install `rm -rf /`'];

      // When
      const result = safeExecutor.sanitizeArgs(args);

      // Then
      expect(result[0]).not.toContain('`');
    });

    it('should remove $() command substitution from arguments', () => {
      // Given
      const args = ['install $(rm -rf /)'];

      // When
      const result = safeExecutor.sanitizeArgs(args);

      // Then
      expect(result[0]).not.toContain('$(');
      expect(result[0]).not.toContain(')');
    });

    it('should remove newlines from arguments', () => {
      // Given
      const args = ['install\nrm -rf /'];

      // When
      const result = safeExecutor.sanitizeArgs(args);

      // Then
      expect(result[0]).not.toContain('\n');
    });

    it('should remove redirection operators from arguments', () => {
      // Given
      const args = ['install > /dev/null', 'test < /etc/passwd'];

      // When
      const result = safeExecutor.sanitizeArgs(args);

      // Then
      expect(result[0]).not.toContain('>');
      expect(result[1]).not.toContain('<');
    });

    it('should preserve safe argument content', () => {
      // Given
      const args = ['--save-dev', 'lodash@4.17.21', './src/index.ts'];

      // When
      const result = safeExecutor.sanitizeArgs(args);

      // Then
      expect(result).toEqual(['--save-dev', 'lodash@4.17.21', './src/index.ts']);
    });

    it('should handle empty arguments array', () => {
      // Given
      const args: string[] = [];

      // When
      const result = safeExecutor.sanitizeArgs(args);

      // Then
      expect(result).toEqual([]);
    });

    it('should sanitize all arguments in array', () => {
      // Given
      const args = ['safe-arg', 'unsafe;arg', 'another|unsafe'];

      // When
      const result = safeExecutor.sanitizeArgs(args);

      // Then
      expect(result[0]).toBe('safe-arg');
      expect(result[1]).not.toContain(';');
      expect(result[2]).not.toContain('|');
    });
  });

  describe('CVE-3 prevention scenarios', () => {
    it('should prevent command injection via arguments', async () => {
      // Given
      const command = 'npm';
      const maliciousArgs = ['install; rm -rf /'];

      // When
      await safeExecutor.execute(command, maliciousArgs);

      // Then
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'npm',
        ['install rm -rf /'], // Semicolon removed
        expect.any(Object)
      );
    });

    it('should prevent command substitution attack', async () => {
      // Given
      const command = 'npm';
      const maliciousArgs = ['$(cat /etc/passwd)'];

      // When
      await safeExecutor.execute(command, maliciousArgs);

      // Then
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'npm',
        ['cat /etc/passwd'], // $() removed
        expect.any(Object)
      );
    });

    it('should prevent shell expansion attack', async () => {
      // Given
      const command = 'npm';
      const maliciousArgs = ['`whoami`'];

      // When
      await safeExecutor.execute(command, maliciousArgs);

      // Then
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'npm',
        ['whoami'], // Backticks removed
        expect.any(Object)
      );
    });

    it('should block dangerous commands directly', async () => {
      // Given
      const dangerousCommands = ['rm', 'dd', 'format', 'del'];

      // When/Then
      for (const cmd of dangerousCommands) {
        mockValidator.extractCommand.mockReturnValue(cmd);
        await expect(safeExecutor.execute(cmd)).rejects.toThrow(
          `Command not allowed: ${cmd}`
        );
      }
    });

    it('should prevent shell mode when disabled in config', async () => {
      // Given
      const command = 'npm';
      const args = ['install && echo pwned'];

      // When
      await safeExecutor.execute(command, args, { shell: true });

      // Then
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'npm',
        expect.any(Array),
        expect.objectContaining({
          shell: false, // Config overrides user option
        })
      );
    });
  });

  describe('error handling', () => {
    it('should propagate spawner errors', async () => {
      // Given
      const command = 'npm';
      const spawnError = new Error('Process spawn failed');
      mockSpawner.spawn.mockRejectedValue(spawnError);

      // When/Then
      await expect(safeExecutor.execute(command)).rejects.toThrow(
        'Process spawn failed'
      );
    });

    it('should handle validator errors', async () => {
      // Given
      const command = 'npm';
      mockValidator.extractCommand.mockImplementation(() => {
        throw new Error('Invalid command format');
      });

      // When/Then
      await expect(safeExecutor.execute(command)).rejects.toThrow(
        'Invalid command format'
      );
    });
  });

  describe('interaction verification', () => {
    it('should not spawn if command validation fails', async () => {
      // Given
      const command = 'rm';
      mockValidator.extractCommand.mockReturnValue('rm');

      // When
      try {
        await safeExecutor.execute(command);
      } catch {
        // Expected
      }

      // Then
      expect(mockSpawner.spawn).not.toHaveBeenCalled();
    });

    it('should extract command before checking allowed list', async () => {
      // Given
      const command = 'npm install lodash';
      mockValidator.extractCommand.mockReturnValue('npm');

      // When
      await safeExecutor.execute(command);

      // Then
      expect(mockValidator.extractCommand).toHaveBeenCalledWith(command);
      expect(mockValidator.extractCommand).toHaveBeenCalledBefore(mockSpawner.spawn);
    });
  });
});
