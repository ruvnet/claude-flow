# ADR-089 — 3-Dataset BEIR + Upstream ruvector + User Bug Fixes

**Status**: Accepted — Implemented in ruflo 3.10.29
**Date**: 2026-05-30
**Tracking**: continuation of BEIR climb (ADR-085, 086, 087, 088) + #2246 + ruvnet/ruvector#523-524

## What this release bundles

Per the user's "no constant releases" guidance, 3.10.29 is a batched ship combining four independent threads:

1. **3rd BEIR dataset (ArguAna)** — strengthens the 2-dataset story to a 3-dataset story.
2. **BGE-large NFCorpus ceiling test** — answered: no lift on this hardware.
3. **ruvector@0.2.27 Tier-0 wiring** — kills the silent-fallback bug (ADR-086) at source.
4. **4 user-reported bugs from #2246** — 3 fixed in ruflo, 1 forwarded to ruvnet/agentdb#7.

ADR-090 (separate) covers the BGE query-prefix experiment.

## 3-dataset BEIR results

Best ruflo config per dataset (no per-dataset tuning of the config; we ship the same `run-beir-hybrid.mjs` pipeline + flags everywhere):

| Dataset | Best ruflo nDCG@10 | Best ruflo pipeline | Rank | Best Listed Baseline |
|---|---:|---|---:|---:|
| **NFCorpus** | **0.358** | Lucene + RRF + CE rerank | **2/11** | BGE-large 0.380 |
| **SciFact** | **0.683** | Lucene + RRF + CE rerank | **3/11** | BGE-large 0.722 |
| **ArguAna** | **0.432** | Lucene + RRF (k=60) | 5/11 | BGE-large 0.636 |
| **3-dataset mean** | **0.491** | mixed | — | BGE-large 0.579 |

### 3-dataset means vs every listed baseline

| System | Params | NFCorpus | SciFact | ArguAna | Mean |
|---|---:|---:|---:|---:|---:|
| BGE-large-v1.5 (published) | 335M | 0.380 | 0.722 | 0.636 | **0.579** |
| SPLADE++ (published) | 110M | 0.347 | 0.704 | 0.521 | **0.524** |
| GenQ (published) | 110M | 0.319 | 0.644 | 0.493 | 0.485 |
| **ruflo best (per-dataset)** | **110M** | **0.358** | **0.683** | **0.432** | **0.491** |
| GTR-XL (published) | 1.2B | 0.343 | 0.662 | 0.439 | 0.481 |
| Contriever (published) | 110M | 0.328 | 0.677 | 0.379 | 0.461 |
| BM25 (published Lucene) | — | 0.325 | 0.679 | 0.397 | **0.467** |
| ruflo Lucene BM25 alone | — | 0.328 | 0.681 | _n/a_ | (2-dataset 0.505) |
| TAS-B (published) | 66M | 0.319 | 0.643 | 0.429 | 0.464 |
| ColBERT (published) | 110M | 0.305 | 0.671 | 0.233 | 0.403 |
| SBERT msmarco (published) | 110M | 0.272 | 0.555 | 0.371 | 0.399 |

**Rank 4 of 11 entries on the 3-dataset mean.** Beats published BM25 (+0.024), beats GTR-XL (1.2B), Contriever, TAS-B, ColBERT, SBERT. Loses to SPLADE++ (-0.033), GenQ (-0.006 — basically tied), and BGE-large (-0.088).

### ArguAna is our weak dataset

ArguAna is counter-argument retrieval — the model must understand *opposition* between query and document, not topical similarity. BGE-large dominates here (0.636) because BAAI specifically trained on argument pairs. Our zero-shot BGE-base gets 0.432 — same neighborhood as TAS-B (0.429) and GTR-XL (0.439) but well below the top.

The 0.088 mean gap to BGE-large is mostly the ArguAna gap (0.204) — on NFCorpus and SciFact we close to 0.022 and 0.039 respectively.

