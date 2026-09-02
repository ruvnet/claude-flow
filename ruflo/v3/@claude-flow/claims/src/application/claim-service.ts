/**
 * Claim Service - Application Layer
 *
 * Implements IClaimService interface for managing issue claims.
 * Supports both human and agent claimants with handoff capabilities.
 *
 * Key Features:
 * - Issue claiming and releasing
 * - Human-to-agent and agent-to-agent handoffs
 * - Status tracking and updates
 * - Auto-management (expiration, auto-assignment)
 * - Full event sourcing (ADR-007)
 *
 * @module v3/claims/application/claim-service
 */

import { randomUUID } from 'crypto';
import {
  ClaimId,
  IssueId,
  Claimant,
  ClaimStatus,
  Issue,
  IssueClaim,
  IssueWithClaim,
  IssueFilters,
  ClaimResult,
  Duration,
  HandoffRecord,
  ClaimOperationError,
  durationToMs,
} from '../domain/types.js';
import {
  IClaimRepository,
  IIssueRepository,
  IClaimantRepository,
  IClaimEventStore,
} from '../domain/repositories.js';
import {
  createClaimCreatedEvent,
  createClaimReleasedEvent,
  createClaimExpiredEvent,
  createClaimStatusChangedEvent,
  createClaimNoteAddedEvent,
  createHandoffRequestedEvent,
  createHandoffAcceptedEvent,
  createHandoffRejectedEvent,
  createReviewRequestedEvent,
} from '../domain/events.js';

// =============================================================================
// Service Interface
// =============================================================================

/**
 * IClaimService interface - main contract for claim operations
 */
export interface IClaimService {
  // ==========================================================================
  // Claiming
  // ==========================================================================

  /**
   * Claim an issue for a claimant
   */
  claim(issueId: string, claimant: Claimant): Promise<ClaimResult>;

  /**
   * Release a claim on an issue
   */
  release(issueId: string, claimant: Claimant): Promise<void>;

  // ==========================================================================
  // Handoffs (human<->agent and agent<->agent)
  // ==========================================================================

  /**
   * Request a handoff from one claimant to another
   */
  requestHandoff(issueId: string, from: Claimant, to: Claimant, reason: string): Promise<void>;

  /**
   * Accept a pending handoff
   */
  acceptHandoff(issueId: string, claimant: Claimant): Promise<void>;

  /**
   * Reject a pending handoff
   */
  rejectHandoff(issueId: string, claimant: Claimant, reason: string): Promise<void>;

  // ==========================================================================
  // Status
  // ==========================================================================

  /**
   * Update the status of a claim
   */
  updateStatus(issueId: string, status: ClaimStatus, note?: string): Promise<void>;

  /**
   * Request review for a claimed issue
   */
  requestReview(issueId: string, reviewers: Claimant[]): Promise<void>;

  // ==========================================================================
  // Queries
  // ==========================================================================

  /**
   * Get all issues claimed by a specific claimant
   */
  getClaimedBy(claimant: Claimant): Promise<IssueClaim[]>;

  /**
   * Get available (unclaimed) issues matching filters
   */
  getAvailableIssues(filters?: IssueFilters): Promise<Issue[]>;

  /**
   * Get the current status of an issue including claim info
   */
  getIssueStatus(issueId: string): Promise<IssueWithClaim>;

  // ==========================================================================
  // Auto-management
  // ==========================================================================

  /**
   * Expire stale claims that haven't had activity
   */
  expireStale(maxAge: Duration): Promise<IssueClaim[]>;

  /**
   * Auto-assign an issue to the best available claimant
   */
  autoAssign(issue: Issue): Promise<Claimant | null>;
}

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Claim Service implementation with event sourcing
 */
export class ClaimService implements IClaimService {
  constructor(
    private readonly claimRepository: IClaimRepository,
    private readonly issueRepository: IIssueRepository,
    private readonly claimantRepository: IClaimantRepository,
    private readonly eventStore: IClaimEventStore
  ) {}

  // ==========================================================================
  // Claiming
  // ==========================================================================

