/**
 * Load Balancer Service for Claims Module (ADR-016)
 *
 * Balances work across the swarm by:
 * - Tracking agent load and utilization
 * - Detecting overloaded/underloaded agents
 * - Rebalancing work through handoff mechanisms
 *
 * Rebalancing Algorithm:
 * 1. Calculate average load across swarm
 * 2. Identify overloaded agents (>1.5x average utilization)
 * 3. Identify underloaded agents (<0.5x average utilization)
 * 4. Move low-progress (<25%) work from overloaded to underloaded
 * 5. Prefer same agent type for transfers
 * 6. Use handoff mechanism (not direct reassignment)
 *
 * Events Emitted:
 * - SwarmRebalanced: When rebalancing operation completes
 * - AgentOverloaded: When an agent exceeds load threshold
 * - AgentUnderloaded: When an agent is below load threshold
 *
 * @module v3/@claude-flow/claims/application/load-balancer
 */

import { EventEmitter } from 'node:events';
import {
  Claimant as DomainClaimant,
  ClaimStatus as DomainClaimStatus,
  IssuePriority,
} from '../domain/types.js';

// =============================================================================
// Load Balancer Specific Types (aligned with ADR-016)
// =============================================================================

/**
 * Claimant type for load balancer operations (ADR-016 format)
 *
 * This is a simplified claimant representation used specifically for
 * load balancing operations. It can represent either a human or an agent.
 */
export type LoadBalancerClaimant =
  | { type: 'human'; userId: string; name: string }
  | { type: 'agent'; agentId: string; agentType: string };

/**
 * Claim status values relevant to load balancing
 */
export type LoadBalancerClaimStatus =
  | 'active'
  | 'paused'
  | 'handoff-pending'
  | 'review-requested'
  | 'blocked'
  | 'stealable'
  | 'completed';

// =============================================================================
// Load Balancer Types
// =============================================================================

/**
 * Summary of a claim for load calculations
 */
export interface ClaimSummary {
  issueId: string;
  status: LoadBalancerClaimStatus;
  priority: IssuePriority;
  progress: number; // 0-100
  claimedAt: Date;
  lastActivityAt: Date;
  estimatedRemainingMinutes?: number;
}

/**
 * Load information for a single agent
 */
export interface AgentLoadInfo {
  agentId: string;
  agentType: string;
  claimCount: number;
  maxClaims: number;
  utilization: number; // 0-1 (claimCount / maxClaims weighted by priority)
  claims: ClaimSummary[];
  avgCompletionTime: number; // Historical average in milliseconds
  currentBlockedCount: number;
}

/**
 * Load overview for an entire swarm
 */
export interface SwarmLoadInfo {
  swarmId: string;
  totalAgents: number;
  activeAgents: number;
  totalClaims: number;
  avgUtilization: number;
  agents: AgentLoadInfo[];
  overloadedAgents: string[];
  underloadedAgents: string[];
  balanceScore: number; // 0-1, higher is more balanced
}

/**
 * Options for rebalancing operation
 */
export interface RebalanceOptions {
  /** Only move claims with progress below this threshold (default: 25%) */
  maxProgressToMove: number;
  /** Prefer same agent type for transfers (default: true) */
  preferSameType: boolean;
  /** Threshold multiplier for overloaded detection (default: 1.5x average) */
  overloadThreshold: number;
  /** Threshold multiplier for underloaded detection (default: 0.5x average) */
  underloadThreshold: number;
  /** Maximum claims to move in single rebalance (default: 10) */
  maxMovesPerRebalance: number;
  /** Use handoff mechanism instead of direct reassignment (default: true) */
  useHandoff: boolean;
}

/**
 * Result of a rebalance operation
 */
export interface RebalanceResult {
  /** Claims that were moved (if useHandoff=false) or handoffs initiated */
  moved: Array<{
    issueId: string;
    from: LoadBalancerClaimant;
    to: LoadBalancerClaimant;
  }>;
  /** Suggested moves that weren't executed (for preview or when useHandoff=true) */
  suggested: Array<{
    issueId: string;
    currentOwner: LoadBalancerClaimant;
    suggestedOwner: LoadBalancerClaimant;
    reason: string;
  }>;
  /** Summary statistics */
  stats: {
    totalMoved: number;
    totalSuggested: number;
    previousBalanceScore: number;
    newBalanceScore: number;
    executionTimeMs: number;
  };
}

