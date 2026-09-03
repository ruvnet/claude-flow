# Memory SOTA Report — 2026-09-03

TL;DR: Tonight's memory deep-dive confirms and closes a specific, well-scoped gap flagged (but not fixed) since 2026-08-28: `smart-retrieval.ts`'s MMR diversity re-ranking step used a token-Jaccard text-overlap proxy for "similarity to already-selected," instead of the embedding-cosine similarity every 2025-2026 production system (LangChain's reference implementation, Qdrant's native `Mmr` query shipped Sept 2025, Weaviate's MMR reranker shipped April 2026) uses — even though Ruflo's own pipeline already computes real ONNX embeddings and discards them before they reach MMR. Five parallel research roles (Deep Researcher, Competitor Analyst, 2 Scan Researchers, Ruflo Architecture Reviewer) independently verified the gap, found it is *not* a live research question in 2025-2026 literature (silently settled years ago by convergent practice), and confirmed the fix is small, additive, and zero-cost. Shipped: thread the already-computed embedding through `searchEntries()` → `SearchCandidate` → `mmrRerank`, using cosine similarity when both candidates have one, falling back to token-Jaccard otherwise (so callers/tests without embeddings are unaffected). Evaluated via deterministic Vitest, baseline-isolated via `git stash`: a discriminating test (a low-token-overlap paraphrase vs. a genuinely different topic) fails on baseline and passes on candidate. Full `@claude-flow/memory` suite: 460/461 passing, identically with and without the candidate (1 pre-existing, unrelated environmental failure). Separately, this session closed an `automation`-scan finding flagged in three prior gists (08-19, 08-28, 09-02) without ever being acted on: a scheduled CI workflow (`dream-cycle-backlog-guard.yml`) surfacing the Dream Cycle's own unmerged-draft-PR backlog, so the ledger-visibility gap stops being silently re-discovered every few nights.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Qdrant shipped native embedding-cosine MMR (`Mmr` query param, `diversity` 0.0–1.0) ~3 months after a May-2025 feature request | Qdrant blog, Sept 4 2025 | A |
| Weaviate shipped a native MMR reranker (`balance` param) in v1.37 | Weaviate 1.37 release notes, Apr 23 2026 | A |
| LangChain's reference `maximal_marginal_relevance()` (the implementation most MMR code in the wild derives from) has always operated on embedding vectors, never lexical overlap | LangChain core reference docs, current 2026 | B |
| No 2025-2026 paper or vendor source directly debates lexical-overlap vs. embedding-cosine as MMR's diversity term — the question was settled by convergent practice years ago, with no published postmortem either way | Absence result across ~10 targeted queries (Deep Researcher) | B |
| Milvus/Vespa deliberately chose categorical/attribute bucketing over continuous embedding-MMR for cost/scale reasons at billion-vector scale — a documented tradeoff, not a belief that lexical proxies are qualitatively better | Zilliz/Milvus grouping-search docs; Vespa result-diversification blog | B |
| Mem0/CrewAI/AutoGen/OpenAI's `file_search` skip diversity re-ranking entirely, investing in relevance-side tuning instead — a scope choice for sparser per-user memory pools, not a gap | Mem0 reranker docs; CrewAI engineering blog (Mar 2026); comparative surveys | B |
| The 2025-2026 frontier is MMR→DPP (determinantal point processes), not lexical→embedding: ScalDPP (Feb 2026) reports +7.7% NDCG@10 vs. non-diversified baseline using a cosine kernel, but is single-paper evidence, not benchmarked against MMR, and not adopted by any production vector DB found | arXiv:2604.03240 | C |
| A real practitioner report (unmerged GitHub issue) found session-transcript "verbose restatements" captured 41% of top-3 slots in hybrid agent-memory search — lexical/BM25 signals under-detect this; embedding cosine catches it — independently reproducing the exact failure mode this finding predicts | openclaw/openclaw#19760, Feb 2026 | C (corroboration only) |

## Ruflo Current Capability

`smart-retrieval.ts`'s `mmrRerank()` (phase 4 of SmartRetrieval's 5-phase pipeline: query expansion → RRF fusion → recency boost → **MMR** → session round-robin) computed pairwise similarity via `tokenize()`/`jaccard()` on raw text — the file's own header named it "MMR Diversity (token-Jaccard proxy)." Meanwhile `memory-initializer.ts`'s `searchEntries()` computes real embedding-cosine similarity at **two** live sites (RaBitQ-rerank, brute-force SQL) for the primary relevance score, then discards the parsed embedding before returning (return type never included one). The two CLI/MCP bridge sites (`memory-tools.ts`, `commands/memory.ts`) had nothing to pass through as a result. A second, independent instance of the same root cause: `controller-registry.ts`'s `toCands()` (feeds the separate, zero-production-caller `hybridSearch` controller) had the embedding available on `r.entry.embedding` but never copied it from its internal `_entry` stash to `.embedding`.