  async claim(issueId: string, claimant: Claimant): Promise<ClaimResult> {
    // Validate issue exists
    const issue = await this.issueRepository.findById(issueId);
    if (!issue) {
      return {
        success: false,
        error: {
          code: 'ISSUE_NOT_FOUND',
          message: `Issue ${issueId} not found`,
        },
      };
    }

    // Check if already claimed
    const existingClaim = await this.claimRepository.findByIssueId(issueId);
    if (existingClaim && existingClaim.status === 'active') {
      return {
        success: false,
        error: {
          code: 'ALREADY_CLAIMED',
          message: `Issue ${issueId} is already claimed by ${existingClaim.claimant.name}`,
          details: { currentClaimant: existingClaim.claimant },
        },
      };
    }

    // Check claimant's current workload
    const currentClaimCount = await this.claimRepository.countByClaimant(claimant.id);
    const maxClaims = claimant.maxConcurrentClaims ?? 5;
    if (currentClaimCount >= maxClaims) {
      return {
        success: false,
        error: {
          code: 'MAX_CLAIMS_EXCEEDED',
          message: `Claimant ${claimant.name} has reached maximum concurrent claims (${maxClaims})`,
          details: { currentClaims: currentClaimCount, maxClaims },
        },
      };
    }

    // Validate capabilities match (if required)
    if (issue.requiredCapabilities && issue.requiredCapabilities.length > 0) {
      const claimantCapabilities = claimant.capabilities ?? [];
      const missingCapabilities = issue.requiredCapabilities.filter(
        (cap) => !claimantCapabilities.includes(cap)
      );
      if (missingCapabilities.length > 0) {
        return {
          success: false,
          error: {
            code: 'CAPABILITY_MISMATCH',
            message: `Claimant lacks required capabilities: ${missingCapabilities.join(', ')}`,
            details: { missingCapabilities, requiredCapabilities: issue.requiredCapabilities },
          },
        };
      }
    }

    // Create the claim
    const now = new Date();
    const claimId = `claim-${randomUUID()}` as ClaimId;
    const claim: IssueClaim = {
      id: claimId,
      issueId,
      claimant,
      status: 'active',
      claimedAt: now,
      lastActivityAt: now,
      notes: [],
      handoffChain: [],
      reviewers: [],
    };

    // Save claim
    await this.claimRepository.save(claim);

    // Emit event
    const event = createClaimCreatedEvent(claimId, issueId, claimant);
    await this.eventStore.append(event);

    return { success: true, claim };
  }

  async release(issueId: string, claimant: Claimant): Promise<void> {
    const claim = await this.claimRepository.findByIssueId(issueId);

    // Validate claim exists
    if (!claim) {
      throw new ClaimOperationError('NOT_CLAIMED', `Issue ${issueId} is not claimed`);
    }

    // Validate claimant owns the claim
    if (claim.claimant.id !== claimant.id) {
      throw new ClaimOperationError(
        'UNAUTHORIZED',
        `Claimant ${claimant.name} does not own the claim on issue ${issueId}`
      );
    }

    // Check for pending handoffs
    const pendingHandoff = claim.handoffChain?.find((h) => h.status === 'pending');
    if (pendingHandoff) {
      throw new ClaimOperationError(
        'HANDOFF_PENDING',
        `Cannot release claim with pending handoff to ${pendingHandoff.to.name}`
      );
    }

    // Update claim status
    const previousStatus = claim.status;
    claim.status = 'released';
    claim.lastActivityAt = new Date();

    await this.claimRepository.save(claim);

    // Emit events
    const releaseEvent = createClaimReleasedEvent(claim.id, issueId, claimant);
    await this.eventStore.append(releaseEvent);

    if (previousStatus !== 'released') {
      const statusEvent = createClaimStatusChangedEvent(
        claim.id,
        issueId,
        previousStatus,
        'released'
      );
      await this.eventStore.append(statusEvent);
    }
  }

  // ==========================================================================
  // Handoffs
  // ==========================================================================

