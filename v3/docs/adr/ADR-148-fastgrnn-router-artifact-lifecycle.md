# ADR-148 — Cost-Optimal Model Router Artifact Lifecycle (wiring `@metaharness/router` with optional `@ruvector/tiny-dancer` FastGRNN backend)

**Status**: Proposed
**Date**: 2026-06-15
**Related**: ADR-026 (3-tier model routing), ADR-074 (observable-not-inferred), ADR-086 (graceful-degradation), ADR-124 (optional native dependencies), ADR-142 (per-task bandit priors), ADR-143 (Tier-1 deterministic codemods), #2329 (closed, Option A), #2334 (open, Option B)
**Supersedes**: nothing — this is the artifact-lifecycle decision the ADR-026 router was missing

## Context

`v3/@claude-flow/cli/src/ruvector/model-router.ts` shipped a **lexical complexity
heuristic + Thompson-sampling Beta-Bernoulli bandit** even though its file header
and ADR-026 both described a **`@ruvector/tiny-dancer` FastGRNN neural router**.
#2329 closed the documentation–implementation gap via Option A in #2330 (docs +
labels updated, no behavior change). #2334 kept the open question of whether to
*actually* wire the neural path — Option B in the original triage.

When #2334 was raised, three blockers stalled the work:

1. **Safetensors layout undocumented.** `@ruvector/tiny-dancer`'s
   `RouterConfig.modelPath` required a trained FastGRNN safetensors artifact but
   the tensor names/shapes/dtype the loader expected were not documented in the
   npm package; `reloadModel()` failed opaquely without that knowledge.
2. **No training pipeline.** There was no exported function to *produce* an
   artifact — distilling from `.swarm/model-router-state.json` was not viable
   (it stores aggregates only, no per-decision rows).
3. **Candidate modeling.** `Router.route({queryEmbedding, candidates})` required
   a `Candidate.embedding` for every candidate. With three Claude tiers it was
   unclear what per-tier embeddings should *mean*.

On **2026-06-15** two complementary upstream packages landed:

### `@ruvector/tiny-dancer@0.1.22` (FastGRNN native backend)

Four releases between 12:47 and 16:07 UTC. New exports:

| Export | What it does |
|---|---|
| `trainRouter(rows, prices, opts) → TrainRouterResult` | Trains a FastGRNN from DRACO-shaped rows (`{embedding, scores}`) and writes the `.safetensors` itself. Removes blocker (1). |
| `score(modelPath, embedding) → Promise<number>` | Raw forward pass. Returns sigmoid 0..1; ≥0.5 ⇒ *"cheap model is good enough"*. Removes blocker (3). |
| Platform binaries | Added `linux-x64-musl`, `linux-arm64-musl`, `win32-arm64-msvc`; runtime libc detection. |

### `@metaharness/router@0.3.2` (DRACO router, productized)

Published 2026-06-15 16:46 UTC, ~40 min after tiny-dancer 0.1.22. Described as
*"the productized DRACO Phase-2 finding"* — a cost-optimal model router using
**k-NN over labelled embeddings**, with three backends sharing one dataset shape:

| Backend | Source | Training | Artifact | Native? |
|---|---|---|---|---|
| `Router` (k-NN) | `dist/index.js` | none (uses raw examples) | none — examples held in-memory | no |
| `TrainedRouter` (KRR with LOO-CV λ) | `dist/train.js` | offline | portable JSON via `toJSON()` | no |
| `NativeRouter` (FastGRNN) | `dist/native.js` (wraps tiny-dancer) | `trainNativeRouter` writes safetensors | `.safetensors` (~6 kB) | yes (optional peer) |

`resolveRouterBackend('auto')` selects native when `@ruvector/tiny-dancer` is
installed, else the pure-TS path. All three backends consume the **same**
`{embedding: number[], scores: Record<modelId, quality>}` row shape — so the
trajectory-collection format is one decision that serves every backend.

This is the strictly-better integration target than direct tiny-dancer:

- **Cost-optimal semantics built in.** `qualityBar` selects the cheapest
  candidate predicted to clear the bar, not just a binary cheap/strong flag.
- **No native dep in the default path.** The k-NN/KRR backends are pure TS.
  ADR-124 graceful degradation becomes "pure-TS always works; native is the
  acceleration."
- **One dataset shape, three backends.** Trajectory rows seed any of the three
  with no reshaping.

This ADR records the lifecycle for that artifact — how it's **trained, stored,
distributed, loaded, refreshed, and retired** — the lifecycle missing from
ADR-026.

## Decision

Wire `@metaharness/router@^0.3.2` into `@claude-flow/cli`'s model routing path,
with `@ruvector/tiny-dancer@^0.1.22` as an optional peer for native
acceleration. Default behavior remains **byte-identical** to the shipped
heuristic + bandit until a model is intentionally adopted. Six phases:

