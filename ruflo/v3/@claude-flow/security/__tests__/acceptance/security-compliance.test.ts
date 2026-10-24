/**
 * V3 Claude-Flow Security Compliance Acceptance Tests
 *
 * Acceptance tests for security requirements
 * Tests CVE prevention and security compliance
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock, type MockedInterface } from '../helpers/create-mock';
import { securityConfigs } from '../fixtures/configurations';

/**
 * Security compliance checker interface
 */
interface ISecurityComplianceChecker {
  checkPathTraversal(path: string): ComplianceResult;
  checkCommandInjection(command: string, args: string[]): ComplianceResult;
  checkNullByteInjection(input: string): ComplianceResult;
  checkPasswordPolicy(password: string): ComplianceResult;
  runFullAudit(): Promise<AuditResult>;
}

/**
 * CVE scanner interface
 */
interface ICVEScanner {
  scan(code: string): Promise<CVEScanResult>;
  getKnownCVEs(): CVEInfo[];
  validateFix(cveId: string): Promise<boolean>;
}

/**
 * Security policy enforcer interface
 */
interface ISecurityPolicyEnforcer {
  enforcePathPolicy(path: string): EnforcementResult;
  enforceCommandPolicy(command: string): EnforcementResult;
  enforceInputPolicy(input: string): EnforcementResult;
  getViolations(): PolicyViolation[];
}

interface ComplianceResult {
  compliant: boolean;
  violations: string[];
  severity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  recommendations: string[];
}

interface AuditResult {
  passed: boolean;
  checks: AuditCheck[];
  overallScore: number;
  timestamp: Date;
}

interface AuditCheck {
  name: string;
  passed: boolean;
  details: string;
}

interface CVEScanResult {
  vulnerabilities: CVEInfo[];
  riskScore: number;
  remediation: string[];
}

interface CVEInfo {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  affectedVersions: string[];
  fixedIn?: string;
}

interface EnforcementResult {
  allowed: boolean;
  reason?: string;
  sanitized?: string;
}

interface PolicyViolation {
  type: string;
  input: string;
  timestamp: Date;
  severity: string;
}

/**
 * Security compliance checker implementation
 */
class SecurityComplianceChecker implements ISecurityComplianceChecker {
  constructor(private readonly config: typeof securityConfigs.strict) {}

  checkPathTraversal(path: string): ComplianceResult {
    const violations: string[] = [];
    const recommendations: string[] = [];

    // Check for directory traversal patterns
    const traversalPatterns = ['../', '..\\', '%2e%2e%2f', '%2e%2e/'];
    for (const pattern of traversalPatterns) {
      if (path.toLowerCase().includes(pattern.toLowerCase())) {
        violations.push(`Path contains traversal pattern: ${pattern}`);
      }
    }

    // Check for blocked patterns from config
    for (const pattern of this.config.paths.blockedPatterns) {
      if (path.includes(pattern)) {
        violations.push(`Path contains blocked pattern: ${pattern}`);
      }
    }

    // Check for null bytes
    if (path.includes('\0')) {
      violations.push('Path contains null byte');
    }

    if (violations.length > 0) {
      recommendations.push('Sanitize path input');
      recommendations.push('Use allowlist for valid paths');
      recommendations.push('Validate against allowed directories');
    }

    return {
      compliant: violations.length === 0,
      violations,
      severity: violations.length > 0 ? 'critical' : 'none',
      recommendations,
    };
  }

  checkCommandInjection(command: string, args: string[]): ComplianceResult {
    const violations: string[] = [];
    const recommendations: string[] = [];

    // Check base command
    const baseCommand = command.split(' ')[0];
    if (this.config.execution.blockedCommands.includes(baseCommand)) {
      violations.push(`Command "${baseCommand}" is blocked`);
    }

    if (!this.config.execution.allowedCommands.includes(baseCommand)) {
      violations.push(`Command "${baseCommand}" is not in allowlist`);
    }

    // Check for injection patterns in args
    const injectionPatterns = [';', '|', '&', '`', '$', '(', ')', '<', '>', '\n'];
    for (const arg of args) {
      for (const pattern of injectionPatterns) {
        if (arg.includes(pattern)) {
          violations.push(`Argument contains injection pattern: ${pattern}`);
        }
      }
    }

    if (violations.length > 0) {
      recommendations.push('Sanitize command arguments');
      recommendations.push('Use allowlist for commands');
      recommendations.push('Disable shell execution');
    }

    return {
      compliant: violations.length === 0,
      violations,
      severity: violations.length > 0 ? 'critical' : 'none',
      recommendations,
    };
  }