/**
 * Report on load imbalance in the swarm
 */
export interface ImbalanceReport {
  swarmId: string;
  timestamp: Date;
  isBalanced: boolean;
  balanceScore: number;
  avgLoad: number;
  overloaded: Array<{
    agentId: string;
    agentType: string;
    utilization: number;
    excessClaims: number;
    movableClaims: ClaimSummary[];
  }>;
  underloaded: Array<{
    agentId: string;
    agentType: string;
    utilization: number;
    availableCapacity: number;
  }>;
  recommendations: string[];
}

// =============================================================================
// Load Balancer Interface
// =============================================================================

/**
 * Interface for the Load Balancer service
 */
export interface ILoadBalancer {
  /**
   * Get load information for a specific agent
   */
  getAgentLoad(agentId: string): Promise<AgentLoadInfo>;

  /**
   * Get load overview for entire swarm
   */
  getSwarmLoad(swarmId: string): Promise<SwarmLoadInfo>;

  /**
   * Rebalance work across swarm
   * @param swarmId - The swarm to rebalance
   * @param options - Rebalancing options
   */
  rebalance(swarmId: string, options?: Partial<RebalanceOptions>): Promise<RebalanceResult>;

  /**
   * Preview rebalance without applying changes
   */
  previewRebalance(swarmId: string, options?: Partial<RebalanceOptions>): Promise<RebalanceResult>;

  /**
   * Detect overloaded/underloaded agents
   */
  detectImbalance(swarmId: string): Promise<ImbalanceReport>;
}

// =============================================================================
// Dependencies Interfaces
// =============================================================================

/**
 * Agent metadata for load balancing operations
 */
export interface AgentMetadata {
  agentId: string;
  agentType: string;
  maxClaims: number;
  swarmId?: string;
}

/**
 * Claim repository interface for load balancing data access
 *
 * This is a specialized interface for load balancing operations.
 * Implementations should adapt from the main IClaimRepository or IIssueClaimRepository.
 */
export interface ILoadBalancerClaimRepository {
  /**
   * Get all claims held by a specific agent
   */
  getClaimsByAgent(agentId: string): Promise<ClaimSummary[]>;

  /**
   * Get all claims in a swarm, grouped by agent ID
   */
  getClaimsBySwarm(swarmId: string): Promise<Map<string, ClaimSummary[]>>;

  /**
   * Get historical completion times for an agent (in milliseconds)
   * Used to calculate average completion time metrics
   */
  getAgentCompletionHistory(agentId: string, limit?: number): Promise<number[]>;
}

/**
 * Agent registry interface for agent metadata
 *
 * Provides access to agent configuration needed for load calculations.
 */
export interface IAgentRegistry {
  /**
   * Get metadata for a specific agent
   */
  getAgent(agentId: string): Promise<AgentMetadata | null>;

  /**
   * Get all agents in a swarm
   */
  getAgentsBySwarm(swarmId: string): Promise<AgentMetadata[]>;
}

/**
 * Handoff service interface for initiating claim transfers
 *
 * Load balancer uses handoffs (not direct reassignment) to maintain
 * proper claim lifecycle and audit trail.
 */
export interface IHandoffService {
  /**
   * Request a handoff from one claimant to another
   * @param issueId - The issue to transfer
   * @param from - Current owner
   * @param to - Proposed new owner
   * @param reason - Reason for the handoff request
   */
  requestHandoff(issueId: string, from: LoadBalancerClaimant, to: LoadBalancerClaimant, reason: string): Promise<void>;
}

// =============================================================================
// Events
// =============================================================================

/**
 * Event types emitted by the Load Balancer
 */
export type LoadBalancerEventType =
  | 'swarm:rebalanced'
  | 'agent:overloaded'
  | 'agent:underloaded';

export interface SwarmRebalancedEvent {
  type: 'swarm:rebalanced';
  swarmId: string;
  timestamp: Date;
  result: RebalanceResult;
}

