# ADR-181: AutoMem-Style RL Training Loop for AgentDB Memory Operations

**Status:** Proposed
**Date:** 2026-07-03
**Authors:** claude (dream-cycle agent, 2026-07-03)
**Source:** Dream Cycle research — Issue #[TBD], arXiv 2607.01224 (AutoMem)
**Tracking:** [Dream Cycle 2026-07-03] memory deep-dive

---

## Context

AutoMem (Wu et al., arXiv 2607.01224, July 1 2026) demonstrates that memory management is an **independently learnable RL skill**: treating memory operations (store, retrieve, update, summarize, discard) as first-class RL actions and training a dedicated memory-specialist agent from its own episode traces yields 2x–4x improvement on long-horizon tasks (Crafter, MiniHack, NetHack), bringing a 32B open-weight model to frontier-competitive performance without changing the task policy at all.

Ruflo's AgentDB currently provides:
- HNSW-indexed vector retrieval (measured ~1.9x–4.7x vs brute force at N=5k–20k)
- SONA adaptation (0.0043ms/adapt) for neural weight tuning
- EWC++ for forgetting prevention
- A `consolidate` background worker (heuristic scheduling, no trajectory feedback)

None of these train the **management strategy** itself — *which* facts to store, *when* to discard, *how* to structure retrieval keys. SONA adapts weights; it does not optimize the memory scaffold or proficiency. The consolidate worker fires on a timer, not on outcome signals.

This is the single highest-leverage unimplemented memory optimization identified in the July 2026 SOTA sweep.

---

## Decision

Add an **AutoMem-compatible two-phase RL training loop** to AgentDB:

### Phase 1 — Memory Scaffold Optimizer (`memory-scaffold-optimizer`)

A meta-LLM loop that iteratively refines *how* AgentDB is used:
- Inputs: agent task trajectories + outcome signals from `hooks_post-task`
- Outputs: updated memory prompts (what to write, key schema) stored as `scaffold-vN` in the `memory-config` namespace
- Trigger: after every N completed trajectories (default N=10), or on explicit `npx ruflo memory optimize-scaffold`
- Backed by the existing `hooks_intelligence_trajectory-start/-step/-end` pipeline (ADR-074)

### Phase 2 — Memory Proficiency Trainer (`memory-specialist` agent)

A dedicated background agent trained from successful episodes:
- Identifies high-value memory decisions (writes that led to correct retrieval + task success) vs low-value ones (writes never retrieved, or retrieved but task failed)
- Generates GRPO-style reward signals: `+1` per retrieved fact that contributed to success, `-1` per write that went unretrieved or preceded failure
- Updates the `memory-specialist` LoRA adapter (reusing existing `ContrastiveTrainer` from ADR-086)
- Exposes results via `npx ruflo memory proficiency-status`

### Bounded Memory Contract (companion)

Per AgenticSTS (arXiv Jul 2 2026): add a `MemoryContract` option to AgentDB that enforces typed retrieval (`semantic_search`, `key_lookup`) as the only access path, blocking raw transcript appending beyond a configurable token budget (default: 2048 tokens/session). This prevents ghost-memory accumulation (A-TMA finding) and bounds context growth.

---

## Implementation Scope

| Component | Change | Risk |
|---|---|---|
| `@claude-flow/memory` | Add `scaffold-optimizer.ts` + `proficiency-trainer.ts` | Medium |
| `@claude-flow/hooks` | Wire `post-task` hook to emit trajectory reward signal | Low |
| `@claude-flow/cli` | Add `memory optimize-scaffold`, `memory proficiency-status` subcommands | Low |
| AgentDB | Add `scaffold-vN` namespace, reward-signal schema | Low |
| `ContrastiveTrainer` (ADR-086) | Extend to accept memory-op triplets | Low |

Files to keep under 500 lines each. No changes to task-policy paths.

---

## Consequences

**Positive:**
- Closes the single largest gap vs AutoMem SOTA (2x–4x long-horizon improvement potential)
- Reuses existing trajectory pipeline (ADR-074) and ContrastiveTrainer (ADR-086) — minimal new infrastructure
- Measurable: benchmark against `@claude-flow/performance benchmark --suite memory-long-horizon` before/after

**Negative / Risks:**
- Reward signal quality depends on trajectory completeness; tasks without explicit success signals produce noisy rewards
- Phase 2 training adds ~50–200ms per post-task hook call (must be async/non-blocking)
- Over-optimized scaffold may overfit to a task distribution — need periodic scaffold reset option

**Not in scope:**
- LongMemEval harness integration (separate issue — competitive benchmarking)
- Pluggable memory backends (separate ADR, triggered by CrewAI v1.14.7 competitive signal)

---

## Alternatives Considered

1. **Heuristic consolidation tuning** — improve existing `consolidate` worker scheduling. Rejected: doesn't learn from outcomes, still heuristic.
2. **External memory library (Mem0, Zep)** — swap AgentDB for a dedicated memory service. Rejected: removes HNSW+SONA integration, architectural regression.
3. **Manual memory scaffold authoring** — let users configure prompts. Rejected: doesn't scale, doesn't learn.

---

## References

- AutoMem: https://arxiv.org/abs/2607.01224
- AgenticSTS: arXiv Jul 2 2026 (bounded memory contract)
- A-TMA: arXiv Jul 2 2026 (ghost memory / validity annotations)
- ADR-074: Self-Learning Wiring (`hooks_intelligence_trajectory-start/-step/-end`)
- ADR-086: ruvllm as Intelligence Coordinator (`ContrastiveTrainer`)
