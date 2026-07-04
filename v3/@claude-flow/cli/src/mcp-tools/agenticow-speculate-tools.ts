/**
 * agenticow speculate — MCP surface for speculative branch-and-promote
 * (agenticow step 4).
 *
 * Exposes the `SpeculativeExploration` module as a single MCP tool
 * `agenticow_speculate` so agents can drive parallel A/B memory exploration:
 * fan out N candidate ingest-sets, each on its own 162-byte COW branch of a
 * shared base `.rvf`, score them by a probe query, PROMOTE the winner into
 * base, and DISCARD the losers (delete their branch files).
 *
 * Because MCP inputs are JSON (not JS functions), candidates are DECLARATIVE:
 * each candidate is a label + a set of vectors to ingest, and scoring is a
 * probe query (`nearest`) or an ingest count (`count`). The generic
 * `explore(base, {label, fn}[], score)` core does the real work.
 *
 * Optional-dep contract (mirrors agenticow-tools.ts): when `agenticow` is not
 * installed the tool returns `{success:true, degraded:true,
 * reason:'agenticow-not-found'}` and never throws for that reason.
 *
 * @module @claude-flow/cli/mcp-tools/agenticow-speculate
 */

import type { MCPTool } from './types.js';
import {
  loadAgenticow,
  degradedResult,
  resolveMemoryPath,
  openWithLineage,
  manifestFor,
  validateLabel,
} from './agenticow-loader.js';
import {
  explore,
  type SpeculativeCandidate,
} from '../agenticow/speculative-exploration.js';

interface IngestRecordInput {
  id?: number;
  vector: number[];
  text?: string;
}

interface CandidateInput {
  label: string;
  ingest: IngestRecordInput[];
  branchPath?: string;
}

/** What each candidate's `fn` returns: the ingest result + probe hits. */
interface CandidateOutcome {
  accepted: number;
  bestDistance: number | null;
  hits: Array<{ id: number; distance: number }>;
}

/** Turn a validated label into a filesystem-safe branch filename segment. */
function safeSegment(label: string): string {
  return label.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 64) || 'branch';
}

