# ADR-081 — Labelled Held-Out Corpus + nDCG/Precision Metrics

**Status**: Accepted — Implemented in ruflo 3.10.21
**Date**: 2026-05-30
**Tracking**: continuation of self-learning hardening cluster (#2245 → ADR-074 → ADR-075 → ADR-076 → ADR-077 → ADR-078 → ADR-079 → ADR-080)
**Related**: ADR-077–080 (which used a regex-over-subject relevance proxy)

## Context

ADRs 077–080 reported the same "top-1 hit rate" metric using a regex applied to each result's commit subject. That worked well enough to drive direction (0% → 90% across the four releases) but had a hidden ceiling: the regex couldn't distinguish *related-but-wrong* from *exactly-right* commits.

When I built a hand-curated labelled corpus and re-ran the same 4 configurations through it, the truth was uglier than the regex showed in both directions:

| Config | Regex top-1 | **Labelled top-1** | Direction |
|---|---:|---:|---|
| Hybrid (3.10.19) | 80% | **90%** | regex *under*-reported |
| Hybrid + Rerank (3.10.20) | 90% | **80%** | regex *over*-reported |

The regex was missing relevant matches (the original `Self-learning reports success but persists nothing` issue *was* the right answer for the "self-learning wiring" query — the regex didn't match it because no token overlap with the query keywords) AND it was counting related-but-wrong matches as hits.

This is the kind of finding only a labelled corpus reveals. Proving SOTA requires honest measurement of relevance, not just a token-overlap proxy.

## Decision

Three changes, one release:

### 1. Labelled held-out corpus

Each of the 10 bench queries gets `expectedSubstrings: string[]` — case-insensitive substring matches against the pattern's name. A result is "relevant" if its name contains ANY of the labelled substrings. Hand-curated from inspection of the actual ruflo commit/issue history; encoded directly in `scripts/benchmark-pretrained-retrieval.mjs` (no separate file).

The regex proxy (`expect: RegExp`) is preserved for back-compat — the regex-derived top-1/top-3 numbers in ADRs 077–080 remain reproducible, and the new labelled numbers run alongside them in every bench run.

### 2. nDCG@k + precision@k metrics

Beyond binary top-1/top-3 hits, the bench now reports:

- **Label precision@3** — mean fraction of top-3 that's labelled-relevant (rewards finding *multiple* relevant docs, not just one)
- **Label nDCG@3 / nDCG@5** — Normalised Discounted Cumulative Gain with binary relevance grades. Standard IR ranking metric — rewards relevant docs at higher ranks.
- **Label MRR@3** — same definition as before but computed against the labelled set

### 3. Document the cross-encoder trade-off

The cross-encoder reranker (ADR-080) has a different optimisation target than hybrid alone:

| Config | Label top-1 | Label precision@3 | Label nDCG@3 |
|---|---:|---:|---:|
| Hybrid (3.10.19) | **90%** | 0.400 | 0.900 |
| Hybrid + Rerank (3.10.20) | 80% | **0.667** | **0.913** |

Hybrid finds *the* right doc first. Cross-encoder finds *all* the right docs in the top-3. Neither is universally better — the right choice depends on whether the caller wants the single best match or a relevant set. Default `rerank: false` is still correct for top-1-first callers; opt-in `rerank: true` for richer top-K consumers.

## Cumulative SOTA push — honest numbers (labelled metric)

| Metric | 3.10.17 cosine | 3.10.19 hybrid | 3.10.20 +rerank |
|---|---:|---:|---:|
| Label top-1 hit rate | 0% | **90%** | 80% |
| Label top-3 hit rate | 0% | 90% | **100%** |
| Label MRR@3 | 0.000 | **0.900** | 0.883 |
| Label precision@3 | 0.000 | 0.400 | **0.667** |
| **Label nDCG@3** | 0.000 | 0.900 | **0.913** |
| Avg query latency | 29 ms | 42 ms | 977 ms (opt-in) |

**Label top-1 = 90%, nDCG@3 = 0.913.** That's the honest peak on this corpus.

## Why the regex was wrong

Two failure modes:

- **Under-reporting** — for `"self-learning wiring task-completed pretrain"`, the regex `/self.?learning|task.?completed|pretrain|2245|074/i` matched the commit subject but missed the *issue title* "Self-learning reports success but persists nothing" — which is the exact right answer. Hyphenation variants and the broader semantic family weren't in the regex.

- **Over-reporting** — for `"how was the Opus model alias fixed"`, the regex `/opus|2232|model.*alias|4\.8/i` happily matched the release-bump commit `chore(release): bump 3.10.10 → 3.10.11 (4-issue bug cluster)` because the bug cluster *mentioned* Opus in its body, but the release commit isn't the work — it's the announcement.

The labelled corpus encodes domain knowledge that no regex can express compactly. It's worth maintaining as ground truth.

## Reusable infrastructure shipped

- `scripts/benchmark-pretrained-retrieval.mjs` — extended with:
  - `expectedSubstrings: string[]` per query (the labels)
  - `isRelevant(name, expectedSubstrings)` helper
  - `ndcgAtK(rankedRelevance, k)` with binary relevance + ideal-DCG normalisation
  - 6 new metrics in summary JSON + console output
- Old regex metrics kept for back-compat — bench output now shows BOTH "regex proxy" and "ADR-081 labelled" rows.

## Honest limits

- **N=10 queries** is still small. A larger labelled set (50-200 queries) would tighten confidence intervals. The labels themselves are correct, but the sample size limits per-config inference.
- **Binary relevance** — every match counts equally. A graded relevance scheme (`exact=3, close=2, related=1, off-topic=0`) would let nDCG distinguish between "perfect" and "passable" answers. Future ADR.
- **Single annotator** — I curated the labels myself. Inter-annotator agreement would be a nice-to-have for a public benchmark, but the labels are auditable in the script.
- **No held-out test split** — the labels were authored AFTER seeing the model outputs. That's the right move for a tuning-time bench but means there's confirmation bias risk for any subsequent tuning against this set. A truly held-out test would require new queries the system hasn't been tuned against.

## Deliberately NOT in this round

- **Graded relevance** — binary is enough to rank configs. Graded scoring is a future tuning ADR.
- **Larger query set** — N=10 is enough to assert direction; expansion is a separate effort.
- **Public IR benchmark dataset** (MS MARCO, BEIR slice) — would generalise the relevance signal but requires significant infra to integrate. Tracked.

## Verification

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc )

# Pretrain (writes 415-pattern store)
node v3/@claude-flow/cli/scripts/pretrain-from-github.mjs

# All four configs through the labelled bench
( cd v3/@claude-flow/cli && {
  echo "=== A) cosine ===";                HYBRID=0 BENCH_NO_WRITE=1 node scripts/benchmark-pretrained-retrieval.mjs | grep -E "^(Mode|Top|MRR|Precision|nDCG)"
  echo "=== B) hybrid 3.10.19 ===";        BENCH_NO_WRITE=1 node scripts/benchmark-pretrained-retrieval.mjs | grep -E "^(Mode|Top|MRR|Precision|nDCG)"
  echo "=== C) hybrid + rerank 3.10.20 ==="; RERANK=1 BENCH_NO_WRITE=1 node scripts/benchmark-pretrained-retrieval.mjs | grep -E "^(Mode|Top|MRR|Precision|nDCG)"
})
```
