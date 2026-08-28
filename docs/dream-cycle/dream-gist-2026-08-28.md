# Memory SOTA Report — 2026-08-28

TL;DR: Tonight's memory deep-dive re-verified yesterday's (2026-08-27) flagged finding — `HybridBackend.queryHybrid()`'s `weights` field (`v3/@claude-flow/memory/src/hybrid-backend.ts`) is computed and then discarded, so `combineUnion` was a plain set-union with zero score math — and found it's a *stronger* dead-API claim than reported: `weights` is never populated by any caller in the repo (internal or example), not merely unconsumed once set. Deep research also surfaced a materially different, higher-value finding — a *second*, real, tested, RRF+MMR three-arm hybrid-search engine (`controller-registry.ts`'s `hybridSearch` controller, ADR-125/147) already exists and has **zero production callers** — but wiring it into the CLI's `memory_search` MCP tool turned out, on inspection, to require bridging two architecturally separate memory subsystems (the tool's real path uses a lightweight `memory-initializer.ts` bridge, not `ControllerRegistry`/`AgentDBAdapter` at all), which is a larger, riskier change than initially scored. Tonight's shipped candidate is the smaller, self-contained fix: `combineWeighted`, a weighted reciprocal-rank-fusion (RRF) combiner that makes `weights` actually control result ordering for the `'union'` strategy, matching the fusion shape documented by Qdrant/Weaviate/Azure AI Search. Evaluated via deterministic Vitest (zero LLM calls), baseline-isolated via `git stash`: the new weight-sensitivity test fails on baseline and passes on candidate; full package suite 461/462 green (1 pre-existing, unrelated environmental failure, confirmed identical on both baseline and candidate).

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| RRF (`1/(rank+k)`, k=60 standard) sidesteps score-scale incomparability (BM25 unbounded vs. cosine [-1,1]) by fusing on rank, not raw score | OpenSearch blog, updated 2025-11-11 | A |
| Production hybrid systems apply per-arm weights as a *multiplier on that arm's RRF contribution before summation* ("weighted-RRF"), not as an α-blend of raw scores | Azure AI Search docs, ms.date 2026-06-08 | A |
| Six of eight surveyed vector/search systems (Qdrant, Weaviate, Milvus-WeightedRanker, ES `linear` retriever, OpenSearch, Azure) expose a caller-tunable weight that provably reorders results; the other two (plain RRF retrievers, Mem0) withhold it as a *deliberate* design choice, not an oversight | Live competitor research, 2026-08-28 (official docs, all fetched today) | A |
| Excessive fusion complexity doesn't reliably improve agent-memory retrieval; conservative, localized updates beat aggressive summarization/over-engineering | arXiv:2606.24775 (Jun 2026) | B |
| MMR diversity reranking in Ruflo's own `smart-retrieval.ts` uses a token-Jaccard proxy for the diversity term, not embedding-cosine similarity, despite candidates already carrying embeddings — an explicit code-comment admission, not a hidden bug | Direct code read, `smart-retrieval.ts:241` | A |

## Ruflo Current Capability

`hybrid-backend.ts`'s `HybridQuery.weights` (declared L139-143) is read once (L413: `query.weights || {semantic:0.7, structured:0.3}`) and then never referenced again — `combineUnion`/`combineIntersection`/`combineSemanticFirst`/`combineStructuredFirst` are pure set/list operations, no numeric fusion. `querySemantic()` also drops `SearchResult.score` when it flattens to `MemoryEntry[]` (which has no score field at all), so no score survived to the merge step even if it were consulted. Separately — and this is the night's more consequential discovery — `controller-registry.ts`'s `hybridSearch` controller (dense + BM25 + entity arms, real `applyRRF`+`applyMMR` fusion, tested at `graceful-retrieval.test.ts:102-281`) is fully built and correct, but is reached by **zero production call sites** anywhere in `cli/src` or `hooks/src`; the CLI's actual `memory_search` MCP tool path never constructs a `ControllerRegistry` at all. `HybridBackend` (this fix's target) is confirmed live in production: `database-provider.ts:301-302` wires it as `createDatabase`'s default backend.

## Competitor Comparison

| System | Fusion mechanism | Caller-tunable weight? | Grade |
|---|---|---|---|
| Qdrant | `fusion: rrf` / `dbsf`, `query.rrf.weights` per prefetch | Yes — direct RRF-sum multiplier | A |
| Weaviate | `relativeScoreFusion` (min-max normalize + weighted sum) | Yes — `alpha` param | A |
| Milvus | `WeightedRanker` (explicit per-field weights) vs. unweighted `RRFRanker` | Yes, when WeightedRanker chosen | A |
| Elasticsearch/OpenSearch | `linear` retriever / `normalization-processor`, explicit `weight`/`weights` | Yes for both | A |
| Azure AI Search | RRF with per-query `weight` multiplier before the RRF sum | Yes (RRF `k` itself is not) | A |
| LanceDB | Default `RRFReranker` (rank-only); custom `Reranker` subclass hook for weighting | Partial — mechanism exists, not first-class | B |
| Mem0 (agent-memory) | Semantic + BM25 + entity fusion, internal/automatic | No — deliberate design choice, not exposed | B |
| Ruflo `HybridBackend` (before tonight) | `weights` field declared, computed, never consumed; pure set-union | No — dead code | — |

Every competitor surveyed ships a real fusion mechanism; Ruflo's `hybrid-backend.ts` sat below the whole field — worse than even Mem0's "no knob" case, since Mem0 at least fuses on score.

## Hypothesis

Given `HybridBackend.queryHybrid()`'s `'union'` combine strategy, when `combineUnion` (plain set-union, `weights` unused) is replaced with `combineWeighted` — a weighted-RRF fusion (`weights.semantic`/`weights.structured` as per-arm multipliers on each arm's `1/(k+rank+1)` contribution, k=60, matching Ruflo's own `smart-retrieval.ts` convention) — then result ordering for `'union'`-strategy hybrid queries should become provably weight-sensitive (increasing `weights.semantic` promotes semantically-favored entries; increasing `weights.structured` promotes structurally-favored entries), subject to: (1) `'intersection'`/`'semantic-first'`/`'structured-first'` strategies unchanged; (2) all existing tests green; (3) $0 evaluation cost. Frozen before evaluation; not modified after seeing results.

## Benchmarks / Evaluation

**evaluated: accepted.** Real evaluator: Vitest, deterministic, zero LLM calls. Candidate: `v3/@claude-flow/memory/src/hybrid-backend.ts` (net +59/-24 lines: new `querySemanticScored` preserving score, new `combineWeighted`, dead `combineUnion` removed since it became unreachable) + 3 new tests in `hybrid-backend.test.ts` (+83 lines). Two entries with deliberately opposed per-arm ranks (one closer semantically, the other more-recently-stored so it ranks first under SQLite's `ORDER BY created_at DESC`) let weight configuration flip which one tops the fused result — this is the discriminating test.

Baseline-isolated via `git stash` of only `hybrid-backend.ts` (test file kept): the structured-weight-dominant test **fails** on baseline (`fusion-sem-fav` wins regardless of weights, since plain concatenation always orders semantic arm first) and **passes** on candidate. Disclosed honestly: of the 3 new tests, only this one discriminates baseline from candidate — the semantic-weight-dominant test and the full-union regression test both happen to pass on baseline too (baseline's plain concatenation already puts semantic first / already returns the full union), so they're regression guards, not proof-of-fix on their own. Full `@claude-flow/memory` suite: 461/462 passing, both with and without the candidate — the 1 failure (`auto-memory-bridge.test.ts`, a chmod-based read-only-file test that can't enforce permissions under a root-owned sandbox) is confirmed pre-existing and unrelated, same documented class as 2026-08-15/18/19's nights. `tsc --noEmit`: zero errors.

## Darwin Results

Skipped — scope mismatch, same class as most recent nights (`npx ruvector harness darwin --help` confirms the real interface tunes continuous/categorical parameters against an LLM-scored benchmark corpus). This is a correctness/wiring fix (a field either gets consumed or it doesn't) with no gold-labeled retrieval corpus to search a fitness gradient over — not a Darwin-shaped candidate.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `d33ef4bf8ab27a8f9ef08352c9c293b53312a861` |
| Gist SHA-256 (pre-witness content) | `35bf1d00e8647db8b2fb0842c5ecdda4737b9a21b0c4a584461fb1db6edf5278` |
| Witness stamp | `47e2f669e6124a686f8dcbe11828339fb8728009ebc3dad8736e8ddf82628510` |
| Evaluation receipt | deterministic Vitest, `git stash`-isolated baseline vs. candidate (see Evaluation section) |
| Flywheel evidence | none signed — deterministic-test evidence, same class as every accepted night since 2026-08-18 |
| Darwin lineage | none — skipped, scope mismatch (see Darwin Results) |

Verifier procedure: fetch `docs/dream-cycle/dream-gist-2026-08-28.md` from this branch as it existed before this table was filled in (this section replaced a one-line placeholder sentence), SHA-256 it, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **Wire the real `hybridSearch` (RRF+MMR, dense+BM25+entity) controller into a reachable production surface** — it's fully built and tested but has zero callers. Requires either extending `memory_search`'s MCP tool to construct a compatible `ControllerRegistry`/backend, or bridging `memory-initializer.ts`'s lighter path to duck-type as `HybridCapableBackend`. Scored higher (4.30 vs. 4.05) than tonight's fix in tonight's candidate ranking but was deliberately not selected tonight — it's a larger, cross-subsystem change that needs its own dedicated night, not a same-night addition to a small fix.
2. **Automation-scan finding (see issue)**: the ledger-append backlog (STEP 25 running correctly every night, but rows stuck on unmerged draft PRs) needs a CI backlog-guard, not another manual backfill — concrete workflow sketch in the issue.
3. **Replace `smart-retrieval.ts`'s MMR token-Jaccard diversity proxy with embedding-cosine similarity** — candidates already carry embeddings upstream; the proxy is an explicit, admitted approximation (`smart-retrieval.ts:241`), self-contained fix for a future night.
