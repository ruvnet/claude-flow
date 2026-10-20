/**
 * Discriminating tests for RaftConsensus.awaitConsensus()'s busy-poll -> event-driven fix.
 *
 * Prior behavior: awaitConsensus() polled `this.proposals` via `setInterval(..., 10)`
 * even though checkConsensus() already emits 'consensus.achieved' on every
 * accept/reject transition. Fixed to resolve from that event (plus a single
 * setTimeout for expiry) instead of polling.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { RaftConsensus, createRaftConsensus } from '../src/consensus/raft.js';
import type { ConsensusVote } from '../src/types.js';

describe('RaftConsensus.awaitConsensus() - event-driven resolution', () => {
  let leader: RaftConsensus | undefined;

  afterEach(async () => {
    if (leader) {
      await leader.shutdown();
      leader = undefined;
    }
  });

  async function createElectedLeader(config: Parameters<typeof createRaftConsensus>[1] = {}) {
    const node = createRaftConsensus('evt-leader', {
      threshold: 0.66,
      timeoutMs: 5000,
      electionTimeoutMinMs: 50,
      electionTimeoutMaxMs: 100,
      heartbeatIntervalMs: 25,
      ...config,
    });
    await node.initialize();
    node.addPeer('evt-peer');
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(node.isLeader()).toBe(true);
    return node;
  }

  it('resolves a pending proposal via the consensus.achieved event, never via setInterval polling', async () => {
    leader = await createElectedLeader();
    const proposal = await leader.propose({ action: 'commit' });

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    // awaitConsensus() starts while the proposal is still 'pending' - the vote
    // (and the resulting quorum) arrives only after this call is already in flight.
    const awaitPromise = leader.awaitConsensus(proposal.id);

    await new Promise(resolve => setTimeout(resolve, 5));
    const vote: ConsensusVote = {
      voterId: 'evt-peer',
      approve: true,
      confidence: 1.0,
      timestamp: new Date(),
    };
    await leader.vote(proposal.id, vote);

    const result = await awaitPromise;

    expect(result.approved).toBe(true);
    expect(result.proposalId).toBe(proposal.id);
    // Discriminates old (busy-poll) vs new (event-driven) implementation: the old
    // code created a setInterval on every awaitConsensus() call; the new one never does.
    expect(setIntervalSpy).not.toHaveBeenCalled();

    setIntervalSpy.mockRestore();
  });

  it('returns immediately (no event wait needed) when the proposal already resolved before awaitConsensus is called', async () => {
    leader = await createElectedLeader();
    const proposal = await leader.propose({ action: 'commit' });

    const vote: ConsensusVote = {
      voterId: 'evt-peer',
      approve: true,
      confidence: 1.0,
      timestamp: new Date(),
    };
    await leader.vote(proposal.id, vote);

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const start = Date.now();
    const result = await leader.awaitConsensus(proposal.id);
    const elapsed = Date.now() - start;

    expect(result.approved).toBe(true);
    expect(elapsed).toBeLessThan(10);
    expect(setIntervalSpy).not.toHaveBeenCalled();

    setIntervalSpy.mockRestore();
  });

  it('expires via a single timer after the real timeout elapses, without ever polling', async () => {
    leader = await createElectedLeader({ timeoutMs: 60 });
    const proposal = await leader.propose({ action: 'commit' });

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    // No vote ever arrives - quorum is never reached, so this must resolve
    // (not reject) with status 'expired' once the configured timeout elapses.
    const result = await leader.awaitConsensus(proposal.id);

    expect(result.proposalId).toBe(proposal.id);
    expect(result.approved).toBe(false);
    expect(setIntervalSpy).not.toHaveBeenCalled();

    setIntervalSpy.mockRestore();
  });

  it('rejects immediately for an unknown proposal id (preserves pre-existing behavior)', async () => {
    leader = await createElectedLeader();

    await expect(leader.awaitConsensus('does-not-exist')).rejects.toThrow(
      'Proposal does-not-exist not found'
    );
  });
});
