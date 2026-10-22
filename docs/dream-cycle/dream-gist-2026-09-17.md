# Intelligence SOTA Report — 2026-09-17

**TL;DR**: Ruflo's discounted-Thompson-sampling model router (`priorDecay`, the primitive behind #3049) was built, unit-tested, and benchmarked back in 2026-08-17 — but shipped permanently inert: `DEFAULT_CONFIG.priorDecay` was hardcoded to `1` (disabled) with no env/config knob, unlike every sibling tunable in the same file. Last night's (2026-09-12) gist named this exact gap as tonight's recommended next step for a future `intelligence` night. Tonight wires `CLAUDE_FLOW_PRIOR_DECAY` in, mirroring the file's own existing `envMaxUncertainty()` pattern. Independent adversarial review returned **CONFIRMED-WITH-CAVEATS**: the fix itself is clean, but the underlying decay mechanism's benefit is real only in one of two benchmarked workload buckets — reported honestly below, not oversold.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Discounted Thompson Sampling for non-stationary bandits (decay α/β geometrically before adding new reward) | arXiv:2305.10718 | A |
| ReasoningBank distills from both successes *and* failures as title/description/content triples; raw-trajectory storage underperforms | arXiv:2509.25140 (ICLR'26) | A |
| ST-MoE-style load-balance/z-loss regularization is required alongside any online reward-update to a MoE gate, or logits risk collapse/blowup | arXiv:2202.08906 (A), arXiv:2604.17228 (B, 2026, separates stability- vs policy-oriented aux losses) | A/B |
| Zep/Graphiti bi-temporal knowledge-graph memory (fact validity intervals, non-lossy invalidation) | arXiv:2501.13956 | A |
| MCP 2026-07-28 spec: capability/extension negotiation is checked per-request at the protocol boundary, not declared-once | modelcontextprotocol.io spec + blog | A |

## Ruflo Current Capability

The intelligence pipeline (RETRIEVE→JUDGE→DISTILL→CONSOLIDATE) spans `cli/src/memory/intelligence.ts`, `neural/src/{reasoning-bank,pattern-learner,moe-router}.ts`, and `cli/src/ruvector/{model-router,enhanced-model-router,q-learning-router}.ts`. Tonight's deep dive re-confirmed the RETRIEVE→JUDGE→DISTILL handoff in `intelligence.ts` is correctly wired (no new bug there — the Fisher-gate and confidence/similarity bugs from prior nights are the only history here). The gap tonight is narrower and specific: `ModelRouter`'s decay primitive has correct math, correct numerical-stability floor (`PRIOR_DECAY_FLOOR=0.05`), correct malformed-input fallback — and zero way to actually turn it on in a live deployment.

## Competitor Comparison

| Competitor | Capability | Ruflo status | Grade | Note |
|---|---|---|---|---|
| AutoGen/AG2 | Continual adaptation from task outcomes across runs | **Ahead** — measured cross-process persistence + confidence updates; AG2 in maintenance mode, no comparable roadmap | B | — |
| OpenAI Responses/Assistants API | Persistent cross-session behavioral memory | **Ahead, structurally** — Ruflo ships persistence in-repo; OpenAI's APIs are stateless server-side, offloaded to 3rd parties | B | — |
| Qdrant/Weaviate | Binary quantization compression | **Parity** — measured real 32× compression | B | — |
| Qdrant/Weaviate | Native BM25/SPLADE hybrid fusion | **Partial** — Ruflo's "sparse" arm is stopword-filtered keyword extraction, not term-weighted retrieval | C | Scoping decision, not solved elsewhere |
| Zep/Graphiti | Bi-temporal fact-validity memory | **None** | A | Genuine open gap, unbuilt — not deliberately avoided, just never scoped. Strongest future-night candidate. |

## Hypothesis

Given a long-running Ruflo deployment where `.swarm/model-router-state.json` accumulates Thompson-sampling history across many sessions, when `priorDecay` is exposed via a `CLAUDE_FLOW_PRIOR_DECAY` env override (mirroring `envMaxUncertainty()`, default unchanged at `1`/disabled), then the router should recover faster from a real model-quality shift when an operator opts in, subject to: no change in default runtime behavior when unset (trivially true by construction — disclosed, not hidden), no numeric-stability regression (existing floor untouched), and no material stationary-workload accuracy loss (pre-declared ±1pp tolerance from the original #3049 benchmark, not invented tonight).

## Benchmarks

`benchmarks/results/scripts/prior-decay-benchmark.mjs` — 2 complexity buckets (low/med), paired-seed deterministic RNG, 30 trials each, stationary + non-stationary (mid-run model-quality shift) scenarios. Re-run tonight, independently re-run a second time by the adversarial critic: **byte-identical to the 2026-08-17 original receipt** both times.

## Evaluation

- **Code-level (stash-isolated)**: reverted only the source fix, kept the 3 new tests → 1/3 failed exactly as predicted (env var silently ignored). Restored fix → 16/16 pass (13 pre-existing + 3 new).
- **Full `@claude-flow/cli` suite, byte-identical both ways**: 221 pre-existing failures (unbuilt-dist/network-dependent integration tests, unrelated), 2497→2500 passed (+3, exactly our new tests), 105 skipped both ways.
- **`tsc --noEmit`**: 463 pre-existing errors, byte-identical error-line sets baseline vs candidate (diff clean).
- **Benchmark receipt** (both buckets, 30 trials, t-stats):
  - **low** bucket (haiku→sonnet shift): recovery 26.5→21.9 rounds (t=7.0, real win); post-shift accuracy +1.3pp (t=5.9); stationary Δ=+0.02pp (t=0.7, noise).
  - **med** bucket (sonnet→opus shift): recovery flat (t=−0.74); post-shift accuracy flat (t=−0.33); stationary Δ=**−0.08pp (t=−3.01)** — a small but statistically real regression, accepted only because it sits inside the pre-declared ±1pp tolerance band from the original 2026-08-17 receipt.
- **Independent adversarial critic** re-ran everything itself (not trusting the description): **CONFIRMED-WITH-CAVEATS**. No test/benchmark weakening, no gold-answer tampering, no evaluator exploitation, no cost-path touched, no injection surface, reward-hack checklist entirely clear. Explicit caveat: describe this as "safely exposes an existing opt-in knob, net-positive in the tested low-complexity bucket, negligible-but-real cost in med-complexity" — **not** an unqualified win.

## Darwin Results

`@metaharness/darwin@0.9.2` is available (confirmed via `ruvector harness status --json`) but was **not invoked**. The decay value (0.995) was already the subject of last month's own benchmark/selection; tonight's diff is a pure config-exposure wiring change with no new free parameter for Darwin to search — running it would add cost with no marginal evidence for this specific patch. Also probed `@metaharness/flywheel@0.1.10`'s `gate <evidence>`: its frozen conjunctive rule expects `{candidate,baseline}.{primary,noopRate,costPerWin}` — an executor-commit-rate shape that doesn't map onto this candidate's bandit-recovery evidence without fabricating a `noopRate` that doesn't exist here. Declined to force it rather than invent a metric.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `6f0ed7112873eedc7cfe17281a2585188190b790` |
| Gist SHA-256 (pre-witness content) | `e97f610c7699f729fbb4c738486f0201e21230b185006dca2da6116da8d5938a` |
| Witness stamp | `91d8edc3bf54252f847c593d1e2bd7a7f4e50afae5a18bdf558d9329ebf57715` |
| Evaluation receipt | `v3/@claude-flow/cli/benchmarks/results/prior-decay-receipt.json` (regenerated 2026-09-17, byte-identical to 2026-08-17 original) |
| Flywheel evidence | N/A — schema mismatch disclosed above (gate rule expects executor commit/no-op-rate shape), declined to fabricate a metric |
| Darwin lineage | N/A — not invoked, rationale disclosed above |

Verifier procedure: fetch this gist, strip the witness table's filled values back to `PENDING`, SHA-256 the result, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Scan Findings: capabilities

`plugins install` (`v3/@claude-flow/cli/src/commands/plugins.ts` → `plugins/manager.ts`) fetches a registry `PluginEntry` only to print its name/version, then unconditionally `npm install`s it — never checking the entry's declared `permissions`/`trustLevel`/`securityAudit` against `PluginStoreConfig.allowedPermissions`/`minTrustLevel`/`requireVerification`, despite all of that being fully modeled in `store/types.ts` and named in `SECURITY.md` as the privilege-escalation mitigation. Bonus: `plugins.ts`'s `--verify` flag (checksum verification, "default: true") is parsed into a local var and never read again. Not selected (SCAN surface); real gap for a future `capabilities`/security night.

## Scan Findings: memory

`hnsw-index.ts`'s `binaryQuantize()`/`scalarQuantize()` produce bit-packed/min-range-polluted arrays, but `distance()` only special-cases quantization for `'product'` (the already-fixed #3093/#3094 bug) — `'binary'` and `'scalar'` fall through to generic cosine/euclidean/dot computed directly on the packed representation, numerically meaningless. No `binaryQuantizeDistance()`/`scalarQuantizeDistance()` exists. Also: CLAUDE.md's "RaBitQ Quantization — Measured" claim has zero matching implementation under `grep -ri rabitq` in `memory/src`. Not selected (SCAN surface); strong candidate for a future `memory` DEEP night.

## Competitors Reviewed

AutoGen/AG2, OpenAI Responses/Assistants API, CrewAI/LangGraph (context), Qdrant, Weaviate, Milvus, LanceDB, Zep/Graphiti, MCP 2026-07-28 spec (capabilities scan), OpenAI Agents SDK function-calling strict mode (capabilities scan).

## Recommended Next Steps

1. **Ship `SONAAdapter.forceLearningCycle()` wiring** (`v3/@claude-flow/integration/src/sona-adapter.ts:664`) — the periodic consolidation timer calls `consolidatePatterns()` directly instead of `forceLearningCycle()`, so `learningCycleCount`/`stats.learningCycles` stay permanently 0 and periodic pruning never runs automatically. One-line fix, existing test file, smallest/safest candidate surfaced tonight — good for tomorrow.
2. **MoE gate online learning, as a themed 2-part sequence**: `moe-router.ts`'s `updateExpertWeights()` (full REINFORCE update, exported, tested in isolation) has **zero production callers** — the live `mode==='moe'` path only ever calls the forward pass — despite CLAUDE.md asserting "MoE Gate converges — confidence 0.13→0.88" as **Measured** with no in-repo source for that number. Wiring the reward callback is real value, but ST-MoE literature (arXiv:2202.08906) warns an unregularized reward update risks gate collapse — so pair it with also wiring the already-computed-but-discarded `computeLoadBalanceLoss()`/`loadBalanceCoef` into the same gradient step, in the same night, not sequentially.
3. **HNSW binary/scalar quantization distance dispatch** (`v3/@claude-flow/memory/src/hnsw-index.ts`) — same bug class as the already-fixed product-quantization dispatch bug (#3093/#3094), left unfixed for the other two `QuantizationConfig.type` values: `binaryQuantize()`/`scalarQuantize()` pack bit-masks/min-range-polluted arrays that then get cosine/euclidean/dot distance computed directly on the packed representation — numerically meaningless, silently, for any caller using `type: 'binary'` or `'scalar'`.

Also flagged, lower priority: `plugins install` never enforces its own declared `permissions`/`trustLevel`/`--verify` checksum gate against `allowedPermissions` config (capabilities scan); CLAUDE.md's "RaBitQ Quantization — Measured" claim has zero matching implementation under `grep -ri rabitq` in `memory/src` (memory scan, needs follow-up); Zep-style bi-temporal fact memory is a well-specified, A-grade-sourced, structurally new capability worth a dedicated future night.
