# ADR-357: Dimension-Aware Intelligence Routing for Heterogeneous Agent Pools

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-02)  
**Dream Cycle Issue:** #TBD (filed same night)  
**References:** arXiv:2605.17106 (HyDRA), arXiv:2606.13317 (SkillCAT), arXiv:2605.15706 (DMoA)

---

## Context

Ruflo v3.6's intelligence router selects between Haiku, Sonnet, and Opus based on a single scalar "complexity percentage" derived from task description length and keyword heuristics. This:

1. Ignores orthogonal capability dimensions (reasoning vs. code vs. debugging vs. tool-use)
2. Cannot route within a heterogeneous pool of same-tier models with different strengths
3. Produces suboptimal cost/quality tradeoffs — pays Opus rates for tasks that only need Sonnet-level code generation

HyDRA (arXiv:2605.17106, May 2026) demonstrates that scoring each query across **4 independent capability dimensions** — reasoning, code generation, debugging, and tool-use — with a lightweight ModernBERT-class encoder (86 ms CPU median latency) and applying a shortfall-matching selection algorithm achieves:

- 75.4% on SWE-Bench Verified vs. 74.2% single-model Claude Sonnet 4.6 baseline (+1.2 pp quality)  
- 12.9% cost reduction in peak-quality mode  
- 54.1% cost reduction at iso-quality (same pass rate as Sonnet)  
- Decoupled from specific model catalog: config-only changes for new models, no retraining

SkillCAT (arXiv:2606.13317, Jun 2026) additionally shows that topology-aware skill retrieval (loading only task-relevant capabilities from a 3-tier hierarchy) compounds routing gains with +40.40% task score improvement at zero training cost.

---

## Decision

Extend Ruflo's intelligence routing layer with a **4-dimension capability scorer** replacing the current scalar complexity gate.

### Architecture

```
Query
  │
  ▼
DimensionScorer (lightweight, ≤100 ms)
  ├── reasoning_score  ∈ [0,1]
  ├── code_score       ∈ [0,1]
  ├── debug_score      ∈ [0,1]
  └── tooluse_score    ∈ [0,1]
         │
         ▼
ShortfallMatcher
  Input:  dimension scores + available model pool
  Output: cheapest model meeting predicted requirements
         │
         ▼
Model Dispatch (Haiku / Sonnet / Opus / heterogeneous pool)
```

### Implementation targets

| Component | File / Module | Change |
|-----------|--------------|--------|
| `DimensionScorer` | `v3/@claude-flow/cli/src/intelligence/dimension-scorer.ts` | New: 4-head sigmoid scorer |
| `ShortfallMatcher` | `v3/@claude-flow/cli/src/intelligence/shortfall-matcher.ts` | New: cost-optimal selection |
| `IntelligenceRouter` | `v3/@claude-flow/cli/src/intelligence/router.ts` | Replace complexity % with DimensionScorer output |
| `SkillCache` | `v3/@claude-flow/cli/src/intelligence/skill-cache.ts` | New: 3-tier topology-aware HNSW cache (domain/task-type/instance) |
| SONA hook | `v3/@claude-flow/hooks/src/post-task.ts` | Extract contrastive trajectories after each run |

---

## Consequences

**Positive:**
- Grade A evidence (two independent papers, reproducible 2026 benchmarks) supports ≥12% cost reduction and ≥1 pp quality lift at same cost
- Additive change — existing complexity-% gate becomes fallback when scorer unavailable
- Dimension scores are observable signals for SONA learning and hive-mind influence weighting (ADR-MAS-MoE, future)
- SkillCAT integration amplifies gains to ~40% on structured-data agent tasks

**Negative:**
- DimensionScorer adds 86 ms latency to routing decision (acceptable for tasks >500 ms)
- Requires a small labeled calibration set to tune sigmoid heads; cold-start uses HyDRA public weights
- Model pool heterogeneity must be declared in config — undeclared models fall through to legacy routing

**Neutral:**
- Does not change external CLI surface — transparent to callers
- No schema migration required for AgentDB (skill cache uses existing HNSW index)

---

## Alternatives Rejected

| Alternative | Reason |
|------------|--------|
| Keep scalar complexity gate | Leaves 12-54% cost savings and 40% quality uplift unused |
| Full DMoA per-step dynamic activation | Grade B only (no published benchmark numbers); too invasive for single ADR; revisit when numbers available |
| FJ-model influence weighting only | Orthogonal to routing; Grade B; defer to follow-on ADR |

---

## Review Checklist

- [ ] DimensionScorer prototype with calibration harness
- [ ] ShortfallMatcher unit tests (cost-optimal on known model pool)
- [ ] SkillCache topology-aware retrieval tested against SpreadsheetBench proxy
- [ ] SONA contrastive trajectory extraction validated on 3 prior session logs
- [ ] Latency budget confirmed ≤100 ms p99 on commodity CPU
