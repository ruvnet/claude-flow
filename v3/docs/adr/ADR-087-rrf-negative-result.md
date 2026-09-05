# ADR-087 — RRF Fusion: Honest Negative Result + Ablation Infrastructure

**Status**: Accepted — Implemented in ruflo 3.10.27
**Date**: 2026-05-30
**Tracking**: continuation of BEIR public-benchmark work (ADR-085, ADR-086)
**Related**: ADR-088 (cross-encoder rerank — planned)

## Context

After ADR-086 honestly reported BGE-base losing to BM25 on SciFact, the next move on the climb plan was **BM25 + dense RRF fusion (k=60)** — the textbook "lowest-regret" first stop, published since Cormack et al. 2009.

Acceptance test set explicitly: *"RRF improves or preserves nDCG@10 on both NFCorpus and SciFact, the per-query bootstrap CI does not undermine the claim, and the default config is fixed before looking at the final test comparison."*

We built the harness. Ran the ablation matrix. **The acceptance test fails.** This ADR documents that.

## Measured proof (full ablation, fixed defaults before viewing results)

### NFCorpus (N=323 test queries)

| Config | nDCG@10 | R@10 | R@100 | 95% CI | vs dense |
|---|---:|---:|---:|---|---:|
| dense only (BGE-base) | **0.352** | 0.167 | 0.305 | [0.317, 0.387] | — |
| BM25 only (our multi-field) | 0.279 | 0.130 | 0.223 | [0.246, 0.311] | -0.073 |
| **RRF k=60 equal (default)** | **0.328** | 0.154 | **0.321** | [0.294, 0.363] | **-0.024 ↓** |
| RRF k=30 equal | 0.335 | 0.161 | 0.321 | [0.301, 0.370] | -0.017 ↓ |
| RRF k=120 equal | 0.328 | 0.155 | 0.315 | [0.294, 0.362] | -0.024 ↓ |
| RRF k=60 dense=1.2, bm25=0.8 | 0.334 | 0.161 | 0.324 | [0.300, 0.368] | -0.018 ↓ |
| RRF k=60 dense=0.8, bm25=1.2 | 0.323 | 0.154 | 0.313 | [0.289, 0.357] | -0.029 ↓ |

### SciFact (N=300 test queries)

| Config | nDCG@10 | R@10 | R@100 | 95% CI | vs dense |
|---|---:|---:|---:|---|---:|
| dense only (BGE-base) | **0.626** | 0.741 | 0.828 | [0.577, 0.672] | — |
| BM25 only (our multi-field) | 0.576 | 0.693 | 0.824 | [0.526, 0.623] | -0.050 |
| **RRF k=60 equal (default)** | **0.569** | 0.687 | **0.951** | [0.520, 0.618] | **-0.057 ↓** |
| RRF k=30 equal | 0.582 | 0.720 | 0.954 | [0.534, 0.630] | -0.044 ↓ |
| RRF k=120 equal | 0.563 | 0.670 | 0.950 | [0.513, 0.612] | -0.063 ↓ |
| RRF k=60 dense=1.2, bm25=0.8 | 0.577 | 0.708 | 0.961 | [0.529, 0.625] | -0.049 ↓ |
| RRF k=60 dense=0.8, bm25=1.2 | 0.558 | 0.664 | 0.947 | [0.508, 0.607] | -0.068 ↓ |

### Two-dataset summary

| System | NFCorpus | SciFact | Mean |
|---|---:|---:|---:|
| Dense alone (BGE-base) | 0.352 | 0.626 | **0.489** |
| **RRF k=60 equal (default)** | 0.328 | 0.569 | **0.449** |
| RRF k=30 equal (best ablation) | 0.335 | 0.582 | 0.459 |

**RRF degrades the two-dataset mean by ~0.040 nDCG@10.** Every RRF variant under-performs dense alone. The acceptance test fails on both datasets.

## Why RRF hurt us (the diagnosis)

The classic RRF win comes from fusing **comparably-strong systems with different failure modes** (e.g., Lucene BM25 + a tuned dense retriever). When one system is materially weaker than the other, RRF's rank-position averaging *introduces* the weaker system's noise into the top-K instead of cancelling it.

Our BM25 implementation is weaker than the Lucene baselines that published RRF results assume:
- Our NFCorpus pure-BM25: **0.279 nDCG@10**
- Published Lucene NFCorpus BM25 baseline: **0.325** (Thakur et al. 2021)
- Gap: ~0.046, i.e., we're 14% relative below standard

