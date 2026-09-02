/**
 * Security Domain Service - Domain Layer
 *
 * Contains security logic for validation, policy enforcement, and threat detection.
 *
 * @module v3/security/domain/services
 */

import { SecurityContext, PermissionLevel } from '../entities/security-context.js';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized?: string;
}

/**
 * Threat detection result
 */
export interface ThreatDetectionResult {
  safe: boolean;
  threats: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    location?: string;
  }>;
}

/**
 * Security Domain Service
 */
export class SecurityDomainService {
  // Dangerous patterns for path traversal
  private static readonly PATH_TRAVERSAL_PATTERNS = [
    /\.\./,
    /~\//,
    /^\/etc\//,
    /^\/tmp\//,
    /^\/var\/log\//,
    /^C:\\Windows/i,
    /^C:\\Users\\[^\\]+\\AppData/i,
  ];

  // Dangerous command patterns
  private static readonly DANGEROUS_COMMANDS = [
    /^rm\s+-rf\s+\//,
    /^rm\s+-rf\s+\*/,
    /^dd\s+if=/,
    /^mkfs\./,
    /^format\s+/i,
    /^del\s+\/s\s+\/q/i,
    />\s*\/dev\/sd[a-z]/,
    /\|\s*bash$/,
    /\|\s*sh$/,
    /eval\s*\(/,
    /exec\s*\(/,
  ];

  // SQL injection patterns
  private static readonly SQL_INJECTION_PATTERNS = [
    /'\s*OR\s+'1'\s*=\s*'1/i,
    /'\s*OR\s+1\s*=\s*1/i,
    /;\s*DROP\s+TABLE/i,
    /;\s*DELETE\s+FROM/i,
    /UNION\s+SELECT/i,
    /--\s*$/,
  ];

  // XSS patterns
  private static readonly XSS_PATTERNS = [
    /<script[\s>]/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
  ];

  /**
   * Validate a file path
   */
  validatePath(path: string, context: SecurityContext): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check path traversal
    for (const pattern of SecurityDomainService.PATH_TRAVERSAL_PATTERNS) {
      if (pattern.test(path)) {
        errors.push(`Path traversal detected: ${pattern.source}`);
      }
    }

    // Check context permissions
    if (!context.canAccessPath(path)) {
      errors.push(`Access denied to path: ${path}`);
    }

    // Check for suspicious paths
    if (path.includes('..')) {
      warnings.push('Path contains parent directory reference');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitized: this.sanitizePath(path),
    };
  }

  /**
   * Validate a command
   */
  validateCommand(command: string, context: SecurityContext): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check dangerous commands
    for (const pattern of SecurityDomainService.DANGEROUS_COMMANDS) {
      if (pattern.test(command)) {
        errors.push(`Dangerous command pattern detected: ${pattern.source}`);
      }
    }

    // Check context permissions
    if (!context.canExecuteCommand(command)) {
      errors.push(`Command execution denied: ${command}`);
    }

    if (!context.hasPermission('execute')) {
      errors.push('Execute permission required');
    }

    // Check for shell injection
    if (/[;&|`$(){}]/.test(command)) {
      warnings.push('Command contains shell metacharacters');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitized: this.sanitizeCommand(command),
    };
  }

  /**
   * Validate user input
   */
  validateInput(input: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for SQL injection
    for (const pattern of SecurityDomainService.SQL_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        errors.push(`SQL injection pattern detected`);
        break;
      }
    }

    // Check for XSS
    for (const pattern of SecurityDomainService.XSS_PATTERNS) {
      if (pattern.test(input)) {
        errors.push(`XSS pattern detected`);
        break;
      }
    }

    // Check length
    if (input.length > 10000) {
      warnings.push('Input exceeds recommended length');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitized: this.sanitizeInput(input),
    };
  }

  /**
   * Detect threats in content
   */
  detectThreats(content: string): ThreatDetectionResult {
    const threats: ThreatDetectionResult['threats'] = [];

    // Check for various threat patterns
    if (/<script/i.test(content)) {
      threats.push({
        type: 'xss',
        severity: 'high',
        description: 'Script tag detected',
      });
    }

    if (/password\s*[:=]\s*["'][^"']+["']/i.test(content)) {
      threats.push({
        type: 'credential-exposure',
        severity: 'critical',
        description: 'Hardcoded password detected',
      });
    }

    if (/api[_-]?key\s*[:=]\s*["'][^"']+["']/i.test(content)) {
      threats.push({
        type: 'credential-exposure',
        severity: 'critical',
        description: 'API key detected',
      });
    }

    if (/eval\s*\(/.test(content)) {
      threats.push({
        type: 'code-injection',
        severity: 'high',
        description: 'Eval statement detected',
      });
    }

    return {
      safe: threats.length === 0,
      threats,
    };
  }

  /**
   * Sanitize path
   */
  private sanitizePath(path: string): string {
    return path
      .replace(/\.\./g, '')
      .replace(/\/\//g, '/')
      .replace(/^~\//, '')
      .trim();
  }

  /**
   * Sanitize command
   */
  private sanitizeCommand(command: string): string {
    return command
      .replace(/[;&|`$]/g, '')
      .replace(/\$\([^)]*\)/g, '')
      .trim();
  }

  /**
   * Sanitize user input
   */
  private sanitizeInput(input: string): string {
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Create security context for agent
   */
  createAgentContext(
    agentId: string,
    role: string,
    customPaths?: string[]
  ): SecurityContext {
    // Default permissions based on role
    const rolePermissions: Record<string, PermissionLevel[]> = {
      'queen-coordinator': ['read', 'write', 'execute', 'admin'],
      'security-architect': ['read', 'write', 'execute', 'admin'],
      'coder': ['read', 'write', 'execute'],
      'reviewer': ['read'],
      'tester': ['read', 'execute'],
      default: ['read'],
    };

    const permissions = rolePermissions[role] ?? rolePermissions.default;

    return SecurityContext.create({
      principalId: agentId,
      principalType: 'agent',
      permissions,
      allowedPaths: customPaths ?? ['./src', './tests', './docs'],
      blockedPaths: ['/etc', '/var', '~/', '../'],
      allowedCommands: ['npm', 'npx', 'node', 'git', 'vitest'],
      blockedCommands: ['rm -rf /', 'dd', 'mkfs', 'format'],
    });
  }
}
