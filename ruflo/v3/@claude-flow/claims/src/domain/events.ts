/**
 * Claim Domain Events (ADR-007)
 *
 * Domain events for the claims system following event sourcing pattern.
 * All state changes emit events for audit trail and projections.
 *
 * @module v3/claims/domain/events
 */

import type {
  ClaimId,
  IssueId,
  Claimant,
  ClaimStatus,
} from './types.js';

// =============================================================================
// Base Claim Event
// =============================================================================

/**
 * Base interface for all claim domain events
 */
export interface ClaimDomainEvent {
  /** Unique event identifier */
  id: string;

  /** Event type discriminator */
  type: ClaimEventType;

  /** Aggregate ID (claim ID) */
  aggregateId: string;

  /** Aggregate type - always 'claim' for this domain */
  aggregateType: 'claim';

  /** Event version for ordering */
  version: number;

  /** Timestamp when event occurred */
  timestamp: number;

  /** Event source */
  source: string;

  /** Event payload data */
  payload: Record<string, unknown>;

  /** Optional metadata */
  metadata?: Record<string, unknown>;

  /** Optional causation ID (event that caused this event) */
  causationId?: string;

  /** Optional correlation ID (groups related events) */
  correlationId?: string;
}

// =============================================================================
// Event Types
// =============================================================================

export type ClaimEventType =
  | 'claim:created'
  | 'claim:released'
  | 'claim:expired'
  | 'claim:status-changed'
  | 'claim:note-added'
  | 'handoff:requested'
  | 'handoff:accepted'
  | 'handoff:rejected'
  | 'review:requested'
  | 'review:completed';

// =============================================================================
// Specific Event Interfaces
// =============================================================================

export interface ClaimCreatedEvent extends ClaimDomainEvent {
  type: 'claim:created';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    claimant: Claimant;
    claimedAt: number;
    expiresAt?: number;
  };
}

export interface ClaimReleasedEvent extends ClaimDomainEvent {
  type: 'claim:released';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    claimant: Claimant;
    releasedAt: number;
    reason?: string;
  };
}

export interface ClaimExpiredEvent extends ClaimDomainEvent {
  type: 'claim:expired';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    claimant: Claimant;
    expiredAt: number;
    lastActivityAt: number;
  };
}

export interface ClaimStatusChangedEvent extends ClaimDomainEvent {
  type: 'claim:status-changed';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    previousStatus: ClaimStatus;
    newStatus: ClaimStatus;
    changedAt: number;
    note?: string;
  };
}

export interface ClaimNoteAddedEvent extends ClaimDomainEvent {
  type: 'claim:note-added';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    note: string;
    addedAt: number;
    addedBy: Claimant;
  };
}

export interface HandoffRequestedEvent extends ClaimDomainEvent {
  type: 'handoff:requested';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    handoffId: string;
    from: Claimant;
    to: Claimant;
    reason: string;
    requestedAt: number;
  };
}

export interface HandoffAcceptedEvent extends ClaimDomainEvent {
  type: 'handoff:accepted';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    handoffId: string;
    from: Claimant;
    to: Claimant;
    acceptedAt: number;
  };
}

export interface HandoffRejectedEvent extends ClaimDomainEvent {
  type: 'handoff:rejected';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    handoffId: string;
    from: Claimant;
    to: Claimant;
    rejectedAt: number;
    reason: string;
  };
}

export interface ReviewRequestedEvent extends ClaimDomainEvent {
  type: 'review:requested';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    reviewers: Claimant[];
    requestedAt: number;
    requestedBy: Claimant;
  };
}

export interface ReviewCompletedEvent extends ClaimDomainEvent {
  type: 'review:completed';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    reviewer: Claimant;
    approved: boolean;
    completedAt: number;
    comments?: string;
  };
}

// =============================================================================
// Event Type Union
// =============================================================================

export type AllClaimEvents =
  | ClaimCreatedEvent
  | ClaimReleasedEvent
  | ClaimExpiredEvent
  | ClaimStatusChangedEvent
  | ClaimNoteAddedEvent
  | HandoffRequestedEvent
  | HandoffAcceptedEvent
  | HandoffRejectedEvent
  | ReviewRequestedEvent
  | ReviewCompletedEvent;

// =============================================================================
// Event Factory Functions
// =============================================================================

let eventCounter = 0;

function generateEventId(): string {
  return `claim-evt-${Date.now()}-${++eventCounter}`;
}

