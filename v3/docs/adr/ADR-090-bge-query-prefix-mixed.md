# ADR-090 — BGE Query Prefix: Mixed Results (Per-Dataset Win, Not a Default)

**Status**: Accepted — Implemented in ruflo 3.10.29 (opt-in via `BGE_QUERY_PREFIX=1`)
**Date**: 2026-05-30
**Related**: ADR-085 (BEIR harness), ADR-089 (3-dataset summary)

## Context

BAAI's BGE-en-v1.5 documentation recommends prepending `Represent this sentence for searching relevant passages: ` to query embeddings (only — not documents). The 0.030 gap between our BGE-large NFCorpus measurement (0.350) and BAAI's published number (0.380) made the prefix a likely partial cause.

## Decision

Add `embedQuery()` method to the BGE embedder, exported `BGE_QUERY_PREFIX` constant, and `BGE_QUERY_PREFIX=1` env flag wired through both BEIR runners. Default off; opt-in only after seeing the per-dataset data below.

## Measured proof (3 BEIR datasets, dense-alone path, same BGE-base-en-v1.5)

| Dataset | NO prefix | WITH prefix | Δ | Direction |
|---|---:|---:|---:|---|
| **NFCorpus** | 0.3517 | **0.3604** | **+0.0087** | ✓ helps |
| SciFact | **0.6256** | 0.6186 | **-0.0070** | ✗ hurts |
| ArguAna | 0.4311 | 0.4345 | +0.0034 | ~ noise |

**Mixed result.** The prefix is not a free win. Likely reason: NFCorpus queries are *question-shaped* ("Do cholesterol statin drugs cause breast cancer?"), which fits the prefix's "searching relevant passages" framing. SciFact queries are *claim-shaped* ("Statin use lowers cancer mortality") — the prefix's question-framing may mis-cue the encoder. ArguAna queries are *argument-shaped* (counter-arguments) — the prefix is neutral.

## Decision: opt-in, not default

Because the prefix hurts SciFact (and SciFact is a major BEIR dataset where BM25 dominates dense), we cannot ship it as a default. Callers can enable per-deployment:

```bash
BGE_QUERY_PREFIX=1 node scripts/run-beir-bge.mjs
```

The flag flows through `run-beir-bge.mjs` and `run-beir-hybrid.mjs`. The `embedQuery()` method is wired into the embedder type so future callers can use it programmatically.

## Honest limits

- **N=3 datasets.** A larger BEIR sweep would tighten the per-dataset characterization.
- **Question-vs-claim hypothesis is hand-waved.** Real analysis would cluster queries by syntactic shape and measure the prefix effect within each cluster.
- **The prefix was designed for BAAI's published unquantized model.** Our Xenova int8-quantized model may respond differently.

## What ships

- `src/memory/bge-embedder.ts` — adds `embedQuery(text)` method + exports `BGE_QUERY_PREFIX`
- `scripts/run-beir-bge.mjs` — `BGE_QUERY_PREFIX=1` env flag
- `scripts/run-beir-hybrid.mjs` — same flag

## Verification

```bash
# Reproduce all three numbers
for ds in nfcorpus scifact arguana; do
  cd /tmp/beir-$ds
  echo "=== $ds NO prefix ==="
  node /path/to/scripts/run-beir-bge.mjs | grep -E "^  nDCG@10"
  echo "=== $ds WITH prefix ==="
  BGE_QUERY_PREFIX=1 node /path/to/scripts/run-beir-bge.mjs | grep -E "^  nDCG@10"
done
```
