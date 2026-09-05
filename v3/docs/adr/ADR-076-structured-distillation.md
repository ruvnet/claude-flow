# ADR-076 — Structured Distillation for Trajectory Content (#2241 §SOTA)

**Status**: Accepted — Implemented in ruflo 3.10.16
**Date**: 2026-05-30
**Tracking**: [#2241](https://github.com/ruvnet/ruflo/issues/2241) — Dream Cycle 2026-05-30 performance scan
**Paper**: arXiv:2603.13017 (Grade A, March 2026) — "Structured Distillation of Agent Exchanges: 4-field schema for 11× compression and improved retrieval MRR"

## Context

The Dream Cycle 2026-05-30 scan (#2241) identified Structured Distillation as the highest-ROI intelligence finding from a 2026 Grade-A paper that maps directly onto ruflo's trajectory memory: the paper compresses agent exchanges from ~371 to ~38 tokens (≈11×) using a four-field schema, and shows retrieval MRR rising from 0.745 (raw) to 0.759 (distilled, Δ +0.014) on a 214 K-pair consensus-graded corpus.

ADR-074 wired the self-learning surfaces; ADR-075 unified the four stat aggregators. Both fixed *honesty* — making the surfaces report what they actually do. ADR-076 is the first round-C *quality* win: a real SOTA-paper alignment with measured proof, not just wiring.

## Decision

Adopt the 4-field schema for trajectory step content:

```ts
interface DistilledContent {
  summary: string;   // first sentence — the headline of the exchange
  detail:  string;   // the rest of the content — kept for fidelity
  labels:  string[]; // domain tokens: verbs (refactor/fix/add/…) + camelCase nouns
  paths:   string[]; // file paths and file:line references
}
```

Schema lives in `v3/@claude-flow/cli/src/memory/structured-distill.ts`. The serialiser (`serialiseDistilled`) places labels and paths at the front so the embedder allocates more probability mass to high-signal tokens — that ordering is what the paper credits for the MRR gain.

The extractor is **rule-based**, deterministic, dependency-free, and sub-millisecond. A future round can plug a learned distiller (LLM / cross-encoder) into the same schema as a drop-in replacement; the corpus + harness already exist as the gate.

### Reusable infrastructure shipped

- `distillTrajectoryContent(raw)` — extracts the 4 fields.
- `serialiseDistilled(d)` — produces the embedding-ready string with high-signal tokens first.
- `distillAndSerialise(raw)` — convenience: distill + serialise.
- `compressionRatio(raw)` — utility for tracking byte-level shrink (1.0 = parity, >1 = smaller).
- `bench/trajectory-mrr-corpus.json` — 30 paired (raw, query) trajectories drawn from the recent ruflo issue-fix history.
- `scripts/benchmark-trajectory-mrr.mjs` — runs raw vs distilled retrieval, computes MRR, writes a run JSON.

## Measured proof (this checkout)

`docs/benchmarks/runs/trajectory-mrr-latest.json` — bridge ONNX embedder (Xenova/all-MiniLM-L6-v2, 384-dim), corpus N=30:

| Metric | Raw | Distilled | Δ | Direction |
|---|---:|---:|---:|---|
| **MRR** | 0.0964 | **0.1367** | **+0.0403 (+41.8%)** | ✅ distilled better |
| Total bytes | 9,149 | 12,378 | 0.74× compression | — bigger (honest tradeoff) |
| **Distilled wins** | — | — | — | **TRUE** |

Honest comparison to the paper (arXiv:2603.13017):

| | Our run | Paper |
|---|---|---|
| Embedder | bridge ONNX (live MCP path) | learned cross-encoder |
| Corpus | N=30 hand-curated ruflo fixes | 214 K consensus-graded pairs |
| Distiller | rule-based regex | learned LLM-based |
| MRR delta | +0.0403 (+41.8% relative) | +0.014 (+1.9% relative) |
| Compression | 0.74× (distilled grew by 35%) | 9.76× (371→38 tokens) |

The **direction matches the paper** (distilled improves MRR); the **relative delta is larger** in our corpus (small + curated, so a high-signal-token serialisation order pays more). The **byte compression does NOT match** because a rule-based distiller can't safely drop content; a learned distiller is required to hit the paper's 11×. We don't claim the byte number — we claim the **schema, the harness, and the MRR direction**.

## Deliberately NOT in this round

- A **learned distiller** to hit the paper's 11× byte compression. Tracked under #2241 round-D. The current schema + serialiser stay unchanged; only the extractor would swap.
- Wiring `distillAndSerialise()` into `recordTrajectory()` at write time so the embedded form of every stored step is distilled. The infrastructure is in place; the live integration is the next ADR.
- Scaling the corpus to thousands of trajectories. The current 30-entry corpus is enough to assert direction; statistical confidence requires much more.

## Verification

- `__tests__/structured-distill-2241.test.ts` — 9 tests:
  - 4-field schema shape + determinism
  - File-path + file:line extraction
  - Action-verb label extraction
  - First-sentence summary capping
  - Empty input safety
  - Serialiser places labels at start
  - Honest compression bound (≥0.5×, no >2× bloat)
- `scripts/benchmark-trajectory-mrr.mjs` — committed run shows distilled MRR > raw MRR with the real ONNX embedder.
- Build clean (`tsc -b`); full CLI suite green modulo pre-existing flakes documented in ADR-074.

## Reproduce

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc -b )

# Schema + extractor tests
( cd v3/@claude-flow/cli && npx vitest run __tests__/structured-distill-2241.test.ts )

# MRR proof benchmark (uses the bridge ONNX embedder when available;
# falls back to hash-deterministic with an explicit "degraded" warning)
node v3/@claude-flow/cli/scripts/benchmark-trajectory-mrr.mjs
# → MRR raw 0.0964 → distilled 0.1367 (Δ +0.0403) on the committed 30-entry corpus
```
