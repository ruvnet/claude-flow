# ADR-179: Dynamic Harness Cost Governor for Per-Task Token Budget Management

**Status**: Proposed  
**Authors**: claude (dream-cycle agent, 2026-07-12)  
**References**: arXiv:2607.06906 "The Harness Effect", arXiv:2607.07729 "Collective Intelligence with Foundation Models", ADR-026 (3-tier routing), ADR-143 (codemod tier)  

---

## Context

ADR-026 and ADR-143 established static 3-tier model routing (Haiku/Sonnet/Opus + deterministic codemod) based on task complexity thresholds. This architecture selects the right *model* for a task but does not control *how the orchestration layer uses tokens once a model is chosen*.

arXiv:2607.06906 ("The Harness Effect", July 2026) demonstrates across 6 foundation models (Claude Sonnet 4.6, Gemini 3.1, Gemini Flash 3.5, Qwen 3.6, GLM 5.1, Palmyra X6) that orchestration design — context window sizing, turn sequencing, and tool-call batching — reduces:

- Blended cost per task: **41%** ($0.21 → $0.12)
- Median latency: **44%** (48 s → 27 s)
- Tokens per task: **38%** (14.2k → 8.8k)
- Quality: maintained (0.78 → 0.81)

Every tested model showed 33–61% cost reduction from orchestration design alone. The gains are **orthogonal to model tier** — a well-orchestrated Haiku call outperforms a wastefully orchestrated Opus call on cost-normalized quality.

Additionally, arXiv:2607.07729 shows 2.3× accuracy gain from heterogeneous agent configurations (solver + critic + aggregator) over homogeneous setups, and arXiv:2604.22452 shows that shallow interaction depth (rarely > 1 reply) is the primary bottleneck limiting collective intelligence.

Ruflo currently lacks: (1) per-task token budget tracking, (2) dynamic context trimming, (3) turn-sequencing optimization, (4) cost-outcome telemetry for MoE gate feedback.

---

## Decision

Implement a **Dynamic Harness Cost Governor (DHCG)** as a new module `v3/@claude-flow/hooks/src/cost-governor.ts` that intercepts every agent invocation and enforces per-task token budgets.

### Component Design

```typescript
interface HarnessBudget {
  taskId: string;
  tierAssigned: 'codemod' | 'haiku' | 'sonnet' | 'opus';
  maxContextTokens: number;     // derived from tier + task complexity score
  maxTurnCount: number;         // derived from task type
  spentTokens: number;          // tracked live
  costCents: number;            // running cost in cents
  qualityScore?: number;        // set on completion
}

interface CostGovernorConfig {
  contextTrimAgeLimitTurns: number;   // default: 3 — trim memory entries older than N turns
  toolCallBatchWindow: number;        // default: 500ms — coalesce sequential tool calls
  feedbackToMoEGate: boolean;         // default: true — update MoE routing weights on close
  hardCeilingMultiplier: number;      // default: 1.5 — hard stop at N× planned budget
}
```

### Orchestration Rules (from Harness Effect)

1. **Context trim**: Before each agent turn, remove from context window any memory entries older than `contextTrimAgeLimitTurns` whose retrieval score < 0.4.
2. **Tool batching**: Coalesce sequential tool calls within a 500 ms window into a single round-trip.
3. **Turn ceiling**: Fail-safe at `maxTurnCount * hardCeilingMultiplier`; escalate to next tier rather than loop.
4. **Cost tracking**: Emit `harness:cost-event` on every token consumption; accumulate in `HarnessBudget`.
5. **MoE feedback**: On task close, send `(tier, cost_cents, quality_score, task_type)` to the MoE gate to update routing weights.

### Heterogeneous Diversity Enforcement

Modify `swarm_init` to reject configurations where ≥ 80% of spawned agents share the same `subagent_type`. Emit `diversity_score` (unique types / total agents) in swarm telemetry. Minimum 2 distinct specializations per swarm ≥ 3 agents.

---

## Consequences

**Positive:**
- Estimated 30–40% token reduction per task (conservative re-estimate of Harness Effect baseline)
- Closed-loop improvement: MoE gate learns from cost-outcome pairs → tier accuracy improves over sessions
- Diversity enforcement prevents homogeneous-swarm accuracy collapse (2.3× heterogeneous gap)
- Cost telemetry enables `metallm_ask` vs `metallm_delegate` ROI tracking

**Negative:**
- Context trimming may drop relevant memory entries if `contextTrimAgeLimitTurns` is set too aggressively; needs tuning
- Tool-call batching adds 500ms latency floor for rapid sequential tools in low-latency tasks
- Adds governance layer to every agent invocation (~0.5ms overhead estimated)

**Neutral:**
- Requires `harness:cost-event` wire protocol; breaking change for external DHCG consumers (none known)
- ADR-026 and ADR-143 routing logic unchanged; DHCG is additive, not a replacement

---

## Implementation Path

1. `v3/@claude-flow/hooks/src/cost-governor.ts` — DHCG core (budget tracking, context trim, tool batching)
2. `v3/@claude-flow/hooks/src/workers/cost-reporter.ts` — background worker emitting cost-event to MoE
3. `v3/@claude-flow/cli/src/swarm/init.ts` — add diversity-check gate on swarm init
4. `v3/@claude-flow/memory/src/schema.ts` — add `retrieval_score` column to `vector_indexes` table
5. Tests: `tests/cost-governor.test.ts` with mock 6-model fixture matching Harness Effect setup

**ADR collision note**: Three prior unmerged dream-cycle branches (2026-07-09-swarm, 2026-07-10-performance, 2026-07-11-security) also claim ADR-179 against main. Human reviewer must renumber on merge — recommend tonight's ADR become ADR-182 if all three prior branches merge first.
