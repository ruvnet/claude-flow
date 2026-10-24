/**
 * V3 Swarm Communication Hooks
 *
 * Enables agent-to-agent communication, pattern broadcasting,
 * consensus building, and task handoff coordination.
 *
 * @module @claude-flow/hooks/swarm
 */

import { EventEmitter } from 'node:events';
import { reasoningBank, type GuidancePattern } from '../reasoningbank/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Message between agents
 */
export interface SwarmMessage {
  id: string;
  from: string;
  to: string | '*'; // '*' for broadcast
  type: 'context' | 'pattern' | 'handoff' | 'consensus' | 'result' | 'query';
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  ttl?: number; // Time-to-live in ms
  priority: 'low' | 'normal' | 'high' | 'critical';
}

/**
 * Pattern broadcast entry
 */
export interface PatternBroadcast {
  id: string;
  sourceAgent: string;
  pattern: GuidancePattern;
  broadcastTime: number;
  recipients: string[];
  acknowledgments: string[];
}

/**
 * Consensus request
 */
export interface ConsensusRequest {
  id: string;
  initiator: string;
  question: string;
  options: string[];
  votes: Map<string, string>;
  deadline: number;
  status: 'pending' | 'resolved' | 'expired';
  result?: {
    winner: string;
    confidence: number;
    participation: number;
  };
}

/**
 * Task handoff
 */
export interface TaskHandoff {
  id: string;
  taskId: string;
  description: string;
  fromAgent: string;
  toAgent: string;
  context: {
    filesModified: string[];
    patternsUsed: string[];
    decisions: string[];
    blockers: string[];
    nextSteps: string[];
  };
  status: 'pending' | 'accepted' | 'rejected' | 'completed';
  timestamp: number;
  completedAt?: number;
}

/**
 * Agent state in swarm
 */
export interface SwarmAgentState {
  id: string;
  name: string;
  status: 'idle' | 'busy' | 'waiting' | 'offline';
  currentTask?: string;
  lastSeen: number;
  capabilities: string[];
  patternsShared: number;
  handoffsReceived: number;
  handoffsCompleted: number;
}

/**
 * Swarm communication configuration
 */
export interface SwarmConfig {
  /** Agent ID for this instance */
  agentId: string;
  /** Agent name/role */
  agentName: string;
  /** Message retention time (ms) */
  messageRetention: number;
  /** Consensus timeout (ms) */
  consensusTimeout: number;
  /** Auto-acknowledge messages */
  autoAcknowledge: boolean;
  /** Broadcast patterns automatically */
  autoBroadcastPatterns: boolean;
  /** Pattern broadcast threshold (quality) */
  patternBroadcastThreshold: number;
}

const DEFAULT_CONFIG: SwarmConfig = {
  agentId: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  agentName: 'anonymous',
  messageRetention: 3600000, // 1 hour
  consensusTimeout: 30000, // 30 seconds
  autoAcknowledge: true,
  autoBroadcastPatterns: true,
  patternBroadcastThreshold: 0.7,
};

// ============================================================================
// SwarmCommunication Class
// ============================================================================

/**
 * Swarm Communication Hub
 *
 * Manages agent-to-agent communication within the swarm.
 */
export class SwarmCommunication extends EventEmitter {
  private config: SwarmConfig;
  private messages: Map<string, SwarmMessage> = new Map();
  private broadcasts: Map<string, PatternBroadcast> = new Map();
  private consensusRequests: Map<string, ConsensusRequest> = new Map();
  private handoffs: Map<string, TaskHandoff> = new Map();
  private agents: Map<string, SwarmAgentState> = new Map();
  private initialized = false;
  private cleanupTimer?: NodeJS.Timeout;

  // Metrics
  private metrics = {
    messagesSent: 0,
    messagesReceived: 0,
    patternsBroadcast: 0,
    consensusInitiated: 0,
    consensusResolved: 0,
    handoffsInitiated: 0,
    handoffsCompleted: 0,
  };

  constructor(config: Partial<SwarmConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize swarm communication
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Register self in agent registry
    this.registerAgent({
      id: this.config.agentId,
      name: this.config.agentName,
      status: 'idle',
      lastSeen: Date.now(),
      capabilities: [],
      patternsShared: 0,
      handoffsReceived: 0,
      handoffsCompleted: 0,
    });

    // Start cleanup interval (store reference to clear on shutdown)
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000);

