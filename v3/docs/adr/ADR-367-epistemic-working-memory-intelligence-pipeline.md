# ADR-367: Epistemic Working Memory in the Intelligence Pipeline

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Authors** | claude (dream-cycle agent, 2026-07-17) |
| **Dream Cycle Issue** | Filed 2026-07-17, deep surface: intelligence |
| **Supersedes** | None |
| **Related** | ADR-026 (3-tier routing), ADR-006 (Unified Memory Service), ADR-009 (Hybrid Memory Backend) |

---

## Context

Two July 2026 papers reveal actionable gaps in Ruflo's intelligence pipeline:

**SLEUTH (arXiv:2607.12267, Ning Liu, Jul 2026, grade A):** Introduces a structured *epistemic working memory* with three named lists per reasoning task — `confirmedFacts`, `activeHypotheses`, `openQuestions` — maintained across reasoning steps. Result: +11 points on multi-hop benchmarks. Ruflo's AgentDB stores long-term embeddings but has no per-task structured epistemic buffer.

**GRADE (arXiv:2607.10836, Ghosh & Chakraborty, Jul 2026, grade A):** Hierarchical multi-agent routing with *gated depth control* — learned gates govern agent selection, hierarchy depth, inter-agent communication, and branch pruning via collaborative policy optimization. Result: 44% less inference runtime vs mixture-of-agents baseline, 8.15% accuracy gain. Ruflo's SONA MoE gates token routing across 8 experts but does not gate agent-selection depth or prune reasoning branches.

Additionally, ArXiv:2607.13034 shows that a *Cognitive Redundancy Ratio (CRR)* gate can reduce cost by 85% on simple tasks by estimating minimum-sufficient execution scope before routing.

The existing intelligence pipeline (RETRIEVE → JUDGE → DISTILL → CONSOLIDATE) has no per-task working memory layer and no branch-level gate.

---

## Decision

Add an **EpistemicWorkingMemory (EWM)** layer to the intelligence pipeline, inserted between RETRIEVE and JUDGE:

```
RETRIEVE → [EWM] → JUDGE → DISTILL → CONSOLIDATE
```

### EWM Schema (per task)

```typescript
interface EpistemicWorkingMemory {
  taskId: string;
  confirmedFacts: string[];      // facts verified during this task
  activeHypotheses: string[];    // hypotheses being tested
  openQuestions: string[];       // unresolved sub-questions
  stepCount: number;
  createdAt: number;
  flushedAt?: number;
}
```

At each intelligence step, the agent appends to the appropriate list. At task completion, EWM is flushed: a summary is written to AgentDB (long-term) and the in-memory buffer is released.

### CRR Pre-Routing Gate

Before task routing, compute:

```
CRR = (estimated_unique_reasoning_steps) / (total_input_tokens / 500)
```

If `CRR < 0.3` → route to Haiku with scope-bounded system prompt suffix.
If `CRR ≥ 0.3` → standard 3-tier routing (ADR-026).

### Agent-Selection Depth Gate (GRADE-inspired)

Extend swarm coordinator to emit a `depthBudget` per task (default 3). Agents that exhaust their depth budget without resolution escalate to the next tier rather than continuing horizontally. This limits runaway agent fan-out on hard tasks and prunes solved branches early on easy tasks.

---

## Implementation Scope

| Component | File | Change |
|-----------|------|--------|
| EWM type + in-memory store | `v3/@claude-flow/memory/src/epistemic/EpistemicWorkingMemory.ts` | **new** |
| EWM flush → AgentDB | `v3/@claude-flow/memory/src/epistemic/ewm-flush.ts` | **new** |
| Pipeline hook | `v3/@claude-flow/hooks/src/intelligence.ts` | insert EWM step |
| CRR pre-routing gate | `v3/@claude-flow/hooks/src/route.ts` | add CRR computation |
| Agent depth gate | `v3/@claude-flow/cli/src/swarm/coordinator.ts` | add `depthBudget` |
| EWM schema export | `v3/@claude-flow/memory/src/index.ts` | export new types |

---

## Consequences

**Positive:**
- Expected +8-11 points on multi-hop reasoning (grade-A baseline, arXiv:2607.12267)
- Expected 44% runtime reduction on complex multi-agent tasks via depth gating
- Expected 60-85% cost reduction on simple tasks via CRR gate (grade-A baseline, arXiv:2607.13034)
- Competitive with LangGraph's HITL checkpoints and AG2 Beta's typed tools

**Negative:**
- EWM adds ~3-12 KB of in-memory state per concurrent task; at 100 concurrent tasks, ~1.2 MB overhead
- CRR threshold (0.3) requires calibration against real task distribution
- GRADE's collaborative policy optimization requires offline training — depth gate here uses a simpler heuristic (no policy gradient), so gains may be partial

**Neutral:**
- EWM flush to AgentDB is async; tasks complete without waiting for flush
- Existing ADR-026 3-tier routing is preserved; CRR gate is a pre-filter, not a replacement

---

## Alternatives Considered

1. **No EWM, extend AgentDB session scope** — Cheaper but doesn't expose structured fact/hypothesis/question lists to the agent, so the +11 pt gain is unlikely.
2. **Full GRADE collaborative policy optimization** — Higher ceiling but requires training data; deferred to a future ADR.
3. **RAG-only** — Already implemented; SLEUTH shows structured EWM is orthogonal and additive to retrieval.

---

## Validation

Run `npx claude-flow@v3alpha performance benchmark --suite multi-hop` before and after EWM integration. Gate merge on ≥5 pt improvement on an internal multi-hop eval set. Evaluate CRR gate savings by comparing cost per task on the existing regression test suite.