### 1. Dependencies (ADR-124)

- `@claude-flow/cli/package.json` `optionalDependencies`:
  - `@metaharness/router: ^0.3.2`           (pure TS, no native)
  - `@ruvector/tiny-dancer: ^0.1.22`        (optional native acceleration)
- Both resolved via dynamic `import()` inside `neural-router.ts`. If either is
  absent, the missing-piece path silently falls back to bandit-fallback. The
  pure-TS router has no native binary requirement at all — graceful degradation
  applies only to the FastGRNN acceleration.

### 2. Backend selection

```ts
// At module init, once per process:
const backend = await m.resolveRouterBackend('auto');
//   'native' when tiny-dancer is installed and loadable
//   'js'     when only the pure-TS path is available
```

The result is captured in `routedBy` so callers know *which* backend produced
each decision.

### 3. Inference: `qualityBar` cost-optimality

```ts
const router = m.Router.fromExamples(rows, prices, { qualityBar: 0.8 });
const pick = router.route(queryEmbedding);
// pick: { id: 'haiku'|'sonnet'|'opus', predictedQuality, costPerMTok, metBar }
```

The picked `id` is the cheapest candidate predicted to clear `qualityBar`. If
no candidate clears it, the best-predicted is returned with `metBar=false`.
That signal — "I had to pick the strongest model but I'm not confident it'll
clear" — is exactly the **uncertainty escalation** ADR-142 / #2250 introduced
in the bandit; the new router exposes it natively.

`qualityBar` starts at `0.80` (a defensible default for production routing) and
is configurable via `CLAUDE_FLOW_ROUTER_QUALITY_BAR`.

### 4. Observability: `routedBy`, not inferred (ADR-074, ADR-086)

Every routing result carries:

```ts
routedBy: 'metaharness-js' | 'metaharness-knn' | 'metaharness-krr' | 'fastgrnn' | 'bandit-fallback' | 'heuristic'
```

The two `metaharness-*` variants distinguish the k-NN (no model) and KRR
(trained, JSON-serialised) cases; `fastgrnn` is the native-accelerated KRR/k-NN
result via tiny-dancer. **Callers must never infer** the active path from
"did the import resolve?" — both can resolve while the artifact load silently
failed.

### 5. Training: DRACO-shaped trajectories, opt-in

`RouterTrajectoryRecorder` writes one JSONL row per decision to
`.swarm/model-router-trajectories.jsonl` when `CLAUDE_FLOW_ROUTER_TRAJECTORY=1`.
Default: **off** (rows carry full task text + raw embeddings).

Row schema (versioned `"v": 1`):

```json
{
  "v": 1, "ts": "ISO-8601", "task_hash": "fnv1a-32", "task": "≤500ch",
  "embedding": [384 floats], "complexity": 0.0..1.0,
  "model": "haiku|sonnet|opus", "confidence": 0..1, "uncertainty": 0..1,
  "routed_by": "metaharness-js|fastgrnn|bandit-fallback|heuristic"
}
```

Outcome rows (same file, `"type": "outcome"`) join on `task_hash` and reconstruct
the DRACO `scores` map. This shape feeds **all three** backends without
reshaping.

### 6. Artifact: tiered distribution

- **Default (everywhere)**: a **bundled pre-trained KRR JSON**
  (`assets/model-router/seed-router.krr.json`, ~96 kB) trained from
  `assets/model-router/seed-rows.json` (64 deterministic rows). Loaded
  via `TrainedRouter.fromJSON()` — pure TS, no native deps, no I/O after
  the one-time read. The pure-TS k-NN over the raw seed corpus stays as
  a fallback when the KRR artifact is missing or fails to parse.
- **Trained (optional)**: a `TrainedRouter` JSON written via `toJSON()` from
  a larger corpus, distributed via IPFS using the existing `hooks transfer`
  channel. `CLAUDE_FLOW_ROUTER_MODEL_PATH` can point at a local path or an
  `ipfs://` URI.
- **Native-accelerated (optional)**: a `.safetensors` written by
  `trainNativeRouter`. Loaded only when tiny-dancer is installed *and* the
  artifact path is set.

Hot-reload via `Router.reloadModel()` is supported but only via an explicit CLI
command — never per-call.

### 7. Retirement

Each artifact records `trainedAt`. If `now − trainedAt > 90d` *and*
trajectory-collected accuracy on the most recent 10k rows is >5 pp below the
artifact's reported `looQuality`/`valAccuracy`, the loader emits a one-time
warning and **continues using the artifact**. Automatic invalidation is the
ADR-086 footgun.

## Consequences

### Positive

- Closes #2334. The cost-optimal router lifecycle is recorded and the
  integration target is one package, not "tiny-dancer + custom wrapper".
