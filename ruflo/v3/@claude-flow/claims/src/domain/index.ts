/**
 * Claims Domain Layer (ADR-016)
 *
 * Exports all domain types, events, rules, and repository interfaces
 * for the issue claiming system.
 *
 * @module v3/claims/domain
 */

// =============================================================================
// Core Types (from types.ts)
// =============================================================================

export type {
  // Core identifiers
  ClaimId,
  IssueId,
  ClaimantType,
  ClaimStatus,
  IssueLabel,
  IssuePriority,
  IssueComplexity,

  // Value objects
  Duration,

  // Entities
  Claimant,
  Issue,
  IssueClaim,
  HandoffRecord,
  IssueWithClaim,
  ClaimResult,

  // Query types
  IssueFilters,

  // Error types
  ClaimErrorCode,
  ClaimError,

  // Work stealing types
  AgentType,
  StealableReason,
  StealableInfo,
  StealErrorCode,
  StealResult,
  ContestInfo,
  ContestResolution,
  WorkStealingConfig,
  IssueClaimWithStealing,
  WorkStealingEventType,
  WorkStealingEvent,

  // ADR-016 extended types
  ExtendedClaimStatus,
  AgentId,
  UserId,
  BlockedReason,
  BlockedInfo,
  StealReason,
  ExtendedStealableInfo,
  HandoffReason,
  ExtendedHandoffInfo,
  ClaimantWorkload,
  ExtendedClaimant,
  AgentLoadInfo,
  ClaimMove,
  RebalanceError,
  ExtendedRebalanceResult,
  RebalanceStrategy,
  LoadBalancingConfig,
  ExtendedIssueClaim,
  ClaimNote,
  StatusChange,
  ClaimQueryOptions,
  ClaimStatistics,

  // Repository interfaces
  IIssueClaimRepository,
  IWorkStealingEventBus,
} from './types.js';

export {
  // Utility functions
  durationToMs,
  generateClaimId,
  isActiveClaimStatus,
  getValidStatusTransitions,

  // Classes
  ClaimOperationError,

  // Constants
  DEFAULT_WORK_STEALING_CONFIG,
  DEFAULT_LOAD_BALANCING_CONFIG,
} from './types.js';

// =============================================================================
// Domain Events (from events.ts)
// =============================================================================

export type {
  // Base event types
  ClaimDomainEvent,
  ClaimEventType,
  AllClaimEvents,

  // Claim lifecycle events
  ClaimCreatedEvent,
  ClaimReleasedEvent,
  ClaimExpiredEvent,
  ClaimStatusChangedEvent,
  ClaimNoteAddedEvent,

  // Handoff events
  HandoffRequestedEvent,
  HandoffAcceptedEvent,
  HandoffRejectedEvent,

  // Review events
  ReviewRequestedEvent,
  ReviewCompletedEvent,

  // ADR-016 extended event types
  ExtendedClaimEventType,
  ExtendedClaimDomainEvent,
  IssueMarkedStealableEvent,
  IssueStolenEvent,
  StealContestStartedEvent,
  StealContestResolvedExtEvent,
  StealWarningEvent,
  SwarmRebalancedExtEvent,
  AgentOverloadedExtEvent,
  AgentUnderloadedExtEvent,
  AgentLoadChangedEvent,
  AllExtendedClaimEvents,
} from './events.js';

export {
  // Event factory functions
  createClaimCreatedEvent,
  createClaimReleasedEvent,
  createClaimExpiredEvent,
  createClaimStatusChangedEvent,
  createClaimNoteAddedEvent,
  createHandoffRequestedEvent,
  createHandoffAcceptedEvent,
  createHandoffRejectedEvent,
  createReviewRequestedEvent,
  createReviewCompletedEvent,

  // ADR-016 extended event factories
  createIssueMarkedStealableEvent,
  createIssueStolenExtEvent,
  createSwarmRebalancedExtEvent,
  createAgentOverloadedExtEvent,
  createAgentUnderloadedExtEvent,
} from './events.js';

// =============================================================================
// Repository Interfaces (from repositories.ts)
// =============================================================================

export type {
  IClaimRepository,
  IIssueRepository,
  IClaimantRepository,
  IClaimEventStore,
} from './repositories.js';

// =============================================================================
// Business Rules (from rules.ts)
// =============================================================================

export type {
  RuleResult,
} from './rules.js';

export {
  // Result helpers
  ruleSuccess,
  ruleFailure,

  // Claim eligibility rules
  canClaimIssue,
  isIssueClaimed,
  isActiveClaim,
  getOriginalStatusTransitions,
  getExtendedStatusTransitions,
  canTransitionStatus,

  // Work stealing rules
  canMarkAsStealable,
  canStealClaim,
  requiresStealContest,

  // Handoff rules
  canInitiateHandoff,
  canAcceptHandoff,
  canRejectHandoff,

  // Load balancing rules
  isAgentOverloaded,
  isAgentUnderloaded,
  needsRebalancing,
  canMoveClaim,

  // Validation rules
  isValidPriority,
  isValidStatus,
  isValidExtendedStatus,
  isValidRepository,
} from './rules.js';
