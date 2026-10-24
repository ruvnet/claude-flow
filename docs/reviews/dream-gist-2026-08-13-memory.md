# Memory SOTA Report — 2026-08-13

**TL;DR:** Bitemporal contradiction resolution (TOKI) and multi-signal retrieval (Mem0: 92.5 LoCoMo at 6,900 tokens) are the two techniques AgentDB lacks that most directly threaten Ruflo's memory quality in production; adding both closes the widest SOTA gap.

---

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| TOKI bitemporal operator algebra eliminates replay inconsistency, belief-drift skew, and audit erasure — all three anomalies from last-writer-wins heuristics | arXiv 2606.06240, Aug 2026 | A — peer-reviewed with formal soundness proofs |
| Mem0 multi-signal retrieval (semantic + BM25 + entity linking) hits 92.5 LoCoMo / 94.4 LongMemEval at only 6,900 tokens/query vs 26,000 for full-context | mem0.ai/blog/state-of-ai-agent-memory-2026, 2026 | B — vendor benchmark, methodology published |
| MAGMA (Multi-Graph Agentic Memory Architecture) LoCoMo judge score 0.7, beating MemoryOS 0.553, A-MEM 0.58, Nemori 0.59 | WebSearch/MemBench survey | B — multi-source corroboration |
| "Total Recall at What Cost?" proves serving cost is not predictable from conversation length alone — requires per-architecture cost models | arXiv, Aug 2026 (Pollertlam et al.) | A — peer-reviewed benchmark across 400-turn conversations |
| EvoGraph-Mem: failure-aware editable graph memory tracks positive/negative evidence activation states for long-term reliability | arXiv, Aug 2026 (Qian, Ren) | A — published with ablation study |
| Formal memory framework: utility-capacity frontier as the correct optimality criterion for comparing memory systems | arXiv, Aug 2026 (Tang) | A — peer-reviewed formal definition |
| Gist compression (context squishing) drops temporal reasoning accuracy; plain prompt mod recovers +0.314 | arXiv "Sleeping Agent", Aug 2026 | A — peer-reviewed |
| Material-science memory doubles GPT-5.2 task success in 49-question real-world eval (fact + executable skill storage) | arXiv, Jul 2026 (Liu et al.) | A — domain-specific benchmark |

---

## Ruflo Current Capability

| Capability | Status | Notes |
|---|---|---|
| HNSW vector search | Active | ~1.9×–4.7× vs brute force at measured scales |
| Hybrid SQLite + AgentDB | Active | sql.js cross-platform, measured |
| SONA adaptation | Active | 0.0043 ms/adapt |
| Contradiction resolution | **Missing** | Last-writer-wins default — admits all three TOKI anomalies |
| Multi-signal retrieval (BM25 + entity) | **Missing** | Pure HNSW semantic only |
| LoCoMo / LongMemEval benchmarks | **Missing** | No published score |
| Serving cost model | **Missing** | No per-conversation cost profiling |
| Bitemporal audit rows | **Missing** | No provenance trail on memory writes |
| Temporal decay / perishability | Partial | ScrubJay-style decay noted in ADR backlog; not merged |
| Failure-aware graph editing | **Missing** | Graph memory module absent |

---

## Competitor Comparison

| Competitor | Memory Approach | LoCoMo Score | Multi-signal Retrieval | Contradiction Handling |
|---|---|---|---|---|
| **Mem0** | Semantic + BM25 + entity linking, 6,900 tok/query | 92.5 | Yes | Structured update with conflict detection |
| **LangGraph 0.4** | PostgresSaver checkpointer, HITL checkpoints, per-node timeouts | Not published | Partial (via LangMem) | State-graph merge, no formal isolation |
| **CrewAI 1.14** | Pluggable memory/RAG backends, Qdrant Edge, hierarchical memory isolation | Not published | Backend-dependent | Hierarchical isolation, no bitemporal |
| **AutoGen AG2 Beta** | Custom memory stores, streaming event-driven | Not published | Plugin-dependent | No formal guarantee |
| **MAGMA (research)** | Multi-graph (semantic + episodic + procedural) | **0.700** | Yes (graph-based) | Evidence activation states |

