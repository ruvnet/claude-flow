/**
 * V3 Raft Consensus Implementation
 * Leader election and log replication for distributed coordination
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

export type RaftState = 'follower' | 'candidate' | 'leader';

export interface RaftNode {
  id: string;
  state: RaftState;
  currentTerm: number;
  votedFor?: string;
  log: RaftLogEntry[];
  commitIndex: number;
  lastApplied: number;
}

export interface RaftLogEntry {
  term: number;
  index: number;
  command: unknown;
  timestamp: Date;
}

export interface RaftConfig extends Partial<ConsensusConfig> {
  electionTimeoutMinMs?: number;
  electionTimeoutMaxMs?: number;
  heartbeatIntervalMs?: number;
  /**
   * ADR-095 G2 — optional pluggable transport. When set, RequestVote and
   * AppendEntries RPCs go over it (request-response) and this node also
   * answers inbound RequestVote / AppendEntries from peers using proper
   * Raft receiver rules (term comparison, vote-once-per-term, log-up-to-date
   * check). When unset, behavior is unchanged: the legacy in-process path
   * mutates the local `peers` map directly (single-process).
   */
  transport?: ConsensusTransport;
}

export class RaftConsensus extends EventEmitter {
  private config: RaftConfig;
  private node: RaftNode;
  private peers: Map<string, RaftNode> = new Map();
  private proposals: Map<string, ConsensusProposal> = new Map();
  private electionTimeout?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private proposalCounter: number = 0;
  private readonly transport?: ConsensusTransport;

  constructor(nodeId: string, config: RaftConfig = {}) {
    super();
    this.config = {
      threshold: config.threshold ?? SWARM_CONSTANTS.DEFAULT_CONSENSUS_THRESHOLD,
      timeoutMs: config.timeoutMs ?? SWARM_CONSTANTS.DEFAULT_CONSENSUS_TIMEOUT_MS,
      maxRounds: config.maxRounds ?? 10,
      requireQuorum: config.requireQuorum ?? true,
      electionTimeoutMinMs: config.electionTimeoutMinMs ?? 150,
      electionTimeoutMaxMs: config.electionTimeoutMaxMs ?? 300,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 50,
      transport: config.transport,
    };
    this.transport = config.transport;

    this.node = {
      id: nodeId,
      state: 'follower',
      currentTerm: 0,
      log: [],
      commitIndex: 0,
      lastApplied: 0,
    };

    if (this.transport) {
      this.transport.onMessage(async (msg: ConsensusMessage) => this.handleInboundRaftMessage(msg));
    }
  }

  /** Index/term of the last entry in this node's log (Raft "up-to-date" comparison). */
  private lastLogInfo(): { index: number; term: number } {
    const last = this.node.log[this.node.log.length - 1];
    return last ? { index: last.index, term: last.term } : { index: 0, term: 0 };
  }

