/**
 * @claude-flow/browser - MCTS Branch Types (ADR-122 Phase 4)
 *
 * Plan-MCTS / Agent Alpha style search where each branch explores a different
 * subtree of the action space. The novel wedge: branches can be distributed
 * across federation peers and the queen selects winners by HNSW cosine
 * similarity to past successful ReasoningBank trajectories.
 *
 * No SOTA web agent today distributes MCTS exploration across multiple
 * installations — every system is single-process. Federation primitives
 * (ADR-097/104) make this structurally available to ruflo only.
 */

import { z } from 'zod';

export const BranchStatusSchema = z.enum([
  'pending',
  'in-progress',
  'completed',
  'failed',
  'rejected-bad-signature',
  'rejected-budget',
  'terminated',
]);
export type BranchStatus = z.infer<typeof BranchStatusSchema>;

export const McTsBranchSchema = z.object({
  /** Branch ID — unique within an exploration run. */
  id: z.string().min(1),
  /** Run ID — groups branches belonging to one MCTS exploration. */
  runId: z.string().min(1),
  /** Parent branch ID (root has parent = null). */
  parentId: z.string().nullable(),
  /** Peer assigned to explore this branch (local or federation). */
  peerId: z.string().min(1),
  /** Action this branch represents (open/click/fill/...). */
  action: z.string().min(1),
  /** Inputs for that action. */
  input: z.record(z.unknown()),
  /** Depth in the tree (root = 0). */
  depth: z.number().int().nonnegative(),
  /** Number of times this branch has been selected by UCB1. */
  visits: z.number().int().nonnegative(),
  /** Accumulated value (sum of trajectory similarity scores). */
  totalValue: z.number().nonnegative(),
  /** Status of this branch. */
  status: BranchStatusSchema,
  /** ID of the signed trajectory this branch produced (when completed). */
  trajectoryId: z.string().optional(),
  /** Cost (USD) reported back by the peer for this branch. */
  costUsd: z.number().nonnegative().default(0),
  /** When the branch was created. */
  createdAt: z.string(),
  /** When the branch completed (or failed). */
  completedAt: z.string().optional(),
});
export type McTsBranch = z.infer<typeof McTsBranchSchema>;

/** Result of an exploration run — best branch + aggregate stats. */
export interface MctsRunResult {
  runId: string;
  /** ID of the winning branch (best score). */
  bestBranchId: string;
  /** Total branches explored across all peers. */
  totalBranches: number;
  /** Branches per peer. */
  branchesByPeer: Record<string, number>;
  /** Total USD spend across all peers. */
  totalCostUsd: number;
  /** Branches rejected for signature failure (per-peer blacklist signal). */
  rejectedSignatures: string[];
  /** Branches rejected because their peer exceeded budget. */
  rejectedBudget: string[];
}

/** UCB1 selection criteria parameters. */
export interface UcbParams {
  /** Exploration constant. Higher = wider exploration. Default 1.41 (sqrt(2)). */
  c: number;
}

/** Federation peer adapter — abstract over local vs remote execution. */
export interface PeerAdapter {
  id: string;
  /** Hint to the queen: per-call budget cap in USD. */
  budgetUsd: number;
  /** Execute a single branch action and return a signed trajectory envelope. */
  execute(branch: McTsBranch): Promise<{
    trajectoryEnvelope: unknown;
    /** True iff trajectory's signature verified locally on the peer's side. */
    selfVerified: boolean;
    /** Cost actually incurred. */
    costUsd: number;
  }>;
}

/** Value function — scores a completed trajectory against past successes. */
export interface ValueScorer {
  /** Return a score in [0,1]. Higher = closer to known successful trajectories. */
  score(trajectoryEnvelope: unknown, goal: string): Promise<number>;
}