function createClaimEvent<T extends ClaimDomainEvent>(
  type: T['type'],
  aggregateId: string,
  payload: T['payload'],
  metadata?: Record<string, unknown>,
  causationId?: string,
  correlationId?: string
): T {
  return {
    id: generateEventId(),
    type,
    aggregateId,
    aggregateType: 'claim',
    version: 1, // Version will be set by event store
    timestamp: Date.now(),
    source: 'claim-service',
    payload,
    metadata,
    causationId,
    correlationId,
  } as T;
}

// =============================================================================
// Public Event Factory Functions
// =============================================================================

export function createClaimCreatedEvent(
  claimId: ClaimId,
  issueId: IssueId,
  claimant: Claimant,
  expiresAt?: number
): ClaimCreatedEvent {
  return createClaimEvent('claim:created', claimId, {
    claimId,
    issueId,
    claimant,
    claimedAt: Date.now(),
    expiresAt,
  });
}

export function createClaimReleasedEvent(
  claimId: ClaimId,
  issueId: IssueId,
  claimant: Claimant,
  reason?: string
): ClaimReleasedEvent {
  return createClaimEvent('claim:released', claimId, {
    claimId,
    issueId,
    claimant,
    releasedAt: Date.now(),
    reason,
  });
}

export function createClaimExpiredEvent(
  claimId: ClaimId,
  issueId: IssueId,
  claimant: Claimant,
  lastActivityAt: number
): ClaimExpiredEvent {
  return createClaimEvent('claim:expired', claimId, {
    claimId,
    issueId,
    claimant,
    expiredAt: Date.now(),
    lastActivityAt,
  });
}

export function createClaimStatusChangedEvent(
  claimId: ClaimId,
  issueId: IssueId,
  previousStatus: ClaimStatus,
  newStatus: ClaimStatus,
  note?: string
): ClaimStatusChangedEvent {
  return createClaimEvent('claim:status-changed', claimId, {
    claimId,
    issueId,
    previousStatus,
    newStatus,
    changedAt: Date.now(),
    note,
  });
}

export function createClaimNoteAddedEvent(
  claimId: ClaimId,
  issueId: IssueId,
  note: string,
  addedBy: Claimant
): ClaimNoteAddedEvent {
  return createClaimEvent('claim:note-added', claimId, {
    claimId,
    issueId,
    note,
    addedAt: Date.now(),
    addedBy,
  });
}

export function createHandoffRequestedEvent(
  claimId: ClaimId,
  issueId: IssueId,
  handoffId: string,
  from: Claimant,
  to: Claimant,
  reason: string
): HandoffRequestedEvent {
  return createClaimEvent('handoff:requested', claimId, {
    claimId,
    issueId,
    handoffId,
    from,
    to,
    reason,
    requestedAt: Date.now(),
  });
}

export function createHandoffAcceptedEvent(
  claimId: ClaimId,
  issueId: IssueId,
  handoffId: string,
  from: Claimant,
  to: Claimant
): HandoffAcceptedEvent {
  return createClaimEvent('handoff:accepted', claimId, {
    claimId,
    issueId,
    handoffId,
    from,
    to,
    acceptedAt: Date.now(),
  });
}

export function createHandoffRejectedEvent(
  claimId: ClaimId,
  issueId: IssueId,
  handoffId: string,
  from: Claimant,
  to: Claimant,
  reason: string
): HandoffRejectedEvent {
  return createClaimEvent('handoff:rejected', claimId, {
    claimId,
    issueId,
    handoffId,
    from,
    to,
    rejectedAt: Date.now(),
    reason,
  });
}

export function createReviewRequestedEvent(
  claimId: ClaimId,
  issueId: IssueId,
  reviewers: Claimant[],
  requestedBy: Claimant
): ReviewRequestedEvent {
  return createClaimEvent('review:requested', claimId, {
    claimId,
    issueId,
    reviewers,
    requestedAt: Date.now(),
    requestedBy,
  });
}

export function createReviewCompletedEvent(
  claimId: ClaimId,
  issueId: IssueId,
  reviewer: Claimant,
  approved: boolean,
  comments?: string
): ReviewCompletedEvent {
  return createClaimEvent('review:completed', claimId, {
    claimId,
    issueId,
    reviewer,
    approved,
    completedAt: Date.now(),
    comments,
  });
}

// =============================================================================
// ADR-016 Extended Events
// =============================================================================

import type {
  AgentId,
  StealReason,
  AgentLoadInfo,
  ClaimMove,
} from './types.js';

/**
 * Extended event types for ADR-016
 */
