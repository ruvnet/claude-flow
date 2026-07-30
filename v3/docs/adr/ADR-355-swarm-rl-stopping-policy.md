# ADR-355: Reinforcement-Learned Stopping Policy for Ruflo Swarm Orchestration

**Status:** Proposed
**Date:** 2026-06-29
**Authors:** claude (dream-cycle agent, 2026-06-29)
**Related issues:** dream-cycle #2026-06-29, arXiv 2605.02801

---

## Context

arXiv 2605.02801 (May 2026) surveys RL methods for LLM-based multi-agent orchestration and identifies five core sub-decisions: spawn timing, delegation, communication, aggregation, and **stopping**. After curating 84 papers, the authors find zero explicit RL training methods for the stopping decision. Every production system — LangGraph, AutoGen, CrewAI, OpenAI Swarm, and Ruflo — uses static stopping policies (token budgets, task completion signals, or hard agent-count caps).

Ruflo's current stopping mechanism is `maxAgents: 8` (CLAUDE.md default) plus task completion. This cap is not learned; it does not adapt to task complexity, available resources, or quality signal from completed agents.

---

## Decision

Implement an **RL stopping-decision policy** as a lightweight head on Ruflo's orchestrator. The policy observes:
- Number of agents spawned so far
- Aggregated partial results from completed agents (quality signal)
- Task complexity estimate (from `hooks route` output)
- Time elapsed vs. budget

And outputs a binary decision: **spawn more agents** or **aggregate and stop**.

Training source: Ruflo's existing `post-task` hook events become orchestration traces. Each swarm run produces a labeled trace (task → agents spawned → quality of final output). A simple bandit or REINFORCE head is trained offline on these traces.

---

## Implementation

1. Define orchestration trace schema (extends `post-task` hook payload):
   ```json
   {
     "task_id": "...",
     "complexity_score": 0.0–1.0,
     "agents_spawned": [...],
     "stopping_step": N,
     "final_quality_score": 0.0–1.0
   }
   ```

2. Add `StoppingPolicyHead` to `@claude-flow/hooks` workers (new `stopping-policy` worker, priority: normal).

3. Wire into swarm orchestrator: before each `agent spawn`, check policy; if `stop=true`, proceed to aggregation phase.

4. Start with a simple rule-based policy (threshold on complexity_score × agents_spawned) as a warm-start before RL training accumulates enough traces.

5. Expose via config: `CLAUDE_FLOW_STOPPING_POLICY=rl|static|threshold` (default: `static` to preserve existing behavior).

---

## Consequences

- **Positive:** Adapts to task complexity; avoids wasted agent spawns on simple tasks; closes the last un-automated orchestration sub-decision.
- **Positive:** Removes the hard `maxAgents=8` cap as a scaling constraint — policy naturally gates agent count.
- **Negative:** Requires trace collection period before RL training is meaningful (~50+ swarm runs).
- **Negative:** Adds a new worker to the hooks system (8th worker in low-priority tier).
- **Neutral:** Default remains `static` — no behavior change until opt-in.

---

## Alternatives Considered

- **Larger static cap** (e.g., maxAgents=16): Doesn't solve the fundamental problem; just moves the arbitrary threshold.
- **LLM-judged stopping**: Ask the orchestrator LLM to decide. Too expensive per decision; defeats latency targets.
- **External timeout only**: Already available via budget limits; orthogonal, not a substitute.

---

## References

- arXiv 2605.02801 — "Reinforcement Learning for LLM-based Multi-Agent Systems through Orchestration Traces" (May 2026)
- arXiv 2602.16873 — "AdaptOrch: Task-Adaptive Multi-Agent Orchestration" (Feb 2026)
- Ruflo CLAUDE.md — Swarm Anti-Drift Defaults, 3-Tier Model Routing (ADR-026, ADR-143)
- Dream Cycle Report: `docs/dream-cycle/2026-06-29-swarm.md`
