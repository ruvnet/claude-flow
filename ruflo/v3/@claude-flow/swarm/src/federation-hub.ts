/**
 * Federation Hub - Ephemeral Agent Coordination
 *
 * Provides cross-swarm coordination and ephemeral agent management
 * for distributed multi-swarm architectures.
 *
 * Features:
 * - Ephemeral agent spawning (short-lived, task-specific)
 * - Cross-swarm communication and coordination
 * - Federation protocol for distributed consensus
 * - Resource allocation and load balancing
 * - Agent lifecycle management with auto-cleanup
 *
 * Performance Targets:
 * - Agent spawn: <50ms
 * - Cross-swarm message: <100ms
 * - Federation sync: <500ms
 * - Auto-cleanup: Background, non-blocking
 *
 * Implements ADR-001: agentic-flow@alpha compatibility
 * Implements ADR-003: Unified coordination engine
 *
 * @module @claude-flow/swarm/federation-hub
 * @version 3.0.0-alpha.1
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type FederationId = string;
export type SwarmId = string;
export type EphemeralAgentId = string;

export interface FederationConfig {
  /** Federation identifier */
  federationId?: FederationId;
  /** Maximum ephemeral agents per swarm */
  maxEphemeralAgents?: number;
  /** Default TTL for ephemeral agents (ms) */
  defaultTTL?: number;
  /** Sync interval for federation state (ms) */
  syncIntervalMs?: number;
  /** Enable auto-cleanup of expired agents */
  autoCleanup?: boolean;
  /** Cleanup check interval (ms) */
  cleanupIntervalMs?: number;
  /** Cross-swarm communication timeout (ms) */
  communicationTimeoutMs?: number;
  /** Enable federation-wide consensus */
  enableConsensus?: boolean;
  /** Consensus quorum percentage */
  consensusQuorum?: number;
}

export interface SwarmRegistration {
  swarmId: SwarmId;
  name: string;
  endpoint?: string;
  capabilities: string[];
  maxAgents: number;
  currentAgents: number;
  status: 'active' | 'inactive' | 'degraded';
  registeredAt: Date;
  lastHeartbeat: Date;
  metadata?: Record<string, unknown>;
}

export interface EphemeralAgent {
  id: EphemeralAgentId;
  swarmId: SwarmId;
  type: string;
  task: string;
  status: 'spawning' | 'active' | 'completing' | 'terminated';
  ttl: number;
  createdAt: Date;
  expiresAt: Date;
  completedAt?: Date;
  result?: unknown;
  error?: Error;
  metadata?: Record<string, unknown>;
}

export interface SpawnEphemeralOptions {
  /** Target swarm (auto-select if not specified) */
  swarmId?: SwarmId;
  /** Agent type */
  type: string;
  /** Task description */
  task: string;
  /** Time-to-live in ms (default from config) */
  ttl?: number;
  /** Required capabilities */
  capabilities?: string[];
  /** Priority for swarm selection */
  priority?: 'low' | 'normal' | 'high' | 'critical';
  /** Wait for completion */
  waitForCompletion?: boolean;
  /** Completion timeout (ms) */
  completionTimeout?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface SpawnResult {
  agentId: EphemeralAgentId;
  swarmId: SwarmId;
  status: 'spawned' | 'queued' | 'failed';
  estimatedTTL: number;
  result?: unknown;
  error?: string;
}

export interface FederationMessage {
  id: string;
  type: 'broadcast' | 'direct' | 'consensus' | 'heartbeat';
  sourceSwarmId: SwarmId;
  targetSwarmId?: SwarmId;
  payload: unknown;
  timestamp: Date;
  ttl?: number;
}

export interface ConsensusProposal {
  id: string;
  proposerId: SwarmId;
  type: string;
  value: unknown;
  votes: Map<SwarmId, boolean>;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
  expiresAt: Date;
}

export interface FederationStats {
  federationId: FederationId;
  totalSwarms: number;
  activeSwarms: number;
  totalEphemeralAgents: number;
  activeEphemeralAgents: number;
  completedAgents: number;
  failedAgents: number;
  avgAgentLifespanMs: number;
  messagesExchanged: number;
  consensusProposals: number;
  uptime: number;
}

export interface FederationEvent {
  type: FederationEventType;
  federationId: FederationId;
  swarmId?: SwarmId;
  agentId?: EphemeralAgentId;
  data?: unknown;
  timestamp: Date;
}

export type FederationEventType =
  | 'swarm_joined'
  | 'swarm_left'
  | 'swarm_degraded'
  | 'agent_spawned'
  | 'agent_completed'
  | 'agent_failed'
  | 'agent_expired'
  | 'message_sent'
  | 'message_received'
  | 'consensus_started'
  | 'consensus_completed'
  | 'federation_synced';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<FederationConfig> = {
  federationId: `federation_${Date.now()}`,
  maxEphemeralAgents: 100,
  defaultTTL: 300000, // 5 minutes
  syncIntervalMs: 30000, // 30 seconds
  autoCleanup: true,
  cleanupIntervalMs: 60000, // 1 minute
  communicationTimeoutMs: 5000,
  enableConsensus: true,
  consensusQuorum: 0.66,
};

// ============================================================================
// Federation Hub Implementation
// ============================================================================

export class FederationHub extends EventEmitter {
  private config: Required<FederationConfig>;
  private swarms: Map<SwarmId, SwarmRegistration> = new Map();
  private ephemeralAgents: Map<EphemeralAgentId, EphemeralAgent> = new Map();
  private messages: FederationMessage[] = [];
  private proposals: Map<string, ConsensusProposal> = new Map();
  private syncInterval?: ReturnType<typeof setInterval>;
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private startTime: Date;
  private stats: {
    messagesExchanged: number;
    consensusProposals: number;
    completedAgents: number;
    failedAgents: number;
    totalAgentLifespanMs: number;
  };

