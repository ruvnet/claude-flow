# ADR-086 — Silent-Fallback Bug Story + Bootstrap Significance Testing

**Status**: Accepted — Implemented in ruflo 3.10.26
**Date**: 2026-05-30
**Tracking**: continuation of self-learning hardening cluster (ADR-077 → ... → 085)
**Related**: ADR-085 (BEIR harness)

## Context

Two threads from the BEIR work that deserve their own ADRs:

1. **The silent-fallback embedder bug.** While building ADR-085's BEIR harness on darwin-arm64, every retrieval result looked plausible but cosine similarity scores were essentially random. The neural store reported `_realEmbedding: true`. The hash-fallback was carrying the entire dense signal — and we didn't know it. This is the kind of bug that *steals years of debugging* from people who don't notice.

2. **Statistical significance on the 0.005 SPLADE++ gap.** Our NFCorpus result (0.352) is 0.005 above SPLADE++ (0.347). The natural pushback is "noise" — and with N=323 queries it's a fair pushback. We need a paired bootstrap CI to either confirm the gap is real or admit it's not.

Both are about honesty in reporting, not new features.

## Decision

### 1. Bug story: silent hash-fallback path

**Root cause chain:**

```
neural_patterns store action
  → realEmbeddings.embed(text)
    → agentic-flow/reasoningbank.computeEmbedding(text)
      → @xenova/transformers pipeline('feature-extraction', 'all-MiniLM-L6-v2')
        → @xenova/transformers loads tokenizer + sharp (for image models)
          → require('sharp')
            → require('../build/Release/sharp-darwin-arm64v8.node')
              → MODULE_NOT_FOUND
            ↓ THROWS
          ↓ THROWS
        ↓ THROWS
      ↓ but the THROW happens per-CALL, not at import time
    ↓ neural-tools wraps each call in try/catch and silently hash-falls-back
  ↓ store returns successfully
↓ neural_patterns reports _realEmbedding: true (because realEmbeddings is non-null at module-load)
```

**Where the lie lives:** `src/mcp-tools/neural-tools.ts` initialises
`realEmbeddings = { embed: ... }` at module load by importing
`agentic-flow/reasoningbank`. That import succeeds even when the
downstream `transformers.js → sharp` chain breaks — because the import is
just type metadata, not an actual model load. The lazy model load happens
on the first `computeEmbedding()` call, which throws. The outer try/catch
swallows it and silently falls back to hash. But `_realEmbedding` was set
to `true` based on the import success.

**What we did about it:**

- **Bypassed the sharp dependency** in ADR-085 by loading BGE directly
  via `@xenova/transformers` `AutoTokenizer` + `AutoModel`. Text bi-encoders
  don't need image preprocessing — `sharp` is a transitive dep of the
  full pipeline that's never needed for retrieval.
- **Discovered it via the BEIR bench.** A 0.262 nDCG@10 result (vs BM25
  published 0.325) was suspicious enough to investigate. Without an
  external benchmark, the bug could have persisted indefinitely because
  every internal test passed (since hash-based embeds are deterministic
  and our internal labels are short tokens that BM25 dominates anyway).
- **Documented in `BEIR-MATRIX.md`** and ADR-085 §"sharp-on-darwin-arm64
  bug" so users on other platforms know to check.

**What we did NOT do** (deferred to a separate fix):
- Fix the underlying `_realEmbedding: true` lie when per-call embeds
  throw. The honest fix is a probe-embed at module load that updates
  the flag if it fails. That's a real change in `neural-tools.ts` and
  warrants its own dedicated tracking. Leaving as known issue with the
  bypass.

**The lesson:** every "is the embedder real?" check needs to verify an
actual embed succeeded, not just that the import didn't throw. Type-load
success ≠ runtime correctness. External benchmarks expose the gap because
they don't share the bias of internal labels.

### 2. Paired bootstrap significance test

`scripts/beir-bootstrap-significance.mjs` — given a run JSON with
`perQuery: Array<{qid, ndcg10, ...}>`, computes:

- **1-sample bootstrap CI** on the mean nDCG@10 (10K resamples, deterministic
  mulberry32 seed=42). 95% CI for the point estimate.
- **CI overlap test vs each published baseline** — if our 95% CI lower
  bound exceeds the baseline, the difference is significant at p<0.05.
- **Paired bootstrap** (via `--paired <other-run.json>`) — resamples the
  per-query *differences* between two runs. The one-sided p-value tells us
  if our run is significantly above (or below) the baseline. The 95% CI on
  the difference gives both magnitude and uncertainty.

Why paired matters: the same hard queries are hard for everyone. A
1-sample test treats query difficulty as noise; the paired test conditions
on it. This is what BEIR papers report.

**Reusable as `BEIR_DATA_DIR=... node beir-bootstrap-significance.mjs`** on
any run JSON our bench emits.

### 3. Per-query metrics in run JSON

Extended `scripts/run-beir-bge.mjs` to save `perQuery: [{qid, ndcg10,
mrr10, recall10, recall100}, ...]` in every run JSON. Without this,
external bootstrap CI testing isn't possible.

### 4. BEIR matrix page

`docs/benchmarks/BEIR-MATRIX.md` — dataset × model × metric grid. Every
cell links to its run JSON and reproduction command. The honest-reporting
counterpart to the leaderboard table in ADR-085.

