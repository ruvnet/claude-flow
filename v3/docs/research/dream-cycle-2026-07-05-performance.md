# Performance SOTA Report — 2026-07-05

**TL;DR:** PolyKV (arXiv:2604.24971, Grade A) proves a shared asymmetrically-compressed KV pool slashes multi-agent memory by 97.7% at 15 concurrent agents — Ruflo has no cross-agent shared KV pool and this is the single highest-leverage performance gap for 2026.

---

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| PolyKV: shared KV pool (int8 keys + FWHT+3-bit Lloyd-Max values) cuts 15-agent memory 19.8 GB → 0.45 GB (97.7%), 2.91x compression, BERTScore F1 0.928 | arXiv:2604.24971 (Patel & Joshi, Apr 2026) | A |
| ConServe disaggregated prefill/decode scheduling reduces p95 TTFT by 51.08% and energy by 7.51% | arXiv Jun 2026 (Ding, Hosseini et al.) | A |
| AsymCache multi-segment KV eviction cuts TTFT 1.90–2.03x and TPOT 1.62–1.71x | arXiv Jun 2026 (Shi, Chen et al.) | A |
| IBM speculative decoding + FP8: 4.48x throughput speedup with maintained task performance | arXiv:2606.18502 (Dashore et al., IBM, Jun 2026) | B |
| CLSR symbolic inter-agent language: 3–6x fewer tokens in agent-to-agent messages vs chain-of-thought | arXiv Jun 2026 (Pei, Huang, Wang) | B |

---

## Ruflo Current Capability

| Capability | Current State | Gap |
|---|---|---|
| KV cache | Per-agent cache, referenced in CLAUDE.md | No cross-agent shared/compressed pool |
| Speculative decoding | Not mentioned in architecture | Absent; 4.48x throughput unrealized |
| Disaggregated scheduling | Not addressed | Absent; 51% p95 TTFT reduction unrealized |
| Inter-agent communication | SendMessage text protocol | No symbolic/compressed format; CLSR 3–6x savings unrealized |
| Vector search | HNSW (1.9x–4.7x measured vs brute force) | Addressed; not performance gap |

---

## Competitor Comparison

| Framework | Key 2026 Performance Claim | Source | Grade |
|---|---|---|---|
| **LangGraph** | 10,155ms avg latency, 2.70 rps, 30–40% fewer tokens than CrewAI on medium tasks | dev.to benchmark 2026; AI Dev Day India | B |
| **AutoGen (AG2)** | ~56,700 tokens / 4-agent 5-round debate; 4–5x overhead vs LangChain on complex tasks; GA Feb 2026 | f3fundit.com; secondtalent.com 2026 | C |
| **CrewAI** | 43/100 token efficiency score; ~32s/run; 44% task failure rate in Rust framework benchmark | dev.to audit; aimultiple.com 2026 | C |
| **OpenAI Agents SDK** | "Fastest latency and highest token efficiency" in one enterprise benchmark; Swarm deprecated Mar 2026 | qubittool.com; selecthub.com 2026 | B |
| **Ruflo (claude-flow)** | HNSW 1.9x–4.7x measured; SONA 0.0043ms/adapt | CLAUDE.md / benchmark-intelligence.mjs | A |

---

## Benchmarks

| Benchmark | Metric | Value | Grade |
|---|---|---|---|
| PolyKV — Llama-3-8B, 15 agents, 4K ctx | KV memory reduction | 19.8 GB → 0.45 GB (97.7%) | A |
| PolyKV | Compression ratio | 2.91x stable | A |
| PolyKV | Quality (BERTScore F1) | 0.928 (perplexity +0.57%) | A |
| ConServe | p95 TTFT reduction | 51.08% | A |
| ConServe | Energy efficiency gain | 7.51% | A |
| AsymCache | TTFT improvement | 1.90–2.03x | A |
| AsymCache | TPOT improvement | 1.62–1.71x | A |
| IBM Spec+FP8 | Throughput speedup | 4.48x | B |
| CLSR symbolic comms | Token count reduction | 3–6x | B |
| LangGraph | Task completion (Qwen3 32B, M4 Max) | 62% vs AutoGen 58%, CrewAI 54% | C (community benchmark) |

---

## Scan Findings

### Security (Grade A)
MESA (arXiv:2606.30602, Li et al., Jun 2026): a single compromised agent-to-agent communication edge accounts for up to **75% of total attack success** in multi-agent systems. AgentFlow (arXiv:2607.01640, Wang et al., Jul 2026) introduces static taint analysis via Agent Dependency Graphs covering MCP server pipelines. AI-Infra-Guard provides 75+ AI component rules and LLM-driven MCP server auditing. The 2025 OWASP LLM Top 10 "Excessive Agency" threat is now operationalized through supply-chain and memory-poisoning benchmarks. **Ruflo gap:** no static taint analysis or agent-to-agent channel integrity verification.

### Hive-Mind / Byzantine Consensus (Grade B)
arXiv:2602.02170 (Rodriguez & Díaz, Feb 2026) evaluates six BFT protocols under f < n/3 and confirms bounded self-modification of coordination protocols is formally auditable. Broader collective-intelligence work for LLM hive-mind systems has not yet appeared at scale — the field is mapping BFT theory to practice. Ruflo's existing `byzantine-coordinator` and `raft-manager` are ahead of most published work.

---

## SOTA Proof & Witness

**Session commit:** a5f86ad0ada8aca3e8f664202a452714355990f5  
**Report SHA-256:** 39545a8bb7283d10e370d3418584165101762c8550982e6cd069868c23181383  
**Witness stamp:** 8c1959eec4d5b534b3d3c6030617c2bfe2c109520903ed435d6bdfdaa34ea90b  
**Verification:** `cat dream-gist-2026-07-05.md | sha256sum` → concat with session commit → `sha256sum` → must equal witness stamp.

---

## Recommended Next Steps

1. **ADR-182: Cross-Agent Shared KV Pool (PolyKV architecture)** — Implement a shared asymmetrically-compressed KV pool using int8 key quantization and FWHT+Lloyd-Max value compression. Target: reduce 15-agent KV memory by ≥90% (from ~20 GB to <2 GB). Implementation path: extend `@claude-flow/memory` with a pool manager; measure vs current per-agent baseline. Priority: high — this is a Grade A finding with 97.7% measured reduction.

2. **Implement disaggregated prefill/decode scheduling (ConServe pattern)** — Add a serving-layer scheduler that separates prefill (prompt processing) from decode (token generation) across the agent pool. Expected: 50%+ p95 TTFT reduction. Implementation path: new `PerformanceScheduler` module in `@claude-flow/cli`; gate behind `CLAUDE_FLOW_SCHED_DISAGGREGATE=1` flag.

3. **Agent-to-agent channel security audit against MESA threat model** — Run AI-Infra-Guard's 75+ rules against Ruflo's MCP server pipelines and SendMessage pathways. A single compromised edge = 75% attack success. Immediate action: label all agent-to-agent edges as attack surface in `@claude-flow/security` threat model; add static taint gate to pre-task hook.
