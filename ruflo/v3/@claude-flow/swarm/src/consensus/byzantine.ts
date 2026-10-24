/**
 * V3 Byzantine Fault Tolerant Consensus
 * PBFT-style consensus for handling malicious or faulty nodes
 */

import { EventEmitter } from 'events';
import {
  ConsensusProposal,
  ConsensusVote,
  ConsensusResult,
  ConsensusConfig,
  SWARM_CONSTANTS,
} from '../types.js';

export type ByzantinePhase = 'pre-prepare' | 'prepare' | 'commit' | 'reply';

export interface ByzantineMessage {
  type: ByzantinePhase;
  viewNumber: number;
  sequenceNumber: number;
  digest: string;
  senderId: string;
  timestamp: Date;
  payload?: unknown;
  signature?: string;
}

export interface ByzantineNode {
  id: string;
  isPrimary: boolean;
  viewNumber: number;
  sequenceNumber: number;
  preparedMessages: Map<string, ByzantineMessage[]>;
  committedMessages: Map<string, ByzantineMessage[]>;
}

export interface ByzantineConfig extends Partial<ConsensusConfig> {
  maxFaultyNodes?: number;
  viewChangeTimeoutMs?: number;
}

export class ByzantineConsensus extends EventEmitter {
  private config: ByzantineConfig;
  private node: ByzantineNode;
  private nodes: Map<string, ByzantineNode> = new Map();
  private proposals: Map<string, ConsensusProposal> = new Map();
  private messageLog: Map<string, ByzantineMessage[]> = new Map();
  private proposalCounter: number = 0;
  private viewChangeTimeout?: NodeJS.Timeout;

  constructor(nodeId: string, config: ByzantineConfig = {}) {
    super();
    this.config = {
      threshold: config.threshold ?? SWARM_CONSTANTS.DEFAULT_CONSENSUS_THRESHOLD,
      timeoutMs: config.timeoutMs ?? SWARM_CONSTANTS.DEFAULT_CONSENSUS_TIMEOUT_MS,
      maxRounds: config.maxRounds ?? 10,
      requireQuorum: config.requireQuorum ?? true,
      maxFaultyNodes: config.maxFaultyNodes ?? 1,
      viewChangeTimeoutMs: config.viewChangeTimeoutMs ?? 5000,
    };

    this.node = {
      id: nodeId,
      isPrimary: false,
      viewNumber: 0,
      sequenceNumber: 0,
      preparedMessages: new Map(),
      committedMessages: new Map(),
    };
  }

  async initialize(): Promise<void> {
    this.emit('initialized', { nodeId: this.node.id });
  }

  async shutdown(): Promise<void> {
    if (this.viewChangeTimeout) {
      clearTimeout(this.viewChangeTimeout);
    }
    this.emit('shutdown');
  }

