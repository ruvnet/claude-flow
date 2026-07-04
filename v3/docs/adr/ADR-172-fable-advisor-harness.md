# ADR-172: Fable Advisor Harness via `claude -p` (Cost-Disciplined Judge + Reflector)

**ID**: ADR-172
**Status**: Proposed — implemented on `feat/agenticow-integration` (ships in 3.21.0)
**Date**: 2026-07-04
**Authors**: rUv (drafted with Claude Code)
**Related ADRs**:
- ADR-171 (Provenance-tiered oracle — Tier-2 uses this harness as the judge)
- ADR-150 (MetaHarness — GEPA reflective-mutation is the optimization consumer)
- ADR-143 (Model routing / cost tiers — the cost discipline here is the same concern at a higher tier)

---

## 1. Context

Two SOTA loops want a frontier model *in the loop*, not just at the endpoints:
- **Distillation** (ADR-171 Tier 2): judge whether a cheap-model completion actually solved a task — a smarter labeler than structural confidence.
- **Optimization** (GEPA, ADR-150): GEPA's signature trick is natural-language failure diagnosis from execution traces feeding the *next* mutation — not a scalar fitness. metaharness_evolve mutates without it.

Both are the same primitive: a headless frontier-model advisor. Fable 5 (`claude-fable-5`) via `claude -p` provides it.

**The load-bearing constraint is cost.** Measured: a trivial `claude -p --model claude-fable-5` call from the project directory costs **$1.56** — it loads ruflo's CLAUDE.md context (56k cache-creation tokens). At a 100-trajectory corpus that is ~$150. Naive integration is unusable.

## 2. Decision

A single cost-disciplined `fable-harness.ts` service wrapping `claude -p`, with two entry points and three mandatory cost controls.

### 2.1 Cost controls (all required)
1. **Clean cwd** — spawn `claude -p` from a fresh empty temp directory so no project `CLAUDE.md` / settings load. Measured effect: $1.56 → **$0.34** (cache-creation 56k → 3.7k tokens).
2. **Batching** — N items per call (default 20). The per-call base amortizes to **~$0.02/item**.
3. **`--append-system-prompt` for the role + `--max-budget-usd` cap + `--output-format json`.** Opt-in, off by default.

Combined: $1.56/item naive → ~$0.02/item disciplined — the difference between a demo and a usable loop.

### 2.2 Entry points
- `judgeCompletions(items[]) → [{id, resolved, confidence, reason}]` — ADR-171 Tier 2. (Probe: correctly returned `resolved:true` for an applied patch, `false` for "I am not sure how to do this.")
- `reflectFailures(items[]) → [{failureClass, diagnosis, mutationHint}]` — GEPA reflective-mutation feed for evolve/optimization.

### 2.3 Safety
- No Fable call unless the caller explicitly opts in **and** passes a budget cap.
- ADR-150 graceful: no `claude` binary / budget exhausted / non-JSON reply → structured degraded result, never a throw.
- Tests **mock** `claude -p` (child_process) — CI never spends. One live smoke behind `RUFLO_FABLE_LIVE=1` for humans.

## 3. Consequences

- One harness serves both the distillation judge and the optimization reflector — the frontier-model-in-the-loop SOTA pattern, cost-bounded.
- Fable's judgment is Tier 2, never Tier 1 — an LLM judge is a smarter proxy, not ground truth, and cannot outrank real execution (ADR-171) or clear a promote unless explicitly accepted.
- Cost is measured and enforced, not hoped: the batch-mode default + spend cap are hard gates in the release checklist.

## 4. Alternatives rejected

- **Fable per item from the project dir**: $1.56/item — ~75× the disciplined cost. The whole ADR exists to reject this.
- **A cheaper model as judge**: the judge must be at least as capable as the tier it grades; using the cheap tier to grade itself is circular.
- **Skip the reflector, keep scalar-only evolution**: leaves GEPA's proven advantage on the table (SOTA-researcher-flagged gap).