export interface AgentOverloadedEvent {
  type: 'agent:overloaded';
  agentId: string;
  agentType: string;
  utilization: number;
  claimCount: number;
  maxClaims: number;
  timestamp: Date;
}

export interface AgentUnderloadedEvent {
  type: 'agent:underloaded';
  agentId: string;
  agentType: string;
  utilization: number;
  claimCount: number;
  maxClaims: number;
  timestamp: Date;
}

// =============================================================================
// Load Balancer Implementation
// =============================================================================

const DEFAULT_REBALANCE_OPTIONS: RebalanceOptions = {
  maxProgressToMove: 25,
  preferSameType: true,
  overloadThreshold: 1.5,
  underloadThreshold: 0.5,
  maxMovesPerRebalance: 10,
  useHandoff: true,
};

/**
 * Load Balancer Service
 *
 * Balances work across the swarm using the following algorithm:
 * 1. Calculate average load across swarm
 * 2. Identify overloaded agents (>1.5x average utilization)
 * 3. Identify underloaded agents (<0.5x average utilization)
 * 4. Move low-progress (<25%) work from overloaded to underloaded
 * 5. Prefer same agent type for transfers
 * 6. Use handoff mechanism (not direct reassignment)
 */
export class LoadBalancer extends EventEmitter implements ILoadBalancer {
  private readonly claimRepository: ILoadBalancerClaimRepository;
  private readonly agentRegistry: IAgentRegistry;
  private readonly handoffService: IHandoffService;

  constructor(
    claimRepository: ILoadBalancerClaimRepository,
    agentRegistry: IAgentRegistry,
    handoffService: IHandoffService
  ) {
    super();
    this.claimRepository = claimRepository;
    this.agentRegistry = agentRegistry;
    this.handoffService = handoffService;
  }

  /**
   * Get load information for a specific agent
   */
  async getAgentLoad(agentId: string): Promise<AgentLoadInfo> {
    const agent = await this.agentRegistry.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const claims = await this.claimRepository.getClaimsByAgent(agentId);
    const completionHistory = await this.claimRepository.getAgentCompletionHistory(agentId, 50);

    const utilization = this.calculateUtilization(claims, agent.maxClaims);
    const blockedCount = claims.filter((c) => c.status === 'blocked').length;
    const avgCompletionTime =
      completionHistory.length > 0
        ? completionHistory.reduce((sum, t) => sum + t, 0) / completionHistory.length
        : 0;

    return {
      agentId: agent.agentId,
      agentType: agent.agentType,
      claimCount: claims.length,
      maxClaims: agent.maxClaims,
      utilization,
      claims,
      avgCompletionTime,
      currentBlockedCount: blockedCount,
    };
  }

  /**
   * Get load overview for entire swarm
   */
  async getSwarmLoad(swarmId: string): Promise<SwarmLoadInfo> {
    const agents = await this.agentRegistry.getAgentsBySwarm(swarmId);
    const claimsByAgent = await this.claimRepository.getClaimsBySwarm(swarmId);

    const agentLoads: AgentLoadInfo[] = [];
    let totalClaims = 0;
    let totalUtilization = 0;
    let activeAgents = 0;

    for (const agent of agents) {
      const claims = claimsByAgent.get(agent.agentId) || [];
      const completionHistory = await this.claimRepository.getAgentCompletionHistory(
        agent.agentId,
        50
      );

      const utilization = this.calculateUtilization(claims, agent.maxClaims);
      const blockedCount = claims.filter((c) => c.status === 'blocked').length;
      const avgCompletionTime =
        completionHistory.length > 0
          ? completionHistory.reduce((sum, t) => sum + t, 0) / completionHistory.length
          : 0;

      const loadInfo: AgentLoadInfo = {
        agentId: agent.agentId,
        agentType: agent.agentType,
        claimCount: claims.length,
        maxClaims: agent.maxClaims,
        utilization,
        claims,
        avgCompletionTime,
        currentBlockedCount: blockedCount,
      };

      agentLoads.push(loadInfo);
      totalClaims += claims.length;
      totalUtilization += utilization;

      if (claims.length > 0) {
        activeAgents++;
      }
    }

    const avgUtilization = agents.length > 0 ? totalUtilization / agents.length : 0;

    // Detect overloaded/underloaded
    const overloadedAgents = agentLoads
      .filter((a) => a.utilization > avgUtilization * DEFAULT_REBALANCE_OPTIONS.overloadThreshold)
      .map((a) => a.agentId);

    const underloadedAgents = agentLoads
      .filter((a) => a.utilization < avgUtilization * DEFAULT_REBALANCE_OPTIONS.underloadThreshold)
      .map((a) => a.agentId);

    // Calculate balance score (0-1, higher is better)
    const balanceScore = this.calculateBalanceScore(agentLoads);

    return {
      swarmId,
      totalAgents: agents.length,
      activeAgents,
      totalClaims,
      avgUtilization,
      agents: agentLoads,
      overloadedAgents,
      underloadedAgents,
      balanceScore,
    };
  }