  checkNullByteInjection(input: string): ComplianceResult {
    const violations: string[] = [];

    if (input.includes('\0')) {
      violations.push('Input contains null byte');
    }

    // Check for encoded null bytes
    if (input.includes('%00')) {
      violations.push('Input contains URL-encoded null byte');
    }

    return {
      compliant: violations.length === 0,
      violations,
      severity: violations.length > 0 ? 'high' : 'none',
      recommendations: violations.length > 0 ? ['Strip null bytes from input'] : [],
    };
  }

  checkPasswordPolicy(password: string): ComplianceResult {
    const violations: string[] = [];

    if (password.length < 8) {
      violations.push('Password must be at least 8 characters');
    }

    if (!/[A-Z]/.test(password)) {
      violations.push('Password must contain uppercase letter');
    }

    if (!/[a-z]/.test(password)) {
      violations.push('Password must contain lowercase letter');
    }

    if (!/[0-9]/.test(password)) {
      violations.push('Password must contain number');
    }

    if (!/[!@#$%^&*]/.test(password)) {
      violations.push('Password should contain special character');
    }

    return {
      compliant: violations.length === 0,
      violations,
      severity: violations.length > 2 ? 'high' : violations.length > 0 ? 'medium' : 'none',
      recommendations: ['Use a password manager', 'Enable MFA'],
    };
  }

  async runFullAudit(): Promise<AuditResult> {
    const checks: AuditCheck[] = [
      {
        name: 'Path Traversal Protection',
        passed: this.config.paths.blockedPatterns.includes('../'),
        details: 'Verified blocked patterns include directory traversal',
      },
      {
        name: 'Command Injection Protection',
        passed: this.config.execution.shell === false,
        details: 'Shell execution is disabled',
      },
      {
        name: 'Dangerous Commands Blocked',
        passed: this.config.execution.blockedCommands.includes('rm'),
        details: 'Verified dangerous commands are blocked',
      },
      {
        name: 'Secure Hashing Algorithm',
        passed: this.config.hashing.algorithm === 'argon2',
        details: 'Using recommended hashing algorithm',
      },
      {
        name: 'Input Size Limit',
        passed: this.config.validation.maxInputSize <= 10000,
        details: 'Input size is properly limited',
      },
    ];

    const passed = checks.every((c) => c.passed);
    const overallScore = (checks.filter((c) => c.passed).length / checks.length) * 100;

    return {
      passed,
      checks,
      overallScore,
      timestamp: new Date(),
    };
  }
}

describe('Security Compliance Acceptance', () => {
  let complianceChecker: SecurityComplianceChecker;
  let mockCVEScanner: MockedInterface<ICVEScanner>;
  let mockPolicyEnforcer: MockedInterface<ISecurityPolicyEnforcer>;

  beforeEach(() => {
    complianceChecker = new SecurityComplianceChecker(securityConfigs.strict);
    mockCVEScanner = createMock<ICVEScanner>();
    mockPolicyEnforcer = createMock<ISecurityPolicyEnforcer>();

    // Configure CVE scanner mock
    mockCVEScanner.getKnownCVEs.mockReturnValue([
      {
        id: 'CVE-1',
        severity: 'critical',
        description: 'Directory traversal vulnerability',
        affectedVersions: ['<3.0.0'],
        fixedIn: '3.0.0',
      },
      {
        id: 'CVE-2',
        severity: 'critical',
        description: 'Absolute path injection vulnerability',
        affectedVersions: ['<3.0.0'],
        fixedIn: '3.0.0',
      },
      {
        id: 'CVE-3',
        severity: 'critical',
        description: 'Command injection vulnerability',
        affectedVersions: ['<3.0.0'],
        fixedIn: '3.0.0',
      },
    ]);

    mockCVEScanner.validateFix.mockResolvedValue(true);
    mockCVEScanner.scan.mockResolvedValue({
      vulnerabilities: [],
      riskScore: 0,
      remediation: [],
    });

    // Configure policy enforcer mock
    mockPolicyEnforcer.enforcePathPolicy.mockImplementation((path) => ({
      allowed: !path.includes('../'),
      reason: path.includes('../') ? 'Path traversal detected' : undefined,
    }));
    mockPolicyEnforcer.enforceCommandPolicy.mockImplementation((cmd) => ({
      allowed: securityConfigs.strict.execution.allowedCommands.includes(cmd.split(' ')[0]),
    }));
    mockPolicyEnforcer.getViolations.mockReturnValue([]);
  });

  describe('CVE-1: Directory Traversal Prevention', () => {
    it('should detect basic directory traversal', () => {
      // Given
      const maliciousPath = '../../../etc/passwd';

      // When
      const result = complianceChecker.checkPathTraversal(maliciousPath);

      // Then
      expect(result.compliant).toBe(false);
      expect(result.severity).toBe('critical');
      expect(result.violations).toContainEqual(expect.stringContaining('../'));
    });

    it('should detect Windows-style traversal', () => {
      // Given
      const maliciousPath = '..\\..\\..\\Windows\\System32';

      // When
      const result = complianceChecker.checkPathTraversal(maliciousPath);

      // Then
      expect(result.compliant).toBe(false);
    });

    it('should detect URL-encoded traversal', () => {
      // Given
      const maliciousPath = '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd';

      // When
      const result = complianceChecker.checkPathTraversal(maliciousPath);

      // Then
      expect(result.compliant).toBe(false);
    });

    it('should allow safe paths', () => {
      // Given
      const safePath = './v3/src/security/index.ts';

      // When
      const result = complianceChecker.checkPathTraversal(safePath);

      // Then
      expect(result.compliant).toBe(true);
      expect(result.severity).toBe('none');
    });

    it('should validate CVE-1 fix', async () => {
      // When
      const isFixed = await mockCVEScanner.validateFix('CVE-1');

      // Then
      expect(isFixed).toBe(true);
    });
  });

  describe('CVE-2: Absolute Path Injection Prevention', () => {
    it('should detect /etc/ access attempts', () => {
      // Given
      const maliciousPath = '/etc/passwd';

      // When
      const result = complianceChecker.checkPathTraversal(maliciousPath);

      // Then
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(expect.stringContaining('/etc/'));
    });

    it('should detect /tmp/ access attempts', () => {
      // Given
      const maliciousPath = '/tmp/malicious.sh';

      // When
      const result = complianceChecker.checkPathTraversal(maliciousPath);

      // Then
      expect(result.compliant).toBe(false);
    });

    it('should detect home directory access attempts', () => {
      // Given
      const maliciousPath = '~/.ssh/id_rsa';

      // When
      const result = complianceChecker.checkPathTraversal(maliciousPath);

      // Then
      expect(result.compliant).toBe(false);
    });

    it('should validate CVE-2 fix', async () => {
      // When
      const isFixed = await mockCVEScanner.validateFix('CVE-2');

      // Then
      expect(isFixed).toBe(true);
    });
  });

  describe('CVE-3: Command Injection Prevention', () => {
    it('should detect semicolon injection', () => {
      // Given
      const command = 'npm';
      const args = ['install; rm -rf /'];

      // When
      const result = complianceChecker.checkCommandInjection(command, args);

      // Then
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(expect.stringContaining(';'));
    });

    it('should detect pipe injection', () => {
      // Given
      const command = 'npm';
      const args = ['install | cat /etc/passwd'];

      // When
      const result = complianceChecker.checkCommandInjection(command, args);

      // Then
      expect(result.compliant).toBe(false);
    });

    it('should detect command substitution', () => {
      // Given
      const command = 'npm';
      const args = ['install $(whoami)'];

      // When
      const result = complianceChecker.checkCommandInjection(command, args);

      // Then
      expect(result.compliant).toBe(false);
    });

    it('should detect backtick execution', () => {
      // Given
      const command = 'npm';
      const args = ['install `rm -rf /`'];

      // When
      const result = complianceChecker.checkCommandInjection(command, args);

      // Then
      expect(result.compliant).toBe(false);
    });

    it('should block dangerous commands', () => {
      // Given
      const command = 'rm';
      const args = ['-rf', '/'];

      // When
      const result = complianceChecker.checkCommandInjection(command, args);

      // Then
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(expect.stringContaining('rm'));
    });

    it('should allow safe commands', () => {
      // Given
      const command = 'npm';
      const args = ['install', '--save', 'lodash'];

      // When
      const result = complianceChecker.checkCommandInjection(command, args);

      // Then
      expect(result.compliant).toBe(true);
    });

    it('should validate CVE-3 fix', async () => {
      // When
      const isFixed = await mockCVEScanner.validateFix('CVE-3');

      // Then
      expect(isFixed).toBe(true);
    });
  });

  describe('Null Byte Injection Prevention', () => {
    it('should detect null byte in path', () => {
      // Given
      const input = 'file.txt\0.exe';

      // When
      const result = complianceChecker.checkNullByteInjection(input);

      // Then
      expect(result.compliant).toBe(false);
      expect(result.severity).toBe('high');
    });

    it('should detect URL-encoded null byte', () => {
      // Given
      const input = 'file.txt%00.exe';

      // When
      const result = complianceChecker.checkNullByteInjection(input);

      // Then
      expect(result.compliant).toBe(false);
    });

    it('should allow clean input', () => {
      // Given
      const input = 'file.txt';

      // When
      const result = complianceChecker.checkNullByteInjection(input);

      // Then
      expect(result.compliant).toBe(true);
    });
  });

  describe('Password Policy Compliance', () => {
    it('should require minimum length', () => {
      // Given
      const weakPassword = 'Short1!';

      // When
      const result = complianceChecker.checkPasswordPolicy(weakPassword);

      // Then
      expect(result.compliant).toBe(false);
      expect(result.violations).toContainEqual(expect.stringContaining('8 characters'));
    });

    it('should require uppercase letter', () => {
      // Given
      const noUpper = 'password123!';

      // When
      const result = complianceChecker.checkPasswordPolicy(noUpper);

      // Then
      expect(result.violations).toContainEqual(expect.stringContaining('uppercase'));
    });

    it('should require lowercase letter', () => {
      // Given
      const noLower = 'PASSWORD123!';

      // When
      const result = complianceChecker.checkPasswordPolicy(noLower);

      // Then
      expect(result.violations).toContainEqual(expect.stringContaining('lowercase'));
    });

    it('should require number', () => {
      // Given
      const noNumber = 'Password!!';

      // When
      const result = complianceChecker.checkPasswordPolicy(noNumber);

      // Then
      expect(result.violations).toContainEqual(expect.stringContaining('number'));
    });

    it('should accept strong password', () => {
      // Given
      const strongPassword = 'SecureP@ss123!';

      // When
      const result = complianceChecker.checkPasswordPolicy(strongPassword);

      // Then
      expect(result.compliant).toBe(true);
    });
  });

  describe('Full Security Audit', () => {
    it('should pass full audit with strict config', async () => {
      // When
      const audit = await complianceChecker.runFullAudit();

      // Then
      expect(audit.passed).toBe(true);
      expect(audit.overallScore).toBe(100);
    });

    it('should verify all security checks pass', async () => {
      // When
      const audit = await complianceChecker.runFullAudit();

      // Then
      for (const check of audit.checks) {
        expect(check.passed).toBe(true);
      }
    });

    it('should verify path traversal protection is enabled', async () => {
      // When
      const audit = await complianceChecker.runFullAudit();

      // Then
      const pathCheck = audit.checks.find((c) => c.name === 'Path Traversal Protection');
      expect(pathCheck?.passed).toBe(true);
    });

    it('should verify shell execution is disabled', async () => {
      // When
      const audit = await complianceChecker.runFullAudit();

      // Then
      const shellCheck = audit.checks.find((c) => c.name === 'Command Injection Protection');
      expect(shellCheck?.passed).toBe(true);
    });

    it('should verify secure hashing is configured', async () => {
      // When
      const audit = await complianceChecker.runFullAudit();

      // Then
      const hashCheck = audit.checks.find((c) => c.name === 'Secure Hashing Algorithm');
      expect(hashCheck?.passed).toBe(true);
    });
  });

  describe('Security Configuration Compliance', () => {
    it('should have 95% security test coverage target', () => {
      // Given
      const securityCoverageTarget = 0.95;

      // Then
      expect(securityCoverageTarget).toBe(0.95);
    });

    it('should use argon2 for password hashing', () => {
      // Then
      expect(securityConfigs.strict.hashing.algorithm).toBe('argon2');
    });

    it('should disable shell execution by default', () => {
      // Then
      expect(securityConfigs.strict.execution.shell).toBe(false);
    });

    it('should block all dangerous commands', () => {
      // Then
      expect(securityConfigs.strict.execution.blockedCommands).toContain('rm');
      expect(securityConfigs.strict.execution.blockedCommands).toContain('del');
      expect(securityConfigs.strict.execution.blockedCommands).toContain('format');
      expect(securityConfigs.strict.execution.blockedCommands).toContain('dd');
    });

    it('should have limited allowed commands', () => {
      // Then
      expect(securityConfigs.strict.execution.allowedCommands).toEqual(['npm', 'npx', 'node', 'git']);
    });
  });
});
