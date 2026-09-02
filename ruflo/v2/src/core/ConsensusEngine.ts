/**
 * ConsensusEngine - Implements consensus algorithms for distributed decision making
 * Supports multiple consensus algorithms: Raft, Byzantine, Gossip, and Proof-of-Learning
 */

import { IDatabaseProvider, IConsensusAlgorithm, Decision, Vote, Consensus, Result, ConsensusType } from '../types/interfaces.js';
import { nanoid } from 'nanoid';

export class ConsensusEngine {
  private algorithms: Map<ConsensusType, IConsensusAlgorithm> = new Map();
  private currentAlgorithm: IConsensusAlgorithm | null = null;
  private pendingDecisions: Map<string, Decision> = new Map();
  private consensusHistory: Map<string, Consensus> = new Map();

  constructor(private database: IDatabaseProvider) {
    this.initializeAlgorithms();
  }

  /**
   * Initialize available consensus algorithms
   */
  private initializeAlgorithms(): void {
    this.algorithms.set('raft', new RaftConsensus(this.database));
    this.algorithms.set('byzantine', new ByzantineConsensus(this.database));
    this.algorithms.set('gossip', new GossipConsensus(this.database));
    this.algorithms.set('proof-of-learning', new ProofOfLearningConsensus(this.database));
  }

  /**
   * Set the active consensus algorithm
   */
  async setAlgorithm(type: ConsensusType): Promise<void> {
    const algorithm = this.algorithms.get(type);
    if (!algorithm) {
      throw new Error(`Unknown consensus algorithm: ${type}`);
    }

    this.currentAlgorithm = algorithm;
    await algorithm.initialize();

    await this.database.store('consensus-algorithm', type, 'system');
  }

  /**
   * Propose a decision for consensus
   */
  async propose(decision: Omit<Decision, 'id' | 'timestamp'>): Promise<string> {
    if (!this.currentAlgorithm) {
      throw new Error('No consensus algorithm selected');
    }

    const fullDecision: Decision = {
      ...decision,
      id: nanoid(),
      timestamp: new Date()
    };

    this.pendingDecisions.set(fullDecision.id, fullDecision);
    await this.database.store(`decision:${fullDecision.id}`, fullDecision, 'consensus');

    // Start consensus process
    const votes = await this.currentAlgorithm.propose(fullDecision);

    // Process votes and determine consensus
    const consensus = await this.processVotes(fullDecision, votes);

    return fullDecision.id;
  }

  /**
   * Process votes and determine consensus
   */
  private async processVotes(decision: Decision, votes: Vote[]): Promise<Consensus> {
    // Calculate consensus based on votes
    const positiveVotes = votes.filter(vote => vote.decision);
    const totalConfidence = votes.reduce((sum, vote) => sum + vote.confidence, 0);
    const averageConfidence = totalConfidence / votes.length;

    // Simple majority rule with confidence weighting
    const weightedPositive = positiveVotes.reduce((sum, vote) => sum + vote.confidence, 0);
    const totalWeight = votes.reduce((sum, vote) => sum + vote.confidence, 0);

    const outcome = weightedPositive > (totalWeight / 2) && averageConfidence > 0.6;

    const consensus: Consensus = {
      decisionId: decision.id,
      outcome,
      votes,
      confidence: averageConfidence,
      timestamp: new Date()
    };

    this.consensusHistory.set(decision.id, consensus);
    await this.database.store(`consensus:${decision.id}`, consensus, 'consensus');

    // Execute if consensus reached
    if (outcome) {
      await this.executeConsensus(consensus);
    }

    return consensus;
  }

  /**
   * Execute a consensus decision
   */
  private async executeConsensus(consensus: Consensus): Promise<Result> {
    if (!this.currentAlgorithm) {
      throw new Error('No consensus algorithm available for execution');
    }

    const result = await this.currentAlgorithm.execute(consensus);
    await this.database.store(`result:${consensus.decisionId}`, result, 'consensus');

    // Clean up pending decision
    this.pendingDecisions.delete(consensus.decisionId);

    return result;
  }

  /**
   * Get consensus status for a decision
   */
  async getConsensusStatus(decisionId: string): Promise<{
    decision: Decision | null;
    consensus: Consensus | null;
    status: 'pending' | 'reached' | 'failed';
  }> {
    const decision = this.pendingDecisions.get(decisionId) ||
      await this.database.retrieve(`decision:${decisionId}`, 'consensus');

    const consensus = this.consensusHistory.get(decisionId) ||
      await this.database.retrieve(`consensus:${decisionId}`, 'consensus');

    let status: 'pending' | 'reached' | 'failed' = 'pending';
    if (consensus) {
      status = consensus.outcome ? 'reached' : 'failed';
    }

    return { decision, consensus, status };
  }

  /**
   * Get all pending decisions
   */
  getPendingDecisions(): Decision[] {
    return Array.from(this.pendingDecisions.values());
  }

