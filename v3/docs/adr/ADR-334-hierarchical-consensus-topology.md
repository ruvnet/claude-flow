# ADR-334: Hierarchical Consensus Topology for Large-Scale Swarm Coordination

**Status**: Proposed
**Date**: 2026-05-29
**Authors**: claude (dream-cycle agent, 2026-05-29)
**Issue**: [ruvnet/ruflo#TBD](https://github.com/ruvnet/ruflo/issues/)
**Related**: ADR-103 (witness temporal history), ADR-104 (federation wire transport)

## Context

Ruflo's hive-mind currently uses flat Raft consensus: one leader, N workers, O(N²) message complexity in the worst case. The configured maximum is 8 agents (CLAUDE.md anti-drift default). This ceiling is a product of the protocol, not the hardware.

The 2026 research literature has converged on two complementary improvements:

**SWARM+** (arXiv:2603.19431, March 2026, Grade A): Adapts PBFT for distributed workload management via a two-tier hierarchy — a small *coordinator group* (3-5 nodes) runs Byzantine-tolerant consensus among themselves, then delegates shards of the task space to *worker clusters* that use lightweight crash-fault Raft internally. Benchmarked at 1,000 agents with 97-98% scheduling latency improvement over flat baseline and ≤7.5% degradation under 50% agent failure.

**SwarmHarness** (arXiv May 2026, Grade A): Introduces Shapley-value credit attribution so individual skill nodes are weighted by marginal contribution to recent task outcomes. Without this, flat consensus treats all agents as equivalent — a low-quality agent can veto or slow progress on the same footing as a high-quality one.

Ruflo has no mechanism for either. Adding more than 8 agents today will not improve throughput; it may degrade it due to Raft leader bottleneck.

## Decision

Adopt a **two-tier hierarchical consensus topology** for hive-mind swarms with `agentCount > 20`:

1. **Coordinator tier** (3 or 5 nodes, odd): runs existing Raft for crash-fault tolerance among trusted orchestrator agents. Elected via current `queen-coordinator` logic.
2. **Worker shard tier**: N/shardSize clusters, each ≤10 agents, each with an internal shard-leader elected by the coordinator. Intra-shard communication is direct (no consensus); only shard-leader reports to coordinator.
3. **Credit vector**: Each shard-leader maintains a Shapley approximation per agent (task contribution / total tasks). Agents with score < 0.1 over a 20-task window are flagged for replacement.

The existing 8-agent flat Raft path remains unchanged for `agentCount ≤ 20` (no regression).

## Consequences

**Positive:**
- Scales to 200+ agents without O(N²) message explosion
- Credit attribution enables quality-weighted task routing
- Validated by SWARM+ at 1,000 agents (Grade A benchmark)
- Backwards-compatible (flat path unchanged below threshold)

**Negative:**
- Increases complexity in `@claude-flow/cli` hive-mind module (~400 LOC addition)
- Shard-leader election adds ~50-100ms to swarm startup above 20-agent threshold
- Shapley credit requires N+1 task completions before first signal (cold-start latency)

**Neutral:**
- No change to MCP tool surface
- No change to memory namespace or AgentDB schema
- `maxAgents: 8` CLAUDE.md default remains correct for anti-drift coding swarms

## Implementation Notes

Target file: `v3/@claude-flow/cli/src/hive-mind/consensus/hierarchical-topology.ts`

Coordinator tier: reuse `RaftManager` (existing). Shard tier: new `ShardCluster` class with `ShardLeader` role. Credit vector: `CreditTracker` using banzhee/sampling approximation to avoid O(2^N) Shapley computation.

Threshold config key: `hiveMind.hierarchicalThreshold` (default: 20). Expose as `--hierarchical-threshold N` CLI flag on `swarm init`.

## References

- arXiv:2603.19431 — SWARM+: Scalable and Resilient Multi-Agent Consensus
- arXiv (May 2026) — SwarmHarness: Skill-Based Task Routing via Decentralized Incentive-Aligned AI Agent Networks
- Dream Cycle Research: `v3/docs/research/dream-cycle-2026-05-29-swarm.md`
