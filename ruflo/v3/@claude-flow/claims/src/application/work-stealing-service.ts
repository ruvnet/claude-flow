/**
 * Work Stealing Service - Application Layer
 *
 * Handles work stealing to maximize swarm throughput by redistributing
 * work from stale, blocked, or overloaded agents to available ones.
 *
 * @module v3/claims/application/work-stealing-service
 */

import { randomUUID } from 'crypto';
import {
  type IssueId,
  type Claimant,
  type AgentType,
  type StealableInfo,
  type StealableReason,
  type StealResult,
  type StealErrorCode,
  type ContestInfo,
  type ContestResolution,
  type WorkStealingConfig,
  type IssueClaimWithStealing,
  type IIssueClaimRepository,
  type IWorkStealingEventBus,
  type WorkStealingEvent,
  type WorkStealingEventType,
  type IssueMarkedStealableEvent,
  type IssueStolenEvent,
  type StealContestedEvent,
  type StealContestResolvedEvent,
  DEFAULT_WORK_STEALING_CONFIG,
} from '../domain/types.js';

// =============================================================================
// Service Interface
// =============================================================================

/**
 * Work Stealing Service Interface
 */
export interface IWorkStealingService {
  /** Mark work as stealable */
  markStealable(issueId: IssueId, info: StealableInfo): Promise<void>;

  /** Steal work from another agent */
  steal(issueId: IssueId, stealer: Claimant): Promise<StealResult>;

  /** Get list of stealable issues */
  getStealable(agentType?: AgentType): Promise<IssueClaimWithStealing[]>;

  /** Contest a steal (original owner wants it back) */
  contestSteal(issueId: IssueId, originalClaimant: Claimant, reason: string): Promise<void>;

  /** Resolve contest (queen/human decides) */
  resolveContest(issueId: IssueId, winner: Claimant, reason: string): Promise<void>;

  /** Auto-detect stealable work based on config thresholds */
  detectStaleWork(config: WorkStealingConfig): Promise<IssueClaimWithStealing[]>;

  /** Auto-mark stealable work based on config thresholds */
  autoMarkStealable(config: WorkStealingConfig): Promise<number>;
}

// =============================================================================
// Default Event Bus Implementation
// =============================================================================

/**
 * Simple in-memory event bus for work stealing events
 */
export class InMemoryWorkStealingEventBus implements IWorkStealingEventBus {
  private handlers: Map<WorkStealingEventType | '*', Set<(event: WorkStealingEvent) => void | Promise<void>>> = new Map();
  private history: WorkStealingEvent[] = [];
  private maxHistorySize: number;

  constructor(options: { maxHistorySize?: number } = {}) {
    this.maxHistorySize = options.maxHistorySize ?? 1000;
  }

  async emit(event: WorkStealingEvent): Promise<void> {
    this.addToHistory(event);

    const typeHandlers = this.handlers.get(event.type) ?? new Set();
    const allHandlers = this.handlers.get('*') ?? new Set();

    const promises: Promise<void>[] = [];

    for (const handler of typeHandlers) {
      promises.push(this.safeExecute(handler, event));
    }

    for (const handler of allHandlers) {
      promises.push(this.safeExecute(handler, event));
    }

    await Promise.all(promises);
  }

  subscribe(
    eventType: WorkStealingEventType,
    handler: (event: WorkStealingEvent) => void | Promise<void>
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    const handlers = this.handlers.get(eventType)!;
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
    };
  }

  subscribeAll(handler: (event: WorkStealingEvent) => void | Promise<void>): () => void {
    if (!this.handlers.has('*')) {
      this.handlers.set('*', new Set());
    }

    const handlers = this.handlers.get('*')!;
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
    };
  }

  getHistory(filter?: { types?: WorkStealingEventType[]; limit?: number }): WorkStealingEvent[] {
    let events = [...this.history];

    if (filter?.types?.length) {
      events = events.filter(e => filter.types!.includes(e.type));
    }

    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }

    return events;
  }

  private addToHistory(event: WorkStealingEvent): void {
    this.history.push(event);

    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-Math.floor(this.maxHistorySize / 2));
    }
  }

  private async safeExecute(
    handler: (event: WorkStealingEvent) => void | Promise<void>,
    event: WorkStealingEvent
  ): Promise<void> {
    try {
      await handler(event);
    } catch (err) {
      console.error(`Work stealing event handler error for ${event.type}:`, err);
    }
  }
}

// =============================================================================
// Work Stealing Service Implementation
// =============================================================================