  /**
   * Get consensus history
   */
  getConsensusHistory(): Consensus[] {
    return Array.from(this.consensusHistory.values());
  }

  /**
   * Get current algorithm type
   */
  getCurrentAlgorithm(): ConsensusType | null {
    return this.currentAlgorithm?.getType() || null;
  }

  /**
   * Get available algorithms
   */
  getAvailableAlgorithms(): ConsensusType[] {
    return Array.from(this.algorithms.keys());
  }
}

/**
 * Raft Consensus Algorithm
 * Leader-based consensus with strong consistency
 */
class RaftConsensus implements IConsensusAlgorithm {
  private leaderId: string | null = null;
  private term: number = 0;
  private votedFor: string | null = null;

  constructor(private database: IDatabaseProvider) {}

  getType(): ConsensusType {
    return 'raft';
  }

  async initialize(): Promise<void> {
    // Load state from database
    const state = await this.database.retrieve('raft-state', 'consensus');
    if (state) {
      this.term = state.term || 0;
      this.leaderId = state.leaderId || null;
      this.votedFor = state.votedFor || null;
    }
  }

  async propose(decision: Decision): Promise<Vote[]> {
    // In Raft, only the leader can propose
    if (!this.leaderId) {
      await this.electLeader();
    }

    // Simulate distributed voting
    const votes: Vote[] = [];
    const agentIds = await this.getAgentIds();

    for (const agentId of agentIds) {
      const vote: Vote = {
        agentId,
        decision: Math.random() > 0.2, // 80% approval rate
        confidence: 0.8 + Math.random() * 0.2, // High confidence in Raft
        reasoning: `Raft consensus vote for decision ${decision.id}`
      };
      votes.push(vote);
    }

    return votes;
  }

  async execute(consensus: Consensus): Promise<Result> {
    if (!consensus.outcome) {
      return {
        success: false,
        error: 'Consensus was not reached'
      };
    }

    // Execute the decision through the leader
    return {
      success: true,
      data: {
        algorithm: 'raft',
        leader: this.leaderId,
        term: this.term,
        executedAt: new Date().toISOString()
      },
      metadata: {
        consensusId: consensus.decisionId,
        votes: consensus.votes.length
      }
    };
  }

  private async electLeader(): Promise<void> {
    this.term++;
    const agentIds = await this.getAgentIds();
    this.leaderId = agentIds[0] || 'default-leader';
    this.votedFor = this.leaderId;

    await this.database.store('raft-state', {
      term: this.term,
      leaderId: this.leaderId,
      votedFor: this.votedFor
    }, 'consensus');
  }

  private async getAgentIds(): Promise<string[]> {
    try {
      const agentKeys = await this.database.list('agents');
      return agentKeys.map(key => key.replace('agent:', ''));
    } catch {
      return ['agent-1', 'agent-2', 'agent-3']; // Default agents
    }
  }
}

/**
 * Byzantine Fault Tolerant Consensus
 * Handles up to 1/3 malicious agents
 */
class ByzantineConsensus implements IConsensusAlgorithm {
  constructor(private database: IDatabaseProvider) {}

  getType(): ConsensusType {
    return 'byzantine';
  }

  async initialize(): Promise<void> {
    // Byzantine consensus initialization
  }

  async propose(decision: Decision): Promise<Vote[]> {
    const votes: Vote[] = [];
    const agentIds = await this.getAgentIds();

    // Simulate Byzantine environment with some malicious agents
    for (const agentId of agentIds) {
      const isMalicious = Math.random() < 0.2; // 20% malicious agents
      const vote: Vote = {
        agentId,
        decision: isMalicious ? Math.random() < 0.3 : Math.random() > 0.3, // Malicious agents vote randomly
        confidence: isMalicious ? Math.random() * 0.5 : 0.7 + Math.random() * 0.3,
        reasoning: `Byzantine consensus vote (${isMalicious ? 'malicious' : 'honest'})`
      };
      votes.push(vote);
    }

    return votes;
  }

  async execute(consensus: Consensus): Promise<Result> {
    // Byzantine consensus requires 2/3 + 1 majority
    const honestVotes = consensus.votes.filter(vote => vote.confidence > 0.6);
    const required = Math.floor(consensus.votes.length * 2 / 3) + 1;

    if (honestVotes.length >= required && consensus.outcome) {
      return {
        success: true,
        data: {
          algorithm: 'byzantine',
          honestVotes: honestVotes.length,
          totalVotes: consensus.votes.length,
          executedAt: new Date().toISOString()
        }
      };
    }

    return {
      success: false,
      error: 'Byzantine consensus failed - insufficient honest votes'
    };
  }

  private async getAgentIds(): Promise<string[]> {
    try {
      const agentKeys = await this.database.list('agents');
      return agentKeys.map(key => key.replace('agent:', ''));
    } catch {
      return ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'];
    }
  }
}

