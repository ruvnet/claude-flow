/**
 * V3 Byzantine Fault Tolerant Consensus
 * PBFT-style consensus for handling malicious or faulty nodes
 */

import { EventEmitter } from 'events';
import { createHash } from 'node:crypto';
import {
  ConsensusProposal,
  ConsensusVote,
  ConsensusResult,
  ConsensusConfig,
  SWARM_CONSTANTS,
} from '../types.js';
import type { ConsensusTransport, ConsensusMessage } from './transport.js';

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
  /**
   * ADR-095 G2 — optional pluggable transport. When set, PBFT messages
   * (pre-prepare/prepare/commit) go over it (and are signed if the
   * transport has a keypair) instead of being `emit`ted into the void.
   * When unset, behavior is unchanged: messages are emitted as
   * `message.broadcast` / `message.sent` events for an external wiring
   * layer to relay (the legacy single-process path).
   */
  transport?: ConsensusTransport;
}

export class ByzantineConsensus extends EventEmitter {
  private config: ByzantineConfig;
  private node: ByzantineNode;
  private nodes: Map<string, ByzantineNode> = new Map();
  private proposals: Map<string, ConsensusProposal> = new Map();
  private messageLog: Map<string, ByzantineMessage[]> = new Map();
  private proposalCounter: number = 0;
  private viewChangeTimeout?: NodeJS.Timeout;
  private readonly transport?: ConsensusTransport;

  constructor(nodeId: string, config: ByzantineConfig = {}) {
    super();
    this.config = {
      threshold: config.threshold ?? SWARM_CONSTANTS.DEFAULT_CONSENSUS_THRESHOLD,
      timeoutMs: config.timeoutMs ?? SWARM_CONSTANTS.DEFAULT_CONSENSUS_TIMEOUT_MS,
      maxRounds: config.maxRounds ?? 10,
      requireQuorum: config.requireQuorum ?? true,
      maxFaultyNodes: config.maxFaultyNodes, // #G2: undefined → byzantineF() derives from cluster size; a value caps it
      viewChangeTimeoutMs: config.viewChangeTimeoutMs ?? 5000,
      transport: config.transport,
    };
    this.transport = config.transport;

    this.node = {
      id: nodeId,
      isPrimary: false,
      viewNumber: 0,
      sequenceNumber: 0,
      preparedMessages: new Map(),
      committedMessages: new Map(),
    };

    // ADR-095 G2 — when a transport is wired, route inbound PBFT messages
    // through the protocol handlers. The transport handles signature
    // verification (if signing is enabled) before we ever see the message.
    if (this.transport) {
      this.transport.onMessage(async (msg: ConsensusMessage) => {
        await this.handleInboundMessage(msg);
      });
    }
  }

