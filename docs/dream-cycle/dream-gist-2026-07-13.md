# Memory SOTA Report — 2026-07-13

**TL;DR:** In-process retrieval (100µs vs 300ms), RL-driven self-optimization (+48.7% BEAM), and recurrence-gated consolidation (−87% tokens) are the three breakout memory advances in 2026 — Ruflo's AgentDB covers none of them.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| In-process memory store answers in ~100µs vs ~300ms for networked stores — makes per-step retrieval viable in real-time loops | "Memory in the Loop: In-Process Retrieval", Khan & Lipizzi, July 6 2026 (arXiv) | **A** |
| RL-driven self-optimization of memory strategy yields +48.7% BEAM score at 100K token scale | "SelfMem: Self-Optimizing Memory for AI Agents", Yang et al., July 4 2026 (arXiv) | **A** |
| LANTERN recovers 78.3% of facts lost to context compaction vs 72.4% MemGPT baseline, <25ms added latency, zero extra LLM calls | "LANTERN: Layered Archival and Temporal Episodic Retrieval Network", Subramani 2026 (arXiv) | **A** |
| Recurrence-gated consolidation (lazy, only triggered by sustained semantic cluster activity) cuts token cost 87% while exceeding eager-consolidation accuracy | "RecMem: Recurrence-based Memory Consolidation", Dai et al., May 15 2026 (arXiv) | **A** |
| Framing memory management as a trainable skill via automated trajectory review yields 2x–4x improvement on long-horizon tasks | "AutoMem: Automated Learning of Memory as Cognitive Skill", Wu et al., July 1 2026 (arXiv) | **B** |
| False memory promotion rate reduced from 0.597 to 0.040 with 0.960 recall preserved via governance layer (GovMem) | GovMem preprint 2026 | **B** |

Key 2026 techniques not prominent in 2025:
- **Active/proactive memory injection** rather than passive retrieval on request
- **Recurrence-gated consolidation** — avoids eager LLM calls unless semantic cluster activity is sustained
- **RL-driven self-optimization** of memory policy at runtime (SelfMem, AutoMem)
- **Temporal-state graphs with validity annotations** to handle ghost/stale facts (A-TMA, TRACE)
- **Memory security as first-class concern**: injection attack rate ~98%, dedicated defenses (AM-Sentry, SENTINEL)

---

## Ruflo Current Capability

| Capability | Status | Notes |
|-----------|--------|-------|
| Vector retrieval (HNSW) | ✅ Active | ~1.9× at N=20k, ~3.2–4.7× at N=5k vs brute force (recall@10 ~0.99) |
| Memory distillation | ✅ Active | 4-step RETRIEVE→JUDGE→DISTILL→CONSOLIDATE |
| Forgetting prevention | ✅ Active | EWC++ elastic weight consolidation |
| In-process memory store | ❌ Missing | Currently networked AgentDB (SQLite); per-step latency ~300ms |
| RL-driven memory strategy | ❌ Missing | No self-optimization layer; retrieval policy is static |
| Recurrence-gated consolidation | ❌ Missing | Current consolidation is eager (after N writes); no cluster-activity trigger |
| Temporal validity annotations | ❌ Missing | Facts have no expiry/stale markers; ghost-fact retrieval is unaddressed |
| Memory security (injection defense) | ❌ Missing | No AM-Sentry/SENTINEL equivalent; injection surface unmitigated |

---

## Competitor Comparison

| Competitor | Memory Architecture | In-Process Store | RL Self-Opt | Recurrence-Gated | Stale-Fact Handling |
|-----------|---------------------|-----------------|-------------|-----------------|-------------------|
| **LangGraph** v1.2.9 | Persistent state graph + checkpointing | No | No | No | Thread-scoped state; no TTL |
| **AutoGen** (maintenance mode) | ConversationMemory, Vector store plugin | No | No | No | No built-in TTL |
| **CrewAI** v1.15.0 | Entity memory + long-term SQLite + RAG | No | No | No | No validity annotations |
| **OpenAI** (GPT-5.5 Responses API) | Server-side retrieval (RAG) | No (cloud) | No | No | Retrieval timestamp only |
| **Ruflo** (AgentDB HNSW) | SQLite + HNSW vector index | No | No | No | No validity annotations |

**Finding:** All five frameworks share the same passive-retrieval + static-policy gap as of 2026-07-13. The academic SOTA (RecMem, SelfMem, LANTERN) is not yet implemented in any production framework — first mover wins significant differentiation.

