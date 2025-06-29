/**
 * Security module exports
 */

export * from './audit-logger.js';
export * from './input-validator.js';
export * from './command-whitelist.js';
export * from './security-middleware.js';

// Re-export auth components for convenience
export { 
  AuthManager,
  Permissions,
  type IAuthManager,
  type AuthResult,
  type TokenValidation,
  type AuthContext,
  type TokenInfo,
  type AuthSession,
} from '../mcp/auth.js';

// Central security configuration type
export interface SecurityConfiguration {
  auth: {
    enabled: boolean;
    method: 'token' | 'basic' | 'oauth';
    tokens?: string[];
    users?: Array<{
      username: string;
      password: string;
      permissions: string[];
    }>;
  };
  audit: {
    enabled: boolean;
    logDir: string;
    retentionDays?: number;
  };
  validation: {
    strictMode: boolean;
    commandWhitelist?: string[];
    blockedCommands?: string[];
    blockedPaths?: string[];
  };
  network: {
    binding: 'localhost' | 'any';
    tlsEnabled?: boolean;
  };
}

// Security constants
export const SECURITY_DEFAULTS = {
  TOKEN_EXPIRY: 3600000, // 1 hour
  SESSION_TIMEOUT: 3600000, // 1 hour  
  ROTATION_INTERVAL: 86400000, // 24 hours
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION: 900000, // 15 minutes
  MIN_PASSWORD_LENGTH: 12,
  AUDIT_RETENTION_DAYS: 90,
} as const;

// Common security error types
export class SecurityError extends Error {
  constructor(
    message: string,
    public code: 'AUTH_FAILED' | 'UNAUTHORIZED' | 'INVALID_INPUT' | 'RATE_LIMITED' | 'SECURITY_VIOLATION',
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}

import { SecureCrypto } from './crypto-utils.js';

// Utility functions
export const SecurityUtils = {
  /**
   * Generate a secure random token
   */
  generateToken: (length = 32): string => {
    return SecureCrypto.generateSecureRandomString(length);
  },

  /**
   * Mask sensitive data in logs
   */
  maskSensitive: (data: string, visibleChars = 4): string => {
    if (data.length <= visibleChars) {
      return '*'.repeat(data.length);
    }
    return data.substring(0, visibleChars) + '*'.repeat(data.length - visibleChars);
  },

  /**
   * Check if IP is local
   */
  isLocalIP: (ip: string): boolean => {
    return ip === 'localhost' || 
           ip === '127.0.0.1' || 
           ip === '::1' || 
           ip.startsWith('192.168.') ||
           ip.startsWith('10.') ||
           ip.startsWith('172.');
  },
};