- **Zero-native-dep default.** Pure-TS k-NN is the floor; native FastGRNN
  is the ceiling. ADR-124 graceful degradation becomes the *gradient*, not
  a binary "works/doesn't".
- The default behavior in **every** installation is identical to today's
  shipped behavior until both env-gates are set. Hard to regress.
- ADR-026's advertised architecture and the implementation finally agree.
- Single dataset shape feeds all three backends — one training pipeline,
  three deploy paths.

### Negative

- Two new optional dependencies instead of one. Both are tiny: `@metaharness/
  router` is pure TS with no transitive deps, tiny-dancer adds the native
  binary. The marginal install-size cost is ~40 kB of JS + ~6 kB of model.
- Storing trajectory rows on disk introduces a PII/retention surface that the
  bandit (aggregates-only) did not have. Mitigation: `CLAUDE_FLOW_ROUTER_TRAJECTORY`
  is opt-in, rotation policy documented, rows are local and never uploaded by
  default.
- The benchmark below uses a **synthetic corpus with strong signal-to-noise
  ratio**. Real-world tier-accuracy is expected to be lower; the +43–45 pp
  delta is a ceiling demonstration, not a forecast.

### Neutral

- The Thompson bandit stays. It is the cold-start path, the bandit-fallback
  path, and the online-learning signal source for the next artifact
  retraining. ADR-142's per-task bandit priors are unaffected.

## Measured numbers (before/after)

Benchmark: `scripts/benchmark-router.mjs` (374 lines, reproducible from this
repo + `npm install @metaharness/router@0.3.2 @ruvector/tiny-dancer@0.1.22`).
`darwin-arm64`, `node v22.22.1`, N=400 (280 train / 120 test), dim=32,
hidden=12, epochs=40. Heuristic+bandit exercised **cold** (no learned state
— same condition as a fresh installation).

### Cross-seed accuracy + latency (consistent across both runs)

| System | seed=42 accuracy | seed=99 accuracy | Latency mean | p95 |
|---|---|---|---|---|
| trivial: always cheap | 46.7% | 46.7% | 0 ms | — |
| trivial: always strong | 53.3% | 53.3% | 0 ms | — |
| shipped heuristic+bandit (cold) | **55.0%** | **54.2%** | 0.076–0.083 ms | 0.174 ms |
| @metaharness/router 0.3.2 k-NN | **100.0%** | **100.0%** | 0.107–0.108 ms | 0.140 ms |
| @metaharness/router 0.3.2 KRR (LOO-tuned) | **98.3%** | **100.0%** | **0.020 ms** | 0.023 ms |
| @ruvector/tiny-dancer 0.1.22 FastGRNN | **100.0%** | **100.0%** | 0.036–0.037 ms | 0.047 ms |

Training/build cost:

| System | Train/build time | Artifact |
|---|---|---|
| k-NN | 0.16 ms (build only — no model file) | — (raw examples in-memory) |
| KRR | **82.8 s** (Gaussian-elimination 280×280 per candidate, λ via LOO-CV) | 440 kB JSON |
| FastGRNN | 25.9 ms (40 epochs, Adam) | **6.2 kB** safetensors |

Backend resolution:

- `isNativeRouterAvailable()` = `true` (tiny-dancer 2.2.3 installed)
- `resolveRouterBackend('auto')` = `'native'`

Agreement (binary cheap/strong, fraction of test set):

- baseline vs k-NN: 55.0% &nbsp; baseline vs KRR: 55.0% &nbsp; baseline vs FastGRNN: 55.0%
- k-NN vs FastGRNN: **100.0%** (the two trained backends agree on every test
  query — empirical confirmation that the dataset shape and the cost-optimal
  semantics produce equivalent routing decisions across backends)

### What the numbers mean

- The cold bandit sits at the majority-class baseline (~53–55%). It needs time
  on real outcomes to converge; this is its install-day floor, not its
  asymptote.
- **k-NN matches FastGRNN's accuracy with zero training time and zero artifact
  bytes.** That is the strongest argument for `@metaharness/router` as the
  primary integration target.
- KRR is the **fastest inference** (0.020 ms p95 0.023 ms) but trades **83 s of
  training time** and **440 kB JSON** for that 1.8× latency improvement vs
  FastGRNN. Not worth it on the current corpus size; revisit when N > 10k.
- FastGRNN is the **best balance**: 100% accuracy, 26 ms train, 6 kB artifact,
  0.036 ms inference. The right pick when tiny-dancer is installed; the cost of
  installing it is one native binary download (~1.5 MB on darwin-arm64).

Bench JSON: `docs/benchmarks/runs/router-4way-seed42-2026-06-15T*.txt` and
sibling `.json` files.

## Alternatives considered

