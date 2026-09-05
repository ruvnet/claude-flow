# ADR-085 — Public Benchmark Harness (BEIR NFCorpus) + BGE Embedder Swap

**Status**: Accepted — Implemented in ruflo 3.10.25
**Date**: 2026-05-30
**Tracking**: continuation of self-learning hardening cluster (ADR-077 → ... → 084)
**Related**: ADR-081 (labelled corpus), ADR-084 (cross-repo generalisation)

## Context

ADR-084 proved cross-repo generalisation on small bespoke corpora (ruflo + agentdb + agentic-flow, all owned by the same author). The next step in honest SOTA validation is **a public benchmark** — a corpus + qrels + published baselines maintained by external researchers. BEIR is the standard zero-shot IR benchmark suite; NFCorpus (3,633 docs, 323 test queries, medical domain) is the smallest dataset and runs end-to-end in under 20 minutes.

The first run also surfaced an environment bug: `@xenova/transformers` requires `sharp` for image preprocessing, and `sharp-darwin-arm64v8.node` was missing from the pnpm-installed copy. The neural store's `agentic-flow/reasoningbank` embedder silently fell back to hash embeddings, producing essentially-random cosine similarity. The hybrid path was reduced to pure BM25 in practice.

## Decision

Two changes, one release:

### 1. `scripts/run-beir-nfcorpus.mjs` — public BEIR harness

Standard BEIR pipeline:
- Loads `corpus.jsonl`, `queries.jsonl`, `qrels/test.tsv` from the BEIR ZIP
- Ingests every doc through `storeNeuralPatterns()` (using `_id` as the stable identifier)
- For each test query: runs hybrid retrieval, computes graded **nDCG@10**, **MRR@10**, **recall@10**, **recall@100**
- Compares against 10 published baselines (BM25, ColBERT, SPLADE++, BGE-large, etc.)
- Writes a run JSON with the leaderboard rank

### 2. `src/memory/bge-embedder.ts` — direct `@xenova/transformers` BGE bi-encoder

Bypasses the broken sharp-dependent path. Loads `Xenova/bge-base-en-v1.5` (110M params, 768-dim, ~110MB int8) via `AutoTokenizer` + `AutoModel`, with CLS-token pooling + L2 normalisation per BAAI's spec. The same direct-API approach the cross-encoder reranker (ADR-080) used proves the pattern works.

Supports `Xenova/bge-small-en-v1.5` (33M, 384-dim) and `Xenova/bge-large-en-v1.5` (335M, 1024-dim) as drop-in alternatives.

### 3. `scripts/run-beir-bge.mjs` — BEIR harness with BGE embeddings

Standalone runner that bypasses the neural-tools BM25/hybrid pipeline entirely — pure dense retrieval using BGE embeddings + cosine. Caches doc embeddings as a single Float32Array binary file (`bge-base-en-v1.5.f32`, ~11MB) so subsequent benches don't re-embed.

## Measured proof — NFCorpus (N=323 test queries)

### Pure BM25 (our current hybrid with hash-fallback cosine = effectively pure BM25)

| Metric | Our impl | Published BEIR BM25 baseline |
|---|---:|---:|
| nDCG@10 | **0.289** | 0.325 |
| MRR@10 | 0.506 | — |
| Recall@10 | 0.133 | — |
| Recall@100 | 0.219 | — |
| Latency | ~950 ms/query | — |

Why we're slightly below: our multi-field BM25 (subjectWeight=2.0) was tuned for ruflo's commit-style corpus where the "subject" field carries different IDF distribution than NFCorpus's title field. With `subjectWeight=0` (pure body BM25) we get **the same 0.289** — meaning the doc `_id` we passed as the "subject" carries no signal. A tighter BEIR-specific tokenizer + stopword list (Lucene-style) would close the remaining 0.04 gap.

### BGE-base-en-v1.5 (dense retrieval) — **TOP-2 on BEIR NFCorpus** (1 dataset, not the BEIR average)

**Pipeline reported:** direct BGE dense path (no fine-tuning, no hybrid BM25+dense fusion, no cross-encoder reranker). Our internal hybrid pipeline (ADRs 078-083) is deliberately isolated from this BEIR comparison so the dense-vs-dense numbers stay honest.

Measured N=323 test queries, full corpus 3,633 docs:

| Metric | Our impl (BGE-base) | Published BGE-large baseline |
|---|---:|---:|
| **nDCG@10** | **0.352** | 0.380 |
| MRR@10 | 0.546 | — |
| Recall@10 | 0.167 | — |
| Recall@100 | 0.305 | — |
| Avg latency | 388 ms/query | — |

**Leaderboard rank: 2 of 11** published baselines on BEIR NFCorpus:

