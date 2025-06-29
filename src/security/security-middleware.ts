/**
 * Comprehensive security middleware integrating all security controls
 */

import { ILogger } from '../core/logger.js';
import { AuthManager, IAuthManager, Permissions } from '../mcp/auth.js';
import { IAuditLogger, createAuditLogger, AuditHelpers, AuditEventType } from './audit-logger.js';
import { IInputValidator, createInputValidator } from './input-validator.js';
import { ICommandWhitelist, createCommandWhitelist } from './command-whitelist.js';
import { MCPAuthConfig } from '../utils/types.js';
import { SecureCrypto } from './crypto-utils.js';

export interface SecurityConfig {
  authentication: {
    enabled: boolean;
    method: 'token' | 'basic' | 'oauth';
    tokenExpiry: number;
    rotationInterval: number;
    sessionTimeout?: number;
  };
  authorization: {
    rbac: boolean;
    commandWhitelist: string[];
    processIsolation: boolean;
    strictMode?: boolean;
  };
  communication: {
    encryption: 'tls' | 'symmetric' | 'none';
    certificateValidation: boolean;
    networkBinding: 'localhost' | 'any';
  };
  audit: {
    enabled: boolean;
    logDir: string;
    rotationInterval?: number;
    retentionDays?: number;
    enableConsoleLog?: boolean;
  };
  validation: {
    enableStrictMode?: boolean;
    maxInputLength?: number;
    blockedCommands?: string[];
    blockedPaths?: string[];
  };
}

export interface SecurityContext {
  userId?: string;
  sessionId?: string;
  permissions?: string[];
  ip?: string;
  userAgent?: string;
}

export interface ISecurityMiddleware {
  authenticate(credentials: unknown): Promise<{ success: boolean; context?: SecurityContext; error?: string }>;
  authorize(context: SecurityContext, resource: string, action: string): Promise<boolean>;
  validateInput(type: 'command' | 'path' | 'args', input: any): Promise<{ valid: boolean; sanitized?: any; error?: string }>;
  auditLog(event: AuditEventType, context: SecurityContext, details: Record<string, unknown>): Promise<void>;
  checkCommandAccess(command: string, args: string[], context: SecurityContext): Promise<boolean>;
  enforceNetworkBinding(host: string): boolean;
}

export class SecurityMiddleware implements ISecurityMiddleware {
  private authManager: IAuthManager;
  private auditLogger: IAuditLogger;
  private inputValidator: IInputValidator;
  private commandWhitelist: ICommandWhitelist;

  constructor(
    private config: SecurityConfig,
    private logger: ILogger,
  ) {
    // Initialize authentication manager
    const authConfig: MCPAuthConfig = {
      enabled: config.authentication.enabled,
      method: config.authentication.method,
      ...(config.authentication.sessionTimeout !== undefined && { sessionTimeout: config.authentication.sessionTimeout }),
    };
    this.authManager = new AuthManager(authConfig, logger);

    // Initialize audit logger
    this.auditLogger = createAuditLogger(
      {
        logDir: config.audit.logDir,
        ...(config.audit.rotationInterval !== undefined && { rotationInterval: config.audit.rotationInterval }),
        ...(config.audit.retentionDays !== undefined && { retentionDays: config.audit.retentionDays }),
        ...(config.audit.enableConsoleLog !== undefined && { enableConsoleLog: config.audit.enableConsoleLog }),
      },
      logger,
    );

    // Initialize input validator
    this.inputValidator = createInputValidator(
      {
        ...(config.validation.enableStrictMode !== undefined && { enableStrictMode: config.validation.enableStrictMode }),
        ...(config.validation.maxInputLength !== undefined && { maxInputLength: config.validation.maxInputLength }),
        ...(config.validation.blockedCommands !== undefined && { blockedCommands: config.validation.blockedCommands }),
        ...(config.validation.blockedPaths !== undefined && { blockedPaths: config.validation.blockedPaths }),
        allowedCommands: config.authorization.commandWhitelist,
      },
      logger,
    );

    // Initialize command whitelist
    this.commandWhitelist = createCommandWhitelist(
      {
        ...(config.authorization.strictMode !== undefined && { strictMode: config.authorization.strictMode }),
        enableRateLimiting: true,
      },
      logger,
      this.auditLogger,
    );

    logger.info('Security middleware initialized', {
      authEnabled: config.authentication.enabled,
      auditEnabled: config.audit.enabled,
      strictMode: config.authorization.strictMode,
      networkBinding: config.communication.networkBinding,
    });
  }