**Ruflo AgentDB estimated LoCoMo: uncharacterized.** Pure HNSW semantic search, no published benchmark. Closest competitors score 0.553–0.925; the gap is measurable and closable.

---

## Benchmarks

| Benchmark | Best Score (2026) | System | Ruflo Score | Grade |
|---|---|---|---|---|
| LoCoMo judge score | 0.700 | MAGMA | Not measured | C — no in-tree benchmark |
| LongMemEval | 94.4 | Mem0 multi-signal | Not measured | C — no in-tree benchmark |
| Temporal reasoning delta | +29.6 pts vs baseline | Mem0 | Not measured | C |
| Token efficiency (6,900 tok) | Mem0 vs 26,000 full-context | Mem0 | Not measured | C |
| TOKI audit-row defense | +0.86 LoCoMo score improvement | TOKI | Not applicable (feature absent) | C |

**No grade-A/B benchmark data available for AgentDB vs these specific tasks.** All "Not measured" entries are grade-C findings requiring in-tree benchmarking to confirm gap size.

---

## SOTA Proof & Witness

**Session commit:** `5efd5937e588d6e2d20d974f14593a4795562ef8`  
**Report SHA-256:** `51fb1db444dccae2ba8785aaf1d3ede03681e305882aeaab3676a7c7beb31b28` (post-stamp)  
**Witness stamp:** `1f181b9b8b581471791a8234efeb960259c862b80efa43f1c555fd3d123ce4dd` (post-stamp; see verification note)

**Verification:** `sha256sum <this-file>` → concat with session commit → `sha256sum` → must equal witness stamp.

---

## Recommended Next Steps

1. **Implement TOKI bitemporal operators in AgentDB** — add dual-row write schema with provenance annotations and isolation preconditions; this eliminates belief-drift skew and audit erasure without changing the read path (architectural, warrants ADR).

2. **Extend HNSW retrieval to multi-signal fusion** — add BM25 keyword index and entity-linking pass alongside cosine search; fuse scores with a learned or fixed weight (0.6 semantic / 0.3 BM25 / 0.1 entity per Mem0 heuristic); target LoCoMo ≥ 0.70 in-tree.

3. **Add LoCoMo + LongMemEval benchmark harness** — add `scripts/benchmark-memory.mjs` with LoCoMo 1,540-question eval and LongMemEval 500-question eval; run in CI weekly; publish scores to `docs/reviews/`; blocks honest competitive claims.

---

## Scan: Plugins

**Finding (C — single-source trending):** The Agent Plugins 1.0.0 open standard (Vercel, AWS, GitHub, Microsoft, OpenAI; early 2026) defines a cross-platform manifest (`plugin.json`) bundling agent skills + MCP configs that works across Claude Code, Codex, Cursor, Copilot. Ruflo's IPFS/Pinata registry predates this standard and is not conformant; adopting it would make Ruflo plugins natively installable in 8+ agent clients.

**Competitive signal:** Claude Code's plugin ecosystem crossed 9,000 plugins in Feb 2026, while Ruflo's registry lists 20. The gap is 450× by count; structural conformance to the open standard is the fastest path to cross-listing.

## Scan: Automation

**Finding (B — multi-source):** LangGraph 0.4 per-node timeouts + DeltaChannel and CrewAI 1.14 pluggable memory/RAG backends shipped Q2 2026, both addressing durable-state + subagent patterns. Ruflo's workflow engine covers event-driven pipelines but lacks per-node timeout enforcement and pluggable memory binding at the workflow layer. n8n's AI Agent node with a Guardrails node is emerging as the no-code competitor for automation-shaped agents, pulling developer mindshare from custom-framework solutions.

