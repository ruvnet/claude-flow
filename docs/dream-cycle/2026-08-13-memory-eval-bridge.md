# Memory Evaluation Bridge — 2026-08-13

**TL;DR:** BM25+semantic fusion retrieval beats semantic-only cosine on a small,
honest 20-query memory-QA corpus (recall@1 +0.15, MRR +0.11) — but the effect
is not statistically significant at this sample size (McNemar exact binomial
p=0.25, only 3 informative pairs) and the embedding used is a deterministic
hashed bag-of-words stand-in, not AgentDB's production ONNX backend. Verdict:
**INCONCLUSIVE** — real, positive, reproducible directional evidence; not yet
promotion-quality.

---

## Why this document exists instead of a new SOTA report

Today's rotation (`SLOT=3 → DEEP=memory, SCAN=plugins,automation`) was already
run by the prior (v1) Dream Cycle instance at **2026-08-13T06:12 UTC**, hours
before the v2 prompt upgrade (PR #3018) merged at 14:20 UTC the same day. That
run produced:

- Issue [#3008](https://github.com/ruvnet/ruflo/issues/3008) — SOTA research
  (TOKI bitemporal contradiction resolution, Mem0/MAGMA multi-signal
  retrieval, plugins/automation scans)
- Draft PR [#3009](https://github.com/ruvnet/ruflo/pull/3009) — ADR-382
  proposal + the research gist, **no benchmark, no evaluation receipt**

Re-running full fresh research for the same date/surface would be exactly the
duplicate, non-additive activity the ledger system (seeded the same day, same
PR #3018) exists to prevent — the ledger's own stated purpose is "94% of prior
findings never touched," and producing issue #78 of that pattern on the same
night as issue #77 helps no one. Per this session's Global Invariants
("optimize for reducing uncertainty about what Ruflo should become," not for
producing a PR), the higher-value action is to supply the one thing #3008/#3009
lack: **a genuine evaluation receipt** — the exact gap the v2 prompt exists to
close, per PR #3018's own STEP 3.5 rationale.

This document is that evaluation, scoped to Recommended Next Step 3 from
#3009 ("Add LoCoMo + LongMemEval benchmark harness") and a bounded test of
Recommended Next Step 2 ("multi-signal retrieval fusion").

---

## Frozen Hypothesis

> Given a memory-QA workload of fact-storage/fact-recall query pairs,
> when semantic cosine retrieval is fused with BM25 keyword scoring
> (fixed weight, 0.7 semantic / 0.3 BM25 — the two-signal subset of
> ADR-382's proposed 0.6/0.3/0.1 semantic/BM25/entity fusion),
> then recall@1 should improve relative to semantic-only cosine retrieval,
> subject to: gold answers frozen before either strategy runs; same
> document set and same embedding function for both arms; no change to
> corpus after baseline is measured.

Frozen before evaluation began; not modified after (see file history of
`scripts/benchmark-memory.mjs`).

---

## Benchmark Corpus

- **Path:** `scripts/benchmark-memory.mjs` (`HONEST_CORPUS` + `DISTRACTORS`
  constants — corpus is inline, not a separate data file, to keep this a
  single-file, single-command, reproducible artifact)
- **Task count:** 20 fact/query pairs + 5 "belief-drift" distractors (near-
  duplicate wording of a superseded fact for the same topic — the exact
  last-writer-wins confusion case #3008/ADR-382 describe)
- **Task category:** single-hop fact recall over a short memory store —
  a minimal, hand-written analog of LoCoMo/LongMemEval-style QA, **not** a
  reproduction of those datasets (1,540/500 questions — out of scope for one
  night)
- **Gold source:** hand-authored by this session, frozen in the script
  before any retrieval strategy ran
- **Determinism:** no randomness anywhere in the pipeline (no seed needed)

## Honesty Notes (do not skip)

1. **Embedding backend:** deterministic feature-hashed bag-of-words
   (dims=128), not `@claude-flow/embeddings`'s production ONNX/agentic-flow
   backend. That package has no built `dist/` in this checkout, and pulling
   a real model needs network access this run could not verify. Following
   this repo's own `benchmark-intelligence.mjs` convention ("embedding
   backend reported HONESTLY as its own item"), this is disclosed rather
   than silently degraded to a "mock" label that reads as more authoritative
   than it is. **This measures whether BM25 fusion helps on top of a
   cosine-retrieval shape in general — it is not an AgentDB production
   LoCoMo score.**
2. **Sample size:** n=20 queries is small. The paired significance test
   below is reported honestly as non-significant, not rounded up.
3. **No gold-answer tampering:** the candidate implementation cannot see or
   modify `HONEST_CORPUS`'s id↔query mapping; both arms score against the
   same frozen document set.

---

## Baseline vs Candidate

| strategy | recall@1 | recall@3 | MRR |
|---|---|---|---|
| baseline — semantic-only cosine | 0.450 | 0.650 | 0.562 |
| candidate — semantic+BM25 fusion (w=0.7) | 0.600 | 0.700 | 0.672 |

**Effect:** recall@1 +0.15, recall@3 +0.05, MRR +0.11 (candidate − baseline).

**Significance:** McNemar exact binomial test on recall@1 discordant pairs —
3 informative pairs (candidate-right-baseline-wrong = 3, the reverse = 0),
**p = 0.25**. Not significant at α=0.05. With only 3 informative pairs, no
paired test on this corpus size could reach significance without a much
larger or harder corpus — this is the honest ceiling of a 20-query eval.

**Reproduce:** `node scripts/benchmark-memory.mjs`

---

## Darwin-style Bounded Exploration

The real `npx ruvector harness darwin <config> --execute` and
`npx ruvector harness flywheel gate <evidence>` CLIs (both loaded,
`@metaharness/darwin@0.8.0` and `@metaharness/flywheel@0.1.7`, confirmed via
`ruvector harness status --json`) were invoked against this candidate's
evidence:

- `flywheel gate` **ran successfully** against a constructed evidence JSON
  but returned `{"promote": false, "reasons": ["noop_rate_not_improved"]}` —
  its frozen gate schema expects harness-genome fields (e.g. `noop_rate`)
  this application-level retrieval candidate doesn't produce. The output is
  real but not informative for this candidate's actual hypothesis.
- `darwin <config> --execute` **crashed** (`ERR_INVALID_ARG_TYPE` on an
  internal `path.join` — the config schema expects a work-root path this
  ad hoc evidence file didn't provide).

Both results are reported as-observed, not smoothed over: these two tools
target MetaHarness's own genome-parameter surface (routing/prompt/topology),
not arbitrary application-code diffs like a retrieval-fusion function. This
is a real, useful negative finding for STEP 0.5's capability inventory —
future harness-shaped candidates (routing weight, prompt template, tier
policy) should use these tools directly; application-level candidates like
this one need a bespoke evaluator, which is what `benchmark-memory.mjs` is.

Given that, a **manual bounded sweep** (5 candidates, 1 generation — within
the prompt's default Darwin budget) was run over the fusion weight:

| semantic weight | recall@1 | recall@3 | MRR |
|---|---|---|---|
| 0.5 | 0.600 | 0.700 | 0.674 |
| 0.6 | 0.600 | 0.700 | 0.673 |
| 0.7 | 0.600 | 0.700 | 0.672 |
| 0.8 | 0.600 | 0.700 | 0.670 |
| 0.9 | 0.550 | 0.700 | 0.642 |

**Winner:** semantic weight 0.5 (recall@1=0.600, MRR=0.674) — marginally
better than the 0.7 weight this evaluation led with, and close to ADR-382's
proposed 0.6 semantic weight. All five weights in [0.5, 0.8] tie on recall@1;
weight 0.9 (near-pure-semantic) is the only lineage point that regresses,
which is itself evidence that *some* BM25 contribution matters on this
corpus, but the exact weight is not sensitive within a broad range.

Failed/non-improving lineage point (weight=0.9) is retained above rather
than discarded, per STEP 12.2.

---

## Adversarial Critique (self-administered — no separate evaluator agent was
spawned for this scoped, single-file candidate; questions from STEP 10
answered directly)

| Question | Answer |
|---|---|
| Weakened the benchmark? | No — corpus fixed before either arm ran |
| Altered gold answers? | No |
| Cherry-picked tasks? | No — all 20 corpus queries scored, both arms |
| Exploited the evaluator? | No — evaluator is the same 12-line loop for both arms |
| Increased cost materially? | No — $0, no LLM calls, pure JS, sub-second |
| Latency regression? | N/A — not a runtime path change |
| Quality regression elsewhere? | No — zero production files touched |
| Moved work elsewhere? | No |
| Undocumented cache? | No |
| Modified test thresholds? | No — no pre-existing thresholds for this metric |
| Leaked expected answers to candidate? | No — candidate function receives only query + corpus, not gold ids |
| Fair baseline? | Yes — identical corpus, identical embedding function, only the ranking formula differs |
| Statistically meaningful? | **No — p=0.25, disclosed above, not rounded up** |
| Would it survive a different workload? | Unknown — single small corpus; explicitly flagged as the biggest open uncertainty |

## Reward Hack Check

`@metaharness/weight-eft` ("reward-hack detector", v0.1.1) is loaded as a
library dependency inside the `ruvector` harness bundle (confirmed via
`ruvector harness status --json`) but exposes no standalone CLI entry point
(`npx @metaharness/weight-eft --help` produced no output; no local package
found to invoke programmatically within this session's scope). The manual
STEP 11 checklist (test weakening, benchmark weakening, leakage, hardcoded
outputs, metric substitution, task removal, seed manipulation, hidden
preprocessing, error suppression, cost hiding) was walked by hand above —
no unresolved signal found. This gap (no CLI entry point for a loaded reward-
hack detector) is itself worth a follow-up issue if future candidates need
it more than this one did.

## Security Review

The candidate is a single new, dependency-free, offline script
(`scripts/benchmark-memory.mjs`) that reads no external input, writes no
files, makes no network or shell calls, and does not touch AgentDB's
production write or read path. No prompt-injection, credential, filesystem,
or network exposure. Reviewed for regex/eval risk: none present (pure
arithmetic + string tokenization).

---

## Verdict

```
evaluation_complete = true
effect_positive     = true   (+0.15 recall@1, +0.11 MRR)
significance_sufficient = false  (p=0.25, n=20, 3 informative pairs)
no_material_regression  = true   (additive-only file)
reward_hack_clear   = true (manual checklist; no CLI-based detector run)
critic_clear        = true (self-administered, single-file low-risk candidate)
witness_valid        = true (below)
receipt_reproducible = true (node scripts/benchmark-memory.mjs, deterministic)
```

**VERDICT: INCONCLUSIVE.** The candidate shows real, positive, reproducible
directional evidence that BM25 fusion helps recall on this retrieval shape,
but the sample is too small to promote. This is not a failure: it converts
#3008's "Not measured (grade C)" claims into an honestly-measured, if
underpowered, first data point, and it identifies exactly what's needed next
(see below).

## What Would Resolve the Uncertainty

1. **Wire the real embedding backend** — build `@claude-flow/embeddings`'s
   `dist/`, run with `provider: 'agentic-flow'` or `'transformers'` (network
   permitting) instead of the hashed-BoW stand-in, and re-run this exact
   harness.
2. **Grow the corpus** — 20 queries → at minimum 60–100 to have a realistic
   chance at McNemar significance if the true effect size holds; ideally
   sample from real LoCoMo/LongMemEval subsets under license.
3. **Give `@metaharness/darwin`/`flywheel` a harness-genome hook** for
   application-level candidates like retrieval fusion weights, so future
   nights don't have to hand-roll a bounded sweep.

---

## Witness

| Key | Value |
|---|---|
| Session commit | `abf26ab0977cd999ad8e90bb473c63c40ba69e83` |
| Report SHA-256 | `2cf70a414eb9b0fad8283b0e4f39ac62c75160eeef8d1e6c12ea6471d26fa53e` (pre-witness-table snapshot; see verification note) |
| Witness stamp | `5c1d37b19fa90371ed05ae0aeea03d65bfc2851b5ecce65bd49b6c47a1fb00c9` (pre-witness-table snapshot; see verification note) |
| Evaluation receipt | `scripts/benchmark-memory.mjs` output, `===BENCH_JSON===` block, reproducible via `node scripts/benchmark-memory.mjs` |
| Darwin lineage | 5-point manual sweep, table above |
| Flywheel evidence | `flywheel gate` invoked, schema-mismatch result recorded above (not a promotion signal) |

**Verify:** `sha256sum docs/dream-cycle/2026-08-13-memory-eval-bridge.md` →
concatenate with the session commit above → `sha256sum` again → must equal
the witness stamp recorded in the tracking issue/PR.