## Competitor Comparison

| System | Diversity mechanism | Similarity basis | Tunable? | Grade |
|---|---|---|---|---|
| LangChain/LangGraph | `maximal_marginal_relevance()`, `search_type="mmr"` | Embedding (cosine) | Yes (`lambda_mult`) | B |
| Qdrant | Native `Mmr` query object | Embedding (cosine/vector distance) | Yes (`diversity` 0–1) | A |
| Weaviate | Native MMR reranker (v1.37) | Embedding | Yes (`balance`) | A |
| Milvus | Grouping Search (`group_by_field`) | Categorical/lexical (field equality) | Bucket-shape only, no λ | B |
| Vespa | Result-grouping language | Lexical/attribute by default | Bucket sizes only | B |
| LanceDB | No diversity reranker (relevance-fusion rerankers only) | None built-in | N/A | B |
| Mem0 | No MMR — cross-encoder relevance rerank instead | N/A | N/A | B |
| CrewAI | No MMR — composite similarity+recency+importance, write-time consolidation | N/A | N/A | B |
| OpenAI `file_search` | No MMR — relevance ranking options only | N/A | N/A | B |
| Ruflo `smart-retrieval.ts` (before tonight) | MMR present, but token-Jaccard proxy | Lexical | Yes (`mmrLambda`), but wrong similarity basis | — |

Ruflo is the only system reviewed that already computes embeddings for retrieval yet paid nothing for that investment at MMR — behind Qdrant/Weaviate's pattern, arguably behind LangChain's decade-old default, while doing strictly more than the four systems that skip diversity re-ranking entirely.

## Hypothesis

> Given SmartRetrieval's MMR diversity re-ranking step (`mmrRerank` in `smart-retrieval.ts`) operating on `SearchCandidate` objects sourced from `searchEntries()` (`memory-initializer.ts`), when the per-pair similarity term is changed from token-Jaccard text overlap to embedding-cosine similarity (reusing the ONNX embedding `searchEntries()` already computes but previously discarded), falling back to token-Jaccard when either candidate lacks an embedding or dimensions mismatch, then MMR-selected diversity should correctly suppress low-token-overlap semantic near-duplicates (paraphrases) that a lexical-only proxy misses, subject to: (1) non-MMR pipeline phases (RRF fusion, recency boost, session round-robin) unchanged; (2) all existing tests remain green; (3) $0 evaluation cost, zero new LLM calls; (4) the embedding field does not leak into final CLI/MCP JSON responses.

Frozen before evaluation; not modified after seeing results.

## Benchmarks / Evaluation

**evaluated: accepted.** Real evaluator: Vitest, deterministic, zero LLM calls, $0 cost. Candidate touches 5 files (~110 net lines): `memory-initializer.ts` (thread embedding through both live compute sites), `smart-retrieval.ts` (`embedding?` field, `cosineSimilarity`/`pairSimilarity` helpers, `mmrRerank` uses cosine-with-fallback), `controller-registry.ts` (`toCands` copies `r.entry.embedding`), `memory-tools.ts` + `commands/memory.ts` (bridge mappers pass `embedding` through), plus 2 new tests in `smart-retrieval.test.ts`.

