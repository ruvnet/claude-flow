# ADR-179: Recurrence-Gated Memory Consolidation for AgentDB

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-13)  
**Date:** 2026-07-13  
**References:** Dream Cycle issue 2026-07-13; RecMem (Dai et al., May 2026); SelfMem (Yang et al., July 2026)

---

## Context

AgentDB currently triggers memory consolidation eagerly: after every N writes, the DISTILL step runs a full LLM pass over the memory namespace to compact and re-rank entries. This has two costs:

1. **Token cost**: Each consolidation call consumes LLM tokens proportional to namespace size.
2. **Latency**: Eager consolidation blocks the agent loop while the LLM pass executes.

The 2026 paper "RecMem: Recurrence-based Memory Consolidation" (Dai et al., May 15 2026, Grade A) demonstrates that consolidation triggered only when sustained semantic cluster activity exceeds a configurable threshold reduces token cost by **87%** while exceeding eager-consolidation accuracy on recall benchmarks. The key insight: most writes to a namespace do not meaningfully shift the semantic distribution — consolidation is only valuable when cluster centroids have drifted enough to require re-ranking.

Additionally, "SelfMem" (Yang et al., July 2026, Grade A) demonstrates that an RL layer self-optimizing retrieval parameters (k, ef_search, relevance threshold) per namespace using verdict signals from the existing JUDGE step yields a **+48.7% BEAM score** improvement at 100K token scale. The feedback loop already exists in Ruflo's RETRIEVE→JUDGE pipeline; wiring it back to retrieval configuration is the missing piece.

---

## Decision

Replace the eager N-write consolidation trigger in AgentDB with a **recurrence-gated trigger**:

1. **Cluster-activity monitor**: After each write batch, compute the cosine shift of the top-K cluster centroids versus their last-consolidation snapshot. Consolidation fires only when the mean centroid shift exceeds a configurable threshold `CONSOLIDATION_DRIFT_THRESHOLD` (default: 0.12) sustained over `CONSOLIDATION_SUSTAIN_WRITES` consecutive batches (default: 8).

2. **RL retrieval policy layer (phase 2)**: Wire JUDGE step verdicts (success/failure per retrieval) back to a per-namespace bandit that tunes `ef_search`, `k`, and `min_relevance_score`. This is additive — does not require changing the HNSW index structure.

3. **Backward compatibility**: The existing `CONSOLIDATION_INTERVAL` config key remains supported as a hard ceiling (consolidation always fires if N writes have elapsed, regardless of drift). Default ceiling: 500 writes (up from current 50).

---

## Implementation Notes

- Cluster centroid snapshots stored as a lightweight metadata table in the existing SQLite backend (no schema migration for vector data).
- Drift computation uses the existing HNSW `query` path — no new index structures needed.
- RL policy state stored in `memory_policies` namespace (persistent across sessions via existing AgentDB persistence).
- Benchmark gate: `scripts/benchmark-intelligence.mjs` must show ≥50% reduction in consolidation LLM calls on the `N=20k` fixture before merging. Grade A target.

---

## Consequences

**Positive:**
- Estimated −80% consolidation token cost (conservative vs RecMem's −87% lab result)
- No change to retrieval latency (HNSW index unchanged)
- Retrieval quality improves over time via RL policy self-tuning (phase 2)
- Existing `CONSOLIDATION_INTERVAL` ceiling preserves safety net

**Negative / Risks:**
- Cluster centroid computation adds ~2ms per write batch (acceptable; below 25ms LANTERN bound)
- RL policy tuning requires ≥100 JUDGE verdicts per namespace to converge; new namespaces use static defaults
- `CONSOLIDATION_DRIFT_THRESHOLD` requires calibration per workload; wrong value delays needed consolidation

---

## Alternatives Considered

- **Keep eager consolidation**: Rejected — 87% token waste is measurable and Grade A benchmarked.
- **Time-based trigger**: Rejected — semantic drift does not correlate with wall-clock time for bursty agent workloads.
- **Full in-process memory store** (Memory in the Loop pattern, 100µs latency): Deferred — requires SQLite WAL tuning and process isolation changes; tracked separately.
