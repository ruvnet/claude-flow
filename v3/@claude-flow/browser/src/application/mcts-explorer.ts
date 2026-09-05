/**
 * @claude-flow/browser - MCTS Explorer (ADR-122 Phase 4)
 *
 * Coordinates branch expansion + UCB1 selection across one or more peers.
 * Every completed branch must produce a trajectory that passes Phase 1
 * verification (`verifySealedTrajectory`) — peers returning unverifiable
 * trajectories are blacklisted for the remainder of the run.
 *
 * Phase 4 ships the explorer; the federation transport (ADR-097/104) plugs
 * in via the PeerAdapter interface. A LocalPeerAdapter for in-process
 * exploration is included so the explorer is usable without a federation.
 */

import { randomBytes } from 'node:crypto';
import { verifySealedTrajectory } from './signed-trajectory-service.js';
import {
  McTsBranchSchema,
  type McTsBranch,
  type MctsRunResult,
  type PeerAdapter,
  type UcbParams,
  type ValueScorer,
} from '../domain/mcts-branch.js';

export interface MctsExplorerOptions {
  /** Peers to distribute exploration across. Must include at least one. */
  peers: PeerAdapter[];
  /** Value scorer. */
  scorer: ValueScorer;
  /** Maximum depth of the search tree. */
  maxDepth?: number;
  /** Maximum total branches per run. */
  maxBranches?: number;
  /** Per-peer budget cap (USD) — exceeded peers are excluded for rest of run. */
  defaultPeerBudgetUsd?: number;
  /** UCB1 parameters. */
  ucb?: UcbParams;
  /** Trusted public keys for trajectory verification. Empty = accept any valid signature. */
  trustedPublicKeys?: string[];
}

/** Initial action spec to seed the root branch. */
export interface RootAction {
  action: string;
  input: Record<string, unknown>;
}

/** Expansion hook: given a parent branch + its trajectory, return candidate next actions. */
export type ExpansionPolicy = (
  parent: McTsBranch,
  trajectoryEnvelope: unknown,
) => Promise<RootAction[]>;

export class MctsExplorer {
  private readonly peers: PeerAdapter[];
  private readonly scorer: ValueScorer;
  private readonly maxDepth: number;
  private readonly maxBranches: number;
  private readonly defaultPeerBudgetUsd: number;
  private readonly ucb: UcbParams;
  private readonly trustedPublicKeys: string[];

  private branches: Map<string, McTsBranch> = new Map();
  private peerSpend: Map<string, number> = new Map();
  private peerBlacklist: Set<string> = new Set();
  private peerSignatureBlacklist: Set<string> = new Set();

  constructor(options: MctsExplorerOptions) {
    if (options.peers.length === 0) throw new Error('MctsExplorer requires at least one peer');
    this.peers = options.peers;
    this.scorer = options.scorer;
    this.maxDepth = options.maxDepth ?? 5;
    this.maxBranches = options.maxBranches ?? 32;
    this.defaultPeerBudgetUsd = options.defaultPeerBudgetUsd ?? 1.0;
    this.ucb = options.ucb ?? { c: Math.SQRT2 };
    this.trustedPublicKeys = options.trustedPublicKeys ?? [];
  }

