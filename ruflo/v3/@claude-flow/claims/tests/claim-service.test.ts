/**
 * V3 Claude-Flow Claim Service Unit Tests
 *
 * London School TDD - Behavior Verification
 * Tests issue/task claiming, releasing, handoffs, and status transitions
 *
 * @module v3/claims/tests/claim-service
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock, type MockedInterface } from '../../testing/src/helpers/create-mock.js';

// =============================================================================
// Domain Types
// =============================================================================

type ClaimantType = 'agent' | 'human';
type ClaimStatus = 'active' | 'pending_handoff' | 'expired' | 'released';
type HandoffDirection = 'human_to_agent' | 'agent_to_agent' | 'agent_to_human';

interface Claimant {
  type: ClaimantType;
  id: string;
  agentType?: string;
  humanId?: string;
}

interface Claim {
  issueId: string;
  claimant: Claimant;
  status: ClaimStatus;
  claimedAt: Date;
  expiresAt: Date;
  metadata: ClaimMetadata;
}

interface ClaimMetadata {
  reason?: string;
  priority?: number;
  handoffRequested?: boolean;
  handoffTarget?: Claimant;
  handoffReason?: string;
}

interface HandoffRequest {
  claimId: string;
  from: Claimant;
  to: Claimant;
  reason: string;
  requestedAt: Date;
}

// =============================================================================
// Event Types
// =============================================================================

interface ClaimEvent {
  type: string;
  timestamp: Date;
  payload: unknown;
}

type ClaimEventType =
  | 'IssueClaimed'
  | 'IssueReleased'
  | 'HandoffRequested'
  | 'HandoffAccepted'
  | 'HandoffRejected'
  | 'ClaimStatusUpdated'
  | 'ClaimExpired';

// =============================================================================
// Interfaces (Collaborators)
// =============================================================================

interface IClaimRepository {
  findById(issueId: string): Promise<Claim | null>;
  save(claim: Claim): Promise<Claim>;
  update(claim: Claim): Promise<Claim>;
  delete(issueId: string): Promise<void>;
  findByClaimant(claimantId: string): Promise<Claim[]>;
  findExpiredClaims(before: Date): Promise<Claim[]>;
  findPendingHandoffs(): Promise<Claim[]>;
}

interface IEventStore {
  append(event: ClaimEvent): Promise<void>;
  getEvents(issueId: string): Promise<ClaimEvent[]>;
}

interface IClaimValidator {
  validateClaim(issueId: string, claimant: Claimant): Promise<{ valid: boolean; error?: string }>;
  validateHandoff(from: Claimant, to: Claimant): Promise<{ valid: boolean; error?: string }>;
}

interface IExpirationPolicy {
  calculateExpiration(claimant: Claimant): Date;
  isExpired(claim: Claim): boolean;
}

// =============================================================================
// Service Under Test
// =============================================================================

interface ClaimResult {
  success: boolean;
  claim?: Claim;
  error?: string;
}

interface ReleaseResult {
  success: boolean;
  error?: string;
}

interface HandoffResult {
  success: boolean;
  handoffRequest?: HandoffRequest;
  error?: string;
}

interface StatusUpdateResult {
  success: boolean;
  previousStatus?: ClaimStatus;
  newStatus?: ClaimStatus;
  error?: string;
}

interface ExpireResult {
  expiredCount: number;
  claims: Claim[];
}

class ClaimService {
  constructor(
    private readonly repository: IClaimRepository,
    private readonly eventStore: IEventStore,
    private readonly validator: IClaimValidator,
    private readonly expirationPolicy: IExpirationPolicy
  ) {}

  async claim(issueId: string, claimant: Claimant): Promise<ClaimResult> {
    // Check if already claimed
    const existing = await this.repository.findById(issueId);
    if (existing && existing.status === 'active') {
      throw new Error('Issue already claimed');
    }

    // Validate claim
    const validation = await this.validator.validateClaim(issueId, claimant);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Create claim
    const claim: Claim = {
      issueId,
      claimant,
      status: 'active',
      claimedAt: new Date(),
      expiresAt: this.expirationPolicy.calculateExpiration(claimant),
      metadata: {},
    };

    const savedClaim = await this.repository.save(claim);

    // Emit event
    await this.eventStore.append({
      type: 'IssueClaimed',
      timestamp: new Date(),
      payload: { issueId, claimant },
    });

    return { success: true, claim: savedClaim };
  }

  async release(issueId: string, claimant: Claimant): Promise<ReleaseResult> {
    const existing = await this.repository.findById(issueId);
    if (!existing) {
      return { success: false, error: 'Claim not found' };
    }

    // Verify ownership
    if (existing.claimant.id !== claimant.id) {
      throw new Error('Not the owner of this claim');
    }

    // Update status and save
    existing.status = 'released';
    await this.repository.update(existing);

    // Emit event
    await this.eventStore.append({
      type: 'IssueReleased',
      timestamp: new Date(),
      payload: { issueId, releasedBy: claimant },
    });

    return { success: true };
  }

  async requestHandoff(
    issueId: string,
    from: Claimant,
    to: Claimant,
    reason: string
  ): Promise<HandoffResult> {
    const existing = await this.repository.findById(issueId);
    if (!existing) {
      return { success: false, error: 'Claim not found' };
    }

    // Verify ownership
    if (existing.claimant.id !== from.id) {
      return { success: false, error: 'Not the owner of this claim' };
    }

    // Validate handoff
    const validation = await this.validator.validateHandoff(from, to);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Update claim with handoff request
    existing.status = 'pending_handoff';
    existing.metadata.handoffRequested = true;
    existing.metadata.handoffTarget = to;
    existing.metadata.handoffReason = reason;
    await this.repository.update(existing);

    const handoffRequest: HandoffRequest = {
      claimId: issueId,
      from,
      to,
      reason,
      requestedAt: new Date(),
    };

    // Emit event
    await this.eventStore.append({
      type: 'HandoffRequested',
      timestamp: new Date(),
      payload: handoffRequest,
    });

    return { success: true, handoffRequest };
  }

  async acceptHandoff(issueId: string, acceptingClaimant: Claimant): Promise<HandoffResult> {
    const existing = await this.repository.findById(issueId);
    if (!existing) {
      return { success: false, error: 'Claim not found' };
    }

    if (existing.status !== 'pending_handoff') {
      return { success: false, error: 'No pending handoff for this claim' };
    }

    // Verify the accepting claimant is the target
    if (existing.metadata.handoffTarget?.id !== acceptingClaimant.id) {
      return { success: false, error: 'Not the handoff target' };
    }

    // Transfer ownership
    const previousOwner = existing.claimant;
    existing.claimant = acceptingClaimant;
    existing.status = 'active';
    existing.claimedAt = new Date();
    existing.expiresAt = this.expirationPolicy.calculateExpiration(acceptingClaimant);
    existing.metadata.handoffRequested = false;
    existing.metadata.handoffTarget = undefined;
    existing.metadata.handoffReason = undefined;

    await this.repository.update(existing);

    // Emit event
    await this.eventStore.append({
      type: 'HandoffAccepted',
      timestamp: new Date(),
      payload: { issueId, from: previousOwner, to: acceptingClaimant },
    });

    return { success: true };
  }

  async rejectHandoff(issueId: string, rejectingClaimant: Claimant, reason: string): Promise<HandoffResult> {
    const existing = await this.repository.findById(issueId);
    if (!existing) {
      return { success: false, error: 'Claim not found' };
    }

    if (existing.status !== 'pending_handoff') {
      return { success: false, error: 'No pending handoff for this claim' };
    }

    // Verify the rejecting claimant is the target
    if (existing.metadata.handoffTarget?.id !== rejectingClaimant.id) {
      return { success: false, error: 'Not the handoff target' };
    }

    // Restore to active status
    existing.status = 'active';
    existing.metadata.handoffRequested = false;
    existing.metadata.handoffTarget = undefined;
    existing.metadata.handoffReason = undefined;

    await this.repository.update(existing);

    // Emit event
    await this.eventStore.append({
      type: 'HandoffRejected',
      timestamp: new Date(),
      payload: { issueId, rejectedBy: rejectingClaimant, reason },
    });

    return { success: true };
  }

  async updateStatus(issueId: string, newStatus: ClaimStatus, claimant: Claimant): Promise<StatusUpdateResult> {
    const existing = await this.repository.findById(issueId);
    if (!existing) {
      return { success: false, error: 'Claim not found' };
    }

    // Verify ownership for status changes
    if (existing.claimant.id !== claimant.id) {
      return { success: false, error: 'Not the owner of this claim' };
    }

    // Validate status transition
    const validTransitions: Record<ClaimStatus, ClaimStatus[]> = {
      active: ['pending_handoff', 'released', 'expired'],
      pending_handoff: ['active', 'released'],
      expired: ['active'], // Can reactivate expired claims
      released: [], // Terminal state
    };

    if (!validTransitions[existing.status].includes(newStatus)) {
      return {
        success: false,
        error: `Invalid status transition from ${existing.status} to ${newStatus}`,
      };
    }

    const previousStatus = existing.status;
    existing.status = newStatus;
    await this.repository.update(existing);

    // Emit event
    await this.eventStore.append({
      type: 'ClaimStatusUpdated',
      timestamp: new Date(),
      payload: { issueId, previousStatus, newStatus },
    });

    return { success: true, previousStatus, newStatus };
  }

  async expireStale(cutoffDate: Date): Promise<ExpireResult> {
    const expiredClaims = await this.repository.findExpiredClaims(cutoffDate);
    const processedClaims: Claim[] = [];

    for (const claim of expiredClaims) {
      if (this.expirationPolicy.isExpired(claim)) {
        claim.status = 'expired';
        await this.repository.update(claim);
        processedClaims.push(claim);

        // Emit event for each expired claim
        await this.eventStore.append({
          type: 'ClaimExpired',
          timestamp: new Date(),
          payload: { issueId: claim.issueId, expiredAt: cutoffDate },
        });
      }
    }

    return {
      expiredCount: processedClaims.length,
      claims: processedClaims,
    };
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('ClaimService', () => {
  let service: ClaimService;
  let mockRepository: MockedInterface<IClaimRepository>;
  let mockEventStore: MockedInterface<IEventStore>;
  let mockValidator: MockedInterface<IClaimValidator>;
  let mockExpirationPolicy: MockedInterface<IExpirationPolicy>;

  const agentClaimant: Claimant = {
    type: 'agent',
    id: 'coder-1',
    agentType: 'coder',
  };

  const humanClaimant: Claimant = {
    type: 'human',
    id: 'user-123',
    humanId: 'john.doe',
  };

  const anotherAgentClaimant: Claimant = {
    type: 'agent',
    id: 'reviewer-1',
    agentType: 'reviewer',
  };

  const baseDate = new Date('2024-01-15T10:00:00Z');
  const expirationDate = new Date('2024-01-16T10:00:00Z');

  beforeEach(() => {
    mockRepository = createMock<IClaimRepository>();
    mockEventStore = createMock<IEventStore>();
    mockValidator = createMock<IClaimValidator>();
    mockExpirationPolicy = createMock<IExpirationPolicy>();

    // Default mock behaviors
    mockValidator.validateClaim.mockResolvedValue({ valid: true });
    mockValidator.validateHandoff.mockResolvedValue({ valid: true });
    mockExpirationPolicy.calculateExpiration.mockReturnValue(expirationDate);
    mockExpirationPolicy.isExpired.mockReturnValue(false);
    mockEventStore.append.mockResolvedValue(undefined);

    service = new ClaimService(
      mockRepository,
      mockEventStore,
      mockValidator,
      mockExpirationPolicy
    );
  });

  // ===========================================================================
  // claim() tests
  // ===========================================================================

  describe('claim', () => {
    it('should successfully claim an unclaimed issue', async () => {
      // Given
      mockRepository.findById.mockResolvedValue(null);
      mockRepository.save.mockImplementation(async (claim) => claim);

      // When
      const result = await service.claim('issue-1', agentClaimant);

      // Then
      expect(result.success).toBe(true);
      expect(result.claim).toBeDefined();
      expect(result.claim?.issueId).toBe('issue-1');
      expect(result.claim?.claimant).toEqual(agentClaimant);
      expect(result.claim?.status).toBe('active');
    });

    it('should reject claim for already claimed issue', async () => {
      // Given
      const existingClaim: Claim = {
        issueId: 'issue-1',
        claimant: anotherAgentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(existingClaim);

      // When/Then
      await expect(service.claim('issue-1', agentClaimant))
        .rejects.toThrow('Issue already claimed');
    });

    it('should allow claiming a released issue', async () => {
      // Given
      const releasedClaim: Claim = {
        issueId: 'issue-1',
        claimant: anotherAgentClaimant,
        status: 'released',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(releasedClaim);
      mockRepository.save.mockImplementation(async (claim) => claim);

      // When
      const result = await service.claim('issue-1', agentClaimant);

      // Then
      expect(result.success).toBe(true);
      expect(result.claim?.claimant).toEqual(agentClaimant);
    });

    it('should validate claim before creating', async () => {
      // Given
      mockRepository.findById.mockResolvedValue(null);
      mockValidator.validateClaim.mockResolvedValue({
        valid: false,
        error: 'Claimant not authorized',
      });

      // When
      const result = await service.claim('issue-1', agentClaimant);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Claimant not authorized');
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should emit IssueClaimed event on successful claim', async () => {
      // Given
      mockRepository.findById.mockResolvedValue(null);
      mockRepository.save.mockImplementation(async (claim) => claim);

      // When
      await service.claim('issue-1', agentClaimant);

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'IssueClaimed',
          payload: { issueId: 'issue-1', claimant: agentClaimant },
        })
      );
    });

    it('should calculate expiration based on claimant type', async () => {
      // Given
      mockRepository.findById.mockResolvedValue(null);
      mockRepository.save.mockImplementation(async (claim) => claim);

      // When
      await service.claim('issue-1', humanClaimant);

      // Then
      expect(mockExpirationPolicy.calculateExpiration).toHaveBeenCalledWith(humanClaimant);
    });

    it('should save claim with correct metadata', async () => {
      // Given
      mockRepository.findById.mockResolvedValue(null);
      mockRepository.save.mockImplementation(async (claim) => claim);

      // When
      await service.claim('issue-1', agentClaimant);

      // Then
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'active',
          expiresAt: expirationDate,
        })
      );
    });
  });

  // ===========================================================================
  // release() tests
  // ===========================================================================

  describe('release', () => {
    it('should successfully release owned claim', async () => {
      // Given
      const existingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(existingClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      const result = await service.release('issue-1', agentClaimant);

      // Then
      expect(result.success).toBe(true);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'released' })
      );
    });

    it('should reject release by non-owner', async () => {
      // Given
      const existingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(existingClaim);

      // When/Then
      await expect(service.release('issue-1', anotherAgentClaimant))
        .rejects.toThrow('Not the owner of this claim');
    });

    it('should return error for non-existent claim', async () => {
      // Given
      mockRepository.findById.mockResolvedValue(null);

      // When
      const result = await service.release('issue-999', agentClaimant);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Claim not found');
    });

    it('should emit IssueReleased event', async () => {
      // Given
      const existingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(existingClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      await service.release('issue-1', agentClaimant);

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'IssueReleased',
          payload: expect.objectContaining({
            issueId: 'issue-1',
            releasedBy: agentClaimant,
          }),
        })
      );
    });
  });

  // ===========================================================================
  // requestHandoff() tests
  // ===========================================================================

  describe('requestHandoff', () => {
    describe('human to agent handoff', () => {
      it('should successfully request handoff from human to agent', async () => {
        // Given
        const existingClaim: Claim = {
          issueId: 'issue-1',
          claimant: humanClaimant,
          status: 'active',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        };
        mockRepository.findById.mockResolvedValue(existingClaim);
        mockRepository.update.mockImplementation(async (claim) => claim);

        // When
        const result = await service.requestHandoff(
          'issue-1',
          humanClaimant,
          agentClaimant,
          'Delegating to coder agent'
        );

        // Then
        expect(result.success).toBe(true);
        expect(result.handoffRequest?.from).toEqual(humanClaimant);
        expect(result.handoffRequest?.to).toEqual(agentClaimant);
      });
    });

    describe('agent to agent handoff', () => {
      it('should successfully request handoff between agents', async () => {
        // Given
        const existingClaim: Claim = {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'active',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        };
        mockRepository.findById.mockResolvedValue(existingClaim);
        mockRepository.update.mockImplementation(async (claim) => claim);

        // When
        const result = await service.requestHandoff(
          'issue-1',
          agentClaimant,
          anotherAgentClaimant,
          'Need code review'
        );

        // Then
        expect(result.success).toBe(true);
        expect(result.handoffRequest?.from.agentType).toBe('coder');
        expect(result.handoffRequest?.to.agentType).toBe('reviewer');
      });
    });

    describe('agent to human handoff', () => {
      it('should successfully request handoff from agent to human', async () => {
        // Given
        const existingClaim: Claim = {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'active',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        };
        mockRepository.findById.mockResolvedValue(existingClaim);
        mockRepository.update.mockImplementation(async (claim) => claim);

        // When
        const result = await service.requestHandoff(
          'issue-1',
          agentClaimant,
          humanClaimant,
          'Human approval required'
        );

        // Then
        expect(result.success).toBe(true);
        expect(result.handoffRequest?.from.type).toBe('agent');
        expect(result.handoffRequest?.to.type).toBe('human');
      });
    });

    it('should update claim status to pending_handoff', async () => {
      // Given
      const existingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(existingClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      await service.requestHandoff('issue-1', agentClaimant, humanClaimant, 'Reason');

      // Then
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending_handoff',
          metadata: expect.objectContaining({
            handoffRequested: true,
            handoffTarget: humanClaimant,
            handoffReason: 'Reason',
          }),
        })
      );
    });

    it('should reject handoff request from non-owner', async () => {
      // Given
      const existingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(existingClaim);

      // When
      const result = await service.requestHandoff(
        'issue-1',
        anotherAgentClaimant,
        humanClaimant,
        'Trying to steal'
      );

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not the owner of this claim');
    });

    it('should validate handoff participants', async () => {
      // Given
      const existingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(existingClaim);
      mockValidator.validateHandoff.mockResolvedValue({
        valid: false,
        error: 'Target agent unavailable',
      });

      // When
      const result = await service.requestHandoff(
        'issue-1',
        agentClaimant,
        anotherAgentClaimant,
        'Handoff reason'
      );

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Target agent unavailable');
    });

    it('should emit HandoffRequested event', async () => {
      // Given
      const existingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(existingClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      await service.requestHandoff('issue-1', agentClaimant, humanClaimant, 'Review needed');

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HandoffRequested',
          payload: expect.objectContaining({
            from: agentClaimant,
            to: humanClaimant,
            reason: 'Review needed',
          }),
        })
      );
    });
  });

  // ===========================================================================
  // acceptHandoff() tests
  // ===========================================================================

  describe('acceptHandoff', () => {
    it('should transfer ownership on accept', async () => {
      // Given
      const pendingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'pending_handoff',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {
          handoffRequested: true,
          handoffTarget: humanClaimant,
          handoffReason: 'Human review',
        },
      };
      mockRepository.findById.mockResolvedValue(pendingClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      const result = await service.acceptHandoff('issue-1', humanClaimant);

      // Then
      expect(result.success).toBe(true);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          claimant: humanClaimant,
          status: 'active',
        })
      );
    });

    it('should reject acceptance from non-target', async () => {
      // Given
      const pendingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'pending_handoff',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {
          handoffRequested: true,
          handoffTarget: humanClaimant,
          handoffReason: 'Human review',
        },
      };
      mockRepository.findById.mockResolvedValue(pendingClaim);

      // When
      const result = await service.acceptHandoff('issue-1', anotherAgentClaimant);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not the handoff target');
    });

    it('should reject accept when no pending handoff', async () => {
      // Given
      const activeClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(activeClaim);

      // When
      const result = await service.acceptHandoff('issue-1', humanClaimant);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('No pending handoff for this claim');
    });

    it('should recalculate expiration for new owner', async () => {
      // Given
      const pendingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'pending_handoff',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {
          handoffRequested: true,
          handoffTarget: humanClaimant,
          handoffReason: 'Human review',
        },
      };
      mockRepository.findById.mockResolvedValue(pendingClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      await service.acceptHandoff('issue-1', humanClaimant);

      // Then
      expect(mockExpirationPolicy.calculateExpiration).toHaveBeenCalledWith(humanClaimant);
    });

    it('should emit HandoffAccepted event', async () => {
      // Given
      const pendingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'pending_handoff',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {
          handoffRequested: true,
          handoffTarget: humanClaimant,
          handoffReason: 'Human review',
        },
      };
      mockRepository.findById.mockResolvedValue(pendingClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      await service.acceptHandoff('issue-1', humanClaimant);

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HandoffAccepted',
          payload: expect.objectContaining({
            issueId: 'issue-1',
            from: agentClaimant,
            to: humanClaimant,
          }),
        })
      );
    });

    it('should clear handoff metadata after accept', async () => {
      // Given
      const pendingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'pending_handoff',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {
          handoffRequested: true,
          handoffTarget: humanClaimant,
          handoffReason: 'Human review',
        },
      };
      mockRepository.findById.mockResolvedValue(pendingClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      await service.acceptHandoff('issue-1', humanClaimant);

      // Then
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            handoffRequested: false,
            handoffTarget: undefined,
            handoffReason: undefined,
          }),
        })
      );
    });
  });

  // ===========================================================================
  // rejectHandoff() tests
  // ===========================================================================

  describe('rejectHandoff', () => {
    it('should restore active status on rejection', async () => {
      // Given
      const pendingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'pending_handoff',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {
          handoffRequested: true,
          handoffTarget: humanClaimant,
          handoffReason: 'Human review',
        },
      };
      mockRepository.findById.mockResolvedValue(pendingClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      const result = await service.rejectHandoff('issue-1', humanClaimant, 'Too busy');

      // Then
      expect(result.success).toBe(true);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'active',
          claimant: agentClaimant, // Original owner retained
        })
      );
    });

    it('should reject from non-target claimant', async () => {
      // Given
      const pendingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'pending_handoff',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {
          handoffRequested: true,
          handoffTarget: humanClaimant,
          handoffReason: 'Human review',
        },
      };
      mockRepository.findById.mockResolvedValue(pendingClaim);

      // When
      const result = await service.rejectHandoff('issue-1', anotherAgentClaimant, 'Unauthorized');

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not the handoff target');
    });

    it('should emit HandoffRejected event', async () => {
      // Given
      const pendingClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'pending_handoff',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {
          handoffRequested: true,
          handoffTarget: humanClaimant,
          handoffReason: 'Human review',
        },
      };
      mockRepository.findById.mockResolvedValue(pendingClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      await service.rejectHandoff('issue-1', humanClaimant, 'Cannot accept now');

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HandoffRejected',
          payload: expect.objectContaining({
            issueId: 'issue-1',
            rejectedBy: humanClaimant,
            reason: 'Cannot accept now',
          }),
        })
      );
    });
  });

  // ===========================================================================
  // updateStatus() tests
  // ===========================================================================

  describe('updateStatus', () => {
    describe('valid status transitions', () => {
      it('should allow active to pending_handoff', async () => {
        // Given
        const activeClaim: Claim = {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'active',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        };
        mockRepository.findById.mockResolvedValue(activeClaim);
        mockRepository.update.mockImplementation(async (claim) => claim);

        // When
        const result = await service.updateStatus('issue-1', 'pending_handoff', agentClaimant);

        // Then
        expect(result.success).toBe(true);
        expect(result.previousStatus).toBe('active');
        expect(result.newStatus).toBe('pending_handoff');
      });

      it('should allow active to released', async () => {
        // Given
        const activeClaim: Claim = {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'active',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        };
        mockRepository.findById.mockResolvedValue(activeClaim);
        mockRepository.update.mockImplementation(async (claim) => claim);

        // When
        const result = await service.updateStatus('issue-1', 'released', agentClaimant);

        // Then
        expect(result.success).toBe(true);
        expect(result.newStatus).toBe('released');
      });

      it('should allow active to expired', async () => {
        // Given
        const activeClaim: Claim = {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'active',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        };
        mockRepository.findById.mockResolvedValue(activeClaim);
        mockRepository.update.mockImplementation(async (claim) => claim);

        // When
        const result = await service.updateStatus('issue-1', 'expired', agentClaimant);

        // Then
        expect(result.success).toBe(true);
        expect(result.newStatus).toBe('expired');
      });

      it('should allow pending_handoff to active (cancel handoff)', async () => {
        // Given
        const pendingClaim: Claim = {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'pending_handoff',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        };
        mockRepository.findById.mockResolvedValue(pendingClaim);
        mockRepository.update.mockImplementation(async (claim) => claim);

        // When
        const result = await service.updateStatus('issue-1', 'active', agentClaimant);

        // Then
        expect(result.success).toBe(true);
        expect(result.previousStatus).toBe('pending_handoff');
        expect(result.newStatus).toBe('active');
      });

      it('should allow expired to active (reactivate)', async () => {
        // Given
        const expiredClaim: Claim = {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'expired',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        };
        mockRepository.findById.mockResolvedValue(expiredClaim);
        mockRepository.update.mockImplementation(async (claim) => claim);

        // When
        const result = await service.updateStatus('issue-1', 'active', agentClaimant);

        // Then
        expect(result.success).toBe(true);
        expect(result.previousStatus).toBe('expired');
        expect(result.newStatus).toBe('active');
      });
    });

    describe('invalid status transitions', () => {
      it('should reject released to active (terminal state)', async () => {
        // Given
        const releasedClaim: Claim = {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'released',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        };
        mockRepository.findById.mockResolvedValue(releasedClaim);

        // When
        const result = await service.updateStatus('issue-1', 'active', agentClaimant);

        // Then
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid status transition');
      });

      it('should reject pending_handoff to expired', async () => {
        // Given
        const pendingClaim: Claim = {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'pending_handoff',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        };
        mockRepository.findById.mockResolvedValue(pendingClaim);

        // When
        const result = await service.updateStatus('issue-1', 'expired', agentClaimant);

        // Then
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid status transition from pending_handoff to expired');
      });
    });

    it('should reject status change by non-owner', async () => {
      // Given
      const activeClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(activeClaim);

      // When
      const result = await service.updateStatus('issue-1', 'released', anotherAgentClaimant);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not the owner of this claim');
    });

    it('should emit ClaimStatusUpdated event', async () => {
      // Given
      const activeClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(activeClaim);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      await service.updateStatus('issue-1', 'released', agentClaimant);

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ClaimStatusUpdated',
          payload: {
            issueId: 'issue-1',
            previousStatus: 'active',
            newStatus: 'released',
          },
        })
      );
    });
  });

  // ===========================================================================
  // expireStale() tests
  // ===========================================================================

  describe('expireStale', () => {
    it('should expire old claims correctly', async () => {
      // Given
      const cutoffDate = new Date('2024-01-15T12:00:00Z');
      const staleClaims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'active',
          claimedAt: new Date('2024-01-10T10:00:00Z'),
          expiresAt: new Date('2024-01-11T10:00:00Z'),
          metadata: {},
        },
        {
          issueId: 'issue-2',
          claimant: humanClaimant,
          status: 'active',
          claimedAt: new Date('2024-01-12T10:00:00Z'),
          expiresAt: new Date('2024-01-13T10:00:00Z'),
          metadata: {},
        },
      ];
      mockRepository.findExpiredClaims.mockResolvedValue(staleClaims);
      mockExpirationPolicy.isExpired.mockReturnValue(true);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      const result = await service.expireStale(cutoffDate);

      // Then
      expect(result.expiredCount).toBe(2);
      expect(result.claims).toHaveLength(2);
      expect(mockRepository.update).toHaveBeenCalledTimes(2);
    });

    it('should only expire claims where policy confirms expiration', async () => {
      // Given
      const cutoffDate = new Date('2024-01-15T12:00:00Z');
      const claims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'active',
          claimedAt: new Date('2024-01-10T10:00:00Z'),
          expiresAt: new Date('2024-01-11T10:00:00Z'),
          metadata: {},
        },
        {
          issueId: 'issue-2',
          claimant: humanClaimant,
          status: 'active',
          claimedAt: new Date('2024-01-14T10:00:00Z'),
          expiresAt: new Date('2024-01-16T10:00:00Z'), // Not yet expired
          metadata: {},
        },
      ];
      mockRepository.findExpiredClaims.mockResolvedValue(claims);
      mockExpirationPolicy.isExpired
        .mockReturnValueOnce(true)  // First claim expired
        .mockReturnValueOnce(false); // Second claim not expired
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      const result = await service.expireStale(cutoffDate);

      // Then
      expect(result.expiredCount).toBe(1);
      expect(mockRepository.update).toHaveBeenCalledTimes(1);
    });

    it('should emit ClaimExpired event for each expired claim', async () => {
      // Given
      const cutoffDate = new Date('2024-01-15T12:00:00Z');
      const staleClaims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: agentClaimant,
          status: 'active',
          claimedAt: baseDate,
          expiresAt: expirationDate,
          metadata: {},
        },
      ];
      mockRepository.findExpiredClaims.mockResolvedValue(staleClaims);
      mockExpirationPolicy.isExpired.mockReturnValue(true);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      await service.expireStale(cutoffDate);

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ClaimExpired',
          payload: expect.objectContaining({
            issueId: 'issue-1',
          }),
        })
      );
    });

    it('should return empty result when no claims to expire', async () => {
      // Given
      const cutoffDate = new Date('2024-01-15T12:00:00Z');
      mockRepository.findExpiredClaims.mockResolvedValue([]);

      // When
      const result = await service.expireStale(cutoffDate);

      // Then
      expect(result.expiredCount).toBe(0);
      expect(result.claims).toHaveLength(0);
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('should update claim status to expired', async () => {
      // Given
      const cutoffDate = new Date('2024-01-15T12:00:00Z');
      const staleClaim: Claim = {
        issueId: 'issue-1',
        claimant: agentClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: expirationDate,
        metadata: {},
      };
      mockRepository.findExpiredClaims.mockResolvedValue([staleClaim]);
      mockExpirationPolicy.isExpired.mockReturnValue(true);
      mockRepository.update.mockImplementation(async (claim) => claim);

      // When
      await service.expireStale(cutoffDate);

      // Then
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'expired',
        })
      );
    });
  });

  // ===========================================================================
  // Interaction verification tests
  // ===========================================================================

  describe('interaction verification', () => {
    it('should not emit events on validation failure', async () => {
      // Given
      mockRepository.findById.mockResolvedValue(null);
      mockValidator.validateClaim.mockResolvedValue({
        valid: false,
        error: 'Invalid claimant',
      });

      // When
      await service.claim('issue-1', agentClaimant);

      // Then
      expect(mockEventStore.append).not.toHaveBeenCalled();
    });

    it('should call repository before event store', async () => {
      // Given
      const callOrder: string[] = [];
      mockRepository.findById.mockResolvedValue(null);
      mockRepository.save.mockImplementation(async (claim) => {
        callOrder.push('repository.save');
        return claim;
      });
      mockEventStore.append.mockImplementation(async () => {
        callOrder.push('eventStore.append');
      });

      // When
      await service.claim('issue-1', agentClaimant);

      // Then
      expect(callOrder).toEqual(['repository.save', 'eventStore.append']);
    });
  });
});
