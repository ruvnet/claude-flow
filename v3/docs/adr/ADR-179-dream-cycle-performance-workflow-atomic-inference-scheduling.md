# ADR-179: Workflow-Atomic Inference Scheduling (WAIS) for Multi-Agent Execution

**Status**: Proposed
**Authors**: claude (dream-cycle agent, 2026-07-10)
**References**: arXiv:2605.00528 (SAGA), arXiv:2604.26963 (MARS), arXiv:2603.13110 (AgentRM), arXiv:2605.26289 (Stateful Inference), arXiv:2602.01053 (LRAgent, ICML 2026)

---

## Context

The 2026 inference-systems literature has converged on a finding that directly impacts Ruflo's multi-agent execution layer: **optimising individual LLM requests is suboptimal when the requests form a workflow DAG**. Three independent preprints and one ICML-accepted paper all demonstrate that workflow-level scheduling — treating a workflow as a scheduling atom — delivers 1.6×–5.9× latency improvements over request-level scheduling:

1. **SAGA (arXiv:2605.00528)**: Workflow-Atomic Scheduling for AI Agent Inference achieves 1.64× geometric-mean task completion time improvement and 99.2% SLO attainment under multi-tenant interference vs vLLM v0.15.1. The key insight: cross-workflow head-of-line blocking is eliminated by promoting the workflow to the primary scheduling unit.

2. **MARS (arXiv:2604.26963)**: GPU-CPU co-scheduling reduces end-to-end agent latency by 5.94× and task completion by 1.87× with OpenHands. Agent workflows span both GPU (LLM inference) and CPU (tool execution, orchestration), but existing schedulers treat only GPU demand. Unified scheduling captures cross-device dependencies.

3. **AgentRM (arXiv:2603.13110)**: An OS-inspired MLFQ scheduler for LLM agent systems reduces P95 latency by 86% and increases throughput by 168%. It also identifies "zombie agents" — stuck agents blocking resources silently — as a production pathology. A Context Lifecycle Manager compresses zombie context before eviction, preserving 100% of key information.

4. **Stateful Inference (arXiv:2605.26289)**: Converting per-turn inference from O(n_t) (re-process entire conversation) to O(Δ_t) (delta-only on new tokens) delivers 2.1× speedup on 6-turn agentic workflows and 4.2× on the median turn of 35-turn workflows. 85–95% of the prompt is unchanged between tool calls.

Additionally, **LRAgent (arXiv:2602.01053, ICML 2026)** demonstrates that when swarm agents use different specialisations (LoRA adapters), a decomposed per-adapter KV cache achieves near-shared throughput while preserving per-adapter accuracy — relevant to Ruflo's specialised agent types.

**Current Ruflo state**: Task orchestration dispatches each MCP tool call as an independent request. There is no workflow-level scheduler, no zombie-agent watchdog, and no stateful inference layer. Context re-processing cost grows linearly with conversation length.

**Competitor survey**: None of LangGraph, AutoGen, CrewAI, or OpenAI Agents SDK ship a workflow-atomic scheduler as of July 2026. First-mover opportunity is present.

---

## Decision

Implement **Workflow-Atomic Inference Scheduling (WAIS)** across three components:

### Component A: WorkflowScheduler (SAGA pattern)

Add `WorkflowScheduler` to `v3/@claude-flow/hooks/src/workers/` as the 13th background worker (priority: high). At `pre-task` hook time:
- Register each incoming task with its workflow DAG ID (from `swarm_init` topology)
- Compute critical path length across pending tasks in the same workflow
- Dispatch requests in critical-path order, holding non-critical tasks until GPU headroom exists
- SLO target: ≥99% of workflow completions within 2× critical-path lower bound

### Component B: ZombieWatchdog (AgentRM pattern)

Add `ZombieWatchdog` to `v3/@claude-flow/cli/src/agent/lifecycle.ts`:
- Per-agent liveness timer (default: `agentTimeoutMs` from config, fallback 120 000 ms)
- On timeout: call `consolidate` worker with `mode: 'emergency'` — compress to key-info before eviction (100% retention target, same as AgentRM MLFQ)
- Emit `agent:zombie-evicted` event for observability
- No silent resource leak: every eviction must produce a summary record in AgentDB

### Component C: Stateful Inference Spike (Norgren pattern)

Open a 2-week implementation spike (GitHub issue, separate from this ADR):
- Investigate vLLM/SGLang stateful KV persistence across sequential MCP tool calls
- Prototype: single-conversation persistent KV cache that advances by Δ_t on each tool call
- Gate: if prototype achieves ≥2× turn latency reduction on `benchmark --suite tool-call-latency`, promote to production integration

---

## Consequences

### Positive
- WorkflowScheduler eliminates head-of-line blocking across concurrent agent swarms — directly improves `benchmark --suite task-completion` target
- ZombieWatchdog prevents the silent resource leak pattern observed in production (long-running swarms accumulating stuck agents)
- Stateful inference spike, if successful, delivers 2.1–4.2× per-turn latency gains for no model changes

### Negative
- WorkflowScheduler requires workflow DAG ID to be propagated at task spawn time — breaking change for code that spawns tasks without a swarm context
- ZombieWatchdog introduces a new config key (`agentTimeoutMs`) that must be documented and have sane defaults; misconfiguration can prematurely evict agents on slow tasks
- Stateful inference integration depends on vLLM/SGLang version compatibility — infrastructure dependency risk

### Neutral
- No changes to model routing (ADR-026/ADR-143)
- No changes to AgentDB schema (HNSW indexes unchanged)
- LRAgent decomposed-KV-cache pattern deferred: requires LoRA adapter infrastructure not yet present in Ruflo

---

## Benchmark Gates

Before merging any implementation PR against this ADR:

| Gate | Target | Tool |
|------|--------|------|
| Task completion time | ≥1.5× improvement on `benchmark --suite task-completion` | `npx claude-flow@latest performance benchmark --suite task-completion` |
| Zombie eviction | Zero silent resource leaks over 1000-task soak test | `npx claude-flow@latest performance benchmark --suite agent-soak` |
| Stateful inference spike | ≥2× turn latency on tool-call bench (if spike promoted) | `npx claude-flow@latest performance benchmark --suite tool-call-latency` |

---

## Prior Art in This Repository

- ADR-026: 3-tier model routing (Haiku/Sonnet/Opus) — not modified by this ADR
- ADR-143: Tier-routing deterministic codemod layer — not modified
- ADR-174: Memory distillation self-optimisation — ZombieWatchdog's emergency-consolidate call reuses ADR-174 machinery
- ADR-176 (dream/2026-07-05-performance branch): SharedKVPoolManager (PolyKV) — orthogonal; both can coexist

---

*Generated by Ruflo Dream Cycle agent — do not self-merge. Leave for human review.*
