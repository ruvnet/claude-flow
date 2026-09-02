/**
 * V3 Gossip Protocol Consensus
 * Eventually consistent consensus for large-scale distributed systems
 */

import { EventEmitter } from 'events';
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

export interface GossipNode {
  id: string;
  state: Map<string, unknown>;
  version: number;
  neighbors: Set<string>;
  seenMessages: Set<string>;
  lastSync: Date;
}

export interface GossipConfig extends Partial<ConsensusConfig> {
  fanout?: number;
  gossipIntervalMs?: number;
  maxHops?: number;
  convergenceThreshold?: number;
}

export class GossipConsensus extends EventEmitter {
  private config: GossipConfig;
  private node: GossipNode;
  private nodes: Map<string, GossipNode> = new Map();
  private proposals: Map<string, ConsensusProposal> = new Map();
  private messageQueue: GossipMessage[] = [];
  private gossipInterval?: NodeJS.Timeout;
  private proposalCounter: number = 0;

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
    };

    this.node = {
      id: nodeId,
      state: new Map(),
      version: 0,
      neighbors: new Set(),
      seenMessages: new Set(),
      lastSync: new Date(),
    };
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
      seenMessages: new Set(),
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

  async propose(value: unknown): Promise<ConsensusProposal> {
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
    const neighbor = this.nodes.get(neighborId);
    if (!neighbor) {
      return;
    }

    // Check if already seen
    if (neighbor.seenMessages.has(message.id)) {
      return;
    }

    // Deliver message to neighbor node
    const deliveredMessage: GossipMessage = {
      ...message,
      hops: message.hops + 1,
      path: [...message.path, neighborId],
    };

    // Process at neighbor
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

  private async checkConvergence(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return;
    }

    const totalNodes = this.nodes.size + 1;
    const votes = proposal.votes.size;
    const threshold = this.config.convergenceThreshold ?? 0.9;
    const approvalThreshold = this.config.threshold ?? 0.66;

    // Check if we've converged (enough nodes have voted)
    if (votes / totalNodes >= threshold) {
      const approvingVotes = Array.from(proposal.votes.values()).filter(
        v => v.approve
      ).length;

      if (approvingVotes / votes >= approvalThreshold) {
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
    const approvingVotes = Array.from(proposal.votes.values()).filter(
      v => v.approve
    ).length;

    return {
      proposalId: proposal.id,
      approved: proposal.status === 'accepted',
      approvalRate: proposal.votes.size > 0
        ? approvingVotes / proposal.votes.size
        : 0,
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
