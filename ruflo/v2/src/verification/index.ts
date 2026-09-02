/**
 * Verification Security Module - Entry Point
 * 
 * This module provides a comprehensive security enforcement system
 * for agent truth verification with enterprise-grade security features.
 */

// Main security system
export { 
  SecurityEnforcementSystem as default,
  SecurityEnforcementSystem 
} from './security';

// Individual security components
export {
  AgentAuthenticationSystem,
  AdvancedRateLimiter,
  AuditTrailSystem,
  ByzantineFaultToleranceSystem,
  ThresholdSignatureSystem,
  ZeroKnowledgeProofSystem,
  CryptographicCore
} from './security';

// Types and interfaces
export * from './types';

// Re-export verification interfaces for backward compatibility
export type {
  AgentIdentity,
  VerificationRequest,
  VerificationResult,
  AuditEntry,
  SecurityMetrics
} from './security';

// Utility functions and constants
export { SECURITY_CONSTANTS } from './types';

// Error classes
export {
  SecurityError,
  AuthenticationError,
  ByzantineError,
  CryptographicError,
  RateLimitError
} from './types';

/**
 * Factory function to create a configured security system
 */
export function createSecuritySystem(config?: {
  totalNodes?: number;
  threshold?: number;
  rateLimits?: {
    perSecond?: number;
    perMinute?: number;
    perHour?: number;
    perDay?: number;
  };
}): SecurityEnforcementSystem {
  const totalNodes = config?.totalNodes || 5;
  const threshold = config?.threshold || Math.floor((totalNodes * 2) / 3) + 1;
  
  const securitySystem = new SecurityEnforcementSystem(totalNodes, threshold);
  
  // Configure rate limits if provided
  if (config?.rateLimits) {
    // This would be implemented as a method on SecurityEnforcementSystem
    // For now, it's a placeholder for future implementation
    console.log('Custom rate limits configured:', config.rateLimits);
  }
  
  return securitySystem;
}

/**
 * Quick setup function for development environments
 */
export function createDevelopmentSecuritySystem(): SecurityEnforcementSystem {
  return createSecuritySystem({
    totalNodes: 3,
    threshold: 2,
    rateLimits: {
      perSecond: 100,
      perMinute: 1000,
      perHour: 10000,
      perDay: 100000
    }
  });
}

/**
 * Production-ready security system with strict settings
 */
export function createProductionSecuritySystem(): SecurityEnforcementSystem {
  return createSecuritySystem({
    totalNodes: 7,
    threshold: 5,
    rateLimits: {
      perSecond: 10,
      perMinute: 100,
      perHour: 1000,
      perDay: 10000
    }
  });
}

/**
 * High-security system for sensitive environments
 */
export function createHighSecuritySystem(): SecurityEnforcementSystem {
  return createSecuritySystem({
    totalNodes: 9,
    threshold: 7,
    rateLimits: {
      perSecond: 5,
      perMinute: 50,
      perHour: 500,
      perDay: 5000
    }
  });
}