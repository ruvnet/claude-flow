/**
 * V3 Claude-Flow Work Stealing Service Unit Tests
 *
 * London School TDD - Behavior Verification
 * Tests work stealing, stealable marking, contestation, and cross-type rules
 *
 * @module v3/claims/tests/work-stealing-service
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMock, type MockedInterface } from '../../testing/src/helpers/create-mock.js';

// =============================================================================
// Domain Types
// =============================================================================

type ClaimantType = 'agent' | 'human';
type ClaimStatus = 'active' | 'pending_handoff' | 'expired' | 'released';
type AgentType = 'coder' | 'reviewer' | 'tester' | 'planner' | 'researcher' | 'queen-coordinator';

interface Claimant {
  type: ClaimantType;
  id: string;
  agentType?: AgentType;
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
  stealable?: boolean;
  stealableAt?: Date;
  stealProtected?: boolean;
  stealProtectionReason?: string;
  contestWindowEnds?: Date;
  staleSince?: Date;
  staleReason?: string;
}

interface StealResult {
  success: boolean;
  claim?: Claim;
  error?: string;
  contested?: boolean;
}

interface ContestResult {
  success: boolean;
  winner?: Claimant;
  error?: string;
}

interface StaleWorkResult {
  staleClaims: Claim[];
  count: number;
}

// =============================================================================
// Event Types
// =============================================================================

interface WorkStealingEvent {
  type: string;
  timestamp: Date;
  payload: unknown;
}

type WorkStealingEventType =
  | 'WorkMarkedStealable'
  | 'WorkStolen'
  | 'StealContested'
  | 'StealContestResolved'
  | 'StaleWorkDetected';

// =============================================================================
// Interfaces (Collaborators)
// =============================================================================

interface IClaimRepository {
  findById(issueId: string): Promise<Claim | null>;
  save(claim: Claim): Promise<Claim>;
  update(claim: Claim): Promise<Claim>;
  findStealable(options?: StealableQueryOptions): Promise<Claim[]>;
  findByClaimant(claimantId: string): Promise<Claim[]>;
  findStaleClaims(staleSince: Date): Promise<Claim[]>;
}

interface StealableQueryOptions {
  agentType?: AgentType;
  excludeProtected?: boolean;
  minStaleDuration?: number;
}

interface IEventStore {
  append(event: WorkStealingEvent): Promise<void>;
  getEvents(issueId: string): Promise<WorkStealingEvent[]>;
}

interface IStealingPolicy {
  canSteal(thief: Claimant, victim: Claimant, claim: Claim): boolean;
  getContestWindow(claim: Claim): number; // milliseconds
  resolveContest(original: Claimant, thief: Claimant, claim: Claim): Claimant;
}

interface IClock {
  now(): Date;
}

// =============================================================================
// Cross-Type Stealing Rules
// =============================================================================

interface CrossTypeStealingRules {
  // Which agent types can steal from which
  allowedSteals: Map<AgentType, AgentType[]>;
  // Priority levels for contest resolution
  priorityLevels: Map<AgentType, number>;
  // Human claims are always protected by default
  humanClaimsProtected: boolean;
}

const DEFAULT_STEALING_RULES: CrossTypeStealingRules = {
  allowedSteals: new Map([
    ['coder', ['coder', 'planner']], // Coders can steal from coders and planners
    ['reviewer', ['coder', 'reviewer']], // Reviewers can steal from coders and reviewers
    ['tester', ['tester', 'coder']], // Testers can steal from testers and coders
    ['planner', ['planner', 'researcher']], // Planners can steal from planners and researchers
    ['researcher', ['researcher']], // Researchers can only steal from researchers
    ['queen-coordinator', ['coder', 'reviewer', 'tester', 'planner', 'researcher']], // Queen can steal from anyone
  ]),
  priorityLevels: new Map([
    ['queen-coordinator', 100],
    ['reviewer', 80],
    ['tester', 70],
    ['coder', 60],
    ['planner', 50],
    ['researcher', 40],
  ]),
  humanClaimsProtected: true,
};

// =============================================================================
// Service Under Test
// =============================================================================

class WorkStealingService {
  private readonly contestWindow = 30000; // 30 seconds default

  constructor(
    private readonly repository: IClaimRepository,
    private readonly eventStore: IEventStore,
    private readonly stealingPolicy: IStealingPolicy,
    private readonly clock: IClock,
    private readonly rules: CrossTypeStealingRules = DEFAULT_STEALING_RULES
  ) {}

  async markStealable(issueId: string, owner: Claimant, stealableAfter?: Date): Promise<Claim> {
    const claim = await this.repository.findById(issueId);
    if (!claim) {
      throw new Error('Claim not found');
    }

    if (claim.claimant.id !== owner.id) {
      throw new Error('Not the owner of this claim');
    }

    const now = this.clock.now();
    claim.metadata.stealable = true;
    claim.metadata.stealableAt = stealableAfter ?? now;
    claim.metadata.stealProtected = false;

    const updatedClaim = await this.repository.update(claim);

    await this.eventStore.append({
      type: 'WorkMarkedStealable',
      timestamp: now,
      payload: { issueId, owner, stealableAt: claim.metadata.stealableAt },
    });

    return updatedClaim;
  }

  async steal(issueId: string, thief: Claimant): Promise<StealResult> {
    const claim = await this.repository.findById(issueId);
    if (!claim) {
      return { success: false, error: 'Claim not found' };
    }

    // Check if protected
    if (claim.metadata.stealProtected) {
      return {
        success: false,
        error: `Claim is protected: ${claim.metadata.stealProtectionReason || 'Protected claim'}`,
      };
    }

    // Check if stealable
    if (!claim.metadata.stealable) {
      return { success: false, error: 'Claim is not marked as stealable' };
    }

    const now = this.clock.now();

    // Check if stealable time has passed
    if (claim.metadata.stealableAt && claim.metadata.stealableAt > now) {
      return {
        success: false,
        error: 'Claim is not yet stealable',
      };
    }

    // Check cross-type stealing rules
    if (!this.stealingPolicy.canSteal(thief, claim.claimant, claim)) {
      return {
        success: false,
        error: 'Cross-type stealing not allowed',
      };
    }

    // Transfer ownership
    const previousOwner = claim.claimant;
    claim.claimant = thief;
    claim.claimedAt = now;
    claim.metadata.stealable = false;
    claim.metadata.stealableAt = undefined;
    claim.metadata.contestWindowEnds = new Date(now.getTime() + this.stealingPolicy.getContestWindow(claim));

    const updatedClaim = await this.repository.update(claim);

    await this.eventStore.append({
      type: 'WorkStolen',
      timestamp: now,
      payload: { issueId, from: previousOwner, to: thief },
    });

    return { success: true, claim: updatedClaim };
  }

  async getStealable(options?: StealableQueryOptions): Promise<Claim[]> {
    const now = this.clock.now();
    const claims = await this.repository.findStealable(options);

    // Filter claims that are actually stealable now
    return claims.filter((claim) => {
      // Exclude protected claims if requested
      if (options?.excludeProtected && claim.metadata.stealProtected) {
        return false;
      }

      // Check stealable time
      if (claim.metadata.stealableAt && claim.metadata.stealableAt > now) {
        return false;
      }

      // Filter by agent type if specified
      if (options?.agentType) {
        const allowedTargets = this.rules.allowedSteals.get(options.agentType) || [];
        if (claim.claimant.type === 'agent' && claim.claimant.agentType) {
          return allowedTargets.includes(claim.claimant.agentType);
        }
        // Human claims check
        if (claim.claimant.type === 'human' && this.rules.humanClaimsProtected) {
          return false;
        }
      }

      return true;
    });
  }

  async contestSteal(issueId: string, originalOwner: Claimant, reason: string): Promise<ContestResult> {
    const claim = await this.repository.findById(issueId);
    if (!claim) {
      return { success: false, error: 'Claim not found' };
    }

    const now = this.clock.now();

    // Check if within contest window
    if (!claim.metadata.contestWindowEnds || claim.metadata.contestWindowEnds < now) {
      return { success: false, error: 'Contest window has expired' };
    }

    // Verify original owner is contesting
    // (originalOwner should have been the previous owner)

    await this.eventStore.append({
      type: 'StealContested',
      timestamp: now,
      payload: { issueId, contestedBy: originalOwner, reason },
    });

    // Resolve contest using policy
    const currentHolder = claim.claimant;
    const winner = this.stealingPolicy.resolveContest(originalOwner, currentHolder, claim);

    if (winner.id !== currentHolder.id) {
      // Original owner wins - restore ownership
      claim.claimant = winner;
      claim.claimedAt = now;
      claim.metadata.contestWindowEnds = undefined;
      await this.repository.update(claim);
    }

    await this.eventStore.append({
      type: 'StealContestResolved',
      timestamp: now,
      payload: { issueId, winner, loser: winner.id === originalOwner.id ? currentHolder : originalOwner },
    });

    return { success: true, winner };
  }

  async detectStaleWork(staleSince: Date): Promise<StaleWorkResult> {
    const staleClaims = await this.repository.findStaleClaims(staleSince);
    const now = this.clock.now();

    // Mark claims as stale
    for (const claim of staleClaims) {
      claim.metadata.staleSince = staleSince;
      claim.metadata.staleReason = 'No activity detected';
      await this.repository.update(claim);
    }

    if (staleClaims.length > 0) {
      await this.eventStore.append({
        type: 'StaleWorkDetected',
        timestamp: now,
        payload: {
          count: staleClaims.length,
          issueIds: staleClaims.map((c) => c.issueId),
          staleSince,
        },
      });
    }

    return {
      staleClaims,
      count: staleClaims.length,
    };
  }

  async setProtection(issueId: string, owner: Claimant, reason: string): Promise<Claim> {
    const claim = await this.repository.findById(issueId);
    if (!claim) {
      throw new Error('Claim not found');
    }

    if (claim.claimant.id !== owner.id) {
      throw new Error('Not the owner of this claim');
    }

    claim.metadata.stealProtected = true;
    claim.metadata.stealProtectionReason = reason;
    claim.metadata.stealable = false;

    return await this.repository.update(claim);
  }

  async removeProtection(issueId: string, owner: Claimant): Promise<Claim> {
    const claim = await this.repository.findById(issueId);
    if (!claim) {
      throw new Error('Claim not found');
    }

    if (claim.claimant.id !== owner.id) {
      throw new Error('Not the owner of this claim');
    }

    claim.metadata.stealProtected = false;
    claim.metadata.stealProtectionReason = undefined;

    return await this.repository.update(claim);
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('WorkStealingService', () => {
  let service: WorkStealingService;
  let mockRepository: MockedInterface<IClaimRepository>;
  let mockEventStore: MockedInterface<IEventStore>;
  let mockStealingPolicy: MockedInterface<IStealingPolicy>;
  let mockClock: MockedInterface<IClock>;

  const coderClaimant: Claimant = {
    type: 'agent',
    id: 'coder-1',
    agentType: 'coder',
  };

  const reviewerClaimant: Claimant = {
    type: 'agent',
    id: 'reviewer-1',
    agentType: 'reviewer',
  };

  const testerClaimant: Claimant = {
    type: 'agent',
    id: 'tester-1',
    agentType: 'tester',
  };

  const queenClaimant: Claimant = {
    type: 'agent',
    id: 'queen-1',
    agentType: 'queen-coordinator',
  };

  const humanClaimant: Claimant = {
    type: 'human',
    id: 'user-123',
    humanId: 'john.doe',
  };

  const baseDate = new Date('2024-01-15T10:00:00Z');
  const futureDate = new Date('2024-01-15T11:00:00Z');
  const pastDate = new Date('2024-01-15T09:00:00Z');

  beforeEach(() => {
    mockRepository = createMock<IClaimRepository>();
    mockEventStore = createMock<IEventStore>();
    mockStealingPolicy = createMock<IStealingPolicy>();
    mockClock = createMock<IClock>();

    // Default mock behaviors
    mockClock.now.mockReturnValue(baseDate);
    mockStealingPolicy.canSteal.mockReturnValue(true);
    mockStealingPolicy.getContestWindow.mockReturnValue(30000);
    mockStealingPolicy.resolveContest.mockImplementation((original) => original);
    mockEventStore.append.mockResolvedValue(undefined);

    service = new WorkStealingService(
      mockRepository,
      mockEventStore,
      mockStealingPolicy,
      mockClock
    );
  });

  // ===========================================================================
  // markStealable() tests
  // ===========================================================================

  describe('markStealable', () => {
    it('should set correct metadata when marking stealable', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      const result = await service.markStealable('issue-1', coderClaimant);

      // Then
      expect(result.metadata.stealable).toBe(true);
      expect(result.metadata.stealableAt).toEqual(baseDate);
      expect(result.metadata.stealProtected).toBe(false);
    });

    it('should allow specifying custom stealable time', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);
      const customTime = new Date('2024-01-15T12:00:00Z');

      // When
      const result = await service.markStealable('issue-1', coderClaimant, customTime);

      // Then
      expect(result.metadata.stealableAt).toEqual(customTime);
    });

    it('should emit WorkMarkedStealable event', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      await service.markStealable('issue-1', coderClaimant);

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'WorkMarkedStealable',
          payload: expect.objectContaining({
            issueId: 'issue-1',
            owner: coderClaimant,
          }),
        })
      );
    });

    it('should reject marking by non-owner', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(claim);

      // When/Then
      await expect(service.markStealable('issue-1', reviewerClaimant))
        .rejects.toThrow('Not the owner of this claim');
    });

    it('should throw error for non-existent claim', async () => {
      // Given
      mockRepository.findById.mockResolvedValue(null);

      // When/Then
      await expect(service.markStealable('issue-999', coderClaimant))
        .rejects.toThrow('Claim not found');
    });
  });

  // ===========================================================================
  // steal() tests
  // ===========================================================================

  describe('steal', () => {
    it('should successfully steal a stealable claim', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {
          stealable: true,
          stealableAt: pastDate,
          stealProtected: false,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      const result = await service.steal('issue-1', reviewerClaimant);

      // Then
      expect(result.success).toBe(true);
      expect(result.claim?.claimant).toEqual(reviewerClaimant);
    });

    it('should reject stealing protected claim', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {
          stealable: true,
          stealProtected: true,
          stealProtectionReason: 'Critical work in progress',
        },
      };
      mockRepository.findById.mockResolvedValue(claim);

      // When
      const result = await service.steal('issue-1', reviewerClaimant);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toContain('Claim is protected');
      expect(result.error).toContain('Critical work in progress');
    });

    it('should reject stealing non-stealable claim', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {
          stealable: false,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);

      // When
      const result = await service.steal('issue-1', reviewerClaimant);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Claim is not marked as stealable');
    });

    it('should reject stealing before stealable time', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {
          stealable: true,
          stealableAt: futureDate, // Not yet stealable
        },
      };
      mockRepository.findById.mockResolvedValue(claim);

      // When
      const result = await service.steal('issue-1', reviewerClaimant);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Claim is not yet stealable');
    });

    it('should check cross-type stealing rules', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {
          stealable: true,
          stealableAt: pastDate,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockStealingPolicy.canSteal.mockReturnValue(false);

      // When
      const result = await service.steal('issue-1', testerClaimant);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cross-type stealing not allowed');
      expect(mockStealingPolicy.canSteal).toHaveBeenCalledWith(
        testerClaimant,
        coderClaimant,
        claim
      );
    });

    it('should set contest window on successful steal', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {
          stealable: true,
          stealableAt: pastDate,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);
      mockStealingPolicy.getContestWindow.mockReturnValue(60000);

      // When
      const result = await service.steal('issue-1', reviewerClaimant);

      // Then
      expect(result.success).toBe(true);
      expect(result.claim?.metadata.contestWindowEnds).toEqual(
        new Date(baseDate.getTime() + 60000)
      );
    });

    it('should emit WorkStolen event', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {
          stealable: true,
          stealableAt: pastDate,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      await service.steal('issue-1', reviewerClaimant);

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'WorkStolen',
          payload: {
            issueId: 'issue-1',
            from: coderClaimant,
            to: reviewerClaimant,
          },
        })
      );
    });

    it('should clear stealable metadata after successful steal', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {
          stealable: true,
          stealableAt: pastDate,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      const result = await service.steal('issue-1', reviewerClaimant);

      // Then
      expect(result.claim?.metadata.stealable).toBe(false);
      expect(result.claim?.metadata.stealableAt).toBeUndefined();
    });
  });

  // ===========================================================================
  // getStealable() tests
  // ===========================================================================

  describe('getStealable', () => {
    it('should filter by agent type using cross-type rules', async () => {
      // Given
      const claims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: coderClaimant, // Coder claim
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: pastDate },
        },
        {
          issueId: 'issue-2',
          claimant: reviewerClaimant, // Reviewer claim
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: pastDate },
        },
      ];
      mockRepository.findStealable.mockResolvedValue(claims);

      // When - Reviewer can steal from coders and reviewers
      const result = await service.getStealable({ agentType: 'reviewer' });

      // Then
      expect(result).toHaveLength(2);
    });

    it('should exclude protected claims when requested', async () => {
      // Given
      const claims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: coderClaimant,
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: pastDate, stealProtected: false },
        },
        {
          issueId: 'issue-2',
          claimant: reviewerClaimant,
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: pastDate, stealProtected: true },
        },
      ];
      mockRepository.findStealable.mockResolvedValue(claims);

      // When
      const result = await service.getStealable({ excludeProtected: true });

      // Then
      expect(result).toHaveLength(1);
      expect(result[0].issueId).toBe('issue-1');
    });

    it('should exclude claims not yet stealable by time', async () => {
      // Given
      const claims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: coderClaimant,
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: pastDate }, // Already stealable
        },
        {
          issueId: 'issue-2',
          claimant: reviewerClaimant,
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: futureDate }, // Not yet stealable
        },
      ];
      mockRepository.findStealable.mockResolvedValue(claims);

      // When
      const result = await service.getStealable();

      // Then
      expect(result).toHaveLength(1);
      expect(result[0].issueId).toBe('issue-1');
    });

    it('should exclude human claims when humanClaimsProtected is true', async () => {
      // Given
      const claims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: coderClaimant, // Agent claim
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: pastDate },
        },
        {
          issueId: 'issue-2',
          claimant: humanClaimant, // Human claim
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: pastDate },
        },
      ];
      mockRepository.findStealable.mockResolvedValue(claims);

      // When - Any agent type should not see human claims
      const result = await service.getStealable({ agentType: 'coder' });

      // Then
      expect(result).toHaveLength(1);
      expect(result[0].issueId).toBe('issue-1');
    });

    it('should return all stealable claims without filters', async () => {
      // Given
      const claims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: coderClaimant,
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: pastDate },
        },
        {
          issueId: 'issue-2',
          claimant: reviewerClaimant,
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: pastDate },
        },
      ];
      mockRepository.findStealable.mockResolvedValue(claims);

      // When
      const result = await service.getStealable();

      // Then
      expect(result).toHaveLength(2);
    });
  });

  // ===========================================================================
  // contestSteal() tests
  // ===========================================================================

  describe('contestSteal', () => {
    it('should allow contest within window', async () => {
      // Given
      const contestWindowEnd = new Date(baseDate.getTime() + 60000); // 1 minute from now
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: reviewerClaimant, // Current holder (thief)
        status: 'active',
        claimedAt: baseDate,
        expiresAt: futureDate,
        metadata: {
          contestWindowEnds: contestWindowEnd,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      const result = await service.contestSteal('issue-1', coderClaimant, 'I was working on it');

      // Then
      expect(result.success).toBe(true);
      expect(result.winner).toBeDefined();
    });

    it('should reject contest outside window', async () => {
      // Given
      const contestWindowEnd = new Date(baseDate.getTime() - 60000); // Already expired
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: reviewerClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {
          contestWindowEnds: contestWindowEnd,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);

      // When
      const result = await service.contestSteal('issue-1', coderClaimant, 'Too late');

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Contest window has expired');
    });

    it('should reject contest when no window exists', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: reviewerClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {}, // No contest window
      };
      mockRepository.findById.mockResolvedValue(claim);

      // When
      const result = await service.contestSteal('issue-1', coderClaimant, 'No window');

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Contest window has expired');
    });

    it('should use policy to resolve contest', async () => {
      // Given
      const contestWindowEnd = new Date(baseDate.getTime() + 60000);
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: reviewerClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: futureDate,
        metadata: {
          contestWindowEnds: contestWindowEnd,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);
      mockStealingPolicy.resolveContest.mockReturnValue(coderClaimant);

      // When
      const result = await service.contestSteal('issue-1', coderClaimant, 'Priority claim');

      // Then
      expect(mockStealingPolicy.resolveContest).toHaveBeenCalledWith(
        coderClaimant,
        reviewerClaimant,
        claim
      );
      expect(result.winner).toEqual(coderClaimant);
    });

    it('should restore ownership when original owner wins', async () => {
      // Given
      const contestWindowEnd = new Date(baseDate.getTime() + 60000);
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: reviewerClaimant, // Current thief
        status: 'active',
        claimedAt: baseDate,
        expiresAt: futureDate,
        metadata: {
          contestWindowEnds: contestWindowEnd,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);
      mockStealingPolicy.resolveContest.mockReturnValue(coderClaimant); // Original owner wins

      // When
      await service.contestSteal('issue-1', coderClaimant, 'I need it back');

      // Then
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          claimant: coderClaimant,
        })
      );
    });

    it('should emit StealContested and StealContestResolved events', async () => {
      // Given
      const contestWindowEnd = new Date(baseDate.getTime() + 60000);
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: reviewerClaimant,
        status: 'active',
        claimedAt: baseDate,
        expiresAt: futureDate,
        metadata: {
          contestWindowEnds: contestWindowEnd,
        },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      await service.contestSteal('issue-1', coderClaimant, 'Contest reason');

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'StealContested',
          payload: expect.objectContaining({
            issueId: 'issue-1',
            contestedBy: coderClaimant,
            reason: 'Contest reason',
          }),
        })
      );
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'StealContestResolved',
        })
      );
    });
  });

  // ===========================================================================
  // detectStaleWork() tests
  // ===========================================================================

  describe('detectStaleWork', () => {
    it('should find stale claims', async () => {
      // Given
      const staleSince = new Date('2024-01-14T10:00:00Z');
      const staleClaims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: coderClaimant,
          status: 'active',
          claimedAt: new Date('2024-01-10T10:00:00Z'),
          expiresAt: futureDate,
          metadata: {},
        },
        {
          issueId: 'issue-2',
          claimant: reviewerClaimant,
          status: 'active',
          claimedAt: new Date('2024-01-12T10:00:00Z'),
          expiresAt: futureDate,
          metadata: {},
        },
      ];
      mockRepository.findStaleClaims.mockResolvedValue(staleClaims);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      const result = await service.detectStaleWork(staleSince);

      // Then
      expect(result.count).toBe(2);
      expect(result.staleClaims).toHaveLength(2);
    });

    it('should mark claims with stale metadata', async () => {
      // Given
      const staleSince = new Date('2024-01-14T10:00:00Z');
      const staleClaim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: new Date('2024-01-10T10:00:00Z'),
        expiresAt: futureDate,
        metadata: {},
      };
      mockRepository.findStaleClaims.mockResolvedValue([staleClaim]);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      await service.detectStaleWork(staleSince);

      // Then
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            staleSince,
            staleReason: 'No activity detected',
          }),
        })
      );
    });

    it('should emit StaleWorkDetected event when stale claims found', async () => {
      // Given
      const staleSince = new Date('2024-01-14T10:00:00Z');
      const staleClaims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: coderClaimant,
          status: 'active',
          claimedAt: new Date('2024-01-10T10:00:00Z'),
          expiresAt: futureDate,
          metadata: {},
        },
      ];
      mockRepository.findStaleClaims.mockResolvedValue(staleClaims);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      await service.detectStaleWork(staleSince);

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'StaleWorkDetected',
          payload: expect.objectContaining({
            count: 1,
            issueIds: ['issue-1'],
            staleSince,
          }),
        })
      );
    });

    it('should not emit event when no stale claims found', async () => {
      // Given
      const staleSince = new Date('2024-01-14T10:00:00Z');
      mockRepository.findStaleClaims.mockResolvedValue([]);

      // When
      const result = await service.detectStaleWork(staleSince);

      // Then
      expect(result.count).toBe(0);
      expect(mockEventStore.append).not.toHaveBeenCalled();
    });

    it('should return empty result when no stale work', async () => {
      // Given
      const staleSince = new Date('2024-01-14T10:00:00Z');
      mockRepository.findStaleClaims.mockResolvedValue([]);

      // When
      const result = await service.detectStaleWork(staleSince);

      // Then
      expect(result.staleClaims).toHaveLength(0);
      expect(result.count).toBe(0);
    });
  });

  // ===========================================================================
  // Cross-type stealing rules enforcement tests
  // ===========================================================================

  describe('cross-type stealing rules enforcement', () => {
    it('should allow queen-coordinator to steal from any agent type', async () => {
      // Given
      const coderClaim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: { stealable: true, stealableAt: pastDate },
      };
      mockRepository.findById.mockResolvedValue(coderClaim);
      mockRepository.update.mockImplementation(async (c) => c);
      mockStealingPolicy.canSteal.mockReturnValue(true);

      // When
      const result = await service.steal('issue-1', queenClaimant);

      // Then
      expect(result.success).toBe(true);
      expect(mockStealingPolicy.canSteal).toHaveBeenCalledWith(
        queenClaimant,
        coderClaimant,
        coderClaim
      );
    });

    it('should verify stealing policy is called with correct arguments', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: { stealable: true, stealableAt: pastDate },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockStealingPolicy.canSteal.mockReturnValue(false);

      // When
      await service.steal('issue-1', testerClaimant);

      // Then
      expect(mockStealingPolicy.canSteal).toHaveBeenCalledWith(
        testerClaimant,
        coderClaimant,
        claim
      );
    });

    it('should enforce human claims protection in getStealable', async () => {
      // Given
      const claims: Claim[] = [
        {
          issueId: 'issue-1',
          claimant: humanClaimant,
          status: 'active',
          claimedAt: pastDate,
          expiresAt: futureDate,
          metadata: { stealable: true, stealableAt: pastDate },
        },
      ];
      mockRepository.findStealable.mockResolvedValue(claims);

      // When - Using coder agent type which should respect human protection
      const result = await service.getStealable({ agentType: 'coder' });

      // Then - Human claims should be filtered out
      expect(result).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Protection management tests
  // ===========================================================================

  describe('setProtection', () => {
    it('should protect a claim with reason', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: { stealable: true },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      const result = await service.setProtection('issue-1', coderClaimant, 'Critical deployment');

      // Then
      expect(result.metadata.stealProtected).toBe(true);
      expect(result.metadata.stealProtectionReason).toBe('Critical deployment');
      expect(result.metadata.stealable).toBe(false);
    });

    it('should reject protection by non-owner', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {},
      };
      mockRepository.findById.mockResolvedValue(claim);

      // When/Then
      await expect(service.setProtection('issue-1', reviewerClaimant, 'Trying to protect'))
        .rejects.toThrow('Not the owner of this claim');
    });
  });

  describe('removeProtection', () => {
    it('should remove protection from a claim', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: {
          stealProtected: true,
          stealProtectionReason: 'Was protected',
        },
      };
      mockRepository.findById.mockResolvedValue(claim);
      mockRepository.update.mockImplementation(async (c) => c);

      // When
      const result = await service.removeProtection('issue-1', coderClaimant);

      // Then
      expect(result.metadata.stealProtected).toBe(false);
      expect(result.metadata.stealProtectionReason).toBeUndefined();
    });

    it('should reject removal by non-owner', async () => {
      // Given
      const claim: Claim = {
        issueId: 'issue-1',
        claimant: coderClaimant,
        status: 'active',
        claimedAt: pastDate,
        expiresAt: futureDate,
        metadata: { stealProtected: true },
      };
      mockRepository.findById.mockResolvedValue(claim);

      // When/Then
      await expect(service.removeProtection('issue-1', reviewerClaimant))
        .rejects.toThrow('Not the owner of this claim');
    });
  });
});
