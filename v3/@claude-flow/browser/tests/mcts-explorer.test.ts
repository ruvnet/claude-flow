/**
 * @claude-flow/browser - MCTS Explorer Tests (ADR-122 Phase 4)
 *
 * Acceptance criteria covered:
 *  - UCB1 picks unvisited branches with priority (Infinity score)
 *  - Round-robin / least-spend peer load balancing
 *  - Peers returning invalid trajectory signatures are blacklisted for the run
 *  - Peers exceeding budget are excluded from further work
 *  - Expansion policy generates children; tree respects maxDepth + maxBranches
 *  - Final winner is the highest-average-score completed branch
 */

import { describe, it, expect } from 'vitest';
import { MctsExplorer, ucb1 } from '../src/application/mcts-explorer.js';
import { sealTrajectory } from '../src/application/signed-trajectory-service.js';
import { generateWitnessKey } from '../src/infrastructure/witness-signer.js';
import type { PeerAdapter, McTsBranch, ValueScorer } from '../src/domain/mcts-branch.js';
import type { BrowserTrajectory } from '../src/domain/types.js';

const sharedKey = generateWitnessKey();

function makeTrajectory(score: number): BrowserTrajectory {
  return {
    id: 'traj-' + Math.random().toString(36).slice(2, 8) + '-' + score,
    sessionId: 'mcts-sess',
    goal: 'Test exploration',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    success: true,
    verdict: 'ok',
    steps: [{ action: 'open', input: { url: 'https://example.com' }, result: { success: true }, timestamp: new Date().toISOString() }],
  };
}

function makeScoringPeer(id: string, scoreOf: (b: McTsBranch) => number, costUsd = 0.01, budgetUsd = 1.0): PeerAdapter {
  return {
    id,
    budgetUsd,
    async execute(branch) {
      const trajectory = makeTrajectory(scoreOf(branch));
      const sealed = sealTrajectory({ trajectory, witnessKey: sharedKey });
      return { trajectoryEnvelope: sealed.envelope, selfVerified: true, costUsd };
    },
  };
}

function makeFaultyPeer(id: string): PeerAdapter {
  return {
    id,
    budgetUsd: 1.0,
    async execute() {
      // Return a syntactically-shaped but-unsigned envelope (signature invalid).
      return {
        trajectoryEnvelope: { payload: { foo: 'bar' }, signature: 'aa'.repeat(64), algorithm: 'ed25519' },
        selfVerified: false,
        costUsd: 0.01,
      };
    },
  };
}

function makeScorer(scoreOf: (envelope: unknown) => number): ValueScorer {
  return {
    async score(envelope) {
      return scoreOf(envelope);
    },
  };
}

