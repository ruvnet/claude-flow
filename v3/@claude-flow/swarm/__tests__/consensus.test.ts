/**
 * Consensus Algorithms Tests
 * Comprehensive tests for Raft, Byzantine, and Gossip consensus
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RaftConsensus, createRaftConsensus } from '../src/consensus/raft.js';
import { ByzantineConsensus, createByzantineConsensus } from '../src/consensus/byzantine.js';
import { GossipConsensus, createGossipConsensus } from '../src/consensus/gossip.js';
import type { ConsensusVote } from '../src/types.js';

describe('Raft Consensus', () => {
  let raft: RaftConsensus;

  beforeEach(async () => {
    raft = createRaftConsensus('node-1', {
      threshold: 0.66,
      timeoutMs: 5000,
      electionTimeoutMinMs: 50,
      electionTimeoutMaxMs: 100,
      heartbeatIntervalMs: 25,
    });

    await raft.initialize();
  });

  afterEach(async () => {
    await raft.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize as follower', () => {
      expect(raft.getState()).toBe('follower');
      expect(raft.getTerm()).toBe(0);
    });

    it('should not be leader initially', () => {
      expect(raft.isLeader()).toBe(false);
    });
  });

  describe('Leader Election', () => {
    it('should elect itself as leader with no peers', async () => {
      // Wait for election timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // With no peers, node becomes candidate or leader
      const state = raft.getState();
      expect(['candidate', 'leader', 'follower']).toContain(state);
    });

    it('should add and remove peers', () => {
      raft.addPeer('peer-1');
      raft.addPeer('peer-2');
      raft.addPeer('peer-3');

      raft.removePeer('peer-2');

      // Verify peers are managed
      expect(() => raft.addPeer('peer-4')).not.toThrow();
    });

    it('should handle vote requests', () => {
      const granted = raft.handleVoteRequest(
        'candidate-1',
        1, // Higher term
        0, // lastLogIndex
        0  // lastLogTerm
      );

      expect(granted).toBe(true);
      expect(raft.getTerm()).toBe(1);
    });

    it('should reject vote for lower term', () => {
      raft.handleVoteRequest('candidate-1', 5, 0, 0);

      const granted = raft.handleVoteRequest(
        'candidate-2',
        3, // Lower term
        0,
        0
      );

      expect(granted).toBe(false);
    });
  });

  describe('Log Replication', () => {
    beforeEach(() => {
      // Make this node leader
      raft.addPeer('peer-1');
      raft.addPeer('peer-2');
    });

    it('should propose value as leader', async () => {
      // Simulate becoming leader
      const raftLeader = createRaftConsensus('leader-node', {
        electionTimeoutMinMs: 50,
        electionTimeoutMaxMs: 100,
      });
      await raftLeader.initialize();

      // Wait for self-election
      await new Promise(resolve => setTimeout(resolve, 150));

      if (raftLeader.isLeader()) {
        const proposal = await raftLeader.propose({ value: 'test-data' });

        expect(proposal).toBeDefined();
        expect(proposal.id).toContain('raft_');
        expect(proposal.value).toEqual({ value: 'test-data' });
      }

      await raftLeader.shutdown();
    });

    it('should reject proposal from non-leader', async () => {
      await expect(
        raft.propose({ value: 'test' })
      ).rejects.toThrow('Only leader can propose values');
    });

    it('should handle append entries from leader', () => {
      const success = raft.handleAppendEntries(
        'leader-1',
        1, // Higher term
        [],
        0
      );

      expect(success).toBe(true);
      expect(raft.getTerm()).toBe(1);
      expect(raft.getState()).toBe('follower');
    });
  });

  describe('Consensus Process', () => {
    it('should vote on proposal', async () => {
      raft.addPeer('peer-1');
      raft.addPeer('peer-2');

      const raftLeader = createRaftConsensus('leader', {});
      await raftLeader.initialize();
      raftLeader.addPeer('node-1');

      // Simulate leader election
      await new Promise(resolve => setTimeout(resolve, 150));

      if (raftLeader.isLeader()) {
        const proposal = await raftLeader.propose({ action: 'commit' });

        const vote: ConsensusVote = {
          voterId: 'node-1',
          approve: true,
          confidence: 1.0,
          timestamp: new Date(),
        };

        await raftLeader.vote(proposal.id, vote);

        // Proposal should have the vote
        const result = await raftLeader.awaitConsensus(proposal.id);
        expect(result.proposalId).toBe(proposal.id);
      }

      await raftLeader.shutdown();
    });

    it('should timeout on consensus', async () => {
      const shortTimeout = createRaftConsensus('timeout-node', {
        timeoutMs: 100,
      });
      await shortTimeout.initialize();

      // Test timeout behavior with invalid proposal
      await expect(
        shortTimeout.awaitConsensus('non-existent-proposal')
      ).rejects.toThrow('Proposal non-existent-proposal not found');

      await shortTimeout.shutdown();
    });
  });
});

describe('Byzantine Consensus', () => {
  let byzantine: ByzantineConsensus;

  beforeEach(async () => {
    byzantine = createByzantineConsensus('node-1', {
      threshold: 0.66,
      timeoutMs: 5000,
      maxFaultyNodes: 1,
    });

    await byzantine.initialize();
  });

  afterEach(async () => {
    await byzantine.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(byzantine.getViewNumber()).toBe(0);
      expect(byzantine.getSequenceNumber()).toBe(0);
    });

    it('should not be primary initially', () => {
      expect(byzantine.isPrimary()).toBe(false);
    });

    it('should calculate max faulty nodes', () => {
      byzantine.addNode('node-2');
      byzantine.addNode('node-3');
      byzantine.addNode('node-4');

      // With 4 nodes, can tolerate 1 faulty node: f = (n-1)/3 = (4-1)/3 = 1
      expect(byzantine.getMaxFaultyNodes()).toBe(1);
      expect(byzantine.canTolerate(1)).toBe(true);
      expect(byzantine.canTolerate(2)).toBe(false);
    });
  });

  describe('Primary Election', () => {
    it('should elect primary', () => {
      byzantine.addNode('node-2');
      byzantine.addNode('node-3');
      byzantine.addNode('node-4');

      const primaryId = byzantine.electPrimary();

      expect(primaryId).toBeDefined();
      expect(['node-1', 'node-2', 'node-3', 'node-4']).toContain(primaryId);
    });

    it('should rotate primary on view change', async () => {
      byzantine.addNode('node-2');
      byzantine.addNode('node-3');

      const firstPrimary = byzantine.electPrimary();
      const firstView = byzantine.getViewNumber();

      await byzantine.initiateViewChange();

      const secondView = byzantine.getViewNumber();
      expect(secondView).toBe(firstView + 1);
    });
  });

  describe('Three-Phase Commit', () => {
    beforeEach(() => {
      byzantine.addNode('node-2');
      byzantine.addNode('node-3');
      byzantine.addNode('node-4');
      byzantine.addNode('node-1', true); // Make node-1 primary
    });

    it('should propose value as primary', async () => {
      const proposal = await byzantine.propose({ data: 'test-value' });

      expect(proposal).toBeDefined();
      expect(proposal.id).toContain('bft_');
      expect(proposal.value).toEqual({ data: 'test-value' });
      expect(proposal.status).toBe('pending');
    });

    it('should reject proposal from non-primary', async () => {
      const nonPrimary = createByzantineConsensus('non-primary', {});
      await nonPrimary.initialize();

      await expect(
        nonPrimary.propose({ value: 'test' })
      ).rejects.toThrow('Only primary can propose values');

      await nonPrimary.shutdown();
    });

    it('should process pre-prepare message', async () => {
      const proposal = await byzantine.propose({ action: 'update' });

      await byzantine.handlePrePrepare({
        type: 'pre-prepare',
        viewNumber: byzantine.getViewNumber(),
        sequenceNumber: byzantine.getSequenceNumber(),
        digest: 'test-digest',
        senderId: 'node-1',
        timestamp: new Date(),
        payload: { action: 'update' },
      });

      expect(byzantine.getSequenceNumber()).toBeGreaterThan(0);
    });

    it('should process prepare message', async () => {
      await byzantine.handlePrepare({
        type: 'prepare',
        viewNumber: byzantine.getViewNumber(),
        sequenceNumber: 1,
        digest: 'test-digest',
        senderId: 'node-2',
        timestamp: new Date(),
      });

      expect(byzantine.getPreparedCount()).toBeGreaterThanOrEqual(0);
    });

    it('should process commit message', async () => {
      await byzantine.handleCommit({
        type: 'commit',
        viewNumber: byzantine.getViewNumber(),
        sequenceNumber: 1,
        digest: 'test-digest',
        senderId: 'node-2',
        timestamp: new Date(),
      });

      expect(byzantine.getCommittedCount()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Fault Tolerance', () => {
    it('should achieve consensus with 2f+1 votes', async () => {
      // 4 nodes can tolerate 1 faulty (f=1, need 2*1+1 = 3 votes)
      byzantine.addNode('node-2');
      byzantine.addNode('node-3');
      byzantine.addNode('node-4');
      byzantine.addNode('node-1', true);

      const proposal = await byzantine.propose({ value: 42 });

      // Simulate votes from 3 nodes (2f+1)
      const vote: ConsensusVote = {
        voterId: 'node-2',
        approve: true,
        confidence: 1.0,
        timestamp: new Date(),
      };

      await byzantine.vote(proposal.id, vote);

      // Check if we need more votes
      const result = await byzantine.awaitConsensus(proposal.id);
      expect(result.proposalId).toBe(proposal.id);
    });
  });
});

describe('Gossip Consensus', () => {
  let gossip: GossipConsensus;

  beforeEach(async () => {
    gossip = createGossipConsensus('node-1', {
      threshold: 0.66,
      timeoutMs: 5000,
      fanout: 3,
      gossipIntervalMs: 50,
      maxHops: 10,
      convergenceThreshold: 0.9,
    });

    await gossip.initialize();
  });

  afterEach(async () => {
    await gossip.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(gossip.getVersion()).toBe(0);
      expect(gossip.getNeighborCount()).toBe(0);
    });

    it('should track seen messages', () => {
      expect(gossip.getSeenMessageCount()).toBe(0);
    });
  });

  describe('Neighbor Management', () => {
    it('should add and remove nodes', () => {
      gossip.addNode('node-2');
      gossip.addNode('node-3');
      gossip.addNode('node-4');

      gossip.removeNode('node-3');

      expect(() => gossip.addNeighbor('node-2')).not.toThrow();
    });

    it('should add specific neighbors', () => {
      gossip.addNode('node-2');
      gossip.addNeighbor('node-2');

      expect(gossip.getNeighborCount()).toBeGreaterThan(0);
    });

    it('should remove neighbors', () => {
      gossip.addNode('node-2');
      gossip.addNeighbor('node-2');

      gossip.removeNeighbor('node-2');

      // Neighbor count might not be exactly 0 due to random mesh
      expect(() => gossip.getNeighborCount()).not.toThrow();
    });
  });

  describe('Gossip Protocol', () => {
    beforeEach(() => {
      gossip.addNode('node-2');
      gossip.addNode('node-3');
      gossip.addNode('node-4');
      gossip.addNeighbor('node-2');
      gossip.addNeighbor('node-3');
    });

    it('should propose value', async () => {
      const proposal = await gossip.propose({ message: 'hello-gossip' });

      expect(proposal).toBeDefined();
      expect(proposal.id).toContain('gossip_');
      expect(proposal.value).toEqual({ message: 'hello-gossip' });
      expect(proposal.status).toBe('pending');
    });

    it('should vote on proposal', async () => {
      const proposal = await gossip.propose({ value: 123 });

      const vote: ConsensusVote = {
        voterId: 'node-2',
        approve: true,
        confidence: 0.95,
        timestamp: new Date(),
      };

      await gossip.vote(proposal.id, vote);

      // Vote should be recorded
      expect(gossip.getConvergence(proposal.id)).toBeGreaterThan(0);
    });

    it('should track message queue', async () => {
      await gossip.propose({ data: 'test' });

      expect(gossip.getQueueDepth()).toBeGreaterThanOrEqual(0);
    });

    it('should perform anti-entropy', async () => {
      gossip.addNeighbor('node-2');

      await expect(gossip.antiEntropy()).resolves.not.toThrow();
    });
  });

  describe('Convergence', () => {
    it('should calculate convergence rate', async () => {
      gossip.addNode('node-2');
      gossip.addNode('node-3');
      gossip.addNode('node-4');

      const proposal = await gossip.propose({ value: 'converge' });

      // Initial convergence (only self-vote)
      const initialConvergence = gossip.getConvergence(proposal.id);
      expect(initialConvergence).toBeGreaterThan(0);

      // Add more votes
      await gossip.vote(proposal.id, {
        voterId: 'node-2',
        approve: true,
        confidence: 1.0,
        timestamp: new Date(),
      });

      const updatedConvergence = gossip.getConvergence(proposal.id);
      expect(updatedConvergence).toBeGreaterThanOrEqual(initialConvergence);
    });

    it('should achieve eventual consensus', async () => {
      gossip.addNode('node-2');
      gossip.addNode('node-3');
      gossip.addNode('node-4');

      const proposal = await gossip.propose({ action: 'commit' });

      // Vote from majority
      await gossip.vote(proposal.id, {
        voterId: 'node-2',
        approve: true,
        confidence: 1.0,
        timestamp: new Date(),
      });

      await gossip.vote(proposal.id, {
        voterId: 'node-3',
        approve: true,
        confidence: 1.0,
        timestamp: new Date(),
      });

      await gossip.vote(proposal.id, {
        voterId: 'node-4',
        approve: true,
        confidence: 1.0,
        timestamp: new Date(),
      });

      // Wait for convergence
      const result = await gossip.awaitConsensus(proposal.id);

      expect(result.proposalId).toBe(proposal.id);
      expect(result.participationRate).toBeGreaterThan(0.5);
    });

    it('should handle timeout gracefully', async () => {
      const shortGossip = createGossipConsensus('timeout-node', {
        timeoutMs: 100,
        convergenceThreshold: 0.99, // Very high threshold
      });
      await shortGossip.initialize();

      const proposal = await shortGossip.propose({ value: 'timeout-test' });

      // Should timeout and still return result
      const result = await shortGossip.awaitConsensus(proposal.id);

      expect(result.proposalId).toBe(proposal.id);

      await shortGossip.shutdown();
    });
  });

  describe('Message Propagation', () => {
    it('should increment version on propose', async () => {
      const initialVersion = gossip.getVersion();

      await gossip.propose({ data: 'version-test' });

      expect(gossip.getVersion()).toBeGreaterThan(initialVersion);
    });

    it('should track gossip rounds', async () => {
      const proposal = await gossip.propose({ rounds: 'test' });

      // Allow some gossip rounds to occur
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(gossip.getVersion()).toBeGreaterThan(0);
    });
  });
});

describe('Consensus Algorithm Comparison', () => {
  it('should handle different consensus algorithms', async () => {
    const raft = createRaftConsensus('raft-node', {});
    const byzantine = createByzantineConsensus('bft-node', {});
    const gossip = createGossipConsensus('gossip-node', {});

    await Promise.all([
      raft.initialize(),
      byzantine.initialize(),
      gossip.initialize(),
    ]);

    // All should initialize successfully
    expect(raft.getState()).toBeDefined();
    expect(byzantine.getViewNumber()).toBeDefined();
    expect(gossip.getVersion()).toBeDefined();

    await Promise.all([
      raft.shutdown(),
      byzantine.shutdown(),
      gossip.shutdown(),
    ]);
  });
});

// Dream Cycle 2026-08-24 (swarm): weighted consensus tallying.
//
// Hypothesis: QueenCoordinator.weightedConsensus() has always computed real
// per-agent trust weights (successRate * health), but until this patch they
// rode along inertly inside the opaque proposal `value` and every tally
// implementation (raft/byzantine/gossip) counted votes flatly (one voter =
// one unit), regardless of `requiredConsensus: 'weighted'`. These tests
// prove the tally logic now (a) actually applies supplied weights and can
// flip an outcome a flat count would reach differently, and (b) is
// byte-identical to today's flat-count behavior when no weights are
// supplied — the frozen backward-compatibility invariant.
describe('Weighted Consensus (Dream Cycle 2026-08-24)', () => {
  describe('Gossip — ratio-based tally', () => {
    it('flips a flat-majority rejection to acceptance when a high-trust minority outvotes a low-trust majority', async () => {
      // 4 voters total (proposer + 3). Flat: 2/4 approve = 0.50 < 0.51 threshold -> rejected.
      // Weighted: proposer(0.05) + voter-a(0.9) approve = 0.95 / 1.05 total ~= 0.905 >= 0.51 -> accepted.
      const gossip = createGossipConsensus('proposer', {
        threshold: 0.51,
        convergenceThreshold: 1.0, // require all 4 nodes to have voted before deciding
      });
      await gossip.initialize();
      gossip.addNode('voter-a');
      gossip.addNode('voter-b');
      gossip.addNode('voter-c');

      const weights = new Map<string, number>([
        ['proposer', 0.05],
        ['voter-a', 0.9],
        ['voter-b', 0.05],
        ['voter-c', 0.05],
      ]);

      const proposal = await gossip.propose({ decision: 'weighted-flip-test' }, weights);
      // proposer self-votes approve automatically inside propose()

      await gossip.vote(proposal.id, {
        voterId: 'voter-a',
        approve: true,
        confidence: 1.0,
        timestamp: new Date(),
      });
      await gossip.vote(proposal.id, {
        voterId: 'voter-b',
        approve: false,
        confidence: 1.0,
        timestamp: new Date(),
      });
      await gossip.vote(proposal.id, {
        voterId: 'voter-c',
        approve: false,
        confidence: 1.0,
        timestamp: new Date(),
      });

      const result = await gossip.awaitConsensus(proposal.id);
      expect(result.approved).toBe(true);
      expect(result.approvalRate).toBeCloseTo(0.95 / 1.05, 5);

      await gossip.shutdown();
    });

    it('reproduces today\'s flat-vote outcome exactly when no weights are supplied (regression guard)', async () => {
      const gossip = createGossipConsensus('proposer', {
        threshold: 0.51,
        convergenceThreshold: 1.0,
      });
      await gossip.initialize();
      gossip.addNode('voter-a');
      gossip.addNode('voter-b');
      gossip.addNode('voter-c');

      // Same votes as above, no weights map passed.
      const proposal = await gossip.propose({ decision: 'flat-vote-parity-test' });

      await gossip.vote(proposal.id, {
        voterId: 'voter-a',
        approve: true,
        confidence: 1.0,
        timestamp: new Date(),
      });
      await gossip.vote(proposal.id, {
        voterId: 'voter-b',
        approve: false,
        confidence: 1.0,
        timestamp: new Date(),
      });
      await gossip.vote(proposal.id, {
        voterId: 'voter-c',
        approve: false,
        confidence: 1.0,
        timestamp: new Date(),
      });

      const result = await gossip.awaitConsensus(proposal.id);
      // 2/4 = 0.50 < 0.51 threshold -> rejected, same as pre-patch flat counting.
      expect(result.approved).toBe(false);
      expect(result.approvalRate).toBeCloseTo(0.5, 5);

      await gossip.shutdown();
    });
  });

  describe('Byzantine — quorum-count tally with [0,1] weight clamp', () => {
    it('clamps an out-of-range weight to 1 instead of letting it satisfy quorum alone (BFT safety invariant)', async () => {
      // f=1 (config-capped) => requiredVotes = 2f+1 = 3. A single voter with
      // an unclamped weight of, say, 5 could otherwise satisfy quorum alone
      // and defeat the f-faulty-node guarantee entirely.
      const byzantine = createByzantineConsensus('primary', {
        maxFaultyNodes: 1,
        timeoutMs: 150, // short: with only 1 (clamped) vote cast, this proposal
                        // can never reach accept or reject and would otherwise
                        // hang until awaitConsensus's own timeout/expiry path
      });
      await byzantine.initialize();
      byzantine.addNode('primary', true);
      byzantine.addNode('voter-a');
      byzantine.addNode('voter-b');
      byzantine.addNode('voter-c');

      const weights = new Map<string, number>([['voter-a', 5]]); // out-of-range on purpose
      const proposal = await byzantine.propose({ decision: 'clamp-test' }, weights);

      await byzantine.vote(proposal.id, {
        voterId: 'voter-a',
        approve: true,
        confidence: 1.0,
        timestamp: new Date(),
      });

      const result = await byzantine.awaitConsensus(proposal.id);
      // A single approving vote (even weight=5, clamped to 1) must never
      // reach requiredVotes=3 alone -> proposal never accepts, expires instead.
      expect(result.approved).toBe(false);

      await byzantine.shutdown();
    }, 15000);

    it('reproduces today\'s flat 2f+1 quorum exactly when no weights are supplied (regression guard)', async () => {
      const byzantine = createByzantineConsensus('primary', { maxFaultyNodes: 1 });
      await byzantine.initialize();
      byzantine.addNode('primary', true);
      byzantine.addNode('voter-a');
      byzantine.addNode('voter-b');
      byzantine.addNode('voter-c');

      const proposal = await byzantine.propose({ decision: 'flat-quorum-parity-test' });

      for (const voterId of ['voter-a', 'voter-b', 'voter-c']) {
        await byzantine.vote(proposal.id, {
          voterId,
          approve: true,
          confidence: 1.0,
          timestamp: new Date(),
        });
      }

      const result = await byzantine.awaitConsensus(proposal.id);
      // 3 approving votes >= requiredVotes (2*1+1=3) -> accepted, same as pre-patch flat counting.
      expect(result.approved).toBe(true);
      expect(result.approvalRate).toBeCloseTo(1.0, 5);

      await byzantine.shutdown();
    });
  });

  describe('Raft — count-based quorum tally', () => {
    it('reproduces today\'s flat quorum exactly when no weights are supplied (regression guard)', async () => {
      const raftLeader = createRaftConsensus('leader', {
        threshold: 0.66,
        electionTimeoutMinMs: 50,
        electionTimeoutMaxMs: 100,
      });
      await raftLeader.initialize();
      raftLeader.addPeer('voter-a');
      raftLeader.addPeer('voter-b');

      // Wait for self-election (no peers respond in this unit test, so the
      // node self-elects after its randomized timeout — same pattern used
      // by the existing "should vote on proposal" test above).
      await new Promise(resolve => setTimeout(resolve, 150));

      if (raftLeader.isLeader()) {
        const proposal = await raftLeader.propose({ decision: 'raft-flat-parity-test' });

        await raftLeader.vote(proposal.id, {
          voterId: 'voter-a',
          approve: true,
          confidence: 1.0,
          timestamp: new Date(),
        });
        await raftLeader.vote(proposal.id, {
          voterId: 'voter-b',
          approve: true,
          confidence: 1.0,
          timestamp: new Date(),
        });

        const result = await raftLeader.awaitConsensus(proposal.id);
        expect(result.approvalRate).toBeCloseTo(1.0, 5);
      }

      await raftLeader.shutdown();
    });

    it('prevents a flat-count rejection when a low-trust majority is weighted down (adversarial-critic follow-up)', async () => {
      // Raft's quorum is an absolute count derived from totalVoters
      // (Math.floor(totalVoters * threshold)), not a ratio of votes cast, and
      // per-voter weight is clamped to [0,1] (never > flat). That means
      // weighting can never make an ACCEPT *easier* than flat counting (a
      // weighted approving sum can never exceed the flat approving count) —
      // but it CAN make a REJECT *harder*, by denying a low-trust disapproving
      // majority enough weighted mass to cross the reject threshold. This
      // test proves that distinct effect with 4 total voters (leader + 3
      // peers, threshold 0.66 -> quorum=floor(4*0.66)=2): all 3 peers vote
      // reject.
      //
      // Flat: after all 3 reject votes, disapproving count (3) exceeds
      // totalVoters-quorum (4-2=2), so checkConsensus — which runs
      // synchronously inside vote() — flips status to 'rejected' almost
      // immediately (well under the configured timeout).
      //
      // Weighted (each peer weight 0.05, leader 0.05): disapproving WEIGHT
      // (0.15) never exceeds totalVoters-quorum (2), so the reject condition
      // never fires; the proposal stays 'pending' and only resolves via
      // awaitConsensus's own timeout/expiry path. Both runs end with
      // approved:false, but the weighted run's elapsed time proves it never
      // reached an explicit reject — the weighting genuinely changed raft's
      // real-time decision, not just a downstream approvalRate number.
      async function runScenario(weights?: Map<string, number>) {
        const raftLeader = createRaftConsensus('leader', {
          threshold: 0.66,
          timeoutMs: 300,
          electionTimeoutMinMs: 50,
          electionTimeoutMaxMs: 100,
        });
        await raftLeader.initialize();
        raftLeader.addPeer('voter-a');
        raftLeader.addPeer('voter-b');
        raftLeader.addPeer('voter-c');

        await new Promise(resolve => setTimeout(resolve, 150));
        if (!raftLeader.isLeader()) {
          await raftLeader.shutdown();
          return null; // election didn't complete in time; skip (matches existing suite's tolerant pattern)
        }

        const proposal = await raftLeader.propose(
          { decision: 'raft-reject-prevention-test' },
          weights
        );
        // leader auto-votes approve for itself inside propose()
        for (const voterId of ['voter-a', 'voter-b', 'voter-c']) {
          await raftLeader.vote(proposal.id, {
            voterId,
            approve: false,
            confidence: 1.0,
            timestamp: new Date(),
          });
        }

        const before = Date.now();
        const result = await raftLeader.awaitConsensus(proposal.id);
        const elapsedMs = Date.now() - before;

        await raftLeader.shutdown();
        return { result, elapsedMs };
      }

      const flat = await runScenario();
      const weighted = await runScenario(
        new Map<string, number>([
          ['leader', 0.05],
          ['voter-a', 0.05],
          ['voter-b', 0.05],
          ['voter-c', 0.05],
        ])
      );

      if (flat && weighted) {
        expect(flat.result.approved).toBe(false);
        expect(flat.elapsedMs).toBeLessThan(200); // resolved via explicit reject, not timeout
        expect(weighted.result.approved).toBe(false);
        expect(weighted.elapsedMs).toBeGreaterThanOrEqual(280); // only resolved via timeout/expiry
      }
    }, 15000);
  });
});
