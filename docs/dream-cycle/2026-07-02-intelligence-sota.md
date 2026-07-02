# Intelligence SOTA Report — 2026-07-02

**TL;DR:** Topology-aware skill self-evolution (SkillCAT, +40% on SpreadsheetBench/DocVQA) and dimension-aware heterogeneous routing (HyDRA, 75.4% SWE-Bench vs 74.2% single-model at –12.9% cost) represent 2026's most actionable intelligence advances for Ruflo — neither is implemented today.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| **SkillCAT**: 3-stage training-free skill self-evolution (contrastive causal extraction + topology-aware task execution) achieves +40.40% avg over baselines on SpreadsheetBench, WikiTableQuestions, DocVQA | arXiv:2606.13317 (Jun 2026) | A |
| **HyDRA**: dimension-aware routing over heterogeneous LLM pool achieves 75.4% SWE-Bench Verified vs 74.2% Claude Sonnet 4.6 baseline at 12.9% cost savings; 86 ms CPU latency | arXiv:2605.17106 (May 2026) | A |
| **DMoA**: differentiable MoA with per-step dynamic agent activation, SOTA on 9 benchmarks, sparse activation without fixed communication topology | arXiv:2605.15706 (May 2026) | B (no specific numbers published) |
| **MAS-as-MoE**: three observable influence proxies (self-confidence, peer-confidence, initial alignment) determine which agent becomes "influencer" in deliberation | arXiv:2605.25929, ICML 2026 Workshop | B |
| **SkillComposer**: 3-op skill evolution (create/improve/merge) gives +4.5 pts on τ²-Bench, +3.4 pts on LiveCodeBench v6 with 4B composer driving a 27B executor | arXiv:2606.06079 (Jun 2026) | B |
| Agent benchmark integrity crisis: Berkeley RDI exploited 8 major benchmarks (SWE-bench, WebArena, GAIA, OSWorld…) to near-perfect scores without solving tasks | arXiv:2605.23950 (May 2026) | A |

---

## Ruflo Current Capability

| Component | Current State | Gap |
|-----------|--------------|-----|
| MoE routing | Static 8-expert gate, task-level routing only | No dimension-aware capability routing; no per-step dynamic activation |
| Skill caching | None — agents re-derive skills from scratch each session | No topology-aware skill hierarchy; 40% performance left on table |
| SONA adaptation | 0.0043 ms/adapt, self-optimizing | No contrastive causal comparison of success vs failure trajectories |
| Intelligence router | Binary model-tier selector (Haiku/Sonnet/Opus by complexity %) | No 4-dim capability scoring (reasoning/code/debug/tool-use) |
| Agent influence | No influence-weighting in hive-mind deliberation | No FJ-model peer confidence propagation |
| Memory distillation | EWC++ prevents forgetting, no episodic→semantic distillation | RecMem-style recurrence not implemented |

---

## Competitor Comparison

| Framework | Intelligence Router | Skill Self-Evolution | MoE / Dynamic Routing | Benchmark Highlight |
|-----------|--------------------|--------------------|----------------------|---------------------|
| **Ruflo v3.6** | Haiku/Sonnet/Opus by complexity % | None | Static 8-expert gate | — |
| **LangGraph 0.4** | None built-in; user-defined conditional edges | None built-in | None | PostgresSaver checkpointing; audit trails |
| **AutoGen 1.0 GA** | None; model per-agent fixed at spawn | None | None | Event-driven v2 arch; in maintenance mode |
| **CrewAI 0.105** | None; model fixed per crew | None | None | Async crew runner; improved Anthropic tool routing |
| **OpenAI Swarm / Agents SDK** | None routing layer | None | None | Computer use: 38.1% OSWorld (Grade A) |

---

## Benchmarks

| Benchmark | Metric | Best 2026 Result | Source | Grade |
|-----------|--------|-----------------|--------|-------|
| SWE-Bench Verified | Resolution rate | HyDRA: 75.4% (vs Claude Sonnet 4.6 74.2%) | arXiv:2605.17106 | A |
| SpreadsheetBench / WikiTableQuestions / DocVQA | Avg score vs baseline | SkillCAT: +40.40% | arXiv:2606.13317 | A |
| τ²-Bench | Agent task score | SkillComposer: +4.5 pts (4B→27B) | arXiv:2606.06079 | B |
| OSWorld (computer use) | Task completion | Claude Opus 4.6: 60.7%; OpenAI: 38.1% | coasty.ai survey | B |
| 9 agentic benchmarks | SOTA (DMoA) | Claimed SOTA, no specific numbers in abstract | arXiv:2605.15706 | C (single source, numbers not published) |

---

## SOTA Proof & Witness

Computed after content was finalized.

**Session commit:** `4eb807aa7cfc184724e2e745611980f744e0600e`

**Report SHA-256:** `61d7a487f9a10b910239b6b5be862dcd79dccf07249460e08ad549b2ed9917da`

**Witness stamp:** `c93167d82719ade3a8d23e26c576010efb3b9936bc34452d9d3781491b7d0450`

**Verifier:** `sha256("61d7a487f9a10b910239b6b5be862dcd79dccf07249460e08ad549b2ed9917da" + "4eb807aa7cfc184724e2e745611980f744e0600e")` must equal `c93167d82719ade3a8d23e26c576010efb3b9936bc34452d9d3781491b7d0450`.

---

## Recommended Next Steps

1. **Implement dimension-aware intelligence routing** (HyDRA pattern): replace the current Haiku/Sonnet/Opus complexity-% gate in `v3/@claude-flow/cli/src/` with a 4-dimension capability scorer (reasoning, code, debug, tool-use) backed by a lightweight ModernBERT-class classifier — Grade A evidence shows 75.4% SWE-Bench at –12.9% cost vs single-model baseline. ADR-167 proposed.

2. **Add topology-aware skill caching to SONA** (SkillCAT pattern): after each agent run, extract contrastive success/failure trajectories and slot skills into a 3-tier hierarchy (domain → task-type → instance) stored in AgentDB's HNSW index. Grade A evidence shows +40.40% on common agent benchmarks with zero training cost.

3. **Add FJ-model influence weighting to hive-mind deliberation**: wire peer-confidence and self-assessed confidence into the raft/quorum consensus round so that the most competent agent on the current task type carries proportionally higher vote weight. Grade B (ICML 2026 Workshop); implement as opt-in flag pending further reproducibility.
