# ADR-372: Cognitive Mode Router for Agent Memory Query Dispatch

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-22)  
**Surfaces:** intelligence (deep), memory (scan)  
**Dream Cycle Issue:** TBD (filed same night)

---

## Context

The Supra Cognitive Modes (SCM) paper (arXiv 2607.19096, July 21 2026) demonstrates that routing memory queries by type—factoid lookup, multi-hop graph traversal, or long-form synthesis—yields 86.00% on LongMemEval and 84.87% on LoCoMo. The router is a frozen semantic classifier adding minimal latency.

Ruflo's current `@claude-flow/memory` module sends all queries through a single HNSW path regardless of type. This works for dense semantic search but leaves multi-hop and synthesis queries under-served: multi-hop benefits from graph traversal (ADR-130 adds graph-native backend but no dispatcher), synthesis benefits from stratified chunking not HNSW nearest-neighbor.

Additionally, the "Illusion of Multi-Agent Advantage" paper (arXiv 2606.13003) confirms that under equal token budgets single agents outperform multi-agent systems on multi-hop reasoning, reinforcing that smarter per-query routing at the memory layer is higher ROI than spawning more agents.

---

## Decision

Add a **Cognitive Mode Router (CMR)** as a lightweight pre-retrieval classifier in `@claude-flow/memory`:

1. **Query classifier**: frozen sentence-classification model (or heuristic rule set for MVP) that assigns each incoming query to one of three modes:
   - `FACTOID` — direct lookup, route to lexical+dense HNSW
   - `MULTI_HOP` — multi-step reasoning, route to graph traversal (ADR-087/ADR-130 backend)
   - `SYNTHESIS` — long-form generation, route to chunked stratified retrieval with re-ranking

2. **Mode-specific pipelines**: each mode gets its own retrieval path; FACTOID keeps the current HNSW path unchanged (no regression).

3. **Fallback**: if classifier confidence < 0.6, default to FACTOID path.

4. **Benchmark gate**: LongMemEval tracked in CI; target ≥ Zep Graphiti's 63.8% temporal sub-task on first integration.

---

## Consequences

**Positive:**
- Closes the SCM gap (86.00% LongMemEval) by enabling appropriate retrieval per query type
- No regression on FACTOID queries (same HNSW path)
- Graph backend (ADR-130) gets a proper entry point instead of being called ad-hoc
- Establishes LongMemEval as a tracked benchmark (fills gap noted in ADR-088)

**Negative / Risks:**
- Classifier adds latency per query (target < 5ms for frozen model or rule-based MVP)
- MVP heuristic classifier may misclassify ambiguous queries; monitor false-MULTI_HOP rate
- Requires LongMemEval dataset integration in CI (one-time setup cost)

---

## Alternatives Considered

- **No routing, just improve HNSW**: leaves multi-hop and synthesis quality on the table; does not address SCM findings
- **Always use graph backend**: higher latency for factoid queries; ADR-087 RRF result shows graph-only is not universally better
- **LLM-as-router**: too expensive (adds one full model call per memory query); frozen classifier or rules are sufficient

---

## References

- arXiv 2607.19096 — Supra Cognitive Modes (SCM), Tobkin & Yang, July 21 2026
- arXiv 2606.13003 — The Illusion of Multi-Agent Advantage, June 2026
- ADR-087 — Graph Node Native Backend
- ADR-088 — LongMemEval Benchmark
- ADR-130 — Graph Intelligence Integration
