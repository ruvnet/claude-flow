/**
 * @claude-flow/claims - Claim Repository Implementation
 * SQLite-based persistence for claims (ADR-016)
 *
 * @module v3/claims/infrastructure/claim-repository
 */

import {
  ClaimId,
  IssueId,
  Claimant,
  ClaimStatus,
  IssueClaim,
  IssueClaimWithStealing,
  AgentType,
  ExtendedClaimStatus,
  ExtendedIssueClaim,
  ClaimQueryOptions,
  ClaimStatistics,
} from '../domain/types.js';
import { IClaimRepository } from '../domain/repositories.js';
import { IIssueClaimRepository } from '../domain/types.js';

// =============================================================================
// In-Memory Claim Repository (Default Implementation)
// =============================================================================

/**
 * In-memory implementation of the claim repository
 * Suitable for development and testing
 */
export class InMemoryClaimRepository implements IClaimRepository, IIssueClaimRepository {
  private claims: Map<ClaimId, IssueClaimWithStealing> = new Map();
  private issueIndex: Map<string, ClaimId> = new Map(); // issueId:repo -> claimId
  private claimantIndex: Map<string, Set<ClaimId>> = new Map(); // claimantId -> claimIds

  async initialize(): Promise<void> {
    // No initialization needed for in-memory store
  }

