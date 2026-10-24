/**
 * Dream Cycle 2026-10-24 (swarm) — RaftConsensus.checkConsensus() quorum safety.
 *
 * `checkConsensus()` computed `quorum = Math.floor(totalVoters * threshold)`.
 * For small clusters (totalVoters 2 or 3, the default threshold 0.66), that
 * floors to 1 — exactly the weight of the leader's own unconditional
 * self-vote added in `propose()`. Since `checkConsensus()` only runs inside
 * `vote()`, the FIRST peer vote to arrive triggers the accept check — and
 * because `approvingWeight` already sits at 1 from the self-vote alone, the
 * proposal is accepted regardless of what that first vote actually says,
 * including an explicit `approve: false` rejection.
 *
 * Fix: `Math.ceil` instead of `Math.floor`, so quorum always requires at
 * least one approving vote beyond the leader's own for any cluster size,
 * matching the intent of `threshold` as a supermajority requirement rather
 * than one the leader can satisfy unilaterally.
 */
import { describe, it, expect } from 'vitest';
import { createRaftConsensus } from '../src/consensus/raft.js';
import type { ConsensusVote } from '../src/types.js';

async function electSelf(nodeId: string, peerIds: string[]) {
  const raft = createRaftConsensus(nodeId, {
    threshold: 0.66,
    timeoutMs: 1000,
    electionTimeoutMinMs: 50,
    electionTimeoutMaxMs: 100,
  });
  await raft.initialize();
  for (const p of peerIds) raft.addPeer(p);
  await new Promise(resolve => setTimeout(resolve, 150));
  return raft;
}

describe('RaftConsensus quorum safety (self-vote cannot satisfy quorum alone)', () => {
  it('a single peer rejection must not be overridden by the leader\'s own self-vote (2-voter cluster)', async () => {
    const raft = await electSelf('leader', ['voter-a']);
    if (!raft.isLeader()) {
      await raft.shutdown();
      return; // election didn't complete in time — matches existing suite's tolerant pattern
    }

    const proposal = await raft.propose({ decision: 'quorum-safety-2-voter' });
    const rejection: ConsensusVote = {
      voterId: 'voter-a',
      approve: false,
      confidence: 1.0,
      timestamp: new Date(),
    };
    await raft.vote(proposal.id, rejection);

    const result = await raft.awaitConsensus(proposal.id);

    // Baseline bug: quorum = floor(2*0.66) = 1, satisfied by the leader's own
    // self-vote alone, so this resolved approved:true despite the only cast
    // peer vote being an explicit rejection. Fixed: quorum = ceil(2*0.66) = 2,
    // which the self-vote alone cannot satisfy.
    expect(result.approved).toBe(false);

    await raft.shutdown();
  });

  it('a single peer rejection must not be overridden by the leader\'s own self-vote (3-voter cluster)', async () => {
    const raft = await electSelf('leader', ['voter-a', 'voter-b']);
    if (!raft.isLeader()) {
      await raft.shutdown();
      return;
    }

    const proposal = await raft.propose({ decision: 'quorum-safety-3-voter' });
    const before = Date.now();
    await raft.vote(proposal.id, {
      voterId: 'voter-a',
      approve: false,
      confidence: 1.0,
      timestamp: new Date(),
    });
    // Baseline bug: quorum = floor(3*0.66) = 1, satisfied by the self-vote
    // alone on the very first vote() call, so this single rejection was
    // enough for the pre-fix code to accept it right here. Fixed: quorum =
    // ceil(3*0.66) = 2 and the reject threshold is totalVoters-quorum = 1,
    // so one rejection alone (disapprovingWeight=1) doesn't cross it yet —
    // a second rejection is needed to reach an explicit, fast 'rejected'
    // transition rather than only disproving the bug via timeout/expiry.
    await raft.vote(proposal.id, {
      voterId: 'voter-b',
      approve: false,
      confidence: 1.0,
      timestamp: new Date(),
    });

    const result = await raft.awaitConsensus(proposal.id);
    const elapsedMs = Date.now() - before;

    expect(result.approved).toBe(false);
    // Resolved via an explicit 'rejected' transition (both rejects landed
    // well under the 1000ms timeoutMs), not by falling through to expiry —
    // stronger evidence than relying on the timeout path alone.
    expect(elapsedMs).toBeLessThan(500);

    await raft.shutdown();
  }, 10000);

  it('unanimous approval in a 2-voter cluster still accepts (positive control)', async () => {
    const raft = await electSelf('leader', ['voter-a']);
    if (!raft.isLeader()) {
      await raft.shutdown();
      return;
    }

    const proposal = await raft.propose({ decision: 'quorum-safety-positive-control' });
    await raft.vote(proposal.id, {
      voterId: 'voter-a',
      approve: true,
      confidence: 1.0,
      timestamp: new Date(),
    });

    const result = await raft.awaitConsensus(proposal.id);
    expect(result.approved).toBe(true);

    await raft.shutdown();
  });
});
