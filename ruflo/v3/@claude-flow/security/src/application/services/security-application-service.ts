/**
 * Security Application Service - Application Layer
 *
 * Orchestrates security operations and provides simplified interface.
 *
 * @module v3/security/application/services
 */

import { SecurityContext, PermissionLevel } from '../../domain/entities/security-context.js';
import { SecurityDomainService, ValidationResult, ThreatDetectionResult } from '../../domain/services/security-domain-service.js';

/**
 * Security audit result
 */
export interface SecurityAuditResult {
  passed: boolean;
  score: number;
  checks: Array<{
    name: string;
    passed: boolean;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
  }>;
  recommendations: string[];
}

/**
 * Security Application Service
 */
export class SecurityApplicationService {
  private readonly domainService: SecurityDomainService;
  private readonly contexts: Map<string, SecurityContext> = new Map();

  constructor() {
    this.domainService = new SecurityDomainService();
  }

  // ============================================================================
  // Context Management
  // ============================================================================

  /**
   * Create and register security context for agent
   */
  createAgentContext(agentId: string, role: string): SecurityContext {
    const context = this.domainService.createAgentContext(agentId, role);
    this.contexts.set(agentId, context);
    return context;
  }

  /**
   * Get security context
   */
  getContext(principalId: string): SecurityContext | undefined {
    return this.contexts.get(principalId);
  }

  /**
   * Remove security context
   */
  removeContext(principalId: string): boolean {
    return this.contexts.delete(principalId);
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validate path access
   */
  validatePath(path: string, principalId: string): ValidationResult {
    const context = this.contexts.get(principalId);
    if (!context) {
      return {
        valid: false,
        errors: ['Security context not found'],
        warnings: [],
      };
    }

    return this.domainService.validatePath(path, context);
  }

  /**
   * Validate command execution
   */
  validateCommand(command: string, principalId: string): ValidationResult {
    const context = this.contexts.get(principalId);
    if (!context) {
      return {
        valid: false,
        errors: ['Security context not found'],
        warnings: [],
      };
    }

    return this.domainService.validateCommand(command, context);
  }

  /**
   * Validate user input
   */
  validateInput(input: string): ValidationResult {
    return this.domainService.validateInput(input);
  }

  /**
   * Detect threats in content
   */
  detectThreats(content: string): ThreatDetectionResult {
    return this.domainService.detectThreats(content);
  }

  // ============================================================================
  // Audit
  // ============================================================================

  /**
   * Run security audit on codebase
   */
  async auditCodebase(files: Array<{ path: string; content: string }>): Promise<SecurityAuditResult> {
    const checks: SecurityAuditResult['checks'] = [];
    const recommendations: string[] = [];
    let criticalCount = 0;
    let highCount = 0;

    for (const file of files) {
      const threats = this.domainService.detectThreats(file.content);

      for (const threat of threats.threats) {
        checks.push({
          name: `${threat.type} in ${file.path}`,
          passed: false,
          severity: threat.severity,
          message: threat.description,
        });

        if (threat.severity === 'critical') criticalCount++;
        if (threat.severity === 'high') highCount++;
      }

      if (threats.safe) {
        checks.push({
          name: `Security check: ${file.path}`,
          passed: true,
          severity: 'low',
          message: 'No threats detected',
        });
      }
    }

    // Generate recommendations
    if (criticalCount > 0) {
      recommendations.push('Address critical security issues immediately');
    }
    if (highCount > 0) {
      recommendations.push('Review and fix high-severity findings');
    }
    recommendations.push('Run regular security scans');
    recommendations.push('Keep dependencies updated');

    // Calculate score
    const totalChecks = checks.length;
    const passedChecks = checks.filter((c) => c.passed).length;
    const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;

    return {
      passed: criticalCount === 0 && highCount === 0,
      score,
      checks,
      recommendations,
    };
  }

  /**
   * Check if operation is allowed
   */
  isOperationAllowed(
    principalId: string,
    operation: 'path' | 'command',
    target: string
  ): boolean {
    const context = this.contexts.get(principalId);
    if (!context || context.isExpired()) return false;

    if (operation === 'path') {
      return context.canAccessPath(target);
    } else {
      return context.canExecuteCommand(target);
    }
  }
}