export type ExtendedClaimEventType =
  | ClaimEventType
  // Work stealing events
  | 'steal:issue-marked-stealable'
  | 'steal:issue-stolen'
  | 'steal:contest-started'
  | 'steal:contest-resolved'
  | 'steal:warning-sent'
  // Load balancing events
  | 'swarm:rebalanced'
  | 'agent:overloaded'
  | 'agent:underloaded'
  | 'agent:load-changed';

/**
 * Extended base event interface for ADR-016 events
 */
export interface ExtendedClaimDomainEvent {
  /** Unique event identifier */
  id: string;

  /** Event type discriminator */
  type: ExtendedClaimEventType;

  /** Aggregate ID (claim ID) */
  aggregateId: string;

  /** Aggregate type - always 'claim' for this domain */
  aggregateType: 'claim';

  /** Event version for ordering */
  version: number;

  /** Timestamp when event occurred */
  timestamp: number;

  /** Event source */
  source: string;

  /** Event payload data */
  payload: Record<string, unknown>;

  /** Optional metadata */
  metadata?: Record<string, unknown>;

  /** Optional causation ID (event that caused this event) */
  causationId?: string;

  /** Optional correlation ID (groups related events) */
  correlationId?: string;
}

// =============================================================================
// Work Stealing Events (ADR-016)
// =============================================================================

export interface IssueMarkedStealableEvent extends ExtendedClaimDomainEvent {
  type: 'steal:issue-marked-stealable';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    originalClaimant: Claimant;
    reason: StealReason;
    gracePeriodMs: number;
    gracePeriodEndsAt: number;
    minPriorityToSteal: string;
    requiresContest: boolean;
  };
}

export interface IssueStolenEvent extends ExtendedClaimDomainEvent {
  type: 'steal:issue-stolen';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    originalClaimant: Claimant;
    newClaimant: Claimant;
    reason: StealReason;
    hadContest: boolean;
    contestId?: string;
    progressTransferred: number;
  };
}

export interface StealContestStartedEvent extends ExtendedClaimDomainEvent {
  type: 'steal:contest-started';
  payload: {
    contestId: string;
    claimId: ClaimId;
    issueId: IssueId;
    defender: Claimant;
    challenger: Claimant;
    reason: StealReason;
    endsAt: number;
  };
}

export interface StealContestResolvedExtEvent extends ExtendedClaimDomainEvent {
  type: 'steal:contest-resolved';
  payload: {
    contestId: string;
    claimId: ClaimId;
    issueId: IssueId;
    winner: 'defender' | 'challenger';
    winnerClaimant: Claimant;
    loserClaimant: Claimant;
    resolvedBy: AgentId | 'system';
    reason: string;
  };
}

export interface StealWarningEvent extends ExtendedClaimDomainEvent {
  type: 'steal:warning-sent';
  payload: {
    claimId: ClaimId;
    issueId: IssueId;
    claimant: Claimant;
    reason: StealReason;
    warningNumber: number;
    maxWarnings: number;
    stealableAt: number;
    actionRequired: string;
  };
}

// =============================================================================
// Load Balancing Events (ADR-016)
// =============================================================================

export interface SwarmRebalancedExtEvent extends ExtendedClaimDomainEvent {
  type: 'swarm:rebalanced';
  payload: {
    claimsMoved: number;
    moves: ClaimMove[];
    loadBefore: AgentLoadInfo[];
    loadAfter: AgentLoadInfo[];
    durationMs: number;
    trigger: 'scheduled' | 'overload-detected' | 'underload-detected' | 'manual' | 'agent-added' | 'agent-removed';
    errors: string[];
  };
}

export interface AgentOverloadedExtEvent extends ExtendedClaimDomainEvent {
  type: 'agent:overloaded';
  payload: {
    agentId: AgentId;
    agentName: string;
    currentLoad: number;
    threshold: number;
    activeClaims: number;
    maxClaims: number;
    recommendedAction: 'pause-assignments' | 'rebalance' | 'scale-up' | 'notify-admin';
  };
}

export interface AgentUnderloadedExtEvent extends ExtendedClaimDomainEvent {
  type: 'agent:underloaded';
  payload: {
    agentId: AgentId;
    agentName: string;
    currentLoad: number;
    threshold: number;
    activeClaims: number;
    maxClaims: number;
    availableCapacity: number;
  };
}

