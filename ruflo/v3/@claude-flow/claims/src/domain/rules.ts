/**
 * @claude-flow/claims - Business Rules (ADR-016)
 * Domain rules for claiming, stealing eligibility, and load balancing
 *
 * Pure functions that encode the business logic for the claiming system
 */

import type {
  IssueClaim,
  Claimant,
  ClaimStatus,
  IssuePriority,
  WorkStealingConfig,
  IssueClaimWithStealing,
  StealableInfo,
  StealableReason,
  ExtendedClaimStatus,
  ExtendedIssueClaim,
  AgentLoadInfo,
  LoadBalancingConfig,
  StealReason,
  DEFAULT_LOAD_BALANCING_CONFIG,
} from './types.js';

// =============================================================================
// Result Types
// =============================================================================

export interface RuleResult<T = boolean> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function ruleSuccess<T>(data: T): RuleResult<T> {
  return { success: true, data };
}

export function ruleFailure(code: string, message: string, details?: Record<string, unknown>): RuleResult<never> {
  return { success: false, error: { code, message, details } };
}

// =============================================================================
// Claim Eligibility Rules
// =============================================================================

/**
 * Check if a claimant can claim a new issue
 */
export function canClaimIssue(
  claimant: Claimant,
  existingClaims: readonly IssueClaim[],
): RuleResult<boolean> {
  // Check capacity
  const maxClaims = claimant.maxConcurrentClaims ?? 5;
  const activeClaims = existingClaims.filter(
    (c) => c.claimant.id === claimant.id && isActiveClaim(c.status),
  ).length;

  if (activeClaims >= maxClaims) {
    return ruleFailure(
      'CLAIMANT_AT_CAPACITY',
      `Claimant has reached maximum concurrent claims (${maxClaims})`,
      { currentClaims: activeClaims, maxClaims },
    );
  }

  // Check workload if available
  const workload = claimant.currentWorkload ?? 0;
  if (workload >= 100) {
    return ruleFailure(
      'CLAIMANT_AT_CAPACITY',
      'Claimant is at 100% capacity',
      { workload },
    );
  }

  return ruleSuccess(true);
}

/**
 * Check if an issue is already claimed
 */
export function isIssueClaimed(
  issueId: string,
  claims: readonly IssueClaim[],
): IssueClaim | null {
  return claims.find(
    (c) => c.issueId === issueId && isActiveClaim(c.status),
  ) ?? null;
}

/**
 * Determine if a claim status is considered "active"
 */
export function isActiveClaim(status: ClaimStatus | ExtendedClaimStatus): boolean {
  return [
    'active',
    'paused',
    'blocked',
    'pending_handoff',
    'handoff-pending',
    'in_review',
    'review-requested',
  ].includes(status);
}

/**
 * Get valid status transitions for original ClaimStatus
 */
export function getOriginalStatusTransitions(currentStatus: ClaimStatus): readonly ClaimStatus[] {
  const transitions: Record<ClaimStatus, readonly ClaimStatus[]> = {
    'active': ['pending_handoff', 'in_review', 'completed', 'released', 'paused', 'blocked', 'stealable'],
    'pending_handoff': ['active', 'completed'],
    'in_review': ['active', 'completed'],
    'completed': [],
    'released': [],
    'expired': [],
    'paused': ['active', 'blocked', 'stealable', 'completed'],
    'blocked': ['active', 'paused', 'stealable', 'completed'],
    'stealable': ['active', 'completed'],
  };
  return transitions[currentStatus] ?? [];
}

/**
 * Get valid status transitions for ExtendedClaimStatus (ADR-016)
 */
export function getExtendedStatusTransitions(currentStatus: ExtendedClaimStatus): readonly ExtendedClaimStatus[] {
  const transitions: Record<ExtendedClaimStatus, readonly ExtendedClaimStatus[]> = {
    'active': ['paused', 'blocked', 'handoff-pending', 'review-requested', 'stealable', 'completed'],
    'paused': ['active', 'blocked', 'handoff-pending', 'stealable', 'completed'],
    'blocked': ['active', 'paused', 'stealable', 'completed'],
    'handoff-pending': ['active', 'completed'],
    'review-requested': ['active', 'completed', 'blocked'],
    'stealable': ['active', 'completed'],
    'completed': [],
  };
  return transitions[currentStatus];
}

/**
 * Check if a status transition is valid
 */
export function canTransitionStatus(
  currentStatus: ClaimStatus | ExtendedClaimStatus,
  newStatus: ClaimStatus | ExtendedClaimStatus,
): RuleResult<boolean> {
  if (currentStatus === newStatus) {
    return ruleSuccess(true); // No-op is always valid
  }

  // Try original transitions first
  const originalTransitions = getOriginalStatusTransitions(currentStatus as ClaimStatus);
  if (originalTransitions.includes(newStatus as ClaimStatus)) {
    return ruleSuccess(true);
  }

  // Try extended transitions
  const extendedTransitions = getExtendedStatusTransitions(currentStatus as ExtendedClaimStatus);
  if (extendedTransitions.includes(newStatus as ExtendedClaimStatus)) {
    return ruleSuccess(true);
  }

  return ruleFailure(
    'INVALID_STATUS_TRANSITION',
    `Cannot transition from '${currentStatus}' to '${newStatus}'`,
    { currentStatus, newStatus },
  );
}