/**
 * Gossip Protocol Consensus
 * Eventually consistent through peer-to-peer communication
 */
class GossipConsensus implements IConsensusAlgorithm {
  constructor(private database: IDatabaseProvider) {}

  getType(): ConsensusType {
    return 'gossip';
  }

  async initialize(): Promise<void> {
    // Gossip protocol initialization
  }

  async propose(decision: Decision): Promise<Vote[]> {
    const votes: Vote[] = [];
    const agentIds = await this.getAgentIds();

    // Simulate gossip propagation delays and eventual consistency
    for (const agentId of agentIds) {
      const delay = Math.random() * 1000; // Random delay
      const informed = Math.random() > 0.1; // 90% eventually receive the message

      if (informed) {
        const vote: Vote = {
          agentId,
          decision: Math.random() > 0.25, // 75% approval
          confidence: 0.6 + Math.random() * 0.3,
          reasoning: `Gossip consensus vote (delay: ${Math.round(delay)}ms)`
        };
        votes.push(vote);
      }
    }

    return votes;
  }

  async execute(consensus: Consensus): Promise<Result> {
    // Gossip consensus is eventually consistent
    const participation = consensus.votes.length / (await this.getAgentIds()).length;

    if (consensus.outcome && participation > 0.7) {
      return {
        success: true,
        data: {
          algorithm: 'gossip',
          participation: participation,
          convergenceTime: Math.random() * 5000 + 1000,
          executedAt: new Date().toISOString()
        }
      };
    }

    return {
      success: false,
      error: 'Gossip consensus failed - insufficient participation or negative outcome'
    };
  }

  private async getAgentIds(): Promise<string[]> {
    try {
      const agentKeys = await this.database.list('agents');
      return agentKeys.map(key => key.replace('agent:', ''));
    } catch {
      return Array.from({ length: 8 }, (_, i) => `agent-${i + 1}`);
    }
  }
}

/**
 * Proof of Learning Consensus
 * Consensus based on agent learning and performance
 */
class ProofOfLearningConsensus implements IConsensusAlgorithm {
  constructor(private database: IDatabaseProvider) {}

  getType(): ConsensusType {
    return 'proof-of-learning';
  }

  async initialize(): Promise<void> {
    // Proof of Learning initialization
  }

  async propose(decision: Decision): Promise<Vote[]> {
    const votes: Vote[] = [];
    const agentIds = await this.getAgentIds();

    for (const agentId of agentIds) {
      // Get agent performance for voting weight
      const performance = await this.getAgentPerformance(agentId);
      const learningScore = this.calculateLearningScore(performance);

      const vote: Vote = {
        agentId,
        decision: learningScore > 0.5 ? Math.random() > 0.2 : Math.random() > 0.6,
        confidence: learningScore,
        reasoning: `Proof of Learning vote (learning score: ${learningScore.toFixed(2)})`
      };
      votes.push(vote);
    }

    return votes;
  }

  async execute(consensus: Consensus): Promise<Result> {
    // Weight votes by learning scores
    const weightedVotes = consensus.votes.reduce((sum, vote) => {
      return sum + (vote.decision ? vote.confidence : -vote.confidence);
    }, 0);

    const totalWeight = consensus.votes.reduce((sum, vote) => sum + vote.confidence, 0);
    const weightedOutcome = weightedVotes > 0 && (weightedVotes / totalWeight) > 0.6;

    if (weightedOutcome) {
      return {
        success: true,
        data: {
          algorithm: 'proof-of-learning',
          weightedScore: weightedVotes / totalWeight,
          highPerformers: consensus.votes.filter(v => v.confidence > 0.8).length,
          executedAt: new Date().toISOString()
        }
      };
    }

    return {
      success: false,
      error: 'Proof of Learning consensus failed - insufficient weighted support'
    };
  }

  private async getAgentPerformance(agentId: string): Promise<any> {
    try {
      const agent = await this.database.retrieve(agentId, 'agents');
      return agent?.performance || { successRate: 0.5, tasksCompleted: 0 };
    } catch {
      return { successRate: 0.5, tasksCompleted: 0 };
    }
  }

  private calculateLearningScore(performance: any): number {
    // Combine success rate and experience
    const successWeight = 0.7;
    const experienceWeight = 0.3;

    const successScore = performance.successRate || 0.5;
    const experienceScore = Math.min(1.0, (performance.tasksCompleted || 0) / 100);

    return successScore * successWeight + experienceScore * experienceWeight;
  }

  private async getAgentIds(): Promise<string[]> {
    try {
      const agentKeys = await this.database.list('agents');
      return agentKeys.map(key => key.replace('agent:', ''));
    } catch {
      return Array.from({ length: 6 }, (_, i) => `agent-${i + 1}`);
    }
  }
}