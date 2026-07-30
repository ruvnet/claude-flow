# ADR-335 — Upgrade to Multi-Vector HNSW (MV-HNSW) for Agent Memory Retrieval

**Status**: Proposed
**Authors**: claude (dream-cycle agent, 2026-05-30)
**Related**: ADR-006 (Unified Memory Service), ADR-009 (Hybrid Memory Backend), ADR-017 (RuVector Integration)

## Context

Ruflo's current HNSW backend indexes each memory entry as a single embedding vector. Measured performance is ~1.9× vs brute-force at N=20k (ruvector NAPI). A 2026 PVLDB paper (arXiv:2604.02815) introduces MV-HNSW, the first hierarchical graph index native to multi-vector data, and benchmarks 14× search-latency reduction at >90% recall across seven real-world datasets.

Agent memory entries are structurally multi-field: they contain an exchange core (semantic summary), a technical detail, thematic room labels, and file-path tags. The current architecture embeds these as a single concatenated vector, losing the structural signal that multi-vector indexing exploits. This means:

1. Recall quality degrades as entries grow semantically diverse (fields pull the embedding in conflicting directions).
2. Query routing cannot target individual fields — every query scans the full compound embedding.
3. The ~1.9× speedup sits at the lower end of the ANN benefit regime; MV-HNSW's 14× was measured at comparable recall (>90%) on seven datasets including two that model agent-style compound objects.

No existing ADR (085–143) addresses multi-vector indexing for agent memory.

## Decision

Upgrade `v3/@claude-flow/memory/src/hnsw/` to a multi-vector index pattern:

1. **Decompose** each memory entry into its four semantic axes at write time: `core` (1–2 sentence exchange summary), `detail` (technical specifics), `labels` (thematic room tags), `paths` (file-path anchors).
2. **Embed each axis independently** using the existing all-MiniLM-L6-v2 ONNX encoder (384-dim per axis).
3. **Index via MV-HNSW pattern**: maintain a graph over compound objects where proximity is computed as a weighted max-inner-product across the four per-axis vectors. Weights tunable per query type.
4. **Query API**: extend `searchMemory(query, opts)` to accept an optional `axis` filter so callers can target `core` or `paths` axes directly for precision lookups.
5. **Backwards compatibility**: single-vector entries (legacy records) remain queryable via a fallback single-axis path; no migration required for existing entries.

## Consequences

**Positive**
- 14× latency reduction at >90% recall is the largest documented search improvement available in 2026 (Grade A, PVLDB).
- Retrieval precision improves on mixed-type queries (file-path lookups no longer polluted by semantic axes).
- Combinable with existing Int8 quantization (3.84×) and structured distillation (11×) for compounding gains.
- No model change — existing ONNX encoder unchanged.

**Negative / Risks**
- Write path becomes 4 encode calls per entry vs 1 — increased write latency (~4×). Acceptable given read-heavy agent memory access pattern.
- Index size grows ~4×. Acceptable given existing 32× RaBitQ compression option.
- Requires benchmark validation on Ruflo's specific workload (N=20k–100k) before declaring >90% recall target met. Publish results in `scripts/benchmark-intelligence.mjs`.

## Implementation Targets

| File | Change |
|------|--------|
| `v3/@claude-flow/memory/src/hnsw/index.ts` | Add `MVHNSWIndex` class alongside existing `HNSWIndex` |
| `v3/@claude-flow/memory/src/types.ts` | Add `MultiVectorEntry` type with four axis fields |
| `v3/@claude-flow/memory/src/agentdb.ts` | Route writes to `MVHNSWIndex` when entry has structured fields |
| `scripts/benchmark-intelligence.mjs` | Add `mv-hnsw-recall` benchmark suite |

## References

- arXiv:2604.02815 — MV-HNSW: Multi-Vector Hierarchical Graph Index, PVLDB 17(12) 2026
- arXiv:2603.13017 — Structured Distillation for Agent Memory (complementary: defines the four-field schema)
- `docs/reviews/intelligence-system-audit-2026-05-29.md` — measured HNSW baseline (~1.9× at N=20k)
