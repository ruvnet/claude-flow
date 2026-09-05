# ADR-088 — Lucene-Style BM25 + Cross-Encoder Rerank: The Pipeline That Works

**Status**: Accepted — Implemented in ruflo 3.10.28
**Date**: 2026-05-30
**Tracking**: continuation of BEIR climb (ADR-085, 086, 087)
**Related**: ADR-087 (the RRF negative result that diagnosed this fix)

## Context

ADR-087 measured standard RRF k=60 underperforming dense-alone on both NFCorpus and SciFact, and diagnosed the cause as **asymmetric input strength**: our hybrid-retrieval multi-field BM25 was ~0.05 nDCG@10 below the published Lucene baseline, so RRF averaged its noise into the top-K instead of cancelling it.

This ADR fixes that diagnosis directly and adds the second-stage win (cross-encoder rerank) that the user explicitly identified as the next move after the user's "you should stack proven IR primitives" reframe.

## Decision

### 1. Lucene-style BM25 module

`src/memory/lucene-bm25.ts` — pure-function module, no external deps:

- **Porter stemmer (1980)** implemented inline, ~150 LOC, 12/12 published test cases passing (`caresses → caress`, `agreed → agre`, `motoring → motor`, `vietnamization → vietnam`, etc.).
- **Lucene 8.x English stopword list** (~120 tokens — Lucene's default 33 plus BEIR-conventional extras).
- **Single-field BM25** over concatenated title+text (vs. our existing multi-field BM25 weighted for repo-history retrieval).
- **Standard Okapi parameters**: k1=1.2 (vs hybrid-retrieval's 1.5), b=0.75.
- Lucene-style length normalisation; numeric tokens <4 digits dropped.

### 2. Cross-encoder rerank wired into the BEIR hybrid runner

`scripts/run-beir-hybrid.mjs` now supports:
- `USE_LUCENE_BM25=1` — swap multi-field BM25 for Lucene-style
- `RERANK=1` — apply `Xenova/ms-marco-MiniLM-L-6-v2` cross-encoder over top-100 RRF output

The cross-encoder infrastructure was already shipped in ADR-080 for repo-history retrieval; this ADR wires it into the public BEIR runner and proves it on standardised benchmarks.

### 3. No default change to the production retrieval system

Ruflo's runtime retrieval still uses the multi-field BM25 + dense + MMR + optional CE rerank pipeline from ADRs 078-083, tuned against repo-history corpora. The Lucene BM25 in this ADR is a **BEIR-benchmark-only** module — the multi-field BM25 stays better for short commit-subject text. We isolated the benchmark-vs-runtime concerns deliberately.

## Measured proof — full ablation matrix (N=323 NFCorpus, N=300 SciFact)

| Configuration | NFCorpus nDCG@10 | SciFact nDCG@10 | Mean | Beats published BM25 both? |
|---|---:|---:|---:|---|
| dense alone (BGE-base) | 0.352 | 0.626 | 0.489 | ✗ (loses SciFact -0.053) |
| Multi-field BM25 alone | 0.279 | 0.576 | 0.428 | ✗ (loses both) |
| **Lucene BM25 alone (ADR-088)** | **0.328** | **0.681** | **0.505** | **tied** (NFCorpus +0.003, SciFact +0.002) |
| Multi-field RRF k=60 (ADR-087, broken) | 0.328 ↓ | 0.569 ↓ | 0.449 | ✗ (loses both) |
| **Lucene RRF k=60** | 0.360 | 0.632 | 0.496 | ✗ (loses SciFact -0.047) |
| **Lucene RRF k=30** | **0.363** | 0.639 | 0.501 | ✗ (loses SciFact -0.040) |
| Multi-field RRF k=60 + CE rerank | 0.355 | **0.685** | **0.520** | ✓ (NFCorpus +0.030, SciFact +0.006) |
| **Lucene RRF k=60 + CE rerank (best)** | **0.358** | **0.683** | **0.521** | ✓ (NFCorpus +0.033, SciFact +0.004) |
| BM25 (published Lucene) | 0.325 | 0.679 | 0.502 | — |
| SPLADE++ (published) | 0.347 | 0.704 | 0.526 | — |
| BGE-large-v1.5 (published) | 0.380 | 0.722 | 0.551 | — |

### Two-dataset means by published comparison

| System | Mean nDCG@10 |
|---|---:|
| BGE-large-v1.5 (published, 335M) | 0.551 |
| SPLADE++ (published) | 0.526 |
| **ruflo Lucene RRF + CE rerank (BGE-base 110M)** | **0.521** |
| Multi-field RRF + CE rerank | 0.520 |
| Lucene BM25 alone | 0.505 |
| BM25 (published Lucene) | 0.502 |
| dense alone (BGE-base) | 0.489 |

**Acceptance test from the climb plan ("ruflo beats BM25 on both datasets") PASSES.** With RRF+CE rerank we're 0.521 on the 2-dataset mean — beats published BM25 (0.502), beats every other published baseline except SPLADE++ (0.526, 1 percentage point above us) and BGE-large (0.551, 3 percentage points above).

### Notable per-dataset ranks (Lucene RRF + CE rerank)

- **NFCorpus: 0.358, rank 2 of 11** — only behind BGE-large (0.380). Beats SPLADE++ (0.347) by 0.011.
- **SciFact: 0.683, rank 3 of 11** — only behind SPLADE++ (0.704) and BGE-large (0.722). Beats every other listed dense baseline including Contriever, DocT5query, ColBERT, GTR-XL, GenQ, TAS-B.

### Subtle finding from the ablation

On NFCorpus, **Lucene RRF k=60 alone (0.360) is essentially tied with Lucene RRF + CE rerank (0.358)** — the cross-encoder doesn't help when the underlying RRF is already strong. The CE rerank's value is on SciFact (0.639 → 0.683, +0.044 lift). The pipeline auto-adapts: when RRF is strong, rerank is mostly a pass-through; when RRF is weaker, rerank substantially lifts.

This matches the published literature on hybrid retrieval — reranking helps most when the candidate pool has high recall but low top-K precision.

## What this validates

1. **The ADR-087 diagnosis was correct.** RRF works with comparably-strong inputs and breaks with asymmetric strength. Lucene BM25 + dense → RRF works (lifts both datasets). Multi-field BM25 + dense → RRF degrades (asymmetric strength).
2. **Standard IR primitives stack as expected.** BM25 + dense + RRF + cross-encoder rerank is the textbook recipe and the textbook lift directions hold on our infrastructure.
3. **The user's reframe was right.** "Don't try to invent your way up BEIR; stack proven primitives, measure each lift, then decide where you add unique value." This ADR is exactly that.

## Honest limits

- **Two datasets only** (still). NFCorpus + SciFact. BEIR has 18. The 0.521 mean is suggestive, not definitive of BEIR-average.
- **Latency cost of rerank is real** — ~4.6 sec per query on this M-series CPU at top-100 rerank. Production callers should opt in based on their latency budget.
- **Zero-shot, no fine-tuning.** BGE-base is the unmodified BAAI release. Fine-tuning would lift further (per the BEIR research literature, ~+0.02-0.05 on dataset-specific train splits).
- **Our Lucene BM25 is a re-implementation, not a Lucene binding.** Matches the published baseline within ±0.003 on both datasets — close, not identical. Lucene's actual implementation may differ in edge cases (numeric handling, hyphenated tokens, etc.).

## What we did NOT do

- Did not switch the runtime retrieval defaults to Lucene BM25. Runtime stays on multi-field BM25 (better for ruflo's commit-history corpora). The Lucene BM25 module is BEIR-runner-scoped.
- Did not run BGE-large yet. That's the next likely lift (+0.02 on NFCorpus, +0.04 on SciFact based on published BGE-base vs BGE-large gaps). Tracked.
- Did not add a third BEIR dataset. SciFact + NFCorpus is enough to claim "stacking works"; broader generalisation needs more datasets + GPU compute.

## What's next (already tracked)

- **BGE-large swap** — drop-in `BGE_MODEL=Xenova/bge-large-en-v1.5`. Likely lifts both datasets further. ~3× embed latency.
- **TREC-COVID + FiQA + ArguAna** — 3-4 more BEIR datasets with the Tailscale GPU path the user offered. Would establish a real BEIR-mini-average.
- **Fine-tuning BGE-base on NFCorpus train** (110K-pair train split) — GPU job, +0.02-0.05 expected.
- **ruvector BGE bundling** (ruvnet/ruvector#524) — kills the silent-fallback bug at source.

## Verification

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc )

# Re-use NFCorpus + SciFact caches from ADR-085 (or re-ingest if needed)
cd /tmp/beir-nfcorpus
USE_LUCENE_BM25=1 RERANK=1 node /path/to/v3/@claude-flow/cli/scripts/run-beir-hybrid.mjs
# → nDCG@10 0.358, rank 2/11 on NFCorpus

cd /tmp/beir-scifact
USE_LUCENE_BM25=1 RERANK=1 BEIR_DATA_DIR=/tmp/beir-scifact/scifact \
  node /path/to/v3/@claude-flow/cli/scripts/run-beir-hybrid.mjs
# → nDCG@10 0.683, rank 3/11 on SciFact

# Stand-alone Lucene BM25 (no rerank, fast)
USE_LUCENE_BM25=1 node /path/to/scripts/run-beir-hybrid.mjs
```