    // Listen for pattern storage to auto-broadcast
    if (this.config.autoBroadcastPatterns) {
      reasoningBank.on('pattern:stored', async (data) => {
        const patterns = await reasoningBank.searchPatterns(data.id, 1);
        if (patterns.length > 0 && patterns[0].pattern.quality >= this.config.patternBroadcastThreshold) {
          await this.broadcastPattern(patterns[0].pattern);
        }
      });
    }

    this.initialized = true;
    this.emit('initialized', { agentId: this.config.agentId });
  }

  /**
   * Shutdown swarm communication and cleanup resources
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    // Clear cleanup timer to prevent memory leaks
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Clear all maps
    this.messages.clear();
    this.broadcasts.clear();
    this.consensusRequests.clear();
    this.handoffs.clear();
    this.agents.clear();

    this.initialized = false;
    this.emit('shutdown', { agentId: this.config.agentId });
  }

  // ============================================================================
  // Agent-to-Agent Messaging
  // ============================================================================

  /**
   * Send a message to another agent
   */
  async sendMessage(
    to: string,
    content: string,
    options: {
      type?: SwarmMessage['type'];
      priority?: SwarmMessage['priority'];
      metadata?: Record<string, unknown>;
      ttl?: number;
    } = {}
  ): Promise<SwarmMessage> {
    await this.ensureInitialized();

    const message: SwarmMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from: this.config.agentId,
      to,
      type: options.type || 'context',
      content,
      metadata: options.metadata || {},
      timestamp: Date.now(),
      ttl: options.ttl,
      priority: options.priority || 'normal',
    };

    this.messages.set(message.id, message);
    this.metrics.messagesSent++;

    this.emit('message:sent', message);

    // If target agent exists, trigger delivery event
    if (to === '*' || this.agents.has(to)) {
      this.emit('message:delivered', message);
    }

    return message;
  }

  /**
   * Get messages for this agent
   */
  getMessages(options: {
    from?: string;
    type?: SwarmMessage['type'];
    since?: number;
    limit?: number;
  } = {}): SwarmMessage[] {
    const now = Date.now();
    let messages = Array.from(this.messages.values())
      .filter(m =>
        (m.to === this.config.agentId || m.to === '*') &&
        (!m.ttl || m.timestamp + m.ttl > now)
      );

    if (options.from) {
      messages = messages.filter(m => m.from === options.from);
    }
    if (options.type) {
      messages = messages.filter(m => m.type === options.type);
    }
    if (options.since !== undefined) {
      const sinceTime = options.since;
      messages = messages.filter(m => m.timestamp > sinceTime);
    }

    messages.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      return pDiff !== 0 ? pDiff : b.timestamp - a.timestamp;
    });

    if (options.limit) {
      messages = messages.slice(0, options.limit);
    }

    this.metrics.messagesReceived += messages.length;
    return messages;
  }

  /**
   * Broadcast context to all agents
   */
  async broadcastContext(content: string, metadata: Record<string, unknown> = {}): Promise<SwarmMessage> {
    return this.sendMessage('*', content, {
      type: 'context',
      priority: 'normal',
      metadata,
    });
  }

  /**
   * Query other agents
   */
  async queryAgents(query: string): Promise<SwarmMessage> {
    return this.sendMessage('*', query, {
      type: 'query',
      priority: 'normal',
    });
  }

  // ============================================================================
  // Pattern Broadcasting
  // ============================================================================

  /**
   * Broadcast a learned pattern to the swarm
   */
  async broadcastPattern(
    pattern: GuidancePattern,
    targetAgents?: string[]
  ): Promise<PatternBroadcast> {
    await this.ensureInitialized();

    const broadcast: PatternBroadcast = {
      id: `bc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sourceAgent: this.config.agentId,
      pattern,
      broadcastTime: Date.now(),
      recipients: targetAgents || Array.from(this.agents.keys()),
      acknowledgments: [],
    };

    this.broadcasts.set(broadcast.id, broadcast);
    this.metrics.patternsBroadcast++;

    // Update agent stats
    const agentState = this.agents.get(this.config.agentId);
    if (agentState) {
      agentState.patternsShared++;
    }

    // Send as message
    await this.sendMessage(targetAgents ? targetAgents.join(',') : '*',
      JSON.stringify({
        broadcastId: broadcast.id,
        strategy: pattern.strategy,
        domain: pattern.domain,
        quality: pattern.quality,
      }), {
        type: 'pattern',
        priority: 'normal',
        metadata: { broadcastId: broadcast.id },
      }
    );

    this.emit('pattern:broadcast', broadcast);

    return broadcast;
  }

  /**
   * Acknowledge receipt of a pattern broadcast
   */
  acknowledgeBroadcast(broadcastId: string): boolean {
    const broadcast = this.broadcasts.get(broadcastId);
    if (!broadcast) return false;

    if (!broadcast.acknowledgments.includes(this.config.agentId)) {
      broadcast.acknowledgments.push(this.config.agentId);
      this.emit('pattern:acknowledged', { broadcastId, agentId: this.config.agentId });
    }

    return true;
  }

  /**
   * Get recent pattern broadcasts
   */
  getPatternBroadcasts(options: {
    since?: number;
    domain?: string;
    minQuality?: number;
  } = {}): PatternBroadcast[] {
    let broadcasts = Array.from(this.broadcasts.values());

    if (options.since !== undefined) {
      const sinceTime = options.since;
      broadcasts = broadcasts.filter(b => b.broadcastTime > sinceTime);
    }
    if (options.domain) {
      broadcasts = broadcasts.filter(b => b.pattern.domain === options.domain);
    }
    if (options.minQuality !== undefined) {
      const minQ = options.minQuality;
      broadcasts = broadcasts.filter(b => b.pattern.quality >= minQ);
    }

    return broadcasts.sort((a, b) => b.broadcastTime - a.broadcastTime);
  }

  /**
   * Import a broadcast pattern into local ReasoningBank
   */
  async importBroadcastPattern(broadcastId: string): Promise<boolean> {
    const broadcast = this.broadcasts.get(broadcastId);
    if (!broadcast) return false;

    await reasoningBank.storePattern(
      broadcast.pattern.strategy,
      broadcast.pattern.domain,
      {
        sourceAgent: broadcast.sourceAgent,
        broadcastId,
        imported: true,
      }
    );

    this.acknowledgeBroadcast(broadcastId);
    return true;
  }

  // ============================================================================
  // Consensus Guidance
  // ============================================================================

  /**
   * Initiate a consensus request
   */
  async initiateConsensus(
    question: string,
    options: string[],
    timeout?: number
  ): Promise<ConsensusRequest> {
    await this.ensureInitialized();

    const request: ConsensusRequest = {
      id: `cons_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      initiator: this.config.agentId,
      question,
      options,
      votes: new Map(),
      deadline: Date.now() + (timeout || this.config.consensusTimeout),
      status: 'pending',
    };

    this.consensusRequests.set(request.id, request);
    this.metrics.consensusInitiated++;

    // Broadcast the consensus request
    await this.sendMessage('*', JSON.stringify({
      consensusId: request.id,
      question,
      options,
      deadline: request.deadline,
    }), {
      type: 'consensus',
      priority: 'high',
      metadata: { consensusId: request.id },
    });

    // Set timeout for resolution
    setTimeout(() => this.resolveConsensus(request.id), timeout || this.config.consensusTimeout);

    this.emit('consensus:initiated', request);

    return request;
  }

  /**
   * Vote on a consensus request
   */
  voteConsensus(consensusId: string, vote: string): boolean {
    const request = this.consensusRequests.get(consensusId);
    if (!request || request.status !== 'pending') return false;
    if (!request.options.includes(vote)) return false;
    if (Date.now() > request.deadline) return false;

    request.votes.set(this.config.agentId, vote);

    this.emit('consensus:voted', { consensusId, agentId: this.config.agentId, vote });

    // Check if all known agents have voted
    const agentCount = this.agents.size;
    if (request.votes.size >= agentCount) {
      this.resolveConsensus(consensusId);
    }

    return true;
  }

  /**
   * Resolve a consensus request
   */
  private resolveConsensus(consensusId: string): void {
    const request = this.consensusRequests.get(consensusId);
    if (!request || request.status !== 'pending') return;

    const voteCounts = new Map<string, number>();
    for (const vote of request.votes.values()) {
      voteCounts.set(vote, (voteCounts.get(vote) || 0) + 1);
    }

    let winner = '';
    let maxVotes = 0;
    for (const [option, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = option;
      }
    }

    const participation = this.agents.size > 0 ? request.votes.size / this.agents.size : 0;
    const confidence = request.votes.size > 0 ? maxVotes / request.votes.size : 0;

    request.status = request.votes.size > 0 ? 'resolved' : 'expired';
    request.result = {
      winner,
      confidence,
      participation,
    };

    if (request.status === 'resolved') {
      this.metrics.consensusResolved++;
    }

    this.emit('consensus:resolved', request);
  }

  /**
   * Get consensus request by ID
   */
  getConsensus(consensusId: string): ConsensusRequest | undefined {
    return this.consensusRequests.get(consensusId);
  }

  /**
   * Get pending consensus requests
   */
  getPendingConsensus(): ConsensusRequest[] {
    return Array.from(this.consensusRequests.values())
      .filter(r => r.status === 'pending');
  }

  /**
   * Generate consensus guidance text
   */
  generateConsensusGuidance(consensusId: string): string {
    const request = this.consensusRequests.get(consensusId);
    if (!request) return 'Consensus request not found';

    const lines: string[] = [
      `**Consensus: ${request.question}**`,
      '',
      `Status: ${request.status.toUpperCase()}`,
      `Initiator: ${request.initiator}`,
      '',
      '**Options**:',
    ];

    for (const option of request.options) {
      const votes = Array.from(request.votes.entries())
        .filter(([_, v]) => v === option)
        .map(([agent]) => agent);
      lines.push(`- ${option}: ${votes.length} votes`);
    }

    if (request.result) {
      lines.push('');
      lines.push(`**Result**: ${request.result.winner}`);
      lines.push(`Confidence: ${(request.result.confidence * 100).toFixed(0)}%`);
      lines.push(`Participation: ${(request.result.participation * 100).toFixed(0)}%`);
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Task Handoff
  // ============================================================================

  /**
   * Initiate a task handoff to another agent
   */
  async initiateHandoff(
    toAgent: string,
    taskDescription: string,
    context: TaskHandoff['context']
  ): Promise<TaskHandoff> {
    await this.ensureInitialized();

    const handoff: TaskHandoff = {
      id: `ho_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskId: `task_${Date.now()}`,
      description: taskDescription,
      fromAgent: this.config.agentId,
      toAgent,
      context,
      status: 'pending',
      timestamp: Date.now(),
    };

    this.handoffs.set(handoff.id, handoff);
    this.metrics.handoffsInitiated++;

    // Send handoff message
    await this.sendMessage(toAgent, JSON.stringify({
      handoffId: handoff.id,
      description: taskDescription,
      context,
    }), {
      type: 'handoff',
      priority: 'high',
      metadata: { handoffId: handoff.id },
    });

    this.emit('handoff:initiated', handoff);

    return handoff;
  }

  /**
   * Accept a task handoff
   */
  acceptHandoff(handoffId: string): boolean {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff || handoff.toAgent !== this.config.agentId) return false;
    if (handoff.status !== 'pending') return false;

    handoff.status = 'accepted';

    // Update agent stats
    const agentState = this.agents.get(this.config.agentId);
    if (agentState) {
      agentState.handoffsReceived++;
      agentState.currentTask = handoff.description;
      agentState.status = 'busy';
    }

    this.emit('handoff:accepted', handoff);

    return true;
  }

  /**
   * Reject a task handoff
   */
  rejectHandoff(handoffId: string, reason?: string): boolean {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff || handoff.toAgent !== this.config.agentId) return false;
    if (handoff.status !== 'pending') return false;

    handoff.status = 'rejected';
    if (reason) {
      handoff.context.blockers.push(reason);
    }

    this.emit('handoff:rejected', { handoff, reason });

    return true;
  }

  /**
   * Complete a task handoff
   */
  completeHandoff(handoffId: string, result?: Record<string, unknown>): boolean {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff || handoff.toAgent !== this.config.agentId) return false;
    if (handoff.status !== 'accepted') return false;

    handoff.status = 'completed';
    handoff.completedAt = Date.now();
    if (result) {
      handoff.context = { ...handoff.context, ...result };
    }

    // Update agent stats
    const agentState = this.agents.get(this.config.agentId);
    if (agentState) {
      agentState.handoffsCompleted++;
      agentState.currentTask = undefined;
      agentState.status = 'idle';
    }

    this.metrics.handoffsCompleted++;

    this.emit('handoff:completed', handoff);

    return true;
  }

  /**
   * Get handoff by ID
   */
  getHandoff(handoffId: string): TaskHandoff | undefined {
    return this.handoffs.get(handoffId);
  }

  /**
   * Get pending handoffs for this agent
   */
  getPendingHandoffs(): TaskHandoff[] {
    return Array.from(this.handoffs.values())
      .filter(h => h.toAgent === this.config.agentId && h.status === 'pending');
  }

  /**
   * Generate handoff context text for Claude
   */
  generateHandoffContext(handoffId: string): string {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) return 'Handoff not found';

    const lines: string[] = [
      `## Task Handoff from ${handoff.fromAgent}`,
      '',
      `**Task**: ${handoff.description}`,
      `**Status**: ${handoff.status.toUpperCase()}`,
      '',
    ];

    if (handoff.context.filesModified.length > 0) {
      lines.push('**Files Modified**:');
      for (const file of handoff.context.filesModified) {
        lines.push(`- ${file}`);
      }
      lines.push('');
    }

    if (handoff.context.patternsUsed.length > 0) {
      lines.push('**Patterns Used**:');
      for (const pattern of handoff.context.patternsUsed) {
        lines.push(`- ${pattern}`);
      }
      lines.push('');
    }

    if (handoff.context.decisions.length > 0) {
      lines.push('**Decisions Made**:');
      for (const decision of handoff.context.decisions) {
        lines.push(`- ${decision}`);
      }
      lines.push('');
    }

    if (handoff.context.blockers.length > 0) {
      lines.push('**Blockers**:');
      for (const blocker of handoff.context.blockers) {
        lines.push(`- ⚠️ ${blocker}`);
      }
      lines.push('');
    }

    if (handoff.context.nextSteps.length > 0) {
      lines.push('**Next Steps**:');
      for (const step of handoff.context.nextSteps) {
        lines.push(`- [ ] ${step}`);
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Agent Registry
  // ============================================================================

  /**
   * Register an agent in the swarm
   */
  registerAgent(agent: SwarmAgentState): void {
    this.agents.set(agent.id, agent);
    this.emit('agent:registered', agent);
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId: string, status: SwarmAgentState['status']): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.lastSeen = Date.now();
      this.emit('agent:updated', agent);
    }
  }

  /**
   * Get all registered agents
   */
  getAgents(): SwarmAgentState[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): SwarmAgentState | undefined {
    return this.agents.get(agentId);
  }

  // ============================================================================
  // Statistics & Utilities
  // ============================================================================

  /**
   * Get communication statistics
   */
  getStats(): {
    agentId: string;
    agentCount: number;
    metrics: {
      messagesSent: number;
      messagesReceived: number;
      patternsBroadcast: number;
      consensusInitiated: number;
      consensusResolved: number;
      handoffsInitiated: number;
      handoffsCompleted: number;
    };
    pendingMessages: number;
    pendingHandoffs: number;
    pendingConsensus: number;
  } {
    return {
      agentId: this.config.agentId,
      agentCount: this.agents.size,
      metrics: { ...this.metrics },
      pendingMessages: this.getMessages({ limit: 1000 }).length,
      pendingHandoffs: this.getPendingHandoffs().length,
      pendingConsensus: this.getPendingConsensus().length,
    };
  }

  /**
   * Cleanup old messages and data
   */
  private cleanup(): void {
    const now = Date.now();
    const retention = this.config.messageRetention;

    // Cleanup old messages
    for (const [id, message] of this.messages) {
      if (now - message.timestamp > retention) {
        this.messages.delete(id);
      }
    }

    // Cleanup old broadcasts
    for (const [id, broadcast] of this.broadcasts) {
      if (now - broadcast.broadcastTime > retention) {
        this.broadcasts.delete(id);
      }
    }

    // Cleanup expired consensus requests
    for (const [id, request] of this.consensusRequests) {
      if (request.status === 'pending' && now > request.deadline) {
        this.resolveConsensus(id);
      }
    }

    // Mark offline agents
    for (const agent of this.agents.values()) {
      if (now - agent.lastSeen > 300000) { // 5 minutes
        agent.status = 'offline';
      }
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export const swarmComm = new SwarmCommunication();

export {
  SwarmCommunication as default,
};