  /** Explore from a seed root action. Returns the winning branch's ID + aggregate stats. */
  async explore(input: {
    rootAction: RootAction;
    goal: string;
    expansionPolicy: ExpansionPolicy;
  }): Promise<MctsRunResult> {
    const runId = 'run-' + Date.now() + '-' + randomBytes(3).toString('hex');
    const rootId = 'br-root-' + randomBytes(3).toString('hex');
    const rootPeer = this.pickPeer();
    if (!rootPeer) throw new Error('no eligible peers for exploration');

    const root: McTsBranch = McTsBranchSchema.parse({
      id: rootId,
      runId,
      parentId: null,
      peerId: rootPeer.id,
      action: input.rootAction.action,
      input: input.rootAction.input,
      depth: 0,
      visits: 0,
      totalValue: 0,
      status: 'pending',
      costUsd: 0,
      createdAt: new Date().toISOString(),
    });
    this.branches.set(rootId, root);

    // Execute and expand iteratively. Counter is # of EXECUTIONS (not # of
    // branches in tree) — maxBranches reflects "how many we will actually run."
    let executed = 0;
    while (executed < this.maxBranches) {
      const next = this.selectByUcb1(runId);
      if (!next) break;

      const peer = this.peers.find(p => p.id === next.peerId && !this.peerBlacklist.has(p.id));
      if (!peer) {
        next.status = 'rejected-budget';
        next.completedAt = new Date().toISOString();
        this.branches.set(next.id, next);
        continue;
      }

      // Budget check — count BEFORE-this-call spend
      const currentSpend = this.peerSpend.get(peer.id) ?? 0;
      const cap = peer.budgetUsd ?? this.defaultPeerBudgetUsd;
      if (currentSpend >= cap) {
        next.status = 'rejected-budget';
        next.completedAt = new Date().toISOString();
        this.branches.set(next.id, next);
        this.peerBlacklist.add(peer.id);
        continue;
      }

      // Execute the branch
      next.status = 'in-progress';
      this.branches.set(next.id, next);

      let execution: Awaited<ReturnType<PeerAdapter['execute']>>;
      try {
        execution = await peer.execute(next);
      } catch (err) {
        next.status = 'failed';
        next.completedAt = new Date().toISOString();
        this.branches.set(next.id, next);
        continue;
      }

      this.peerSpend.set(peer.id, currentSpend + execution.costUsd);
      next.costUsd = execution.costUsd;
      executed++;

      // Mark peer blacklisted post-call if THIS call put us at/over budget — guards
      // against further attempts on this peer.
      if (currentSpend + execution.costUsd >= cap) {
        this.peerBlacklist.add(peer.id);
      }

      // Verify the trajectory — peers returning invalid signatures get blacklisted
      const verification = verifySealedTrajectory(execution.trajectoryEnvelope, {
        trustedPublicKeys: this.trustedPublicKeys.length > 0 ? this.trustedPublicKeys : undefined,
      });
      if (!verification.valid) {
        next.status = 'rejected-bad-signature';
        next.completedAt = new Date().toISOString();
        this.branches.set(next.id, next);
        this.peerSignatureBlacklist.add(peer.id);
        this.peerBlacklist.add(peer.id);
        continue;
      }

      // Score it
      const score = await this.scorer.score(execution.trajectoryEnvelope, input.goal);
      next.totalValue += score;
      next.visits += 1;
      next.status = 'completed';
      next.trajectoryId = extractTrajectoryId(execution.trajectoryEnvelope);
      next.completedAt = new Date().toISOString();
      this.branches.set(next.id, next);

      // Backprop: increment parent visits + propagate score
      this.backprop(next.id, score);

      // Expand: ask policy for next candidate actions
      if (next.depth < this.maxDepth) {
        const candidates = await input.expansionPolicy(next, execution.trajectoryEnvelope);
        for (const candidate of candidates) {
          if (this.branches.size >= this.maxBranches) break;
          const childId = 'br-' + randomBytes(3).toString('hex');
          const childPeer = this.pickPeer();
          if (!childPeer) break;
          this.branches.set(
            childId,
            McTsBranchSchema.parse({
              id: childId,
              runId,
              parentId: next.id,
              peerId: childPeer.id,
              action: candidate.action,
              input: candidate.input,
              depth: next.depth + 1,
              visits: 0,
              totalValue: 0,
              status: 'pending',
              costUsd: 0,
              createdAt: new Date().toISOString(),
            }),
          );
        }
      }
    }

    // Finalize any leftover pending branches — typically the tree was expanded
    // beyond the execution budget. Mark each according to peer-blacklist status.
    for (const branch of this.listBranches(runId)) {
      if (branch.status !== 'pending') continue;
      if (this.peerBlacklist.has(branch.peerId)) {
        branch.status = 'rejected-budget';
      } else {
        branch.status = 'terminated';
      }
      branch.completedAt = new Date().toISOString();
      this.branches.set(branch.id, branch);
    }

    return this.summarizeRun(runId);
  }