  // ============================================================================
  // Secondary Indexes for O(1) Lookups (Performance Optimization)
  // ============================================================================

  /** Index: swarmId -> Set of agentIds */
  private agentsBySwarm: Map<SwarmId, Set<EphemeralAgentId>> = new Map();

  /** Index: status -> Set of agentIds */
  private agentsByStatus: Map<EphemeralAgent['status'], Set<EphemeralAgentId>> = new Map();

  constructor(config?: FederationConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = new Date();
    this.stats = {
      messagesExchanged: 0,
      consensusProposals: 0,
      completedAgents: 0,
      failedAgents: 0,
      totalAgentLifespanMs: 0,
    };

    // Initialize status index sets
    this.agentsByStatus.set('spawning', new Set());
    this.agentsByStatus.set('active', new Set());
    this.agentsByStatus.set('completing', new Set());
    this.agentsByStatus.set('terminated', new Set());
  }

  // ==========================================================================
  // Index Maintenance Helpers
  // ==========================================================================

  /**
   * Add agent to indexes - O(1)
   */
  private addAgentToIndexes(agent: EphemeralAgent): void {
    // Add to swarm index
    if (!this.agentsBySwarm.has(agent.swarmId)) {
      this.agentsBySwarm.set(agent.swarmId, new Set());
    }
    this.agentsBySwarm.get(agent.swarmId)!.add(agent.id);

    // Add to status index
    this.agentsByStatus.get(agent.status)!.add(agent.id);
  }

  /**
   * Remove agent from indexes - O(1)
   */
  private removeAgentFromIndexes(agent: EphemeralAgent): void {
    // Remove from swarm index
    const swarmSet = this.agentsBySwarm.get(agent.swarmId);
    if (swarmSet) {
      swarmSet.delete(agent.id);
      if (swarmSet.size === 0) {
        this.agentsBySwarm.delete(agent.swarmId);
      }
    }

    // Remove from status index
    this.agentsByStatus.get(agent.status)?.delete(agent.id);
  }

  /**
   * Update agent status in index - O(1)
   */
  private updateAgentStatusIndex(agent: EphemeralAgent, oldStatus: EphemeralAgent['status']): void {
    this.agentsByStatus.get(oldStatus)?.delete(agent.id);
    this.agentsByStatus.get(agent.status)!.add(agent.id);
  }

  /**
   * Get agents by swarm using index - O(k) where k is agents in swarm
   */
  private getAgentIdsBySwarm(swarmId: SwarmId): EphemeralAgentId[] {
    const agentIds = this.agentsBySwarm.get(swarmId);
    return agentIds ? Array.from(agentIds) : [];
  }

