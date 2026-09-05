# Performance SOTA Report — 2026-06-20

**TL;DR:** In 2026, multi-agent orchestration performance has diverged sharply — LangGraph leads on latency ($0.08/task, 62% completion), a new Meta-Skill evolution paper (Skill-MAS) shows transferable orchestration gains with no parametric update, and deep-unfolded coordination achieves 6.18–9.44× speedup over conventional distributed solvers. Ruflo lacks a published multi-agent task-completion-rate benchmark and has no equivalent to Meta-Skill evolution; ADR-163 proposes closing both gaps.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|-----------|
| Deep-Unfolded Coordination achieves 6.18–9.44× speedup for distributed multi-agent optimization (ADMM-DDP) | arXiv:2606.19920 | A |
| SIGMA skill-bundle agents improve +2.06–2.36 pts over strongest baseline on 3 benchmarks | arXiv:2606.19758 | A |
| Skill-MAS Meta-Skill evolution transfers across unseen tasks & LLMs without parametric update | arXiv:2606.18837 | B |
| LangGraph wins latency + cost ($0.08/task, 62% task completion) vs AutoGen 58%, CrewAI 54% | Independent 2026 benchmark (2,000 runs) | B |
| Cerebras Qwen 3 235B: 525 tokens/sec; Groq Llama 4 405B: 480 tokens/sec, 0.18s TTFT P50 | Vendor benchmarks (pendium.ai, opper.ai) | B |
| Token compression at edge reduces latency + cost up to 50% in production multi-agent flows | Research.aimultiple.com 2026 | C |

---

## Ruflo Current Capability

| Capability | Status | Notes |
|-----------|--------|-------|
| 3-Tier Model Routing | Deployed | Tier 1 codemod ($0), Tier 2 Haiku (~500ms), Tier 3 Sonnet/Opus (2–5s) |
| Agent Booster fast-apply edits | Deployed | Claims 352x faster edits — no independent verification |
| ReasoningBank pattern retrieval | Deployed | Reduces tokens 32%, no multi-trajectory rollout |
| Published task completion rate | **Missing** | No equivalent to LangGraph 62% / AutoGen 58% / CrewAI 54% |
| Throughput-per-dollar benchmark | **Missing** | Competitor: LangGraph $0.08/task — Ruflo has no published figure |
| Meta-Skill / orchestration evolution | **Missing** | Skill-MAS equivalent not present; ReasoningBank stores patterns but does not evolve orchestration |
| HNSW search speedup (measured) | Deployed | ~1.9× at N=20k, ~3.2–4.7× at N=5k vs brute force |

---

## Competitor Comparison

| Framework | Task Completion | Latency | Cost/Task | Token Efficiency | Notes |
|-----------|----------------|---------|-----------|-----------------|-------|
| **LangGraph** | 62% | Lowest | $0.08 | High | Stateful graph, best enterprise fit |
| **AutoGen** | 58% | Low | ~$0.10 est | Moderate | Strong open-ended reasoning |
| **CrewAI** | 54% | Moderate | ~$0.12 est | Low (3× on simple tasks) | Fastest time-to-demo |
| **OpenAI Swarm / Agents SDK** | Not published | Experimental | Not published | Unknown | Lightweight; not production-graded |
| **Ruflo** | **Not published** | <100ms MCP target | Not published | -32% via ReasoningBank | Richest agent ecosystem but no comparable benchmark |

*Source: Independent 2026 benchmark on 2,000 task instances across identical model backend. Grade B.*

---

## Benchmarks

| Benchmark | Metric | Value | Grade |
|-----------|--------|-------|-------|
| Deep-Unfolded Coordination (arXiv:2606.19920) | Speedup vs conventional solvers | 6.18–9.44× | A |
| SIGMA (arXiv:2606.19758) | Points over strongest baseline | +2.06 / +2.36 / +1.75 | A |
| Cerebras Qwen 3 235B | Throughput | 525 tokens/sec | B |
| Groq Llama 4 405B | TTFT P50 | 0.18s | B |
| TensorRT-LLM (Llama-3.1-8B) | Throughput | 11,076 tokens/sec | B |
| LangGraph multi-agent | Task completion | 62% / $0.08/task | B |
| Ruflo multi-agent task completion | **No 2026 data available** | — | — |

---

## SOTA Proof & Witness

- **Session commit:** `9c28fe038cf49ac6db0bb4e04b6158076f03894d`
- **Report SHA-256:** ecf9303385af873337d2bf9cdabc9803c4b1db620ab71b8afdd417bd84bc7d92
- **Witness stamp:** 0cfeb881934fe12077737e47016a7b3ce9da8314282ad8257c98e3f7c16d9e50

**Verification:** `sha256(report_file) + SESSION_COMMIT | sha256 = WITNESS`

---

## Recommended Next Steps

1. **Publish a Ruflo multi-agent benchmark** (ADR-163): Implement a performance suite measuring task-completion rate, cost-per-task, and MCP latency distribution across the same 5-task test set used in the LangGraph/AutoGen/CrewAI 2026 benchmark. Target: ≥65% completion rate to beat LangGraph's 62%.

2. **Port Skill-MAS Multi-Trajectory Rollout into ReasoningBank**: The current ReasoningBank stores single-trajectory patterns. Adding multi-trajectory rollout + selective reflection (per arXiv:2606.18837) would give Ruflo evolving Meta-Skills that generalize across unseen agent configurations — closing the largest orchestration learning gap vs SOTA.

3. **Apply deep-unfolded coordination to swarm task decomposition** (arXiv:2606.19920): The 6.18–9.44× speedup applies to distributed optimization of agent work assignments. Ruflo's hierarchical swarm currently uses fixed decomposition heuristics; integrating an unfolded ADMM layer for task assignment could yield measurable latency reduction in large swarms (N≥8 agents).