  async requestHandoff(issueId: string, from: Claimant, to: Claimant, reason: string): Promise<void> {
    const claim = await this.claimRepository.findByIssueId(issueId);

    // Validate claim exists
    if (!claim) {
      throw new ClaimOperationError('NOT_CLAIMED', `Issue ${issueId} is not claimed`);
    }

    // Validate 'from' claimant owns the claim
    if (claim.claimant.id !== from.id) {
      throw new ClaimOperationError(
        'UNAUTHORIZED',
        `Claimant ${from.name} does not own the claim on issue ${issueId}`
      );
    }

    // Check for existing pending handoffs
    const existingPending = claim.handoffChain?.find((h) => h.status === 'pending');
    if (existingPending) {
      throw new ClaimOperationError(
        'HANDOFF_PENDING',
        `A handoff to ${existingPending.to.name} is already pending`
      );
    }

    // Validate 'to' claimant exists
    const toClaimant = await this.claimantRepository.findById(to.id);
    if (!toClaimant) {
      throw new ClaimOperationError('CLAIMANT_NOT_FOUND', `Target claimant ${to.name} not found`);
    }

    // Create handoff record
    const handoffId = `handoff-${randomUUID()}`;
    const handoffRecord: HandoffRecord = {
      id: handoffId,
      from,
      to,
      reason,
      status: 'pending',
      requestedAt: new Date(),
    };

    // Update claim
    claim.handoffChain = claim.handoffChain ?? [];
    claim.handoffChain.push(handoffRecord);
    claim.status = 'pending_handoff';
    claim.lastActivityAt = new Date();

    await this.claimRepository.save(claim);

    // Emit events
    const handoffEvent = createHandoffRequestedEvent(claim.id, issueId, handoffId, from, to, reason);
    await this.eventStore.append(handoffEvent);

    const statusEvent = createClaimStatusChangedEvent(
      claim.id,
      issueId,
      'active',
      'pending_handoff'
    );
    await this.eventStore.append(statusEvent);
  }

  async acceptHandoff(issueId: string, claimant: Claimant): Promise<void> {
    const claim = await this.claimRepository.findByIssueId(issueId);

    // Validate claim exists
    if (!claim) {
      throw new ClaimOperationError('NOT_CLAIMED', `Issue ${issueId} is not claimed`);
    }

    // Find pending handoff for this claimant
    const pendingHandoff = claim.handoffChain?.find(
      (h) => h.status === 'pending' && h.to.id === claimant.id
    );

    if (!pendingHandoff) {
      throw new ClaimOperationError(
        'HANDOFF_NOT_FOUND',
        `No pending handoff found for claimant ${claimant.name}`
      );
    }

    // Check claimant's workload
    const currentClaimCount = await this.claimRepository.countByClaimant(claimant.id);
    const maxClaims = claimant.maxConcurrentClaims ?? 5;
    if (currentClaimCount >= maxClaims) {
      throw new ClaimOperationError(
        'MAX_CLAIMS_EXCEEDED',
        `Cannot accept handoff: claimant ${claimant.name} at max capacity`
      );
    }

    // Update handoff record
    pendingHandoff.status = 'accepted';
    pendingHandoff.resolvedAt = new Date();

    // Transfer claim to new owner
    const previousClaimant = claim.claimant;
    claim.claimant = claimant;
    claim.status = 'active';
    claim.lastActivityAt = new Date();

    await this.claimRepository.save(claim);

    // Emit events
    const acceptEvent = createHandoffAcceptedEvent(
      claim.id,
      issueId,
      pendingHandoff.id,
      previousClaimant,
      claimant
    );
    await this.eventStore.append(acceptEvent);

    const statusEvent = createClaimStatusChangedEvent(
      claim.id,
      issueId,
      'pending_handoff',
      'active'
    );
    await this.eventStore.append(statusEvent);
  }

  async rejectHandoff(issueId: string, claimant: Claimant, reason: string): Promise<void> {
    const claim = await this.claimRepository.findByIssueId(issueId);

    // Validate claim exists
    if (!claim) {
      throw new ClaimOperationError('NOT_CLAIMED', `Issue ${issueId} is not claimed`);
    }

    // Find pending handoff for this claimant
    const pendingHandoff = claim.handoffChain?.find(
      (h) => h.status === 'pending' && h.to.id === claimant.id
    );

    if (!pendingHandoff) {
      throw new ClaimOperationError(
        'HANDOFF_NOT_FOUND',
        `No pending handoff found for claimant ${claimant.name}`
      );
    }

    // Update handoff record
    pendingHandoff.status = 'rejected';
    pendingHandoff.resolvedAt = new Date();
    pendingHandoff.rejectionReason = reason;

    // Revert claim status to active
    claim.status = 'active';
    claim.lastActivityAt = new Date();

    await this.claimRepository.save(claim);

    // Emit events
    const rejectEvent = createHandoffRejectedEvent(
      claim.id,
      issueId,
      pendingHandoff.id,
      pendingHandoff.from,
      claimant,
      reason
    );
    await this.eventStore.append(rejectEvent);

    const statusEvent = createClaimStatusChangedEvent(
      claim.id,
      issueId,
      'pending_handoff',
      'active'
    );
    await this.eventStore.append(statusEvent);
  }

