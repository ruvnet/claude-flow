/**
 * V3 Raft Consensus Implementation
 * Leader election and log replication for distributed coordination
 */

import { EventEmitter } from 'events';
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
}

export class RaftConsensus extends EventEmitter {
  private config: RaftConfig;
  private node: RaftNode;
  private peers: Map<string, RaftNode> = new Map();
  private proposals: Map<string, ConsensusProposal> = new Map();
  private electionTimeout?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private proposalCounter: number = 0;

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
    };

    this.node = {
      id: nodeId,
      state: 'follower',
      currentTerm: 0,
      log: [],
      commitIndex: 0,
      lastApplied: 0,
    };
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

  async propose(value: unknown): Promise<ConsensusProposal> {
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
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    // Local vote request - uses in-process peer state
    // Grant vote if candidate's term is higher
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
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    // AppendEntries - local peer state update
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

  private async checkConsensus(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return;
    }

    const totalVoters = this.peers.size + 1;
    const votesReceived = proposal.votes.size;
    const approvingVotes = Array.from(proposal.votes.values()).filter(
      v => v.approve
    ).length;

    const threshold = this.config.threshold ?? 0.66;
    const quorum = Math.floor(totalVoters * threshold);

    if (approvingVotes >= quorum) {
      proposal.status = 'accepted';
      this.emit('consensus.achieved', { proposalId, approved: true });
    } else if (votesReceived - approvingVotes > totalVoters - quorum) {
      proposal.status = 'rejected';
      this.emit('consensus.achieved', { proposalId, approved: false });
    }
  }

  private createResult(proposal: ConsensusProposal, durationMs: number): ConsensusResult {
    const totalVoters = this.peers.size + 1;
    const approvingVotes = Array.from(proposal.votes.values()).filter(
      v => v.approve
    ).length;

    return {
      proposalId: proposal.id,
      approved: proposal.status === 'accepted',
      approvalRate: proposal.votes.size > 0
        ? approvingVotes / proposal.votes.size
        : 0,
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
