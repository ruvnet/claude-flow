# ADR-343: Shared-Context Parallel Dispatch for Multi-Agent Performance

**Status:** Proposed
**Authors:** claude (dream-cycle agent, 2026-06-10)
**Date:** 2026-06-10
**Related:** ADR-006 (Unified Memory Service), ADR-009 (Hybrid Memory Backend)

---

## Context

DeLM (arXiv:2606.10662, Mao & Mirhoseini, Jun 9 2026) demonstrates that giving decentralized agents a shared verified context snapshot at spawn time achieves +10.5pp on SWE-bench Verified and −50% cost simultaneously. The key mechanism: agents receive a read-only immutable view of the task queue and shared state at spawn, rather than building context serially via message passing.

Ruflo v3.6.10 spawns agents via the `swarm_init` + Task tool pipeline. Agents build context through sequential SendMessage exchanges, which serializes work that could be parallel and replicates retrieval calls (each agent independently queries AgentDB for the same context).

3SPO (arXiv:2606.09961) provides a complementary finding: step-wise state-score credit assignment (+22.6% ALFWorld vs GRPO) requires per-state snapshots, not just per-trajectory aggregates. A shared context snapshot is the prerequisite for step-wise RL.

No existing ADR (143–147) covers context materialization at swarm spawn time.

---

## Decision

At `swarm_init` time, serialize the current AgentDB namespace into a read-only immutable snapshot (`SwarmContextSnapshot`) and pass it as a typed parameter to each spawned agent. Agents receive the snapshot synchronously at spawn and do not need to query AgentDB for baseline context.

### Interface

```typescript
// v3/@claude-flow/cli/src/swarm/types.ts
interface SwarmContextSnapshot {
  readonly namespace: string;
  readonly entries: ReadonlyMap<string, unknown>;
  readonly vectorIndex?: ReadonlyArray<{ key: string; embedding: Float32Array }>;
  readonly snapshotAt: number; // unix ms
}

interface SwarmInitOptions {
  topology: 'hierarchical' | 'mesh' | 'adaptive' | 'hierarchical-mesh';
  maxAgents: number;
  strategy: 'specialized' | 'balanced';
  namespace?: string;
  snapshot_context?: boolean; // default: false (feature-flagged)
}
```

### Behaviour

1. When `snapshot_context: true`, `swarm_init` calls `AgentDB.snapshot(namespace)` before spawning any agent.
2. The snapshot is passed as an immutable frozen object in each agent's initial prompt context.
3. Agents do not re-query AgentDB for keys present in the snapshot during their first turn.
4. Writes by agents go directly to AgentDB (not the snapshot); the snapshot is spawn-time only.

---

## Consequences

**Positive:**
- Eliminates N redundant AgentDB reads (one per agent) for shared baseline context.
- Enables parallel agent starts without sequential SendMessage context-building.
- Prerequisite for step-wise RL (3SPO approach) — per-state snapshots become available.
- Aligns with DeLM's architecture, the current SWE-bench SOTA approach.

**Negative:**
- Snapshot may be stale if the namespace changes between `swarm_init` and agent first-turn completion (bounded by swarm startup latency, typically <500ms).
- Increases `swarm_init` latency by one AgentDB read (mitigated by RaBitQ 0.60ms/query measured performance).
- Feature-flagged (`snapshot_context: false` default) until benchmarked.

**Neutral:**
- Does not change the SendMessage protocol or agent coordination topology.
- Does not affect agents that do not read from AgentDB.

---

## Implementation Sketch

Files to modify (~80 LOC total):

1. `v3/@claude-flow/cli/src/swarm/init.ts` — add `snapshot_context` handling (~50 LOC)
2. `v3/@claude-flow/cli/src/swarm/types.ts` — add `SwarmContextSnapshot` interface (~20 LOC)
3. `v3/@claude-flow/memory/src/agentdb.ts` — add `snapshot(namespace)` method (~10 LOC)

Gate: measure wall-clock reduction on a 5-agent benchmark pipeline before setting `snapshot_context: true` as default. Target: ≥20% reduction in time-to-first-agent-output (cf. DeLM's −50% cost baseline).

---

## Alternatives Rejected

- **Keep current SendMessage-first approach**: Leaves −50% cost and +10.5pp SWE-bench gain on the table.
- **Full DeLM task-queue replication**: Requires replacing the hierarchical coordinator with a decentralized queue — too large a change. `snapshot_context` is a minimal, non-breaking step in the same direction.
- **Pre-warm agents with background AgentDB reads**: Race condition risk; snapshot approach is deterministic.
