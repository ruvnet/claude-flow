# ADR-347: Trajectory-Quality JUDGE Scoring for ReasoningBank

- **Status**: Proposed
- **Authors**: claude (dream-cycle agent, 2026-06-17)
- **Date**: 2026-06-17
- **Supersedes**: none
- **Related**: ADR-006 (Unified Memory), ADR-017 (RuVector Integration), ADR-147 (Nested Subagent Depth)

---

## Context

Ruflo's SONA intelligence pipeline uses a 4-step RETRIEVE→JUDGE→DISTILL→CONSOLIDATE loop. The JUDGE step currently assigns binary verdicts: `success` or `failure` per trajectory step. This was sufficient when short-horizon tasks dominated agent workloads.

Two 2026 findings change that calculus:

1. **RetailBench** (arXiv:2606.15862, Grade A): All tested frontier models fail 180-day planning horizons; the strongest performers are "substantially below oracle policy". Binary pass/fail cannot distinguish an agent that fails on step 3 from one that fails on step 150 — both score 0.
2. **Benchmark contamination audit** (Berkeley RDI, 2026): Every major agent benchmark (SWE-bench, OSWorld, WebArena, GAIA, Terminal-Bench) is exploitable for +5–15pp inflation without solving tasks. Binary JUDGE verdicts derived from contaminated benchmarks propagate inflated confidence scores into ReasoningBank, which SONA then distils as valid patterns.

Additionally, Chronological Awareness scores (0.204–0.290 for frontier LLMs, mem0.ai State of AI Agent Memory 2026) reveal a systemic temporal reasoning weakness that binary verdicts cannot surface or train against.

---

## Decision

Replace the binary JUDGE verdict in ReasoningBank with a **5-dimension trajectory quality score** (TQS):

| Dimension | Range | Definition |
|---|---|---|
| `temporal_coherence` | 0.0–1.0 | Fraction of steps with correct chronological ordering of prior events |
| `tool_call_accuracy` | 0.0–1.0 | Ratio of tool calls that returned expected outputs vs. errors/retries |
| `horizon_persistence` | 0.0–1.0 | Step at which agent diverges from correct path / total steps attempted |
| `partial_progress_ratio` | 0.0–1.0 | Sub-goals completed / total sub-goals (even on failed trajectories) |
| `contradiction_resolution` | 0.0–1.0 | Fraction of conflicting-instruction episodes resolved without halt |

**Aggregate score**: `TQS = 0.25·temporal + 0.25·tool + 0.20·horizon + 0.20·partial + 0.10·contradiction`

TQS ≥ 0.80 = success, 0.40–0.79 = partial, < 0.40 = failure. The existing binary `success/failure` field is preserved for backward compatibility but computed from TQS threshold.

**Contamination guard**: ReasoningBank stores the benchmark scaffold hash alongside each trajectory. If the same scaffold hash recurs across ≥3 trajectories with identical tool call sequences, the JUDGE flags the run as potentially contaminated and down-weights the TQS by 0.5 before DISTILL.

---

## Consequences

**Positive**:
- Long-horizon agents get meaningful gradient signal: a partial-progress ratio of 0.6 on a 180-day task is informative; binary 0 is not.
- EWC++ receives temporal_coherence as a distinct weight dimension, enabling targeted anti-forgetting for time-aware capabilities.
- Contamination guard prevents inflated benchmarks from poisoning ReasoningBank patterns.

**Negative**:
- TQS computation adds ~2ms per trajectory evaluation (5 dimension calculations vs. 1 binary check). Acceptable given SONA's measured 0.0043ms/adapt budget is for adaptation, not JUDGE.
- `partial_progress_ratio` requires sub-goal decomposition at task ingestion — tasks without explicit sub-goals default to `0.5` (neutral) until decomposed.
- Breaking change in ReasoningBank schema: `verdict: "success"|"failure"` becomes `verdict: { tqs: number, dimensions: {...}, binary: "success"|"partial"|"failure" }`. Migration required for existing stored trajectories (default: set `tqs=1.0` for historical `success`, `tqs=0.0` for historical `failure`).

**Neutral**:
- Does not affect MoE gate routing (which consumes distilled patterns, not raw verdicts).
- Does not affect HNSW indexing (patterns stored post-DISTILL, schema-agnostic).

---

## Implementation Sketch

```typescript
// v3/@claude-flow/memory/src/reasoningbank/judge.ts
interface TrajectoryQualityScore {
  temporal_coherence: number;  // 0.0-1.0
  tool_call_accuracy: number;
  horizon_persistence: number;
  partial_progress_ratio: number;
  contradiction_resolution: number;
  aggregate: number;           // weighted sum
  binary: 'success' | 'partial' | 'failure';
  contamination_flag: boolean;
  scaffold_hash?: string;
}

function judgeTrajectory(steps: TrajectoryStep[]): TrajectoryQualityScore {
  // compute 5 dimensions then aggregate
}
```

Files affected:
- `v3/@claude-flow/memory/src/reasoningbank/judge.ts` (new TQS logic)
- `v3/@claude-flow/memory/src/reasoningbank/types.ts` (schema update)
- `v3/@claude-flow/memory/src/reasoningbank/migrate.ts` (historical default migration)
- `v3/@claude-flow/hooks/src/workers/ultralearn.ts` (consume TQS dimensions)

---

## Alternatives Considered

1. **Reward shaping only** (no schema change): Add step-level reward signal to EWC++ without changing JUDGE. Rejected — contamination guard requires scaffold hash tracking, which mandates a schema change anyway.
2. **External eval harness** (separate from ReasoningBank): Run TQS offline, store separately. Rejected — splits the RETRIEVE→JUDGE loop, breaking the 4-step pipeline's coherence.
3. **Keep binary, add temporal micro-eval**: Run a 5-event ordering test post-DISTILL and feed only temporal scores. Rejected — addresses only one of the three identified gaps (RetailBench long-horizon, contamination, chronological awareness).
