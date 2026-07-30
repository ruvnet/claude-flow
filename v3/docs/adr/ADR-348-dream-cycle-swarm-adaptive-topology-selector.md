# ADR-348: Task-Adaptive Swarm Topology Selector

- **Status:** Proposed
- **Authors:** claude (dream-cycle agent, 2026-06-19)
- **Dream Cycle Issue:** #TBD (filed same night)
- **Evidence Grade:** A (arXiv 2602.16873, SWE-bench Verified / GPQA Diamond / HotpotQA)

---

## Context

Ruflo's `swarm_init` accepts a fixed `topology` parameter set at configuration time. The default is `hierarchical` (anti-drift mandate, CLAUDE.md). This is correct for coordination stability but suboptimal for task performance: AdaptOrch (arXiv 2602.16873, Feb 2026) demonstrates that **hybrid topology wins 49.7% of real tasks while hierarchical wins only 19%**, and dynamic selection yields +9.8pp on SWE-bench Verified, +6.9pp on GPQA Diamond, +8.1pp on HotpotQA over the single best static topology.

The Ruflo swarm currently has no mechanism to inspect a task's dependency structure before committing to a topology. Every invocation defaults to `hierarchical` regardless of whether the task is trivially parallelisable (fan-out), strictly serial (pipeline), or genuinely hierarchical (coordinator + workers).

---

## Decision

Add a **topology selector** module (`@claude-flow/swarm/topology-selector`) that runs before `swarm_init` and emits a recommended topology from `[parallel, sequential, hierarchical, hybrid]` based on a lightweight task dependency graph analysis.

### Selector logic (heuristic v1)

| Condition | Recommended topology |
|---|---|
| All subtasks independent (no shared outputs) | `parallel` |
| Linear chain (each task feeds exactly one successor) | `sequential` |
| One coordinator, N independent workers | `hierarchical` |
| Mixed (parallel groups + sequential dependencies) | `hybrid` |
| Graph unavailable or parsing error | `hierarchical` (existing default — anti-drift safe fallback) |

The selector is **opt-in per invocation**: callers pass `topology: "auto"` to `swarm_init`; all existing callers with an explicit topology continue to work unchanged.

### Interface

```typescript
// @claude-flow/swarm/topology-selector
export interface TaskGraph {
  nodes: string[];          // subtask IDs
  edges: [string, string][]; // dependency edges (from → to)
}

export type Topology = 'parallel' | 'sequential' | 'hierarchical' | 'hybrid';

export function selectTopology(graph: TaskGraph): Topology;
```

`swarm_init` maps `topology: "auto"` → calls `selectTopology(graph)` → passes resolved topology to existing init logic.

---

## Consequences

### Positive
- Expected +9–23% accuracy on heterogeneous task mixes (Grade A evidence from AdaptOrch)
- Zero breaking change: existing explicit-topology callers are unaffected
- Selector itself is O(|nodes| + |edges|) — negligible overhead
- Fallback to `hierarchical` preserves anti-drift guarantee when graph is unavailable

### Negative
- Callers must supply a `TaskGraph` to benefit; unstructured free-text tasks cannot be auto-analysed without an LLM parse step (Tier 2/3 cost)
- Hybrid topology increases inter-agent messaging complexity; requires thorough integration testing before enabling by default

### Neutral
- CLAUDE.md anti-drift rule ("ALWAYS use hierarchical topology for coding swarms") remains the stated default; `topology: "auto"` is an explicit opt-in

---

## Implementation Notes

- Files: `v3/@claude-flow/cli/src/swarm/topology-selector.ts`, `topology-selector.test.ts`
- No schema changes; `topology` field gains `"auto"` as a valid value
- Add integration tests against AdaptOrch-style task graphs (coding, reasoning, RAG shapes)
- No ADR needed for the SFDA swarm-agent failover or ruvector backend adapter (implementation-level changes)
