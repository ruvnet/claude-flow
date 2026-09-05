# ADR-349 — FLARE-Style Lookahead Planning Buffer for SONA Intelligence Layer

**Status**: Proposed
**Date**: 2026-06-22
**Authors**: claude (dream-cycle agent, 2026-06-22)
**Related**: ADR-017 (RuVector Integration), ADR-009 (Hybrid Memory Backend), ADR-151 (Harness Intelligence Layer)
**Affects**: `@claude-flow/memory`, `@claude-flow/hooks` (SONA optimizer), `claude-flow@3.x+`, `ruflo@3.x+`

---

## Context

Ruflo's SONA (Self-Optimizing Neural Architecture) layer adapts at 0.0043ms/adapt using reactive pattern matching: it observes a decision context, retrieves the nearest pattern via HNSW, and commits to the matching MoE expert gate. This is a greedy, step-wise policy.

FLARE (Future-aware LookAhead with Reward Estimation, arXiv:2601.22311, Jan 2026) identifies a structural failure mode in step-wise LLM agent reasoning: **myopic commitment**. Locally optimal choices at each step cascade into globally suboptimal outcomes over planning horizons ≥3 steps. FLARE addresses this via:

1. Explicit **lookahead simulation** — simulate N future states before committing
2. **Value backpropagation** — propagate reward estimates from simulated futures to the current decision
3. **Limited commitment** — avoid irreversible bindings until lookahead confirms global optimality

Result: LLaMA-8B + FLARE consistently outperforms GPT-4o + standard CoT on long-horizon multi-step planning tasks across multiple benchmarks (paper claim, confidence B — abstract-level; full numerical tables in full PDF).

No agent framework (LangGraph v0.4, CrewAI 0.105, AutoGen 1.0 GA, OpenAI Agents SDK) currently ships explicit lookahead planning as a built-in intelligence primitive. This is an open SOTA opportunity for Ruflo.

**Drift note**: Prior intelligence deep-dive ADR (issue #2401, 2026-06-17) addressed benchmark contamination and RetailBench long-horizon failure at the evaluation layer. ADR-349 addresses the complementary architectural gap at the planning/routing layer.

---

## Decision

Add a **depth-3 lookahead buffer** to SONA before committing to a MoE route selection:

```
Current: observe(ctx) → HNSW retrieve → MoE gate → commit

Proposed: observe(ctx) → HNSW retrieve → [lookahead: simulate 3 steps via MoE oracle]
                                          → backpropagate value estimates
                                          → select globally optimal gate → commit
```

### Implementation Sketch

```typescript
// In @claude-flow/memory / sona-optimizer.ts
interface LookaheadConfig {
  depth: number;       // default 3
  branchFactor: number; // default 2 (top-2 MoE gates considered per step)
  discountFactor: number; // default 0.9
}

async function sonaRouteWithLookahead(
  ctx: AgentContext,
  config: LookaheadConfig = { depth: 3, branchFactor: 2, discountFactor: 0.9 }
): Promise<MoEGateSelection> {
  const candidates = await moeGate.topK(ctx, config.branchFactor);
  const values = await Promise.all(
    candidates.map(c => simulateFuture(ctx, c, config.depth, config.discountFactor))
  );
  return candidates[values.indexOf(Math.max(...values))];
}
```

### What Changes

| Component | Change |
|---|---|
| `sona-optimizer.ts` | Add `routeWithLookahead()` wrapper; keep existing `route()` as fast-path |
| MoE router | Expose `topK(ctx, k)` method returning top-k gate candidates |
| SONA config | Add `lookaheadDepth: number` (default 3); `lookaheadEnabled: boolean` (default false until benchmarked) |
| Hooks post-task | Record lookahead-enabled vs disabled decisions for A/B neural training |

---

## Consequences

**Positive**
- Eliminates myopic commitment failure for agent pipelines ≥3 steps deep
- Compatible with existing EWC++ memory preservation (lookahead uses read-only oracle calls)
- Feature-flaggable: `lookaheadEnabled: false` preserves current 0.0043ms path
- Positions Ruflo ahead of all four main competitors on long-horizon intelligence

**Negative / Risks**
- Added latency: depth-3 lookahead with branchFactor=2 = 2^3−1 = 7 extra oracle calls per route decision (estimate 1–10ms depending on MoE complexity; requires profiling)
- Simulation fidelity: MoE oracle may not accurately simulate real future states without grounded environment feedback
- Premature optimization: benefit only materializes for tasks with actual ≥3 planning steps; most short SONA decisions gain nothing

**Mitigation**
- Default `lookaheadEnabled: false`; enable via config for long-horizon agent types only
- Benchmark lookahead latency vs task-completion gain on LoCoMo + RetailBench equivalents before enabling by default
- Cap `branchFactor=1` for low-budget contexts (greedy lookahead, no branching)

---

## Open Questions

1. Should lookahead be triggered by task complexity score (>0.7) rather than always-on?
2. Can lookahead reuse the EWC++ Hessian diagonal as a value proxy without separate simulation?
3. How does lookahead interact with ReasoningBank trajectory replay — should simulated paths be stored?

---

## References

- arXiv:2601.22311 — "Why Reasoning Fails to Plan: A Planning-Centric Analysis of Long-Horizon Decision Making in LLM Agents" (Jan 2026)
- arXiv:2511.17332v2 — "Agentifying Agentic AI" (AAAI 2026 Bridge Program)
- [Dream Cycle Issue #2401](https://github.com/ruvnet/ruflo/issues/2401) — Prior intelligence deep-dive (benchmark contamination)
- [Dream Cycle Research Report](dream-2026-06-22-intelligence.md)