/**
 * Work Stealing Service
 *
 * Implements work stealing algorithms to maximize swarm throughput by
 * redistributing work from stale, blocked, or overloaded agents.
 */
export class WorkStealingService implements IWorkStealingService {
  private readonly config: WorkStealingConfig;

  constructor(
    private readonly repository: IIssueClaimRepository,
    private readonly eventBus: IWorkStealingEventBus,
    config: Partial<WorkStealingConfig> = {}
  ) {
    this.config = { ...DEFAULT_WORK_STEALING_CONFIG, ...config };
  }

  // ===========================================================================
  // Mark Stealable
  // ===========================================================================

  /**
   * Mark work as stealable with the given reason
   */
  async markStealable(issueId: IssueId, info: StealableInfo): Promise<void> {
    const claim = await this.repository.findByIssueId(issueId);

    if (!claim) {
      throw new Error(`Claim not found for issue: ${issueId}`);
    }

    // Check if already stealable
    if (claim.stealInfo) {
      return; // Already marked
    }

    // Check grace period protection
    if (this.isInGracePeriod(claim)) {
      throw new Error(`Claim is still in grace period`);
    }

    // Check progress protection
    if (this.isProtectedByProgress(claim)) {
      throw new Error(`Claim is protected by progress (${claim.progress}%)`);
    }

    // Update claim with stealable info
    const now = new Date();
    claim.stealInfo = {
      ...info,
      markedAt: now,
    };
    claim.stealableAt = now;

    await this.repository.update(claim);

    // Emit event
    await this.emitMarkedStealableEvent(claim, info);
  }

  // ===========================================================================
  // Steal
  // ===========================================================================

  /**
   * Steal work from another agent
   */
  async steal(issueId: IssueId, stealer: Claimant): Promise<StealResult> {
    const claim = await this.repository.findByIssueId(issueId);

    // Validate claim exists
    if (!claim) {
      return this.stealError('ISSUE_NOT_FOUND', `Claim not found for issue: ${issueId}`);
    }

    // Check if stealable
    if (!claim.stealInfo) {
      return this.stealError('NOT_STEALABLE', 'Issue is not marked as stealable');
    }

    // Check if there's a pending contest
    if (claim.contestInfo && !claim.contestInfo.resolution) {
      return this.stealError('CONTEST_PENDING', 'A contest is pending for this issue');
    }

    // Check grace period
    if (this.isInGracePeriod(claim)) {
      return this.stealError('IN_GRACE_PERIOD', 'Claim is still in grace period');
    }

    // Check progress protection
    if (this.isProtectedByProgress(claim)) {
      return this.stealError('PROTECTED_BY_PROGRESS', `Claim is protected by progress (${claim.progress}%)`);
    }

    // Check cross-type stealing rules
    const stealerType = this.getAgentType(stealer);
    const ownerType = this.getAgentType(claim.claimant);

    if (!this.canStealCrossType(stealerType, ownerType, claim.stealInfo)) {
      return this.stealError('CROSS_TYPE_NOT_ALLOWED', `${stealerType} cannot steal from ${ownerType}`);
    }

    // Check if stealer is overloaded
    const stealerClaimCount = await this.repository.countByAgentId(stealer.id);
    if (stealerClaimCount >= this.config.overloadThreshold) {
      return this.stealError('STEALER_OVERLOADED', `Stealer has too many claims (${stealerClaimCount})`);
    }

    // Perform the steal
    const previousClaimant = { ...claim.claimant };
    const previousStealInfo = { ...claim.stealInfo };
    const now = new Date();
    const contestWindowEndsAt = new Date(now.getTime() + this.config.contestWindowMinutes * 60 * 1000);

    // Update claim with new owner
    claim.claimant = stealer;
    claim.stealInfo = undefined;
    claim.stealableAt = undefined;
    claim.lastActivityAt = now;
    claim.contestInfo = {
      contestedAt: now,
      contestedBy: previousClaimant,
      stolenBy: stealer,
      reason: '', // Will be set if contested
      windowEndsAt: contestWindowEndsAt,
    };

    await this.repository.update(claim);

    // Emit stolen event
    await this.emitStolenEvent(claim, previousClaimant, stealer, previousStealInfo, contestWindowEndsAt);

    return {
      success: true,
      claim,
      previousClaimant,
      contestWindowEndsAt,
    };
  }

  // ===========================================================================
  // Get Stealable
  // ===========================================================================

