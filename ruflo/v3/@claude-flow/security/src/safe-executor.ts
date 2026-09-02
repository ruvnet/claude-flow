/**
 * Safe Executor - HIGH-1 Remediation
 *
 * Fixes command injection vulnerabilities by:
 * - Using execFile instead of exec with shell
 * - Validating all command arguments
 * - Implementing command allowlist
 * - Sanitizing command inputs
 *
 * Security Properties:
 * - No shell interpretation
 * - Argument validation
 * - Command allowlist enforcement
 * - Timeout controls
 * - Resource limits
 *
 * @module v3/security/safe-executor
 */

import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export interface ExecutorConfig {
  /**
   * Allowed commands (allowlist).
   * Only commands in this list can be executed.
   */
  allowedCommands: string[];

  /**
   * Blocked argument patterns (regex strings).
   * Arguments matching these patterns are rejected.
   */
  blockedPatterns?: string[];

  /**
   * Maximum execution timeout in milliseconds.
   * Default: 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Maximum buffer size for stdout/stderr.
   * Default: 10MB
   */
  maxBuffer?: number;

  /**
   * Working directory for command execution.
   * Default: process.cwd()
   */
  cwd?: string;

  /**
   * Environment variables to include.
   * Default: process.env
   */
  env?: NodeJS.ProcessEnv;

  /**
   * Whether to allow sudo commands.
   * Default: false
   */
  allowSudo?: boolean;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  args: string[];
  duration: number;
}

export interface StreamingExecutor {
  process: ChildProcess;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  promise: Promise<ExecutionResult>;
}

export class SafeExecutorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly command?: string,
    public readonly args?: string[],
  ) {
    super(message);
    this.name = 'SafeExecutorError';
  }
}

/**
 * Default blocked argument patterns.
 * These patterns indicate potential command injection attempts.
 */
const DEFAULT_BLOCKED_PATTERNS = [
  // Shell metacharacters
  ';',
  '&&',
  '||',
  '|',
  '`',
  '$(',
  '${',
  // Redirection
  '>',
  '<',
  '>>',
  // Background execution
  '&',
  // Newlines (command chaining)
  '\n',
  '\r',
  // Null byte injection
  '\0',
  // Command substitution
  '$()',
];

/**
 * Commands that are inherently dangerous and should never be allowed.
 */
const DANGEROUS_COMMANDS = [
  'rm',
  'rmdir',
  'del',
  'format',
  'mkfs',
  'dd',
  'chmod',
  'chown',
  'kill',
  'killall',
  'pkill',
  'reboot',
  'shutdown',
  'init',
  'poweroff',
  'halt',
];

/**
 * Safe command executor that prevents command injection.
 *
 * This class replaces unsafe exec() and spawn({shell: true}) calls
 * with validated execFile() calls.
 *
 * @example
 * ```typescript
 * const executor = new SafeExecutor({
 *   allowedCommands: ['git', 'npm', 'node']
 * });
 *
 * const result = await executor.execute('git', ['status']);
 * ```
 */
export class SafeExecutor {
  private readonly config: Required<ExecutorConfig>;
  private readonly blockedPatterns: RegExp[];

  constructor(config: ExecutorConfig) {
    this.config = {
      allowedCommands: config.allowedCommands,
      blockedPatterns: config.blockedPatterns ?? DEFAULT_BLOCKED_PATTERNS,
      timeout: config.timeout ?? 30000,
      maxBuffer: config.maxBuffer ?? 10 * 1024 * 1024, // 10MB
      cwd: config.cwd ?? process.cwd(),
      env: config.env ?? process.env,
      allowSudo: config.allowSudo ?? false,
    };

    // Compile blocked patterns for performance
    this.blockedPatterns = this.config.blockedPatterns.map(
      pattern => new RegExp(this.escapeRegExp(pattern), 'i')
    );

    this.validateConfig();
  }

  /**
   * Escapes special regex characters.
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Validates executor configuration.
   */
  private validateConfig(): void {
    if (this.config.allowedCommands.length === 0) {
      throw new SafeExecutorError(
        'At least one allowed command must be specified',
        'EMPTY_ALLOWLIST'
      );
    }

    // Check for dangerous commands in allowlist
    const dangerousAllowed = this.config.allowedCommands.filter(
      cmd => DANGEROUS_COMMANDS.includes(path.basename(cmd))
    );

    if (dangerousAllowed.length > 0) {
      throw new SafeExecutorError(
        `Dangerous commands cannot be allowed: ${dangerousAllowed.join(', ')}`,
        'DANGEROUS_COMMAND_ALLOWED'
      );
    }
  }

  /**
   * Validates a command against the allowlist.
   *
   * @param command - Command to validate
   * @throws SafeExecutorError if command is not allowed
   */
  private validateCommand(command: string): void {
    const basename = path.basename(command);

    // Check if command is allowed
    const isAllowed = this.config.allowedCommands.some(allowed => {
      const allowedBasename = path.basename(allowed);
      return command === allowed || basename === allowedBasename;
    });

    if (!isAllowed) {
      throw new SafeExecutorError(
        `Command not in allowlist: ${command}`,
        'COMMAND_NOT_ALLOWED',
        command
      );
    }

    // Check for sudo
    if (!this.config.allowSudo && (command === 'sudo' || basename === 'sudo')) {
      throw new SafeExecutorError(
        'Sudo commands are not allowed',
        'SUDO_NOT_ALLOWED',
        command
      );
    }
  }

