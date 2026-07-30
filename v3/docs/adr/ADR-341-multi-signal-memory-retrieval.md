# ADR-341 — Multi-Signal Memory Retrieval

**Status**: Proposed
**Date**: 2026-06-08
**Authors**: claude (dream-cycle agent, 2026-06-08)
**Related**: ADR-006 (Unified Memory Service), ADR-009 (Hybrid Memory Backend), ADR-017 (RuVector Integration)

## Context

The 2026-06-08 Dream Cycle research session (DEEP=memory) found that the SOTA for agent memory retrieval has shifted from single-vector lookup to multi-signal retrieval combining semantic similarity, BM25 keyword matching, and entity matching in parallel. Mem0's Q2 2026 algorithm achieves 94.4% LongMemEval at ~6,900 tokens/query (75% token reduction vs full-context methods). Ruflo's memory module currently runs vector-only retrieval through HNSW/RaBitQ with no BM25 or entity passes.

The gap is concrete:

| Signal | Ruflo (today) | SOTA (Mem0 v2) |
|--------|--------------|----------------|
| Semantic (vector) | HNSW + RaBitQ rerank | ✓ |
| Keyword (BM25/FTS5) | Not used | ✓ parallel |
| Entity matching | Not implemented | ✓ parallel |
| Result fusion | N/A | RRF (reciprocal rank fusion) |
| Async writes | Unknown | Default |

An FTS5 table already exists in the SQLite backend (`v3/@claude-flow/memory/src/fts5.ts`) and a graceful-retrieval abstraction is partially built (`graceful-retrieval.ts`). The infrastructure is in place; the architectural decision is whether to commit to parallel multi-signal as the canonical retrieval contract.

### Why this is architectural (not implementation-level)

Multi-signal retrieval changes the public `MemoryBackend.search()` API shape, introduces a mandatory FTS5 dependency on the SQLite path, adds a result-fusion step to every read, and alters the latency/cost profile. It cannot be added as a quiet patch — every backend implementation must honour the same contract.

## Decision

Add multi-signal retrieval as the canonical read path in `UnifiedMemoryService`:

1. **Run three signal passes in parallel** via `Promise.all`:
   - Semantic: existing HNSW/RaBitQ vector search (unchanged)
   - Keyword: FTS5 BM25 full-text scan (existing `fts5.ts`, wire up)
   - Entity: lightweight entity tagger extracting named entities from query, then exact-match against stored entity index

2. **Fuse results** with Reciprocal Rank Fusion (RRF, `k=60`) — well-studied, zero additional model calls, deterministic.

3. **Return top-k after fusion** with per-result signal provenance (`signals: ['vector', 'bm25', 'entity']`) so callers can debug.

4. **Async writes by default** — `store()` enqueues to a non-blocking queue; HNSW and FTS5 indexes rebuild on background timer (already done for HNSW consolidator; extend to FTS5).

5. **Instrument `tok/query`** via the existing benchmark harness (`memory-efficiency.bench.ts`) — report alongside latency so we can track token efficiency over time.

## Consequences

**Positive:**
- Closes the largest retrieval gap vs Mem0/SOTA with no new model dependencies.
- RRF is O(k log k) — negligible overhead on typical memory sizes.
- FTS5 already exists; no new SQLite dependency.
- Entity matching adds resilience for proper-noun queries that vector search handles poorly.
- Enables publishing LoCoMo/LongMemEval benchmark scores once retrieval is credible.

**Negative:**
- `search()` latency increases by ~1–3ms (three parallel DB calls vs one) for small indexes. Acceptable: HNSW crossover is ~5k vectors; below crossover brute-force already dominates.
- FTS5 index must stay in sync with the vector store. The existing consolidator `sweepExpired()` must be extended to drop FTS5 rows too.
- Entity tagger adds a new code path. Start with a regex-based tagger (names, emails, URLs, file paths) — no ML dependency required at P1.

**Neutral:**
- Existing callers of `search()` receive richer results with no breaking change to the return shape (extra `signals` field is additive).
- RaBitQ pre-filter continues to operate as before; multi-signal does not bypass it.

## Implementation Plan

| Phase | Scope | Acceptance |
|-------|-------|------------|
| P1 | Wire FTS5 into `graceful-retrieval.ts`; add RRF fusion | `fts5.test.ts` passes; `graceful-retrieval.test.ts` covers fusion |
| P2 | Regex entity tagger; entity index in SQLite | Entity round-trip test; query "find memories about Alice" returns Alice-tagged entries above noise |
| P3 | Async write default; tok/query instrumentation in bench | `store()` returns in <1ms; bench reports tok/query |
| P4 | Run LoCoMo slice benchmark; publish `docs/reviews/memory-benchmark-2026-06-08.md` | Score ≥75% (baseline expectation before tuning) |

## Alternatives Considered

- **Graph-based memory (Cognee-style)** — higher expressiveness for multi-hop queries, but requires a graph DB dependency and operator overhead not justified at Ruflo's current scale. Revisit if entity graph proves insufficient.
- **Agentic retrieval (Supermemory ASMR)** — 98.6% LongMemEval-s but requires spawning 3 parallel search agents per query, multiplying cost and latency by ~10×. Appropriate as a future optional mode (`retrieval: 'agentic'`), not the default.
- **BM25 only (drop vector)** — regresses recall on semantic queries. Not viable.