  // ==========================================================================
  // Status
  // ==========================================================================

  async updateStatus(issueId: string, status: ClaimStatus, note?: string): Promise<void> {
    const claim = await this.claimRepository.findByIssueId(issueId);

    // Validate claim exists
    if (!claim) {
      throw new ClaimOperationError('NOT_CLAIMED', `Issue ${issueId} is not claimed`);
    }

    // Validate status transition
    const validTransitions = this.getValidStatusTransitions(claim.status);
    if (!validTransitions.includes(status)) {
      throw new ClaimOperationError(
        'INVALID_STATUS_TRANSITION',
        `Cannot transition from ${claim.status} to ${status}`,
        { currentStatus: claim.status, requestedStatus: status, validTransitions }
      );
    }

    const previousStatus = claim.status;
    claim.status = status;
    claim.lastActivityAt = new Date();

    // Add note if provided
    if (note) {
      claim.notes = claim.notes ?? [];
      claim.notes.push(`[${new Date().toISOString()}] Status changed to ${status}: ${note}`);
    }

    await this.claimRepository.save(claim);

    // Emit event
    const statusEvent = createClaimStatusChangedEvent(
      claim.id,
      issueId,
      previousStatus,
      status,
      note
    );
    await this.eventStore.append(statusEvent);
  }