  async authenticate(credentials: unknown): Promise<{ success: boolean; context?: SecurityContext; error?: string }> {
    try {
      const result = await this.authManager.authenticate(credentials);
      
      if (result.success && result.user) {
        const context: SecurityContext = {
          userId: result.user,
          ...(result.permissions !== undefined && { permissions: result.permissions }),
          sessionId: SecureCrypto.generateSecureSessionId(),
        };

        // Log successful authentication
        await this.auditLog(AuditEventType.AUTHENTICATION, context, {
          method: this.config.authentication.method,
          success: true,
        });

        return { success: true, context };
      } else {
        // Log failed authentication
        await this.auditLog(
          AuditEventType.AUTHENTICATION,
          { userId: 'unknown' },
          {
            method: this.config.authentication.method,
            success: false,
            error: result.error,
          },
        );

        return { success: false, ...(result.error !== undefined && { error: result.error }) };
      }
    } catch (error) {
      this.logger.error('Authentication error', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      };
    }
  }

  async authorize(context: SecurityContext, resource: string, action: string): Promise<boolean> {
    try {
      if (!this.config.authorization.rbac) {
        return true; // RBAC disabled
      }

      const permission = `${resource}.${action}`;
      const hasPermission = context.permissions?.includes(permission) ||
                          context.permissions?.includes('*') ||
                          context.permissions?.some((p) => 
                            p.endsWith('*') && permission.startsWith(p.slice(0, -1))
                          ) || false;

      // Log authorization attempt
      await AuditHelpers.logAuthorization(
        this.auditLogger,
        context.userId || 'anonymous',
        resource,
        permission,
        hasPermission,
      );

      if (!hasPermission) {
        this.logger.warn('Authorization denied', {
          userId: context.userId,
          resource,
          action,
          permission,
        });
      }

      return hasPermission;
    } catch (error) {
      this.logger.error('Authorization error', error);
      return false;
    }
  }

  async validateInput(
    type: 'command' | 'path' | 'args',
    input: any,
  ): Promise<{ valid: boolean; sanitized?: any; error?: string }> {
    try {
      let result;

      switch (type) {
        case 'command':
          result = this.inputValidator.validateCommand(input);
          break;
        case 'path':
          result = this.inputValidator.validatePath(input);
          break;
        case 'args':
          result = this.inputValidator.validateProcessArgs(input);
          break;
        default:
          return { valid: false, error: 'Invalid validation type' };
      }

      if (!result.valid) {
        this.logger.warn('Input validation failed', {
          type,
          input: typeof input === 'string' ? input.substring(0, 100) : '[complex]',
          errors: result.errors,
        });

        // Log security violation for malicious input
        if (result.errors?.some((e) => e.includes('injection') || e.includes('traversal'))) {
          await this.auditLog(
            AuditEventType.SECURITY_VIOLATION,
            { userId: 'unknown' },
            {
              type: 'malicious_input',
              inputType: type,
              errors: result.errors,
            },
          );
        }

        return {
          valid: false,
          error: result.errors?.join(', ') || 'Validation failed',
        };
      }

      return {
        valid: true,
        sanitized: result.sanitized,
      };
    } catch (error) {
      this.logger.error('Input validation error', error);
      return {
        valid: false,
        error: 'Internal validation error',
      };
    }
  }