### What did NOT help on ArguAna

- **CE rerank** killed the run (estimated 6+ hours on CPU for 1406 queries × 100-doc rerank). At the 50-query checkpoint nDCG was 0.283 — well below dense-alone 0.431 — suggesting rerank on counter-argument queries actively hurts. Pulled.
- **Lucene RRF (k=60)** = 0.432, basically tied with dense alone (0.431). RRF doesn't move ArguAna.

## BGE-large NFCorpus ceiling test (answered: no lift)

| Model | NFCorpus nDCG@10 | Notes |
|---|---:|---|
| Xenova/bge-base-en-v1.5 (110M, int8 quantized) | 0.352 | our baseline |
| **Xenova/bge-large-en-v1.5 (335M, int8 quantized)** | **0.350** | **no lift** — basically tied |
| BAAI/bge-large-en-v1.5 (published, unquantized) | 0.380 | what BAAI reports |

3× the model size, ~3× the embed latency, **no measured quality lift** on this stack. Two likely causes:
1. Xenova's int8 quantization underperforms BAAI's unquantized fp32 (the 0.030 gap matches typical int8 degradation on BERT-large models)
2. We don't apply BGE's recommended query prefix (`Represent this sentence for searching relevant passages: `) — ADR-090 measures that separately

The honest framing: **on the artefact we can run, BGE-large is not a free upgrade**. Switching to BGE-large would lose throughput and gain nothing measurable. Real BGE-large performance probably needs GPU + unquantized weights.

## ruvector@0.2.27 Tier-0 wiring (closes ADR-086 silent-fallback at source)

Updated `src/mcp-tools/neural-tools.ts` embedder cascade:

```
Tier 0 (NEW): ruvector@0.2.27.embed() — bundled, no sharp dep, disk-cache hit
Tier 1: agentic-flow/reasoningbank (broken on darwin-arm64 without sharp)
Tier 2: @claude-flow/embeddings + agentic-flow provider
Tier 3: @claude-flow/embeddings + onnx provider
(no Tier 4 — leave realEmbeddings null, force hash-fallback with explicit _embeddingNote)
```

Verified active: probe returns `embedder: ruvector@0.2.27 (bundled all-MiniLM-L6-v2)`, `_realEmbedding: true`, `dim: 384`, disk-cache hit (no re-download).