  /**
   * ADR-095 G2 — Raft receiver. Answers inbound RequestVote / AppendEntries
   * with proper Raft rules. Returns the RPC response the transport relays
   * back to the caller (the transport's `send` resolves with it).
   */
  private async handleInboundRaftMessage(msg: ConsensusMessage): Promise<ConsensusMessage | void> {
    const p = (msg.payload ?? {}) as Record<string, unknown>;
    const term = typeof p.term === 'number' ? p.term : 0;

    // §5.1 — any RPC with a higher term makes us a follower and adopts it.
    if (term > this.node.currentTerm) {
      this.node.currentTerm = term;
      this.node.votedFor = undefined;
      this.node.state = 'follower';
    }

    if (msg.type === 'request-vote') {
      const candidateId = String(p.candidateId ?? msg.from);
      const candLastIndex = typeof p.lastLogIndex === 'number' ? p.lastLogIndex : 0;
      const candLastTerm = typeof p.lastLogTerm === 'number' ? p.lastLogTerm : 0;
      const my = this.lastLogInfo();
      const logOk = candLastTerm > my.term || (candLastTerm === my.term && candLastIndex >= my.index);
      const termOk = term >= this.node.currentTerm;
      const notVotedOrSame = this.node.votedFor === undefined || this.node.votedFor === candidateId;
      const granted = termOk && notVotedOrSame && logOk;
      if (granted) {
        this.node.votedFor = candidateId;
        this.resetElectionTimeout();
      }
      return { type: 'vote-response', from: this.node.id, to: msg.from, payload: { term: this.node.currentTerm, granted }, term: this.node.currentTerm };
    }

    if (msg.type === 'append-entries') {
      // §5.2/5.3 — reject if leader's term is stale.
      if (term < this.node.currentTerm) {
        return { type: 'append-entries-response', from: this.node.id, to: msg.from, payload: { term: this.node.currentTerm, success: false }, term: this.node.currentTerm };
      }
      // Valid leader heartbeat/append → become/stay follower, reset election timer.
      this.node.state = 'follower';
      this.resetElectionTimeout();
      const entries = Array.isArray(p.entries) ? (p.entries as RaftLogEntry[]) : [];
      // (Simplified log matching: append entries not already present by index.
      // Full prevLogIndex/prevLogTerm conflict resolution is the next refinement.)
      for (const e of entries) {
        if (!this.node.log.some(x => x.index === e.index)) this.node.log.push(e);
      }
      const leaderCommit = typeof p.leaderCommit === 'number' ? p.leaderCommit : this.node.commitIndex;
      if (leaderCommit > this.node.commitIndex) {
        this.node.commitIndex = Math.min(leaderCommit, this.lastLogInfo().index);
      }
      return { type: 'append-entries-response', from: this.node.id, to: msg.from, payload: { term: this.node.currentTerm, success: true }, term: this.node.currentTerm };
    }
    return;
  }

  async initialize(): Promise<void> {
    this.resetElectionTimeout();
    this.emit('initialized', { nodeId: this.node.id });
  }

