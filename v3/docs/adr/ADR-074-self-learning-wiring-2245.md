# ADR-074 — Self-Learning Wiring + Honest Multi-Path Output (#2245)

**Status**: Accepted — Implemented in ruflo 3.10.14
**Date**: 2026-05-30
**Tracking issue**: [#2245](https://github.com/ruvnet/ruflo/issues/2245)
**Companion**: ADR-143 (deterministic Tier-1 codemods — same claims-vs-reality pattern), ADR-073 (agentdb SOTA — also a claims-vs-reality round), [ruvnet/ruflo#2241](https://github.com/ruvnet/ruflo/issues/2241) Dream-Cycle research (Structured Distillation is the natural Round-2 enhancement to this work)

## Context

The reporter on #2245 found that the self-learning subsystem **reports success but persists nothing queryable**. Specifically:

1. **`signalsProcessed`** is initialized in three places, read once, **incremented zero times** anywhere in the codebase. Pure dead metric posing as a health indicator.
2. **`hooks_task-completed {trainPatterns: true}`** is a stub: handler returns `success: true, patternsLearned: 0` with hardcoded zeros, ignores `trainPatterns` entirely, and the inline note says the work is "delegated to the intelligence pipeline (#1916 follow-up)."
3. **`hooks_pretrain`** does real file scanning but bundles results into **one** memory-bridge row in the `pretrain` namespace and never writes per-pattern rows to the neural store. Result: `neural_patterns list` returns `[]` immediately after pretrain "succeeds" with "47 patterns extracted."
4. Persistence reset bug: `loadPersistedStats()` only restored `trajectoriesRecorded` — `patternsLearned` and `signalsProcessed` were reset to 0 on every process restart, masking real learning history.
5. Four disjoint stat aggregators (globalStats / memory_bridge / hooks metrics / neural_patterns) never agree because none of them share a source of truth.

The reporter correctly identified that the system has **one path that actually works**: `hooks_intelligence_trajectory-start → -step → -end`. Everything else is either a stub, a write to a different store than the dashboard reads from, or a permanently-zero counter.

This is the same family as ADR-143 (Agent Booster Tier-1 was dead/mislabeled) and ADR-073 §A (recall@10 was un-measured). A real engine exists; convenience surfaces advertise capabilities they never actually invoke.

## Decision

Ship ruflo 3.10.14 with the **three minimal wirings** plus **honest multi-path output**. The full unification (one source of truth for all 4 aggregators) is a multi-PR program tracked separately — not crammed into this round.

### §1 — Wire `hooks_task-completed` to the trajectory pipeline

When `trainPatterns: true`, synthesize a one-step trajectory from `{ taskId, success, quality, content }` and call the existing `recordTrajectory()` helper in `intelligence.ts` — the same code path `hooks_intelligence_trajectory-end` invokes. The handler now:

- Returns `learningPath: 'trajectory-pipeline' | 'recorded-only'` so callers can tell which path ran.
- Returns honest `patternsLearned` and `trajectoriesRecorded` counts (deltas measured from `getIntelligenceStats()`).
- Falls back to "recorded-only" with an honest `learningError` field if the pipeline fails (e.g. SONA unavailable).
- Surfaces a clear `note` either "Trained via SONA + EWC++ trajectory pipeline" or "Completion recorded only. Pass trainPatterns:true to feed the learning loop."

### §2 — Wire `signalsProcessed`

Add `recordSignalProcessed()` exported from `intelligence.ts`. Increment + throttled persist (every 16th signal). Call it from `bridgeStoreEntry()` so every memory-bridge write counts as a real signal. The dead-zero metric is now an actual health indicator.

Also fix `loadPersistedStats()` to restore `patternsLearned` and `signalsProcessed` alongside `trajectoriesRecorded` — so a process restart no longer zeroes the learning history.

### §3 — `hooks_pretrain` writes per-pattern rows + honest output

Add `storeNeuralPatterns(items)` exported from `neural-tools.ts`. Pretrain now writes:

- **One** bundle row to memory-bridge `pretrain` namespace (existing behavior, back-compat).
- **N per-pattern rows** to the neural store via `storeNeuralPatterns` — so `neural_patterns list` actually returns them.

The response surfaces both `patternsBundled` (bundle row) and `patternsIndexed` (per-pattern rows) separately, plus a `sources.stores` field naming exactly which stores got written. Callers can no longer be misled by a single "47 patterns extracted" number.

### §4 — Honest multi-path messaging

Per the goal-condition "soften where possible to indicate multiple paths":

- Every learning-adjacent handler that returns `success: true` also returns a field naming the path it took and the store(s) it wrote to.
- The `hooks_task-completed` description explicitly lists the three paths: (a) `trainPatterns:true` for one-step learning, (b) `hooks_intelligence_trajectory-*` for multi-step, (c) `memory_store` for storage without learning.
- The `note` strings tell callers what *didn't* happen, not just what did. ("recorded only — pass trainPatterns:true to feed the learning loop", not "[OK] Outcome recorded.")

### §5 — Adversarial input hardening (OWASP ASI06)

Per #2241's OWASP Top-10-for-Agentic-Apps scan: `task-completed`'s `content` is user-supplied and now feeds the SONA learning model. Add basic sanitization:

- Strip ASCII control chars (except newline + tab).
- Cap to 4 KB (way over a real trajectory step, well under a memory bomb).

This is defense-in-depth against context-poisoning attempts that try to inject control sequences into the learned-pattern store.

## Deliberately NOT in this round

Tracked in #2245 / #2241 for future PRs:

- **Unify the 4 stat sources** — designate `globalStats` as authoritative, derive `memory_bridge_status`, `hooks metrics`, and `neural_patterns count` from it. Multi-PR design work.
- **Wire `post-edit` / `post-command`** to feed the trajectory pipeline — design call (which store wins).
- **Structured distillation** of trajectory content (#2241 §Structured Distillation) — 11× compression + +1.4 MRR. Natural Round-2 enhancement.
- **Schedule consolidation worker** — background NightlyLearner instead of on-demand only.
- **Wire MCP trajectory-end to globalStats** too — currently feeds `sonaCoordinator` only.

## Consequences

- `hooks_task-completed {trainPatterns:true}` now does what the schema advertised. Agents that use this hook for completion-driven learning actually train the model.
- `signalsProcessed` is now a real health indicator. Long-running daemons can use it to verify the memory bridge is actually receiving traffic.
- `neural_patterns list` reflects what `pretrain` claims — no more "47 extracted, 0 listed" gap.
- Honest output (learningPath, patternsLearned, learningError, sources.stores) means downstream agents can make routing decisions on the *real* outcome instead of trusting `success: true`.
- The "multiple paths" messaging is explicit: callers are told upfront that `task-completed` is one path, `trajectory-*` is another, and `memory_store` is a third. No more single "[OK] Outcome recorded" theater.

## Verification

- `__tests__/self-learning-2245.test.ts` — 9 tests across EASY (primitives), MEDIUM (MCP surfaces), and COMPLEX (multi-step + persistence) categories. CI gate breaks if any of the three fixes regresses.
- `scripts/benchmark-self-learning.mjs` — proof harness with 5 sections (A–E), writes a committed run JSON. Reproduces with `N=20 node scripts/benchmark-self-learning.mjs` from a fresh checkout.
- Build clean (`tsc -b`); full CLI test suite still green.
- Manual end-to-end:
  - `recordSignalProcessed` × 10 → `signalsProcessed = 10` ✅
  - `hooks_task-completed {trainPatterns:true}` × 10 mixed-verdict → 10 trained via trajectory pipeline, ~18 ms/call avg ✅
  - `hooks_task-completed` (no trainPatterns) × 10 → trajectories+0 (correct negative control) ✅
  - `storeNeuralPatterns` × 10 → `neural_patterns list` returns ≥10 ✅
