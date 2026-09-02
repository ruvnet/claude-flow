/**
 * Security Module
 *
 * Shared security utilities for V3 Claude Flow.
 *
 * @module v3/shared/security
 */

// Secure random generation
export {
  generateSecureId,
  generateUUID,
  generateSecureToken,
  generateShortId,
  generateSessionId,
  generateAgentId,
  generateTaskId,
  generateMemoryId,
  generateEventId,
  generateSwarmId,
  generatePatternId,
  generateTrajectoryId,
  secureRandomInt,
  secureRandomChoice,
  secureShuffleArray,
} from './secure-random.js';

// Input validation
export {
  validateInput,
  sanitizeString,
  validatePath,
  validateCommand,
  validateTags,
  isValidIdentifier,
  escapeForSql,
  type ValidationResult,
  type ValidationOptions,
} from './input-validation.js';