  /**
   * Rebalance work across swarm
   */
  async rebalance(
    swarmId: string,
    options?: Partial<RebalanceOptions>
  ): Promise<RebalanceResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_REBALANCE_OPTIONS, ...options };

    // Get current state
    const swarmLoad = await this.getSwarmLoad(swarmId);
    const previousBalanceScore = swarmLoad.balanceScore;

    // Detect imbalance
    const imbalance = await this.detectImbalance(swarmId);

    const moved: RebalanceResult['moved'] = [];
    const suggested: RebalanceResult['suggested'] = [];

    // Process overloaded agents
    for (const overloaded of imbalance.overloaded) {
      // Find movable claims (low progress, not blocked)
      const movableClaims = overloaded.movableClaims
        .filter((c) => c.progress < opts.maxProgressToMove && c.status === 'active')
        .sort((a, b) => a.progress - b.progress); // Move lowest progress first

      for (const claim of movableClaims) {
        if (moved.length + suggested.length >= opts.maxMovesPerRebalance) {
          break;
        }

        // Find suitable target agent
        const target = this.findBestTarget(
          overloaded.agentType,
          imbalance.underloaded,
          opts.preferSameType
        );

        if (!target) {
          suggested.push({
            issueId: claim.issueId,
            currentOwner: { type: 'agent', agentId: overloaded.agentId, agentType: overloaded.agentType },
            suggestedOwner: { type: 'agent', agentId: 'none-available', agentType: overloaded.agentType },
            reason: 'No suitable underloaded agent available',
          });
          continue;
        }

        const from: LoadBalancerClaimant = {
          type: 'agent',
          agentId: overloaded.agentId,
          agentType: overloaded.agentType,
        };
        const to: LoadBalancerClaimant = {
          type: 'agent',
          agentId: target.agentId,
          agentType: target.agentType,
        };

        if (opts.useHandoff) {
          // Use handoff mechanism
          await this.handoffService.requestHandoff(
            claim.issueId,
            from,
            to,
            `Load balancing: redistributing work across swarm (${overloaded.utilization.toFixed(2)} -> ${target.utilization.toFixed(2)} utilization)`
          );
          moved.push({ issueId: claim.issueId, from, to });
        } else {
          // Just suggest, don't execute
          suggested.push({
            issueId: claim.issueId,
            currentOwner: from,
            suggestedOwner: to,
            reason: `Load balancing: agent ${overloaded.agentId} overloaded at ${(overloaded.utilization * 100).toFixed(0)}%`,
          });
        }

        // Update target's capacity tracking (in-memory for this operation)
        target.availableCapacity--;
        if (target.availableCapacity <= 0) {
          const idx = imbalance.underloaded.indexOf(target);
          if (idx >= 0) {
            imbalance.underloaded.splice(idx, 1);
          }
        }
      }
    }

    // Calculate new balance score
    const newSwarmLoad = await this.getSwarmLoad(swarmId);
    const newBalanceScore = newSwarmLoad.balanceScore;

    const result: RebalanceResult = {
      moved,
      suggested,
      stats: {
        totalMoved: moved.length,
        totalSuggested: suggested.length,
        previousBalanceScore,
        newBalanceScore,
        executionTimeMs: Date.now() - startTime,
      },
    };

    // Emit swarm rebalanced event
    this.emit('swarm:rebalanced', {
      type: 'swarm:rebalanced',
      swarmId,
      timestamp: new Date(),
      result,
    } as SwarmRebalancedEvent);

    return result;
  }

  /**
   * Preview rebalance without applying changes
   */
  async previewRebalance(
    swarmId: string,
    options?: Partial<RebalanceOptions>
  ): Promise<RebalanceResult> {
    // Force useHandoff to false for preview - we just want suggestions
    return this.rebalance(swarmId, { ...options, useHandoff: false });
  }

  /**
   * Detect overloaded/underloaded agents
   */
  async detectImbalance(swarmId: string): Promise<ImbalanceReport> {
    const swarmLoad = await this.getSwarmLoad(swarmId);
    const avgLoad = swarmLoad.avgUtilization;

    const overloaded: ImbalanceReport['overloaded'] = [];
    const underloaded: ImbalanceReport['underloaded'] = [];
    const recommendations: string[] = [];

    for (const agent of swarmLoad.agents) {
      const isOverloaded =
        agent.utilization > avgLoad * DEFAULT_REBALANCE_OPTIONS.overloadThreshold;
      const isUnderloaded =
        agent.utilization < avgLoad * DEFAULT_REBALANCE_OPTIONS.underloadThreshold;

      if (isOverloaded) {
        const excessClaims = Math.ceil(
          agent.claimCount - agent.maxClaims * avgLoad
        );
        const movableClaims = agent.claims.filter(
          (c) => c.progress < DEFAULT_REBALANCE_OPTIONS.maxProgressToMove
        );

        overloaded.push({
          agentId: agent.agentId,
          agentType: agent.agentType,
          utilization: agent.utilization,
          excessClaims: Math.max(0, excessClaims),
          movableClaims,
        });

        // Emit overloaded event
        this.emit('agent:overloaded', {
          type: 'agent:overloaded',
          agentId: agent.agentId,
          agentType: agent.agentType,
          utilization: agent.utilization,
          claimCount: agent.claimCount,
          maxClaims: agent.maxClaims,
          timestamp: new Date(),
        } as AgentOverloadedEvent);

        if (movableClaims.length > 0) {
          recommendations.push(
            `Agent ${agent.agentId} (${agent.agentType}) is overloaded at ${(agent.utilization * 100).toFixed(0)}% with ${movableClaims.length} movable claims`
          );
        }
      }

      if (isUnderloaded) {
        const availableCapacity = agent.maxClaims - agent.claimCount;

        underloaded.push({
          agentId: agent.agentId,
          agentType: agent.agentType,
          utilization: agent.utilization,
          availableCapacity,
        });

        // Emit underloaded event
        this.emit('agent:underloaded', {
          type: 'agent:underloaded',
          agentId: agent.agentId,
          agentType: agent.agentType,
          utilization: agent.utilization,
          claimCount: agent.claimCount,
          maxClaims: agent.maxClaims,
          timestamp: new Date(),
        } as AgentUnderloadedEvent);
      }
    }

    // Generate recommendations
    if (overloaded.length > 0 && underloaded.length > 0) {
      const totalMovable = overloaded.reduce(
        (sum, o) => sum + o.movableClaims.length,
        0
      );
      const totalCapacity = underloaded.reduce(
        (sum, u) => sum + u.availableCapacity,
        0
      );

      recommendations.push(
        `Can redistribute up to ${Math.min(totalMovable, totalCapacity)} claims from ${overloaded.length} overloaded to ${underloaded.length} underloaded agents`
      );
    }

    if (overloaded.length > 0 && underloaded.length === 0) {
      recommendations.push(
        `${overloaded.length} overloaded agents but no underloaded agents available. Consider spawning more agents.`
      );
    }

    const isBalanced =
      overloaded.length === 0 ||
      swarmLoad.balanceScore > 0.8;

    return {
      swarmId,
      timestamp: new Date(),
      isBalanced,
      balanceScore: swarmLoad.balanceScore,
      avgLoad,
      overloaded,
      underloaded,
      recommendations,
    };
  }

  // =============================================================================
  // Private Helper Methods
  // =============================================================================

  /**
   * Calculate utilization based on claims and their priorities
   */
  private calculateUtilization(claims: ClaimSummary[], maxClaims: number): number {
    if (maxClaims === 0) return 0;
    if (claims.length === 0) return 0;

    // Weight claims by priority
    const priorityWeights: Record<string, number> = {
      critical: 2.0,
      high: 1.5,
      medium: 1.0,
      low: 0.5,
    };

    let weightedCount = 0;
    for (const claim of claims) {
      const weight = priorityWeights[claim.priority] || 1.0;
      // Blocked claims count less toward utilization
      const blockFactor = claim.status === 'blocked' ? 0.5 : 1.0;
      weightedCount += weight * blockFactor;
    }

    // Normalize to 0-1 range
    return Math.min(1, weightedCount / maxClaims);
  }

  /**
   * Calculate balance score for the swarm (0-1, higher is better)
   *
   * Uses coefficient of variation: 1 - (stdDev / mean)
   * A perfectly balanced swarm has score = 1
   */
  private calculateBalanceScore(agentLoads: AgentLoadInfo[]): number {
    if (agentLoads.length === 0) return 1;
    if (agentLoads.length === 1) return 1;

    const utilizations = agentLoads.map((a) => a.utilization);
    const mean = utilizations.reduce((sum, u) => sum + u, 0) / utilizations.length;

    if (mean === 0) return 1; // No work = perfectly balanced

    const variance =
      utilizations.reduce((sum, u) => sum + Math.pow(u - mean, 2), 0) /
      utilizations.length;
    const stdDev = Math.sqrt(variance);

    // Coefficient of variation normalized to 0-1
    const cv = stdDev / mean;
    const score = Math.max(0, Math.min(1, 1 - cv));

    return score;
  }

  /**
   * Find the best target agent for receiving a transferred claim
   */
  private findBestTarget(
    sourceAgentType: string,
    candidates: ImbalanceReport['underloaded'],
    preferSameType: boolean
  ): ImbalanceReport['underloaded'][0] | null {
    if (candidates.length === 0) return null;

    // Sort candidates by preference
    const sorted = [...candidates].sort((a, b) => {
      // Prefer same type if configured
      if (preferSameType) {
        const aMatch = a.agentType === sourceAgentType ? 0 : 1;
        const bMatch = b.agentType === sourceAgentType ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }

      // Then by available capacity (more is better)
      if (a.availableCapacity !== b.availableCapacity) {
        return b.availableCapacity - a.availableCapacity;
      }

      // Then by utilization (lower is better)
      return a.utilization - b.utilization;
    });

    return sorted[0] || null;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a LoadBalancer instance with dependencies
 *
 * @param claimRepository - Repository for accessing claim data
 * @param agentRegistry - Registry for agent metadata
 * @param handoffService - Service for initiating claim handoffs
 * @returns A configured LoadBalancer instance
 *
 * @example
 * ```typescript
 * const loadBalancer = createLoadBalancer(
 *   claimRepository,
 *   agentRegistry,
 *   handoffService
 * );
 *
 * // Get swarm load overview
 * const swarmLoad = await loadBalancer.getSwarmLoad('swarm-1');
 *
 * // Detect and report imbalances
 * const imbalance = await loadBalancer.detectImbalance('swarm-1');
 *
 * // Preview rebalancing without applying
 * const preview = await loadBalancer.previewRebalance('swarm-1');
 *
 * // Execute rebalancing with handoffs
 * const result = await loadBalancer.rebalance('swarm-1', {
 *   maxProgressToMove: 25,
 *   preferSameType: true
 * });
 * ```
 */
export function createLoadBalancer(
  claimRepository: ILoadBalancerClaimRepository,
  agentRegistry: IAgentRegistry,
  handoffService: IHandoffService
): ILoadBalancer {
  return new LoadBalancer(claimRepository, agentRegistry, handoffService);
}

// Alias for backward compatibility with ADR-016 naming
export type Claimant = LoadBalancerClaimant;
