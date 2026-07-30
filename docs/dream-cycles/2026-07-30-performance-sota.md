# Performance SOTA Report — 2026-07-30

**TL;DR:** "Two Calls Beat Five Agents" (arXiv 2607.26922, Grade A) delivers a 7.4× token-efficiency advantage for 2-call self-refinement over 5-agent pipelines in 2026; combined with HalluProp pre-hoc failure inference (84.6% AUROC, 65× speedup over post-hoc), tonight's research shows Ruflo's unconditional swarm invocation policy leaves significant token-efficiency on the table.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| 2-call self-refinement achieves 86.2% GSM8K accuracy at **7.4× lower token usage** than 5-agent pipeline on Qwen2.5-7B | arXiv 2607.26922 (Jul 29, 2026) | **A** |
| HalluProp pre-hoc failure risk inference: **84.6% AUROC** for fault localization, **65× faster** than post-hoc, sub-second diagnosis | arXiv 2607.26836 (Jul 29, 2026) | **A** |
| MindForge SLM fine-tuning: Qwen3.6-27B lifted from 37.98% → **49.51% ProgramBench**, matching frontier models via synthesis trajectories | arXiv 2607.27146 (Jul 29, 2026) | **B** |
| SafeClawArena benchmark: malicious plugins succeed **100%** of the time; highest attack success rate 70% across 4 attack surfaces | arXiv 2607.30755 (Jun 29, 2026) | **A** |
| MemSecBench: memory poisoning persists in **84.2%** of cases; complete attack chain succeeds in **50.3%** across 310 configurations | arXiv 2607.27080 (Jul 29, 2026) | **A** |
| MTGuard hybrid static-dynamic MCP tool analysis mitigates multiple harmful tool-use categories that static-only inspection misses | arXiv 2607.25297 (Jul 28, 2026) | **A** |
| Classical BFT convergence guarantees do NOT reliably apply to LLM-based Byzantine agents | arXiv 2606.15024 (Jun 12, 2026) | **A** |
| Self-Anchored Consensus (SAC): decentralized filter-and-refine protocol enables LLM-agent Byzantine resilience without central coordinator | arXiv 2605.09076 (May 9, 2026, rev. Jun 2026) | **A** |

---

## Ruflo Current Capability

| Capability | Status | Notes |
|------------|--------|-------|
| Multi-agent swarm invocation | ✅ Active — hierarchical, mesh, adaptive topologies | CLAUDE.md prescribes AUTO-INVOKE for 3+ file tasks |
| 3-tier model routing (ADR-026) | ✅ Active — deterministic/Haiku/Sonnet by complexity | Cost-only; no token-efficiency self-refinement path |
| Pre-hoc failure risk assessment | ❌ Absent | No HalluProp-style propagation risk before spawning |
| Capability-proportionate agent count | ❌ Absent | CLAUDE.md prescribes maxAgents=8 unconditionally |
| Memory poisoning detection | ❌ Absent | AgentDB stores all writes; no MemSecBench-style filtering |
| MCP runtime tool analysis | ❌ Absent | 314 registered tools have no lifecycle-aware dynamic inspection |
| BFT consensus filters | Partial — `byzantine-coordinator` exists | Not wrapped with resilient consensus filters; classical guarantees don't apply to LLM agents |
| Token-efficiency benchmark | ❌ Absent | No Agents/token-budget metric; `performance benchmark` suite has no efficiency gate |

---

## Competitor Comparison

| Competitor | Multi-Agent Efficiency Routing | Pre-hoc Risk Inference | Memory Poisoning Defense | MCP Runtime Security | BFT for LLM Agents |
|------------|:------------------------------:|:----------------------:|:------------------------:|:--------------------:|:------------------:|
| **LangGraph v1.2.10** | ❌ None (graph DAG, no efficiency gate) | ❌ None | ❌ None | ❌ None | ❌ None |
| **AutoGen / MAF v1.0** | Partial — self-refine mode (Grade B) | ❌ None | ❌ None | DockerExecutor sandbox | ❌ None |
| **CrewAI v1.15.9** | ❌ None | ❌ None | ❌ None | ❌ None | ❌ None |
| **OpenAI Agents SDK** | ❌ None | ❌ None | ❌ None | ❌ None | ❌ None |

Ruflo is **unregistered** on AA-AgentPerf (Artificial Analysis Agents/MW benchmark, Jun 2026) — as are all four competitors above. First-mover opportunity per prior cycle #2778.

---

## Benchmarks

| Benchmark | Metric | Value | Source | Grade |
|-----------|--------|-------|--------|-------|
| Two Calls vs 5 Agents (GSM8K, Qwen2.5-7B) | Token usage ratio | 7.4× fewer tokens for 2-call | arXiv 2607.26922 | **A** |
| Two Calls vs 5 Agents (GSM8K, Qwen2.5-7B) | Accuracy | 86.2% (2-call) vs 86.7% (5-agent) | arXiv 2607.26922 | **A** |
| HalluProp pre-hoc fault localization | AUROC | 84.6% average | arXiv 2607.26836 | **A** |
| HalluProp vs post-hoc baseline | Speed | 65× faster, sub-second | arXiv 2607.26836 | **A** |
| MemSecBench memory poisoning | Persistence rate | 84.2% (24 configs, 310 cases) | arXiv 2607.27080 | **A** |
| MemSecBench complete attack chain | Success rate | 50.3% | arXiv 2607.27080 | **A** |
| SAC Byzantine resilience | Agreement quality | Outperforms unfiltered LLM agents across topologies | arXiv 2605.09076 | **A** |
| Agentic-SecPBFT | Attack detection / throughput | 95% detection; 3.1× throughput under adversarial conditions | arXiv 2607.03269 | **B** |

---

## SOTA Proof & Witness

*(Filled at Step 4 — see below)*

| Field | Value |
|-------|-------|
| Session commit | `503b647325f6e0a98bd1d771ae6bca6def331d30` |
| Report SHA-256 | `caa436a48cce5d385c6c2c1693068758e85de92ac6a62a63be4a01f95ac4e783` |
| Witness stamp | `8369381b2f8f508195bed6f51d6ffad03d037c767bc342bf6eeb379568bdf2ab` |

**Verifier:** `sha256sum <this-file>` → concat with session commit (no separator) → `sha256sum` → must equal Witness stamp.

---

## Recommended Next Steps

1. **Add pre-hoc capability assessment to `hooks pre-task`** (ADR-333 §1): Before routing to swarm, estimate task complexity and hallucination propagation risk using a lightweight classifier (HalluProp pattern). If complexity <30% AND file count ≤2, recommend 2-call self-refinement path instead of spawning agents. Log decision to `.swarm/routing-decisions.jsonl`. Target: 3–7× token reduction on simple tasks.

2. **Add `hooks route` efficiency mode** (ADR-333 §2): Extend the existing 3-tier model router with a `--efficiency-mode` flag. In efficiency mode, attempt single-model self-refinement first (2 calls max), then escalate to Haiku (2 agents) or Sonnet multi-agent only if self-refinement score falls below threshold. Gate behind `CLAUDE_FLOW_FEATURE_EFFICIENCY_ROUTING=1`.

3. **Wire `memory store` through MemSecBench-informed validator** (security scan follow-up): Add provenance-type validation and poisoning detection to AgentDB writes — memory stored without `provenance_type` field gets flagged for audit worker review. This builds on ADR-322 (provenance typing, #2803) and closes the 50.3% attack-chain success rate identified by MemSecBench.
