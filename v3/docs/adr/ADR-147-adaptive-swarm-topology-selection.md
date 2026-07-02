# ADR-147: Adaptive Swarm Topology Selection

- **Status:** Proposed
- **Authors:** claude (dream-cycle agent, 2026-06-04)
- **Dream Cycle night:** SLOT=4 DEEP=swarm
- **Session commit:** 844f68dbe5f28c4c2b13c56e8e102528aa63b629

## Context

Ruflo currently defaults all coding swarms to `hierarchical` topology with `maxAgents=8`. This is hard-coded in CLAUDE.md and `swarm_init` defaults. The 2026 AdaptOrch benchmark demonstrates that a runtime topology selector — routing tasks to hybrid (62%), parallel (24%), or hierarchical (14%) based on task graph shape — achieves **22.9% improvement** over the single best fixed topology on SWE-bench Verified (Grade A claim). SWARM+ (arXiv:2603.19431) further validates that hierarchical consensus can scale to 990 agents with 97–98% latency reduction over flat coordination, but only when the hierarchy depth is adapted to workload. The industry coordination failure rate is 36.94% across AutoGen/CrewAI/LangGraph; Ruflo has no telemetry to measure its own rate.

## Decision

Implement a lightweight topology pre-classifier that inspects task metadata before `swarm_init` and selects the optimal topology, rather than always defaulting to hierarchical.

### Classifier Rules (v1)

| Task signal | Selected topology | Rationale |
|-------------|-------------------|-----------|
| Independent subtasks, no shared state | `parallel` | Avoids coordinator overhead |
| Deep dependency chain (A→B→C→D) | `hierarchical` | Central state, ordered execution |
| Mixed: some parallel + some sequential | `hierarchical-mesh` (hybrid) | AdaptOrch winner at 62% |
| Single-file / trivial (skip swarm) | none | Below swarm threshold |

### Telemetry Gate

Before implementing topology selection, instrument `post-task` hook to emit: `coordination_failures` count, `message_timeout_ms`, `agent_crash_count`. Establish a 7-night baseline before enabling auto-select.

## Consequences

**Positive:**
- Expected +20%+ task completion rate (AdaptOrch evidence, Grade A)
- Reduces supervisor token overhead (currently +20–40% vs swarm for hierarchical)
- Enables future scaling beyond 8 agents for large refactors

**Negative / Risks:**
- Classifier adds latency to task initiation (~1–5ms estimated)
- Wrong topology choice could degrade performance; needs circuit-breaker fallback to `hierarchical`
- Coordination failure telemetry must be validated before trusting auto-select

## Alternatives Considered

1. **Status quo (hierarchical always):** Simple but leaves +22.9% gain on table.
2. **User-specified only:** Forces cognitive load on user; not aligned with "auto-start swarm protocol."
3. **Full AdaptOrch (LLM-based routing):** Adds token cost per task; overkill for v1.

## Implementation Plan

1. Add `coordination_failures` metric to `post-task` hook (1 sprint)
2. Implement `TopologyClassifier` in `@claude-flow/hooks` (1 sprint)
3. A/B test: 50% of swarm inits use classifier, 50% use hierarchical default (2 sprints)
4. Promote if p95 task completion ≥ current baseline

## References

- AdaptOrch benchmark (2026), SWE-bench Verified, adaptive topology +22.9%
- SWARM+ (arXiv:2603.19431, Mar 2026), 97–98% latency reduction at 990 agents
- Market-based UAV swarms (arXiv:2606.01970, Jun 2026), 93% success under 25% degradation
- Dream Cycle gist: `dream/2026-06-04-swarm` branch, `v3/docs/dream/dream-gist-2026-06-04.md`
