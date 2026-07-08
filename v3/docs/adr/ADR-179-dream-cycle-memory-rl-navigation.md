# ADR-179: RL-Navigated Active Memory Layer for AgentDB

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-08)  
**Related Issue:** #2606  
**Related ADR:** ADR-174 (memory distillation), ADR-176 (self-benchmarking harness)  

---

## Context

AgentDB provides high-quality passive HNSW vector retrieval (measured 1.9×–4.7× speedup vs brute force at N=5k–20k, recall@10 ~0.99). Retrieval is unconditional: every query searches all stored vectors regardless of recency, relevance tier, or query complexity.

Three independent 2026 papers (NapMem, MRMS, Memory in the Loop) and one vendor benchmark (Mem0 2026 algorithm) converge on the same architectural shift: **active RL-navigated memory** outperforms passive similarity retrieval on long-horizon and multi-hop tasks. The NapMem finding (arXiv 2026-07-06) is the second independent confirmation of this direction within 5 days (AutoMem from #2536, 2026-07-03 being the first).

Simultaneously, Mem0's 2026 algorithm demonstrates that **fused scoring** (semantic + BM25 + entity-link) yields +29.6 pts temporal reasoning and +23.1 pts multi-hop vs pure vector similarity (Grade B vendor benchmark, LoCoMo: 92.5/100, LongMemEval: 94.4/100).

## Decision

Add an **RL-navigated active memory layer** on top of the existing HNSW store, implementing:

1. **3-tier memory pyramid** — hot (last 100 writes, in-process), warm (last 2,000 writes, HNSW), cold (full corpus, HNSW with RaBitQ compression). TTLs configurable; default: hot 5 min, warm 24 h, cold indefinite.

2. **Q-learning navigation policy** — lightweight tabular or shallow-network policy with 3 actions per query: `shallow` (hot only), `deep` (hot + warm), `full` (hot + warm + cold). Policy input: query complexity estimate (token count + entity count), recency signal, prior hit rate. Reward: retrieval latency × (1 / recall_estimate).

3. **Fused scoring** — replace pure cosine similarity with `α·cosine + β·BM25 + γ·entity_overlap`, where α, β, γ are tunable via `config/memory.json`. Default: α=0.6, β=0.25, γ=0.15.

4. **CRDT conflict surface** (deferred to follow-on ADR) — StateFuse pattern (immutable conflict objects for multi-agent divergent writes) noted but scoped out of this ADR to keep scope bounded. Tracked separately.

## Consequences

**Positive:**
- Expected 40–60% latency reduction on shallow queries (hot-only path avoids HNSW entirely)
- Measurable improvement on temporal and multi-hop queries via fused scoring
- Policy is learnable per-session via existing SONA trajectory recording infrastructure
- Backward-compatible: existing AgentDB API unchanged; pyramid wraps the existing store

**Negative / Risks:**
- Policy cold-start: first N queries before policy warms up fall back to `full` (conservative)
- BM25 index adds ~15% storage overhead over HNSW alone
- Policy training loop adds complexity; must not regress recall@10 below 0.98 (existing measured baseline)

## Implementation Notes

- Hot tier: in-process JS Map keyed by embedding hash, capped at 100 entries LRU
- Warm/cold tiers: existing AgentDB HNSW (no changes to storage layer)
- BM25: use existing `@claude-flow/memory` tokenization; add inverted index alongside vector index
- Policy: tabular Q-table sufficient for 3 actions × ~20 state buckets; no neural model required initially
- Benchmark gate: `scripts/benchmark-intelligence.mjs` must show ≥1.9× HNSW speedup maintained + ≥5% latency reduction on shallow-query workload before merge

## Verification

Run `npx claude-flow@latest performance benchmark --suite memory` before and after. Record baseline + post-implementation numbers in the PR body. Gate: no regression on recall@10; latency reduction ≥5% on shallow-query mix.

## References

- NapMem: Xu, Y. et al. arXiv 2026-07-06
- MRMS: Li, J. & Shi-Nash, A. arXiv 2026-07-05
- Memory in the Loop: Khan, Y. & Lipizzi, C. arXiv 2026-07-06
- StateFuse: Volkov, S. et al. arXiv 2026-07-07
- Mem0 2026 State of AI Agent Memory: mem0.ai/blog/state-of-ai-agent-memory-2026
- AutoMem (prior signal): dream-cycle #2536, 2026-07-03
