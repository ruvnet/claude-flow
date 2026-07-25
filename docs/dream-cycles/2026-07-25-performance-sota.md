# Performance SOTA Report — 2026-07-25

**TL;DR**: AA-AgentPerf (June 2026, Grade A) establishes 23.6× hardware efficiency gap (61,354 vs 2,594 Agents/MW) and ACL 2026 Pareto-optimal research proves mixture-of-agents beats self-consistency by +2.7pp — Ruflo benchmarks neither.

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| AA-AgentPerf: first agentic inference benchmark, Agents/MW metric; GB300 = 61,354 vs H200 = 2,594 (23.6× gap) | Artificial Analysis, Jun 12 2026 | **A** |
| Mixture-of-agents Pareto-optimal: +2.7pp over self-consistency on MMLU-Pro; most efficient when parallel > sequential | arXiv 2605.01566, ACL 2026 SRW | **A** |
| RecursiveMAS: 1.2–2.4× inference speedup, 34.6–75.6% token reduction, +8.3% accuracy across 9 benchmarks | arXiv 2604.25917 | **B** |
| AutoAgents-Rust: 4.97 rps vs LangGraph 2.70 rps (+84%); CrewAI 44% failure rate excluded | dev.to/saivishwak, Feb 2026 | **B** |
| Mixture-of-agents at 20× CoT budget yields +7.1% MMLU-Pro over chain-of-thought baseline | arXiv 2605.01566, ACL 2026 SRW | **A** |

## Ruflo Current Capability

| Capability | Status | Notes |
|-----------|--------|-------|
| Agent inference benchmark | ❌ No AA-AgentPerf registration | `performance benchmark --suite all` exists but no Agents/MW metric |
| Test-time compute scaling | ❌ Absent | No mixture-of-agents routing config; 3-tier routing is cost-only |
| Flash Attention speedup | ❌ Unverified | CLAUDE.md: "unverified — no benchmark exists for this claim" |
| MCP response target | ⚠️ Unmeasured | <100ms target set but no CI gate |
| Framework throughput | ⚠️ Unbenchmarked | No public rps/latency numbers |

## Competitor Comparison

| Framework | Throughput (rps) | P95 Latency (ms) | Failure Rate | Test-Time Scaling | Agents/MW |
|-----------|:----------------:|:----------------:|:------------:|:-----------------:|:---------:|
| **Ruflo** | Unbenchmarked | Unbenchmarked | Unknown | None | Not registered |
| LangGraph | 2.70 (B) | 16,891 (B) | 0% | None | Not registered |
| AutoGen/AG2 | ~2.0 (C) | ~15,000 (C) | Low | Self-refine (B) | Not registered |
| CrewAI | Excluded (B) | — | 44% (B) | None | Not registered |
| OpenAI Swarm | Lowest latency (C) | — | Low (C) | None | Not registered |
| AutoAgents-Rust | 4.97 (B) | 9,652 (B) | 0% | None | Not registered |

*(B = vendor/dev benchmark 2026; C = single source)*

## Benchmarks

| Benchmark | Key Number | Grade | Reference |
|-----------|-----------|-------|----------|
| AA-AgentPerf GB300 | 61,354 Agents/MW | **A** | Artificial Analysis Jun 2026 |
| AA-AgentPerf H200 | 2,594 Agents/MW | **A** | Artificial Analysis Jun 2026 |
| Mixture-of-agents MMLU-Pro | +7.1% over CoT @ 20× budget | **A** | arXiv 2605.01566, ACL 2026 |
| RecursiveMAS speedup | 1.2–2.4× end-to-end | **B** | arXiv 2604.25917 |
| AutoAgents-Rust vs LangGraph | +84% throughput | **B** | dev.to Feb 2026 |

## SOTA Proof & Witness

**Session commit:** `26c35b59b40a0a95b286ccf5ac675a15edcc995f`
**Report SHA-256:** `8f7e3d612e5d165f64a2beb23bc314153dc016e1ee479185d63107294c9cd9e5`
**Witness stamp:** `e88eb2c46dc489827e399c0a0309590f04e635884ed183d84cac9436106cad45`

Verifier: `sha256sum report.md` → strip newline → concat session commit → `sha256sum` → must equal Witness stamp.

## Recommended Next Steps

1. **Register Ruflo in AA-AgentPerf** (ADR-320): Add `performance benchmark --suite agentperf` subcommand that replays agentic trajectories and reports Agents/MW metric. Target ≥5,000 Agents/MW on standard dev hardware as a CI gate. This closes the single largest credibility gap vs verifiable external benchmarks.

2. **Implement mixture-of-agents routing** in 3-tier model config (ADR-026): When `estimatedParallelAgents > estimatedSequentialAggregations`, activate mixture-of-agents path. ACL 2026 Grade A evidence shows +2.7pp over self-consistency at equal compute cost. The hook point is `hooks route` → tier selection.

3. **Benchmark and gate Flash Attention in CI**: Run `performance benchmark --suite flash-attention` in each PR that touches the attention layer. Ship a Grade A number or remove the unverified claim from CLAUDE.md. Ongoing unverified claim degrades trust in the performance section.
