# ADR-391 — Change the Default Router Only on a Measured Win

**Status**: Implemented (3.44.0) — first run: no candidate promoted
**Date**: 2026-09-23
**Related**: ADR-150 (MetaHarness AND-gate), ADR-389, ADR-390, PR #3406 (opt-in `@ruvector/typesafe` router)
**Surfaces**: `hooks_route`, `v3/@claude-flow/cli/src/ruvector/router-parallel-recorder.ts`, a new bench under `v3/@claude-flow/cli/benchmarks/`

## Context

There are now four ways RuFlo could pick an agent, and no evidence on which is best:

| Candidate | What it is | Status |
|---|---|---|
| **A** current | semantic router over hash embeddings + keyword fallback | default |
| **B** MiniLM | A, with the real sentence embedder (ADR-390) | proposed |
| **C** typesafe-hash | `@ruvector/typesafe`, default hash embedder | opt-in since 3.43.0 |
| **D** typesafe-onnx | `@ruvector/typesafe` with bge-small / MiniLM | untested |

The evidence so far is a handful of hand-picked prompts. Typesafe's own lift
threshold (1.2×) was set from a **10-task** sample. That isn't enough to justify
changing what every user gets.

The data source this needs isn't populated yet. `router-parallel-recorder.ts`
writes `.swarm/router-parallel.jsonl`, but:
- only when `CLAUDE_FLOW_ROUTER_PARALLEL_LOG=1`
- task text is excluded unless `CLAUDE_FLOW_ROUTER_PARALLEL_LOG_TASK=1`

On the maintainer's machine the file does not exist. There is no history to mine
today.

## Decision

1. **Build the corpus first.**
   - Collect **150–200 real task prompts**. Sources: the parallel log (collected
     with both env flags on, and scrubbed of anything sensitive), plus
     prompts from this repo's issues and PR titles.
   - Label each with the correct agent, blind to any router's output.
   - Include negatives: prompts that fit no agent, where abstaining is correct.
   - Freeze the corpus with a hash and split it into **dev** (tuning thresholds) and
     **test** (the decision). The test split is touched once per candidate.
2. **Run all four candidates on the same frozen test split.** For each, measure:
   - top-1 accuracy
   - macro-F1
   - wrong-with-high-confidence rate
   - abstain precision (C and D)
   - p50/p95 latency, cold and warm
   - dependency and install cost
3. **Promotion rule** (the ADR-150 AND-gate, restated for routing). A candidate
   replaces the default only if, against A:
   - accuracy is **more than 2 points** better
   - it adds no required dependency (optional peers and fallbacks are allowed)
   - p95 latency regresses by **no more than 5%** warm, with cold start reported
     separately
4. **Tie-break role for typesafe.** If C or D doesn't win outright but its abstain
   signal predicts A's errors, it may become a second opinion: consulted only when
   A's top two scores are within a margin. That needs its own measured win on the
   same split.
5. Results, the corpus hash and the per-candidate receipts are committed under
   `benchmarks/results/`, whatever the outcome. A loss is recorded, not deleted.

## Consequences

- The default router changes only on evidence. B (no new dependency) is the
  expected winner, but that's a prediction this ADR exists to test.
- Typesafe stays opt-in unless it earns more. PR #3406's design already allows
  either outcome.
- Labelling 150–200 prompts is real work. It's also reusable: the same corpus
  evaluates any future router change.

## Verification

- The bench script re-runs deterministically from the frozen corpus (fixed seeds,
  pinned model hashes).
- A CI job re-runs the bench on changes to `hooks_route` and fails if the default's
  accuracy on the test split drops below the committed receipt.

## Results — first run (2026-09-23)

Corpus: 197 prompts, frozen at sha256 `b0c1923b2813b61907304dff56c53d199b709797bfb9600a7c1f496cf0c0bf04`
(84 dev / 113 test, 64 trap cases), labelled blind by an agent that never ran or read any router.
Receipt: `v3/@claude-flow/cli/benchmarks/router/results/router-bench-2026-09-23.json`.
Re-run: `node benchmarks/router/run-bench.mjs` (D needs `ROUTER_BENCH_TYPESAFE_MODEL_DIR`).

**Test split (n=113):**

| Candidate | Accuracy | Macro-F1 | Trap accuracy | Wrong at ≥0.7 confidence | p50 / p95 warm | Cold |
|---|---|---|---|---|---|---|
| A current (hash) | **25.7%** | 0.178 | 29.0% | 29.2% | 0.66 / 1.06 ms | 38 ms |
| B MiniLM (ADR-390) | **36.3%** | 0.334 | 25.8% | 46.9%* | 2.19 / 6.21 ms | 326 ms |
| C typesafe, hash | 26.5% | 0.199 | 29.0% | 26.6% | 0.77 / 1.20 ms | 90 ms |
| D typesafe, ONNX (bge-small-en-v1.5) | 29.2% | 0.227 | 32.3% | 26.6% | 6.07 / 8.35 ms | 680 ms |

Raw typesafe pick before its lift/abstain gate: C 30.1%, D **44.3%**. The gate
let typesafe decide on only 13.2% (C) and 5.6% (D) of prompts.

**Gate verdict: no candidate is promoted.**

- **B** clears accuracy (+10.6 pts) and dependency, but fails latency: p95 +485%
  (1.06 → 6.21 ms).
- **C** fails accuracy (+0.9 pts) and latency.
- **D** clears accuracy (+3.5 pts), but fails latency (+686%) and is an optional
  peer, so it can only ever be opt-in.

`DEFAULT_ROUTER_EMBEDDER` stays `hash`, and typesafe stays opt-in.

**Findings (recorded, not acted on in this run):**

1. **The router structurally cannot answer 59 of 197 prompts.** No `TASK_PATTERNS`
   entry returns `researcher`, `reviewer` or `none` as the primary agent, so A and
   B have a ceiling of about 70% before any embedder question. Adding
   research/review patterns is likely worth more than any embedder change. First
   follow-up.
2. **The latency criterion is mis-specified for this workload.** A relative bound
   (≤5% p95) on a ~1 ms baseline fails any embedder that does real work, even
   though B's absolute cost is about 5 ms on a pre-task hook. Proposed revision,
   for the owner and **not applied here**: an absolute bound (e.g. p95 ≤ 10 ms
   warm, cold reported), then re-run. Changing the gate in the same commit as the
   result it would flip is exactly what this ADR forbids.
3. *B's "wrong at ≥0.7" isn't comparable with A's.* The 0.4 score gate and the
   `1 - distance` confidence were calibrated for hash vectors; MiniLM cosines sit
   on a different scale. B needs its own threshold, tuned on the dev split, before
   this metric means anything.
4. **Typesafe is held back by its gate, not its accuracy.** D's raw pick is the
   most accurate of anything measured (44.3%), but the lift/abstain thresholds were
   set from a 10-task hash sample and admit only 5.6% of its decisions. Tune them on
   the dev split, then re-run on test.
5. The labeller flagged three debatable rows (two memory-area design prompts, one
   benchmark-measurement fix, one topology question). They were left as labelled,
   because relabelling after seeing router output would break the blind protocol.
