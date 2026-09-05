# ADR-142 — Per-Task-Bucket Bandit Priors for Model Routing

**Status**: Accepted — Implemented in v3.10.9 (2026-05-29)
**Related**: ADR-026 (3-tier model routing), #1772 (Thompson-sampling bandit), docs/reviews/intelligence-system-audit-2026-05-29.md

## Context

The model-routing Thompson-sampling bandit (`v3/@claude-flow/cli/src/ruvector/model-router.ts`)
kept Beta(α,β) priors **globally per model**: `priors: Record<ClaudeModel, BetaPrior>`.
The intelligence audit found this is too coarse — e.g. 8 Haiku failures on one hard
task suppress Haiku for **all** tasks, including trivial ones it handles well. The
bandit could not learn "Haiku is fine for typos but bad for helpers."

## Decision

Key the priors by a **complexity bucket** derived from the existing
`analyzeComplexity().score`, banded to mirror `MODEL_CAPABILITIES.maxComplexity`:

- `low`  — score < 0.4 (haiku territory)
- `med`  — 0.4 ≤ score < 0.7 (sonnet territory)
- `high` — score ≥ 0.7 (opus territory)

New shape: `priors: Record<ComplexityBucket, Record<ClaudeModel, BetaPrior>>`.

- **Selection** (`selectModel`) samples from the bucket of the current task's
  complexity score (already in scope).
- **recordOutcome** re-derives the bucket from the `task` string via the SAME
  `analyzeComplexity` path (the MCP `hooks_model-outcome` payload carries no
  complexity, so record-time and select-time buckets match for the same task).
- MCP tool signatures (`hooks_model-route`, `hooks_model-outcome`) are
  **unchanged** — the bucket is derived internally.

## Schema migration

`model-router-state.json` gains `version: 2`. `migratePriors()` forward-migrates
any prior layout without data loss or throwing:

- **missing / garbage** → fresh uniform buckets.
- **flat per-model (v1)** → seed ALL three buckets from the old global priors
  (lossless: accumulated learning becomes a shared starting point that then
  diverges per bucket).
- **already bucketed** → kept, backfilling any missing bucket.

Readers MUST tolerate all three layouts. (`loadState` calls `migratePriors`.)

## Consequences

- **Fixes the cross-task interference defect** — failures in one bucket no longer
  suppress a model in another (proven by the `per-bucket isolation` test).
- Convergence is now per-bucket (≈3× the outcomes to fully converge all buckets) —
  an acceptable cost for correct task-type-local learning.
- `getBanditPriors(bucket = 'med')` now takes an optional bucket; added
  `getBucketedPriors()` for dashboards/tests. The bandit test suite was updated
  to be bucket-aware (query the task's bucket; aggregate across buckets for
  convergence assertions) and gained isolation + migration tests.

## Verification

`__tests__/router-bandit.test.ts` — 8/8 pass, including:
- per-bucket isolation (8 failures in `low` leave `high` at {1,1});
- flat-v1 → bucketed migration (seeds all buckets from the old global priors).
