# ADR-375: Agentic Inference Benchmarking Standard + Mixture-of-Agents Test-Time Scaling

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-25)  
**Dream Cycle Issue:** TBD (filed same session)  
**Related:** ADR-026 (3-tier model routing), ADR-143 (intent routing)

## Context

Two Grade-A findings from the 2026-07-25 Dream Cycle performance deep dive:

1. **AA-AgentPerf** (Artificial Analysis, June 12, 2026): The first agentic inference benchmark has published results showing a 23.6× hardware efficiency gap (GB300: 61,354 Agents/MW vs H200: 2,594 Agents/MW). Ruflo has no registered performance on this benchmark. All four tracked competitors (LangGraph, AutoGen, CrewAI, OpenAI Swarm) are also unregistered — this is a first-mover opportunity.

2. **Pareto-Optimal Test-Time Scaling** (arXiv 2605.01566, ACL 2026 SRW): Mixture-of-agents (MoA) achieves +2.7pp over self-consistency on MMLU-Pro at equal compute budget. The key configuration insight: MoA is most efficient when `parallelGenerations > sequentialAggregations`. Ruflo's 3-tier routing (ADR-026) selects by cost/complexity but has no test-time compute scaling mode.

## Decision

### Part A: AA-AgentPerf Benchmark Registration

Add `npx claude-flow@latest performance benchmark --suite agentperf` that:
- Replays a standardized agentic coding trajectory (200-turn, 100K+ token context)
- Reports: Agents/MW (primary), P95 latency, TTFT, concurrent-agent throughput
- Targets ≥5,000 Agents/MW on standard developer hardware (H100/H200 equivalent)
- Gates CI: fail if Agents/MW drops below 80% of baseline on performance PRs
- Publishes results to a public leaderboard entry (CLAUDE.md Performance Targets table)

### Part B: Mixture-of-Agents Routing

Extend `hooks route` (ADR-026 Tier-2/3 decision) with a `--scaling-mode` flag:

```typescript
interface RoutingDecision {
  tier: 1 | 2 | 3;
  scalingMode: 'none' | 'self-consistency' | 'mixture-of-agents' | 'self-refine';
  parallelBranches?: number;
  sequentialAggregations?: number;
}
```

Activate `mixture-of-agents` when:
- Task complexity score ≥ 0.6 (Tier 3 threshold)
- `estimatedParallelAgents > estimatedSequentialAggregations`
- Token budget allows ≥ 3 parallel drafts

Expected gain: +2.7pp accuracy over self-consistency at equal compute (Grade A evidence).

## Consequences

### Positive
- Closes the AA-AgentPerf credibility gap (first-mover vs all tracked competitors)
- ACL 2026 Grade A evidence for +2.7pp accuracy gain from MoA at no extra cost
- Replaces the unverified Flash Attention claim with a measurable Agents/MW metric
- MoA routing is architecturally additive — no breaking change to ADR-026 tiers

### Negative
- AA-AgentPerf benchmark run requires long-context GPU infrastructure (not cheap in CI)
- MoA routing adds latency for the parallel-draft phase before aggregation
- ADR-375 collision: multiple prior dream branches have created ADR-375 with different content. This ADR uses 320 because it is the next available number on `main` (ADR-319 is the last merged). Human reviewer must reconcile or renumber when merging dream branches.

## Implementation Plan

1. `v3/@claude-flow/cli/src/performance/agentperf-suite.ts` — trajectory replay harness
2. `v3/@claude-flow/hooks/src/route/scaling-mode.ts` — MoA routing extension
3. `v3/@claude-flow/cli/src/commands/performance.ts` — add `--suite agentperf` flag
4. `.github/workflows/agentperf-gate.yml` — CI gate on performance PRs
5. Update `CLAUDE.md` Performance Targets table with Agents/MW metric

## References

- AA-AgentPerf: https://artificialanalysis.ai/articles/aa-agentperf (Jun 12, 2026)
- arXiv 2605.01566: "Multi-Agent Reasoning Improves Compute Efficiency: Pareto-Optimal Test-Time Scaling" (ACL 2026 SRW)
- arXiv 2604.25917: "Recursive Multi-Agent Systems" (RecursiveMAS)
- dev.to/saivishwak: AutoAgents-Rust benchmark (Feb 2026)
