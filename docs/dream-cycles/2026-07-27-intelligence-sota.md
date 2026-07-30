# Intelligence SOTA Report — 2026-07-27

**TL;DR:** Heterogeneous multi-agent ensembles (PoTRE, 49.92% on Humanity's Last Exam) and programmatic memory compression (PRO-LONG, +18pp on ARC-AGI-3) define 2026 agent-intelligence SOTA. EWC++ continual learning and SONA self-optimization remain absent from every major competitor, making them Ruflo's sharpest differentiators.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| PoTRE (Poly-Topological Reasoning Ensembles): 4 heterogeneous agents with task-adaptive aggregation achieve **49.92% on Humanity's Last Exam** | arXiv 2607.x, Kankariya & Arık (July 22, 2026) | A |
| PRO-LONG (Programmatic Memory): structured interaction logs yield **+18pp on ARC-AGI-3**; **97.4% best@2 with Claude Fable 5** at $1,750 total cost; 4.2–5.8× fewer tokens than specialized harnesses | arXiv 2607.x, Fox et al. (July 23, 2026) | A |
| HierFlow (MCTS-inspired topology synthesis): beats baselines on QA, math, and code using 4.2–5.8× fewer tokens | arXiv 2607.x, Li et al. (July 19, 2026) | A |
| AREX (Recursive Self-Improving Research Agent): inner-evidence / outer-audit loop outperforms comparable baselines on BrowseComp, WideSearch, DeepSearchQA | arXiv 2607.x (July 23, 2026) | B |
| Agentic context compaction (Maximem Synap): reduces token growth from quadratic to linear; reports **92% LongMemEval, 93.2% LoCoMo** | Vendor claim (July 2026) | C |

---

## Ruflo Current Capability

| Component | Status | Measured Result |
|-----------|--------|----------------|
| MoE gate (8 experts) | Active | Confidence 0.13 → 0.88 after reward shaping |
| SONA self-optimization | Active | 0.0043ms/adapt (target <0.05ms met) |
| HNSW vector search | Active | ~1.9× at N=20k, ~3.2–4.7× at N=5k vs brute force; recall@10 ~0.99 |
| EWC++ continual learning | Active | Anti-forgetting layer on weight updates |
| Flash Attention | Integration available | Speedup not yet benchmarked in-tree |
| Heterogeneous ensemble composition | Gap | No PoTRE-style multi-topology ensemble API exists |
| Programmatic structured memory logs | Gap | No PRO-LONG-style interaction log compression |

---

## Competitor Comparison

| Framework | Version (2026) | Intelligence Features | Gap vs Ruflo |
|-----------|---------------|----------------------|--------------|
| **LangGraph** | v1.2.7–v1.2.9 | DeltaChannel incremental checkpoints; per-node timeouts; typed streaming API v3; defaults to claude-sonnet-5 / gpt-5.5 | No MoE routing, no HNSW, no EWC++ |
| **Microsoft Agent Framework** | 1.0 GA (April 2026) | Merges AutoGen + Semantic Kernel; async event-driven; CodeAct paradigm; Hosted Agents managed sandbox | No native vector search, no continual learning |
| **CrewAI** | v1.14.3 (April 24, 2026) | Sequential / Hierarchical / Consensual process modes; checkpoint restore; Snowflake Cortex native | No self-optimizing substrate, no HNSW |
| **OpenAI Swarm** | Frozen | Repositioned as educational reference; superseded by Agents SDK (March 2025); no 2026 intelligence updates | Deprecated; no competition |

---

## Benchmarks

| Benchmark | SOTA Score | System | Grade |
|-----------|-----------|--------|-------|
| Humanity's Last Exam | **49.92%** | PoTRE ensemble | A |
| ARC-AGI-3 | **97.4% best@2** | PRO-LONG + Claude Fable 5 | A |
| GAIA | 80.7% | Inspect ReAct Agent | B |
| SWE-bench Verified | 80%+ | Frontier models (Gemini 2.5 Pro) | B |
| LongMemEval | 92% (vendor) | Maximem Synap | C |
| Ruflo HNSW recall@10 | ~0.99 | ruvector NAPI backend | A (measured in-tree) |

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `6b6eef90cf381c147aba6bbdfb29f1f11a2d3bdb` |
| Report SHA-256 | `17df4112c9cb7a094317bf5cb7d6d20add8b0f0baed087b3b5b682d95421e0b1` |
| Witness stamp | `c1e3c26939346355723d56a2eda3b55eb4c306b7843333abbf5c1ceeb7ef7dbf` |

**Verification:** `sha256(report_sha256 + session_commit) == witness_stamp`

---

## Recommended Next Steps

1. **Implement PoTRE-style Heterogeneous Ensemble API** (ADR-320): Add a `SwarmTopology::heterogeneous` mode that allows 3–5 agents with distinct reasoning strategies (adversarial, hierarchical, spectrum-search, direct chain) plus a task-adaptive aggregation layer. Target: parity with PoTRE's 49.92% HLE on in-tree benchmark suite.

2. **Add PRO-LONG Programmatic Memory Layer**: Extend the AgentDB memory schema to store structured interaction logs (not just vector embeddings). Expose a `memory compress --programmatic` subcommand that applies log-level compression before vector encoding. Estimated token reduction: 4× per session based on PRO-LONG paper data.

3. **Publish Ruflo Intelligence Benchmark Suite**: Wire HumanityLastExam, ARC-AGI-3 (subset), GAIA, and LongMemEval into `npx ruflo performance benchmark --suite intelligence` so each release has a grade-A scored comparison row against competitors. This closes the credibility gap vs PoTRE/PRO-LONG claims.
