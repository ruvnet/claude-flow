# ADR-381: AgentDB Temporal Decay — Type-Conditioned Perishability Model

**Status:** Proposed  
**Date:** 2026-08-08  
**Authors:** claude (dream-cycle agent, 2026-08-08)  
**Dream Cycle Issue:** #[TBD — filed same night]  
**SOTA Source:** arXiv:2608.04746 (ScrubJay, Aug 5 2026, grade A)

---

## Context

AgentDB stores all memory entries in a flat HNSW index with a timestamp field but no perishability model. Retrieval ranks candidates purely by semantic similarity, giving equally high scores to a 6-month-old cached tool-call pattern and a fresh observation. Long-horizon agents accumulate stale patterns in ReasoningBank that degrade temporal reasoning quality.

ScrubJay (arXiv:2608.04746, Aug 5 2026) demonstrates that type-conditioned temporal decay is the critical variable:

- **+2.66 F1** over Mem0 on MemoryAgentBench EventQA-64k (grade A, reproduced)
- **+0.108 GenGap** on the Temporal Generalization Test (TGT) — the only retrieval-based system with a positive result
- Removing temporal decay **collapses GenGap 5.7×**

No major competitor framework (LangGraph, CrewAI, AutoGen, OpenAI Agents SDK) implements temporal decay as of August 2026. Implementation window is open.

---

## Decision

Introduce a **type-conditioned perishability model** in AgentDB for the `@claude-flow/memory` package.

### Schema Change

Add two fields to every memory entry in the AgentDB `memories` table:

| Field | Type | Description |
|---|---|---|
| `perishability` | REAL (0.0–1.0) | Rate at which this memory loses relevance per day. 0 = immortal, 1 = decays fully in ~1 day. |
| `utility_horizon` | INTEGER (seconds) | Expected useful lifespan; used to set cache-invalidation hints. |

### Default Values by Namespace

| Namespace | perishability | utility_horizon | Rationale |
|---|---|---|---|
| `patterns` (ReasoningBank) | 0.3 | 1,814,400 (21 days) | Tool-call patterns stay useful for weeks |
| `tasks` | 0.1 | 7,776,000 (90 days) | Task outcomes rarely stale |
| `auto-memory` | 0.8 | 86,400 (1 day) | Session-scoped observations expire fast |
| `collaboration` | 0.5 | 604,800 (7 days) | Cross-agent context; moderate decay |
| `claude-memories` | 0.2 | 2,592,000 (30 days) | Long-term user preferences |

### Retrieval Scoring

Replace raw cosine similarity `score = cos(q, m)` with:

```
temporal_score(m) = cos(q, m) × exp(-perishability(m) × age_days(m))
```

Where `age_days(m) = (now - m.created_at) / 86400`.

This degrades stale memory scores exponentially without discarding them — stale memories remain searchable but rank below fresh ones.

### HNSW Index Compatibility

The HNSW index continues to return top-K candidates by cosine similarity. Temporal re-scoring is applied as a **post-filter pass** over the top-K results before returning to callers. This avoids rebuilding the HNSW index.

---

## Implementation Plan

1. `v3/@claude-flow/memory/src/agentdb/schema.ts` — add `perishability` and `utility_horizon` columns with migration `m004_temporal_decay.sql`
2. `v3/@claude-flow/memory/src/agentdb/retrieval.ts` — apply temporal re-scoring in `search()` after HNSW top-K
3. `v3/@claude-flow/memory/src/agentdb/store.ts` — accept and persist `perishability` / `utility_horizon` in `store()` call; set defaults by namespace
4. `v3/@claude-flow/hooks/src/workers/consolidate.ts` — add `prune_stale()` worker step that removes entries where `temporal_score < 0.05` (effectively dead)
5. `scripts/benchmark-intelligence.mjs` — add LongMemEval-subset eval with perishability enabled vs disabled; measurement gate: positive GenGap on TGT

---

## Measurement Gate

Before promoting to default retrieval path:
- Run LongMemEval 500-question eval on `@claude-flow/memory`
- Measure GenGap with and without perishability
- Gate: GenGap must be positive with decay enabled

Publish results in `docs/reviews/` as a follow-up to `intelligence-system-audit-2026-05-29.md`.

---

## Consequences

**Positive:**
- Addresses the ScrubJay SOTA gap: Ruflo becomes the first production agent framework with type-conditioned temporal decay
- Reduces stale-pattern noise in ReasoningBank without deleting history
- Measurable via TGT GenGap; ties into existing benchmark harness

**Negative:**
- Schema migration required; existing deployments need `m004_temporal_decay.sql`
- Default `perishability` values are heuristic; may need per-project calibration
- Post-filter pass adds O(K) multiplications per search; negligible at K≤100

**Neutral:**
- HNSW index unchanged; no re-indexing required
- `utility_horizon` unused in scoring but available for future cache-eviction policies

---

## Alternatives Considered

- **Graph memory (HiGram, arXiv:2608.05095):** More powerful but requires full schema rewrite and graph traversal engine. Defer to a separate ADR.
- **BM25 fusion (Mem0 approach):** Orthogonal enhancement; can be added after perishability. Noted in issue #2902.
- **SafeCommit certification (arXiv:2608.04289):** Addresses memory safety, not staleness. Separate ADR warranted after basic decay lands.
