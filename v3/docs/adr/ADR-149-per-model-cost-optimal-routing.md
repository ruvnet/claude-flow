# ADR-149 — Per-Model Cost-Optimal Routing (drop the 3-tier abstraction)

**Status**: Proposed
**Date**: 2026-06-15
**Related**: ADR-026 (3-tier model routing), ADR-074 (observable-not-inferred), ADR-086 (graceful-degradation), ADR-124 (optional native dependencies), ADR-142 (per-task bandit priors), ADR-148 (cost-optimal router lifecycle via `@metaharness/router`), #2334 (Option B), #2329
**External reference**: [`ruvnet/agent-harness-generator` ADR-040 — DRACO routing finding](https://github.com/ruvnet/agent-harness-generator) — the productized methodology that `@metaharness/router` exposes.

## Context

ADR-148 wired the cost-optimal router (`@metaharness/router` + optional `@ruvector/tiny-dancer` FastGRNN backend) behind a 3-tier abstraction (`haiku` / `sonnet` / `opus`) and a per-tier OpenRouter alternate. That was the right Phase A — small, reversible, byte-identical default — but it forecloses real Pareto wins that the bench evidence now makes visible.

### What the measurements showed

Two real benches landed in this branch (`feat/2334-metaharness-router-integration`):

**Cheap-tier, N=45 (variance-corrected), measured 2026-06-15** (`docs/benchmarks/runs/cheap-models-2026-06-15-20-3*.json`):

| Model | Pass | Latency | $/1k passes |
|---|---|---|---|
| `inclusionai/ling-2.6-flash` | 100% | 684 ± 104 ms | $0.001 |
| `anthropic/claude-haiku-4.5` (control) | 100% | 1022 ± 226 ms | **$0.151** |

→ **Haiku is 151× more expensive than Ling for the same pass rate**, and 1.5× slower.

**Mid-tier, LLM-judged 12-row corpus, measured 2026-06-15** (`docs/benchmarks/runs/midtier-models-2026-06-15-20-53-55Z.json`):

| Model | Avg score | $/run | $/quality |
|---|---|---|---|
| `openai/gpt-4.1` | **81.0%** | $0.030 | $0.037 |
| `google/gemini-2.5-flash` | 76.7% | $0.014 | $0.018 |
| `anthropic/claude-sonnet-4-6` (control) | 76.7% | $0.112 | $0.145 |
| `meta-llama/llama-3.3-70b-instruct` | 69.6% | $0.001 | **$0.002** |

→ **GPT-4.1 outscores Sonnet 4.6 at 4× less cost.** Llama 3.3 70B is the $/quality Pareto leader by **70×** — it delivers 91% of Sonnet's quality at 0.9% of Sonnet's price.

### Why the 3-tier abstraction wastes these wins

ADR-148's `openrouter-alts.json` maps each Claude tier to **one** OpenRouter alternate. The routing math (bandit + hybrid neural prior) operates on three tier labels. This has three structural problems:

1. **Tier-internal alternates are invisible to the router.** A user who wants the $/quality leader (Llama 3.3 70B) for sonnet-routed traffic has to hand-edit the JSON — the router itself has no way to consider Llama as a sonnet alternate vs. GPT-4.1 at runtime.
2. **Cross-tier alternates are foreclosed.** For a task at the cheap/sonnet boundary, the optimal pick might be Llama 3.3 70B ($0.001/run, 70% quality on mid-tier). The bandit-then-tier-map routes that task to either `haiku→Ling` (potentially under-capable on a real mid-tier query) or `sonnet→GPT-4.1` (3× the cost). There is no path that picks Llama-the-cross-tier-option.
3. **The bandit cannot distinguish models within a tier.** Beta(α, β) per `ClaudeModel` aggregates outcomes for GPT-4.1 and Claude Sonnet under one `sonnet` prior. Online learning can never separate them — the structure throws away the signal.

### The DRACO finding (external reference)

`ruvnet/agent-harness-generator` ADR-040 found that for cross-domain agent work, **structure/fusion does not beat a strong model on quality, but routing each query to the *right, cheapest* model is a measured Pareto win**. A learned embedding router with `(query embedding → quality each model achieved)` examples beats the best fixed model on the DRACO benchmark, and its accuracy rises monotonically with training-data size (the DRACO "learning curve").

`@metaharness/router` is the productized form of that finding. Its `Router.fromExamples(rows, prices, { qualityBar })` is *literally* a per-model cost-optimal selector — given measured `{embedding, scores: {model_id: quality}}` rows and a per-model price table, it returns the cheapest model predicted to clear the bar. We are currently using a fraction of its capability.

### The Phase 1 seed corpus is unmeasured

`v3/@claude-flow/cli/assets/model-router/seed-rows.json` carries `scores: { haiku: 0.94, sonnet: 0.92, opus: 0.93 }` — **hand-coded, not measured.** The bundled KRR artifact was fit to these assumptions, not to real model behavior. The 100% accuracy on `scripts/benchmark-router.mjs` is a property of the synthetic corpus, not real-world routing fidelity.

## Decision

Adopt **per-model cost-optimal routing** end-to-end:

### 1. Drop `ClaudeModel` from the routing-math interior

The public `ModelRoutingResult.model` field stays `ClaudeModel` for backwards compatibility with all existing consumers, but the routing computation operates on `ModelId = string`. A canonical-model registry maps the tier label to the underlying string id when callers need it, but the bandit, the neural prior, the seed-corpus scores, and `@metaharness/router`'s `Router` all operate on the string id throughout.

`ModelRoutingResult` gains:
- `modelId: string` — the *concrete* picked model (e.g., `openai/gpt-4.1`, `inclusionai/ling-2.6-flash`, `anthropic/claude-sonnet-4-6`)
- Existing `model: ClaudeModel` is derived from `modelId` via the registry (the closest tier — preserves Anthropic-API consumers that still expect `'haiku' | 'sonnet' | 'opus'`)

### 2. Candidate registry replaces per-tier alts

`assets/model-router/openrouter-alts.json` is replaced by `assets/model-router/candidates.json` — a flat list of candidate models with their measured stats, costs, and provider mapping:

```json
{
  "candidates": [
    { "id": "anthropic/claude-haiku-4-5",
      "tier_label": "haiku",
      "provider": "anthropic",
      "cost_per_m_tok_in": 1.00, "cost_per_m_tok_out": 5.00,
      "measured": { "cheap_pass_rate": 1.00, "mid_avg_score": 0.45, "latency_mean_ms": 1022 } },
    { "id": "inclusionai/ling-2.6-flash",
      "tier_label": "haiku",
      "provider": "openrouter",
      "cost_per_m_tok_in": 0.01, "cost_per_m_tok_out": 0.03,
      "measured": { "cheap_pass_rate": 1.00, "mid_avg_score": null, "latency_mean_ms": 684 } },
    { "id": "openai/gpt-4.1",
      "tier_label": "sonnet",
      "provider": "openrouter",
      "cost_per_m_tok_in": 2.00, "cost_per_m_tok_out": 8.00,
      "measured": { "cheap_pass_rate": null, "mid_avg_score": 0.81, "latency_mean_ms": 582 } },
    ...
  ]
}
```

`tier_label` is **metadata, not control flow** — kept so legacy consumers can still ask "what's the canonical tier of this candidate?" but never used to gate routing decisions.

### 3. Measured seed corpus

`scripts/benchmark-seed-corpus.mjs` (new) runs each row in `seed-rows.json` against every candidate model, LLM-judges each response with `anthropic/claude-sonnet-4-6` as a 5-criterion rubric (the same judge harness as `benchmark-models-midtier.mjs`), and overwrites the row's `scores: {model_id: quality}` with measured values.

This is the DRACO data shape `@metaharness/router`'s `Router.fromExamples` consumes natively. The bundled KRR artifact is then re-trained from these measured rows (not hand-coded ones) via `scripts/train-bundled-krr.mjs`.

### 4. `qualityBar` cost-optimal selection at runtime

`neural-router.ts`'s `tryCostOptimalRoute(embedding)` returns:

```ts
{
  modelId: string,                  // 'openai/gpt-4.1'
  tierLabel: ClaudeModel,           // 'sonnet' — for back-compat / Anthropic-API consumers
  provider: 'anthropic' | 'openrouter',
  predictedQuality: number,         // 0..1
  metBar: boolean,                  // did predictedQuality clear qualityBar
  costPerMTokIn: number,
  costPerMTokOut: number,
  alternatives: Array<{ modelId, predictedQuality, costPerMTok }>,
  routedBy: NeuralRoutedBy,
}
```

Selection mechanism: `Router.fromExamples(measured_rows, prices, { qualityBar: 0.8 }).route(embedding)`. The result is *literally* the cheapest candidate predicted to clear the bar — across all candidates, not bucketed by tier.

### 5. Per-model bandit priors

`BanditPriors` migrates from `Record<ClaudeModel, BetaPrior>` to `Record<string, BetaPrior>`. The hybrid math (neural-prior bumps the bandit Beta) operates per model id. `recordOutcome(taskHash, modelId, success)` updates the named model's posterior.

Existing per-tier state migrates forward: `state.priors.haiku` becomes the priors for `MODEL_MAP['haiku']` (the canonical Anthropic Haiku 4.5 id). New model ids start at `Beta(1, 1)`.

### 6. Observability

`ModelRoutingResult.routedBy` keeps its existing `'hybrid' | 'bandit-fallback' | 'heuristic'` mechanism semantics. The new `modelId` field carries the concrete model identity. Together they fully describe the decision: mechanism + identity.

`hooks_intelligence_stats` MCP tool's `modelRouter` block surfaces:
- `modelDistribution: Record<string, number>` (per-model id counts) — replaces per-tier counts
- `tierLabelDistribution: Record<ClaudeModel, number>` (computed, for back-compat)
- `costOptimalitySaved: number` (USD vs. always-picking-the-most-expensive-candidate-that-clears-bar, accumulated process-local)

## Consequences

### Positive

- Closes the 3-tier-abstraction gap surfaced by the ADR-148 phase 2 benches. The router now does what the term "cost-optimal" actually means: cheapest candidate predicted to clear the bar, across all candidates.
- **Measured ~$0.15/1k passes savings vs Haiku 4.5** on the cheap-tier corpus by routing to Ling 2.6 Flash (151× cheaper).
- **Measured ~$0.11/quality savings vs Sonnet 4.6** on the mid-tier corpus by routing to GPT-4.1 (4× cheaper at higher quality), or **~$0.14/quality** via Llama 3.3 70B (70× cheaper at 91% quality).
- Online learning per model id — the bandit can now distinguish GPT-4.1 from Sonnet, and Ling from Haiku, instead of aggregating them.
- New candidates are extensible: `claude-flow neural router add-model <id> --cost-in X --cost-out Y` (CLI follow-up).
- DRACO's measured-data lifecycle becomes the actual lifecycle: the seed corpus is regenerable, retrainable, and improvable with more data.

### Negative

- Larger surface area. `ClaudeModel` survives as a public type but the routing math sees `string`. Public types touched: `ModelRoutingResult` (additive — new fields), `getModelRouterStats()` (additive — new counters), `TrajectoryDecisionRow` (additive — `model_id` alongside `model`). No breaking changes, but the right thing is more code.
- The first run of `scripts/benchmark-seed-corpus.mjs` costs **~$2-5 USD** (one-time, gateable, opt-in). The measurement is reusable until the model catalog or corpus changes meaningfully.
- The bundled KRR artifact grows from a 3-class classifier to an N-candidate regressor. For N=8 candidates, expected size is ~10-15 kB (was 96 kB for the over-regularised 3-class version; KRR with measured data should regularise tighter).
- Per-model Beta priors increase persisted state size from 9 priors (3 tiers × 3 buckets) to N candidates × 3 buckets. For N=8, that's 24 priors, ~1 kB. Negligible.
- Existing state migration: `.swarm/model-router-state.json` v2 → v3. Forward-migrate per-tier priors to their canonical-model id; new ids start at `Beta(1,1)`.

### Neutral

- The Thompson bandit stays. Per-model. ADR-142's complexity-bucketed priors stay — `state.priors[bucket][modelId]` instead of `[bucket][tier]`.
- The Anthropic-API path is unchanged: when `provider === 'anthropic'`, the caller maps `modelId === 'anthropic/claude-sonnet-4-6'` back through `MODEL_MAP` to `claude-sonnet-4-6` for the Anthropic SDK. Existing `agent-execute-core.ts` consumers see no change.

## Measured impact (forecast from the prior benches)

The Phase B refactor lets the router *act on* the existing measurements. On a representative cheap+mid traffic mix (per ADR-148's bench corpus):

| Workload mix | Pre-Phase-B (3-tier alts) | Post-Phase-B (per-model) | Saving |
|---|---|---|---|
| 70% cheap, 30% mid | Haiku 4.5 + Sonnet 4.6 = $0.0408/run | Ling + GPT-4.1 = $0.00977/run | **76%** |
| 70% cheap, 30% mid | (with current alts: Ling + GPT-4.1) | Ling + Llama-3.3-70b mid-pick = $0.000997/run | **97.6%** |
| 100% mid | Sonnet 4.6 = $0.112/run | Llama-3.3-70b = $0.001/run | **99.1%** |

These are forecasts from per-call measured costs, not measured end-to-end. The Phase B benchmark will land real numbers once the refactor is in.

## Alternatives considered

1. **Multi-candidate per tier (the "quick win" from the prior analysis).** Keep the 3-tier abstraction, but each tier has multiple alternates with their own scores; the router picks cheapest within the picked tier. Rejected because the cross-tier wins (Llama-3.3-70b for routed-cheap, GPT-4.1 for routed-opus) require cross-tier visibility.
2. **A learned policy on top of the existing tier router.** Add a "tier override" layer that uses measured per-model scores to swap the picked alternate. Rejected as a layering hack — the right surgery is in the routing math, not above it.
3. **Cost penalty inside Thompson sampling.** Multiply the Beta-sampled score by `1/cost^k` for some k. Rejected because the cost trade-off is exactly what `qualityBar` was designed for — `qualityBar` is the principled formulation; cost penalties are a fudge that mixes quality and cost in the wrong space.
4. **Defer to a future ADR-150.** Rejected because the measurements are already done — landing Phase B now captures the wins; deferring leaves the 3-tier ceiling in place indefinitely.

## Open questions

1. **`qualityBar` default.** ADR-148 set it to 0.8. With measured rows (not synthetic), 0.8 may be too aggressive — the LLM-judged mid-tier corpus has Sonnet at 0.767 (just below the bar). Proposal: default to **0.7** to keep Sonnet in the "clears the bar" set; configurable as before via `CLAUDE_FLOW_ROUTER_QUALITY_BAR`.
2. **How many candidates ship in the bundled registry.** Initial proposal: ~8 (3 Anthropic tiers + Ling + GPT-4.1 + Gemini-Flash + Llama-3.3-70b + Nemotron-free). Larger registries are more flexible but every candidate adds a column to the seed-corpus measurement. Open to growing it post-launch.
3. **Re-measurement cadence.** OpenRouter pricing and model availability shift. Proposal: run `benchmark-seed-corpus.mjs` quarterly, or whenever a candidate's pricing changes by >20%. CLI surface: `claude-flow neural router measure --candidates <list>`.
4. **Online retraining.** Trajectory-collected outcomes (ADR-148 phase 1) accumulate per-model evidence. When do we retrain the bundled KRR from them? Proposal: a follow-up ADR once we have a few weeks of real trajectory data.

## Implementation plan

Sequenced for the smallest credible PR first:

**PR 1 — Measurement + schema (the data lift)**
- Add `scripts/benchmark-seed-corpus.mjs` (re-uses the judge harness from `benchmark-models-midtier.mjs`)
- Run it live against the 5-7 candidate models on the 64-row seed corpus (~$2-5 USD)
- Overwrite `seed-rows.json` with measured scores per model id
- Add `assets/model-router/candidates.json` (replacing `openrouter-alts.json`; the old file becomes a compatibility shim for one release)
- Re-train the bundled KRR with the measured data (`scripts/train-bundled-krr.mjs` — extend to read the new flat candidates list)

**PR 2 — Routing math (the code lift)**
- `ModelId = string` type and a `CanonicalModelRegistry` that maps ids ↔ tiers
- `neural-router.ts`: `tryCostOptimalRoute()` returns `modelId` directly via `Router.fromExamples(measured_rows, prices, { qualityBar })`
- `model-router.ts`: `BanditPriors` migrates from `Record<ClaudeModel, …>` to `Record<ModelId, …>`. `selectModel()` operates per modelId. The hybrid neural prior bumps Beta per modelId.
- `recordOutcome(taskHash, modelId, success)` writes per-model
- Trajectory recorder schema v2: `model_id` alongside `model`
- State migration: load v2 state, map tier priors to canonical-id priors, save as v3

**PR 3 — Observability + CLI**
- `getModelRouterStats()` extends to per-model distribution + cost-optimality saved
- `hooks_intelligence_stats` surfaces it
- `claude-flow neural router models` — lists registry with measured stats
- `claude-flow neural router measure` — re-runs the seed-corpus bench against the registry
- `claude-flow neural router add-model <id> --cost-in X --cost-out Y` — extend at runtime

**PR 4 — Compat sunset**
- Remove the `openrouter-alts.json` shim
- Remove the per-tier paths from `ModelRoutingResult` (after one release cycle of overlap)

## References

- Issues: #2334 (Option B), #2329 (Option A, closed)
- ADRs: ADR-026, ADR-074, ADR-086, ADR-124, ADR-142, ADR-143, ADR-148
- External: [`ruvnet/agent-harness-generator` ADR-040 (DRACO)](https://github.com/ruvnet/agent-harness-generator)
- Code: `v3/@claude-flow/cli/src/ruvector/{model-router,neural-router,router-trajectory}.ts`
- Upstream: `@metaharness/router@0.3.2`, `@ruvector/tiny-dancer@0.1.22`
- Measured benches (this branch):
  - `docs/benchmarks/runs/cheap-models-2026-06-15-20-3*.json` — variance + Pareto
  - `docs/benchmarks/runs/midtier-models-2026-06-15-20-53-55Z.json` — LLM-judged mid-tier
  - `docs/benchmarks/runs/router-integrated-hybrid-seed42-2026-06-15T15-57-22Z.txt` — integrated routing bench
- Scripts: `scripts/benchmark-models.mjs`, `scripts/benchmark-models-midtier.mjs`, `scripts/benchmark-router.mjs`, `scripts/train-bundled-krr.mjs`, `scripts/gen-seed-corpus.mjs`
