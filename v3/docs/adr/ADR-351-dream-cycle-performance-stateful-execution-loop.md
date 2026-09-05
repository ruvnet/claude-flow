# ADR-351: Stateful Execution Loop with KV-Cache Discipline and Agent Execution Graphs

**Status**: Proposed  
**Authors**: claude (dream-cycle agent, 2026-06-25)  
**Dream Cycle Issue**: #2462 (2026-06-25 nightly research)  
**Surfaces**: performance (DEEP), security + hive-mind (SCAN)

---

## Context

June 2026 arXiv research (five Grade A papers) demonstrates that multi-agent orchestration frameworks leave 2–4× performance on the table by not enforcing KV-cache discipline, not scheduling tasks by dependency graph, and not applying response-level speculative routing.

Key findings:
- **Stateful Inference** (arXiv:2605.26289): O(n_t)→O(Δ_t) KV-cache persistence → 4.2× speedup on 35-turn agent workflows (Grade A)
- **PolyKV** (arXiv:2604.24971): shared compressed KV pool for concurrent agents → 97.7% memory reduction, 15 agents (Grade A)
- **SAGA** (arXiv:2605.00528): workflow-atomic scheduling via Agent Execution Graphs → 1.64× task completion vs vLLM (Grade A)
- **RLM-Cascade** (arXiv:2606.22840): response-level speculative decoding → 45.8% API cost reduction (Grade A)

Ruflo currently:
1. Passes full context on every agent turn (O(n_t) cost growth)
2. Mutates prompts between turns, breaking provider-side prefix caching
3. Schedules all tasks FIFO without exploiting task dependency graphs
4. Routes all agent calls to the same model tier regardless of response predictability

No competitor (LangGraph 1.2.6, AutoGen 0.7.5, CrewAI 1.14.7, OpenAI Agents SDK) has shipped any of these mechanisms.

---

## Decision

Implement three layered optimizations in the order of implementation cost vs. impact:

### Layer 1: Prefix-Stable Prompt Discipline (low cost, 2–4× impact)
Enforce a structural rule in agent construction: the system prompt and static context form a **fixed prefix** that is never mutated between turns. Only the dynamic message tail changes. This enables provider-side KV-cache reuse (Claude's prompt caching) without any infrastructure change.

**Where**: `v3/@claude-flow/cli/src/agents/agent-executor.ts` — add `staticPrefix` / `dynamicSuffix` split to the agent message builder.

### Layer 2: Agent Execution Graph Scheduler (medium cost, 1.6× impact)
Expose `dependsOn: string[]` in `SwarmTaskConfig`. Before dispatching a swarm, topological-sort tasks and run independent tasks concurrently. This replaces the implicit FIFO sequencing.

**Where**: `v3/@claude-flow/cli/src/swarm/scheduler.ts` (new file under 200 lines).

### Layer 3: Response-Level Speculative Routing (medium cost, 40–50% cost impact)
Add a `pre-agent-call` hook that routes low-complexity tool-call sequences through a draft model (Haiku), verifies with the primary model only on mismatch. Use the existing 3-tier model routing table from ADR-026.

**Where**: `v3/@claude-flow/hooks/src/workers/speculative-router.ts` (new worker).

---

## Consequences

**Positive**:
- 2–4× token/cost reduction per long-running agent (Layer 1 alone)
- 1.6× swarm throughput without model changes (Layer 2)
- 40–50% API cost reduction on tool-heavy swarms (Layer 3)
- No breaking API changes for users

**Negative / Risks**:
- Layer 1 requires audit of all agent prompt builders to enforce prefix stability
- Layer 3 introduces draft-model latency overhead when verification triggers
- SAGA results are on GPU-serving (vLLM), not API-serving; Layer 2 gains may be lower in API-gated deployments

**Non-decisions**: KV-cache pooling (PolyKV pattern) is not applicable to API-based deployments; deferred until a self-hosted inference path exists.

---

## Implementation Notes

- Layer 1 target: `agent-executor.ts` — 1–2 days
- Layer 2 target: new `scheduler.ts` in swarm package — 3–5 days
- Layer 3 target: new `speculative-router.ts` worker — 3–5 days
- Verification: benchmark with an 8-agent swarm on a fixed task; measure token count and wall-clock time before/after each layer
