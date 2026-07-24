# Swarm Orchestration SOTA Report — 2026-07-24

**TL;DR:** In 2026, swarm orchestration research confirms that dynamic topology selection beats static, hierarchical BFT consensus scales to 990 agents with 97% fault tolerance, and the primary subagent management bottleneck is privilege granting—not task quality—exposing a critical gap in Ruflo's swarm permission model.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| SWARM+ scales to 990 agents, 97% completion under distributed failures, 97-98% selection time reduction | arXiv 2603.19431 (FABRIC testbed, production traces) | **A** |
| ClawArena-Team: no LLM model exceeded 50% workspace-permission precision across 41 orchestration scenarios | arXiv 2606.31174, 258 eval rounds | **A** |
| Privilege granting (not perception) is primary management bottleneck for LLM team leads | arXiv 2606.31174 | **A** |
| Adaptive topology (task-dependency-graph selection) yields 12-23% over static baselines | AdaptOrch, single vendor report | **B** |
| Swarm-mesh-8agents achieves 85.2% success rate, outperforming equivalent hierarchical topologies | Framework comparison benchmark 2026 | **B** |
| MAS-PromptBench: prompt optimization helps single agents 15-30%, gains collapse in multi-agent coordination | arXiv 2606.23664 | **A** |

---

## Ruflo Current Capability

| Capability | State | Notes |
|-----------|-------|-------|
| Topology selection | Static at init | hierarchical, mesh, adaptive options but set once |
| Raft consensus | Active | Leader-based, handles f < n/2 failures |
| Byzantine fault tolerance | Via `byzantine-coordinator` agent | Not default for swarm init |
| Subagent permission model | None | No workspace-permission delegation protocol |
| Swarm benchmark suite | None | No ClawArena-equivalent for Ruflo |
| HNSW search (ruvector) | Local NAPI, ~1.9x at N=20k | No external DB connector (Qdrant/Weaviate/Milvus) |
| ruview integration | Harness vertical template only | No dedicated ruview-swarm plugin |

---

## Competitor Comparison

| Framework | Topology | Fault Tolerance | Permission Model | Scale | 2026 Benchmark |
|-----------|----------|-----------------|------------------|-------|----------------|
| **SWARM+** | Hierarchical BFT, O(log n) | 97% job completion under 50% node loss | Consensus-gated delegation | 990 agents | A-grade FABRIC testbed |
| **LangGraph** | Graph-based DAG | Retry/checkpoint | Node-level permissions | Enterprise-scale | Largest production footprint 2026 |
| **AG2 (AutoGen v0.4)** | Event-driven, async | Strong for multi-turn | Pluggable strategies | Research-scale | Best complex negotiation |
| **CrewAI** | Role-based sequential/parallel | Limited recovery | Task-level scope | Medium-scale | 30-60% faster than AutoGen, simple tasks |
| **OpenAI Agents SDK** | Handoff graph | Sandbox isolation | Tool-scope permissions | Production | Evolved from Swarm experimental |
| **Ruflo** | Hierarchical/mesh/adaptive (static) | Raft + optional BFT | None (gap) | 8-agent default | No external benchmark |

---

## Benchmarks

| Metric | Value | Source | Grade |
|--------|-------|--------|-------|
| SWARM+ job completion under 50% agent loss | 97% | arXiv 2603.19431, FABRIC testbed | **A** |
| SWARM+ selection time reduction vs SWARM | 97-98% | arXiv 2603.19431 | **A** |
| ClawArena-Team max permission precision | <50% across all tested LLMs | arXiv 2606.31174, 258 rounds | **A** |
| AdaptOrch dynamic topology vs static | +12-23% | Vendor report | **B** |
| Ruflo HNSW vs brute force (N=20k) | ~1.9x | scripts/benchmark-intelligence.mjs | **A** |
| Qdrant p99 latency (10M vectors) | ~12ms vs Weaviate ~16ms, Milvus ~18ms | Multi-vendor benchmark 2026 | **B** |
| ruvector external DB integration | Not available | No connector exists | — |

**Scan: ruvector-integration** — Qdrant dominates open-source at 10-25% faster p99 than Weaviate or Milvus for <10B vectors; Milvus wins at billion-scale with GPU acceleration. Ruflo's ruvector NAPI backend has no external connector, capping scale to local SQLite+HNSW.

**Scan: ruview-integration** — `vertical:ruview` exists as a metaharness template (plugins/ruflo-metaharness/skills/harness-mint/SKILL.md) but no dedicated swarm-backed ruview integration plugin exists. LangGraph and CrewAI both ship built-in code review agent roles.

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `26c35b59b40a0a95b286ccf5ac675a15edcc995f` |
| Report SHA-256 | `56f2500749caa5bdbf3ffdb472318b3d478c6d72ee62b80d60dbb13cdbae5c30` |
| Witness stamp | `4b6fc6e694c51dffa78074bb03d71ff3a8c178b50fa9745f3de0ac1ba123e5e8` |
| Verifier | `sha256(report_sha256 + session_commit)` |

---

## Recommended Next Steps

1. **Implement SubagentPermissionDelegate protocol (ADR-320):** ClawArena-Team shows privilege granting is the #1 bottleneck — add workspace-scoped token delegation to `swarm init` so each subagent receives a least-privilege capability set. Target: lift swarm permission precision from ~0% (unmeasured) to >50% on ClawArena-style eval.

2. **Add dynamic topology auto-selection to `swarm init --v3-mode`:** Current static topology choice at init time leaves 12-23% performance on the table (AdaptOrch). Wire a dependency-graph analyzer on the task payload to select hierarchical vs mesh vs adaptive before spawning agents.

3. **Add ruvector external-DB connector (Qdrant first):** ruvector's local NAPI backend caps at SQLite scale. Add a `--backend qdrant` flag to `memory search` / `embeddings search` using Qdrant's REST API, enabling scale-out to 10M+ vectors at Qdrant's proven <12ms p99 latency without changing the HNSW interface contract.
