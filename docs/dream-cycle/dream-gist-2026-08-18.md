# Memory SOTA Report — 2026-08-18

TL;DR: Tonight's memory deep-dive found that three consecutive prior Dream Cycle nights (2026-06-08 → ADR-341, 2026-08-08, 2026-08-13) independently proposed "Ruflo needs multi-signal (dense+sparse+entity) retrieval" as if the capability didn't exist — it does. `@claude-flow/memory`'s `hybridSearch` controller (ADR-125 Phase 5 / ADR-147) is a fully built, unit-tested three-arm RRF+MMR fusion engine. The real gap is reachability, not capability: the controller's explicit opt-in (`controllers: { hybridSearch: true }`) silently no-op'd to `null` unless a caller also hand-built a full `UnifiedMemoryService` wrapper — something no production call site does. Shipped a small, additive, opt-in-only fix, and built the first real retrieval-quality benchmark this feature has ever had. Result: a genuine, disclosed, mixed picture — large recall gains on keyword-exact and entity-named queries, parity on mixed/easy queries, and a real, statistically significant regression on pure-paraphrase queries where fusion noise dilutes an already-perfect dense signal.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Dense+sparse RRF fusion roughly *matches* the stronger single signal in aggregate; its real value is per-query-type robustness where the two signals disagree | vstash, arXiv 2604.15484 (Apr 2026) — reproducible in-paper numbers (Vector NDCG@5=0.809, FTS=0.631, Hybrid=0.814) | A |
| MMR diversity reranking adds a further ~+1.8% NDCG@5 on top of RRF, mainly a diversity/coverage gain not a raw-relevance gain | vstash, arXiv 2604.15484 | A |
| Workload-adaptive cascade fusion (BM25+HNSW) "substantially outperforms" single-signal retrieval for long-term conversational memory (no clean numeric delta extracted) | AgentIR, arXiv 2605.25092 (May 2026) | B |
| No named academic anti-pattern exists for "capability built and explicitly requestable via config, but silently inert because the required object is never constructed on any production path" — the closest documented territory is feature-toggle/config-drift technical debt, which describes toggles left *on* accidentally, not capabilities left permanently unreachable | FSE'12 feature-toggle study (peer-reviewed) + arXiv 2604.15872 (Apr 2026) | A / B |
| Only Mem0 ships a comparably rich (dense+sparse+entity) fusion among surveyed competitors, and it's default-on — Ruflo's equivalent is architecturally competitive or ahead in signal richness (3 fully-fused arms + MMR vs Mem0's simpler design) but unreachable by default | Live competitor research, 2026-08-18 | B (Mem0's own benchmark numbers, vendor-reported) |

## Ruflo Current Capability

`v3/@claude-flow/memory/src/controller-registry.ts`'s `hybridSearch` controller runs `semanticSearch()` (dense), `searchKeyword()` (sparse FTS5-style), and a per-entity keyword pass (`entity-tagger.ts`, proper-noun/email/URL/quoted-phrase extraction) independently in parallel, fuses via Reciprocal Rank Fusion (`smart-retrieval.ts`), and diversifies via MMR. It's real: `graceful-retrieval.test.ts`'s existing "Phase 5 — hybridSearch controller (RRF + MMR)" tests confirm dense+sparse fusion and entity-arm boosting work correctly, and the package README documents it as a shipped 3.0.0-alpha.18 feature. But `isControllerEnabled('hybridSearch')`'s default condition requires `config.memoryService` (a full `UnifiedMemoryService` wrapper), and — until tonight — the factory (`createController`) had **no fallback** when a caller explicitly requested `hybridSearch: true` but only had a `backend` (e.g. a raw `AgentDBAdapter`, which the production CLI/MCP path in `memory-bridge.ts` always uses). The explicit override worked at the gate but not at construction — a silent no-op with no error, no warning, and no signal explaining why `registry.get('hybridSearch')` came back `null`.

## Competitor Comparison

| Framework | Hybrid dense+sparse(+entity) fusion? | Default-on or opt-in | Confidence |
|---|---|---|---|
| Mem0 | Yes — dense + BM25 + entity-linking, closest comparator to Ruflo's design | **Default-on** (core `search()`) | B (vendor benchmark, 92.5 LoCoMo/94.4 LongMemEval, Apr 2026) |
| LangGraph BaseStore | Dense-only natively; no built-in RRF fusion | Opt-in (`index` config) | B |
| CrewAI | No native fusion in core memory; fusion only via optional tools (e.g. WeaviateVectorSearchTool) | Opt-in, per-tool | C |
| AutoGen/AG2 | No native fusion; needs a Mem0 plugin bolt-on | Opt-in, third-party | C |
| OpenAI Agents SDK | None — Sessions persist raw history only | N/A | A (official docs) |
| Qdrant / Weaviate / Milvus / LanceDB | All support dense+sparse RRF/relativeScoreFusion | Opt-in — explicit hybrid API call required per query | B |

No published postmortem or GitHub issue was found (competitor-analyst search, 2026-08-18) describing another team shipping a hybrid retrieval feature that then sat unreachable in production from a default-path config gap — this appears to be a genuinely under-documented failure mode, not a known/common one.