// =============================================================================
// Work Stealing Rules
// =============================================================================

/**
 * Check if a claim is eligible to be marked as stealable
 */
export function canMarkAsStealable(
  claim: IssueClaimWithStealing,
  config: WorkStealingConfig,
  now: Date = new Date(),
): RuleResult<StealableReason | null> {
  // Already stealable or terminal status
  if (claim.status === 'stealable' || claim.status === 'completed' || claim.status === 'released') {
    return ruleSuccess(null);
  }

  // Check for stale (no activity)
  const lastActivity = claim.lastActivityAt.getTime();
  const staleThreshold = config.staleThresholdMinutes * 60 * 1000;
  if (now.getTime() - lastActivity >= staleThreshold) {
    return ruleSuccess('stale');
  }

  // Check for blocked too long
  if (claim.blockedAt && claim.blockedReason) {
    const blockedThreshold = config.blockedThresholdMinutes * 60 * 1000;
    if (now.getTime() - claim.blockedAt.getTime() >= blockedThreshold) {
      return ruleSuccess('blocked');
    }
  }

  return ruleSuccess(null);
}

/**
 * Check if a claim can be stolen by a specific agent
 */
export function canStealClaim(
  claim: IssueClaimWithStealing,
  challenger: Claimant,
  config: WorkStealingConfig,
  now: Date = new Date(),
): RuleResult<boolean> {
  // Check if claim is stealable
  if (claim.status !== 'stealable' && !claim.stealInfo) {
    return ruleFailure('NOT_STEALABLE', `Claim status is '${claim.status}', not stealable`);
  }

  // Check grace period
  if (claim.stealableAt && now < claim.stealableAt) {
    return ruleFailure(
      'IN_GRACE_PERIOD',
      `Grace period has not ended. Ends at ${claim.stealableAt.toISOString()}`,
      { stealableAt: claim.stealableAt.getTime() },
    );
  }

  // Check progress protection
  if (claim.progress >= config.minProgressToProtect) {
    return ruleFailure(
      'PROTECTED_BY_PROGRESS',
      `Claim is protected due to high progress (${claim.progress}%)`,
      { progress: claim.progress, threshold: config.minProgressToProtect },
    );
  }

  // Check cross-type stealing rules if applicable
  if (config.allowCrossTypeSteal && claim.stealInfo?.allowedStealerTypes) {
    const challengerType = (challenger as any).agentType;
    if (challengerType && !claim.stealInfo.allowedStealerTypes.includes(challengerType)) {
      return ruleFailure(
        'CROSS_TYPE_NOT_ALLOWED',
        `Agent type '${challengerType}' cannot steal from this claim`,
      );
    }
  }

  // Cannot steal own claim
  if (claim.claimant.id === challenger.id) {
    return ruleFailure('UNAUTHORIZED', 'Cannot steal your own claim');
  }

  // Check if there's a pending contest
  if (claim.contestInfo && !claim.contestInfo.resolution) {
    return ruleFailure('CONTEST_PENDING', 'A steal contest is already in progress');
  }

  return ruleSuccess(true);
}

/**
 * Determine if a contest is required for stealing
 */
export function requiresStealContest(
  claim: IssueClaimWithStealing,
  config: WorkStealingConfig,
): boolean {
  // No contest for timeout/stale claims
  if (claim.stealInfo?.reason === 'stale' || claim.stealInfo?.reason === 'timeout') {
    return false;
  }

  // No contest for manual releases
  if (claim.stealInfo?.reason === 'manual') {
    return false;
  }

  // Contest required based on progress
  return claim.progress > 0;
}

// =============================================================================
// Handoff Rules
// =============================================================================

/**
 * Check if a handoff can be initiated
 */
export function canInitiateHandoff(
  claim: IssueClaim,
  targetClaimant: Claimant,
  currentClaimant: Claimant,
): RuleResult<boolean> {
  // Cannot handoff completed claims
  if (claim.status === 'completed' || claim.status === 'released') {
    return ruleFailure('INVALID_STATUS', 'Cannot hand off a completed or released claim');
  }

  // Cannot handoff if already pending
  if (claim.status === 'pending_handoff') {
    return ruleFailure('HANDOFF_PENDING', 'A handoff is already pending for this claim');
  }

  // Must be the current claimant
  if (claim.claimant.id !== currentClaimant.id) {
    return ruleFailure('UNAUTHORIZED', 'Only the current claimant can initiate a handoff');
  }

  // Cannot handoff to self
  if (claim.claimant.id === targetClaimant.id) {
    return ruleFailure('VALIDATION_ERROR', 'Cannot hand off to yourself');
  }

  // Check target capacity
  const targetMaxClaims = targetClaimant.maxConcurrentClaims ?? 5;
  const targetWorkload = targetClaimant.currentWorkload ?? 0;
  if (targetWorkload >= 100) {
    return ruleFailure(
      'TARGET_AT_CAPACITY',
      'Target claimant is at full capacity',
    );
  }

  return ruleSuccess(true);
}

