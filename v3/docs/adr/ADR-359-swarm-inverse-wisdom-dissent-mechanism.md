# ADR-359 — Swarm Dissent Mechanism: Inverse-Wisdom Law Compliance

**Status**: Proposed  
**Authors**: claude (dream-cycle agent, 2026-07-04)  
**Dream Cycle Issue**: #2559  
**Related**: ADR-026 (3-tier model routing), CLAUDE.md swarm configuration

---

## Context

The 2026 paper *Inverse-Wisdom Law* (Shehata & Li, arXiv:2604.27274) provides a formal mathematical proof with empirical confirmation (Grade A) that adding agents to a consensus swarm **statistically increases the probability of erroneous consensus** rather than reducing it. The mechanism: once a plurality of agents commit to a wrong trajectory, majority voting amplifies that trajectory with each additional agent, making correction progressively harder.

Ruflo's current swarm coordinator uses Raft consensus (leader-based majority voting) with a soft `maxAgents: 8` default. There is no dissent preservation channel — when the majority votes one way, minority positions are silently dropped.

A companion finding (arXiv:2605.10698, "Bystander Effect in LLM Swarms") independently confirms that dissent suppression is the failure mode, not the agent count per se. The fix is architectural: expose a minority-opinion channel, not merely cap the agent count.

---

## Decision

Add a **dissent channel** to the Ruflo swarm coordinator:

1. **`dissent_threshold` parameter** (default: `floor(N/4)`, minimum 2): when this many or more agents vote against the majority conclusion, the coordinator surfaces a `dissent` field in the swarm result alongside the `consensus` field rather than suppressing the minority position.

2. **`dissent_weight` parameter** (default: `0.0`, range 0.0–1.0): controls how much the dissenting position influences the final merged output. At 0.0, dissent is logged only. At 1.0, dissent is blended equally with consensus.

3. **Dissent metadata**: each `dissent` record includes the count of dissenting agents, their IDs, and a summarised position.

4. **`max_agents` formal cap** (default: 8, hard maximum: 12): backed by the Inverse-Wisdom Law finding. Values >12 are rejected at configuration validation time with an explanatory error referencing this ADR.

### Implementation Scope

- `v3/@claude-flow/cli/src/swarm/coordinator.ts` — add `dissent_threshold`, `dissent_weight`, enforce `max_agents` hard cap  
- `v3/@claude-flow/cli/src/swarm/consensus.ts` — add dissent extraction before majority resolution  
- `v3/@claude-flow/cli/src/swarm/types.ts` — add `SwarmDissent` type to `SwarmResult`  
- CLAUDE.md swarm config block — document new parameters

Estimated effort: 1 sprint (3-4 days).

---

## Consequences

### Positive
- Inverse-Wisdom Law compliance: minority positions are preserved rather than silently dropped
- First-mover advantage: none of LangGraph, AutoGen, CrewAI, or OpenAI Swarm implements a formal dissent channel
- Auditable decisions: dissent metadata enables post-hoc review of contested swarm outputs
- Hard `max_agents` cap prevents pathological swarm sizes that provably degrade correctness

### Negative
- Dissent surfacing adds latency when minority positions must be summarised (~50ms per dissent event)
- `dissent_weight > 0` requires a merge step that may produce incoherent blended outputs if not carefully prompted
- Operators must understand the new `dissent` field in swarm results to avoid ignoring it

### Neutral
- Default `dissent_weight: 0.0` makes this a non-breaking change — existing callers see a new field but behaviour is unchanged unless they opt in

---

## Rejected Alternatives

1. **Simply cap `max_agents` at 4**: Addresses the Inverse-Wisdom Law quantitatively but loses the parallelism benefit of larger swarms. Dissent channel preserves parallelism while fixing the silencing problem.

2. **Use adversarial subagents**: Spawning a dedicated "devil's advocate" agent is more expensive and architecturally complex. The dissent channel extracts minority positions from agents already running.

3. **No action**: The Inverse-Wisdom Law is a Grade A formal result. Ignoring it means Ruflo's 8-agent default provably degrades consensus quality on misaligned tasks.

---

## References

- Shehata & Li (2026). *Inverse-Wisdom Law in Multi-Agent LLM Consensus*. arXiv:2604.27274
- arXiv:2605.10698 — Bystander Effect in LLM Swarms (companion paper)
- [Dream Cycle Issue #2559](https://github.com/ruvnet/ruflo/issues/2559)
- [Gist: Swarm SOTA Report 2026-07-04](https://gist.github.com/ruvnet) *(URL added after publication)*