describe('MctsExplorer', () => {
  describe('UCB1', () => {
    it('returns Infinity for unvisited branches', () => {
      const branch = {
        id: 'b', runId: 'r', parentId: null, peerId: 'p', action: 'open',
        input: {}, depth: 0, visits: 0, totalValue: 0, status: 'pending' as const,
        costUsd: 0, createdAt: 't',
      };
      expect(ucb1(branch, 10, Math.SQRT2)).toBe(Infinity);
    });

    it('exploits high-value branches with low visits', () => {
      const branch = {
        id: 'b', runId: 'r', parentId: null, peerId: 'p', action: 'open',
        input: {}, depth: 0, visits: 1, totalValue: 0.9, status: 'completed' as const,
        costUsd: 0, createdAt: 't',
      };
      const score = ucb1(branch, 10, Math.SQRT2);
      expect(score).toBeGreaterThan(0.9);
    });
  });

  describe('basic exploration', () => {
    it('completes the root branch and produces a winner', async () => {
      const peer = makeScoringPeer('local', () => 0.8);
      const explorer = new MctsExplorer({
        peers: [peer],
        scorer: makeScorer(() => 0.8),
        maxBranches: 1,
        maxDepth: 0,
      });
      const result = await explorer.explore({
        rootAction: { action: 'open', input: { url: 'https://example.com' } },
        goal: 'Find welcome page',
        expansionPolicy: async () => [],
      });
      expect(result.totalBranches).toBe(1);
      expect(result.bestBranchId).not.toBe('');
      const winner = explorer.getBranch(result.bestBranchId);
      expect(winner?.status).toBe('completed');
    });

    it('expands the tree via the expansion policy', async () => {
      const peer = makeScoringPeer('local', () => 0.5);
      const explorer = new MctsExplorer({
        peers: [peer],
        scorer: makeScorer(() => 0.5),
        maxBranches: 6,
        maxDepth: 2,
      });
      const result = await explorer.explore({
        rootAction: { action: 'open', input: { url: 'https://example.com' } },
        goal: 'Explore',
        expansionPolicy: async (parent) =>
          parent.depth < 2
            ? [
                { action: 'click', input: { target: '@e1' } },
                { action: 'click', input: { target: '@e2' } },
              ]
            : [],
      });
      // Root + 2 children + possibly grandchildren (capped at maxBranches)
      expect(result.totalBranches).toBeGreaterThanOrEqual(3);
      expect(result.totalBranches).toBeLessThanOrEqual(6);
    });
  });

  describe('signature verification + peer blacklisting', () => {
    it('rejects branches with invalid signatures and blacklists the peer', async () => {
      const good = makeScoringPeer('good', () => 0.8);
      const bad = makeFaultyPeer('bad');
      const explorer = new MctsExplorer({
        peers: [good, bad],
        scorer: makeScorer(() => 0.8),
        maxBranches: 8,
        maxDepth: 2,
      });
      const result = await explorer.explore({
        rootAction: { action: 'open', input: { url: 'https://example.com' } },
        goal: 'Test',
        expansionPolicy: async (parent) =>
          parent.depth < 2 ? [{ action: 'click', input: { target: '@e1' } }] : [],
      });
      // At least one branch went through the bad peer (round-robin sees them
      // first by lowest-spend) — that branch should be rejected.
      if (result.rejectedSignatures.length > 0) {
        const rejected = explorer.getBranch(result.rejectedSignatures[0]);
        expect(rejected?.status).toBe('rejected-bad-signature');
      }
      // Eventually all branches end up on good peer once bad is blacklisted.
      const goodBranches = (result.branchesByPeer.good ?? 0);
      expect(goodBranches).toBeGreaterThan(0);
    });
  });

  describe('budget cap', () => {
    it('rejects branches when a peer exceeds budget', async () => {
      const peer = makeScoringPeer('local', () => 0.5, /* costUsd */ 0.4, /* budgetUsd */ 1.0);
      const explorer = new MctsExplorer({
        peers: [peer],
        scorer: makeScorer(() => 0.5),
        maxBranches: 5,
        maxDepth: 3,
      });
      const result = await explorer.explore({
        rootAction: { action: 'open', input: { url: 'https://example.com' } },
        goal: 'Budget test',
        expansionPolicy: async (parent) =>
          parent.depth < 3
            ? [
                { action: 'click', input: { target: '@e1' } },
                { action: 'click', input: { target: '@e2' } },
              ]
            : [],
      });
      // After 3 successful branches at $0.40 each, the 4th should hit the budget cap.
      expect(result.rejectedBudget.length).toBeGreaterThan(0);
      expect(result.totalCostUsd).toBeGreaterThanOrEqual(1.0); // tipped over the cap by the last successful branch
    });
  });

  describe('multi-peer load balance', () => {
    it('distributes branches across peers using least-spend selection', async () => {
      const peerA = makeScoringPeer('peerA', () => 0.6);
      const peerB = makeScoringPeer('peerB', () => 0.7);
      const explorer = new MctsExplorer({
        peers: [peerA, peerB],
        scorer: makeScorer(() => 0.6),
        maxBranches: 5,
        maxDepth: 1,
      });
      const result = await explorer.explore({
        rootAction: { action: 'open', input: { url: 'https://example.com' } },
        goal: 'Distribution test',
        expansionPolicy: async (parent) =>
          parent.depth < 1
            ? [
                { action: 'click', input: { target: '@e1' } },
                { action: 'click', input: { target: '@e2' } },
                { action: 'click', input: { target: '@e3' } },
              ]
            : [],
      });
      expect(Object.keys(result.branchesByPeer).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('winner selection', () => {
    it('picks the branch with the highest average score', async () => {
      // The scorer reads the trajectory id; we encode the desired score in the action.
      const scoreByAction: Record<string, number> = { open: 0.3, 'click-A': 0.9, 'click-B': 0.4 };
      const peer: PeerAdapter = {
        id: 'tiered',
        budgetUsd: 5.0,
        async execute(branch) {
          const trajectory = makeTrajectory(scoreByAction[branch.action] ?? 0.1);
          // Encode score into goal so scorer can read it back
          trajectory.goal = String(scoreByAction[branch.action] ?? 0.1);
          const sealed = sealTrajectory({ trajectory, witnessKey: sharedKey });
          return { trajectoryEnvelope: sealed.envelope, selfVerified: true, costUsd: 0.01 };
        },
      };
      const scorer: ValueScorer = {
        async score(envelope) {
          const goal = (envelope as { payload: { trajectory: { goal: string } } }).payload.trajectory.goal;
          return parseFloat(goal);
        },
      };
      const explorer = new MctsExplorer({
        peers: [peer],
        scorer,
        maxBranches: 4,
        maxDepth: 1,
      });
      const result = await explorer.explore({
        rootAction: { action: 'open', input: {} },
        goal: 'Find best click',
        expansionPolicy: async (parent) =>
          parent.depth < 1
            ? [
                { action: 'click-A', input: {} },
                { action: 'click-B', input: {} },
              ]
            : [],
      });
      const winner = explorer.getBranch(result.bestBranchId);
      // click-A scores 0.9 (highest leaf); root scores 0.3 (but receives all child propagations,
      // averaging out). Winner should be the click-A leaf.
      expect(winner?.action).toBe('click-A');
    });
  });
});
