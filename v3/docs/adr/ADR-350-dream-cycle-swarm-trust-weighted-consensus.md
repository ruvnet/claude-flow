# ADR-350: Trust-Weighted Consensus for Swarm Coordination

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Authors** | claude (dream-cycle agent, 2026-06-24) |
| **Date** | 2026-06-24 |
| **Dream Cycle Surface** | swarm (DEEP) |
| **Supersedes** | none |
| **Related** | ADR-162 (prior swarm ADR, 2026-06-19) |

---

## Context

The 2026-06-24 dream-cycle session surveyed swarm SOTA for 2026. Two peer-reviewed papers are directly actionable:

1. **SGTO-MAS** (arXiv:2606.07940) demonstrates that adding a Bayesian trust score to consensus voting reduces degradation under adversarial agent removal from unbounded to only **2.5 %** and under consensus disruption to **5.3 %**, while maintaining a consensus level of **0.8764**. The mechanism: each agent maintains a `trust_score ∈ [0,1]` updated via exponential smoothing (`trust_new = trust_old * 0.9 + outcome * 0.1`). Votes are weighted by trust score before the majority/quorum threshold is applied.

2. **RAPS** (arXiv:2602.08009) extends this with Bayesian reputation detection for malicious peers in publish-subscribe topologies, tested across 5 benchmarks.

Ruflo's current consensus stack (raft, byzantine, gossip, CRDT, quorum) has **no trust or reputation layer**. A compromised or misbehaving agent has equal voting weight to a healthy one. This is a security and reliability gap.

## Decision

Add an optional trust-weighted mode to Ruflo's consensus mechanisms, starting with `raft` and `byzantine`:

1. **Agent heartbeat extension:** Add `trust_score: number` (0–1, default 1.0) to the per-agent state tracked by `hierarchical-coordinator` and `raft-manager`.

2. **Vote weighting:** Before applying quorum threshold, multiply each vote by the sender's `trust_score`. Effective majority = `sum(trust_i * vote_i) / sum(trust_i) >= 0.5`.

3. **Trust update on outcome:** After each task cycle, update trust via `trust_i = 0.9 * trust_i + 0.1 * outcome_i` where `outcome_i ∈ {0, 1}` based on whether agent i's output passed validation.

4. **Configuration flag:** `trustWeightedConsensus: boolean` (default `false`) in swarm init options. Existing behaviour unchanged when disabled.

5. **Malicious agent eviction threshold:** When `trust_i < 0.2` for three consecutive cycles, the agent is marked `degraded` and removed from the quorum pool by the queen coordinator.

## Consequences

**Positive:**
- Matches SGTO-MAS Grade A benchmark: ≤5.3 % degradation under adversarial conditions
- Zero new external dependencies (pure arithmetic, no library required)
- Backwards-compatible via feature flag
- Enables detection of systematically failing agents (network partition, zombie processes)

**Negative:**
- Adds state to agent heartbeats (~8 bytes per agent per cycle)
- Cold-start problem: all agents start at trust 1.0; rogue agents take ≥10 cycles to degrade below 0.5
- Trust convergence speed (α=0.1) is a tunable guess — requires empirical validation

## Implementation Notes

- Touch files: `v3/@claude-flow/cli/src/swarm/raft-manager.ts`, `hierarchical-coordinator.ts`, `swarm-init.ts`
- Estimated effort: 2 engineering days
- Test: inject a 25 % fault rate into one agent in a 4-agent raft quorum; assert consensus remains ≥0.75 after 20 cycles
- Do NOT change the default `trustWeightedConsensus: false`; this is opt-in only

## Alternatives Considered

- **Static reputation list** (block known-bad agent IDs at config time): rejected — doesn't adapt at runtime.
- **Full Byzantine BFT only** (already available as `byzantine` topology): rejected as overkill for non-adversarial deployments; trust weighting is lighter and composable with any topology.
- **No action** (wait for more data): rejected — Grade A paper with numeric benchmarks justifies implementation.

## References

- arXiv:2606.07940 — SGTO-MAS (Secure Gorilla Troops Optimization for Multi-Agent Systems)
- arXiv:2602.08009 — RAPS (Reputation-Aware Publish-Subscribe)
- Dream Cycle research file: `v3/docs/research/dream-2026-06-24-swarm.md`
- Prior swarm ADR: ADR-162 (2026-06-19)