## Hypothesis

Given a caller that explicitly opts into `controllers: { hybridSearch: true }` with a JS-side `backend` (e.g. `AgentDBAdapter`) but no hand-built `UnifiedMemoryService`, when `createController('hybridSearch')` falls back to constructing the fusion controller directly from that backend (duck-typed on `semanticSearch`+`searchKeyword`) instead of silently returning `null`, then retrieval quality (recall@10 / MRR) on a mixed keyword+semantic+entity query set should differ measurably from the vector-only baseline that explicit opt-in silently fell back to before — subject to: (1) default (non-explicit) auto-enable behavior is completely unchanged; (2) all existing hybridSearch/controller-registry tests remain green; (3) zero LLM cost.

## Benchmarks

New bespoke, deterministic, $0 benchmark (`v3/@claude-flow/memory/benchmarks/results/scripts/hybridsearch-quality-benchmark.mjs`) — no LLM calls, seeded PRNG, 300 synthetic entries / 60 queries across 4 categories (15 instances each), designed *before* any run per the vstash calibration (per-category deltas, not one misleading aggregate): **A-keyword-exact** (target has a literal rare token dense-only can't see), **B-paraphrase-semantic** (target paraphrases the query with zero literal overlap, embedded near it — dense-only's best case), **C-entity** (target names a person the query asks about, topically unrelated otherwise), **D-mixed-control** (both signals agree — expected near-ceiling for both, a sanity check not a differentiator). Both baseline and candidate resolve query embeddings through the identical `embeddingGenerator` function — the first version of this script had an unfair baseline (the candidate's internal dense arm silently degraded to keyword-only from a missing embedder while the baseline got hand-crafted embeddings directly); found and fixed before finalizing numbers, the same class of self-caught methodology bug as the 2026-08-17 paired-t stddev fix.

## Evaluation

**evaluated: accepted, scoped.** Full receipt: `v3/@claude-flow/memory/benchmarks/results/hybridsearch-quality-receipt.json`.

| Category | Baseline recall@10 | Hybrid recall@10 | Δ | MRR Δ (paired t) |
|---|---|---|---|---|
| A-keyword-exact | 0.000 | 0.867 | **+0.867** | +0.157 (t=4.17) |
| B-paraphrase-semantic | 1.000 | 0.867 | **-0.133** | -0.551 (t=-5.75) |
| C-entity | 0.000 | 0.333 | +0.333 | +0.333 (t=2.65) |
| D-mixed-control | 1.000 | 1.000 | 0.000 | 0.000 (t=0.00) |
| **Overall** | 0.500 | 0.767 | **+0.267** | — |

The aggregate is a real, substantial net positive — but categories B and C are the honest, disclosed nuance the aggregate hides. Category B is a genuine, statistically significant **regression**: when dense-only already nails a query perfectly, fusing in sparse/entity-arm noise can bump the correct answer out of the fused top-10 (2/15 instances) or push down its rank. Category C's recovery (33%, vs. category A's 87%) is weaker than expected — plausibly because category C's distractors share generic vocabulary overlap with the target (unlike category A's distractors, which share none), letting the sparse arm partially favor distractors too; flagged as a follow-up question, not resolved tonight. Existing test suite: 75/75 passing (7 in `graceful-retrieval.test.ts` incl. 3 new, 68 in `controller-registry.test.ts`), zero regressions; full `@claude-flow/memory` suite 458/459 (1 pre-existing environmental failure — a chmod-based read-only-file test that can't enforce under a root-owned sandbox, same documented class as 2026-08-15's finding, confirmed unrelated to this candidate).

## Darwin Results

Skipped — scope mismatch, same class as three of the last four nights. `@metaharness/darwin`'s real interface (`evolve --bench <corpus>`) mutates routing/topology/prompt/memory/tool/tier/context/coordination parameters against LLM-scored task corpora; there's no analog for a binary code-path fallback (does the fallback exist or not) — it isn't a continuous or categorical parameter to tune.

## SOTA Proof & Witness

See the linked issue and PR for the full witness stamp (session commit, report hash, witness hash) and verifier procedure.

## Recommended Next Steps

1. **Investigate category B's regression as a follow-up candidate**: a confidence-gated fusion — when the dense arm's top result already clears a high similarity threshold, skip fusing in sparse/entity arms entirely (or down-weight them) rather than always running all three. This directly targets tonight's disclosed regression without touching the default-disabled reachability fix.
2. **Wire `memory-bridge.ts` (the actual CLI/MCP production path) to hybridSearch, in a dedicated future night** — tonight's fix makes the controller reachable via explicit config, but the CLI's `memory search` command still never sets it. That's a larger, riskier change (touches the hot CLI startup path) deliberately left out of tonight's small, safe, opt-in-only scope.
3. **Re-run category C with a stronger entity-arm weighting** (currently equal RRF weight to dense/sparse) to test whether the weaker 33% recovery is a tunable weighting issue vs. an inherent limit of the regex-based entity tagger — a scoped, cheap follow-up experiment.
