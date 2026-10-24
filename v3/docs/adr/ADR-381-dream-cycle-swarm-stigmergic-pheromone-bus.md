# ADR-381 — Stigmergic Memory Bus for Swarm Coordination (PheromoneBus)

- **Status**: Proposed
- **Date**: 2026-08-04
- **Authors**: claude (dream-cycle agent, 2026-08-04)
- **Related**: ADR-330 (TPSC pheromone consensus, 2026-07-29), ADR-087 (graph-node native backend), ADR-150 (MetaHarness integration surfaces)
- **Prompted by**: Dream Cycle 2026-08-04 swarm surface — arXiv 2607.03628, 2607.17709, 2608.00320

## Context

The 2026 swarm SOTA has converged on **stigmergic coordination**: agents write gradient signals to a shared memory field (a "pheromone bus") and workers read those signals to self-coordinate — without any direct agent-to-agent messaging. Two independent 2026 Grade-A results establish this pattern:

- **arXiv 2607.03628** (Swarm-Driven Multi-Agent Reasoning): Pheromone-threat model achieves 50% agent count reduction with +11.6% collective fitness improvement. Consensus acceptance 0.97 ± 0.02 (support-quality correlation 0.93).
- **arXiv 2607.17709** (Ant Swarm Functional Control via Stigmergic RL): Agents coordinate exclusively through pheromone fields in continuous action spaces via RL policy gradient — zero direct messaging.
- **arXiv 2608.00320** (Neural Operator for Collision-Aware Planning): Zero-shot generalization from 10-agent training to 1,000-agent deployment, enabled by topology-independent signal fields.

Ruflo's current swarm architecture uses named-agent `SendMessage` calls through a hierarchical coordinator. This is direct coupling: agents must know each other's names, message schemas, and ordering. It requires a coordinator to hold state. It does not generalize across agent count changes.

The gap is structural, not tunable: direct messaging cannot achieve the 50%-agent-reduction fitness improvement because the coupling prevents emergent load redistribution.

## Decision

Introduce `PheromoneBus` as a first-class coordination primitive in `@claude-flow/memory`, backed by AgentDB:

1. **PheromoneBus interface** (`@claude-flow/memory/src/pheromone-bus.ts`):
   - `emit(signal: PheromoneSignal): Promise<void>` — write a gradient signal to the shared keyspace
   - `sense(filter: SignalFilter): Promise<PheromoneSignal[]>` — read signals by type/strength/age
   - `evaporate(ttl: number): Promise<void>` — apply time-decay; background worker runs every 500ms
   - All signals stored in AgentDB with TTL, strength, and source-agent metadata

2. **Swarm integration** (`@claude-flow/cli/src/swarm/`):
   - Add `--coordination-mode stigmergic|direct|hybrid` flag to `swarm init`
   - In stigmergic mode: coordinator emits task-completion signals; workers sense available work rather than receiving direct assignments
   - In hybrid mode: use PheromoneBus for capacity signals, direct messaging for structured results

3. **Agent-count optimizer** (`@claude-flow/cli/src/swarm/agent-count-optimizer.ts`):
   - Monitors per-cycle task fitness via `post-task` hook
   - When convergence detected (3 consecutive cycles with <2% fitness delta), reduces `maxAgents` by up to 50%
   - Emits `AGENT_REDUCTION_SIGNAL` on PheromoneBus; dormant agents self-terminate

4. **Pre-swarm formal verification gate** (`@claude-flow/hooks/src/workers/swarm-verify.ts`):
   - Before spawning production swarms, check 5 core temporal-logic properties on the communication graph
   - Hook: `pre-swarm` (new hook type added to hooks system)
   - Minimum pass rate target: ≥88% (matching arXiv 2606.19632 baseline)

## Consequences

### Positive
- 50% agent count reduction at equivalent fitness (Grade-A evidence from arXiv 2607.03628)
- Topology-independent coordination enables zero-shot agent count scaling (arXiv 2608.00320 pattern)
- Eliminates coordinator single-point-of-failure for capacity distribution
- Formal verification gate reduces attack surface for Telephone Loop attacks (arXiv 2608.00202)

### Negative
- PheromoneBus adds a new abstraction layer in `@claude-flow/memory`; increases API surface
- Hybrid mode adds operational complexity for users choosing coordination strategy
- Time-decay tuning (evaporation rate) is task-specific; requires sensible defaults

### Neutral
- Direct messaging remains the primitive for structured result passing; PheromoneBus handles capacity/task-availability signals only
- Backward-compatible: existing swarm workflows default to `direct` mode, no behavior change

## Implementation Notes

- PheromoneBus keys: `pheromone:<swarm-id>:<signal-type>:<sequence>` in AgentDB
- Evaporation: exponential decay with configurable half-life (default 30s task signals, 5s capacity signals)
- Signal types: `TASK_AVAILABLE`, `CAPACITY_SIGNAL`, `CONVERGENCE_SIGNAL`, `AGENT_REDUCTION_SIGNAL`, `HEALTH_PULSE`
- Agent-count optimizer: wire as `post-task` worker; add to `hooks worker list` output
- Verification gate: use `@claude-flow/security` `SafeExecutor` for property-checker invocation; property definitions in YAML per swarm type
- ADR-330 TPSC pattern is complementary: TPSC handles external consensus finalization; PheromoneBus handles internal task coordination

## References

- arXiv 2607.03628: https://arxiv.org/abs/2607.03628
- arXiv 2607.17709: https://arxiv.org/abs/2607.17709
- arXiv 2608.00320: https://arxiv.org/abs/2608.00320
- arXiv 2606.19632: https://arxiv.org/abs/2606.19632
- arXiv 2608.00202: https://arxiv.org/abs/2608.00202
- LangGraph Send API: https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph
- Prior TPSC ADR-330: v3/docs/adr/ADR-330-adaptive-pheromone-swarm-consensus.md
