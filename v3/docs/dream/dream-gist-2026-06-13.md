# Memory Agent SOTA Report — 2026-06-13

**TL;DR:** Three 2026 papers establish that flat HNSW retrieval without temporal decay is SOTA-deficient: MemMachine cuts token cost 80% via episodic ground-truth preservation (LoCoMo 0.9169); SSGM identifies semantic drift and knowledge-leakage as architectural risks in flat-vector long-term stores; the survey arXiv:2603.07670 names "learned forgetting" and "causal retrieval" as the two biggest unsolved frontiers. Ruflo's AgentDB has neither.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| MemMachine: episodic ground-truth store cuts tokens 80%, LoCoMo 0.9169 | arXiv:2604.04853 (Apr 2026) | A |
| SSGM framework: flat HNSW without temporal decay risks topology-induced knowledge leakage | arXiv:2603.11768 (Mar 2026, rev May 2026) | B (no quant results) |
| Survey identifies 5 open frontiers: continual consolidation, causal retrieval, trustworthy reflection, learned forgetting, multimodal embodied | arXiv:2603.07670 (Mar 2026) | A |
| Mem0 ECAI: 91% lower p95 latency (1.44 s vs 17.12 s), 90% lower token cost vs full-context | arXiv:2504.19413 (ECAI 2025) | A |
| CrewAI v1.12: Qdrant Edge backend + hierarchical namespace isolation | CrewAI changelog Apr 2026 | B |
| LangGraph v0.4: PostgresSaver checkpointer with TTL-aware state eviction | LangGraph changelog Apr 2026 | B |

---

## Ruflo Current Capability

| Capability | Status | Notes |
|-----------|--------|-------|
| HNSW vector search | ✅ Active | ~1.9x at N=20k vs brute force (measured) |
| SQLite persistent cache | ✅ Active | sql.js WASM backend |
| ReasoningBank / EWC++ | ✅ Active | Prevents catastrophic forgetting |
| Temporal decay modeling | ❌ Missing | Entries never age or expire |
| Episodic ground-truth preservation | ❌ Missing | HNSW stores embeddings, not raw episodes |
| Consistency verification | ❌ Missing | No integrity check on consolidation |
| Namespace write-authority | ✅ In-progress | ADR-145 Proposed |
| LongMemEval score published | ⚠️ Deferred | ADR-088: <90% target, deferred |
| Causal / multi-hop retrieval | ❌ Missing | ADR-155 Proposed (2026-06-12, KG gap) |

---

## Competitor Comparison

| System | Memory Backend | Temporal Decay | Episodic Preservation | LongMemEval / LoCoMo |
|--------|----------------|---------------|----------------------|----------------------|
| **MemMachine** | 3-layer (short/episodic/profile) | ✅ (TTL per tier) | ✅ raw episode store | LoCoMo 0.9169 (Grade A) |
| **CrewAI v1.12** | Qdrant Edge + hierarchical isolation | ✅ configurable | ❌ embedding-only | Not published |
| **LangGraph v0.4** | PostgresSaver checkpointer | ✅ TTL eviction | ❌ state snapshots | Not published |
| **Zep** | Temporal knowledge graph | ✅ native | ✅ entity tracking | 63.8% temporal retrieval (arXiv:2501.13956, Grade B) |
| **Mem0** | Hybrid semantic+short-term | ❌ no decay | ❌ | LoCoMo ~49% temporal, 91% lower latency (Grade A) |
| **Ruflo AgentDB** | SQLite + HNSW flat store | ❌ absent | ❌ | ADR-088: deferred |

---

## Benchmarks

| Benchmark | Best Score | System | Year | Grade |
|-----------|-----------|--------|------|-------|
| LoCoMo | 0.9169 | MemMachine (GPT-4-mini) | 2026 | A (arXiv:2604.04853) |
| LongMemEvalS | 93.0% | MemMachine | 2026 | A (arXiv:2604.04853) |
| Mem0 p95 latency | 1.44 s vs 17.12 s full-context | Mem0 | 2025 | A (arXiv:2504.19413) |
| Zep temporal retrieval | 63.8% vs Mem0 49.0% | Zep | 2026 | B (arXiv:2501.13956, single source) |

> Note: No 2026 benchmark data available for Ruflo AgentDB's LoCoMo or LongMemEvalS performance.

---

## SOTA Proof & Witness

Session commit: `4cbcfc2671ad3f13ac9a648c1604c09fdb934248`  
Report SHA-256: `42dc7ff29b2f3c387bc7ce8ae8e528c8dda6f3904ed49e93d4100ddadc9d0acd`  
Witness stamp: `483dbb39773e936665cccf5eeb1e669a53e10390e9ee7f6cde3612ad10ff2368`  

Verifier: SHA-256 computed on pre-witness gist body. Reproduce:
```
printf '%s%s' "42dc7ff29b2f3c387bc7ce8ae8e528c8dda6f3904ed49e93d4100ddadc9d0acd" "4cbcfc2671ad3f13ac9a648c1604c09fdb934248" | sha256sum
# must equal 483dbb39773e936665cccf5eeb1e669a53e10390e9ee7f6cde3612ad10ff2368
```

---

## Recommended Next Steps

1. **Implement temporal decay controller in AgentDB** (ADR-156): Add TTL-based aging with configurable half-life per namespace tier (short: 7 days, episodic: 90 days, long-term: 1 year). Prevents semantic drift identified by SSGM (arXiv:2603.11768). Estimated ~120 LOC new controller.

2. **Add episodic ground-truth layer alongside HNSW embeddings**: Store raw conversation episodes as first-class objects (not just embeddings) to enable MemMachine-style retrieval. Target: recover 80% token efficiency vs current embedding-only recall on LoCoMo-style queries.

3. **Run LoCoMo benchmark against current AgentDB**: Establishes baseline before ADR-156 changes land. MemMachine 0.9169 is the 2026 SOTA bar. Current Ruflo likely trails without temporal decay + episodic layer.
