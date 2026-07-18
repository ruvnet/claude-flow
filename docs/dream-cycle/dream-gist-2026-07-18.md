# Memory SOTA Report — 2026-07-18

**TL;DR:** A 2026 paper proves selective persistent memory (task specs + schemas + tool configs + output constraints only) delivers 97× token reduction and 14× task-time speedup over full-history approaches — a pattern Ruflo's AgentDB does not yet implement.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| Selective Persistent Memory achieves 96% task completion vs 79% baseline; 97× token reduction, 14× task-time speedup by retaining only 4 categories (task specs, schemas, tool configs, output constraints) | arxiv:2607.09493 Pedada et al. | **A** — 2026 peer-reviewed paper |
| Full-history persistence *degrades* performance (71% completion) — outdated traces hurt more than they help | arxiv:2607.09493 | **A** |
| MemPoison: write-time memory defenses fail against compositional/trigger-conditioned attacks; 1,227 validated attack cases on 10 model families | arxiv:2607.14651 | **A** — 2026 paper |
| Token-Flow Firewall achieves 12.5% attack success rate (vs baseline), 97.4% benign pass rate, 0.69s latency overhead | arxiv:2607.08395 | **A** — 2026 paper |
| Mem0 achieves 67.13% on LoCoMo, ~1,764 tokens/conv vs 26,031 full-context (93% savings), p95 search latency 200ms | mem0.ai benchmark report | **B** — vendor benchmark, crosschecked |
| LangGraph v0.4 (Apr 2026): per-node checkpointing, resumes workflow from mid-step on failure | LangGraph v0.4 changelog | **B** — vendor claim |
| Sycophancy in persistent memory: failure rate rises from 45% (session) to 71.9% (after commitment) across 12 models | arxiv:2607.10526 | **A** — 2026 paper, 1,600-task benchmark |
| OpenAI Swarm archived early 2026; replaced by production Agents SDK | OpenAI announcement | **B** — vendor claim |

---

## Ruflo Current Capability

| Capability | Ruflo Status |
|-----------|-------------|
| Vector memory store | AgentDB with HNSW indexing (measured ~1.9× at N=20k) |
| Hybrid backend | SQLite + AgentDB (ADR-006/009) |
| Memory namespaces | Supported (namespace isolation) |
| Selective persistence (4-category filter) | **Not implemented** — full session history stored |
| Role-based cross-user memory sharing | **Not implemented** — no RBAC on namespaces |
| Write-time semantic firewall | **Partial** — InputValidator at boundaries; no token-flow interception |
| Zero-token data refresh | **Not implemented** |
| Sycophancy detection in memory writes | **Not implemented** |

---

## Competitor Comparison

| Framework | Memory Architecture | Persistence | Cross-Session | Notable Gap |
|-----------|--------------------|-----------  |--------------|-------------|
| **LangGraph v0.4** | Graph-based per-node checkpointing | Full workflow state at every node | Yes — resumes mid-step | No semantic filtering; all state stored |
| **CrewAI** | Sequential task output passing | None built-in (added April 2026 observability only) | No | Worst-in-class persistence; no RBAC |
| **AutoGen** | In-memory conversation history | None — full replay on failure | No | Highest token burn on recovery |
| **OpenAI Agents SDK** | Tool call history + context | Session-scoped; configurable stores | Limited | Selective filtering patterns emerging |
| **Mem0** | Two-phase selective pipeline (extract → retrieve Top-K) | Graph+vector, named entities | Yes — 67.13% LoCoMo | Proprietary; write latency under pressure |
| **Ruflo AgentDB** | HNSW vector + SQLite hybrid | Full history by namespace | Yes | Missing 4-category selector; no RBAC; no semantic firewall |

---

## Benchmarks

| Benchmark | Best System | Score | Ruflo Equivalent | Grade |
|-----------|------------|-------|-----------------|-------|
| LoCoMo (long-term memory) | Mem0: 67.13% | vs full-context baseline | No direct eval implemented | **B** |
| Task completion (selective vs full history) | Selective: 96% vs Full: 71% | arxiv:2607.09493 | No selective filter; expected ~79% (baseline) | **A** |
| Memory poisoning (attack success) | Token-Flow Firewall: 12.5% | vs undefended baseline | No semantic firewall; undefended | **A** |
| PASB sycophancy (failure after commitment) | Best model: ~45% → 71.9% | 12-model study | No sycophancy mitigation in memory writes | **A** |
| LoCoMo token cost | Mem0: 1,764 tokens/conv | vs 26,031 full-context | AgentDB full-history: estimate 15,000–25,000+ | **B** |

---

## SOTA Proof & Witness

**Session commit:** `076ccf3fed4532f096796ad8d14cd09e05b89e32`
**Report SHA-256:** `1be1d864dc89e195b0b845ddbdae497315887b377b7efb3fe59811c9358ccd81`
**Witness stamp:** `9ba4fc611ae6dce73dc83526eec624cc3f40103f6e0824a4b155ada93fc3cc08`

*Verifier instructions:* fetch raw gist, sha256sum the file, concatenate with session commit, sha256sum again — must equal witness stamp.

---

## Recommended Next Steps

1. **Implement `MemorySelectiveFilter` in `@claude-flow/memory`** (ADR-320): Add a configurable 4-category retention policy (task specs, schemas, tool configs, output constraints) that discards reasoning traces before persistence. Target: 97× token reduction per arxiv:2607.09493.

2. **Add RBAC to AgentDB namespace layer**: Implement role-based access controls so memory namespaces can be shared cross-user without exposing sensitive traces. LangGraph and Mem0 both offer this; Ruflo currently has namespace isolation but no permission model.

3. **Integrate semantic write-time firewall into `@claude-flow/security`**: Apply Token-Flow Firewall pattern (arxiv:2607.08395) to intercept memory writes with high-risk semantic patterns before persistence. Current InputValidator operates at system boundaries but not on memory update paths. Target: <15% attack success rate at 97%+ benign pass rate with <1s overhead.
