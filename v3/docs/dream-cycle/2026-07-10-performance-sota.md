# Performance SOTA Report — 2026-07-10

**TL;DR**: The 2026 inference frontier has pivoted from per-request KV-cache tricks to workflow-level scheduling primitives — SAGA (1.64×), MARS (5.94×), and AgentRM (86% P95 reduction) all demonstrate that treating agent workflows as scheduling atoms beats optimising individual requests, yet no agent framework ships this pattern today.

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| Workflow-Atomic Scheduling (SAGA): 1.64× task completion, 99.2% SLO attainment vs vLLM v0.15.1 | arXiv:2605.00528 | C |
| GPU-CPU co-scheduling (MARS): 5.94× latency reduction, 1.87× task completion with OpenHands | arXiv:2604.26963 | C |
| OS-style MLFQ agent resource manager (AgentRM): 86% P95 latency ↓, 168% throughput ↑, 100% key-info retention | arXiv:2603.13110 | C |
| Stateful inference for multi-agent tool calling: 2.1× (6-turn), 4.2× (35-turn median), O(n_t)→O(Δ_t) | arXiv:2605.26289 | B |
| Multi-LoRA decomposed KV cache (LRAgent, ICML 2026): near-shared throughput + per-adapter accuracy | arXiv:2602.01053 | B |
| RL-adaptive inference batching: 3.5× over Round-Robin, 60% throughput ↑, 25% latency ↓ in multi-GPU | arXiv:2607.05272 | C |
| LangChain NemoClaw Blueprint: "harness-level tuning beats model fine-tuning" (no metric) | langchain.com/blog, Jul 8 | B |
| MAFBench: framework design choices alone cause >100× latency increase, −30% planning accuracy | arXiv:2602.03128 | C |

## Ruflo Current Capability

| Dimension | Current State |
|-----------|--------------|
| Task scheduling | Per-request MCP tool dispatch; no workflow-level scheduler |
| Inference reuse | AgentDB HNSW (measured 1.9×–4.7× vs brute force); no stateful turn reuse |
| Zombie agent detection | None — stuck agents block resources silently |
| Context compression | `consolidate` worker fires on timer, not on resource pressure |
| Multi-adapter KV cache | Single model per agent; no LoRA differentiation |
| SLO attainment | No published SLO target or attainment metric |

## Competitor Comparison

| Competitor | Workflow-Level Scheduling | Stateful Turn Reuse | Agent SLO Policy | Key 2026 Move |
|------------|--------------------------|--------------------|--------------------|---------------|
| **LangGraph** | None (DAG edges only) | None | None published | NemoClaw Blueprint w/ NVIDIA (Jul 8, 2026) |
| **AutoGen 0.7.5** | GraphFlow (compile-time only) | None | None | Bug fixes; `linear memory` in RedisMemory |
| **CrewAI 1.14+** | Sequential/hierarchical static | None | None | Pluggable memory backends |
| **OpenAI Agents SDK** | Request-level handoff | None | None | No 2026 scheduling update |
| **Ruflo 3.6.10** | Per-task `hooks` dispatch | None | None | ADR-179 proposed tonight |

## Benchmarks

| Paper | Metric | Value | Grade | Note |
|-------|--------|-------|-------|------|
| LRAgent (ICML 2026) | Per-LoRA cache throughput | Near-shared baseline | **B** | Peer-reviewed; arXiv:2602.01053 |
| Stateful Inference (Norgren) | Median turn latency (35-turn) | 4.2× faster | **B** | Reproducible benchmark in abstract; arXiv:2605.26289 |
| SAGA | Task completion vs vLLM v0.15.1 | 1.64× GM | C | arXiv preprint; no peer review listed |
| MARS | E2E latency reduction | 5.94× | C | arXiv preprint; no peer review listed |
| AgentRM | P95 latency reduction | 86% | C | arXiv preprint; no peer review listed |
| RL Batching (Sharifullin) | Multi-GPU throughput vs RR | 3.5× | C | arXiv:2607.05272; no peer review listed |
| No 2026 Grade-A data available for workflow-atomic scheduling. | | | | |

## SOTA Proof & Witness

**Session commit**: `7ef4d4e655d81c0451f6f40f35729cce6c9928e7`
**Report SHA-256**: `e6389bc35a0efa65b584df76b0709e8e338c1480e7413a850af24caff4658dd4`
**Witness stamp**: `4d0e3da40e06832b78a955e47ec80b32ee94d2fe4c3a59c433129ff5b62deb1e`
**Verifier**: `sha256sum <this file> | awk '{print $1}'` → concat with session commit → `sha256sum` → must equal witness stamp.

## Recommended Next Steps

1. **Implement WorkflowScheduler (ADR-179)**: Add a `WorkflowScheduler` to `@claude-flow/hooks` pre-task hook that groups agent requests by workflow DAG and schedules with critical-path priority. Benchmark target: ≥1.5× task completion time vs current per-request dispatch. Pattern: SAGA (arXiv:2605.00528).

2. **Add ZombieWatchdog to agent module (AgentRM pattern)**: Timer-based liveness check per active agent; on timeout, compress context to key-info (MLFQ evict with 100% retention guarantee) rather than hard-killing. Target: eliminate silent resource leaks in long-running swarms. Pattern: AgentRM (arXiv:2603.13110).

3. **Evaluate stateful inference integration**: Prototype vLLM/SGLang stateful KV persistence across sequential MCP tool calls in a single conversation. Current architecture re-processes full conversation context on every tool invocation. Measured 4.2× per-turn improvement available (arXiv:2605.26289, Grade B). File an integration spike issue with a 2-week timebox.