  async shutdown(): Promise<void> {
    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout);
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.emit('shutdown');
  }

  addPeer(peerId: string): void {
    this.peers.set(peerId, {
      id: peerId,
      state: 'follower',
      currentTerm: 0,
      log: [],
      commitIndex: 0,
      lastApplied: 0,
    });
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  async propose(
    value: unknown,
    weights?: Map<string, number>
  ): Promise<ConsensusProposal> {
    if (this.node.state !== 'leader') {
      throw new Error('Only leader can propose values');
    }

    this.proposalCounter++;
    const proposalId = `raft_${this.node.id}_${this.proposalCounter}`;

    const proposal: ConsensusProposal = {
      id: proposalId,
      proposerId: this.node.id,
      value,
      term: this.node.currentTerm,
      timestamp: new Date(),
      votes: new Map(),
      status: 'pending',
      weights,
    };

    // Add to local log
    const logEntry: RaftLogEntry = {
      term: this.node.currentTerm,
      index: this.node.log.length + 1,
      command: { proposalId, value },
      timestamp: new Date(),
    };
    this.node.log.push(logEntry);

    this.proposals.set(proposalId, proposal);

    // Leader votes for itself
    proposal.votes.set(this.node.id, {
      voterId: this.node.id,
      approve: true,
      confidence: 1.0,
      timestamp: new Date(),
    });

    // Replicate to followers
    await this.replicateToFollowers(logEntry);

    return proposal;
  }

  async vote(proposalId: string, vote: ConsensusVote): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== 'pending') {
      return;
    }

    proposal.votes.set(vote.voterId, vote);

    // Check if we have consensus
    await this.checkConsensus(proposalId);
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

  getState(): RaftState {
    return this.node.state;
  }

  getTerm(): number {
    return this.node.currentTerm;
  }

  isLeader(): boolean {
    return this.node.state === 'leader';
  }

  getLeaderId(): string | undefined {
    if (this.node.state === 'leader') {
      return this.node.id;
    }
    return this.node.votedFor;
  }

  // ===== PRIVATE METHODS =====

  private resetElectionTimeout(): void {
    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout);
    }

    const timeout = this.randomElectionTimeout();
    this.electionTimeout = setTimeout(() => {
      this.startElection();
    }, timeout);
  }

  private randomElectionTimeout(): number {
    const min = this.config.electionTimeoutMinMs ?? 150;
    const max = this.config.electionTimeoutMaxMs ?? 300;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private async startElection(): Promise<void> {
    this.node.state = 'candidate';
    this.node.currentTerm++;
    this.node.votedFor = this.node.id;

    this.emit('election.started', {
      term: this.node.currentTerm,
      candidateId: this.node.id
    });

    // Vote for self
    let votesReceived = 1;
    const votesNeeded = Math.floor((this.peers.size + 1) / 2) + 1;

    // Request votes from peers
    for (const [peerId, peer] of this.peers) {
      const granted = await this.requestVote(peerId);
      if (granted) {
        votesReceived++;
      }

      if (votesReceived >= votesNeeded) {
        this.becomeLeader();
        return;
      }
    }

    // Election failed, reset to follower
    this.node.state = 'follower';
    this.resetElectionTimeout();
  }

  private async requestVote(peerId: string): Promise<boolean> {
    // ADR-095 G2 — over the transport when wired: real RequestVote RPC.
    if (this.transport) {
      const my = this.lastLogInfo();
      try {
        const reply = await this.transport.send(peerId, {
          type: 'request-vote',
          payload: { term: this.node.currentTerm, candidateId: this.node.id, lastLogIndex: my.index, lastLogTerm: my.term },
          term: this.node.currentTerm,
        });
        const rp = (reply?.payload ?? {}) as Record<string, unknown>;
        // §5.1 — if the responder's term is higher, step down.
        if (typeof rp.term === 'number' && rp.term > this.node.currentTerm) {
          this.node.currentTerm = rp.term;
          this.node.votedFor = undefined;
          this.node.state = 'follower';
          return false;
        }
        return rp.granted === true;
      } catch {
        return false; // unreachable peer / timeout — counts as no vote.
      }
    }

    // Legacy in-process path — mutates the local fake peer state.
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    if (this.node.currentTerm > peer.currentTerm) {
      peer.votedFor = this.node.id;
      peer.currentTerm = this.node.currentTerm;
      return true;
    }
    return false;
  }

  private becomeLeader(): void {
    this.node.state = 'leader';

    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout);
    }

    // Start sending heartbeats
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeats();
    }, this.config.heartbeatIntervalMs ?? 50);

    this.emit('leader.elected', {
      term: this.node.currentTerm,
      leaderId: this.node.id
    });
  }

  private async sendHeartbeats(): Promise<void> {
    for (const [peerId, peer] of this.peers) {
      await this.appendEntries(peerId, []);
    }
  }

  private async appendEntries(peerId: string, entries: RaftLogEntry[]): Promise<boolean> {
    // ADR-095 G2 — over the transport when wired: real AppendEntries RPC.
    if (this.transport) {
      try {
        const reply = await this.transport.send(peerId, {
          type: 'append-entries',
          payload: { term: this.node.currentTerm, leaderId: this.node.id, entries, leaderCommit: this.node.commitIndex },
          term: this.node.currentTerm,
        });
        const rp = (reply?.payload ?? {}) as Record<string, unknown>;
        if (typeof rp.term === 'number' && rp.term > this.node.currentTerm) {
          this.node.currentTerm = rp.term;
          this.node.votedFor = undefined;
          this.node.state = 'follower';
          if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = undefined; }
          return false;
        }
        return rp.success === true;
      } catch {
        return false; // unreachable peer / timeout.
      }
    }

    // Legacy in-process path.
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    if (this.node.currentTerm >= peer.currentTerm) {
      peer.currentTerm = this.node.currentTerm;
      peer.state = 'follower';
      peer.log.push(...entries);
      return true;
    }
    return false;
  }

  private async replicateToFollowers(entry: RaftLogEntry): Promise<void> {
    const replicationPromises = Array.from(this.peers.keys()).map(
      peerId => this.appendEntries(peerId, [entry])
    );

    const results = await Promise.allSettled(replicationPromises);
    const successCount = results.filter(
      r => r.status === 'fulfilled' && r.value
    ).length;

    // Check if majority replicated
    const majority = Math.floor((this.peers.size + 1) / 2) + 1;
    if (successCount + 1 >= majority) {
      this.node.commitIndex = entry.index;
      this.emit('log.committed', { index: entry.index });
    }
  }

  // Dream Cycle 2026-08-24 (swarm): per-voter weight for weighted consensus.
  // Clamped to [0,1] — a vote can never count for *more* than one unweighted
  // vote, so the raft safety margin (quorum computed from totalVoters) can
  // only get harder to satisfy under weighting, never easier/bypassable via
  // an oversized weight. Missing weights/voter defaults to 1 (flat vote),
  // reproducing today's behavior exactly when no weights map is supplied.
  private voteWeight(proposal: ConsensusProposal, voterId: string): number {
    const w = proposal.weights?.get(voterId) ?? 1;
    return Math.max(0, Math.min(1, w));
  }

  private async checkConsensus(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return;
    }

    const totalVoters = this.peers.size + 1;
    const castVotes = Array.from(proposal.votes.values());
    const approvingWeight = castVotes
      .filter(v => v.approve)
      .reduce((sum, v) => sum + this.voteWeight(proposal, v.voterId), 0);
    const totalCastWeight = castVotes.reduce(
      (sum, v) => sum + this.voteWeight(proposal, v.voterId),
      0
    );

    const threshold = this.config.threshold ?? 0.66;
    const quorum = Math.floor(totalVoters * threshold);

    if (approvingWeight >= quorum) {
      proposal.status = 'accepted';
      this.emit('consensus.achieved', { proposalId, approved: true });
    } else if (totalCastWeight - approvingWeight > totalVoters - quorum) {
      proposal.status = 'rejected';
      this.emit('consensus.achieved', { proposalId, approved: false });
    }
  }

  private createResult(proposal: ConsensusProposal, durationMs: number): ConsensusResult {
    const totalVoters = this.peers.size + 1;
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
      participationRate: proposal.votes.size / totalVoters,
      finalValue: proposal.value,
      rounds: 1,
      durationMs,
    };
  }

  // Handle vote request from another candidate
  handleVoteRequest(
    candidateId: string,
    term: number,
    lastLogIndex: number,
    lastLogTerm: number
  ): boolean {
    if (term < this.node.currentTerm) {
      return false;
    }

    if (term > this.node.currentTerm) {
      this.node.currentTerm = term;
      this.node.state = 'follower';
      this.node.votedFor = undefined;
    }

    if (this.node.votedFor === undefined || this.node.votedFor === candidateId) {
      // Check log is at least as up-to-date
      const lastEntry = this.node.log[this.node.log.length - 1];
      const myLastTerm = lastEntry?.term ?? 0;
      const myLastIndex = lastEntry?.index ?? 0;

      if (lastLogTerm > myLastTerm ||
          (lastLogTerm === myLastTerm && lastLogIndex >= myLastIndex)) {
        this.node.votedFor = candidateId;
        this.resetElectionTimeout();
        return true;
      }
    }

    return false;
  }

  // Handle append entries from leader
  handleAppendEntries(
    leaderId: string,
    term: number,
    entries: RaftLogEntry[],
    leaderCommit: number
  ): boolean {
    if (term < this.node.currentTerm) {
      return false;
    }

    this.resetElectionTimeout();

    if (term > this.node.currentTerm) {
      this.node.currentTerm = term;
      this.node.state = 'follower';
    }

    this.node.votedFor = leaderId;

    // Append entries
    this.node.log.push(...entries);

    // Update commit index
    if (leaderCommit > this.node.commitIndex) {
      this.node.commitIndex = Math.min(
        leaderCommit,
        this.node.log.length
      );
    }

    return true;
  }
}

export function createRaftConsensus(nodeId: string, config?: RaftConfig): RaftConsensus {
  return new RaftConsensus(nodeId, config);
}
