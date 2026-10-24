/**
 * V3 Security Module
 *
 * Comprehensive security module addressing all identified vulnerabilities:
 * - CVE-2: Weak Password Hashing (password-hasher.ts)
 * - CVE-3: Hardcoded Default Credentials (credential-generator.ts)
 * - HIGH-1: Command Injection (safe-executor.ts)
 * - HIGH-2: Path Traversal (path-validator.ts)
 *
 * Also provides:
 * - Input validation with Zod schemas
 * - Secure token generation
 *
 * @module v3/security
 */

// Password Hashing (CVE-2 Fix)
export {
  PasswordHasher,
  PasswordHashError,
  createPasswordHasher,
  type PasswordHasherConfig,
  type PasswordValidationResult,
} from './password-hasher.js';

// Credential Generation (CVE-3 Fix)
export {
  CredentialGenerator,
  CredentialGeneratorError,
  createCredentialGenerator,
  generateCredentials,
  type CredentialConfig,
  type GeneratedCredentials,
  type ApiKeyCredential,
} from './credential-generator.js';

// Safe Command Execution (HIGH-1 Fix)
export {
  SafeExecutor,
  SafeExecutorError,
  createDevelopmentExecutor,
  createReadOnlyExecutor,
  type ExecutorConfig,
  type ExecutionResult,
  type StreamingExecutor,
} from './safe-executor.js';

// Path Validation (HIGH-2 Fix)
export {
  PathValidator,
  PathValidatorError,
  createProjectPathValidator,
  createFullProjectPathValidator,
  type PathValidatorConfig,
  type PathValidationResult,
} from './path-validator.js';

// Input Validation
export {
  InputValidator,
  sanitizeString,
  sanitizeHtml,
  sanitizePath,
  // Base schemas
  SafeStringSchema,
  IdentifierSchema,
  FilenameSchema,
  EmailSchema,
  PasswordSchema,
  UUIDSchema,
  HttpsUrlSchema,
  UrlSchema,
  SemverSchema,
  PortSchema,
  IPv4Schema,
  IPSchema,
  // Auth schemas
  UserRoleSchema,
  PermissionSchema,
  LoginRequestSchema,
  CreateUserSchema,
  CreateApiKeySchema,
  // Agent & Task schemas
  AgentTypeSchema,
  SpawnAgentSchema,
  TaskInputSchema,
  // Command & Path schemas
  CommandArgumentSchema,
  PathSchema,
  // Config schemas
  SecurityConfigSchema,
  ExecutorConfigSchema,
  // Utilities
  PATTERNS,
  LIMITS,
  z,
} from './input-validator.js';

// Token Generation
export {
  TokenGenerator,
  TokenGeneratorError,
  createTokenGenerator,
  getDefaultGenerator,
  quickGenerate,
  type TokenConfig,
  type Token,
  type SignedToken,
  type VerificationCode,
} from './token-generator.js';

// ============================================================================
// Convenience Factory Functions
// ============================================================================

import { PasswordHasher } from './password-hasher.js';
import { CredentialGenerator } from './credential-generator.js';
import { SafeExecutor } from './safe-executor.js';
import { PathValidator } from './path-validator.js';
import { TokenGenerator } from './token-generator.js';

/**
 * Security module configuration
 */
export interface SecurityModuleConfig {
  /**
   * Project root directory for path validation
   */
  projectRoot: string;

  /**
   * HMAC secret for token signing
   */
  hmacSecret: string;

  /**
   * Bcrypt rounds for password hashing
   * Default: 12
   */
  bcryptRounds?: number;

  /**
   * Allowed commands for safe executor
   * Default: ['git', 'npm', 'npx', 'node']
   */
  allowedCommands?: string[];
}

/**
 * Complete security module instance
 */
export interface SecurityModule {
  passwordHasher: PasswordHasher;
  credentialGenerator: CredentialGenerator;
  safeExecutor: SafeExecutor;
  pathValidator: PathValidator;
  tokenGenerator: TokenGenerator;
}

/**
 * Creates a complete security module with all components configured.
 *
 * @param config - Module configuration
 * @returns Complete security module
 *
 * @example
 * ```typescript
 * const security = createSecurityModule({
 *   projectRoot: '/workspaces/project',
 *   hmacSecret: process.env.HMAC_SECRET!,
 * });
 *
 * // Hash password
 * const hash = await security.passwordHasher.hash('password');
 *
 * // Validate path
 * const result = await security.pathValidator.validate('/workspaces/project/src/file.ts');
 *
 * // Execute command safely
 * const output = await security.safeExecutor.execute('git', ['status']);
 * ```
 */
export function createSecurityModule(config: SecurityModuleConfig): SecurityModule {
  return {
    passwordHasher: new PasswordHasher({
      rounds: config.bcryptRounds ?? 12,
    }),
    credentialGenerator: new CredentialGenerator(),
    safeExecutor: new SafeExecutor({
      allowedCommands: config.allowedCommands ?? ['git', 'npm', 'npx', 'node'],
    }),
    pathValidator: new PathValidator({
      allowedPrefixes: [config.projectRoot],
      allowHidden: true,
    }),
    tokenGenerator: new TokenGenerator({
      hmacSecret: config.hmacSecret,
    }),
  };
}

// ============================================================================
// Security Constants
// ============================================================================

/**
 * Minimum recommended bcrypt rounds for production
 */
export const MIN_BCRYPT_ROUNDS = 12;

/**
 * Maximum recommended bcrypt rounds (performance consideration)
 */
export const MAX_BCRYPT_ROUNDS = 14;

/**
 * Minimum password length
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Maximum password length (bcrypt limitation)
 */
export const MAX_PASSWORD_LENGTH = 72;

/**
 * Default token expiration in seconds (1 hour)
 */
export const DEFAULT_TOKEN_EXPIRATION = 3600;

/**
 * Default session expiration in seconds (24 hours)
 */
export const DEFAULT_SESSION_EXPIRATION = 86400;

// ============================================================================
// Security Audit Helper
// ============================================================================

/**
 * Checks security configuration for common issues.
 *
 * @param config - Configuration to audit
 * @returns Array of security warnings
 */
export function auditSecurityConfig(config: Partial<SecurityModuleConfig>): string[] {
  const warnings: string[] = [];

  if (config.bcryptRounds && config.bcryptRounds < MIN_BCRYPT_ROUNDS) {
    warnings.push(`bcryptRounds (${config.bcryptRounds}) below recommended minimum (${MIN_BCRYPT_ROUNDS})`);
  }

  if (config.hmacSecret && config.hmacSecret.length < 32) {
    warnings.push('hmacSecret should be at least 32 characters');
  }

  if (!config.projectRoot) {
    warnings.push('projectRoot not configured - path validation may be disabled');
  }

  if (config.allowedCommands && config.allowedCommands.length === 0) {
    warnings.push('No commands allowed - executor will reject all commands');
  }

  return warnings;
}

/**
 * Security module version
 */
export const SECURITY_MODULE_VERSION = '3.0.0-alpha.1';