  async auditLog(
    eventType: AuditEventType,
    context: SecurityContext,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (!this.config.audit.enabled) {
      return;
    }

    await this.auditLogger.log({
      timestamp: new Date(),
      eventType,
      ...(context.userId !== undefined && { userId: context.userId }),
      ...(context.sessionId !== undefined && { sessionId: context.sessionId }),
      ...(context.ip !== undefined && { ip: context.ip }),
      ...(context.userAgent !== undefined && { userAgent: context.userAgent }),
      action: details['action'] as string || eventType,
      outcome: details['success'] === false ? 'failure' : 'success',
      details,
    });
  }

  async checkCommandAccess(command: string, args: string[], context: SecurityContext): Promise<boolean> {
    // First validate the command and arguments
    const commandValidation = await this.validateInput('command', command);
    if (!commandValidation.valid) {
      return false;
    }

    const argsValidation = await this.validateInput('args', args);
    if (!argsValidation.valid) {
      return false;
    }

    // Check command whitelist
    const allowed = await this.commandWhitelist.isAllowed(
      commandValidation.sanitized as string,
      argsValidation.sanitized as string[],
      context.userId,
    );

    return allowed;
  }

  enforceNetworkBinding(host: string): boolean {
    if (this.config.communication.networkBinding === 'localhost') {
      const localhostAddresses = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
      if (!localhostAddresses.includes(host)) {
        this.logger.warn('Network binding violation', {
          requestedHost: host,
          allowedBinding: this.config.communication.networkBinding,
        });
        return false;
      }
    }
    return true;
  }
}

/**
 * Factory function for creating security middleware
 */
export function createSecurityMiddleware(
  config: SecurityConfig,
  logger: ILogger,
): ISecurityMiddleware {
  return new SecurityMiddleware(config, logger);
}

/**
 * Default security configuration
 */
export const DefaultSecurityConfig: SecurityConfig = {
  authentication: {
    enabled: true,
    method: 'token',
    tokenExpiry: 3600000, // 1 hour
    rotationInterval: 86400000, // 24 hours
    sessionTimeout: 3600000, // 1 hour
  },
  authorization: {
    rbac: true,
    commandWhitelist: [],
    processIsolation: true,
    strictMode: true,
  },
  communication: {
    encryption: 'tls',
    certificateValidation: true,
    networkBinding: 'localhost',
  },
  audit: {
    enabled: true,
    logDir: './logs/audit',
    rotationInterval: 86400000, // 24 hours
    retentionDays: 90,
    enableConsoleLog: false,
  },
  validation: {
    enableStrictMode: true,
    maxInputLength: 10000,
    blockedCommands: ['rm', 'del', 'format', 'dd', 'mkfs'],
    blockedPaths: ['/etc/*', '/sys/*', '*.key', '*.pem'],
  },
};

/**
 * Security helper functions
 */
export const SecurityHelpers = {
  createSecureContext: (userId: string, permissions: string[]): SecurityContext => ({
    userId,
    permissions,
    sessionId: SecureCrypto.generateSecureSessionId(),
  }),

  hasPermission: (context: SecurityContext, permission: string): boolean => {
    return context.permissions?.includes(permission) ||
           context.permissions?.includes('*') ||
           context.permissions?.some((p) => 
             p.endsWith('*') && permission.startsWith(p.slice(0, -1))
           ) || false;
  },

  sanitizeContext: (context: SecurityContext): SecurityContext => ({
    ...(context.userId !== undefined && { userId: context.userId.substring(0, 128) }),
    ...(context.sessionId !== undefined && { sessionId: context.sessionId.substring(0, 128) }),
    ...(context.permissions !== undefined && { permissions: context.permissions.slice(0, 100) }),
    ...(context.ip !== undefined && { ip: context.ip.substring(0, 45) }),
    ...(context.userAgent !== undefined && { userAgent: context.userAgent.substring(0, 512) }),
  }),
};