  addNode(nodeId: string, isPrimary: boolean = false): void {
    this.nodes.set(nodeId, {
      id: nodeId,
      isPrimary,
      viewNumber: 0,
      sequenceNumber: 0,
      preparedMessages: new Map(),
      committedMessages: new Map(),
    });

    if (isPrimary && this.node.id === nodeId) {
      this.node.isPrimary = true;
    }
  }

  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
  }

  electPrimary(): string {
    const nodeIds = [this.node.id, ...Array.from(this.nodes.keys())];
    const primaryIndex = this.node.viewNumber % nodeIds.length;
    const primaryId = nodeIds[primaryIndex];

    this.node.isPrimary = primaryId === this.node.id;

    for (const [id, node] of this.nodes) {
      node.isPrimary = id === primaryId;
    }

    this.emit('primary.elected', { primaryId, viewNumber: this.node.viewNumber });

    return primaryId;
  }

  async propose(value: unknown): Promise<ConsensusProposal> {
    if (!this.node.isPrimary) {
      throw new Error('Only primary can propose values');
    }

    this.proposalCounter++;
    const sequenceNumber = ++this.node.sequenceNumber;
    const digest = this.computeDigest(value);
    const proposalId = `bft_${this.node.viewNumber}_${sequenceNumber}`;

    const proposal: ConsensusProposal = {
      id: proposalId,
      proposerId: this.node.id,
      value,
      term: this.node.viewNumber,
      timestamp: new Date(),
      votes: new Map(),
      status: 'pending',
    };

    this.proposals.set(proposalId, proposal);

    // Phase 1: Pre-prepare
    const prePrepareMsg: ByzantineMessage = {
      type: 'pre-prepare',
      viewNumber: this.node.viewNumber,
      sequenceNumber,
      digest,
      senderId: this.node.id,
      timestamp: new Date(),
      payload: value,
    };

    await this.broadcastMessage(prePrepareMsg);

    // Self-prepare
    await this.handlePrepare({
      type: 'prepare',
      viewNumber: this.node.viewNumber,
      sequenceNumber,
      digest,
      senderId: this.node.id,
      timestamp: new Date(),
    });

    return proposal;
  }

  async vote(proposalId: string, vote: ConsensusVote): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return;
    }

    proposal.votes.set(vote.voterId, vote);

    // Check consensus
    const f = this.config.maxFaultyNodes ?? 1;
    const n = this.nodes.size + 1;
    const requiredVotes = 2 * f + 1;

    const approvingVotes = Array.from(proposal.votes.values()).filter(
      v => v.approve
    ).length;

    if (approvingVotes >= requiredVotes) {
      proposal.status = 'accepted';
      this.emit('consensus.achieved', { proposalId, approved: true });
    } else if (proposal.votes.size >= n && approvingVotes < requiredVotes) {
      proposal.status = 'rejected';
      this.emit('consensus.achieved', { proposalId, approved: false });
    }
  }

  async awaitConsensus(proposalId: string): Promise<ConsensusResult> {
    const startTime = Date.now();

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

        if (Date.now() - startTime > (this.config.timeoutMs ?? 30000)) {
          clearInterval(checkInterval);
          proposal.status = 'expired';
          resolve(this.createResult(proposal, Date.now() - startTime));
        }
      }, 10);
    });
  }

  // ===== MESSAGE HANDLERS =====

  async handlePrePrepare(message: ByzantineMessage): Promise<void> {
    // Validate message
    if (message.viewNumber !== this.node.viewNumber) {
      return;
    }

    // Accept pre-prepare from primary
    const proposalId = `bft_${message.viewNumber}_${message.sequenceNumber}`;

    if (!this.proposals.has(proposalId) && message.payload !== undefined) {
      const proposal: ConsensusProposal = {
        id: proposalId,
        proposerId: message.senderId,
        value: message.payload,
        term: message.viewNumber,
        timestamp: message.timestamp,
        votes: new Map(),
        status: 'pending',
      };
      this.proposals.set(proposalId, proposal);
    }

    // Send prepare message
    const prepareMsg: ByzantineMessage = {
      type: 'prepare',
      viewNumber: message.viewNumber,
      sequenceNumber: message.sequenceNumber,
      digest: message.digest,
      senderId: this.node.id,
      timestamp: new Date(),
    };

    await this.broadcastMessage(prepareMsg);
    await this.handlePrepare(prepareMsg);
  }

  async handlePrepare(message: ByzantineMessage): Promise<void> {
    const key = `${message.viewNumber}_${message.sequenceNumber}`;

    if (!this.messageLog.has(key)) {
      this.messageLog.set(key, []);
    }

    const messages = this.messageLog.get(key)!;
    const hasPrepare = messages.some(
      m => m.type === 'prepare' && m.senderId === message.senderId
    );

    if (!hasPrepare) {
      messages.push(message);
    }

    // Check if prepared (2f + 1 prepare messages)
    const f = this.config.maxFaultyNodes ?? 1;
    const prepareCount = messages.filter(m => m.type === 'prepare').length;

    if (prepareCount >= 2 * f + 1) {
      const proposalId = `bft_${message.viewNumber}_${message.sequenceNumber}`;
      this.node.preparedMessages.set(key, messages);

      // Send commit message
      const commitMsg: ByzantineMessage = {
        type: 'commit',
        viewNumber: message.viewNumber,
        sequenceNumber: message.sequenceNumber,
        digest: message.digest,
        senderId: this.node.id,
        timestamp: new Date(),
      };

      await this.broadcastMessage(commitMsg);
      await this.handleCommit(commitMsg);

      // Record vote
      const proposal = this.proposals.get(proposalId);
      if (proposal) {
        proposal.votes.set(this.node.id, {
          voterId: this.node.id,
          approve: true,
          confidence: 1.0,
          timestamp: new Date(),
        });
      }
    }
  }

  async handleCommit(message: ByzantineMessage): Promise<void> {
    const key = `${message.viewNumber}_${message.sequenceNumber}`;

    if (!this.messageLog.has(key)) {
      this.messageLog.set(key, []);
    }

    const messages = this.messageLog.get(key)!;
    const hasCommit = messages.some(
      m => m.type === 'commit' && m.senderId === message.senderId
    );

    if (!hasCommit) {
      messages.push(message);
    }

    // Check if committed (2f + 1 commit messages)
    const f = this.config.maxFaultyNodes ?? 1;
    const commitCount = messages.filter(m => m.type === 'commit').length;

    if (commitCount >= 2 * f + 1) {
      const proposalId = `bft_${message.viewNumber}_${message.sequenceNumber}`;
      this.node.committedMessages.set(key, messages);

      const proposal = this.proposals.get(proposalId);
      if (proposal && proposal.status === 'pending') {
        proposal.status = 'accepted';
        this.emit('consensus.achieved', { proposalId, approved: true });
      }
    }
  }

  // ===== VIEW CHANGE =====

  async initiateViewChange(): Promise<void> {
    this.node.viewNumber++;

    this.emit('view.changing', { newViewNumber: this.node.viewNumber });

    // Elect new primary
    this.electPrimary();

    this.emit('view.changed', { viewNumber: this.node.viewNumber });
  }

  // ===== PRIVATE METHODS =====

  private async broadcastMessage(message: ByzantineMessage): Promise<void> {
    this.emit('message.broadcast', { message });

    // Broadcast to all registered nodes
    for (const node of this.nodes.values()) {
      this.emit('message.sent', { to: node.id, message });
    }
  }

  private computeDigest(value: unknown): string {
    // Simple hash for demonstration
    const str = JSON.stringify(value);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private createResult(proposal: ConsensusProposal, durationMs: number): ConsensusResult {
    const n = this.nodes.size + 1;
    const approvingVotes = Array.from(proposal.votes.values()).filter(
      v => v.approve
    ).length;

    return {
      proposalId: proposal.id,
      approved: proposal.status === 'accepted',
      approvalRate: proposal.votes.size > 0
        ? approvingVotes / proposal.votes.size
        : 0,
      participationRate: proposal.votes.size / n,
      finalValue: proposal.value,
      rounds: 3, // pre-prepare, prepare, commit
      durationMs,
    };
  }

  // ===== STATE QUERIES =====

  isPrimary(): boolean {
    return this.node.isPrimary;
  }

  getViewNumber(): number {
    return this.node.viewNumber;
  }

  getSequenceNumber(): number {
    return this.node.sequenceNumber;
  }

  getPreparedCount(): number {
    return this.node.preparedMessages.size;
  }

  getCommittedCount(): number {
    return this.node.committedMessages.size;
  }

  getMaxFaultyNodes(): number {
    const n = this.nodes.size + 1;
    return Math.floor((n - 1) / 3);
  }

  canTolerate(faultyCount: number): boolean {
    return faultyCount <= this.getMaxFaultyNodes();
  }
}

export function createByzantineConsensus(
  nodeId: string,
  config?: ByzantineConfig
): ByzantineConsensus {
  return new ByzantineConsensus(nodeId, config);
}