  async requestReview(issueId: string, reviewers: Claimant[]): Promise<void> {
    const claim = await this.claimRepository.findByIssueId(issueId);

    // Validate claim exists
    if (!claim) {
      throw new ClaimOperationError('NOT_CLAIMED', `Issue ${issueId} is not claimed`);
    }

    // Validate at least one reviewer
    if (!reviewers || reviewers.length === 0) {
      throw new ClaimOperationError('VALIDATION_ERROR', 'At least one reviewer is required');
    }

    // Validate reviewers exist
    for (const reviewer of reviewers) {
      const exists = await this.claimantRepository.exists(reviewer.id);
      if (!exists) {
        throw new ClaimOperationError(
          'CLAIMANT_NOT_FOUND',
          `Reviewer ${reviewer.name} not found`
        );
      }
    }

    // Update claim
    const previousStatus = claim.status;
    claim.reviewers = reviewers;
    claim.status = 'in_review';
    claim.lastActivityAt = new Date();

    await this.claimRepository.save(claim);

    // Emit events
    const reviewEvent = createReviewRequestedEvent(
      claim.id,
      issueId,
      reviewers,
      claim.claimant
    );
    await this.eventStore.append(reviewEvent);

    if (previousStatus !== 'in_review') {
      const statusEvent = createClaimStatusChangedEvent(
        claim.id,
        issueId,
        previousStatus,
        'in_review'
      );
      await this.eventStore.append(statusEvent);
    }
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  async getClaimedBy(claimant: Claimant): Promise<IssueClaim[]> {
    return this.claimRepository.findByClaimant(claimant);
  }

  async getAvailableIssues(filters?: IssueFilters): Promise<Issue[]> {
    return this.issueRepository.findAvailable(filters);
  }

  async getIssueStatus(issueId: string): Promise<IssueWithClaim> {
    const issue = await this.issueRepository.findById(issueId);
    if (!issue) {
      throw new ClaimOperationError('ISSUE_NOT_FOUND', `Issue ${issueId} not found`);
    }

    const claim = await this.claimRepository.findByIssueId(issueId);
    const pendingHandoffs = claim?.handoffChain?.filter((h) => h.status === 'pending') ?? [];

    return {
      issue,
      claim,
      pendingHandoffs,
    };
  }

  // ==========================================================================
  // Auto-management
  // ==========================================================================

  async expireStale(maxAge: Duration): Promise<IssueClaim[]> {
    const maxAgeMs = durationToMs(maxAge);
    const staleSince = new Date(Date.now() - maxAgeMs);

    const staleClaims = await this.claimRepository.findStaleClaims(staleSince);
    const expiredClaims: IssueClaim[] = [];

    for (const claim of staleClaims) {
      // Only expire active claims
      if (claim.status !== 'active') {
        continue;
      }

      const previousStatus = claim.status;
      claim.status = 'expired';

      await this.claimRepository.save(claim);

      // Emit events
      const expireEvent = createClaimExpiredEvent(
        claim.id,
        claim.issueId,
        claim.claimant,
        claim.lastActivityAt.getTime()
      );
      await this.eventStore.append(expireEvent);

      const statusEvent = createClaimStatusChangedEvent(
        claim.id,
        claim.issueId,
        previousStatus,
        'expired'
      );
      await this.eventStore.append(statusEvent);

      expiredClaims.push(claim);
    }

    return expiredClaims;
  }

  async autoAssign(issue: Issue): Promise<Claimant | null> {
    // Get available claimants
    const availableClaimants = await this.claimantRepository.findAvailable();

    if (availableClaimants.length === 0) {
      return null;
    }

    // Score claimants based on capability match and workload
    const scoredClaimants = availableClaimants.map((claimant) => {
      let score = 0;

      // Capability matching
      if (issue.requiredCapabilities && issue.requiredCapabilities.length > 0) {
        const claimantCapabilities = claimant.capabilities ?? [];
        const matchedCapabilities = issue.requiredCapabilities.filter((cap) =>
          claimantCapabilities.includes(cap)
        );
        score += matchedCapabilities.length * 10;

        // Bonus for having all required capabilities
        if (matchedCapabilities.length === issue.requiredCapabilities.length) {
          score += 20;
        }
      } else {
        // No specific capabilities required, all claimants are equal
        score += 10;
      }

      // Specialization matching (labels to specializations)
      if (claimant.specializations && issue.labels) {
        const matchedSpecializations = issue.labels.filter(
          (label) => claimant.specializations?.includes(label)
        );
        score += matchedSpecializations.length * 5;
      }

      // Lower workload is better
      const workload = claimant.currentWorkload ?? 0;
      const maxClaims = claimant.maxConcurrentClaims ?? 5;
      const utilizationPenalty = (workload / maxClaims) * 15;
      score -= utilizationPenalty;

      // Prefer agents for agent-suitable tasks
      if (claimant.type === 'agent' && issue.complexity !== 'epic') {
        score += 3;
      }

      return { claimant, score };
    });

    // Sort by score (descending)
    scoredClaimants.sort((a, b) => b.score - a.score);

    // Return the best match
    const bestMatch = scoredClaimants[0];

    // Only return if the claimant has required capabilities
    if (issue.requiredCapabilities && issue.requiredCapabilities.length > 0) {
      const claimantCapabilities = bestMatch.claimant.capabilities ?? [];
      const hasAllRequired = issue.requiredCapabilities.every((cap) =>
        claimantCapabilities.includes(cap)
      );
      if (!hasAllRequired) {
        return null;
      }
    }

    return bestMatch.claimant;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Get valid status transitions from a given status
   */
  private getValidStatusTransitions(currentStatus: ClaimStatus): ClaimStatus[] {
    const transitions: Record<ClaimStatus, ClaimStatus[]> = {
      active: ['pending_handoff', 'in_review', 'completed', 'released', 'paused', 'blocked', 'stealable'],
      pending_handoff: ['active', 'released'],
      in_review: ['active', 'completed', 'released'],
      completed: [], // Terminal state
      released: [], // Terminal state
      expired: [], // Terminal state
      paused: ['active', 'blocked', 'stealable', 'completed'],
      blocked: ['active', 'paused', 'stealable', 'completed'],
      stealable: ['active', 'completed'],
    };

    return transitions[currentStatus] ?? [];
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<void> {
    await Promise.all([
      this.claimRepository.initialize(),
      this.issueRepository.initialize(),
      this.claimantRepository.initialize(),
      this.eventStore.initialize(),
    ]);
  }

  async shutdown(): Promise<void> {
    await Promise.all([
      this.claimRepository.shutdown(),
      this.issueRepository.shutdown(),
      this.claimantRepository.shutdown(),
      this.eventStore.shutdown(),
    ]);
  }
}
