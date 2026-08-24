/**
 * V3 Gossip Protocol Consensus
 * Eventually consistent consensus for large-scale distributed systems
 */

import { EventEmitter } from 'events';
import type { ConsensusTransport, ConsensusMessage } from './transport.js';
import {
  ConsensusProposal,
  ConsensusVote,
  ConsensusResult,
  ConsensusConfig,
  SWARM_CONSTANTS,
} from '../types.js';

export interface GossipMessage {
  id: string;
  type: 'proposal' | 'vote' | 'state' | 'ack';
  senderId: string;
  version: number;
  payload: unknown;
  timestamp: Date;
  ttl: number;
  hops: number;
  path: string[];
}

/**
 * Bounded set that evicts oldest entries when capacity is reached.
 * Uses Map insertion-order for O(1) FIFO eviction. (PERF-01)
 */
export class BoundedSet<T> {
  private map = new Map<T, true>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  has(value: T): boolean {
    return this.map.has(value);
  }

  add(value: T): void {
    if (this.map.has(value)) return;

    if (this.map.size >= this.maxSize) {
      // Evict oldest (first inserted)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
    this.map.set(value, true);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export interface GossipNode {
  id: string;
  state: Map<string, unknown>;
  version: number;
  neighbors: Set<string>;
  seenMessages: BoundedSet<string>;
  lastSync: Date;
}

export interface GossipConfig extends Partial<ConsensusConfig> {
  fanout?: number;
  gossipIntervalMs?: number;
  maxHops?: number;
  convergenceThreshold?: number;
  /**
   * ADR-095 G2 — optional pluggable transport. When set, gossip messages
   * to neighbors actually go over it (signed if the transport has a
   * keypair) and inbound gossip is routed back into the merge logic.
   * When unset, behavior is unchanged: the legacy in-process path mutates
   * the local `nodes` map directly (single-process).
   */
  transport?: ConsensusTransport;
}

export class GossipConsensus extends EventEmitter {
  private config: GossipConfig;
  private node: GossipNode;
  private nodes: Map<string, GossipNode> = new Map();
  private proposals: Map<string, ConsensusProposal> = new Map();
  private messageQueue: GossipMessage[] = [];
  private gossipInterval?: NodeJS.Timeout;
  private proposalCounter: number = 0;
  private readonly transport?: ConsensusTransport;

  constructor(nodeId: string, config: GossipConfig = {}) {
    super();
    this.config = {
      threshold: config.threshold ?? SWARM_CONSTANTS.DEFAULT_CONSENSUS_THRESHOLD,
      timeoutMs: config.timeoutMs ?? SWARM_CONSTANTS.DEFAULT_CONSENSUS_TIMEOUT_MS,
      maxRounds: config.maxRounds ?? 10,
      requireQuorum: config.requireQuorum ?? false, // Gossip is eventually consistent
      fanout: config.fanout ?? 3,
      gossipIntervalMs: config.gossipIntervalMs ?? 100,
      maxHops: config.maxHops ?? 10,
      convergenceThreshold: config.convergenceThreshold ?? 0.9,
      transport: config.transport,
    };
    this.transport = config.transport;

    this.node = {
      id: nodeId,
      state: new Map(),
      version: 0,
      neighbors: new Set(),
      seenMessages: new BoundedSet(100_000), // PERF-01: ~4MB cap (100K × ~40B IDs)
      lastSync: new Date(),
    };

    if (this.transport) {
      this.transport.onMessage(async (msg: ConsensusMessage) => this.handleInboundGossipMessage(msg));
    }
  }

  /**
   * ADR-095 G2 — route an inbound transport message into the gossip merge
   * logic. The transport handles signature verification (if enabled). We
   * dedupe by message id (the BoundedSet `seenMessages`) and process it as
   * though it arrived from a neighbor.
   */
  private async handleInboundGossipMessage(msg: ConsensusMessage): Promise<void> {
    if (msg.type !== 'gossip') return;
    const gm = msg.payload as GossipMessage | undefined;
    if (!gm || typeof gm.id !== 'string') return;
    if (this.node.seenMessages.has(gm.id)) return;
    // Ensure the sender is known as a neighbor so processReceivedMessage works.
    if (!this.nodes.has(msg.from)) {
      this.nodes.set(msg.from, { id: msg.from, state: new Map(), version: 0, neighbors: new Set(), seenMessages: new BoundedSet(100_000), lastSync: new Date() });
    }
    this.node.neighbors.add(msg.from);
    // Process against THIS node's state (the message reached us).
    await this.processReceivedMessage(this.node, {
      ...gm,
      timestamp: gm.timestamp ? new Date(gm.timestamp as unknown as string) : new Date(),
      path: Array.isArray(gm.path) ? gm.path : [],
    });
  }

  async initialize(): Promise<void> {
    this.startGossipLoop();
    this.emit('initialized', { nodeId: this.node.id });
  }

  async shutdown(): Promise<void> {
    if (this.gossipInterval) {
      clearInterval(this.gossipInterval);
    }
    this.emit('shutdown');
  }

  addNode(nodeId: string): void {
    this.nodes.set(nodeId, {
      id: nodeId,
      state: new Map(),
      version: 0,
      neighbors: new Set(),
      seenMessages: new BoundedSet(100_000), // PERF-01: bounded to prevent memory leak (~4MB cap)
      lastSync: new Date(),
    });

    // Add as neighbor with some probability (random mesh)
    if (Math.random() < 0.5) {
      this.node.neighbors.add(nodeId);
      this.nodes.get(nodeId)!.neighbors.add(this.node.id);
    }
  }

  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    this.node.neighbors.delete(nodeId);

    for (const node of this.nodes.values()) {
      node.neighbors.delete(nodeId);
    }
  }

  addNeighbor(nodeId: string): void {
    if (this.nodes.has(nodeId)) {
      this.node.neighbors.add(nodeId);
    }
  }

  removeNeighbor(nodeId: string): void {
    this.node.neighbors.delete(nodeId);
  }

  async propose(
    value: unknown,
    weights?: Map<string, number>
  ): Promise<ConsensusProposal> {
    this.proposalCounter++;
    const proposalId = `gossip_${this.node.id}_${this.proposalCounter}`;

    const proposal: ConsensusProposal = {
      id: proposalId,
      proposerId: this.node.id,
      value,
      term: this.node.version,
      timestamp: new Date(),
      votes: new Map(),
      status: 'pending',
      weights,
    };

    this.proposals.set(proposalId, proposal);

    // Self-vote
    proposal.votes.set(this.node.id, {
      voterId: this.node.id,
      approve: true,
      confidence: 1.0,
      timestamp: new Date(),
    });

    // Create gossip message
    const message: GossipMessage = {
      id: `msg_${proposalId}`,
      type: 'proposal',
      senderId: this.node.id,
      version: ++this.node.version,
      payload: { proposalId, value },
      timestamp: new Date(),
      ttl: this.config.maxHops ?? 10,
      hops: 0,
      path: [this.node.id],
    };

    // Queue for gossip
    this.queueMessage(message);

    return proposal;
  }

  async vote(proposalId: string, vote: ConsensusVote): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return;
    }

    proposal.votes.set(vote.voterId, vote);

    // Create vote gossip message
    const message: GossipMessage = {
      id: `vote_${proposalId}_${vote.voterId}`,
      type: 'vote',
      senderId: this.node.id,
      version: ++this.node.version,
      payload: { proposalId, vote },
      timestamp: new Date(),
      ttl: this.config.maxHops ?? 10,
      hops: 0,
      path: [this.node.id],
    };

    this.queueMessage(message);

    // Check convergence
    await this.checkConvergence(proposalId);
  }

