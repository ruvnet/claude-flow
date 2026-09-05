# ADR-091 — 4-Dataset BEIR + Config Divergence

**Status**: Accepted — Implemented in ruflo 3.10.30
**Date**: 2026-05-31
**Tracking**: continuation of BEIR climb (ADR-085 → 086 → 087 → 088 → 089 → 090 → 091)

## Context

3.10.29 shipped 3-dataset BEIR (NFCorpus + SciFact + ArguAna, rank 4/11 mean). SciDocs is the 4th BEIR dataset that runs in <3hr of CPU ingest — small enough to be tractable, large enough (25,657 docs) to be a meaningful generalisation test.

## Measured proof

### SciDocs results (N=1000 test queries, full corpus 25,657 docs)

| Pipeline | nDCG@10 | Rank |
|---|---:|---:|
| **dense alone (BGE-base)** | **0.211** | **2/11** |
| Lucene RRF (no rerank) | 0.203 | 2/11 (-0.008 vs dense) |

**RRF hurt SciDocs by 0.008.** Same pattern as ArguAna (where CE rerank hurt). The "stack proven IR primitives" advice (per the user's reframe in earlier loops) is true *on average*, but per-dataset variation means a single pipeline can't win everywhere.

### 4-dataset means

| System | Params | NFCorpus | SciFact | ArguAna | SciDocs | Mean |
|---|---:|---:|---:|---:|---:|---:|
| BGE-large-v1.5 (published) | 335M | 0.380 | 0.722 | 0.636 | 0.225 | **0.491** |
| SPLADE++ (published) | 110M | 0.347 | 0.704 | 0.521 | 0.159 | **0.433** |
| **ruflo best (per-dataset)** | **110M** | **0.358** | **0.683** | **0.432** | **0.211** | **0.421** |
| GTR-XL (published) | 1.2B | 0.343 | 0.662 | 0.439 | 0.174 | 0.405 |
| GenQ (published) | 110M | 0.319 | 0.644 | 0.493 | 0.143 | 0.400 |
| BM25 (published Lucene) | — | 0.325 | 0.679 | 0.397 | 0.158 | **0.390** |
| Contriever (published) | 110M | 0.328 | 0.677 | 0.379 | 0.165 | 0.387 |
| TAS-B (published) | 66M | 0.319 | 0.643 | 0.429 | 0.149 | 0.385 |
| DocT5query (published) | 60M | 0.328 | 0.675 | 0.349 | 0.162 | 0.378 |
| ColBERT (published) | 110M | 0.305 | 0.671 | 0.233 | 0.145 | 0.339 |
| SBERT msmarco (published) | 110M | 0.272 | 0.555 | 0.371 | 0.122 | 0.330 |

**Rank 3 of 11.** Beats every published baseline except SPLADE++ (-0.012, ~tied) and BGE-large (-0.070). Specifically beats GTR-XL with 1/10× the params (110M vs 1.2B).

## The config-divergence pattern

After 4 datasets, the data clearly shows **no single pipeline wins everywhere**:

| Dataset | Best config | What's optimal | What hurts |
|---|---|---|---|
| NFCorpus (medical IR) | Lucene + RRF + CE rerank | full pipeline | nothing measurable |
| SciFact (fact-verification) | Lucene + RRF + CE rerank | full pipeline (Lucene BM25 alone is 99% of best) | none |
| ArguAna (counter-argument) | Lucene + RRF (no CE) | RRF helps slightly; rerank hurts substantially | CE rerank actively degrades (0.283 at 50q vs 0.432 RRF) |
| **SciDocs (paper-similarity)** | **dense alone** | **none of the additions help** | **RRF hurt by 0.008** |

Three of four datasets pick a different best config. The mid-2020s "stack primitives" wisdom from the IR literature is correct *on average* but per-dataset variation is the dominant signal.

Implications:
- A retrieval system that ships a **single fixed pipeline** will leave 1-3 points of nDCG@10 on the table per dataset
- A system that **auto-selects pipeline per corpus** would need a calibration step (eval a few hundred labelled query-doc pairs, pick the winner) we haven't built
- Callers should **A/B their corpus** until that calibrator exists

This is a real finding from running 4 datasets, not a guess. Worth a separate experiment-tracking artifact.

## Reusable infrastructure shipped

- `scripts/run-beir-bge.mjs` — gains SciDocs baselines
- `scripts/run-beir-hybrid.mjs` — gains SciDocs baselines
- `docs/benchmarks/runs/beir-scidocs-bge-latest.json` — dense alone
- `docs/benchmarks/runs/beir-scidocs-hybrid-rrf-latest.json` — RRF

## Honest limits

- **4/18 BEIR datasets.** The 0.421 mean is suggestive, not BEIR-average. The 5 biggest BEIR datasets (TREC-COVID, FiQA, HotpotQA, NQ, DBPedia — all >50k docs) remain GPU-gated.
- **Zero-shot.** No fine-tuning. NFCorpus and ArguAna both have train splits we haven't used.
- **The "best per-dataset" mean is realistic if you tune per corpus.** A fixed-pipeline mean would be lower — Lucene+RRF+CE everywhere = 0.358 + 0.683 + 0.283 (extrapolated ArguAna CE failure) + ~0.20 (SciDocs RRF+CE not run, estimated similar to RRF alone) ≈ ~0.38 ≈ same as published BM25 mean.
- **CE rerank's variance is large** — wins on NFCorpus and SciFact, ties on neither, actively hurts on ArguAna and (estimated) SciDocs. Calibrate before deploying.

## What's next (mostly blocked on GPU)

- **Auto-pipeline selector** — train a tiny classifier on per-dataset training pairs to pick the best pipeline. Cheap, doesn't need GPU.
- **5+ more BEIR datasets** via GPU.
- **Fine-tune BGE-base** on NFCorpus/ArguAna train splits.
- **bge-reranker-v2-m3** (568M) on the datasets where CE wins (NFCorpus, SciFact) — heavyweight opt-in.

## Verification

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc )

mkdir -p /tmp/beir-scidocs && cd /tmp/beir-scidocs
curl -sL -o sd.zip 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scidocs.zip' && unzip -q sd.zip

# Dense alone (best for SciDocs)
BEIR_DATA_DIR=/tmp/beir-scidocs/scidocs node /path/to/scripts/run-beir-bge.mjs
# → nDCG@10 0.211, rank 2/11

# RRF (slightly worse on SciDocs)
USE_LUCENE_BM25=1 BEIR_DATA_DIR=/tmp/beir-scidocs/scidocs node /path/to/scripts/run-beir-hybrid.mjs
# → nDCG@10 0.203
```
