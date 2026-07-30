# Performance SOTA Report — 2026-05-30

**TL;DR:** Five Grade A 2026 papers converge on the same gap in Ruflo: critical-path-aware scheduling cuts multi-agent wall-clock latency 38–46% (LAMaS), MV-HNSW achieves 14× memory-search speedup vs Ruflo's current ~1.9×, and structured memory distillation compresses agent context 11× — none yet implemented.

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| LAMaS critical-path DAG scheduling reduces multi-agent wall-clock latency 38–46% | arXiv:2601.10560, Jan 2026 | A |
| MV-HNSW (multi-vector graph index) achieves 14× search-latency reduction vs prior methods at >90% recall across 7 datasets | arXiv:2604.02815, PVLDB 17(12) 2026 | A |
| Structured distillation compresses agent memory 11× (371→38 tokens/exchange) with retrieval MRR 0.759 vs 0.745 raw | arXiv:2603.13017, Mar 2026 | A |
| Hera step-level RL routing achieves 92.5% cloud-only accuracy at 46.3% cloud invocations (54% local offload) | arXiv:2605.24598, May 2026 | A |
| SSD/Saguaro (ICLR 2026) reaches 5× faster-than-autoregressive throughput via parallelised draft+verify stages | arXiv:2603.03251, ICLR 2026 | A |

## Ruflo Current Capability

| Area | Status | Gap |
|------|--------|-----|
| HNSW vector search | ✓ ~1.9× at N=20k (measured) | MV-HNSW achieves 14× — 7× improvement available |
| 3-tier routing (ADR-026) | ✓ Deterministic by complexity class | No step-level RL routing; 54% cloud offload opportunity untapped |
| SONA adaptation | ✓ 0.0043ms/adapt (measured, ahead of all published comparators) | No step-state conditioning in routing decisions |
| Agent memory storage | AgentDB SQLite + HNSW | No structured distillation; full raw token cost per context window |
| MCP tool execution | Sequential default | No critical-path DAG scheduler — full serial penalty on parallel-capable tasks |
| Agent pipeline latency | Not benchmarked | No published TTFT-to-response metric at any agent count |

## Competitor Comparison

Source: Pooya Golchian independent benchmark, 200 tasks/tier, Qwen3-32B, Apr 2026. **Grade B** (single tester, consistent with multi-source review).

| Framework | Simple Task | Medium Task | Complex Task | Token Overhead | Key 2026 Highlight |
|-----------|------------|------------|-------------|---------------|-------------------|
| **Ruflo v3.6** | Not benchmarked | Not benchmarked | Not benchmarked | Not published | 3-tier routing (ADR-026), SONA 0.0043ms |
| **LangGraph v1.0 GA** | 88% | 76% | 62% | ~5% | DeltaChannel beta (incremental checkpoint diff); ~1.2s avg on 10-step GPT-4o pipelines |
| **AutoGen v0.4 / Magentic-One** | 79% | 68% | 58% | ~5–6× vs LangGraph on reasoning | Modular agentchat rewrite; better p99 latency on managed deploy |
| **CrewAI** | 79% | 71% | 54% | ~18% vs LangGraph | 100K+ devs; 31,200 GitHub stars; fastest prototyping |
| **OpenAI Swarm** | N/A | N/A | N/A | Near-zero (thin wrapper) | Reference implementation only; no state management; no published perf benchmarks |

## Benchmarks

| Benchmark | Value | Grade | Source |
|-----------|-------|-------|--------|
| LAMaS: critical path length reduction | 38–46% | A | arXiv:2601.10560 |
| MV-HNSW: search-latency reduction at >90% recall (7 datasets) | 14× | A | arXiv:2604.02815, PVLDB 2026 |
| Structured memory distillation: token compression | 11× (371→38 tok/exchange) | A | arXiv:2603.13017 |
| Hera step-level routing: cloud invocation reduction | 54% offload at 92.5% accuracy | A | arXiv:2605.24598 |
| SSD/Saguaro: throughput vs autoregressive | 5× | A | arXiv:2603.03251, ICLR 2026 |
| OpenRouter vs OpenAI direct TTFT | 70ms faster (0.640s vs 0.712s) | B | opper.ai LLM Router Benchmark 2026 |

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| **Session commit** | e6dc21fc79539af029c4f5e87d2b929ebb794291 |
| **Report SHA-256** | a08b0a9b60c7cf0fe6a8162a17a4379c9891a6e416c89ab9d90eb0ee389b6fc0 |
| **Witness stamp** | f412ad86592f290e0f38f59c26b08e2a26ba67683b95dc2c7770491b5f96b63b |
| **Verifier** | sha256 gist-pre-witness → concat session commit `e6dc21fc79539af029c4f5e87d2b929ebb794291` → sha256 → must equal witness stamp |

## Recommended Next Steps

1. **ADR-144: Upgrade to MV-HNSW for agent memory retrieval** — Current ~1.9× at N=20k vs 14× achievable. Target: `v3/@claude-flow/memory/src/hnsw/`. Evaluate at N=20k–100k, targeting 90% recall threshold. (arXiv:2604.02815, PVLDB 2026)

2. **Implement structured memory distillation** — 11× token compression using four-field schema (core/detail/labels/paths). Retrieval MRR 0.759 vs 0.745 raw. Implementation-level — no ADR needed. (arXiv:2603.13017)

3. **Add step-level routing to 3-tier model router** — 40–50% Haiku offload at near-Sonnet accuracy via RL-trained binary classifier. Target: `v3/@claude-flow/cli/src/routing/model-router.ts`. (arXiv:2605.24598)