## Measured proof — bootstrap CIs on both datasets

### NFCorpus (N=323 queries, bootstrap 10k seed=42)

```
=== Our nDCG@10 (1-sample bootstrap CI) ===
  point:    0.3517
  95% CI:   [0.3171, 0.3873]

=== vs each published baseline (CI overlap) ===
  0.272  SBERT msmarco              Δ=+0.0797  ↑ above   [p<0.05 — significant win]
  0.305  ColBERT                    Δ=+0.0467  ↑ above   [p<0.05 — significant win]
  0.319  TAS-B                      Δ=+0.0327  ↑ above   n.s.
  0.319  GenQ                       Δ=+0.0327  ↑ above   n.s.
  0.325  BM25 (Lucene)              Δ=+0.0267  ↑ above   n.s.
  0.328  DocT5query                 Δ=+0.0237  ↑ above   n.s.
  0.328  Contriever                 Δ=+0.0237  ↑ above   n.s.
  0.343  GTR-XL                     Δ=+0.0087  ↑ above   n.s.
  0.347  SPLADE++                   Δ=+0.0047  ↑ above   n.s.
  0.380  BGE-large-v1.5             Δ=-0.0283  ↓ below   n.s.
```

**Two significant wins** (SBERT, ColBERT). Seven point-estimate wins are within sampling noise (n.s.) — the "rank-2" headline is a single-realisation outcome, not a statistically distinguishable lead over SPLADE++/GTR-XL/BM25 etc. **The 0.005 SPLADE++ gap is noise**, as expected.

### SciFact (N=300 queries, bootstrap 10k seed=42)

```
=== Our nDCG@10 (1-sample bootstrap CI) ===
  point:    0.6256
  95% CI:   [0.5772, 0.6723]

=== vs each published baseline (CI overlap) ===
  0.555  SBERT msmarco              Δ=+0.0706  ↑ above   [p<0.05 — significant win]
  0.643  TAS-B                      Δ=-0.0174  ↓ below   n.s.
  0.644  GenQ                       Δ=-0.0184  ↓ below   n.s.
  0.662  GTR-XL                     Δ=-0.0364  ↓ below   n.s.
  0.671  ColBERT                    Δ=-0.0454  ↓ below   n.s.
  0.675  DocT5query                 Δ=-0.0494  ↓ below   [p<0.05 — significant loss]
  0.677  Contriever                 Δ=-0.0514  ↓ below   [p<0.05 — significant loss]
  0.679  BM25 (Lucene)              Δ=-0.0534  ↓ below   [p<0.05 — significant loss]
  0.704  SPLADE++                   Δ=-0.0784  ↓ below   [p<0.05 — significant loss]
  0.722  BGE-large-v1.5             Δ=-0.0964  ↓ below   [p<0.05 — significant loss]
```

**One significant win** (SBERT). **Five significant losses** including to BM25. SciFact is a fact-verification benchmark where exact scientific terms favor lexical retrieval; zero-shot BGE-base doesn't have the in-domain training that BGE-large + SPLADE++ have.

### The two-dataset truth

| System | NFCorpus | SciFact | Mean |
|---|---:|---:|---:|
| BGE-large-v1.5 (335M, published) | 0.380 | 0.722 | 0.551 |
| **ruflo + BGE-base-en-v1.5 (110M)** | **0.352** | **0.626** | **0.489** |
| SPLADE++ | 0.347 | 0.704 | 0.526 |
| BM25 (Lucene) | 0.325 | 0.679 | 0.502 |

**On the two-dataset mean, we lose to BM25** (0.489 vs 0.502). The NFCorpus rank-2 is real but not representative. The acceptance test "beats BM25 on both datasets" fails — and reporting that honestly is the point of this ADR.

## Honest limits

- **N=323 is the dataset's full test split** — we can't add more queries
  without leaving NFCorpus.
- **Bootstrap assumes per-query independence** — true for IID query sets,
  approximately true for BEIR.
- **The `_realEmbedding: true` lie is not yet fixed** in `neural-tools.ts`;
  the BGE bypass works around it but other call paths through
  `neural_patterns` may still report the wrong flag value. Tracked.

## Deliberately NOT in this round

- **Fix the `_realEmbedding: true` lie** at source — needs a probe-embed
  at module init. Tracked separately.
- **Lucene-style BM25 improvements** to close our 0.289 → 0.325 BM25 gap.
  Stemming + bigger stopword list would help; not in scope here.

## Verification

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc )

# Re-run the NFCorpus bench with updated harness (writes perQuery to JSON)
cd /tmp/beir-nfcorpus
SKIP_INGEST=1 node /path/to/scripts/run-beir-bge.mjs

# Bootstrap significance test (10K resamples, ~1s)
node /path/to/scripts/beir-bootstrap-significance.mjs \
  /path/to/docs/benchmarks/runs/beir-nfcorpus-bge-latest.json

# Paired test vs our pure-BM25 baseline
node /path/to/scripts/beir-bootstrap-significance.mjs \
  /path/to/docs/benchmarks/runs/beir-nfcorpus-bge-latest.json \
  --paired /path/to/docs/benchmarks/runs/beir-nfcorpus-2026-05-30T19-16-23-024Z.json
```