  async shutdown(): Promise<void> {
    this.claims.clear();
    this.issueIndex.clear();
    this.claimantIndex.clear();
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  async save(claim: IssueClaim | IssueClaimWithStealing): Promise<void> {
    const fullClaim = this.ensureFullClaim(claim);
    this.claims.set(claim.id, fullClaim);

    // Update indexes
    const issueKey = this.getIssueKey(claim.issueId, (claim as any).repository ?? '');
    this.issueIndex.set(issueKey, claim.id);

    const claimantId = claim.claimant.id;
    if (!this.claimantIndex.has(claimantId)) {
      this.claimantIndex.set(claimantId, new Set());
    }
    this.claimantIndex.get(claimantId)!.add(claim.id);
  }

  async update(claim: IssueClaimWithStealing): Promise<void> {
    await this.save(claim);
  }

  async findById(claimId: ClaimId): Promise<IssueClaimWithStealing | null> {
    return this.claims.get(claimId) ?? null;
  }

  async findByIssueId(issueId: IssueId, repository?: string): Promise<IssueClaimWithStealing | null> {
    const issueKey = this.getIssueKey(issueId, repository ?? '');
    const claimId = this.issueIndex.get(issueKey);
    if (!claimId) return null;

    const claim = this.claims.get(claimId);
    if (!claim) return null;

    // Return only if claim is active
    if (this.isActiveStatus(claim.status)) {
      return claim;
    }
    return null;
  }

  async findByClaimant(claimant: Claimant): Promise<IssueClaim[]> {
    return this.findByAgentId(claimant.id);
  }

  async findByAgentId(agentId: string): Promise<IssueClaimWithStealing[]> {
    const claimIds = this.claimantIndex.get(agentId);
    if (!claimIds) return [];

    return Array.from(claimIds)
      .map((id) => this.claims.get(id))
      .filter((c): c is IssueClaimWithStealing => c !== undefined);
  }

  async findByStatus(status: ClaimStatus): Promise<IssueClaim[]> {
    return Array.from(this.claims.values()).filter((c) => c.status === status);
  }

  async findStealable(agentType?: AgentType): Promise<IssueClaimWithStealing[]> {
    return Array.from(this.claims.values()).filter((c) => {
      if (c.status !== 'stealable') return false;
      if (!c.stealInfo) return true;
      if (!agentType) return true;
      if (!c.stealInfo.allowedStealerTypes) return true;
      return c.stealInfo.allowedStealerTypes.includes(agentType);
    });
  }

  async findContested(): Promise<IssueClaimWithStealing[]> {
    return Array.from(this.claims.values()).filter(
      (c) => c.contestInfo && !c.contestInfo.resolution
    );
  }

  async findAll(): Promise<IssueClaimWithStealing[]> {
    return Array.from(this.claims.values());
  }

  async delete(claimId: ClaimId): Promise<void> {
    const claim = this.claims.get(claimId);
    if (claim) {
      // Remove from indexes
      const issueKey = this.getIssueKey(claim.issueId, (claim as any).repository ?? '');
      this.issueIndex.delete(issueKey);

      const claimantId = claim.claimant.id;
      const claimantClaims = this.claimantIndex.get(claimantId);
      if (claimantClaims) {
        claimantClaims.delete(claimId);
        if (claimantClaims.size === 0) {
          this.claimantIndex.delete(claimantId);
        }
      }

      this.claims.delete(claimId);
    }
  }

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  async findActiveClaims(): Promise<IssueClaim[]> {
    return Array.from(this.claims.values()).filter((c) =>
      this.isActiveStatus(c.status)
    );
  }

  async findStaleClaims(staleSince: Date): Promise<IssueClaim[]> {
    const staleTimestamp = staleSince.getTime();
    return Array.from(this.claims.values()).filter(
      (c) =>
        this.isActiveStatus(c.status) &&
        c.lastActivityAt.getTime() < staleTimestamp
    );
  }

  async findClaimsWithPendingHandoffs(): Promise<IssueClaim[]> {
    return Array.from(this.claims.values()).filter(
      (c) => c.status === 'pending_handoff'
    );
  }

  async countByClaimant(claimantId: string): Promise<number> {
    return this.claimantIndex.get(claimantId)?.size ?? 0;
  }

  async countByAgentId(agentId: string): Promise<number> {
    const claims = await this.findByAgentId(agentId);
    return claims.filter((c) => this.isActiveStatus(c.status)).length;
  }

  // ==========================================================================
  // Extended Query Operations (ADR-016)
  // ==========================================================================

  async query(options: ClaimQueryOptions): Promise<IssueClaimWithStealing[]> {
    let results = Array.from(this.claims.values());

    // Apply filters
    if (options.claimantId) {
      results = results.filter((c) => c.claimant.id === options.claimantId);
    }

    if (options.claimantType) {
      results = results.filter((c) => c.claimant.type === options.claimantType);
    }

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      results = results.filter((c) => statuses.includes(c.status as any));
    }

    if (options.repository) {
      results = results.filter((c) => (c as any).repository === options.repository);
    }

    if (options.issueId) {
      results = results.filter((c) => c.issueId === options.issueId);
    }

    if (options.stealableOnly) {
      results = results.filter((c) => c.status === 'stealable');
    }

    if (options.blockedOnly) {
      results = results.filter((c) => c.blockedReason !== undefined);
    }

    if (options.createdAfter) {
      results = results.filter((c) => c.claimedAt.getTime() >= options.createdAfter!);
    }

    if (options.createdBefore) {
      results = results.filter((c) => c.claimedAt.getTime() <= options.createdBefore!);
    }

    if (options.updatedAfter) {
      results = results.filter((c) => c.lastActivityAt.getTime() >= options.updatedAfter!);
    }

    // Apply sorting
    if (options.sortBy) {
      results.sort((a, b) => {
        let aVal: number, bVal: number;

        switch (options.sortBy) {
          case 'claimedAt':
            aVal = a.claimedAt.getTime();
            bVal = b.claimedAt.getTime();
            break;
          case 'updatedAt':
            aVal = a.lastActivityAt.getTime();
            bVal = b.lastActivityAt.getTime();
            break;
          case 'progress':
            aVal = a.progress;
            bVal = b.progress;
            break;
          default:
            return 0;
        }

        return options.sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
      });
    }

    // Apply pagination
    if (options.offset) {
      results = results.slice(options.offset);
    }

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async getStatistics(): Promise<ClaimStatistics> {
    const claims = Array.from(this.claims.values());

    const byStatus: Record<string, number> = {
      active: 0,
      paused: 0,
      'handoff-pending': 0,
      'review-requested': 0,
      blocked: 0,
      stealable: 0,
      completed: 0,
    };

    const byClaimantType: Record<string, number> = {
      human: 0,
      agent: 0,
    };

    const byRepository: Record<string, number> = {};
    let totalDuration = 0;
    let completedCount = 0;
    let totalProgress = 0;
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;

    for (const claim of claims) {
      byStatus[claim.status] = (byStatus[claim.status] ?? 0) + 1;
      byClaimantType[claim.claimant.type] = (byClaimantType[claim.claimant.type] ?? 0) + 1;

      const repo = (claim as any).repository ?? 'unknown';
      byRepository[repo] = (byRepository[repo] ?? 0) + 1;

      totalProgress += claim.progress;

      if (claim.status === 'completed') {
        completedCount++;
        const duration = claim.lastActivityAt.getTime() - claim.claimedAt.getTime();
        totalDuration += duration;
      }
    }

    const completedLast24h = claims.filter(
      (c) => c.status === 'completed' && c.lastActivityAt.getTime() >= last24h
    ).length;

    return {
      totalClaims: claims.length,
      byStatus: byStatus as any,
      byPriority: { critical: 0, high: 0, medium: 0, low: 0 },
      byClaimantType: byClaimantType as any,
      avgDurationMs: completedCount > 0 ? totalDuration / completedCount : 0,
      avgProgress: claims.length > 0 ? totalProgress / claims.length : 0,
      activeSteals: claims.filter((c) => c.status === 'stealable').length,
      pendingHandoffs: claims.filter((c) => c.status === 'pending_handoff').length,
      completedLast24h,
      byRepository,
    };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private getIssueKey(issueId: IssueId, repository: string): string {
    return `${repository}:${issueId}`;
  }

  private isActiveStatus(status: string): boolean {
    return ['active', 'paused', 'blocked', 'pending_handoff', 'in_review', 'stealable'].includes(
      status
    );
  }

  private ensureFullClaim(claim: IssueClaim | IssueClaimWithStealing): IssueClaimWithStealing {
    const fullClaim = claim as IssueClaimWithStealing;
    if (fullClaim.progress === undefined) {
      (fullClaim as any).progress = 0;
    }
    return fullClaim;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new claim repository
 */
export function createClaimRepository(): InMemoryClaimRepository {
  return new InMemoryClaimRepository();
}
