/**
 * Security Domain Layer - Public Exports
 *
 * @module v3/security/domain
 */

export {
  SecurityContext,
  type PermissionLevel,
  type SecurityContextProps,
} from './entities/security-context.js';

export {
  SecurityDomainService,
  type ValidationResult,
  type ThreatDetectionResult,
} from './services/security-domain-service.js';
