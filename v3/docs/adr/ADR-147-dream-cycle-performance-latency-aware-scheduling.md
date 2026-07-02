# ADR-147: Latency-Aware Critical Path Scheduling for Swarm Orchestration

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-06-05)  
**Context:** Dream Cycle nightly research — DEEP=performance, 2026-06-05  

---

## Context

Ruflo's swarm orchestrator uses a fixed hierarchical topology with static agent assignment (up to 8 agents, `maxAgents` cap). Agents are dispatched in a predetermined order without modeling the execution dependency graph or the critical path through it.

Two 2026 papers identify this as the dominant multi-agent latency bottleneck:

- **LAMaS** (arXiv:2601.10560, Jan 2026): Latency-Aware Multi-agent System achieves 38–46% reduction in critical path length by building an explicit execution dependency graph and scheduling agents in parallel where the graph allows it, vs. sequential SOTA.  
- **COMB** (arXiv:2511.00739, updated Apr 2026): CPU-Aware Overlapped Micro-Batching achieves 1.7× lower P50 latency (standalone) and 3.9× lower service latency under open-loop load by overlapping CPU pre/post-processing with GPU inference.

Ruflo currently exposes no mechanism to:
1. Declare inter-agent task dependencies at spawn time.
2. Compute the critical path and preferentially parallelize critical-path agents.
3. Overlap CPU-bound coordination work (JSON parsing, memory writes, hook execution) with in-flight LLM calls.

## Decision

Adopt latency-aware critical path scheduling in the Ruflo swarm orchestrator as an opt-in topology mode `"latency-aware"` alongside the existing `"hierarchical"`, `"mesh"`, and `"adaptive"` modes.

### Key design points

1. **Dependency graph at spawn time.** Each `Task(...)` call gains an optional `after: ["agent-name", ...]` field. The scheduler builds a DAG; agents with no unmet dependencies are immediately eligible.
2. **Critical path computation.** Before dispatching, compute the longest weighted path (agent estimated duration = `estimatedMs` field, default 2000 ms). Agents on the critical path are dispatched first and assigned the highest I/O priority.
3. **Micro-batch overlap.** Hook execution (`pre-task`, `post-edit`, memory writes) runs in a background worker queue overlapped with LLM calls — not before them. A `CLAUDE_FLOW_ASYNC_HOOKS=true` env flag enables this.
4. **Fallback.** If `estimatedMs` is not provided, the scheduler falls back to topological-order dispatch (same behaviour as today). No regression for existing swarms.

## Consequences

**Positive**
- Expected 30–46% reduction in wall-clock swarm completion time for pipelines with parallelizable sub-tasks (based on LAMaS results on equivalent dependency structures).
- Hook overhead (currently synchronous) moves off the critical path, contributing 5–15% additional latency reduction.
- Explicit dependency graph makes swarm execution auditable and reproducible.

**Negative / Risk**
- `after` dependency cycles will deadlock the swarm. The scheduler must detect cycles at init time and reject the swarm with a clear error.
- `estimatedMs` hints are user-supplied; poor estimates lead to mis-prioritised critical paths with no correctness impact but suboptimal parallelism.
- Async hooks require that hooks be idempotent and not depend on synchronous side-effects within the same agent turn. Hooks that write to shared mutable state must be reviewed before enabling `CLAUDE_FLOW_ASYNC_HOOKS`.

## Implementation Notes

- New file: `v3/@claude-flow/cli/src/swarm/latency-aware-scheduler.ts`
- Modify: `v3/@claude-flow/cli/src/swarm/orchestrator.ts` — add `topology: "latency-aware"` branch
- Modify: `v3/@claude-flow/cli/src/commands/swarm.ts` — expose `--latency-aware` flag
- Benchmark target: ≥30% wall-clock reduction on a 5-agent linear pipeline with 2 parallelizable branches vs. current hierarchical mode.
- Defer COMB micro-batching to a follow-on ADR once the scheduler is validated.