Discriminating test: A (seed), B (paraphrase of A — 1/11 Jaccard overlap, embedding-cosine ≈1.0), C (different topic — 0 Jaccard overlap, embedding-cosine ≈0, lower relevance score than B). Baseline-isolated via `git stash` of the 5 source files (test kept): **baseline picks B second** (0.2154 > 0.21 under Jaccard — it can't tell "low overlap because paraphrase" from "low overlap because unrelated") — reproduced live, confirmed failing. **Candidate picks C second** (cosine correctly flags B as A's near-duplicate). A second, non-discriminating regression test (embeddings absent/mismatched) passes both ways, confirming the fallback path is unchanged — disclosed honestly per this repo's evaluation-transparency convention.

Full `@claude-flow/memory` suite: **460/461 passing, identically with/without the candidate** (`controller-registry.test.ts` + `graceful-retrieval.test.ts`: 75/75). The 1 failure (`auto-memory-bridge.test.ts`, chmod-based, can't enforce read-only under a root-owned sandbox) is pre-existing, same class as every night since 08-15. `tsc --noEmit` on `@claude-flow/memory`: zero errors. `@claude-flow/cli`'s `tsc --noEmit`: 455 errors both with and without this candidate (verified via `git stash`, identical count) — pre-existing, caused by unbuilt workspace packages (`@claude-flow/memory`/`neural`/`cli-core` have no `dist/`), unaffected by this diff.

Adversarial critique (STEP 10): weakened the benchmark? No — additive tests, full-suite run. Altered gold answers? No LLM/gold-answer path exists. Cherry-picked? No, full 461-test suite both ways. Cost/latency regression? No — pure in-memory float math, no new I/O (embedding was already parsed in scope). Undocumented caching/threshold changes? No. Leaks the embedding externally? Checked: both CLI/MCP mappers (`memory-tools.ts:559-569`, `commands/memory.ts:633-639`) whitelist output fields rather than spreading the candidate — confirmed it cannot reach a tool caller's JSON response.

## Darwin Results

Skipped — scope mismatch, same class as every recent night. This is a correctness/similarity-metric fix with a discriminating unit test, not a continuous parameter with a gold-labeled retrieval corpus to search a fitness gradient over.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `db4991967c45c6f72133dff0bb80b0a492960fc1` |
| Gist SHA-256 (pre-witness content) | `6a2c2fd79a37e7c0d5955fc4570d2e31d3db7fdbb6bd89c01df28186181324a1` |
| Witness stamp | `9ce94e313fd75bb9fbf313c029300f1ac00f24fa5b47ea31df08d674bab774f4` |
| Evaluation receipt | deterministic Vitest, `git stash`-isolated baseline vs. candidate (see Evaluation section) |
| Flywheel evidence | none signed — deterministic-test evidence, same class as every accepted night since 08-18 |
| Darwin lineage | none — skipped, scope mismatch (see Darwin Results) |

Verifier procedure: fetch this file as it existed before this table was filled in (a one-line placeholder sentence), SHA-256 it, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **Merge the linked draft PR** — small, additive, reversible, matching Qdrant/Weaviate's production pattern, with an honest baseline-fails/candidate-passes test.
2. **Follow-up (deferred, larger scope)**: `searchEntries()` also never returns `metadata`/`createdAt`/`updatedAt`, silently no-opping 2 of SmartRetrieval's other 3 phases (recency boost, session round-robin) for every CLI/MCP `smart:true` search. Same fix shape, but needs 2 SQL `SELECT`s extended (new columns, not just returning an already-computed value) — a dedicated night.
3. **Follow-up (plugins scan, 08-28 finding still open)**: `PluginManager.installFromNpm()` shells straight to `npm install`, never checking the downloaded package against the registry's `checksum`/`cid`/`trustLevel` fields — defined and displayed, never enforced. Fix: verify the tarball hash before writing the manifest, or drop the fields since leaving them is misleading.
4. Human review/merge of the growing 08-24..09-02 ACCEPT-evidence draft-PR backlog (see issue for tonight's backlog-guard workflow).