  async awaitConsensus(proposalId: string): Promise<ConsensusResult> {
    const startTime = Date.now();
    const maxWait = this.config.timeoutMs ?? 30000;

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) {
          clearInterval(checkInterval);
          reject(new Error(`Proposal ${proposalId} not found`));
          return;
        }

        if (proposal.status !== 'pending') {
          clearInterval(checkInterval);
          resolve(this.createResult(proposal, Date.now() - startTime));
          return;
        }

        // Check convergence
        this.checkConvergence(proposalId);

        if (Date.now() - startTime > maxWait) {
          clearInterval(checkInterval);
          // Gossip is eventually consistent, so mark as accepted if threshold met
          const totalNodes = this.nodes.size + 1;
          const votes = proposal.votes.size;
          const threshold = this.config.convergenceThreshold ?? 0.9;

          if (votes / totalNodes >= threshold) {
            proposal.status = 'accepted';
          } else {
            proposal.status = 'expired';
          }

          resolve(this.createResult(proposal, Date.now() - startTime));
        }
      }, 50);
    });
  }

  // ===== GOSSIP PROTOCOL =====

  private startGossipLoop(): void {
    this.gossipInterval = setInterval(() => {
      this.gossipRound();
    }, this.config.gossipIntervalMs ?? 100);
  }

  private async gossipRound(): Promise<void> {
    if (this.messageQueue.length === 0) {
      return;
    }

    // Select random neighbors (fanout)
    const fanout = Math.min(
      this.config.fanout ?? 3,
      this.node.neighbors.size
    );
    const neighbors = this.selectRandomNeighbors(fanout);

    // Send queued messages to selected neighbors
    const messages = this.messageQueue.splice(0, 10); // Process up to 10 per round

    for (const message of messages) {
      for (const neighborId of neighbors) {
        await this.sendToNeighbor(neighborId, message);
      }
    }

    this.node.lastSync = new Date();
  }

  private selectRandomNeighbors(count: number): string[] {
    const neighbors = Array.from(this.node.neighbors);
    const selected: string[] = [];

    while (selected.length < count && neighbors.length > 0) {
      const idx = Math.floor(Math.random() * neighbors.length);
      selected.push(neighbors.splice(idx, 1)[0]);
    }

    return selected;
  }

  private async sendToNeighbor(neighborId: string, message: GossipMessage): Promise<void> {
    const deliveredMessage: GossipMessage = {
      ...message,
      hops: message.hops + 1,
      path: [...message.path, neighborId],
    };

    // ADR-095 G2 — over the transport when wired: actually send the gossip
    // message to the neighbor (signed by the transport if signing is on).
    // The emit stays for observability.
    if (this.transport) {
      this.emit('message.sent', { to: neighborId, message: deliveredMessage });
      try {
        await this.transport.send(neighborId, {
          type: 'gossip',
          payload: { ...deliveredMessage, timestamp: deliveredMessage.timestamp.toISOString() },
        });
      } catch {
        // Unreachable neighbor — gossip tolerates this; it'll converge via
        // other paths or the next gossip round.
      }
      return;
    }

    // Legacy in-process path — deliver to the fake neighbor state.
    const neighbor = this.nodes.get(neighborId);
    if (!neighbor) return;
    if (neighbor.seenMessages.has(message.id)) return;
    await this.processReceivedMessage(neighbor, deliveredMessage);
    this.emit('message.sent', { to: neighborId, message: deliveredMessage });
  }

  private async processReceivedMessage(
    node: GossipNode,
    message: GossipMessage
  ): Promise<void> {
    // Mark as seen
    node.seenMessages.add(message.id);

    // Check TTL
    if (message.ttl <= 0 || message.hops >= (this.config.maxHops ?? 10)) {
      return;
    }

    switch (message.type) {
      case 'proposal':
        await this.handleProposalMessage(node, message);
        break;
      case 'vote':
        await this.handleVoteMessage(node, message);
        break;
      case 'state':
        await this.handleStateMessage(node, message);
        break;
    }

    // Propagate to neighbors (gossip)
    if (message.hops < (this.config.maxHops ?? 10)) {
      const propagateMessage: GossipMessage = {
        ...message,
        ttl: message.ttl - 1,
      };

      // Add to queue if this is our node
      if (node.id === this.node.id) {
        this.queueMessage(propagateMessage);
      }
    }
  }

  private async handleProposalMessage(
    node: GossipNode,
    message: GossipMessage
  ): Promise<void> {
    const { proposalId, value } = message.payload as {
      proposalId: string;
      value: unknown;
    };

    if (!this.proposals.has(proposalId)) {
      const proposal: ConsensusProposal = {
        id: proposalId,
        proposerId: message.senderId,
        value,
        term: message.version,
        timestamp: message.timestamp,
        votes: new Map(),
        status: 'pending',
      };

      this.proposals.set(proposalId, proposal);

      // Auto-vote (simplified)
      if (node.id === this.node.id) {
        await this.vote(proposalId, {
          voterId: this.node.id,
          approve: true,
          confidence: 0.9,
          timestamp: new Date(),
        });
      }
    }
  }

  private async handleVoteMessage(
    node: GossipNode,
    message: GossipMessage
  ): Promise<void> {
    const { proposalId, vote } = message.payload as {
      proposalId: string;
      vote: ConsensusVote;
    };

    const proposal = this.proposals.get(proposalId);
    if (proposal && !proposal.votes.has(vote.voterId)) {
      proposal.votes.set(vote.voterId, vote);
      await this.checkConvergence(proposalId);
    }
  }

  private async handleStateMessage(
    node: GossipNode,
    message: GossipMessage
  ): Promise<void> {
    const state = message.payload as Record<string, unknown>;

    // Merge state (last-writer-wins)
    if (message.version > node.version) {
      for (const [key, value] of Object.entries(state)) {
        node.state.set(key, value);
      }
      node.version = message.version;
    }
  }

  private queueMessage(message: GossipMessage): void {
    // Avoid duplicates
    if (!this.node.seenMessages.has(message.id)) {
      this.node.seenMessages.add(message.id);
      this.messageQueue.push(message);
    }
  }

  // Dream Cycle 2026-08-24 (swarm): per-voter weight for weighted consensus,
  // clamped to [0,1] (same safety rationale as byzantine.ts's f-faulty-node
  // quorum — a vote can never count for more than one unweighted vote).
  // Missing weights/voter defaults to 1 (flat vote), reproducing today's
  // behavior exactly when no weights map is supplied.
  private voteWeight(proposal: ConsensusProposal, voterId: string): number {
    const w = proposal.weights?.get(voterId) ?? 1;
    return Math.max(0, Math.min(1, w));
  }

  private async checkConvergence(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return;
    }

    const totalNodes = this.nodes.size + 1;
    const votes = proposal.votes.size;
    const threshold = this.config.convergenceThreshold ?? 0.9;
    const approvalThreshold = this.config.threshold ?? 0.66;

    // Check if we've converged (enough nodes have voted) — participation is
    // a network-topology property (has everyone been heard from), so it
    // stays an unweighted vote count; only the approve/reject decision below
    // uses weighted approval share.
    if (votes / totalNodes >= threshold) {
      const castVotes = Array.from(proposal.votes.values());
      const approvingWeight = castVotes
        .filter(v => v.approve)
        .reduce((sum, v) => sum + this.voteWeight(proposal, v.voterId), 0);
      const totalCastWeight = castVotes.reduce(
        (sum, v) => sum + this.voteWeight(proposal, v.voterId),
        0
      );

      if (totalCastWeight > 0 && approvingWeight / totalCastWeight >= approvalThreshold) {
        proposal.status = 'accepted';
        this.emit('consensus.achieved', { proposalId, approved: true });
      } else {
        proposal.status = 'rejected';
        this.emit('consensus.achieved', { proposalId, approved: false });
      }
    }
  }

  private createResult(proposal: ConsensusProposal, durationMs: number): ConsensusResult {
    const totalNodes = this.nodes.size + 1;
    const castVotes = Array.from(proposal.votes.values());
    const approvingWeight = castVotes
      .filter(v => v.approve)
      .reduce((sum, v) => sum + this.voteWeight(proposal, v.voterId), 0);
    const totalCastWeight = castVotes.reduce(
      (sum, v) => sum + this.voteWeight(proposal, v.voterId),
      0
    );

    return {
      proposalId: proposal.id,
      approved: proposal.status === 'accepted',
      approvalRate: totalCastWeight > 0 ? approvingWeight / totalCastWeight : 0,
      participationRate: proposal.votes.size / totalNodes,
      finalValue: proposal.value,
      rounds: this.node.version,
      durationMs,
    };
  }

  // ===== STATE QUERIES =====

  getConvergence(proposalId: string): number {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return 0;

    const totalNodes = this.nodes.size + 1;
    return proposal.votes.size / totalNodes;
  }

  getVersion(): number {
    return this.node.version;
  }

  getNeighborCount(): number {
    return this.node.neighbors.size;
  }

  getSeenMessageCount(): number {
    return this.node.seenMessages.size;
  }

  getQueueDepth(): number {
    return this.messageQueue.length;
  }

  // Anti-entropy: sync full state with a random neighbor
  async antiEntropy(): Promise<void> {
    if (this.node.neighbors.size === 0) return;

    const neighbors = Array.from(this.node.neighbors);
    const randomNeighbor = neighbors[Math.floor(Math.random() * neighbors.length)];

    const stateMessage: GossipMessage = {
      id: `state_${this.node.id}_${Date.now()}`,
      type: 'state',
      senderId: this.node.id,
      version: this.node.version,
      payload: Object.fromEntries(this.node.state),
      timestamp: new Date(),
      ttl: 1,
      hops: 0,
      path: [this.node.id],
    };

    await this.sendToNeighbor(randomNeighbor, stateMessage);
  }
}

export function createGossipConsensus(
  nodeId: string,
  config?: GossipConfig
): GossipConsensus {
  return new GossipConsensus(nodeId, config);
}
