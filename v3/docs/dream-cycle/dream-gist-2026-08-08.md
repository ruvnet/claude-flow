# Memory SOTA Report — 2026-08-08

**TL;DR:** ScrubJay's type-conditioned temporal decay (arXiv:2608.04746) beats Mem0 by +2.66 F1 on MemoryAgentBench and is the *only* retrieval system with positive Temporal Generalization Gap (+0.108) — a gap that collapses 5.7× without decay. Ruflo AgentDB stores all memories with no perishability model: stale patterns persist indefinitely, degrading temporal reasoning in long-horizon agents.

---

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| ScrubJay type-conditioned temporal decay achieves +2.66 F1 over Mem0 on MemoryAgentBench EventQA-64k; +0.108 GenGap (only positive retrieval-based result); decay ablation collapses GenGap 5.7× | arXiv:2608.04746 (Aug 5 2026, benchmark reproduced) | **A** |
| Mem0 April 2026 algorithm: 94.4% LongMemEval, 92.5% LoCoMo, +29.6pp temporal reasoning, +23.1pp multi-hop reasoning, 73.5% token reduction vs 2025 baseline (26k→6.9k tokens/query) | mem0.ai State of AI Agent Memory 2026 (public reproducible) | **A** |
| MemoryCPT (arXiv:2608.04843): end-to-end Cost-Performance Trade-off framework using GRPO optimization + Quality-per-Cost (QPC) metric; evaluated on LoCoMo + LongMemEval | arXiv:2608.04843 (Aug 5 2026) | **B** (abstract only, no public numbers) |
| HiGram (arXiv:2608.05095): hierarchical coarse-to-fine graph memory with MicroGraph-based localization; improvements on conflict-aware and long-term QA benchmarks | arXiv:2608.05095 (Aug 5 2026) | **B** (abstract only) |
| SafeCommit (arXiv:2608.04289): conformal action certificates for memory-grounded agents; permits actions only when certified safe across retained world models | arXiv:2608.04289 (Aug 4 2026) | **B** (paper, NeurIPS submission) |
| LongMemEval (500q), LoCoMo (1,540q), and BEAM (1M–10M token scale) are now the three de facto 2026 agent memory benchmarks | mem0.ai 2026 | **A** |
| Temporal Generalization Test (TGT) introduced as evaluation framework with GenGap metric; ScrubJay is only retrieval system with positive GenGap | arXiv:2608.04746 | **A** |

---

## Ruflo Current Capability

| Capability | Status | Gap |
|---|---|---|
| Vector search | HNSW (measured ~1.9x at N=20k, ~3.2x–4.7x at N=5k vs brute force) | No temporal scoring; semantically similar but stale memories rank equally to fresh |
| Memory schema | Flat entries: content + embedding + timestamp | No perishability (πᵢ) or utility horizon (τᵢ) fields |
| Retrieval fusion | HNSW only | No BM25, entity linking, or temporal decay fusion |
| ReasoningBank patterns | Persist indefinitely | No TTL or type-conditioned decay; stale tool-call patterns accumulate |
| Memory benchmarks | Not measured | No LongMemEval, LoCoMo, or TGT score published |
| Cost-per-retrieval | Not tracked | No QPC metric; no cost-aware retrieval optimization |
| Safety certification | None | No conformal action certificate before executing memory-grounded actions |

---

## Competitor Comparison

| Framework | Memory Architecture (2026) | Temporal Decay | Benchmark (LongMemEval) | Token/Query |
|---|---|---|---|---|
| **Mem0 (April 2026)** | Multi-signal: semantic + BM25 + entity linking | Implicit via update rules | **94.4%** | ~6,900 |
| **LangGraph 0.4** | Graph state + checkpointers (SQLite/Postgres); time-travel | None | Not published | N/A |
| **CrewAI 0.105** | Per-agent short-term + shared crew memory; abstract backends | None | Not published | N/A |
| **AutoGen (2026)** | Custom memory stores; pluggable; no built-in temporal layer | None | Not published | N/A |
| **OpenAI Agents SDK** | Thread history + Responses API; no external memory module | None | Not published | N/A |
| **Ruflo AgentDB** | HNSW vector index (sql.js); flat schema | **None** | **Not published** | **Not tracked** |

**Competitive position:** Mem0 is the only production system with a published grade-A LongMemEval score (94.4%). All major agent frameworks lack temporal decay. ScrubJay's academic result (+2.66 F1, +0.108 GenGap) establishes an implementation window before any framework ships it.

---

## Benchmarks

| Benchmark | Claim | Source | Grade |
|---|---|---|---|
| ScrubJay +2.66 F1 over Mem0 on MemoryAgentBench EventQA-64k | 2026 reproducible evaluation with held-out TGT | arXiv:2608.04746 | **A** |
| ScrubJay +0.108 GenGap (TGT); decay ablation collapses 5.7× | Same paper; ablation table | arXiv:2608.04746 | **A** |
| Mem0 April 2026: LongMemEval 94.4%, LoCoMo 92.5%, BEAM-1M 64.1% | Public blog with reproducible config | mem0.ai Apr 2026 | **A** |
| Mem0 temporal reasoning +29.6pp vs 2025 algorithm | Same source; delta vs published 2025 baseline | mem0.ai Apr 2026 | **A** |
| MemoryCPT QPC metric on LoCoMo + LongMemEval | Abstract claim, no public table | arXiv:2608.04843 | **B** |

---

## SOTA Proof & Witness

**Session commit:** `913f9eaedee92627950544424e50339feaf98271`

**Report SHA-256:** `304341b6cd8f29897c476235ffbe747ab594f1e5b1b7686f718e7d67e2fd082a`

**Witness stamp:** `3dd828d02183b6f8067ea161dc3ce69310095bd92fafc33d73c9eacc16e17b27`

*Verifier: fetch raw gist, sha256sum the file (replace SHA-256 and Witness fields with `[COMPUTING]`), concat result with session commit, sha256sum → must equal witness stamp.*

---

## Recommended Next Steps

1. **Implement perishability schema in AgentDB** (ADR-381): Add `perishability` (float 0–1) and `utility_horizon` (duration seconds) fields to every memory entry. Default `perishability=0.3` (medium decay) for `patterns` namespace, `0.1` for `tasks` (slow decay), `0.8` for `auto-memory` (fast decay). Retrieval scoring: `score = semantic_similarity × e^(-perishability × age_days)`. Target: positive GenGap on TGT; measurement gate before promoting to default retrieval path.

2. **Publish Ruflo LongMemEval baseline**: Run `@claude-flow/memory` against the LongMemEval 500-question evaluation using current HNSW-only retrieval. Publish as a benchmark entry in `scripts/benchmark-intelligence.mjs`. Provides the gap number needed to track ADR-381 progress.

3. **Add plugin security scanning gate** (scan finding): Implement `npx ruflo security scan --depth plugins` that checks installed plugins against YARA patterns from the MCP Security Audit 2026 ruleset. Snyk ToxicSkills found 36% flaw rate in Feb 2026 across 3,984 plugins — Ruflo's 20 IPFS-distributed plugins have no documented scanner. Priority: `@claude-flow/security` module, new `plugin-scan.ts` command.
