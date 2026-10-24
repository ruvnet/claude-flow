# Performance SOTA Report — 2026-08-10

**TL;DR:** Cross-agent KV cache sharing delivers 7.8× prefill speedup in 5-agent swarms (KVCOMM, NeurIPS '25 / A); Ruflo has no shared KV mechanism — every swarm agent carries an independent full-precision cache.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| KVCOMM anchor-based KV reuse: 70%+ reuse rate, **7.8× prefill speedup** in 5-agent settings | arXiv 2605.03884 / NeurIPS '25 | **A** — published, code public |
| LatentMAS shared-KV working memory: **83.7% token savings** across agents on shared context | arXiv 2606.05711 | **B** — crosschecked against Ramp Labs blog |
| PolyKV asymmetrically-compressed shared KV pool: N agents, 1 pool, memory sub-linear in N | arXiv 2604.24971 | **B** — pre-print, no code link confirmed |
| MemOPD on-policy distillation: **1.63× speedup** in actor computation + 7% F1 gain | arXiv 2608.07068 | **A** — code public (TPssp/MemOPD) |
| VeriCache: lossless inference with lossy KV compression on SWE-bench / ComplexFuncBench | arXiv 2605.17613 | **B** — pre-print, benchmarks named |
| Framework overhead 2026: CrewAI uses **18% more tokens** than LangGraph on equivalent tasks; LangGraph 62% complex completion vs AutoGen 58% vs CrewAI 54% | tensoria.fr benchmark, crosschecked pickaxe.co | **B** — two independent sources agree on direction |

---

## Ruflo Current Capability

| Capability | Status |
|------------|---------|
| Per-agent memory (AgentDB) | ✅ SQLite + HNSW per-agent store |
| Cross-agent KV cache sharing | ❌ No mechanism; each swarm agent holds independent cache |
| Token budget / compact context | ⚠️ ReasoningBank `-32%` token reduction (retrieval-side only) |
| Agent Booster edits | ✅ 352× faster edits (-15% token overhead) |
| Swarm coordinator cache API | ❌ `TopologyManager` has no cache-sharing interface |
| Multi-agent context compression | ❌ No LatentMAS/latent-briefing equivalent |

The `@claude-flow/hooks` workers include `ultralearn` and `consolidate` but neither exposes a KV-cache sharing interface. The `@claude-flow/memory` package (AgentDB) stores embeddings, not raw KV states — a different layer.

---

## Competitor Comparison

| Competitor | KV sharing | Complex task completion | Token efficiency | 2026 status |
|------------|-----------|------------------------|-----------------|-------------|
| LangGraph | None (StatGraph, isolated agents) | ~62% | Best-in-class; near zero framework overhead on simple tasks | Production leader, 38% enterprise share |
| AutoGen / AG2 | None | ~58% | Slowest — chat-heavy consensus overhead | GA Feb 2026, active |
| CrewAI 0.95 | None | ~54% | 18% token overhead vs LangGraph | Active, async runner added 2026 |
| OpenAI Agents SDK | None | N/A (benchmark scope differs) | Lowest latency — native function tool-call path | Stable, replaced Swarm |
| Ruflo | None | Not published | ReasoningBank -32% retrieval; no serving-layer sharing | v3 stable (3.7.x) |

No competitor in this set has implemented cross-agent KV cache sharing at the framework level. This is an opportunity.

---

## Benchmarks

| System | Metric | Value | Grade |
|--------|--------|-------|-------|
| KVCOMM (NeurIPS '25) | Prefill speedup, 5-agent swarm | **7.8×** | **A** — peer-reviewed, code released |
| MemOPD | Actor computation speedup | **1.63×** | **A** — code public |
| LatentMAS | Token savings (cross-agent shared context) | **83.7%** | **B** — single vendor source crosschecked |
| LangGraph vs CrewAI (tensoria.fr + pickaxe.co) | Token overhead delta | **+18% CrewAI** | **B** — two sources agree |
| LangGraph complex task completion | Success rate | **62%** | **B** — two benchmark sources agree |

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `913f9eaedee92627950544424e50339feaf98271` |
| Report SHA-256 | `98307ad3ad8a656119c65bac4578c12e0a78f03e2c2bc8410fa954a75e32a210` |
| Witness stamp | `2f5f39638bc1480aeafcb681fc9de919d98f62e635b012d0b81bf070ce8e8b05` |
| Verifier | `sha256sum dream-gist-2026-08-10.md` → concat session commit → `sha256sum` → must match Witness |

Gist proxy blocked write (same constraint as prior nights). Canonical content stored in branch at `v3/research/dream-gist-2026-08-10.md`.

---

## Scan Findings — security

**Source:** OWASP GenAI/LLM Top 10 2026 (released 2026-08-06, cybersecuritynews.com + helpnetsecurity.com)

**Finding:** OWASP LLM Top 10 2026 is out. Prompt Injection remains #1 (now covers cross-modal attacks: images/audio). Excessive Agency jumped from 6th to 3rd. Core new philosophy: "Stop trying to build a model that cannot be fooled. Build the system around it." List was 75% data-driven (6,639 real incidents) for the first time.

**Competitive signal:** No competitor changelog (LangGraph, AutoGen, CrewAI, OpenAI SDK) references OWASP LLM 2026 alignment in their 2026 documentation. Ruflo's `@claude-flow/security` module covers input validation and CVE remediation but does not reference OWASP LLM 2026 cross-modal prompt injection.

**One-sentence finding (Grade B — OWASP source, crosschecked SD Times + HelpNetSecurity):** OWASP LLM Top 10 2026 adds cross-modal prompt injection and elevates Excessive Agency to 3rd; Ruflo's security module needs an explicit alignment audit against the new rubric.

---

## Scan Findings — hive-mind

**Source:** arXiv 2605.09076v2 (Robust Multi-Agent LLMs under Byzantine Faults, 2026) + AgentShield dataset (IEEE DataPort)

**Finding:** CP-WBFT (Zheng et al., 2026) achieves Byzantine fault tolerance with up to 6 malicious nodes (85.7%) by weighting agents by self-reported confidence — 2-3× improvement over topology-agnostic BFT. Topology selection matters: XSTest accuracy varies 34% to 94% by topology choice.

**Competitive signal:** No competitor framework (LangGraph, AutoGen, CrewAI) exposes a configurable BFT topology or per-agent confidence weighting in their changelog. AgentShield provides a public evaluation dataset for this; Ruflo's hive-mind has Raft/BFT modes but no confidence-weighted aggregation.

**One-sentence finding (Grade B — arXiv pre-print crosschecked against AAAI proceedings link):** Confidence-weighted Byzantine aggregation (CP-WBFT, 2026) achieves 85.7% fault tolerance with 6/N malicious agents; Ruflo's hive-mind lacks per-agent confidence weighting in its Raft/BFT consensus path.

---

## Recommended Next Steps

1. **Implement KVCOMM-style anchor-based KV sharing in `TopologyManager`** — add a `SharedKVPool` interface that swarm agents register with at init. For N agents processing the same base context, redirect prefill through the pool. Entry point: `v3/@claude-flow/swarm/src/topology-manager.ts` `addNode` API. Expected: 7× prefill reduction for ≥5-agent swarms. (ADR-381)

2. **Add LatentMAS-style latent briefing for cross-agent context hand-off** — when `post-task` hook fires and the next agent needs the prior agent's result as context, compress via attention-matching compaction rather than re-encoding from text. Target: 49–84% token savings on cross-agent context passes. Hooks entry point: `v3/@claude-flow/hooks/src/post-task.ts`.

3. **Publish a Ruflo swarm performance benchmark** — no competitor has published cross-agent cache metrics; being first with a reproducible swarm-throughput benchmark (tokens/s per agent at N=5, 10, 20 agents) would close the measurement gap and validate ADR-381 implementation.
