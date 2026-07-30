# Memory SOTA Report — 2026-07-23

**TL;DR:** Budget-Dependent Memory Operator Selection (OAS, 2026) yields +48% task success under tight token budgets and is absent from Ruflo's `@claude-flow/memory`; implementing it is the highest-ROI memory improvement available in July 2026.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| OAS: budget-driven retain-vs-consolidate selection +48% under tight budgets | Kang et al., arXiv 2607.17545 (Jul 2026) | A |
| PRO-LONG programmatic memory +18% on ARC-AGI-3 for long-horizon tasks | Fox et al., arXiv 2607.20064 (Jul 2026) | B |
| Profile-Graph Memory 80.1% on multi-hop retrieval via two-layer profile/residual | Zhu, arXiv 2607.19359 (Jun 2026) | B |
| Supra Cognitive Modes: route lexical/dense/graph/multi-hop from single substrate | Tobkin & Yang, arXiv 2607.19096 (Jul 2026) | B |
| EAR (Exploratory+Assimilating Reflection) +17.9% on long-term recall | Senrayan et al., arXiv 2607.17879 (Jul 2026) | C (single source) |
| MINJA / Chronos Vulnerability: formal taxonomy of memory-injection attacks on stateful agents | Narayan et al., arXiv 2607.19430 (Jul 2026) | A |
| HyMCache: CXL-hybrid memory for TB-scale KV-cache reuse in multi-turn serving | Jang et al., arXiv 2607.18141 (Jul 2026) | B |

---

## Ruflo Current Capability

| Capability | Status | Notes |
|------------|--------|-------|
| HNSW vector search | Active, measured | ~1.9× at N=20k, ~3.2×–4.7× at N=5k vs brute-force |
| Hybrid backend (SQLite + AgentDB) | Active | Persistent, session-scoped |
| Memory consolidation worker | Active (low priority) | Background, no budget awareness |
| Int8 quantization | Active, measured | 3.84× compression, cosine 0.99999 |
| RaBitQ quantization | Active, measured | 32× compression, 0.60ms/query |
| SONA neural adaptation | Active, measured | 0.0043ms/adapt |
| Budget-Dependent Operator Selection | **Absent** | No retain-vs-consolidate decision by remaining budget |
| Multi-hop graph traversal | **Absent** | HNSW is flat vector space; no relational edges |
| MINJA input validator | **Absent** | No memory-injection defense on store operations |
| Programmatic memory for long-horizon agents | **Absent** | No PRO-LONG-style structured working memory |

---

## Competitor Comparison

| Framework | Memory Architecture | Budget-Aware? | Multi-hop? | MINJA Defense? |
|-----------|--------------------|--------------:|:----------:|:--------------:|
| **Ruflo (current)** | HNSW + SQLite hybrid, SONA, quantized | No | No | No |
| **LangGraph v1.2.9** | DeltaChannel checkpoints (stabilizing bug fixes Jul 2026; no new memory API) | No | No | No |
| **AutoGen v0.7.5** | Pluggable backends: Redis, Mem0, ChromaDB (linear memory via RedisMemory) | No | Via Mem0 (external) | No |
| **CrewAI v1.15.0** | Multi-tiered: short-term, long-term, entity, contextual; swappable backends | No | Partial (entity store) | No |
| **OpenAI Swarm** | Stateless by design; context variables only; no persistence between calls | N/A | No | N/A |

---

## Benchmarks

| Metric | Value | Grade | Source |
|--------|-------|-------|--------|
| OAS retain/consolidate, tight budget | +48% task success | A | Kang et al. 2607.17545 (Jul 2026) |
| PRO-LONG programmatic memory on ARC-AGI-3 | +18% | B | Fox et al. 2607.20064 (Jul 2026); ARC-AGI-3 released Jan 2026 |
| Profile-Graph Memory multi-hop retrieval | 80.1% accuracy | B | Zhu 2607.19359 (Jun 2026); benchmark identity unspecified |
| Ruflo HNSW vs brute-force (N=20k) | ~1.9× speedup | A | Internal benchmark, `scripts/benchmark-intelligence.mjs` |
| Ruflo RaBitQ quantization | 32× compression, 0.60ms/query | A | Internal benchmark, same script |

---

## SOTA Proof & Witness

**Session commit:** `26c35b59b40a0a95b286ccf5ac675a15edcc995f`

**Report SHA-256:** `f9efd04cbd67eb8aaec989e3e950eb61681472e9e382132dae52d1d23218d961`

**Witness stamp:** `06a20f9a4b6066c215fb31ba003b251d235148a010768d85278efb6000cf610a`

**Verifier:** fetch raw report file, `sha256sum`, concatenate session commit hash (no separator), `sha256sum` → must equal witness stamp.

---

## Recommended Next Steps

1. **Implement OAS in `@claude-flow/memory`** — add a `MemoryOperatorSelector` class that inspects remaining token budget (via cost-tracker hook) and selects `retain` (cheap append) vs `consolidate` (expensive summarize) vs `evict` (drop oldest). Grade-A evidence: +48% under tight budgets (Kang et al. 2607.17545). Target: `v3/@claude-flow/memory/src/operators/budget-selector.ts`.

2. **Add multi-hop graph layer over HNSW** — store entity edges alongside vector embeddings in AgentDB; expose `memory search --multi-hop` flag. Grade-B evidence: Profile-Graph Memory 80.1% vs. flat vector retrieval on relational queries (Zhu 2607.19359). Target: `v3/@claude-flow/memory/src/graph/entity-graph.ts`.

3. **Add MINJA defense in `@claude-flow/security`** — validate all `memory store` inputs for injection patterns (oversized payloads, prompt-injection fragments, sleeper triggers) before writing to AgentDB. Grade-A taxonomy: Chronos Vulnerability (Narayan et al. 2607.19430). Target: `v3/@claude-flow/security/src/validators/memory-input.ts`.
