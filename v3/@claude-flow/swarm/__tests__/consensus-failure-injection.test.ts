/**
 * ADR-095 G2 — failure-injection tests.
 *
 * Drives multi-node consensus over a shared LocalTransportRegistry with
 * some nodes silenced (their inbound handler is replaced with a no-op so
 * they receive messages but never participate). Asserts:
 *   - BFT: consensus is reached with ≤ f faulty (f = floor((n-1)/3)),
 *     and NOT reached with > f faulty.
 *   - Raft: a candidate wins the election with a majority of votes,
 *     and loses it when too many peers are silent.
 */
import { describe, it, expect } from 'vitest';
import { ByzantineConsensus } from '../src/consensus/byzantine.js';
import { RaftConsensus } from '../src/consensus/raft.js';
import { LocalTransport, LocalTransportRegistry } from '../src/consensus/transport.js';

// ---------------------------------------------------------------------------
// Byzantine — PBFT prepare/commit quorum under f-bounded faults
// ---------------------------------------------------------------------------

/**
 * Build one ByzantineConsensus node with `peerCount` known peers (so
 * byzantineF() = floor(((peerCount+1)-1)/3)), then feed it `prepareSenders`
 * distinct prepare messages followed by `commitSenders` distinct commit
 * messages for the same (view, seq). Returns whether `consensus.achieved`
 * fired (i.e., commitCount reached 2f+1). This tests the threshold without
 * relying on a full multi-node cascade.
 */
async function injectQuorum(opts: {
  peerCount: number;
  prepareSenders: string[];
  commitSenders: string[];
  maxFaultyNodes?: number;
}): Promise<{ achieved: boolean; f: number }> {
  const reg = new LocalTransportRegistry();
  const t = new LocalTransport('node', { registry: reg });
  const driver = new LocalTransport('driver', { registry: reg });
  const bft = new ByzantineConsensus('node', { transport: t, ...(opts.maxFaultyNodes !== undefined ? { maxFaultyNodes: opts.maxFaultyNodes } : {}) });
  for (let i = 0; i < opts.peerCount; i++) bft.addNode(`peer${i}`, i === 0);
  // Seed the proposal so handleCommit can flip it to 'accepted'.
  const digest = 'd'.repeat(64);
  const base = { viewNumber: 0, sequenceNumber: 1, digest, timestamp: new Date().toISOString() };
  // pre-prepare creates the proposal on this node.
  await driver.send('node', { type: 'pre-prepare', payload: { type: 'pre-prepare', ...base, payload: { v: 1 } }, viewNumber: 0 });

  let achieved = false;
  bft.on('consensus.achieved', () => { achieved = true; });
  const f = (bft as unknown as { byzantineF: () => number }).byzantineF();

  // Inject prepares from distinct senders.
  for (const sid of opts.prepareSenders) {
    // Each must come from a distinct `from` so dedup-by-senderId counts it.
    const dt = new LocalTransport(`p_${sid}`, { registry: reg });
    await dt.send('node', { type: 'prepare', payload: { type: 'prepare', ...base }, viewNumber: 0 });
    await dt.close();
  }
  // Inject commits from distinct senders.
  for (const sid of opts.commitSenders) {
    const dt = new LocalTransport(`c_${sid}`, { registry: reg });
    await dt.send('node', { type: 'commit', payload: { type: 'commit', ...base }, viewNumber: 0 });
    await dt.close();
  }

  await bft.shutdown(); await t.close(); await driver.close();
  return { achieved, f };
}