export interface AgentLoadChangedEvent extends ExtendedClaimDomainEvent {
  type: 'agent:load-changed';
  payload: {
    agentId: AgentId;
    previousLoad: number;
    currentLoad: number;
    previousClaims: number;
    currentClaims: number;
    changeReason: 'claim-added' | 'claim-completed' | 'claim-released' | 'claim-transferred' | 'capacity-changed';
  };
}

/**
 * All ADR-016 extended events union
 */
export type AllExtendedClaimEvents =
  | AllClaimEvents
  | IssueMarkedStealableEvent
  | IssueStolenEvent
  | StealContestStartedEvent
  | StealContestResolvedExtEvent
  | StealWarningEvent
  | SwarmRebalancedExtEvent
  | AgentOverloadedExtEvent
  | AgentUnderloadedExtEvent
  | AgentLoadChangedEvent;

// =============================================================================
// Extended Event Factory Functions
// =============================================================================

export function createIssueMarkedStealableEvent(
  claimId: ClaimId,
  issueId: IssueId,
  originalClaimant: Claimant,
  reason: StealReason,
  gracePeriodMs: number,
  minPriorityToSteal: string,
  requiresContest: boolean
): IssueMarkedStealableEvent {
  const now = Date.now();
  return {
    id: generateExtEventId(),
    type: 'steal:issue-marked-stealable',
    aggregateId: claimId,
    aggregateType: 'claim',
    version: 1,
    timestamp: now,
    source: 'work-stealing-service',
    payload: {
      claimId,
      issueId,
      originalClaimant,
      reason,
      gracePeriodMs,
      gracePeriodEndsAt: now + gracePeriodMs,
      minPriorityToSteal,
      requiresContest,
    },
  };
}

export function createIssueStolenExtEvent(
  claimId: ClaimId,
  issueId: IssueId,
  originalClaimant: Claimant,
  newClaimant: Claimant,
  reason: StealReason,
  hadContest: boolean,
  progressTransferred: number,
  contestId?: string
): IssueStolenEvent {
  return {
    id: generateExtEventId(),
    type: 'steal:issue-stolen',
    aggregateId: claimId,
    aggregateType: 'claim',
    version: 1,
    timestamp: Date.now(),
    source: 'work-stealing-service',
    payload: {
      claimId,
      issueId,
      originalClaimant,
      newClaimant,
      reason,
      hadContest,
      contestId,
      progressTransferred,
    },
  };
}

export function createSwarmRebalancedExtEvent(
  claimsMoved: number,
  moves: ClaimMove[],
  loadBefore: AgentLoadInfo[],
  loadAfter: AgentLoadInfo[],
  durationMs: number,
  trigger: SwarmRebalancedExtEvent['payload']['trigger'],
  errors: string[] = []
): SwarmRebalancedExtEvent {
  return {
    id: generateExtEventId(),
    type: 'swarm:rebalanced',
    aggregateId: 'swarm',
    aggregateType: 'claim',
    version: 1,
    timestamp: Date.now(),
    source: 'load-balancer',
    payload: {
      claimsMoved,
      moves,
      loadBefore,
      loadAfter,
      durationMs,
      trigger,
      errors,
    },
  };
}

export function createAgentOverloadedExtEvent(
  agentId: AgentId,
  agentName: string,
  currentLoad: number,
  threshold: number,
  activeClaims: number,
  maxClaims: number,
  recommendedAction: AgentOverloadedExtEvent['payload']['recommendedAction']
): AgentOverloadedExtEvent {
  return {
    id: generateExtEventId(),
    type: 'agent:overloaded',
    aggregateId: agentId,
    aggregateType: 'claim',
    version: 1,
    timestamp: Date.now(),
    source: 'load-balancer',
    payload: {
      agentId,
      agentName,
      currentLoad,
      threshold,
      activeClaims,
      maxClaims,
      recommendedAction,
    },
  };
}

export function createAgentUnderloadedExtEvent(
  agentId: AgentId,
  agentName: string,
  currentLoad: number,
  threshold: number,
  activeClaims: number,
  maxClaims: number,
  availableCapacity: number
): AgentUnderloadedExtEvent {
  return {
    id: generateExtEventId(),
    type: 'agent:underloaded',
    aggregateId: agentId,
    aggregateType: 'claim',
    version: 1,
    timestamp: Date.now(),
    source: 'load-balancer',
    payload: {
      agentId,
      agentName,
      currentLoad,
      threshold,
      activeClaims,
      maxClaims,
      availableCapacity,
    },
  };
}

let extEventCounter = 0;

function generateExtEventId(): string {
  return `claim-ext-evt-${Date.now()}-${++extEventCounter}`;
}