---

## Benchmarks

| Metric | Value | Source | Grade |
|--------|-------|--------|-------|
| In-process retrieval latency | ~100 µs | Memory in the Loop (Khan & Lipizzi, July 2026) | **A** |
| Networked retrieval latency (baseline) | ~300 ms | Memory in the Loop | **A** |
| SelfMem BEAM score gain vs baseline | +48.7% at 100K tokens | SelfMem (Yang et al., July 2026) | **A** |
| LANTERN fact recovery | 78.3% vs 72.4% MemGPT | LANTERN (Subramani 2026) | **A** |
| LANTERN added latency | <25 ms, 0 extra LLM calls | LANTERN | **A** |
| RecMem token cost reduction | −87% vs eager consolidation | RecMem (Dai et al., May 2026) | **A** |
| GovMem false-promotion rate | 0.040 vs 0.597 (baseline), recall 0.960 | GovMem preprint 2026 | **B** |
| AutoMem long-horizon gain | 2×–4× | AutoMem (Wu et al., July 2026) | **B** |

---

## Scan Findings — Plugins (2026-07-13)

**Key signal:** MCP has become the de facto interoperability layer across all major frameworks (CrewAI v1.15.0 unlocks "thousands of tools from hundreds of MCP servers" without per-tool wrappers), but there is **no standardized trust or verification mechanism** for MCP servers. OWASP formally added agentic skill supply-chain attacks to its AI Top-10 list in 2026. Ruflo's plugin registry (IPFS/Pinata + checksum) is ahead of competitors on distribution integrity, but lacks runtime MCP server verification.

- **LangGraph:** Typed tool registry with per-tool risk levels and HITL gates (GA, v1.2.9)
- **AutoGen:** Maintenance mode; ecosystem redirected to Microsoft Agent Framework
- **CrewAI:** MCP integration + community tool registry with publish/distribute
- **OpenAI:** GPT-5.5 parallel tool calling + strict schema mode as defaults in Responses API

---

## Scan Findings — Automation (2026-07-13)

**Key signal:** AutomationBench (arXiv:2604.18934, Apr 2026, **Grade A**) shows frontier models score **<10%** on realistic cross-application REST API orchestration tasks spanning CRM, calendar, and messaging systems. DynAMO (arXiv:2606.19382, June 2026, **Grade A**) finds parallel execution yields 1.6× latency gain but LLM reasoning = 90% of wall time — smarter model selection is the bottleneck, not orchestration code. Ruflo's 3-tier model router (ADR-026, ADR-143) directly addresses this bottleneck; the gap is routing accuracy for multi-step cross-application workflows.

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `7ef4d4e655d81c0451f6f40f35729cce6c9928e7` |
| Report SHA-256 | `e251791b00b24565319d0a56e831551971802195604a81eb67b32685c82e4f17` |
| Witness stamp | `543eac4f274a08ea11b6299bae64c030fefe9e7509ddd81e5bb18db230159c80` |

*Verifier: fetch raw gist, sha256sum → REPORT_HASH; then `printf '%s%s' "$REPORT_HASH" "7ef4d4e655d81c0451f6f40f35729cce6c9928e7" | sha256sum` → must equal WITNESS.*

---

## Recommended Next Steps

1. **Implement RecMem-pattern recurrence-gated consolidation in AgentDB** (ADR-179): Replace the current eager N-write trigger with a cluster-activity monitor that only fires consolidation when semantic drift exceeds a sustained threshold. Target: −80% consolidation token cost, measured by existing benchmark harness (`scripts/benchmark-intelligence.mjs`).

2. **Add temporal validity annotations to AgentDB memory entries**: Each stored vector should carry `created_at`, optional `expires_at`, and a `confidence_decay` curve. Filter stale entries at retrieval time. This directly addresses the ghost-fact retrieval problem (GovMem: false-promotion rate 0.597→0.040) without adding LLM calls.

3. **RL self-optimization layer on HNSW retrieval policy (SelfMem pattern)**: Add a lightweight bandit/RL agent that tunes `ef_search`, `k`, and relevance threshold per namespace based on observed retrieval quality signals (JUDGE step verdicts). Ground truth already exists in the RETRIEVE→JUDGE step; wiring feedback back to retrieval parameters is the missing loop.