/**
 * Check if a handoff can be accepted
 */
export function canAcceptHandoff(
  claim: IssueClaim,
  acceptingClaimant: Claimant,
): RuleResult<boolean> {
  if (claim.status !== 'pending_handoff') {
    return ruleFailure(
      'INVALID_STATUS',
      'Claim is not in pending handoff status',
    );
  }

  // Find the pending handoff record
  const pendingHandoff = claim.handoffChain?.find(h => h.status === 'pending');
  if (!pendingHandoff) {
    return ruleFailure('HANDOFF_NOT_FOUND', 'No pending handoff found');
  }

  if (pendingHandoff.to.id !== acceptingClaimant.id) {
    return ruleFailure(
      'UNAUTHORIZED',
      'Only the target claimant can accept this handoff',
    );
  }

  return ruleSuccess(true);
}

/**
 * Check if a handoff can be rejected
 */
export function canRejectHandoff(
  claim: IssueClaim,
  rejectingClaimant: Claimant,
): RuleResult<boolean> {
  if (claim.status !== 'pending_handoff') {
    return ruleFailure(
      'INVALID_STATUS',
      'Claim is not in pending handoff status',
    );
  }

  const pendingHandoff = claim.handoffChain?.find(h => h.status === 'pending');
  if (!pendingHandoff) {
    return ruleFailure('HANDOFF_NOT_FOUND', 'No pending handoff found');
  }

  // Either the target or the initiator can reject
  const canReject =
    pendingHandoff.to.id === rejectingClaimant.id ||
    pendingHandoff.from.id === rejectingClaimant.id;

  if (!canReject) {
    return ruleFailure(
      'UNAUTHORIZED',
      'Only the target or initiating claimant can reject this handoff',
    );
  }

  return ruleSuccess(true);
}

// =============================================================================
// Load Balancing Rules
// =============================================================================

/**
 * Determine if an agent is overloaded
 */
export function isAgentOverloaded(
  load: number,
  threshold: number = 90,
): boolean {
  return load >= threshold;
}

/**
 * Determine if an agent is underloaded
 */
export function isAgentUnderloaded(
  load: number,
  threshold: number = 30,
): boolean {
  return load <= threshold;
}

/**
 * Check if rebalancing is needed for a set of agents
 */
export function needsRebalancing(
  agentLoads: readonly { load: number }[],
  config: { overloadThreshold: number; underloadThreshold: number; rebalanceThreshold: number },
): boolean {
  if (agentLoads.length < 2) {
    return false;
  }

  // Check for overloaded agents
  const hasOverloaded = agentLoads.some((a) => isAgentOverloaded(a.load, config.overloadThreshold));
  const hasUnderloaded = agentLoads.some((a) => isAgentUnderloaded(a.load, config.underloadThreshold));

  if (hasOverloaded && hasUnderloaded) {
    return true;
  }

  // Check for large load differential
  const loads = agentLoads.map((a) => a.load);
  const maxLoad = Math.max(...loads);
  const minLoad = Math.min(...loads);
  const loadDifferential = maxLoad - minLoad;

  return loadDifferential >= config.rebalanceThreshold;
}

/**
 * Check if a claim can be moved during rebalancing
 */
export function canMoveClaim(claim: IssueClaimWithStealing): boolean {
  // Cannot move completed claims
  if (claim.status === 'completed' || claim.status === 'released') {
    return false;
  }

  // Cannot move claims with pending handoffs
  if (claim.status === 'pending_handoff') {
    return false;
  }

  // Cannot move high-progress claims (>75%)
  if (claim.progress > 75) {
    return false;
  }

  // Cannot move claims with active reviews
  if (claim.status === 'in_review') {
    return false;
  }

  // Cannot move contested claims
  if (claim.contestInfo && !claim.contestInfo.resolution) {
    return false;
  }

  return true;
}

// =============================================================================
// Validation Rules
// =============================================================================

/**
 * Validate claim priority
 */
export function isValidPriority(priority: string): priority is IssuePriority {
  return ['critical', 'high', 'medium', 'low'].includes(priority);
}

/**
 * Validate claim status
 */
export function isValidStatus(status: string): status is ClaimStatus {
  return [
    'active',
    'pending_handoff',
    'in_review',
    'completed',
    'released',
    'expired',
  ].includes(status);
}

/**
 * Validate extended claim status (ADR-016)
 */
export function isValidExtendedStatus(status: string): status is ExtendedClaimStatus {
  return [
    'active',
    'paused',
    'handoff-pending',
    'review-requested',
    'blocked',
    'stealable',
    'completed',
  ].includes(status);
}

/**
 * Validate repository format (owner/repo)
 */
export function isValidRepository(repository: string): boolean {
  return /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repository);
}