  /**
   * Get agents by status using index - O(k) where k is agents with status
   */
  private getAgentIdsByStatus(status: EphemeralAgent['status']): EphemeralAgentId[] {
    const agentIds = this.agentsByStatus.get(status);
    return agentIds ? Array.from(agentIds) : [];
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the federation hub
   */
  async initialize(): Promise<void> {
    // Start sync interval
    this.syncInterval = setInterval(
      () => this.syncFederation(),
      this.config.syncIntervalMs
    );

    // Start cleanup interval if enabled
    if (this.config.autoCleanup) {
      this.cleanupInterval = setInterval(
        () => this.cleanupExpiredAgents(),
        this.config.cleanupIntervalMs
      );
    }

    this.emitEvent('federation_synced');
  }

  /**
   * Shutdown the federation hub
   */
  async shutdown(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Terminate all active ephemeral agents using index - O(k) where k = active + spawning
    const activeIds = this.getAgentIdsByStatus('active');
    const spawningIds = this.getAgentIdsByStatus('spawning');
    const toTerminate = [...activeIds, ...spawningIds];

    await Promise.all(toTerminate.map(id => this.terminateAgent(id)));

    // Clear all data structures and indexes
    this.swarms.clear();
    this.ephemeralAgents.clear();
    this.proposals.clear();
    this.agentsBySwarm.clear();
    for (const status of this.agentsByStatus.values()) {
      status.clear();
    }
  }

  // ==========================================================================
  // Swarm Registration
  // ==========================================================================

  /**
   * Register a swarm with the federation
   */
  registerSwarm(registration: Omit<SwarmRegistration, 'registeredAt' | 'lastHeartbeat'>): void {
    const fullRegistration: SwarmRegistration = {
      ...registration,
      registeredAt: new Date(),
      lastHeartbeat: new Date(),
    };

    this.swarms.set(registration.swarmId, fullRegistration);
    this.emitEvent('swarm_joined', registration.swarmId);
  }

  /**
   * Unregister a swarm from the federation
   */
  unregisterSwarm(swarmId: SwarmId): boolean {
    const removed = this.swarms.delete(swarmId);
    if (removed) {
      // Terminate all ephemeral agents in this swarm using index - O(k)
      const agentIds = this.getAgentIdsBySwarm(swarmId);
      for (const agentId of agentIds) {
        this.terminateAgent(agentId);
      }
      this.emitEvent('swarm_left', swarmId);
    }
    return removed;
  }

  /**
   * Update swarm heartbeat
   */
  heartbeat(swarmId: SwarmId, currentAgents?: number): boolean {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return false;

    swarm.lastHeartbeat = new Date();
    if (currentAgents !== undefined) {
      swarm.currentAgents = currentAgents;
    }
    if (swarm.status === 'inactive') {
      swarm.status = 'active';
    }
    return true;
  }

  /**
   * Get all registered swarms
   */
  getSwarms(): SwarmRegistration[] {
    return Array.from(this.swarms.values());
  }

  /**
   * Get swarm by ID
   */
  getSwarm(swarmId: SwarmId): SwarmRegistration | undefined {
    return this.swarms.get(swarmId);
  }

  // ==========================================================================
  // Ephemeral Agent Management
  // ==========================================================================

  /**
   * Spawn an ephemeral agent
   */
  async spawnEphemeralAgent(options: SpawnEphemeralOptions): Promise<SpawnResult> {
    // Select target swarm
    const targetSwarmId = options.swarmId || this.selectOptimalSwarm(options);

    if (!targetSwarmId) {
      return {
        agentId: '',
        swarmId: '',
        status: 'failed',
        estimatedTTL: 0,
        error: 'No suitable swarm available',
      };
    }

    const swarm = this.swarms.get(targetSwarmId);
    if (!swarm) {
      return {
        agentId: '',
        swarmId: targetSwarmId,
        status: 'failed',
        estimatedTTL: 0,
        error: 'Swarm not found',
      };
    }

    // Check capacity
    const swarmAgentCount = this.getSwarmAgentCount(targetSwarmId);
    if (swarmAgentCount >= this.config.maxEphemeralAgents) {
      return {
        agentId: '',
        swarmId: targetSwarmId,
        status: 'failed',
        estimatedTTL: 0,
        error: 'Swarm at capacity',
      };
    }

    // Create ephemeral agent
    const ttl = options.ttl || this.config.defaultTTL;
    const agentId = `ephemeral_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    const agent: EphemeralAgent = {
      id: agentId,
      swarmId: targetSwarmId,
      type: options.type,
      task: options.task,
      status: 'spawning',
      ttl,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttl),
      metadata: options.metadata,
    };

    this.ephemeralAgents.set(agentId, agent);
    this.addAgentToIndexes(agent);

    // Async spawn with status transition (spawning -> active)
    setTimeout(() => {
      const a = this.ephemeralAgents.get(agentId);
      if (a && a.status === 'spawning') {
        this.updateAgentStatusIndex(a, 'spawning');
        a.status = 'active';
        this.emitEvent('agent_spawned', targetSwarmId, agentId);
      }
    }, 50);

    // If waiting for completion
    if (options.waitForCompletion) {
      const timeout = options.completionTimeout || ttl;
      const result = await this.waitForAgentCompletion(agentId, timeout);
      return {
        agentId,
        swarmId: targetSwarmId,
        status: result ? 'spawned' : 'failed',
        estimatedTTL: ttl,
        result: result?.result,
        error: result?.error?.message,
      };
    }

    return {
      agentId,
      swarmId: targetSwarmId,
      status: 'spawned',
      estimatedTTL: ttl,
    };
  }

  /**
   * Complete an ephemeral agent's task
   */
  completeAgent(agentId: EphemeralAgentId, result?: unknown): boolean {
    const agent = this.ephemeralAgents.get(agentId);
    if (!agent) return false;

    const oldStatus = agent.status;
    agent.status = 'completing';
    this.updateAgentStatusIndex(agent, oldStatus);
    agent.result = result;
    agent.completedAt = new Date();

    const lifespan = agent.completedAt.getTime() - agent.createdAt.getTime();
    this.stats.completedAgents++;
    this.stats.totalAgentLifespanMs += lifespan;

    // Mark as terminated after a brief delay
    setTimeout(() => {
      const a = this.ephemeralAgents.get(agentId);
      if (a) {
        this.updateAgentStatusIndex(a, 'completing');
        a.status = 'terminated';
        this.emitEvent('agent_completed', a.swarmId, agentId);
      }
    }, 100);

    return true;
  }

  /**
   * Terminate an ephemeral agent
   */
  async terminateAgent(agentId: EphemeralAgentId, error?: Error): Promise<boolean> {
    const agent = this.ephemeralAgents.get(agentId);
    if (!agent) return false;

    const oldStatus = agent.status;
    agent.status = 'terminated';
    this.updateAgentStatusIndex(agent, oldStatus);
    agent.completedAt = new Date();

    if (error) {
      agent.error = error;
      this.stats.failedAgents++;
      this.emitEvent('agent_failed', agent.swarmId, agentId);
    } else {
      this.stats.completedAgents++;
      this.emitEvent('agent_completed', agent.swarmId, agentId);
    }

    const lifespan = agent.completedAt.getTime() - agent.createdAt.getTime();
    this.stats.totalAgentLifespanMs += lifespan;

    return true;
  }

  /**
   * Get ephemeral agent by ID
   */
  getAgent(agentId: EphemeralAgentId): EphemeralAgent | undefined {
    return this.ephemeralAgents.get(agentId);
  }

  /**
   * Get all ephemeral agents
   */
  getAgents(swarmId?: SwarmId): EphemeralAgent[] {
    const agents = Array.from(this.ephemeralAgents.values());
    return swarmId ? agents.filter(a => a.swarmId === swarmId) : agents;
  }

  /**
   * Get active ephemeral agents
   */
  getActiveAgents(swarmId?: SwarmId): EphemeralAgent[] {
    return this.getAgents(swarmId).filter(
      a => a.status === 'active' || a.status === 'spawning'
    );
  }

  // ==========================================================================
  // Cross-Swarm Communication
  // ==========================================================================

  /**
   * Send a message to another swarm
   */
  async sendMessage(
    sourceSwarmId: SwarmId,
    targetSwarmId: SwarmId,
    payload: unknown
  ): Promise<boolean> {
    const targetSwarm = this.swarms.get(targetSwarmId);
    if (!targetSwarm || targetSwarm.status === 'inactive') {
      return false;
    }

    const message: FederationMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'direct',
      sourceSwarmId,
      targetSwarmId,
      payload,
      timestamp: new Date(),
    };

    this.messages.push(message);
    this.stats.messagesExchanged++;
    this.emitEvent('message_sent', sourceSwarmId);

    // In real implementation, this would send to the target swarm's endpoint
    // For now, we emit an event that can be listened to
    this.emit('message', message);

    return true;
  }

  /**
   * Broadcast a message to all swarms
   */
  async broadcast(sourceSwarmId: SwarmId, payload: unknown): Promise<number> {
    let sent = 0;

    for (const swarm of this.swarms.values()) {
      if (swarm.swarmId !== sourceSwarmId && swarm.status === 'active') {
        const success = await this.sendMessage(sourceSwarmId, swarm.swarmId, payload);
        if (success) sent++;
      }
    }

    return sent;
  }

  /**
   * Get recent messages
   */
  getMessages(limit: number = 100): FederationMessage[] {
    return this.messages.slice(-limit);
  }

  // ==========================================================================
  // Federation Consensus
  // ==========================================================================

  /**
   * Propose a value for federation-wide consensus
   */
  async propose(
    proposerId: SwarmId,
    type: string,
    value: unknown,
    timeoutMs: number = 30000
  ): Promise<ConsensusProposal> {
    if (!this.config.enableConsensus) {
      throw new Error('Consensus is disabled');
    }

    const proposal: ConsensusProposal = {
      id: `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      proposerId,
      type,
      value,
      votes: new Map([[proposerId, true]]),
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + timeoutMs),
    };