  /** Direct branch lookup. */
  getBranch(id: string): McTsBranch | undefined {
    return this.branches.get(id);
  }

  listBranches(runId: string): McTsBranch[] {
    return [...this.branches.values()].filter(b => b.runId === runId);
  }

  /** UCB1 selection over pending branches. */
  private selectByUcb1(runId: string): McTsBranch | null {
    const pending = this.listBranches(runId).filter(b => b.status === 'pending');
    if (pending.length === 0) return null;

    const totalVisits = Math.max(
      1,
      this.listBranches(runId).reduce((acc, b) => acc + b.visits, 0),
    );
    let best: McTsBranch | null = null;
    let bestScore = -Infinity;
    for (const b of pending) {
      const score = ucb1(b, totalVisits, this.ucb.c);
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  /** Propagate score back up the parent chain (no decay for now). */
  private backprop(branchId: string, score: number): void {
    let cursor = this.branches.get(branchId);
    while (cursor?.parentId) {
      const parent = this.branches.get(cursor.parentId);
      if (!parent) break;
      parent.visits += 1;
      parent.totalValue += score;
      this.branches.set(parent.id, parent);
      cursor = parent;
    }
  }

  /** Round-robin peer picker skipping blacklisted peers. */
  private pickPeer(): PeerAdapter | null {
    const eligible = this.peers.filter(p => !this.peerBlacklist.has(p.id));
    if (eligible.length === 0) return null;
    // Pick the peer with the lowest cumulative spend (load balance).
    eligible.sort((a, b) => (this.peerSpend.get(a.id) ?? 0) - (this.peerSpend.get(b.id) ?? 0));
    return eligible[0];
  }

  private summarizeRun(runId: string): MctsRunResult {
    const branches = this.listBranches(runId);
    const completed = branches.filter(b => b.status === 'completed');
    let best: McTsBranch | undefined;
    let bestAvg = -Infinity;
    for (const b of completed) {
      const avg = b.visits > 0 ? b.totalValue / b.visits : 0;
      if (avg > bestAvg) {
        bestAvg = avg;
        best = b;
      }
    }
    const branchesByPeer: Record<string, number> = {};
    for (const b of branches) branchesByPeer[b.peerId] = (branchesByPeer[b.peerId] ?? 0) + 1;
    const totalCostUsd = [...this.peerSpend.values()].reduce((acc, n) => acc + n, 0);

    return {
      runId,
      bestBranchId: best?.id ?? '',
      totalBranches: branches.length,
      branchesByPeer,
      totalCostUsd,
      rejectedSignatures: branches.filter(b => b.status === 'rejected-bad-signature').map(b => b.id),
      rejectedBudget: branches.filter(b => b.status === 'rejected-budget').map(b => b.id),
    };
  }
}

/** UCB1: exploitation + sqrt(c * ln(N) / n_i). For unvisited nodes return Infinity. */
export function ucb1(branch: McTsBranch, totalVisits: number, c: number): number {
  if (branch.visits === 0) return Number.POSITIVE_INFINITY;
  const exploitation = branch.totalValue / branch.visits;
  const exploration = c * Math.sqrt(Math.log(totalVisits) / branch.visits);
  return exploitation + exploration;
}

function extractTrajectoryId(envelope: unknown): string | undefined {
  if (envelope && typeof envelope === 'object' && 'payload' in envelope) {
    const payload = (envelope as { payload?: { trajectoryId?: string } }).payload;
    return payload?.trajectoryId;
  }
  return undefined;
}
