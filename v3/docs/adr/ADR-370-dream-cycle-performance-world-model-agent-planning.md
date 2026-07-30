# ADR-370: World-Model Agent Planning for Cost-Aware Task Pre-Simulation

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-20)  
**Dream Cycle Surface:** performance (SLOT=0)  
**Source:** arXiv:2607.15901 (DSWorld, 2026) — Grade A

---

## Context

Ruflo agents execute tool chains reactively: they receive a task, plan inline, and execute each tool call sequentially. There is no pre-simulation step to estimate which paths are expensive before committing to them. As task complexity grows (multi-step data pipelines, cross-agent coordination), wasted real-tool calls compound.

The 2026 DSWorld paper (arXiv:2607.15901) demonstrates that a lightweight **world model** — a learned transition predictor trained on historical execution trajectories — can simulate tool outcomes before real execution. On data science agent tasks this yields:
- **14× RL agent training speedup** (fewer real-environment rollouts needed)
- **3–6× search-based inference speedup** (candidate plans evaluated in-model, not via real calls)

The methodology uses four components: structured state construction, cost-aware routing, lightweight real execution fallback, and an LLM-based simulator. A Reflective World Model Optimization (RWMO) RL strategy trains the predictor.

No competing agent framework (LangGraph, AutoGen, CrewAI, OpenAI Swarm) implements a world-model planning layer as of July 2026. AutoAgents-Rust achieves 84% higher throughput (4.97 vs 2.70 rps) over LangGraph through static typing, not planning optimization.

Separately, Ruflo's Flash Attention claim (2.49×–7.47× speedup) is explicitly unverified with no benchmark. The MCP response target (<100 ms) and CLI startup target (<500 ms) are also unmeasured.

---

## Decision

Introduce a **World Model Planner** layer into Ruflo's agent execution pipeline. Before executing a task chain with ≥3 estimated tool calls, the planner:

1. Retrieves relevant historical execution traces from AgentDB (HNSW lookup)
2. Uses a compact transition predictor (fine-tuned small model or rules-based) to estimate cost and success probability of each candidate plan
3. Selects the plan with the highest estimated success/cost ratio
4. Falls back to direct execution if the world model has <60% confidence

The implementation lives in a new `@claude-flow/planning` package (optional plugin). The `hooks pre-task` hook triggers the planner when `estimatedToolCalls >= 3`.

---

## Consequences

**Positive:**
- Reduces wasted real-tool calls during multi-step planning (target: 3–6× reduction)
- Complements ADR-026 (3-tier routing) — routing selects *which model*, planning selects *which path*
- Historical traces stored in AgentDB feed neural training loop (SONA/MoE) — virtuous cycle
- Positions Ruflo ahead of all four tracked competitors on planning sophistication

**Negative:**
- Cold-start problem: predictor needs ≥100 traces before estimates are reliable; fall-through to direct execution for new task types
- Adds latency for the planning step itself (~50–200 ms estimated); only worthwhile when real execution would cost ≥500 ms
- Requires building the transition trajectory dataset (target: 8,000 examples per DSWorld methodology)

**Neutral:**
- Does not affect single-tool tasks or tasks routed to Tier-1 codemoods
- Measured Flash Attention and MCP latency benchmarks must be established before world-model speedup is claimed publicly

---

## Implementation Plan

1. **Sprint 1 (2 weeks):** Build execution trace logger in `@claude-flow/hooks` post-task hook; store traces in AgentDB namespace `world-model-traces`
2. **Sprint 2 (2 weeks):** Build rules-based transition predictor using trace statistics; integrate with `hooks pre-task`
3. **Sprint 3 (3 weeks):** Fine-tune small LLM predictor on 8k traces; evaluate against rules-based baseline
4. **Sprint 4 (1 week):** Benchmark Ruflo MCP latency + Flash Attention; publish Grade A numbers

---

## References

- arXiv:2607.15901 — DSWorld: A World Model Framework for Data Science Agents (2026)
- ADR-026 — 3-Tier Model Routing
- ADR-143 — Deterministic Codemod Routing
- Dream Cycle 2026-07-20 Issue — #TBD