    this.proposals.set(proposal.id, proposal);
    this.stats.consensusProposals++;
    this.emitEvent('consensus_started', proposerId);

    // Request votes from all active swarms
    await this.broadcast(proposerId, {
      type: 'vote_request',
      proposalId: proposal.id,
      proposalType: type,
      value,
    });

    return proposal;
  }

  /**
   * Vote on a proposal
   */
  vote(swarmId: SwarmId, proposalId: string, approve: boolean): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return false;
    }

    if (new Date() > proposal.expiresAt) {
      proposal.status = 'rejected';
      return false;
    }

    proposal.votes.set(swarmId, approve);

    // Check if quorum reached
    const activeSwarms = this.getActiveSwarmCount();
    const approvals = Array.from(proposal.votes.values()).filter(v => v).length;
    const rejections = Array.from(proposal.votes.values()).filter(v => !v).length;
    const quorumThreshold = Math.ceil(activeSwarms * this.config.consensusQuorum);

    if (approvals >= quorumThreshold) {
      proposal.status = 'accepted';
      this.emitEvent('consensus_completed', proposal.proposerId);
    } else if (rejections > activeSwarms - quorumThreshold) {
      proposal.status = 'rejected';
      this.emitEvent('consensus_completed', proposal.proposerId);
    }

    return true;
  }

  /**
   * Get proposal by ID
   */
  getProposal(proposalId: string): ConsensusProposal | undefined {
    return this.proposals.get(proposalId);
  }

  /**
   * Get all pending proposals
   */
  getPendingProposals(): ConsensusProposal[] {
    return Array.from(this.proposals.values()).filter(p => p.status === 'pending');
  }

  // ==========================================================================
  // Statistics & Monitoring
  // ==========================================================================

  /**
   * Get federation statistics
   */
  getStats(): FederationStats {
    const activeAgents = this.getActiveAgents().length;
    const avgLifespan = this.stats.completedAgents > 0
      ? this.stats.totalAgentLifespanMs / this.stats.completedAgents
      : 0;

    return {
      federationId: this.config.federationId,
      totalSwarms: this.swarms.size,
      activeSwarms: this.getActiveSwarmCount(),
      totalEphemeralAgents: this.ephemeralAgents.size,
      activeEphemeralAgents: activeAgents,
      completedAgents: this.stats.completedAgents,
      failedAgents: this.stats.failedAgents,
      avgAgentLifespanMs: avgLifespan,
      messagesExchanged: this.stats.messagesExchanged,
      consensusProposals: this.stats.consensusProposals,
      uptime: Date.now() - this.startTime.getTime(),
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private selectOptimalSwarm(options: SpawnEphemeralOptions): SwarmId | null {
    const candidates: Array<{ swarmId: SwarmId; score: number }> = [];

    for (const swarm of this.swarms.values()) {
      if (swarm.status !== 'active') continue;

      // Check capacity
      const agentCount = this.getSwarmAgentCount(swarm.swarmId);
      if (agentCount >= swarm.maxAgents) continue;

      // Check capabilities
      if (options.capabilities) {
        const hasAllCapabilities = options.capabilities.every(
          cap => swarm.capabilities.includes(cap)
        );
        if (!hasAllCapabilities) continue;
      }

      // Calculate score (higher is better)
      let score = 100;

      // Prefer swarms with more available capacity
      const availableCapacity = swarm.maxAgents - agentCount;
      score += availableCapacity * 5;

      // Prefer recently active swarms
      const lastHeartbeatAge = Date.now() - swarm.lastHeartbeat.getTime();
      score -= lastHeartbeatAge / 10000;

      candidates.push({ swarmId: swarm.swarmId, score });
    }

    if (candidates.length === 0) return null;

    // Sort by score and return best
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].swarmId;
  }

  private getSwarmAgentCount(swarmId: SwarmId): number {
    // Use index for O(1) lookup instead of O(n) filter
    const swarmAgents = this.agentsBySwarm.get(swarmId);
    if (!swarmAgents) return 0;

    // Count only active and spawning agents
    let count = 0;
    for (const agentId of swarmAgents) {
      const agent = this.ephemeralAgents.get(agentId);
      if (agent && (agent.status === 'active' || agent.status === 'spawning')) {
        count++;
      }
    }
    return count;
  }

  private getActiveSwarmCount(): number {
    return Array.from(this.swarms.values()).filter(s => s.status === 'active').length;
  }

  private async waitForAgentCompletion(
    agentId: EphemeralAgentId,
    timeout: number
  ): Promise<EphemeralAgent | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const check = () => {
        const agent = this.ephemeralAgents.get(agentId);

        if (!agent) {
          resolve(null);
          return;
        }

        if (agent.status === 'terminated' || agent.status === 'completing') {
          resolve(agent);
          return;
        }

        if (Date.now() - startTime > timeout) {
          resolve(null);
          return;
        }

        setTimeout(check, 100);
      };

      check();
    });
  }

  private syncFederation(): void {
    const now = new Date();
    const heartbeatTimeout = this.config.syncIntervalMs * 3;

    // Check for inactive swarms
    for (const swarm of this.swarms.values()) {
      const age = now.getTime() - swarm.lastHeartbeat.getTime();

      if (age > heartbeatTimeout && swarm.status === 'active') {
        swarm.status = 'degraded';
        this.emitEvent('swarm_degraded', swarm.swarmId);
      } else if (age > heartbeatTimeout * 2 && swarm.status === 'degraded') {
        swarm.status = 'inactive';
      }
    }

    // Check for expired proposals
    for (const proposal of this.proposals.values()) {
      if (proposal.status === 'pending' && now > proposal.expiresAt) {
        proposal.status = 'rejected';
      }
    }

    this.emitEvent('federation_synced');
  }

  private cleanupExpiredAgents(): void {
    const now = new Date();

    // Use status index to only check active agents - O(k) instead of O(n)
    const activeIds = this.getAgentIdsByStatus('active');
    for (const agentId of activeIds) {
      const agent = this.ephemeralAgents.get(agentId);
      if (agent && now > agent.expiresAt) {
        this.updateAgentStatusIndex(agent, 'active');
        agent.status = 'terminated';
        agent.completedAt = now;
        agent.error = new Error('Agent TTL expired');
        this.stats.failedAgents++;
        this.emitEvent('agent_expired', agent.swarmId, agent.id);
      }
    }

    // Clean up old terminated agents using index - O(k)
    const cleanupThreshold = 5 * 60 * 1000;
    const terminatedIds = this.getAgentIdsByStatus('terminated');
    for (const agentId of terminatedIds) {
      const agent = this.ephemeralAgents.get(agentId);
      if (
        agent &&
        agent.completedAt &&
        now.getTime() - agent.completedAt.getTime() > cleanupThreshold
      ) {
        this.removeAgentFromIndexes(agent);
        this.ephemeralAgents.delete(agentId);
      }
    }
  }

  private emitEvent(
    type: FederationEventType,
    swarmId?: SwarmId,
    agentId?: EphemeralAgentId,
    data?: unknown
  ): void {
    const event: FederationEvent = {
      type,
      federationId: this.config.federationId,
      swarmId,
      agentId,
      data,
      timestamp: new Date(),
    };
    this.emit('event', event);
    this.emit(type, event);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new Federation Hub instance
 */
export function createFederationHub(config?: FederationConfig): FederationHub {
  return new FederationHub(config);
}

/**
 * Global federation hub instance
 */
let defaultFederationHub: FederationHub | null = null;

/**
 * Get or create the default federation hub
 */
export function getDefaultFederationHub(): FederationHub {
  if (!defaultFederationHub) {
    defaultFederationHub = createFederationHub();
  }
  return defaultFederationHub;
}

/**
 * Reset the default federation hub
 */
export async function resetDefaultFederationHub(): Promise<void> {
  if (defaultFederationHub) {
    await defaultFederationHub.shutdown();
    defaultFederationHub = null;
  }
}
