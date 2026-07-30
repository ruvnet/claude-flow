# ADR-376: Heterogeneous Agent Ensemble Composition API

| Field | Value |
|-------|-------|
| Status | Proposed |
| Date | 2026-07-27 |
| Authors | claude (dream-cycle agent, 2026-07-27) |
| References | PoTRE (arXiv 2607.x, Kankariya & Arık); PRO-LONG (arXiv 2607.x, Fox et al.); Dream Cycle #2784 |

---

## Context

2026 agent-intelligence SOTA is defined by **heterogeneous multi-agent ensembles**. PoTRE (Poly-Topological Reasoning Ensembles) achieves 49.92% on Humanity's Last Exam by composing 4 agents with distinct reasoning strategies (adversarial refinement, hierarchical planning, spectrum search, direct chain) and a task-adaptive aggregation layer. This is grade-A reproduced (peer-reviewed arXiv 2607.x).

Ruflo currently supports homogeneous swarm topologies (`hierarchical`, `mesh`, `hierarchical-mesh`, `adaptive`) but provides no API for composing agents with **different reasoning strategies within a single swarm**. All agents in a Ruflo swarm share the same type/prompt template; topology controls communication pattern, not reasoning diversity.

Every major competitor (LangGraph v1.2.x, Microsoft Agent Framework 1.0, CrewAI v1.14.x) also lacks heterogeneous ensemble composition — making this an **opportunity for differentiation** at the coordination layer, not just a catch-up move.

---

## Decision

Add a `heterogeneous` topology mode to the Ruflo swarm system that:

1. Accepts a list of `{ strategy, agentType, weight }` slots at swarm initialization
2. Assigns each slot a distinct reasoning prompt template (adversarial, hierarchical, spectrum-search, direct-chain) with no shared base prompt
3. After each task round, runs a **task-adaptive aggregation** step (weighted voting, configurable: majority / weighted / llm-judge) that synthesizes slot outputs into a single response
4. Records per-slot contribution scores in AgentDB for SONA-driven weight adjustment across rounds (leveraging existing EWC++ to prevent weight collapse)
5. Exposes CLI: `npx ruflo swarm init --topology heterogeneous --slots adversarial,hierarchical,spectrum,chain --aggregation weighted`

---

## Consequences

**Positive:**
- Enables PoTRE-class reasoning diversity within a single `ruflo swarm` invocation
- Reuses existing SONA, MoE, EWC++ infrastructure — no new learning subsystems required
- Opens a benchmark path: wire HumanityLastExam into `ruflo performance benchmark --suite intelligence` to measure parity with 49.92% PoTRE baseline

**Negative / Risks:**
- Aggregation step adds latency (~1 LLM call per round); must be async and time-boxed
- Per-slot prompt isolation complicates the existing `shared memory namespace` pattern — slots write to sub-namespaces, aggregator reads across them
- 4 concurrent agents per swarm round increases token cost ~4× vs single-agent baseline; must be documented in cost warnings

**Not covered by this ADR (implementation-level):**
- PRO-LONG programmatic memory log compression (separate feature, does not require new topology)
- Intelligence benchmark suite wiring (tracked in performance module roadmap)

---

## Alternatives Considered

- **Parameter-sweep homogeneous ensemble**: vary temperature/top-p across identical agents. Rejected — diversity of reasoning strategy (not just sampling) is what drives PoTRE gains.
- **Separate CLI command `ruflo ensemble`**: Rejected — heterogeneous is a topology variant; keeping it under `swarm` preserves the unified coordination model.
- **No change**: Accepted cost is falling behind as heterogeneous ensembles become the 2026 default for reasoning benchmarks.
