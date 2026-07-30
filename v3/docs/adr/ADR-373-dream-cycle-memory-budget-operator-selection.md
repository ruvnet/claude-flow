# ADR-373: Budget-Dependent Memory Operator Selection (OAS)

**Status:** Proposed
**Date:** 2026-07-23
**Authors:** claude (dream-cycle agent, 2026-07-23)
**Related:** ADR-097 (Federation Budget Circuit Breaker), ADR-088 (LongMemEval Benchmark)

---

## Context

Kang et al. (arXiv 2607.17545, Jul 2026) show that selecting the memory operation — retain (cheap append), consolidate (expensive summarize), or evict (drop oldest) — based on remaining token budget yields **+48% task success under tight-budget conditions** compared to a fixed consolidation policy.

Ruflo's `@claude-flow/memory` module currently runs a background consolidation worker at fixed low priority with no awareness of the caller's remaining token budget. This is a regressive policy: under tight budgets (common in production multi-agent runs) Ruflo triggers the most expensive memory operation (consolidation/summarization) at the worst time.

No existing ADR (085–319) addresses per-call budget-conditional operator dispatch for local memory management.

---

## Decision

Add a `MemoryOperatorSelector` to `@claude-flow/memory` that:

1. **Reads remaining budget** from the cost-tracker hook (`ruflo-cost-tracker` event or env var `CLAUDE_FLOW_BUDGET_REMAINING`) before every memory write operation.
2. **Selects operator** by threshold:
   - `budget > 30%`: `consolidate` — summarize old entries, maintain dense representation
   - `10% < budget ≤ 30%`: `retain` — append only, no summarization
   - `budget ≤ 10%` or budget unknown: `evict` — drop oldest entries beyond watermark, no LLM call
3. **Exposes opt-in flag** `--memory-budget-aware` (CLI) and `memoryBudgetAware: boolean` (API); defaults to `false` until benchmarked in production to avoid regressions.
4. **Records operator choice** in AgentDB metadata for offline analysis and SONA training.

Thresholds are tunable via `claude-flow.config.json → memory.budgetThresholds`.

---

## Implementation Target

| File | Change |
|------|--------|
| `v3/@claude-flow/memory/src/operators/budget-selector.ts` | New: `MemoryOperatorSelector` class |
| `v3/@claude-flow/memory/src/agentdb/writer.ts` | Integrate selector before write path |
| `v3/@claude-flow/cli/src/commands/memory.ts` | Add `--memory-budget-aware` flag |
| `v3/@claude-flow/memory/tests/budget-selector.test.ts` | Unit tests; mock cost-tracker |

---

## Consequences

**Positive:**
- +48% estimated task success under tight budgets (Grade A evidence, Kang et al. 2607.17545)
- Zero-cost evict path eliminates LLM calls when budget is exhausted
- Opt-in default eliminates regression risk

**Negative:**
- Requires cost-tracker integration; adds coupling between memory and billing modules
- Evict-on-low-budget degrades memory quality when agents run long

**Deferred:**
- Multi-hop graph traversal (separate gap, higher implementation cost — needs ADR of its own)
- MINJA input validation (security scope, ADR should be in `@claude-flow/security`)