// Note on accounting: the node under test contributes 1 prepare (via the
// pre-prepare self-handle) and, once prepareCount hits 2f+1, 1 commit (via
// the prepare→commit self-handle). So `prepareSenders.length` external
// prepares + the node's own = `len+1`; same for commits. To hit a 2f+1
// quorum the test injects `2f` external messages of each kind.
describe('ADR-095 G2 — BFT prepare/commit quorum under f-bounded faults', () => {
  it('4-node cluster (f=1): 2f external prepares + 2f external commits → quorum 2f+1 reached', async () => {
    const { achieved, f } = await injectQuorum({ peerCount: 3, prepareSenders: ['s1', 's2'], commitSenders: ['s1', 's2'] });
    expect(f).toBe(1);
    expect(achieved).toBe(true); // node + 2 = 3 = 2f+1
  });

  it('4-node cluster (f=1): only 1 external commit (one node faulty) → NOT reached', async () => {
    const { achieved, f } = await injectQuorum({ peerCount: 3, prepareSenders: ['s1', 's2'], commitSenders: ['s1'] });
    expect(f).toBe(1);
    expect(achieved).toBe(false); // node + 1 = 2 < 2f+1
  });

  it('7-node cluster (f=2): 2f external prepares + 2f external commits → quorum 2f+1=5 reached', async () => {
    const { achieved, f } = await injectQuorum({ peerCount: 6, prepareSenders: ['s1', 's2', 's3', 's4'], commitSenders: ['s1', 's2', 's3', 's4'] });
    expect(f).toBe(2);
    expect(achieved).toBe(true); // node + 4 = 5 = 2f+1
  });

  it('7-node cluster (f=2): only 3 external commits (two faulty) → NOT reached', async () => {
    const { achieved, f } = await injectQuorum({ peerCount: 6, prepareSenders: ['s1', 's2', 's3', 's4'], commitSenders: ['s1', 's2', 's3'] });
    expect(f).toBe(2);
    expect(achieved).toBe(false); // node + 3 = 4 < 5
  });

  it('config.maxFaultyNodes caps f: 10-node cluster + cap 1 still rejects only 3 commit messages', async () => {
    const { achieved, f } = await injectQuorum({ peerCount: 9, maxFaultyNodes: 1, prepareSenders: ['s1', 's2'], commitSenders: ['s1', 's2'] });
    expect(f).toBe(1); // capped, not floor(9/3)=3
    expect(achieved).toBe(false);
  });

  it('10-node cluster + cap 1 reaches its six-message intersecting quorum', async () => {
    const senders = ['s1', 's2', 's3', 's4', 's5'];
    const { achieved, f } = await injectQuorum({ peerCount: 9, maxFaultyNodes: 1, prepareSenders: senders, commitSenders: senders });
    expect(f).toBe(1);
    expect(achieved).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// Raft — election under majority/minority of votes
// ---------------------------------------------------------------------------

/**
 * Drive a single RequestVote round from `candidate` to all `voters` over
 * the transport and tally grants. `silent` voters get a no-op handler so
 * they never reply (the candidate's `send` to them times out → no vote).
 * Returns the grant count (including the candidate's implicit self-vote).
 */
async function tallyVotes(candidateId: string, voterIds: string[], silent: Set<string>, term: number): Promise<number> {
  const reg = new LocalTransportRegistry();
  const transports: LocalTransport[] = [];
  const nodes = new Map<string, RaftConsensus>();
  const allIds = [candidateId, ...voterIds];
  for (const id of allIds) {
    const t = new LocalTransport(id, { registry: reg, defaultTimeoutMs: 100 });
    transports.push(t);
    const r = new RaftConsensus(id, { transport: t });
    for (const other of allIds) if (other !== id) r.addPeer(other);
    nodes.set(id, r);
  }
  for (const id of silent) transports.find(t => t.nodeId === id)!.onMessage(() => { /* silent: never reply */ });

  let grants = 1; // self-vote
  const candT = transports.find(t => t.nodeId === candidateId)!;
  await Promise.all(voterIds.map(async (vid) => {
    try {
      const reply = await candT.send(vid, { type: 'request-vote', payload: { term, candidateId, lastLogIndex: 0, lastLogTerm: 0 }, term }, 100);
      if ((reply?.payload as { granted?: boolean })?.granted === true) grants++;
    } catch { /* timeout → no vote */ }
  }));

  for (const n of nodes.values()) await n.shutdown();
  for (const t of transports) await t.close();
  return grants;
}

describe('ADR-095 G2 — Raft election under vote majority/minority', () => {
  it('5-node cluster, all 4 voters reply → candidate gets 5 votes (majority is 3)', async () => {
    const grants = await tallyVotes('n1', ['n2', 'n3', 'n4', 'n5'], new Set(), 1);
    expect(grants).toBe(5);
    expect(grants).toBeGreaterThanOrEqual(3); // wins
  });

  it('5-node cluster, 2 voters silent → candidate still gets 3 votes (majority) → wins', async () => {
    const grants = await tallyVotes('n1', ['n2', 'n3', 'n4', 'n5'], new Set(['n4', 'n5']), 1);
    expect(grants).toBe(3);
    expect(grants).toBeGreaterThanOrEqual(3);
  });

  it('5-node cluster, 3 voters silent → candidate gets only 2 votes (< majority) → loses', async () => {
    const grants = await tallyVotes('n1', ['n2', 'n3', 'n4', 'n5'], new Set(['n3', 'n4', 'n5']), 1);
    expect(grants).toBe(2);
    expect(grants).toBeLessThan(3);
  });
});