  /**
   * ADR-095 G2 — dispatch an inbound transport message to the right PBFT
   * handler. The transport has already verified the signature (if signing
   * is on); here we only need to demux by type and reconstruct the
   * ByzantineMessage shape the handlers expect.
   */
  private async handleInboundMessage(msg: ConsensusMessage): Promise<void> {
    const p = msg.payload as Partial<ByzantineMessage> | undefined;
    if (!p || typeof p.viewNumber !== 'number' || typeof p.sequenceNumber !== 'number' || typeof p.digest !== 'string') return;
    const bm: ByzantineMessage = {
      type: (msg.type as ByzantinePhase) ?? p.type ?? 'prepare',
      viewNumber: p.viewNumber,
      sequenceNumber: p.sequenceNumber,
      digest: p.digest,
      senderId: msg.from,
      timestamp: p.timestamp ? new Date(p.timestamp as unknown as string) : new Date(),
      payload: p.payload,
      signature: msg.signature,
    };
    switch (bm.type) {
      case 'pre-prepare': await this.handlePrePrepare(bm); break;
      case 'prepare': await this.handlePrepare(bm); break;
      case 'commit': await this.handleCommit(bm); break;
      default: break;
    }
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

  /**
   * ADR-095 G2 — BFT fault tolerance f, derived from the *actual* cluster
   * size unless explicitly capped via config.maxFaultyNodes. PBFT needs
   * n ≥ 3f+1, so f = floor((n-1)/3) where n = self + known peers. The
   * config value (if set) acts as an upper bound — never exceed what the
   * operator declared the cluster can tolerate.
   */
  private byzantineF(): number {
    const n = this.nodes.size + 1; // self + known peers
    const derived = Math.max(1, Math.floor((n - 1) / 3));
    const cap = this.config.maxFaultyNodes;
    return cap === undefined ? derived : Math.min(derived, cap);
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

  async propose(
    value: unknown,
    weights?: Map<string, number>
  ): Promise<ConsensusProposal> {
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
      weights,
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

  // Dream Cycle 2026-08-24 (swarm): per-voter weight for weighted consensus,
  // clamped to [0,1]. The clamp is a hard safety invariant, not a style
  // choice: byzantine.ts's f-faulty-node quorum (2f+1) assumes each vote
  // contributes at most one unit — an unclamped weight >1 would let a
  // single high-weight node satisfy quorum alone, defeating the BFT
  // guarantee. Missing weights/voter defaults to 1 (flat vote), reproducing
  // today's behavior exactly when no weights map is supplied.
  private voteWeight(proposal: ConsensusProposal, voterId: string): number {
    const w = proposal.weights?.get(voterId) ?? 1;
    return Math.max(0, Math.min(1, w));
  }

  async vote(proposalId: string, vote: ConsensusVote): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return;
    }

    proposal.votes.set(vote.voterId, vote);

    // Check consensus
    const f = this.byzantineF();
    const n = this.nodes.size + 1;
    const requiredVotes = 2 * f + 1;

    const castVotes = Array.from(proposal.votes.values());
    const approvingWeight = castVotes
      .filter(v => v.approve)
      .reduce((sum, v) => sum + this.voteWeight(proposal, v.voterId), 0);

    if (approvingWeight >= requiredVotes) {
      proposal.status = 'accepted';
      this.emit('consensus.achieved', { proposalId, approved: true });
    } else if (proposal.votes.size >= n && approvingWeight < requiredVotes) {
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
    const f = this.byzantineF();
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

  // KNOWN LIMITATION (pre-existing, not fixed here, flagged by adversarial
  // review during dream-cycle 2026-08-24): this PBFT protocol-message commit
  // quorum is a second, fully separate acceptance path from vote()'s
  // weighted tally below — it accepts on raw commit-message count (2f+1),
  // with no concept of per-voter weight. Currently unreachable in this
  // package's unit tests (no transport wired), but a deployment that wires
  // real multi-node PBFT transport traffic would bypass weighted consensus
  // entirely via this path. "Weighted Byzantine consensus" governs the
  // vote() API only, not the underlying commit-message protocol.
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
    const f = this.byzantineF();
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
    // Always emit for observability / legacy external relay.
    this.emit('message.broadcast', { message });
    for (const node of this.nodes.values()) {
      this.emit('message.sent', { to: node.id, message });
    }

    // ADR-095 G2 — when a transport is wired, actually send the message
    // over it (signed by the transport if signing is enabled). This is
    // the real inter-node path; the emits above stay for observers.
    if (this.transport) {
      const cm: Omit<ConsensusMessage, 'from'> = {
        type: message.type,
        payload: {
          type: message.type,
          viewNumber: message.viewNumber,
          sequenceNumber: message.sequenceNumber,
          digest: message.digest,
          timestamp: message.timestamp.toISOString(),
          payload: message.payload,
        },
        viewNumber: message.viewNumber,
      };
      try {
        await this.transport.broadcast(cm);
      } catch {
        // Transport failures are non-fatal at the protocol layer — the
        // proposal will simply not reach consensus and time out, which is
        // the correct failure mode (no liveness, but no incorrect commit).
      }
    }
  }

  private computeDigest(value: unknown): string {
    // ADR-095 G2 — was a 32-bit string-hash "for demonstration"; replaced
    // with sha256 so digests are collision-resistant (PBFT relies on the
    // digest uniquely identifying the request being agreed on).
    return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
  }

  private createResult(proposal: ConsensusProposal, durationMs: number): ConsensusResult {
    const n = this.nodes.size + 1;
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
