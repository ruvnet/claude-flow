# Performance SOTA Report — 2026-07-20

**TL;DR:** World-model agent planners achieve 14× training speedup + 3–6× inference speedup in 2026 (Grade A), while the Ruflo Flash Attention claim remains unverified and framework throughput is unmeasured vs competitors delivering 84% more rps.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| DSWorld world-model: 14× RL agent training speedup, 3–6× search inference speedup by simulating tool outcomes | arXiv:2607.15901 (ICRA-style 2026 preprint) | **A** |
| AutoAgents-Rust: 4.97 rps vs LangGraph Python 2.70 rps — 84% throughput gain from static-typed Rust orchestration | dev.to/saivishwak (2026 benchmark, cross-checked with n1n.ai report) | **B** |
| Framework choice moves agent benchmark performance by up to 30 percentage points on identical models | tensoria.fr/en/blog (2026, qualitative) | **C** |
| SEED self-evolving distillation: dense token-level supervision from hindsight skills improves performance + sample efficiency on agentic tasks | arXiv:2607.14777 (2026 preprint) | **A** |
| LangGraph P95 latency: 16,891 ms; orchestration adds ~50–100 ms over raw LLM calls (5.7–7 s) | mcp-server-langgraph.mintlify.app benchmarks + aerospike.com | **B** |
| VideoTreeSearch (VTS): self-correcting hierarchical search +12.5 mIoU via explicit backtracking over prior agentic baselines | arXiv:2607.16189 (2026) | **A** |
| CrewAI carries 3× token overhead of LangGraph on simple workflows | topuzas.medium.com / dev.to (2026 showdown) | **C** |

---

## Ruflo Current Capability

| Area | Ruflo State |
|------|-------------|
| Flash Attention speedup | 2.49×–7.47× claimed — **explicitly unverified** in CLAUDE.md; no benchmark exists |
| MCP response target | <100 ms — **target, not measured** |
| CLI startup target | <500 ms — **target, not measured** |
| Framework throughput | Not benchmarked vs LangGraph / AutoGen / CrewAI |
| Agent task planning | Reactive execution only — no world-model pre-simulation |
| Token efficiency | 3-tier routing (ADR-026/ADR-143) but savings vs competitors unmeasured |
| HNSW search | Measured ~1.9× at N=20k, ~3.2×–4.7× at N=5k — **verified** |

---

## Competitor Comparison

| Framework | Throughput (rps) | P95 Latency | Token Overhead | World-Model Planning |
|-----------|-----------------|-------------|----------------|---------------------|
| **Ruflo** | Not benchmarked | Not benchmarked | 3-tier routing (B) | None |
| **LangGraph** | 2.70 rps (B) | 16,891 ms (B) | Baseline | None |
| **AutoAgents (Rust)** | 4.97 rps (B) | Not reported | Lower than LangGraph (C) | None |
| **AutoGen** | Slowest of four (C) | Not reported | High consensus overhead (C) | None |
| **CrewAI** | Not reported | Not reported | 3× vs LangGraph (C) | None |
| **OpenAI Swarm** | Lowest latency (C) | Not reported | Lowest overhead (C) | None |

*All competitor figures are 2026 third-party benchmarks. "C" = single source, unconfirmed.*

---

## Benchmarks

| Benchmark | Value | Grade | Source |
|-----------|-------|-------|--------|
| DSWorld 14× RL training speedup | Measured on 8,000-scale transition trajectory dataset vs LLM baseline (+35.6% transition prediction) | **A** | arXiv:2607.15901 |
| DSWorld 3–6× search inference speedup | Same paper, search-based inference path | **A** | arXiv:2607.15901 |
| AutoAgents-Rust 4.97 vs LangGraph 2.70 rps | Cross-checked dev.to + n1n.ai 2026 reports | **B** | dev.to/saivishwak |
| LangGraph orchestration overhead | ~50–100 ms for complex workflows | **B** | mcp-server-langgraph.mintlify.app |
| Ruflo Flash Attention | **No 2026 benchmark data available** — claim must be labeled unverified until measured | — | CLAUDE.md audit |

---

## SOTA Proof & Witness

**Session commit:** `12ede21767a6dd669df1b79392a5d27d9154f237`  
**Report SHA-256:** `0faf7a674d8a74ad9e7c309b8b9e0e8db9ca683cb5bfc752f2d8fd0b3899713f`  
**Witness stamp:** `761ca053e5b55bdbf5205e7da61c61bdb8758d8659596f461b341346746d5d1c`

*Verifier: `sha256sum /path/to/dream-gist-2026-07-20.md` → concat with session commit → `sha256sum` → must equal Witness stamp.*

---

## Recommended Next Steps

1. **Implement a lightweight world-model planner for Ruflo agents** (ADR-322): before executing expensive multi-step tool chains, agents simulate outcomes using a cost-aware routing + transition predictor (DSWorld pattern). Target: 3–6× reduction in wasted real-tool calls during planning. Scope: new `@claude-flow/planning` module; `hooks pre-task` triggers planner when task has ≥3 estimated tool calls.

2. **Run a Ruflo throughput benchmark vs LangGraph** (one sprint): instrument `claude-flow start` with `autocannon` or `wrk` targeting the MCP stdio/HTTP layer; publish results. Current unverified Flash Attention and <100 ms MCP claims become Grade A or are retracted. Without this, marketing claims are Grade C.

3. **Compress SendMessage payload with token budget enforcement** (security × performance overlap): each `SendMessage` call should enforce a configurable token budget (default 512 tokens) and optionally apply a lightweight compression pass (TF-IDF keyword extraction). Addresses OWASP ASI07 (inter-agent channel) and reduces orchestration overhead on busy swarms.