  /**
   * Get list of stealable issues, optionally filtered by agent type
   */
  async getStealable(agentType?: AgentType): Promise<IssueClaimWithStealing[]> {
    const stealableClaims = await this.repository.findStealable(agentType);

    // Filter out claims that are protected or in grace period
    return stealableClaims.filter(claim => {
      if (!claim.stealInfo) return false;
      if (this.isInGracePeriod(claim)) return false;
      if (this.isProtectedByProgress(claim)) return false;

      // Check cross-type restrictions if agentType is specified
      if (agentType && claim.stealInfo.allowedStealerTypes) {
        if (!claim.stealInfo.allowedStealerTypes.includes(agentType)) {
          return false;
        }
      }

      return true;
    });
  }

  // ===========================================================================
  // Contest Steal
  // ===========================================================================

  /**
   * Contest a steal (original owner wants the work back)
   */
  async contestSteal(issueId: IssueId, originalClaimant: Claimant, reason: string): Promise<void> {
    const claim = await this.repository.findByIssueId(issueId);

    if (!claim) {
      throw new Error(`Claim not found for issue: ${issueId}`);
    }

    // Check if there's a valid contest window
    if (!claim.contestInfo) {
      throw new Error('No steal to contest - issue was not recently stolen');
    }

    if (claim.contestInfo.resolution) {
      throw new Error('Contest has already been resolved');
    }

    const now = new Date();
    if (now > claim.contestInfo.windowEndsAt) {
      throw new Error('Contest window has expired');
    }

    // Verify the contester was the original owner
    if (claim.contestInfo.contestedBy.id !== originalClaimant.id) {
      throw new Error('Only the original claimant can contest the steal');
    }

    // Update contest info with reason
    claim.contestInfo.reason = reason;
    claim.contestInfo.contestedAt = now;

    await this.repository.update(claim);

    // Emit contest event
    await this.emitContestEvent(claim);
  }

  // ===========================================================================
  // Resolve Contest
  // ===========================================================================

  /**
   * Resolve a contest (queen or human decides the winner)
   */
  async resolveContest(issueId: IssueId, winner: Claimant, reason: string): Promise<void> {
    const claim = await this.repository.findByIssueId(issueId);

    if (!claim) {
      throw new Error(`Claim not found for issue: ${issueId}`);
    }

    if (!claim.contestInfo) {
      throw new Error('No contest to resolve');
    }

    if (claim.contestInfo.resolution) {
      throw new Error('Contest has already been resolved');
    }

    const now = new Date();
    const resolvedBy = this.determineResolver(winner, claim.contestInfo);

    // Create resolution
    const resolution: ContestResolution = {
      resolvedAt: now,
      winner,
      resolvedBy,
      reason,
    };

    claim.contestInfo.resolution = resolution;

    // Update claimant if the original owner won
    if (winner.id === claim.contestInfo.contestedBy.id) {
      claim.claimant = winner;
    }

    claim.lastActivityAt = now;

    await this.repository.update(claim);

    // Emit resolution event
    await this.emitContestResolvedEvent(claim, resolution);
  }

  // ===========================================================================
  // Detect Stale Work
  // ===========================================================================

  /**
   * Detect stale work based on config thresholds
   */
  async detectStaleWork(config: WorkStealingConfig): Promise<IssueClaimWithStealing[]> {
    const allClaims = await this.repository.findAll();
    const now = new Date();
    const staleThresholdMs = config.staleThresholdMinutes * 60 * 1000;
    const blockedThresholdMs = config.blockedThresholdMinutes * 60 * 1000;

    const staleClaims: IssueClaimWithStealing[] = [];

    for (const claim of allClaims) {
      // Skip if already stealable
      if (claim.stealInfo) continue;

      // Skip if in grace period
      if (this.isInGracePeriodWithConfig(claim, config)) continue;

      // Skip if protected by progress
      if (this.isProtectedByProgressWithConfig(claim, config)) continue;

      // Check for stale claims (no activity)
      const timeSinceActivity = now.getTime() - new Date(claim.lastActivityAt).getTime();
      if (timeSinceActivity > staleThresholdMs) {
        staleClaims.push(claim);
        continue;
      }

      // Check for blocked claims
      if (claim.status === 'pending_handoff' && claim.blockedAt) {
        const timeSinceBlocked = now.getTime() - new Date(claim.blockedAt).getTime();
        if (timeSinceBlocked > blockedThresholdMs) {
          staleClaims.push(claim);
          continue;
        }
      }
    }

    // Check for overloaded agents
    const agentClaimCounts = new Map<string, IssueClaimWithStealing[]>();
    for (const claim of allClaims) {
      const agentId = claim.claimant.id;
      if (!agentClaimCounts.has(agentId)) {
        agentClaimCounts.set(agentId, []);
      }
      agentClaimCounts.get(agentId)!.push(claim);
    }

    for (const [_agentId, claims] of agentClaimCounts) {
      if (claims.length > config.overloadThreshold) {
        // Sort by progress (lowest first) and mark the lowest priority as stealable
        const sortedClaims = claims
          .filter(c => !c.stealInfo && !staleClaims.includes(c))
          .sort((a, b) => a.progress - b.progress);

        if (sortedClaims.length > 0) {
          staleClaims.push(sortedClaims[0]);
        }
      }
    }

    return staleClaims;
  }

