# ADR-345 — Swarm Credit Routing via Shapley-Value Attribution

**Status**: Proposed
**Date**: 2026-06-14
**Authors**: claude (dream-cycle agent, 2026-06-14)
**Issue**: [ruvnet/ruflo#TBD](https://github.com/ruvnet/ruflo/issues/) (filed tonight)
**Related**: ADR-026 (3-Tier Model Routing), ADR-143 (Tier-1 Codemods), ADR-153 (RuVector Integration)

## Context

SHARP (arXiv:2602.08335, revised Jun 2 2026) demonstrates that Shapley-value marginal-contribution
scoring improves multi-agent task matching by **+23.66% over single-agent** and **+14.05% over
standard multi-agent** baselines on real-world benchmarks. The Shapley-value decomposes the group
reward into each agent's marginal contribution across coalition subsets, providing a principled
credit signal for routing and selection.

Ruflo v3.6.10's hierarchical coordinator routes tasks by `agentType` + availability only. There is
no per-agent credit history, no marginal-contribution tracking, and no feedback loop between task
outcomes and future routing decisions. This is consistent with the stopping-decision gap identified
in ADR context (arXiv:2605.02801, #2332) — Ruflo lacks RL feedback at every orchestration layer.

SwarmHarness (arXiv:2605.28764, May 2026) independently converged on Shapley-value approximation
for decentralized compute reward distribution, suggesting the approach is framework-agnostic and
broadly applicable.

## Decision

Add per-agent Shapley credit scoring to the swarm task router in `@claude-flow/memory` and
`@claude-flow/cli`:

1. **Credit store**: Each agent instance accumulates a `credit_score` per `(task_type, agent_type)`
   pair in AgentDB namespace `swarm-credit`. Updated post-task via the existing `post-task` hook.

2. **Approximate Shapley**: Use the permutation-sampling approximation (k=16 samples) rather than
   exact computation — O(k) vs O(2^n). Store the running mean and variance for each agent.

3. **Weighted routing**: The hierarchical coordinator scores candidates as:
   `route_score = credit_score * availability_weight * (1 - current_load)`
   Highest score wins. Fall back to role-only routing when `credit_score` is undefined (new agent,
   first task of this type).

4. **Decay**: Apply exponential decay (λ=0.95 per session) so stale credit from prior sessions
   does not dominate. Implement as lazy update on read.

5. **Opt-in flag**: Gate behind `CLAUDE_FLOW_CREDIT_ROUTING=true` env var until benchmarked at
   ≥ 50 task cycles in the Ruflo test suite. Default off for stable release.

## Consequences

**Positive:**
- Closes the credit-attribution gap vs SHARP (+23.66% opportunity)
- Enables agent specialization to emerge over time without explicit labeling
- Small storage overhead: one float64 pair per `(task_type, agent_type)` cell in AgentDB
- Reuses existing `post-task` hook — minimal new surface area

**Negative:**
- First N tasks per agent type produce noisy credit estimates (cold-start)
- k=16 permutation samples introduce variance; exact Shapley only tractable for n≤8 agents
- Decay parameter λ=0.95 is a hyperparameter requiring tuning; wrong value causes credit amnesia
  or stale-lock

**Neutral:**
- Does not change the routing contract — agents still receive the same task spec
- Credit store is advisory; correctness does not depend on it

## Implementation Plan

| Step | File | LOC |
|------|------|-----|
| 1 | `v3/@claude-flow/memory/src/credit-store.ts` | ~100 |
| 2 | `v3/@claude-flow/cli/src/orchestration/credit-router.ts` | ~120 |
| 3 | `v3/@claude-flow/hooks/src/workers/post-task-credit.ts` | ~40 |
| 4 | Tests: `tests/orchestration/credit-router.test.ts` | ~80 |

Total estimated: ~340 LOC. Flag: `CLAUDE_FLOW_CREDIT_ROUTING`.
Gate: benchmark at ≥50 cycles before default-on in a future MINOR release.