The gap comes from our multi-field BM25's tokenisation choices: no Snowball stemmer, smaller stopword list (~25 vs Lucene's ~120), no Lucene-style length normalisation. We optimised it for ruflo commit-history retrieval (where stemming hurts) — but BEIR's medical/scientific corpora reward stemming.

**The interesting confirmation:** Recall@100 *does* improve with RRF on both datasets (NFCorpus 0.305 → 0.321, SciFact 0.828 → 0.951). RRF correctly surfaces a *broader* candidate pool — but the top-K ranking is hurt because BM25's noise sits at low ranks in the fused list, displacing dense's correct top-1 picks. This is exactly the failure mode predicted for "asymmetric system strength" fusion.

## What we shipped (despite the negative result)

1. **`scripts/run-beir-rrf-ablation.mjs`** — re-runnable ablation harness. Pre-computes BM25 + dense rankings once per query, then evaluates the configuration matrix from cache. Saves bootstrap-CI per default config to per-dataset run JSON.
2. **`scripts/run-beir-hybrid.mjs`** — full RRF + optional cross-encoder rerank runner (rerank story is ADR-088).
3. **Fix: `bge-cache/` per-dataset path** in `scripts/run-beir-bge.mjs`. The hardcoded `/tmp/beir-nfcorpus/bge-cache` made the SciFact run silently overwrite the NFCorpus cache (caught only when the first RRF run returned nDCG=0.14). Now cache lives at `<dataset>/bge-cache/`.
4. **Run JSONs** with full perQuery data + ablation rows in `docs/benchmarks/runs/beir-{nfcorpus,scifact}-rrf-ablation-{latest,timestamp}.json`.
5. **No default change.** Dense-only remains the BEIR runner's default. RRF is an opt-in code path that callers can use when their BM25 implementation is strong enough to benefit.

## What we did NOT do (and why)

- **Did not hide the failure.** "Fixed default before viewing results" was the explicit methodology — we picked k=60, equal weights, then ran and reported.
- **Did not switch to "best ablation"** (RRF k=30, dense=1.2, bm25=0.8 → 0.459 mean). That's tuning-on-test, and the user explicitly warned against it.
- **Did not ship a Lucene-style BM25 yet.** That's the right next experiment (Porter/Snowball stemmer + Lucene stopword list + length normalisation), but it's its own ADR. Tracked.
- **Did not skip the version bump.** The ablation infrastructure + cache-path bug fix + run JSONs are still real shipped value. 3.10.27 is honest progress, not a hype release.

## Hypothesis for the next round (ADR-088+)

1. **Cross-encoder rerank on RRF's wider candidate pool**: Recall@100 IS up (0.95 on SciFact). If we rerank that broader top-100 with `Xenova/ms-marco-MiniLM-L-6-v2`, the rerank's stronger pairwise scoring should pull the genuine top-K out. This is the bet for 3.10.28.
2. **Lucene-style BM25** would make RRF actually work as designed. Porter/Snowball + Lucene stopwords + proper length norm. Tracked for a future ADR.
3. **Use ruvector's bundled embedder** (per [ruvnet/ruvector#524](https://github.com/ruvnet/ruvector/issues/524) we filed) instead of our local @xenova path — once BGE is bundled in ruvector, downstream packages stop hitting the sharp dependency issue.

## Verification

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc )

# Pretrain caches (once each)
mkdir -p /tmp/beir-nfcorpus && cd /tmp/beir-nfcorpus
curl -sL -o nf.zip 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/nfcorpus.zip' && unzip -q nf.zip
node /path/to/v3/@claude-flow/cli/scripts/run-beir-bge.mjs   # writes bge-cache/

mkdir -p /tmp/beir-scifact && cd /tmp/beir-scifact
curl -sL -o sf.zip 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip' && unzip -q sf.zip
BEIR_DATA_DIR=/tmp/beir-scifact/scifact node /path/to/v3/@claude-flow/cli/scripts/run-beir-bge.mjs

# Ablation matrix (cached embeds, ~5 min each)
cd /tmp/beir-nfcorpus && node /path/to/scripts/run-beir-rrf-ablation.mjs
BEIR_DATA_DIR=/tmp/beir-scifact/scifact node /path/to/scripts/run-beir-rrf-ablation.mjs
```