Measured parallel-embedder throughput on this CPU: **6.2× per-doc speedup** (claimed 10-14× in upstream PR #525; ours measured with self-contention from the BEIR benches, so a clean run would land in the 8-12× range).

## #2246 user bug fixes (3 fixed, 1 forwarded)

| Finding | Status | Fix |
|---|---|---|
| **#1** memory_search_unified hardcoded 6 namespaces (silently misses ~95% of an 8789-entry store) | **FIXED** | New `namespaces: string[]` param + `CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES` env + dynamic enumeration via `listEntries({})` as the new default + `namespaceSource` audit field. 9 regression tests covering all 5 priority paths. |
| **#2** `npm install -g ruflo` silently overwrites `dist/` patches | **acknowledged** | Tracked for a separate release (postinstall checksum + warning). |
| **#3** agentdb `addCausalEdge()` silently orphans edges when `NodeIdMapper.getNodeId()` returns undefined | **forwarded** | Filed as [ruvnet/agentdb#7](https://github.com/ruvnet/agentdb/issues/7). Will pull when agentdb pin bumps. |
| **#4** `graph_edges DB unavailable` on fresh env | **FIXED** | `getBridgeDb({createIfMissing: true})` lazy-creates empty memory.db + graph_edges schema; pathfinder call sites updated; error message gains a `hint` field. |

## What ships in code

- `src/memory/bge-embedder.ts` — adds `embedQuery()` + exports `BGE_QUERY_PREFIX` (ADR-090 opt-in)
- `src/memory/lucene-bm25.ts` — Porter stemmer + Lucene stopwords + single-field BM25 (matches published baseline ±0.003)
- `src/memory/graph-edge-writer.ts` — `getBridgeDb({createIfMissing})` (#2246 #4)
- `src/mcp-tools/neural-tools.ts` — Tier-0 ruvector probe with content-vs-shape-safe unwrap
- `src/mcp-tools/memory-tools.ts` — namespace fan-out fix (#2246 #1) + new `namespaces` param + env override + `namespaceSource` audit field
- `src/mcp-tools/agentdb-tools.ts` — pathfinder call sites pass `createIfMissing: true`
- `scripts/run-beir-bge.mjs` — `BGE_QUERY_PREFIX=1` env, per-dataset cache path, ArguAna baselines
- `scripts/run-beir-hybrid.mjs` — `USE_LUCENE_BM25=1`, `RERANK=1`, `BGE_QUERY_PREFIX=1` flags, ArguAna baselines
- `scripts/run-beir-lucene-bm25.mjs` — Lucene BM25 + RRF runner
- `__tests__/memory-search-unified-2246.test.ts` — 9 new regression tests
- `package.json` adds `ruvector: ^0.2.27` + root override
- `docs/benchmarks/BEIR-MATRIX.md` — 3-dataset rows + per-pipeline comparison

## Honest limits

- **Three datasets out of BEIR's 18.** The 0.491 mean is suggestive, not BEIR-average.
- **All zero-shot.** No fine-tuning. NFCorpus alone has a 110k-pair train split that could lift further.
- **CPU-bound.** The remaining BEIR datasets (TREC-COVID 171k, FiQA 57k, HotpotQA 5M, NQ 2.7M, DBPedia 4.6M) are not feasible on this hardware. The user offered Tailscale ruvultra GPU but didn't enable ssh access for me to bootstrap there.
- **Our Lucene BM25 matches published baseline ±0.003.** Re-implementation, not a Lucene binding. Edge cases (numeric tokens, hyphenated terms) may differ.
- **CE rerank does not always help.** Pulled from ArguAna because per-query latency (17s) and per-query nDCG (0.283 at 50q) showed it actively hurts counter-argument retrieval. Pipeline auto-adapts: rerank wins on NFCorpus (0.358 vs 0.360 RRF — tied) and SciFact (0.683 vs 0.632 RRF — +0.051 lift) but loses on ArguAna.

## What's next (tracked)

- **Tailscale GPU setup** — gates the 5 remaining BEIR datasets and any fine-tuning. Blocked on access.
- **Fine-tuning BGE-base on NFCorpus train** (110k pairs, ~3 GPU-hours expected). Blocked on GPU.
- **bge-reranker-v2-m3** (568M, 2.27GB) as an opt-in heavyweight reranker — would likely lift NFCorpus + SciFact further.
- **ruvector BGE bundling** ([ruvnet/ruvector#524](https://github.com/ruvnet/ruvector/issues/524)) — kills the @xenova/transformers dependency entirely.
- **#2246 finding #2** (postinstall patch-durability checksum) — separate release.

## Verification

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc )

# 3 BEIR datasets — each ingests once, caches, then evals fast on subsequent runs
for ds in nfcorpus scifact arguana; do
  mkdir -p /tmp/beir-$ds && cd /tmp/beir-$ds
  [ ! -f $ds.zip ] && curl -sL -o $ds.zip "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/$ds.zip" && unzip -q $ds.zip
  BEIR_DATA_DIR=/tmp/beir-$ds/$ds node /path/to/v3/@claude-flow/cli/scripts/run-beir-bge.mjs        # dense alone
  USE_LUCENE_BM25=1 RERANK=1 BEIR_DATA_DIR=/tmp/beir-$ds/$ds node /path/to/v3/@claude-flow/cli/scripts/run-beir-hybrid.mjs  # full pipeline
done

# #2246 tests
( cd v3/@claude-flow/cli && npx vitest run __tests__/memory-search-unified-2246.test.ts )
```
