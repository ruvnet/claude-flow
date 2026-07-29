# ADR-330: Adaptive Pheromone Swarm Consensus (APSC) for Dynamic Agent Pruning

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-29)  
**Supersedes:** nothing  
**Related:** ADR-320 (Channel Guardrails), ADR-329 (Capability Brain), dream-cycle issue #TBD

---

## Context

Ruflo's swarm topologies (hierarchical, mesh, adaptive, hierarchical-mesh) set `maxAgents` statically at `swarm init` time. The default cap is 8 agents (anti-drift default, CLAUDE.md). Once agents are spawned, the coordinator does not prune underperforming agents during a run — all agents remain active until the task completes or a shutdown signal is sent.

Two Grade-A 2026 papers expose the cost of this static approach:

1. **TPSC-Sec** (arXiv 2607.03628, July 2026, 500-run benchmark): Adaptive pheromone consensus achieves **50% active-agent reduction while improving swarm fitness by 11.6%**. Mechanism: each agent emits a pheromone score (real-valued task-success signal) after each coordination round; the coordinator suppresses agents below an adaptive threshold and amplifies agents above it. Consensus acceptance rate: 0.97 ± 0.02. Support–quality correlation: r = 0.93.

2. **SPIN** (arXiv 2606.07557, June 2026): Models communication topology as Matrix Product State (MPS) chains. Linear O(n) scaling via clique contraction vs exponential joint-action enumeration. Zero-shot multi-goal transfer across 3 coordination regimes with no online retraining.

Current Ruflo behavior: all N spawned agents remain active for the full task duration regardless of per-agent contribution. The only cost controls are `maxAgents` (structural cap) and 3-tier model routing (cost-per-call optimization). No runtime pruning exists.

---

## Decision

Add `topology: "pheromone-adaptive"` as a new swarm topology option implementing Adaptive Pheromone Swarm Consensus (APSC).

### Core Mechanism

Each agent emits a **pheromone score** `p ∈ [0, 1]` after each `post-task` hook invocation:

```typescript
// Signal: weighted combination of task success, response latency, and consensus alignment
pheromone = α * taskSuccess + β * (1 - normalizedLatency) + γ * consensusAlignment
// Default: α=0.5, β=0.2, γ=0.3
```

The coordinator maintains a running **adaptive threshold** `θ` = EMA of all active agent pheromone scores (decay factor 0.85). Agents with `p < θ * pruning_factor` are suspended (not killed — they can be reactivated if `p` recovers). Default `pruning_factor = 0.6`.

### Implementation Targets

| Component | File | Change |
|-----------|------|--------|
| Pheromone pruner worker | `v3/@claude-flow/hooks/src/workers/pheromone-pruner-worker.ts` | New file |
| Swarm coordinator | `v3/@claude-flow/hooks/src/swarm/coordinator.ts` | Add `pheromone-adaptive` topology branch |
| Swarm init CLI | `v3/@claude-flow/cli/src/commands/swarm/init.ts` | Expose `--topology pheromone-adaptive` flag |
| APSC config type | `v3/@claude-flow/shared/src/types/swarm.ts` | Add `APSCConfig` interface |

### Configuration

```bash
# New topology option
npx claude-flow@latest swarm init \
  --topology pheromone-adaptive \
  --maxAgents 8 \
  --apsc-alpha 0.5 \
  --apsc-pruning-factor 0.6 \
  --apsc-reactivation-threshold 0.75
```

### Backward Compatibility

- `pheromone-adaptive` is additive — existing topology strings (`hierarchical`, `mesh`, `adaptive`, `hierarchical-mesh`) are unchanged.
- Default topology remains `hierarchical` (anti-drift default per CLAUDE.md).
- Opting into `pheromone-adaptive` requires explicit flag — no silent behavior change.

---

## Consequences

### Positive
- Targets 30–50% reduction in active agents on convergent tasks based on TPSC-Sec Grade-A benchmarks.
- Reduces API cost proportionally (fewer active agents = fewer model calls per coordination round).
- Provides a quality feedback signal that can be consumed by SONA for neural adaptation (hooks `post-task` → `neural train`).
- Agent suspension (not termination) preserves context for reactivation, enabling recovery from transient underperformance.

### Negative / Risks
- Pheromone scoring requires defining `taskSuccess` per agent type — generic metric may misfire for non-task agents (e.g., a pure coordinator role that never completes discrete tasks).
- Adaptive threshold decay parameter requires calibration; bad defaults could over-prune (too aggressive) or under-prune (too conservative).
- Adds a new coordination round-trip per `post-task` hook invocation — must stay under the <100ms MCP response target.

### Mitigations
- Ship with `--apsc-dry-run` flag: log pruning decisions without applying them. Allow teams to calibrate before enabling live pruning.
- Add `pheromone_score` to agent metrics output (`agent metrics --json`) for observability.
- Gate behind `CLAUDE_FLOW_FEATURE_APSC=1` env var in initial release.

---

## Alternatives Considered

1. **Static agent count with model-tier routing only (current):** Preserves simplicity. Cost optimization is model-level, not topology-level. Does not exploit the 50% pruning headroom identified by TPSC-Sec. Rejected.

2. **SPIN Tensorized Policy Coordination (arXiv 2606.07557):** Linear scaling via MPS-chain topology is theoretically superior but requires a fundamentally different coordination substrate (tensor contraction operations). Higher implementation cost; no existing Ruflo component to build on. Deferred to future ADR.

3. **RAPS Intent-Based Pub/Sub (arXiv 2602.08009):** Replaces static topology with emergent intent-based discovery. Architecturally more ambitious than APSC. Requires new subscription protocol on top of MCP. Deferred.

---

## References

- arXiv 2607.03628 — TPSC-Sec: Threat-Pheromone Swarm Consensus for Smart City Security (Grade A, 500-run benchmark, July 2026)
- arXiv 2606.07557 — SPIN: Decentralized Swarm Control via Tensorized Policy Coordination (Grade A, June 2026)
- arXiv 2604.07681 — Multi-Agent Orchestration on Leadership-Class HPC with MCP substrate (Grade A, April 2026)
- Dream-cycle session: 2026-07-29, SLOT=4, SESSION_COMMIT=314ad1eb0b5463567ff80bbf18e25ecad2ee7e43
