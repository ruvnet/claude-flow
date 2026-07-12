# Intelligence SOTA Report — 2026-07-12

**TL;DR:** The 2026 "Harness Effect" paper proves orchestration design alone cuts agent cost 41% and latency 44% — independent of model choice — and heterogeneous agent configurations deliver 2.3× accuracy over homogeneous setups; Ruflo's static 3-tier router captures neither gain.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| Orchestration design cuts blended cost 41% ($0.21→$0.12), latency 44% (48s→27s), tokens 38% (14.2k→8.8k); quality improves 0.78→0.81; every model gains 33–61% | arXiv:2607.06906 "The Harness Effect" | **A** |
| Heterogeneous multi-agent (solver+critic+aggregator): 0.64 vs 0.54 step-wise accuracy (18.5% gain); 2.3× over homogeneous configurations; model diversity > framework structure | arXiv:2607.07729 "Collective Intelligence with Foundation Models" | **A** |
| Superminds Test: agent societies fail to synthesize distributed information at scale; shallow interaction (rarely >1 reply depth) prevents collective gains; scale ≠ intelligence | arXiv:2604.22452 | **A** |
| Cognitive-structured multimodal agent: 91.4% retrieval accuracy over 20-turn sessions, +8.2% vs 32B baselines; inference time halved (23.1s→12.7s) | arXiv:2607.08497 | **A** |
| Cost-effective ARC-AGI-1 agent: 67.25% pass@2 at $0.62/task via Reflective Orchestrator — no benchmark-specific training | arXiv:2607.06764 | **A** |
| Collective AI discovery: improved kissing-number bound in dimension 11 from 593→604 via agent society iterative submission + public discourse | arXiv:2606.10402 | **A** |

---

## Ruflo Current Capability

| Capability | Status | Notes |
|------------|--------|-------|
| 3-tier model routing (Haiku/Sonnet/Opus) | ✅ Shipped | ADR-026, ADR-143 — static complexity threshold |
| Context window sizing per task | ❌ Missing | Fixed per-model defaults; no dynamic governor |
| Turn sequencing optimization | ❌ Missing | No per-task token-budget tracking |
| Heterogeneous agent role diversity | ⚠️ Partial | 60+ agent types exist but no router enforces diversity |
| Per-task cost tracking & feedback | ❌ Missing | No runtime cost telemetry → no closed-loop optimization |
| Collective intelligence coordination | ⚠️ Partial | SendMessage + CRDT sync present; no interaction-depth enforcement |
| Cognitive structured retrieval | ⚠️ Partial | HNSW indexed; no typed 13-category memory (Memanto gap) |

---

## Competitor Comparison

| Framework | Harness Cost Control | Heterogeneous Routing | Agent Memory | 2026 Notable |
|-----------|---------------------|----------------------|-------------|--------------|
| **LangGraph 1.2.9** | DeltaChannel (incremental state, not cost-aware) | Conditional edges + node-level timeout | External (LangSmith) | NodeTimeoutError, graceful drain, type-safe v2 API |
| **AutoGen 1.0 GA** (maintenance) | Event-driven v2 architecture; conversational latency leader | Multi-agent conversational; homogeneous by default | None native | Superseded by MS Agent Framework GA April 2026 |
| **CrewAI 0.95** | No cost governor; async runner experimental | Role-based crews (researcher/writer/reviewer) | None native | A2A protocol interop; improved Anthropic tool routing |
| **OpenAI Swarm** | No documented cost layer | Handoff-based routing; no diversity enforcement | None native | Stable; no major 2026 intelligence update |
| **Ruflo 3.6.10** | ❌ Static tier thresholds only | ⚠️ 60+ types, unmanaged diversity | AgentDB + HNSW | 3-tier routing, SONA, MoE present but cost-blind |

---

## Benchmarks

| Benchmark | 2026 SOTA | Source | Grade |
|-----------|-----------|--------|-------|
| SWE-bench Verified | Claude Opus 4.7 — 87.6% | Anthropic / leaderboard | **A** |
| OSWorld (GUI automation) | 73.1–82.6% (parity with human 72.4%) | benchmarkingagents.com crosschecked 2026 | **A** |
| LongMemEval (memory) | Memanto — 89.8% accuracy | arXiv:2604.22085 ablation | **A** |
| LoCoMo (long-context memory) | Memanto — 87.1% accuracy | arXiv:2604.22085 ablation | **A** |
| ARC-AGI-1 | 67.25% pass@2 at $0.62/task | arXiv:2607.06764 | **A** |
| Harness cost-per-task | 41% reduction via orchestration design | arXiv:2607.06906, 6-model study | **A** |

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `7ef4d4e655d81c0451f6f40f35729cce6c9928e7` |
| Report SHA-256 | `2c02b5b42460fe31bbd81bf6407a599f531524f1e0735272ced447af83e1895e` |
| Witness stamp | `7be0c4a3e35a3e37d3180a11db2ef27b099bf70a98e381e6e653e4abb77b3659` |
| Verifier | SHA-256 of pre-witness gist draft → concat session commit → SHA-256 → must equal witness stamp |

---

## Recommended Next Steps

1. **Implement Dynamic Harness Cost Governor (ADR-179)** — Add a runtime budget-allocation layer between the 3-tier router and agent execution: track per-task token spend, dynamically size context windows (trim inactive memory entries >3 turns old), batch sequential tool calls, and feed cost-outcome pairs back to the MoE gate for closed-loop routing improvement. Target: 30%+ token reduction matching the Harness Effect baseline.

2. **Enforce Heterogeneous Role Diversity on Swarm Init** — Modify `swarm_init` topology logic to reject all-identical agent-type configurations when >3 agents are spawned (mirrors the 2.3× finding from arXiv:2607.07729). At minimum 2 distinct agent specializations per swarm; add `diversity_score` to swarm telemetry.

3. **Typed Semantic Memory Upgrade for AgentDB (Memanto Gap)** — Port Memanto's 13-category typed memory schema (goal/plan/action/observation/reflection/…) to AgentDB's existing schema layer; implement single-query information-theoretic retrieval to replace the current multi-HNSW-query pipeline. Target: sub-90ms latency match at N>10k vectors.