export const agenticowSpeculateTools: MCPTool[] = [
  {
    name: 'agenticow_speculate',
    description:
      "agenticow — speculative branch-and-promote for parallel A/B memory exploration. " +
      "Forks a 162-byte COW branch per candidate off a shared base .rvf, ingests each candidate's " +
      "vectors into its OWN isolated branch, scores every branch (probe-query 'nearest' distance or " +
      "ingest 'count'), PROMOTES the winning branch's edits into base, and DISCARDS the losers by " +
      "deleting their branch files. Use when you want to try N competing memory-write strategies and " +
      "keep only the best — the memory-state analogue of worktree-per-agent code exploration. " +
      "Copying the base per candidate is wrong (full-copy snapshots grow linearly, the 3.3 GB Darwin " +
      "bloat); COW forks are constant-size and losers cost ~162 B to throw away. Optional dep — " +
      "degrades to {degraded:true} when agenticow is missing.",
    category: 'memory',
    tags: ['agenticow', 'memory', 'cow', 'speculative', 'branch', 'promote', 'ab'],
    inputSchema: {
      type: 'object',
      properties: {
        basePath: {
          type: 'string',
          description: 'Path to base .rvf memory file (absolute or relative to cwd)',
        },
        dimension: {
          type: 'integer',
          description: 'Vector dimension (required only when basePath does not exist yet)',
        },
        candidates: {
          type: 'array',
          description: 'The A/B candidates. Each explores its own COW branch.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Branch label (alnum + _.-:/@ only)' },
              ingest: {
                type: 'array',
                description: 'Vectors to ingest into this candidate branch',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer', description: 'Explicit vector id (auto when omitted)' },
                    vector: { type: 'array', items: { type: 'number' }, description: 'Dense vector' },
                    text: { type: 'string', description: 'Optional payload text' },
                  },
                  required: ['vector'],
                },
              },
              branchPath: {
                type: 'string',
                description: 'Optional explicit path for this branch file (default: alongside base)',
              },
            },
            required: ['label', 'ingest'],
          },
        },
        probe: {
          type: 'array',
          items: { type: 'number' },
          description: "Probe vector for scoreBy='nearest' (scores each branch by best-hit similarity)",
        },
        k: { type: 'integer', description: 'Nearest-neighbours to fetch per probe (default 1)' },
        scoreBy: {
          type: 'string',
          enum: ['nearest', 'count'],
          description: "'nearest' = closest probe distance wins; 'count' = most accepted ingests wins. Default 'nearest'.",
        },
        requireClearance: {
          type: 'boolean',
          description: 'ADR-171 fail-closed gate. When true, the top-scored winner is NOT promoted (base stays unchanged) and a provenance-tagged receipt is emitted — score alone cannot graduate work. Use when speculating over TASK outcomes rather than pure memory A/B. Default false (score-only promotion, tagged `unverified`).',
          default: false,
        },
      },
      required: ['basePath', 'candidates'],
    },
    handler: async (input) => {
      const api = await loadAgenticow();
      if (!api) return degradedResult('agenticow-not-found');

      const basePath = resolveMemoryPath(String(input.basePath));
      const dimension = input.dimension as number | undefined;
      const scoreBy = (input.scoreBy as string) === 'count' ? 'count' : 'nearest';
      const k = Number.isInteger(input.k) && (input.k as number) > 0 ? (input.k as number) : 1;
      const probe = Array.isArray(input.probe) ? (input.probe as number[]) : null;

      const rawCandidates = input.candidates as CandidateInput[];
      if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
        throw new Error('at least one candidate is required');
      }
      if (scoreBy === 'nearest' && !probe) {
        throw new Error("scoreBy='nearest' requires a probe vector");
      }

      // Build the generic {label, fn} candidates. Each fn ingests into its own
      // branch handle, then (for 'nearest') probes it so we can score.
      // Map validated label → explicit branchPath so the branchPath() resolver
      // below is O(1) instead of re-scanning + re-validating rawCandidates per
      // candidate (explore() calls branchPath once per candidate → was O(n²)).
      const explicitBranchPaths = new Map<string, string>();
      const candidates: SpeculativeCandidate<CandidateOutcome>[] = rawCandidates.map((c) => {
        const label = validateLabel(String(c.label));
        if (!Array.isArray(c.ingest) || c.ingest.length === 0) {
          throw new Error(`candidate ${label} must ingest at least one vector`);
        }
        if (typeof c.branchPath === 'string' && c.branchPath) {
          explicitBranchPaths.set(label, c.branchPath);
        }
        const records = c.ingest.map((r) => ({
          ...(Number.isInteger(r.id) ? { id: r.id as number } : {}),
          vector: r.vector,
          ...(typeof r.text === 'string' ? { text: r.text } : {}),
        }));
        return {
          label,
          fn: (branch: any): CandidateOutcome => {
            const res = branch.ingest(records);
            const accepted = Number(res?.accepted ?? records.length);
            let hits: Array<{ id: number; distance: number }> = [];
            if (probe) {
              hits = (branch.query(probe, k) || []).map((h: any) => ({
                id: h.id,
                distance: h.distance,
              }));
            }
            const bestDistance = hits.length ? hits[0].distance : null;
            return { accepted, bestDistance, hits };
          },
        };
      });

      const score = (r: CandidateOutcome): number => {
        if (scoreBy === 'count') return r.accepted;
        // nearest: smaller distance = better. Map to a higher-is-better score.
        if (r.bestDistance === null) return -Infinity;
        return 1 / (1 + Math.max(0, r.bestDistance));
      };

      const branchPath = (label: string): string => {
        const explicit = explicitBranchPaths.get(label);
        if (explicit) return resolveMemoryPath(explicit);
        return `${basePath}.spec-${safeSegment(label)}.rvf`;
      };

      // ADR-171 promotion gate. For pure memory A/B the `score` IS the chosen
      // metric (not a proxy for task correctness), so score-only promotion is
      // legitimate and stays the default (tagged `unverified`, never
      // masquerading as ground truth). Callers grafting this onto TASK work
      // pass requireClearance:true to fail-closed — the winner is then
      // ineligible unless a real clearance mechanism graduates it.
      const requireClearance = input.requireClearance === true;
      const exploreOpts: Parameters<typeof explore>[3] = { branchPath, persist: true };
      if (requireClearance) exploreOpts.requireClearance = true;

      // Open base, run the speculative exploration, persist base with the winner promoted.
      const base = await openWithLineage(api, basePath, dimension);
      try {
        const result = await explore(base, candidates, score, exploreOpts);
        base.save?.(manifestFor(basePath));
        return {
          success: true,
          basePath,
          scoreBy,
          winner: result.winner,
          scores: result.scores,
          promoted: result.promoted,
          promotedBy: result.promotedBy,
          promotionDecision: result.promotionDecision,
          promoteStats: result.promoteStats,
          discarded: result.discarded,
          receipts: result.receipts,
          branches: result.branches.map((b) => ({
            label: b.label,
            path: b.path,
            score: b.score,
            kept: b.kept,
            accepted: b.result.accepted,
            bestDistance: b.result.bestDistance,
          })),
        };
      } finally {
        await base.close?.();
      }
    },
  },
];
