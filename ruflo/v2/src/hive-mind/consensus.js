/**
 * Hive Mind Consensus Engine
 * 
 * Implements multiple consensus algorithms for distributed decision making:
 * - Majority voting (simple and weighted)
 * - Byzantine fault tolerance
 * - Dynamic threshold adjustment
 * - Quorum management
 */

import { EventEmitter } from 'node:events';
import { generateId } from '../utils/helpers.js';

export class ConsensusEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      defaultThreshold: 0.6,
      byzantineTolerance: 0.33, // Max 33% Byzantine actors
      quorumSize: 0.75, // Minimum 75% participation
      votingTimeout: 30000, // 30 seconds
      maxRetries: 3,
      weightDecay: 0.95, // Weight decay for agents with failures
      ...config
    };
    
    this.proposals = new Map();
    this.agents = new Map();
    this.votingHistory = new Map();
    this.metrics = {
      totalProposals: 0,
      successfulConsensus: 0,
      failedConsensus: 0,
      byzantineDetected: 0,
      avgVotingTime: 0
    };
  }

  /**
   * Register agent with initial reputation weight
   */
  registerAgent(agentId, initialWeight = 1.0, capabilities = []) {
    this.agents.set(agentId, {
      id: agentId,
      weight: initialWeight,
      reputation: 1.0,
      capabilities,
      votescast: 0,
      correctVotes: 0,
      byzantineFlags: 0,
      lastActivity: Date.now(),
      isOnline: true
    });
    
    this.emit('agent:registered', { agentId, weight: initialWeight });
  }

  /**
   * Create a new consensus proposal
   */
  async createProposal(data) {
    const proposalId = generateId('proposal');
    const proposal = {
      id: proposalId,
      type: data.type || 'general',
      content: data.content,
      threshold: data.threshold || this.config.defaultThreshold,
      algorithm: data.algorithm || 'weighted_majority',
      creator: data.creator,
      requiredCapabilities: data.requiredCapabilities || [],
      metadata: data.metadata || {},
      
      // Voting state
      votes: new Map(),
      eligibleAgents: new Set(),
      startTime: Date.now(),
      deadline: Date.now() + (data.timeout || this.config.votingTimeout),
      status: 'active',
      
      // Results
      result: null,
      finalRatio: 0,
      participationRate: 0,
      consensus: false,
      
      // Byzantine detection
      suspiciousVotes: new Set(),
      consistencyChecks: new Map()
    };

    // Determine eligible agents based on capabilities
    this.determineEligibleAgents(proposal);
    
    this.proposals.set(proposalId, proposal);
    this.metrics.totalProposals++;
    
    this.emit('proposal:created', proposal);
    
    // Set timeout for proposal
    setTimeout(() => this.finalizeProposal(proposalId), proposal.deadline - proposal.startTime);
    
    return proposalId;
  }

  /**
   * Determine which agents are eligible to vote
   */
  determineEligibleAgents(proposal) {
    for (const [agentId, agent] of this.agents) {
      if (!agent.isOnline) continue;
      
      // Check capabilities if required
      if (proposal.requiredCapabilities.length > 0) {
        const hasRequiredCapability = proposal.requiredCapabilities.some(cap => 
          agent.capabilities.includes(cap)
        );
        if (!hasRequiredCapability) continue;
      }
      
      // Exclude agents with too many Byzantine flags
      if (agent.byzantineFlags > 3) continue;
      
      proposal.eligibleAgents.add(agentId);
    }
    
    console.log(`Proposal ${proposal.id}: ${proposal.eligibleAgents.size} eligible agents`);
  }

  /**
   * Submit a vote for a proposal
   */
  async submitVote(proposalId, agentId, vote, reasoning = '') {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== 'active') {
      throw new Error(`Proposal ${proposalId} is no longer active`);
    }

    if (!proposal.eligibleAgents.has(agentId)) {
      throw new Error(`Agent ${agentId} is not eligible to vote on this proposal`);
    }

    if (Date.now() > proposal.deadline) {
      throw new Error(`Voting deadline has passed for proposal ${proposalId}`);
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not registered`);
    }

    // Record the vote
    const voteRecord = {
      agentId,
      vote: Boolean(vote),
      weight: agent.weight,
      reasoning,
      timestamp: Date.now(),
      confidence: this.calculateVoteConfidence(agent, proposal)
    };

    proposal.votes.set(agentId, voteRecord);
    agent.votescast++;
    agent.lastActivity = Date.now();

    this.emit('vote:submitted', { proposalId, agentId, vote, reasoning });

    // Perform Byzantine detection
    this.detectByzantineBehavior(proposal, voteRecord);

    // Check if we can finalize early
    if (this.canFinalizeEarly(proposal)) {
      return this.finalizeProposal(proposalId);
    }

    return { status: 'recorded', proposal: proposal.id };
  }

  /**
   * Calculate vote confidence based on agent history
   */
  calculateVoteConfidence(agent, proposal) {
    const reputationFactor = agent.reputation;
    const experienceFactor = Math.min(agent.votescast / 10, 1.0);
    const consistencyFactor = agent.votescast > 0 ? agent.correctVotes / agent.votescast : 0.5;
    const recencyFactor = Math.max(0.1, 1.0 - (Date.now() - agent.lastActivity) / (24 * 60 * 60 * 1000));
    
    return (reputationFactor + experienceFactor + consistencyFactor + recencyFactor) / 4;
  }

  /**
   * Detect Byzantine behavior patterns
   */
  detectByzantineBehavior(proposal, voteRecord) {
    const { agentId, vote, confidence } = voteRecord;
    const agent = this.agents.get(agentId);
    
    // Pattern 1: Vote flipping (changing votes frequently)
    const recentVotes = Array.from(this.votingHistory.values())
      .filter(v => v.agentId === agentId && Date.now() - v.timestamp < 3600000) // Last hour
      .slice(-5);
    
    if (recentVotes.length >= 3) {
      const voteChanges = recentVotes.reduce((changes, v, i) => 
        i > 0 && v.vote !== recentVotes[i-1].vote ? changes + 1 : changes, 0);
      
      if (voteChanges >= 2) {
        this.flagByzantineAgent(agentId, 'vote_flipping', proposal.id);
      }
    }

    // Pattern 2: Extremely low confidence with definitive votes
    if (confidence < 0.3 && Math.abs(vote ? 1 : 0) === 1) {
      this.flagByzantineAgent(agentId, 'confidence_mismatch', proposal.id);
    }

    // Pattern 3: Consistent minority voting (contrarian behavior)
    const agentHistory = Array.from(this.votingHistory.values())
      .filter(v => v.agentId === agentId)
      .slice(-10);
    
    if (agentHistory.length >= 5) {
      const minorityVotes = agentHistory.filter(v => {
        const proposalResult = this.proposals.get(v.proposalId);
        return proposalResult && proposalResult.consensus !== v.vote;
      }).length;
      
      if (minorityVotes / agentHistory.length > 0.8) {
        this.flagByzantineAgent(agentId, 'contrarian_pattern', proposal.id);
      }
    }

    // Store vote in history
    this.votingHistory.set(`${proposal.id}:${agentId}`, {
      proposalId: proposal.id,
      agentId,
      vote,
      timestamp: Date.now()
    });
  }

  /**
   * Flag an agent for Byzantine behavior
   */
  flagByzantineAgent(agentId, reason, proposalId) {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.byzantineFlags++;
    agent.weight *= this.config.weightDecay;
    this.metrics.byzantineDetected++;
    
    console.warn(`Byzantine behavior detected: Agent ${agentId}, Reason: ${reason}, Proposal: ${proposalId}`);
    this.emit('byzantine:detected', { agentId, reason, proposalId, newWeight: agent.weight });
    
    // Quarantine agent if too many flags
    if (agent.byzantineFlags >= 5) {
      agent.isOnline = false;
      this.emit('agent:quarantined', { agentId, flags: agent.byzantineFlags });
    }
  }

  /**
   * Check if proposal can be finalized early
   */
  canFinalizeEarly(proposal) {
    const totalEligible = proposal.eligibleAgents.size;
    const votesReceived = proposal.votes.size;
    
    // Early finalization conditions:
    // 1. Unanimous agreement
    // 2. Impossible to change outcome
    // 3. Sufficient participation with clear majority
    
    if (votesReceived < Math.ceil(totalEligible * this.config.quorumSize)) {
      return false;
    }

    const { positiveVotes, negativeVotes } = this.calculateVotes(proposal);
    const totalWeightedVotes = positiveVotes + negativeVotes;
    const ratio = totalWeightedVotes > 0 ? positiveVotes / totalWeightedVotes : 0;
    
    // Unanimous or overwhelming majority
    if (ratio >= 0.95 || ratio <= 0.05) {
      return true;
    }
    
    // Mathematically impossible to change outcome
    const remainingVotes = totalEligible - votesReceived;
    const maxPossibleChange = remainingVotes * Math.max(...Array.from(this.agents.values()).map(a => a.weight));
    
    if (ratio > proposal.threshold && positiveVotes - negativeVotes > maxPossibleChange) {
      return true;
    }
    
    if (ratio < proposal.threshold && negativeVotes - positiveVotes > maxPossibleChange) {
      return true;
    }
    
    return false;
  }

  /**
   * Calculate weighted votes
   */
  calculateVotes(proposal) {
    let positiveVotes = 0;
    let negativeVotes = 0;
    let totalWeight = 0;
    
    for (const [agentId, vote] of proposal.votes) {
      const agent = this.agents.get(agentId);
      if (!agent) continue;
      
      const voteWeight = agent.weight;
      totalWeight += voteWeight;
      
      if (vote.vote) {
        positiveVotes += voteWeight;
      } else {
        negativeVotes += voteWeight;
      }
    }
    
    return { positiveVotes, negativeVotes, totalWeight };
  }

  /**
   * Apply different consensus algorithms
   */
  applyConsensusAlgorithm(proposal) {
    switch (proposal.algorithm) {
      case 'simple_majority':
        return this.simpleMajorityConsensus(proposal);
      case 'weighted_majority':
        return this.weightedMajorityConsensus(proposal);
      case 'byzantine_tolerant':
        return this.byzantineTolerantConsensus(proposal);
      case 'unanimous':
        return this.unanimousConsensus(proposal);
      default:
        return this.weightedMajorityConsensus(proposal);
    }
  }

  /**
   * Simple majority consensus (one vote per agent)
   */
  simpleMajorityConsensus(proposal) {
    const votes = Array.from(proposal.votes.values());
    const positiveVotes = votes.filter(v => v.vote).length;
    const negativeVotes = votes.filter(v => !v.vote).length;
    const totalVotes = votes.length;
    
    const ratio = totalVotes > 0 ? positiveVotes / totalVotes : 0;
    const consensus = ratio >= proposal.threshold;
    
    return {
      consensus,
      ratio,
      positiveVotes,
      negativeVotes,
      totalVotes,
      algorithm: 'simple_majority'
    };
  }

  /**
   * Weighted majority consensus
   */
  weightedMajorityConsensus(proposal) {
    const { positiveVotes, negativeVotes, totalWeight } = this.calculateVotes(proposal);
    const ratio = totalWeight > 0 ? positiveVotes / totalWeight : 0;
    const consensus = ratio >= proposal.threshold;
    
    return {
      consensus,
      ratio,
      positiveVotes,
      negativeVotes,
      totalWeight,
      algorithm: 'weighted_majority'
    };
  }

  /**
   * Byzantine fault tolerant consensus
   */
  byzantineTolerantConsensus(proposal) {
    const votes = Array.from(proposal.votes.values());
    const trustedVotes = votes.filter(v => {
      const agent = this.agents.get(v.agentId);
      return agent && agent.byzantineFlags === 0 && agent.reputation > 0.7;
    });
    
    if (trustedVotes.length === 0) {
      return this.weightedMajorityConsensus(proposal);
    }
    
    const positiveVotes = trustedVotes.filter(v => v.vote).length;
    const totalTrusted = trustedVotes.length;
    const ratio = positiveVotes / totalTrusted;
    
    // Require higher threshold for Byzantine tolerance
    const byzantineThreshold = Math.max(proposal.threshold, 0.67);
    const consensus = ratio >= byzantineThreshold;
    
    return {
      consensus,
      ratio,
      positiveVotes,
      negativeVotes: totalTrusted - positiveVotes,
      totalVotes: totalTrusted,
      algorithm: 'byzantine_tolerant',
      trustedVotesOnly: true
    };
  }

  /**
   * Unanimous consensus
   */
  unanimousConsensus(proposal) {
    const votes = Array.from(proposal.votes.values());
    const allAgree = votes.every(v => v.vote) || votes.every(v => !v.vote);
    const consensus = allAgree && votes.length > 0;
    
    return {
      consensus,
      ratio: consensus ? 1.0 : 0.0,
      positiveVotes: votes.filter(v => v.vote).length,
      negativeVotes: votes.filter(v => !v.vote).length,
      totalVotes: votes.length,
      algorithm: 'unanimous'
    };
  }

  /**
   * Finalize a proposal
   */
  async finalizeProposal(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'active') {
      return null;
    }

    proposal.status = 'finalized';
    proposal.endTime = Date.now();
    
    // Check quorum
    const participationRate = proposal.votes.size / proposal.eligibleAgents.size;
    proposal.participationRate = participationRate;
    
    if (participationRate < this.config.quorumSize) {
      proposal.result = this.handleInsufficientQuorum(proposal);
    } else {
      proposal.result = this.applyConsensusAlgorithm(proposal);
    }
    
    proposal.consensus = proposal.result.consensus;
    proposal.finalRatio = proposal.result.ratio;
    
    // Update metrics
    if (proposal.consensus) {
      this.metrics.successfulConsensus++;
    } else {
      this.metrics.failedConsensus++;
    }
    
    const votingTime = proposal.endTime - proposal.startTime;
    this.metrics.avgVotingTime = 
      (this.metrics.avgVotingTime * (this.metrics.totalProposals - 1) + votingTime) / 
      this.metrics.totalProposals;
    
    // Update agent reputations
    this.updateAgentReputations(proposal);
    
    this.emit('proposal:finalized', proposal);
    
    return proposal;
  }

  /**
   * Handle insufficient quorum
   */
  handleInsufficientQuorum(proposal) {
    return {
      consensus: false,
      ratio: 0,
      positiveVotes: 0,
      negativeVotes: 0,
      totalVotes: proposal.votes.size,
      algorithm: 'quorum_failed',
      error: `Insufficient quorum: ${proposal.participationRate.toFixed(2)} < ${this.config.quorumSize}`
    };
  }

  /**
   * Update agent reputations based on consensus accuracy
   */
  updateAgentReputations(proposal) {
    if (!proposal.consensus) return;
    
    const majorityVote = proposal.finalRatio >= 0.5;
    
    for (const [agentId, vote] of proposal.votes) {
      const agent = this.agents.get(agentId);
      if (!agent) continue;
      
      const votedWithMajority = vote.vote === majorityVote;
      
      if (votedWithMajority) {
        agent.correctVotes++;
        agent.reputation = Math.min(2.0, agent.reputation * 1.05);
        agent.weight = Math.min(2.0, agent.weight * 1.02);
      } else {
        agent.reputation *= 0.98;
        agent.weight *= 0.99;
      }
    }
  }

  /**
   * Get consensus metrics
   */
  getMetrics() {
    const activeProposals = Array.from(this.proposals.values()).filter(p => p.status === 'active');
    const totalAgents = this.agents.size;
    const onlineAgents = Array.from(this.agents.values()).filter(a => a.isOnline).length;
    const byzantineAgents = Array.from(this.agents.values()).filter(a => a.byzantineFlags > 0).length;
    
    return {
      ...this.metrics,
      activeProposals: activeProposals.length,
      totalAgents,
      onlineAgents,
      byzantineAgents,
      successRate: this.metrics.totalProposals > 0 ? 
        this.metrics.successfulConsensus / this.metrics.totalProposals : 0,
      avgParticipationRate: this.calculateAverageParticipation()
    };
  }

  /**
   * Calculate average participation rate
   */
  calculateAverageParticipation() {
    const finalizedProposals = Array.from(this.proposals.values())
      .filter(p => p.status === 'finalized');
    
    if (finalizedProposals.length === 0) return 0;
    
    return finalizedProposals.reduce((sum, p) => sum + p.participationRate, 0) / 
           finalizedProposals.length;
  }

  /**
   * Get proposal status
   */
  getProposal(proposalId) {
    return this.proposals.get(proposalId);
  }

  /**
   * Get agent information
   */
  getAgent(agentId) {
    return this.agents.get(agentId);
  }

  /**
   * List all proposals
   */
  listProposals(filter = {}) {
    let proposals = Array.from(this.proposals.values());
    
    if (filter.status) {
      proposals = proposals.filter(p => p.status === filter.status);
    }
    
    if (filter.type) {
      proposals = proposals.filter(p => p.type === filter.type);
    }
    
    if (filter.creator) {
      proposals = proposals.filter(p => p.creator === filter.creator);
    }
    
    return proposals.sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Cleanup expired proposals and old history
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    // Remove old proposals
    for (const [id, proposal] of this.proposals) {
      if (now - proposal.startTime > maxAge && proposal.status === 'finalized') {
        this.proposals.delete(id);
      }
    }
    
    // Remove old voting history
    for (const [key, vote] of this.votingHistory) {
      if (now - vote.timestamp > maxAge) {
        this.votingHistory.delete(key);
      }
    }
    
    this.emit('cleanup:completed', {
      proposalsRemoved: this.proposals.size,
      historyRemoved: this.votingHistory.size
    });
  }
}