  /**
   * Validates command arguments for injection patterns.
   *
   * @param args - Arguments to validate
   * @throws SafeExecutorError if arguments contain dangerous patterns
   */
  private validateArguments(args: string[]): void {
    for (const arg of args) {
      // Check for null bytes
      if (arg.includes('\0')) {
        throw new SafeExecutorError(
          'Null byte detected in argument',
          'NULL_BYTE_INJECTION',
          undefined,
          args
        );
      }

      // Check against blocked patterns
      for (const pattern of this.blockedPatterns) {
        if (pattern.test(arg)) {
          throw new SafeExecutorError(
            `Dangerous pattern detected in argument: ${arg}`,
            'DANGEROUS_PATTERN',
            undefined,
            args
          );
        }
      }

      // Check for command chaining attempts
      if (/^-.*[;&|]/.test(arg)) {
        throw new SafeExecutorError(
          `Potential command chaining in argument: ${arg}`,
          'COMMAND_CHAINING',
          undefined,
          args
        );
      }
    }
  }

  /**
   * Sanitizes a single argument.
   *
   * @param arg - Argument to sanitize
   * @returns Sanitized argument
   */
  sanitizeArgument(arg: string): string {
    // Remove null bytes
    let sanitized = arg.replace(/\0/g, '');

    // Remove shell metacharacters
    sanitized = sanitized.replace(/[;&|`$(){}><\n\r]/g, '');

    return sanitized;
  }

  /**
   * Executes a command safely.
   *
   * @param command - Command to execute (must be in allowlist)
   * @param args - Command arguments
   * @returns Execution result
   * @throws SafeExecutorError on validation failure or execution error
   */
  async execute(command: string, args: string[] = []): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Validate command
    this.validateCommand(command);

    // Validate arguments
    this.validateArguments(args);

    try {
      // Execute command WITHOUT shell
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: this.config.cwd,
        env: this.config.env,
        timeout: this.config.timeout,
        maxBuffer: this.config.maxBuffer,
        shell: false, // CRITICAL: Never use shell
        windowsHide: true,
      });

      return {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0,
        command,
        args,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      // Handle execution errors
      if (error.killed) {
        throw new SafeExecutorError(
          'Command execution timed out',
          'TIMEOUT',
          command,
          args
        );
      }

      if (error.code === 'ENOENT') {
        throw new SafeExecutorError(
          `Command not found: ${command}`,
          'COMMAND_NOT_FOUND',
          command,
          args
        );
      }

      // Return result with non-zero exit code
      return {
        stdout: error.stdout?.toString() ?? '',
        stderr: error.stderr?.toString() ?? error.message,
        exitCode: error.code ?? 1,
        command,
        args,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Executes a command with streaming output.
   *
   * @param command - Command to execute
   * @param args - Command arguments
   * @returns Streaming executor with process handles
   */
  executeStreaming(command: string, args: string[] = []): StreamingExecutor {
    const startTime = Date.now();

    // Validate command
    this.validateCommand(command);

    // Validate arguments
    this.validateArguments(args);

    // Spawn process WITHOUT shell
    const childProcess = spawn(command, args, {
      cwd: this.config.cwd,
      env: this.config.env,
      timeout: this.config.timeout,
      shell: false, // CRITICAL: Never use shell
      windowsHide: true,
    });

    const promise = new Promise<ExecutionResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
          command,
          args,
          duration: Date.now() - startTime,
        });
      });

      childProcess.on('error', (error) => {
        reject(new SafeExecutorError(
          error.message,
          'EXECUTION_ERROR',
          command,
          args
        ));
      });
    });

    return {
      process: childProcess,
      stdout: childProcess.stdout,
      stderr: childProcess.stderr,
      promise,
    };
  }

  /**
   * Adds a command to the allowlist at runtime.
   *
   * @param command - Command to add
   */
  allowCommand(command: string): void {
    const basename = path.basename(command);

    if (DANGEROUS_COMMANDS.includes(basename)) {
      throw new SafeExecutorError(
        `Cannot allow dangerous command: ${command}`,
        'DANGEROUS_COMMAND'
      );
    }

    if (!this.config.allowedCommands.includes(command)) {
      this.config.allowedCommands.push(command);
    }
  }

  /**
   * Checks if a command is allowed.
   *
   * @param command - Command to check
   * @returns True if command is allowed
   */
  isCommandAllowed(command: string): boolean {
    const basename = path.basename(command);
    return this.config.allowedCommands.some(allowed => {
      const allowedBasename = path.basename(allowed);
      return command === allowed || basename === allowedBasename;
    });
  }

  /**
   * Returns the current allowlist.
   */
  getAllowedCommands(): readonly string[] {
    return [...this.config.allowedCommands];
  }
}

/**
 * Factory function to create a safe executor for common development tasks.
 *
 * @returns Configured SafeExecutor for git, npm, and node
 */
export function createDevelopmentExecutor(): SafeExecutor {
  return new SafeExecutor({
    allowedCommands: [
      'git',
      'npm',
      'npx',
      'node',
      'tsc',
      'vitest',
      'eslint',
      'prettier',
    ],
  });
}

/**
 * Factory function to create a read-only executor.
 * Only allows commands that read without modifying.
 *
 * @returns Configured SafeExecutor for read operations
 */
export function createReadOnlyExecutor(): SafeExecutor {
  return new SafeExecutor({
    allowedCommands: [
      'git',
      'cat',
      'head',
      'tail',
      'ls',
      'find',
      'grep',
      'which',
      'echo',
    ],
    timeout: 10000,
  });
}
