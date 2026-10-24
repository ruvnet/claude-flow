/**
 * V3 Claude-Flow Load Balancer Unit Tests
 *
 * London School TDD - Behavior Verification
 * Tests load calculation, rebalancing, preview, and imbalance detection
 *
 * @module v3/claims/tests/load-balancer
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock, type MockedInterface } from '../../testing/src/helpers/create-mock.js';

// =============================================================================
// Domain Types
// =============================================================================

type AgentType = 'coder' | 'reviewer' | 'tester' | 'planner' | 'researcher' | 'queen-coordinator';
type AgentStatus = 'idle' | 'busy' | 'overloaded' | 'offline';

interface AgentLoad {
  agentId: string;
  agentType: AgentType;
  status: AgentStatus;
  currentClaims: number;
  maxClaims: number;
  utilizationPercent: number;
  queuedTasks: number;
  averageTaskDuration: number;
  lastActivityAt: Date;
}

interface ClaimSummary {
  issueId: string;
  agentId: string;
  priority: number;
  claimedAt: Date;
  estimatedDuration: number;
}

interface RebalanceAction {
  type: 'move' | 'reassign' | 'defer';
  claim: ClaimSummary;
  fromAgent: string;
  toAgent: string;
  reason: string;
}

interface RebalanceResult {
  success: boolean;
  actions: RebalanceAction[];
  movedClaims: number;
  error?: string;
}

interface RebalancePreview {
  proposedActions: RebalanceAction[];
  expectedImprovement: number;
  riskLevel: 'low' | 'medium' | 'high';
  warnings: string[];
}

interface ImbalanceReport {
  detected: boolean;
  severity: 'none' | 'minor' | 'moderate' | 'severe';
  overloadedAgents: string[];
  underloadedAgents: string[];
  imbalanceScore: number;
  recommendations: string[];
}

// =============================================================================
// Interfaces (Collaborators)
// =============================================================================

interface IAgentRegistry {
  getAgent(agentId: string): Promise<AgentInfo | null>;
  listAgents(filter?: AgentFilter): Promise<AgentInfo[]>;
  updateAgentStatus(agentId: string, status: AgentStatus): Promise<void>;
}

interface AgentInfo {
  id: string;
  type: AgentType;
  status: AgentStatus;
  maxClaims: number;
  capabilities: string[];
}

interface AgentFilter {
  type?: AgentType;
  status?: AgentStatus;
  available?: boolean;
}

interface IClaimRepository {
  findByAgent(agentId: string): Promise<ClaimSummary[]>;
  findAll(): Promise<ClaimSummary[]>;
  updateClaimAgent(issueId: string, newAgentId: string): Promise<void>;
}

interface ILoadCalculator {
  calculateUtilization(claims: number, maxClaims: number): number;
  calculateAverageTaskDuration(claims: ClaimSummary[]): number;
  determineStatus(utilization: number): AgentStatus;
}

interface IRebalanceStrategy {
  selectClaimsToMove(
    overloaded: AgentLoad,
    underloaded: AgentLoad[],
    claims: ClaimSummary[]
  ): RebalanceAction[];
  prioritizeActions(actions: RebalanceAction[]): RebalanceAction[];
  assessRisk(actions: RebalanceAction[]): 'low' | 'medium' | 'high';
}

interface IEventStore {
  append(event: LoadBalancerEvent): Promise<void>;
}

interface LoadBalancerEvent {
  type: string;
  timestamp: Date;
  payload: unknown;
}

// =============================================================================
// Configuration
// =============================================================================

interface LoadBalancerConfig {
  imbalanceThreshold: number; // Percentage difference that triggers rebalance
  maxActionsPerRebalance: number;
  minUtilizationForRebalance: number;
  cooldownPeriodMs: number;
  priorityWeights: {
    claimCount: number;
    utilization: number;
    queueDepth: number;
  };
}

const DEFAULT_CONFIG: LoadBalancerConfig = {
  imbalanceThreshold: 30, // 30% difference
  maxActionsPerRebalance: 10,
  minUtilizationForRebalance: 20,
  cooldownPeriodMs: 60000,
  priorityWeights: {
    claimCount: 0.4,
    utilization: 0.4,
    queueDepth: 0.2,
  },
};

// =============================================================================
// Service Under Test
// =============================================================================

class LoadBalancer {
  private lastRebalanceAt: Date | null = null;

  constructor(
    private readonly agentRegistry: IAgentRegistry,
    private readonly claimRepository: IClaimRepository,
    private readonly loadCalculator: ILoadCalculator,
    private readonly rebalanceStrategy: IRebalanceStrategy,
    private readonly eventStore: IEventStore,
    private readonly config: LoadBalancerConfig = DEFAULT_CONFIG
  ) {}

  async getAgentLoad(agentId: string): Promise<AgentLoad> {
    const agent = await this.agentRegistry.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const claims = await this.claimRepository.findByAgent(agentId);
    const currentClaims = claims.length;
    const utilizationPercent = this.loadCalculator.calculateUtilization(
      currentClaims,
      agent.maxClaims
    );
    const status = this.loadCalculator.determineStatus(utilizationPercent);

    return {
      agentId,
      agentType: agent.type,
      status,
      currentClaims,
      maxClaims: agent.maxClaims,
      utilizationPercent,
      queuedTasks: 0, // Would be fetched from task queue
      averageTaskDuration: this.loadCalculator.calculateAverageTaskDuration(claims),
      lastActivityAt: claims.length > 0
        ? claims.reduce((latest, c) => c.claimedAt > latest ? c.claimedAt : latest, claims[0].claimedAt)
        : new Date(),
    };
  }

  async rebalance(): Promise<RebalanceResult> {
    // Check cooldown
    if (this.lastRebalanceAt) {
      const timeSinceLastRebalance = Date.now() - this.lastRebalanceAt.getTime();
      if (timeSinceLastRebalance < this.config.cooldownPeriodMs) {
        return {
          success: false,
          actions: [],
          movedClaims: 0,
          error: 'Rebalance on cooldown',
        };
      }
    }

    // Get all agents and their loads
    const agents = await this.agentRegistry.listAgents({ available: true });
    const agentLoads: AgentLoad[] = await Promise.all(
      agents.map((agent) => this.getAgentLoad(agent.id))
    );

    // Identify overloaded and underloaded agents
    const overloaded = agentLoads.filter((a) => a.status === 'overloaded');
    const underloaded = agentLoads.filter(
      (a) => a.status === 'idle' || a.utilizationPercent < this.config.minUtilizationForRebalance
    );

    if (overloaded.length === 0 || underloaded.length === 0) {
      this.lastRebalanceAt = new Date(); // Set cooldown even when nothing to rebalance
      return {
        success: true,
        actions: [],
        movedClaims: 0,
      };
    }

    // Generate rebalance actions
    const allActions: RebalanceAction[] = [];
    for (const overloadedAgent of overloaded) {
      const claims = await this.claimRepository.findByAgent(overloadedAgent.agentId);
      const actions = this.rebalanceStrategy.selectClaimsToMove(
        overloadedAgent,
        underloaded,
        claims
      );
      allActions.push(...actions);
    }

    // Prioritize and limit actions
    const prioritizedActions = this.rebalanceStrategy.prioritizeActions(allActions);
    const limitedActions = prioritizedActions.slice(0, this.config.maxActionsPerRebalance);

    // Execute actions
    let movedClaims = 0;
    for (const action of limitedActions) {
      if (action.type === 'move' || action.type === 'reassign') {
        await this.claimRepository.updateClaimAgent(action.claim.issueId, action.toAgent);
        movedClaims++;
      }
    }

    this.lastRebalanceAt = new Date();

    // Emit event
    await this.eventStore.append({
      type: 'LoadRebalanced',
      timestamp: new Date(),
      payload: {
        actions: limitedActions,
        movedClaims,
        overloadedCount: overloaded.length,
        underloadedCount: underloaded.length,
      },
    });

    return {
      success: true,
      actions: limitedActions,
      movedClaims,
    };
  }

  async previewRebalance(): Promise<RebalancePreview> {
    // Get all agents and their loads (read-only)
    const agents = await this.agentRegistry.listAgents({ available: true });
    const agentLoads: AgentLoad[] = await Promise.all(
      agents.map((agent) => this.getAgentLoad(agent.id))
    );

    // Identify overloaded and underloaded agents
    const overloaded = agentLoads.filter((a) => a.status === 'overloaded');
    const underloaded = agentLoads.filter(
      (a) => a.status === 'idle' || a.utilizationPercent < this.config.minUtilizationForRebalance
    );

    const warnings: string[] = [];
    if (overloaded.length === 0) {
      warnings.push('No overloaded agents detected');
    }
    if (underloaded.length === 0) {
      warnings.push('No underloaded agents available');
    }

    // Generate proposed actions without executing
    const proposedActions: RebalanceAction[] = [];
    for (const overloadedAgent of overloaded) {
      const claims = await this.claimRepository.findByAgent(overloadedAgent.agentId);
      const actions = this.rebalanceStrategy.selectClaimsToMove(
        overloadedAgent,
        underloaded,
        claims
      );
      proposedActions.push(...actions);
    }

    const prioritizedActions = this.rebalanceStrategy.prioritizeActions(proposedActions);
    const limitedActions = prioritizedActions.slice(0, this.config.maxActionsPerRebalance);

    // Calculate expected improvement
    const currentImbalance = this.calculateImbalanceScore(agentLoads);
    const expectedImprovement = Math.min(limitedActions.length * 5, 50); // Simplified calculation

    // Assess risk
    const riskLevel = this.rebalanceStrategy.assessRisk(limitedActions);

    return {
      proposedActions: limitedActions,
      expectedImprovement,
      riskLevel,
      warnings,
    };
  }

  async detectImbalance(): Promise<ImbalanceReport> {
    const agents = await this.agentRegistry.listAgents({ available: true });
    const agentLoads: AgentLoad[] = await Promise.all(
      agents.map((agent) => this.getAgentLoad(agent.id))
    );

    const overloaded = agentLoads.filter((a) => a.status === 'overloaded');
    const underloaded = agentLoads.filter(
      (a) => a.status === 'idle' || a.utilizationPercent < this.config.minUtilizationForRebalance
    );

    const imbalanceScore = this.calculateImbalanceScore(agentLoads);
    const detected = imbalanceScore > this.config.imbalanceThreshold;

    let severity: 'none' | 'minor' | 'moderate' | 'severe' = 'none';
    if (imbalanceScore > 60) {
      severity = 'severe';
    } else if (imbalanceScore > 40) {
      severity = 'moderate';
    } else if (imbalanceScore > this.config.imbalanceThreshold) {
      severity = 'minor';
    }

    const recommendations: string[] = [];
    if (detected) {
      if (overloaded.length > 0) {
        recommendations.push(`${overloaded.length} agent(s) are overloaded and need relief`);
      }
      if (underloaded.length > 0) {
        recommendations.push(`${underloaded.length} agent(s) have capacity available`);
      }
      if (severity === 'severe') {
        recommendations.push('Immediate rebalancing recommended');
      }
    }

    // Emit event if imbalance detected
    if (detected) {
      await this.eventStore.append({
        type: 'ImbalanceDetected',
        timestamp: new Date(),
        payload: {
          severity,
          imbalanceScore,
          overloadedAgents: overloaded.map((a) => a.agentId),
          underloadedAgents: underloaded.map((a) => a.agentId),
        },
      });
    }

    return {
      detected,
      severity,
      overloadedAgents: overloaded.map((a) => a.agentId),
      underloadedAgents: underloaded.map((a) => a.agentId),
      imbalanceScore,
      recommendations,
    };
  }

  private calculateImbalanceScore(loads: AgentLoad[]): number {
    if (loads.length === 0) return 0;

    const utilizations = loads.map((l) => l.utilizationPercent);
    const maxUtilization = Math.max(...utilizations);
    const minUtilization = Math.min(...utilizations);
    const avgUtilization = utilizations.reduce((a, b) => a + b, 0) / utilizations.length;

    // Calculate standard deviation
    const variance =
      utilizations.reduce((sum, u) => sum + Math.pow(u - avgUtilization, 2), 0) / utilizations.length;
    const stdDev = Math.sqrt(variance);

    // Score based on range and standard deviation
    const rangeScore = maxUtilization - minUtilization;
    const deviationScore = stdDev * 2;

    return Math.min(100, rangeScore * 0.6 + deviationScore * 0.4);
  }

  // For testing - reset cooldown
  resetCooldown(): void {
    this.lastRebalanceAt = null;
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('LoadBalancer', () => {
  let service: LoadBalancer;
  let mockAgentRegistry: MockedInterface<IAgentRegistry>;
  let mockClaimRepository: MockedInterface<IClaimRepository>;
  let mockLoadCalculator: MockedInterface<ILoadCalculator>;
  let mockRebalanceStrategy: MockedInterface<IRebalanceStrategy>;
  let mockEventStore: MockedInterface<IEventStore>;

  const baseDate = new Date('2024-01-15T10:00:00Z');

  // Sample agent data
  const coderAgent: AgentInfo = {
    id: 'coder-1',
    type: 'coder',
    status: 'busy',
    maxClaims: 5,
    capabilities: ['coding', 'debugging'],
  };

  const reviewerAgent: AgentInfo = {
    id: 'reviewer-1',
    type: 'reviewer',
    status: 'idle',
    maxClaims: 10,
    capabilities: ['review', 'analysis'],
  };

  const testerAgent: AgentInfo = {
    id: 'tester-1',
    type: 'tester',
    status: 'busy',
    maxClaims: 8,
    capabilities: ['testing', 'validation'],
  };

  // Sample claim data
  const sampleClaims: ClaimSummary[] = [
    { issueId: 'issue-1', agentId: 'coder-1', priority: 1, claimedAt: baseDate, estimatedDuration: 3600 },
    { issueId: 'issue-2', agentId: 'coder-1', priority: 2, claimedAt: baseDate, estimatedDuration: 7200 },
    { issueId: 'issue-3', agentId: 'coder-1', priority: 1, claimedAt: baseDate, estimatedDuration: 1800 },
    { issueId: 'issue-4', agentId: 'coder-1', priority: 3, claimedAt: baseDate, estimatedDuration: 5400 },
    { issueId: 'issue-5', agentId: 'coder-1', priority: 2, claimedAt: baseDate, estimatedDuration: 2700 },
  ];

  beforeEach(() => {
    mockAgentRegistry = createMock<IAgentRegistry>();
    mockClaimRepository = createMock<IClaimRepository>();
    mockLoadCalculator = createMock<ILoadCalculator>();
    mockRebalanceStrategy = createMock<IRebalanceStrategy>();
    mockEventStore = createMock<IEventStore>();

    // Default mock behaviors
    mockLoadCalculator.calculateUtilization.mockImplementation(
      (claims, max) => (claims / max) * 100
    );
    mockLoadCalculator.calculateAverageTaskDuration.mockReturnValue(3600);
    mockLoadCalculator.determineStatus.mockImplementation((util) => {
      if (util >= 80) return 'overloaded';
      if (util >= 50) return 'busy';
      return 'idle';
    });

    mockRebalanceStrategy.selectClaimsToMove.mockReturnValue([]);
    mockRebalanceStrategy.prioritizeActions.mockImplementation((actions) => actions);
    mockRebalanceStrategy.assessRisk.mockReturnValue('low');

    mockEventStore.append.mockResolvedValue(undefined);

    service = new LoadBalancer(
      mockAgentRegistry,
      mockClaimRepository,
      mockLoadCalculator,
      mockRebalanceStrategy,
      mockEventStore
    );
  });

  // ===========================================================================
  // getAgentLoad() tests
  // ===========================================================================

  describe('getAgentLoad', () => {
    it('should calculate correct load for agent', async () => {
      // Given
      mockAgentRegistry.getAgent.mockResolvedValue(coderAgent);
      mockClaimRepository.findByAgent.mockResolvedValue(sampleClaims.slice(0, 3)); // 3 claims

      // When
      const load = await service.getAgentLoad('coder-1');

      // Then
      expect(load.agentId).toBe('coder-1');
      expect(load.agentType).toBe('coder');
      expect(load.currentClaims).toBe(3);
      expect(load.maxClaims).toBe(5);
      expect(load.utilizationPercent).toBe(60); // 3/5 * 100
    });

    it('should determine correct status based on utilization', async () => {
      // Given
      mockAgentRegistry.getAgent.mockResolvedValue(coderAgent);
      mockClaimRepository.findByAgent.mockResolvedValue(sampleClaims); // 5 claims = 100% utilization

      // When
      const load = await service.getAgentLoad('coder-1');

      // Then
      expect(load.status).toBe('overloaded');
      expect(mockLoadCalculator.determineStatus).toHaveBeenCalledWith(100);
    });

    it('should throw error for non-existent agent', async () => {
      // Given
      mockAgentRegistry.getAgent.mockResolvedValue(null);

      // When/Then
      await expect(service.getAgentLoad('unknown-agent'))
        .rejects.toThrow('Agent not found: unknown-agent');
    });

    it('should calculate average task duration', async () => {
      // Given
      mockAgentRegistry.getAgent.mockResolvedValue(coderAgent);
      mockClaimRepository.findByAgent.mockResolvedValue(sampleClaims.slice(0, 2));
      mockLoadCalculator.calculateAverageTaskDuration.mockReturnValue(5400);

      // When
      const load = await service.getAgentLoad('coder-1');

      // Then
      expect(load.averageTaskDuration).toBe(5400);
      expect(mockLoadCalculator.calculateAverageTaskDuration).toHaveBeenCalled();
    });

    it('should use current time for lastActivityAt when no claims', async () => {
      // Given
      mockAgentRegistry.getAgent.mockResolvedValue(coderAgent);
      mockClaimRepository.findByAgent.mockResolvedValue([]);

      // When
      const load = await service.getAgentLoad('coder-1');

      // Then
      expect(load.lastActivityAt).toBeDefined();
      expect(load.currentClaims).toBe(0);
    });

    it('should use latest claim date for lastActivityAt', async () => {
      // Given
      mockAgentRegistry.getAgent.mockResolvedValue(coderAgent);
      const claimsWithDates: ClaimSummary[] = [
        { issueId: 'issue-1', agentId: 'coder-1', priority: 1, claimedAt: new Date('2024-01-14T10:00:00Z'), estimatedDuration: 3600 },
        { issueId: 'issue-2', agentId: 'coder-1', priority: 2, claimedAt: new Date('2024-01-15T10:00:00Z'), estimatedDuration: 3600 },
        { issueId: 'issue-3', agentId: 'coder-1', priority: 1, claimedAt: new Date('2024-01-13T10:00:00Z'), estimatedDuration: 3600 },
      ];
      mockClaimRepository.findByAgent.mockResolvedValue(claimsWithDates);

      // When
      const load = await service.getAgentLoad('coder-1');

      // Then
      expect(load.lastActivityAt).toEqual(new Date('2024-01-15T10:00:00Z'));
    });
  });

  // ===========================================================================
  // rebalance() tests
  // ===========================================================================

  describe('rebalance', () => {
    it('should move work from overloaded to underloaded agents', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims) // Coder has 5 claims (overloaded)
        .mockResolvedValueOnce([]) // Reviewer has 0 claims (idle)
        .mockResolvedValueOnce(sampleClaims); // For rebalance selection

      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      const moveAction: RebalanceAction = {
        type: 'move',
        claim: sampleClaims[0],
        fromAgent: 'coder-1',
        toAgent: 'reviewer-1',
        reason: 'Load balancing',
      };
      mockRebalanceStrategy.selectClaimsToMove.mockReturnValue([moveAction]);
      mockClaimRepository.updateClaimAgent.mockResolvedValue(undefined);

      // When
      const result = await service.rebalance();

      // Then
      expect(result.success).toBe(true);
      expect(result.movedClaims).toBe(1);
      expect(mockClaimRepository.updateClaimAgent).toHaveBeenCalledWith('issue-1', 'reviewer-1');
    });

    it('should not rebalance when on cooldown', async () => {
      // Given - First rebalance
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent.mockResolvedValue(coderAgent);
      mockClaimRepository.findByAgent.mockResolvedValue([]);
      mockLoadCalculator.determineStatus.mockReturnValue('idle');

      await service.rebalance(); // First rebalance sets cooldown

      // When - Second rebalance immediately
      const result = await service.rebalance();

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Rebalance on cooldown');
    });

    it('should return empty result when no imbalance', async () => {
      // Given - All agents balanced
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent.mockResolvedValue([]); // No claims
      mockLoadCalculator.determineStatus.mockReturnValue('idle');

      // When
      const result = await service.rebalance();

      // Then
      expect(result.success).toBe(true);
      expect(result.actions).toHaveLength(0);
      expect(result.movedClaims).toBe(0);
    });

    it('should limit actions to maxActionsPerRebalance', async () => {
      // Given
      const config: LoadBalancerConfig = {
        ...DEFAULT_CONFIG,
        maxActionsPerRebalance: 2,
      };
      service = new LoadBalancer(
        mockAgentRegistry,
        mockClaimRepository,
        mockLoadCalculator,
        mockRebalanceStrategy,
        mockEventStore,
        config
      );

      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(sampleClaims);

      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      // Return 5 actions, but should be limited to 2
      const manyActions: RebalanceAction[] = sampleClaims.map((claim) => ({
        type: 'move' as const,
        claim,
        fromAgent: 'coder-1',
        toAgent: 'reviewer-1',
        reason: 'Load balancing',
      }));
      mockRebalanceStrategy.selectClaimsToMove.mockReturnValue(manyActions);
      mockClaimRepository.updateClaimAgent.mockResolvedValue(undefined);

      // When
      const result = await service.rebalance();

      // Then
      expect(result.actions).toHaveLength(2);
      expect(result.movedClaims).toBe(2);
    });

    it('should emit LoadRebalanced event', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(sampleClaims);

      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      const moveAction: RebalanceAction = {
        type: 'move',
        claim: sampleClaims[0],
        fromAgent: 'coder-1',
        toAgent: 'reviewer-1',
        reason: 'Load balancing',
      };
      mockRebalanceStrategy.selectClaimsToMove.mockReturnValue([moveAction]);
      mockClaimRepository.updateClaimAgent.mockResolvedValue(undefined);

      // When
      await service.rebalance();

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LoadRebalanced',
          payload: expect.objectContaining({
            movedClaims: 1,
            overloadedCount: 1,
            underloadedCount: 1,
          }),
        })
      );
    });

    it('should only execute move and reassign actions', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(sampleClaims);

      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      const actions: RebalanceAction[] = [
        { type: 'move', claim: sampleClaims[0], fromAgent: 'coder-1', toAgent: 'reviewer-1', reason: 'Move' },
        { type: 'defer', claim: sampleClaims[1], fromAgent: 'coder-1', toAgent: 'reviewer-1', reason: 'Defer' },
        { type: 'reassign', claim: sampleClaims[2], fromAgent: 'coder-1', toAgent: 'reviewer-1', reason: 'Reassign' },
      ];
      mockRebalanceStrategy.selectClaimsToMove.mockReturnValue(actions);
      mockClaimRepository.updateClaimAgent.mockResolvedValue(undefined);

      // When
      const result = await service.rebalance();

      // Then
      expect(result.movedClaims).toBe(2); // move + reassign, not defer
      expect(mockClaimRepository.updateClaimAgent).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // previewRebalance() tests
  // ===========================================================================

  describe('previewRebalance', () => {
    it('should not modify state', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(sampleClaims);

      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      const moveAction: RebalanceAction = {
        type: 'move',
        claim: sampleClaims[0],
        fromAgent: 'coder-1',
        toAgent: 'reviewer-1',
        reason: 'Load balancing',
      };
      mockRebalanceStrategy.selectClaimsToMove.mockReturnValue([moveAction]);

      // When
      await service.previewRebalance();

      // Then
      expect(mockClaimRepository.updateClaimAgent).not.toHaveBeenCalled();
      expect(mockEventStore.append).not.toHaveBeenCalled();
    });

    it('should return proposed actions without executing', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(sampleClaims);

      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      const moveAction: RebalanceAction = {
        type: 'move',
        claim: sampleClaims[0],
        fromAgent: 'coder-1',
        toAgent: 'reviewer-1',
        reason: 'Load balancing',
      };
      mockRebalanceStrategy.selectClaimsToMove.mockReturnValue([moveAction]);

      // When
      const preview = await service.previewRebalance();

      // Then
      expect(preview.proposedActions).toHaveLength(1);
      expect(preview.proposedActions[0]).toEqual(moveAction);
    });

    it('should include warnings for edge cases', async () => {
      // Given - No overloaded agents
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent.mockResolvedValue([]);
      mockLoadCalculator.determineStatus.mockReturnValue('idle');

      // When
      const preview = await service.previewRebalance();

      // Then
      expect(preview.warnings).toContain('No overloaded agents detected');
    });

    it('should assess risk level', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(sampleClaims);

      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      const moveAction: RebalanceAction = {
        type: 'move',
        claim: sampleClaims[0],
        fromAgent: 'coder-1',
        toAgent: 'reviewer-1',
        reason: 'Load balancing',
      };
      mockRebalanceStrategy.selectClaimsToMove.mockReturnValue([moveAction]);
      mockRebalanceStrategy.assessRisk.mockReturnValue('medium');

      // When
      const preview = await service.previewRebalance();

      // Then
      expect(preview.riskLevel).toBe('medium');
      expect(mockRebalanceStrategy.assessRisk).toHaveBeenCalled();
    });

    it('should calculate expected improvement', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(sampleClaims);

      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      const moveActions: RebalanceAction[] = [
        { type: 'move', claim: sampleClaims[0], fromAgent: 'coder-1', toAgent: 'reviewer-1', reason: 'Move 1' },
        { type: 'move', claim: sampleClaims[1], fromAgent: 'coder-1', toAgent: 'reviewer-1', reason: 'Move 2' },
      ];
      mockRebalanceStrategy.selectClaimsToMove.mockReturnValue(moveActions);

      // When
      const preview = await service.previewRebalance();

      // Then
      expect(preview.expectedImprovement).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // detectImbalance() tests
  // ===========================================================================

  describe('detectImbalance', () => {
    it('should detect imbalance when threshold exceeded', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims) // Coder at 100%
        .mockResolvedValueOnce([]); // Reviewer at 0%

      mockLoadCalculator.calculateUtilization
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(0);
      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      // When
      const report = await service.detectImbalance();

      // Then
      expect(report.detected).toBe(true);
      expect(report.overloadedAgents).toContain('coder-1');
      expect(report.underloadedAgents).toContain('reviewer-1');
    });

    it('should classify severity correctly', async () => {
      // Given - Severe imbalance
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims)
        .mockResolvedValueOnce([]);

      mockLoadCalculator.calculateUtilization
        .mockReturnValueOnce(100) // Coder at 100%
        .mockReturnValueOnce(0); // Reviewer at 0%
      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      // When
      const report = await service.detectImbalance();

      // Then
      expect(report.severity).toBe('severe');
    });

    it('should return no imbalance when balanced', async () => {
      // Given - All agents at similar utilization
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent.mockResolvedValue(sampleClaims.slice(0, 2)); // 2 claims each

      mockLoadCalculator.calculateUtilization.mockReturnValue(50); // Both at 50%
      mockLoadCalculator.determineStatus.mockReturnValue('busy');

      // When
      const report = await service.detectImbalance();

      // Then
      expect(report.detected).toBe(false);
      expect(report.severity).toBe('none');
      expect(report.imbalanceScore).toBeLessThan(DEFAULT_CONFIG.imbalanceThreshold);
    });

    it('should provide recommendations when imbalanced', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims)
        .mockResolvedValueOnce([]);

      mockLoadCalculator.calculateUtilization
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(0);
      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      // When
      const report = await service.detectImbalance();

      // Then
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations.some((r) => r.includes('overloaded'))).toBe(true);
    });

    it('should emit ImbalanceDetected event when detected', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims)
        .mockResolvedValueOnce([]);

      mockLoadCalculator.calculateUtilization
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(0);
      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle');

      // When
      await service.detectImbalance();

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ImbalanceDetected',
          payload: expect.objectContaining({
            severity: expect.any(String),
            imbalanceScore: expect.any(Number),
            overloadedAgents: expect.arrayContaining(['coder-1']),
          }),
        })
      );
    });

    it('should not emit event when balanced', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent);
      mockClaimRepository.findByAgent.mockResolvedValue(sampleClaims.slice(0, 2));

      mockLoadCalculator.calculateUtilization.mockReturnValue(50);
      mockLoadCalculator.determineStatus.mockReturnValue('busy');

      // When
      await service.detectImbalance();

      // Then
      expect(mockEventStore.append).not.toHaveBeenCalled();
    });

    it('should calculate correct imbalance score', async () => {
      // Given - Clear imbalance
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent, reviewerAgent, testerAgent]);
      mockAgentRegistry.getAgent
        .mockResolvedValueOnce(coderAgent)
        .mockResolvedValueOnce(reviewerAgent)
        .mockResolvedValueOnce(testerAgent);
      mockClaimRepository.findByAgent
        .mockResolvedValueOnce(sampleClaims) // Coder at 100%
        .mockResolvedValueOnce([]) // Reviewer at 0%
        .mockResolvedValueOnce(sampleClaims.slice(0, 4)); // Tester at 50%

      mockLoadCalculator.calculateUtilization
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(50);
      mockLoadCalculator.determineStatus
        .mockReturnValueOnce('overloaded')
        .mockReturnValueOnce('idle')
        .mockReturnValueOnce('busy');

      // When
      const report = await service.detectImbalance();

      // Then
      expect(report.imbalanceScore).toBeGreaterThan(0);
      expect(report.imbalanceScore).toBeLessThanOrEqual(100);
    });
  });

  // ===========================================================================
  // Edge cases and error handling
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty agent list', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([]);

      // When
      const result = await service.rebalance();

      // Then
      expect(result.success).toBe(true);
      expect(result.actions).toHaveLength(0);
    });

    it('should handle single agent', async () => {
      // Given
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent]);
      mockAgentRegistry.getAgent.mockResolvedValue(coderAgent);
      mockClaimRepository.findByAgent.mockResolvedValue(sampleClaims);
      mockLoadCalculator.determineStatus.mockReturnValue('overloaded');

      // When
      const result = await service.rebalance();

      // Then
      // No rebalance possible with single agent
      expect(result.success).toBe(true);
      expect(result.movedClaims).toBe(0);
    });

    it('should reset cooldown correctly', async () => {
      // Given - First rebalance
      mockAgentRegistry.listAgents.mockResolvedValue([coderAgent]);
      mockAgentRegistry.getAgent.mockResolvedValue(coderAgent);
      mockClaimRepository.findByAgent.mockResolvedValue([]);
      mockLoadCalculator.determineStatus.mockReturnValue('idle');

      await service.rebalance();

      // Verify cooldown is active
      const cooldownResult = await service.rebalance();
      expect(cooldownResult.success).toBe(false);

      // When - Reset cooldown
      service.resetCooldown();
      const afterResetResult = await service.rebalance();

      // Then
      expect(afterResetResult.success).toBe(true);
    });
  });
});