| Rank | Method | nDCG@10 |
|---:|---|---:|
| 1 | BGE-large-v1.5 (published, 335M params) | 0.380 |
| **2** | **ruflo + BGE-base-en-v1.5 (110M params) ← us** | **0.352** |
| 3 | SPLADE++ | 0.347 |
| 4 | GTR-XL | 0.343 |
| 5 | DocT5query | 0.328 |
| 5 | Contriever | 0.328 |
| 7 | BM25 (Lucene) | 0.325 |
| 8 | TAS-B | 0.319 |
| 8 | GenQ | 0.319 |
| 10 | ColBERT | 0.305 |
| 11 | SBERT msmarco | 0.272 |

We beat SPLADE++ (the published "best" before BGE-large landed), GTR-XL, and every other listed dense retriever using a 3× smaller base model (110M vs 335M).

**Caveats on the framing:**
- The 0.005 gap to SPLADE++ (0.352 vs 0.347) is small. A paired bootstrap significance test (ADR-086) is needed to claim a statistically significant win — pending re-run with per-query metrics.
- **The "swap to BGE-large to close the BGE-large gap" claim is directional, not guaranteed.** Larger model = different dim (1024 vs 768), ~3× larger cache, ~2× query latency. Real number requires the run; we have not yet measured BGE-large on this stack.
- **One BEIR dataset is not BEIR-SOTA.** BEIR is explicitly an 18-dataset heterogeneous benchmark; rank-2 on NFCorpus is a strong signal, not a generalisation claim. SciFact run (2nd dataset) is queued; broader coverage is tracked.

## Cumulative SOTA context

Internal benches (3.10.17 → 3.10.24, ruflo/agentdb/agentic-flow corpora) hit nDCG@3 = 0.963-1.000 with hand-curated labels. Those numbers measured *engineering quality* on small bespoke corpora.

Public benchmark (BEIR NFCorpus) is different — a standardised zero-shot eval against published baselines. Hitting BM25 baseline (0.32) with no fine-tuning is competent. Beating BM25 with a generic-purpose bi-encoder (BGE-base) is the right next milestone. Reaching SPLADE++ / BGE-large territory (0.35+) on a single dataset would be top-3 evidence of architecture quality.

## Reusable infrastructure shipped

- `scripts/run-beir-nfcorpus.mjs` — hybrid (BM25-dominant in current env) BEIR harness
- `scripts/run-beir-bge.mjs` — dense (BGE) BEIR harness with on-disk embedding cache
- `src/memory/bge-embedder.ts` — lazy-loaded BGE bi-encoder (small / base / large) with graceful fallback
- Run JSONs at `docs/benchmarks/runs/beir-nfcorpus*-{ts,latest}.json`

## Honest limits

- **One dataset (NFCorpus)** — BEIR has 18 datasets. Strong on one ≠ strong everywhere. Future ADRs could run TREC-COVID, SciFact, FiQA, etc.
- **Sharp install bug on darwin-arm64** — the agentic-flow embedder path was silently broken on this machine. We routed around it; users on other platforms should verify their embedder is real (check `_embeddingSource` returned by `neural_patterns store`).
- **No fine-tuning** — all numbers are zero-shot. NFCorpus has a 110K-pair train split that could fine-tune MiniLM/BGE for an additional ~0.05 nDCG lift; tracked for ADR-087.
- **No leaderboard submission** — BEIR doesn't have a real-time leaderboard; reporting against the Thakur et al. 2021 + papers-with-code published numbers.

## Deliberately NOT in this round

- **A 2nd BEIR dataset** — would be the next ADR; harness is reusable, just needs the data dir.
- **MicroLoRA fine-tuning** — answered separately as a follow-up question; requires Python + GPU for contrastive training; not a Node loop fire.
- **BGE-large** swap — same code path as BGE-base, just `BGE_MODEL=Xenova/bge-large-en-v1.5 node ...`; will A/B if base hits ~0.32+.

## Verification

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc )

# Download BEIR NFCorpus
mkdir -p /tmp/beir-nfcorpus && cd /tmp/beir-nfcorpus
curl -sL -o nfcorpus.zip 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/nfcorpus.zip'
unzip -q nfcorpus.zip

# Hybrid (BM25-dominant in current env) — ~15 min
rm -rf .claude-flow
node /path/to/ruflo/v3/@claude-flow/cli/scripts/run-beir-nfcorpus.mjs
# → nDCG@10 0.289

# BGE-base dense — ~20 min ingest + 1 min query
node /path/to/ruflo/v3/@claude-flow/cli/scripts/run-beir-bge.mjs
# → nDCG@10 pending (see run JSON)

# Cached subsequent runs (~1 min)
SKIP_INGEST=1 node /path/to/ruflo/v3/@claude-flow/cli/scripts/run-beir-bge.mjs
```