1. **Direct tiny-dancer `score()` only (the original #2334 plan)**. Rejected
   in favor of `@metaharness/router` because (a) the latter wraps the same
   FastGRNN with cleaner cost-optimal semantics, (b) provides a zero-native-dep
   fallback at no accuracy cost on the bench, (c) ships KRR alongside k-NN at
   no extra integration cost.
2. **Multi-candidate `Router.route({queryEmbedding, candidates})`**. Rejected
   because the per-tier candidate embedding is not a well-defined quantity for
   three Claude models. Defer to a future ADR if per-task-family routing
   becomes a product requirement.
3. **Keep heuristic + bandit only; do nothing**. Rejected because (a) ADR-026
   /file-header mismatch keeps recurring as an audit finding and (b) the
   cold bandit measures at ~54% binary accuracy on the bench — barely above
   majority class.
4. **Distillation from `.swarm/model-router-state.json`**. Rejected per
   rcraw's #2334 finding: aggregates-only.
5. **Hot-reload artifacts on every routing call** / **auto-invalidate stale
   artifacts**. Rejected as ADR-086 footguns.
6. **KRR as the default trained backend**. Rejected: 83 s training time and
   440 kB artifact for negligible accuracy gain over k-NN on the bench. KRR
   stays as an optional path for larger corpora.

## Open questions

1. **Seed corpus source.** Trajectory collection produces data over time, but
   the first bundled seed corpus needs an origin. Candidates: (a) hand-curated
   ~50 queries with rcraw's review, (b) replay historical bandit outcomes from
   representative installations, (c) bootstrap from a public agent benchmark.
   Resolves in the follow-up PR.
2. **Acceptance bar for "default neural path on".** Proposed: held-out tier
   accuracy ≥ heuristic+bandit baseline + 5 pp **and** cost-adjusted reward
   no worse, on ≥500 labelled trajectories. Confirm with rcraw.
3. **Platform coverage.** tiny-dancer 0.1.22 ships 8 platform/libc combos.
   The pure-TS path moots this for the default install — Decision needed only
   for the *recommended* configuration in docs.

## Implementation plan

Sequenced for the smallest credible PR first:

**PR 1 — Phase 1 (smallest, default behavior byte-identical)**

- Add `@metaharness/router ^0.3.2` and `@ruvector/tiny-dancer ^0.1.22` to
  `@claude-flow/cli/package.json` `optionalDependencies`.
- Add `v3/@claude-flow/cli/src/ruvector/neural-router.ts` exporting one
  function: `tryCostOptimalRoute(embedding) → Promise<{model, predictedQuality,
  metBar, routedBy} | null>`. Returns `null` unless
  `CLAUDE_FLOW_ROUTER_NEURAL=1` is set, a seed corpus or trained artifact
  resolves, and the backend selects.
- Bundle `assets/model-router/seed-rows.json` (~50 queries) for the k-NN cold
  path so the gate-on result is non-empty out of the box.
- Thread the embedding through `ModelRouter.route(task, embedding?)` for the
  inference call only.
- Add `RouterTrajectoryRecorder` (gated by `CLAUDE_FLOW_ROUTER_TRAJECTORY=1`)
  writing DRACO-shaped JSONL.
- Add `routedBy` to every result.
- Tests: graceful-degradation (both optional deps missing → bandit-fallback),
  backend resolution (`auto` selects `native` ↔ `js` per env), gate open vs
  closed → byte-identical decisions on the bench corpus.

**PR 2 — seed corpus + bundled artifact**

- Land a real seed corpus and (optionally) the first trained FastGRNN
  `.safetensors` bundled under `assets/model-router/`.
- Decide open question 1.

**PR 3 — flip default**

- Once the acceptance bar is met on a real corpus, set
  `CLAUDE_FLOW_ROUTER_NEURAL=1` as the package default and document the
  opt-out.

## References

- Issues: #2329 (closed, Option A), #2334 (open, Option B), #2250 (closed)
- ADRs: ADR-026 (3-tier routing), ADR-074, ADR-086, ADR-124, ADR-142, ADR-143
- Code: `v3/@claude-flow/cli/src/ruvector/model-router.ts`,
  `v3/@claude-flow/cli/src/ruvector/enhanced-model-router.ts`
- Upstream:
  - `@metaharness/router@0.3.2` (2026-06-15, exports `Router`, `TrainedRouter`,
    `trainRouter`, `NativeRouter`, `trainNativeRouter`, `resolveRouterBackend`,
    `isNativeRouterAvailable`)
  - `@ruvector/tiny-dancer@0.1.22` (2026-06-15, exports `trainRouter`, `score`,
    `Router`)
  - ruvector commits: `5173ce7`, `39fb398`, `3c1f701`
- Bench: `scripts/benchmark-router.mjs`,
  `docs/benchmarks/runs/router-4way-seed42-2026-06-15T*.txt`
