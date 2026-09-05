# ADR-381: Task-Driven Swarm Topology Auto-Generation via PSO

- **Status:** Proposed
- **Authors:** claude (dream-cycle agent, 2026-08-09)
- **Dream Cycle Issue:** TBD (filed same night)
- **Evidence Grade:** A (arXiv 2506.15672, TravelPlanner +261.8% vs ADAS; arXiv 2505.04364, SwarmBench)

---

## Context

Ruflo's `swarm init` requires users to explicitly choose a topology (`hierarchical`, `mesh`, `adaptive`, `hybrid`) and manually specify agent roles. This is deliberately conservative (anti-drift mandate, CLAUDE.md §Swarm Configuration) and correct for coordination stability. However, research demonstrates a clear 2026 gap:

**SwarmAgentic** (arXiv 2506.15672, code released) introduces Particle Swarm Optimization-inspired automated generation of agent roles, communication structure, and coordination protocols from a plain-language task description — no prior topology selection required. Benchmark: **+261.8% on TravelPlanner vs ADAS** (Grade A, 2026 paper with released code). Key capabilities absent in all four major competitors (LangGraph, AutoGen, CrewAI, OpenAI Agents SDK):

- **From-scratch generation**: agent count, roles, and communication edges derived from task spec
- **Self-optimization**: candidate swarm topologies evolved via feedback-guided PSO iterations
- **Joint optimization**: agent specialization and collaboration topology co-evolved

**ADR-348** (Proposed, 2026-06-19) addressed *selecting among existing topology types* (parallel/sequential/hierarchical/hybrid) given a task dependency graph. This ADR addresses the orthogonal problem: *generating agent roles and the topology graph itself* when no dependency graph exists and no roles have been pre-assigned. The two compose: ADR-348's selector can run as a refinement stage after ADR-381's generator.

**SwarmBench** (arXiv 2505.04364, OpenReview GAVA5zqtVB, Grade A) provides the evaluation harness needed to measure whether auto-generated topologies actually coordinate effectively — currently Ruflo has no such benchmark.

---

## Decision

Add a **swarm auto-generation** mode to `@claude-flow/swarm` that:

1. Accepts a plain-language task description (or structured task graph)
2. Generates a candidate pool of swarm configurations (agent count, role assignments, communication edges)
3. Iteratively evolves the pool using PSO-inspired feedback (task performance → fitness → parameter update)
4. Emits the best configuration as a standard `swarm init` call

Expose via CLI:
```bash
npx claude-flow@latest swarm init --auto-topology --task "Analyze the authentication module for security vulnerabilities and propose fixes"
# → generates roles: [security-auditor, researcher, coder, tester] + hierarchical topology
```

### Implementation outline

```
@claude-flow/swarm/src/auto-generator/
  ├── task-parser.ts       # Extract task properties (complexity, parallelism, domain)
  ├── role-synthesizer.ts  # Map task properties → candidate agent roles
  ├── pso-evolver.ts       # PSO candidate pool: position=config vector, fitness=task score
  └── index.ts             # Auto-generator API: generateTopology(taskSpec) → TopologyConfig
```

The PSO evolver uses a **dry-run fitness proxy** (task LLM-score without executing the full task) to evaluate candidates cheaply. Full execution is only done on the top-1 candidate.

### Anti-drift constraint

Manual topology selection (`hierarchical` default) remains unchanged and is the anti-drift safe path. `--auto-topology` is opt-in and adds a gate: if PSO fitness score < 0.7 after N iterations, fall back to `hierarchical` automatically.

---

## Consequences

**Positive:**
- Closes the SwarmAgentic gap without requiring users to understand topology theory
- Enables self-improving swarm configurations as task patterns are learned
- Benchmark harness (SwarmBench port) provides regression tracking

**Negative:**
- PSO evaluation adds latency (~2-5 dry-run iterations before first real agent spawn)
- Fitness proxy accuracy depends on LLM quality — wrong proxy → wrong topology
- Increases `@claude-flow/swarm` surface area; requires careful isolation from core

**Mitigations:**
- Gate behind `--auto-topology` flag (no change to default path)
- Cap PSO iterations at 3 for interactive use (`--fast-auto-topology`)
- Persist winning configurations to memory for reuse on similar tasks

---

## Related

- ADR-348: Task-Adaptive Swarm Topology Selector (static selection, complementary)
- arXiv 2506.15672: SwarmAgentic — PSO-driven from-scratch agentic system generation
- arXiv 2505.04364: SwarmBench — 5-task coordination benchmark for LLM swarms
- arXiv 2504.00587: AgentNet — real-time DAG topology adaptation
- `v3/@claude-flow/swarm/src/topology-manager.ts`: existing topology management (extension point)