  // ===========================================================================
  // Auto Mark Stealable
  // ===========================================================================

  /**
   * Auto-mark stealable work based on config thresholds
   */
  async autoMarkStealable(config: WorkStealingConfig): Promise<number> {
    const staleClaims = await this.detectStaleWork(config);
    const now = new Date();
    let markedCount = 0;

    for (const claim of staleClaims) {
      const reason = this.determineStaleReason(claim, config, now);
      const stealInfo: StealableInfo = {
        reason,
        markedAt: now,
        originalProgress: claim.progress,
        allowedStealerTypes: this.getAllowedStealerTypes(claim.claimant, config),
      };

      try {
        await this.markStealable(claim.issueId, stealInfo);
        markedCount++;
      } catch (err) {
        // Log but don't fail - some claims may be protected
        console.warn(`Failed to mark claim ${claim.id} as stealable:`, err);
      }
    }

    return markedCount;
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Check if claim is in grace period
   */
  private isInGracePeriod(claim: IssueClaimWithStealing): boolean {
    return this.isInGracePeriodWithConfig(claim, this.config);
  }

  /**
   * Check if claim is in grace period with specific config
   */
  private isInGracePeriodWithConfig(claim: IssueClaimWithStealing, config: WorkStealingConfig): boolean {
    const gracePeriodMs = config.gracePeriodMinutes * 60 * 1000;
    const now = new Date();
    const claimedAt = new Date(claim.claimedAt);
    return now.getTime() - claimedAt.getTime() < gracePeriodMs;
  }

  /**
   * Check if claim is protected by progress
   */
  private isProtectedByProgress(claim: IssueClaimWithStealing): boolean {
    return this.isProtectedByProgressWithConfig(claim, this.config);
  }

  /**
   * Check if claim is protected by progress with specific config
   */
  private isProtectedByProgressWithConfig(claim: IssueClaimWithStealing, config: WorkStealingConfig): boolean {
    return claim.progress >= config.minProgressToProtect;
  }

  /**
   * Get agent type from claimant
   */
  private getAgentType(claimant: Claimant): AgentType {
    // Try to extract agent type from specializations or capabilities
    const typeKeywords: AgentType[] = ['coder', 'debugger', 'tester', 'reviewer', 'researcher', 'planner', 'architect', 'coordinator'];

    for (const keyword of typeKeywords) {
      if (claimant.specializations?.includes(keyword)) {
        return keyword;
      }
      if (claimant.capabilities?.includes(keyword)) {
        return keyword;
      }
      if (claimant.name.toLowerCase().includes(keyword)) {
        return keyword;
      }
    }

    // Default to coder if no type can be determined
    return 'coder';
  }

  /**
   * Check if cross-type stealing is allowed
   */
  private canStealCrossType(
    stealerType: AgentType,
    ownerType: AgentType,
    stealInfo: StealableInfo
  ): boolean {
    // Same type can always steal
    if (stealerType === ownerType) return true;

    // Check if cross-type stealing is enabled
    if (!this.config.allowCrossTypeSteal) return false;

    // Check if there are specific allowed types
    if (stealInfo.allowedStealerTypes) {
      return stealInfo.allowedStealerTypes.includes(stealerType);
    }

    // Check cross-type steal rules
    for (const [type1, type2] of this.config.crossTypeStealRules) {
      if (
        (stealerType === type1 && ownerType === type2) ||
        (stealerType === type2 && ownerType === type1)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get allowed stealer types for a claimant
   */
  private getAllowedStealerTypes(claimant: Claimant, config: WorkStealingConfig): AgentType[] | undefined {
    if (!config.allowCrossTypeSteal) return undefined;

    const ownerType = this.getAgentType(claimant);
    const allowedTypes: AgentType[] = [ownerType]; // Same type always allowed

    for (const [type1, type2] of config.crossTypeStealRules) {
      if (ownerType === type1) allowedTypes.push(type2);
      if (ownerType === type2) allowedTypes.push(type1);
    }

    return [...new Set(allowedTypes)];
  }

  /**
   * Determine the stale reason for a claim
   */
  private determineStaleReason(
    claim: IssueClaimWithStealing,
    config: WorkStealingConfig,
    now: Date
  ): StealableReason {
    const staleThresholdMs = config.staleThresholdMinutes * 60 * 1000;
    const blockedThresholdMs = config.blockedThresholdMinutes * 60 * 1000;

    // Check if blocked
    if (claim.status === 'pending_handoff' && claim.blockedAt) {
      const timeSinceBlocked = now.getTime() - new Date(claim.blockedAt).getTime();
      if (timeSinceBlocked > blockedThresholdMs) {
        return 'blocked';
      }
    }

    // Check if stale
    const timeSinceActivity = now.getTime() - new Date(claim.lastActivityAt).getTime();
    if (timeSinceActivity > staleThresholdMs) {
      return 'stale';
    }

    // Default to overloaded
    return 'overloaded';
  }

  /**
   * Determine who resolved the contest
   */
  private determineResolver(
    winner: Claimant,
    contestInfo: ContestInfo
  ): 'queen' | 'human' | 'timeout' {
    const now = new Date();

    // Check if window expired (timeout)
    if (now > contestInfo.windowEndsAt) {
      return 'timeout';
    }

    // Check if resolved by human
    if (winner.type === 'human') {
      return 'human';
    }

    // Default to queen (coordinator)
    return 'queen';
  }

  /**
   * Create a steal error result
   */
  private stealError(errorCode: StealErrorCode, error: string): StealResult {
    return {
      success: false,
      error,
      errorCode,
    };
  }

  // ===========================================================================
  // Event Emission
  // ===========================================================================

  /**
   * Emit IssueMarkedStealable event
   */
  private async emitMarkedStealableEvent(
    claim: IssueClaimWithStealing,
    info: StealableInfo
  ): Promise<void> {
    const event: IssueMarkedStealableEvent = {
      id: `evt-${randomUUID()}`,
      type: 'IssueMarkedStealable',
      timestamp: new Date(),
      issueId: claim.issueId,
      claimId: claim.id,
      payload: {
        info,
        currentClaimant: claim.claimant,
        claim,
      },
    };

    await this.eventBus.emit(event);
  }

  /**
   * Emit IssueStolen event
   */
  private async emitStolenEvent(
    claim: IssueClaimWithStealing,
    previousClaimant: Claimant,
    newClaimant: Claimant,
    stealableInfo: StealableInfo,
    contestWindowEndsAt: Date
  ): Promise<void> {
    const event: IssueStolenEvent = {
      id: `evt-${randomUUID()}`,
      type: 'IssueStolen',
      timestamp: new Date(),
      issueId: claim.issueId,
      claimId: claim.id,
      payload: {
        previousClaimant,
        newClaimant,
        stealableInfo,
        contestWindowEndsAt,
      },
    };

    await this.eventBus.emit(event);
  }

  /**
   * Emit StealContested event
   */
  private async emitContestEvent(claim: IssueClaimWithStealing): Promise<void> {
    const event: StealContestedEvent = {
      id: `evt-${randomUUID()}`,
      type: 'StealContested',
      timestamp: new Date(),
      issueId: claim.issueId,
      claimId: claim.id,
      payload: {
        contestInfo: claim.contestInfo!,
        claim,
      },
    };

    await this.eventBus.emit(event);
  }

  /**
   * Emit StealContestResolved event
   */
  private async emitContestResolvedEvent(
    claim: IssueClaimWithStealing,
    resolution: ContestResolution
  ): Promise<void> {
    const event: StealContestResolvedEvent = {
      id: `evt-${randomUUID()}`,
      type: 'StealContestResolved',
      timestamp: new Date(),
      issueId: claim.issueId,
      claimId: claim.id,
      payload: {
        contestInfo: claim.contestInfo!,
        resolution,
        winnerClaim: claim,
      },
    };

    await this.eventBus.emit(event);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new WorkStealingService with default event bus
 */
export function createWorkStealingService(
  repository: IIssueClaimRepository,
  config?: Partial<WorkStealingConfig>,
  eventBus?: IWorkStealingEventBus
): WorkStealingService {
  const bus = eventBus ?? new InMemoryWorkStealingEventBus();
  return new WorkStealingService(repository, bus, config);
}
