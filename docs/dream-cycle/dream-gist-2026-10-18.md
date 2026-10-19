# Memory SOTA Report — 2026-10-18

TL;DR: Tonight's 2026 memory deep-dive ships a real fix: `ReasoningBank.consolidate()` (`v3/@claude-flow/hooks/src/reasoningbank/index.ts`) deletes pruned/deduplicated patterns from `shortTermPatterns`/AgentDB but never removed them from their own HNSW index — in a long-running process (the `HooksLearningDaemon` calls `consolidate()` every 60s), orphaned points accumulate until the index's `maxElements` cap is hit, at which point `storePattern()`'s unguarded `addPoint()` throws `"Index is full, cannot add more elements"` permanently, even though zero patterns are actually live. Fixed with two one-line `removePoint()` calls alongside the existing deletion sites. 2026 research surfaced three C-grade-evidence directions (LoRA memory distillation, gradient-conflict forgetting mitigation, literal ReasoningBank-paper alignment) judged not testable tonight, plus an A-grade quantization-crossover finding and two scan findings (plugins: trust policy never reaches the runtime plugin registry; automation: a daemon auto-restart race leaks orphaned timers) carried forward.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| RaBitQ (bounded-error quantization) is the dominant 2024-2026 ANN quantization method; LanceDB/Qdrant/Milvus have all productionized variants through 2025-2026 | Gao & Long, SIGMOD 2024 (arXiv:2405.12497); LanceDB blog (2026); Milvus/Zilliz RaBitQ feature (~Nov 2025) | A (core paper) / B (vendor features) |
| Qdrant's documented quantization crossover: binary quantization only pays off at ≥~1024-dim embeddings; scalar(int8) is the safe default below that | Qdrant official docs, qdrant.tech/quantization/ | A |
| ReasoningBank (RETRIEVE→JUDGE→DISTILL→CONSOLIDATE memory framework) is a direct terminology match to Ruflo's own module naming; its core claim is that distilling *generalizable strategies* beats raw-trajectory or success-only memory | Ouyang, Yan et al., arXiv:2509.25140 (UIUC + Google Cloud AI Research) | B (arXiv preprint, ICLR-2026 claim unverified) |
| DuoMem/TMEM: LoRA-adapter memory distillation into parameter space, not just prompt-space, reports large small-model gains (4.3%→77.9% on ALFWorld) | arXiv:2606.29961 (DuoMem), single-source TMEM reference | C (single-source, unverified numbers) |
| 2026 continual-learning work (CNL gradient-conflict freezing, FOREVER forgetting-curve replay) trends past vanilla EWC, claims near-zero in-set forgetting | Jan 2026 preprints (exact arXiv IDs approximate from search) | C (unverified) |
| No competitor runs a principled weight/representation-level anti-forgetting technique — Ruflo's EWC++ is the sharpest validated strength in the whole comparison set | Direct comparison across Mem0/Zep/Letta/LangGraph/CrewAI docs | A (absence confirmed across primary docs) |

## Ruflo Current Capability

`ReasoningBank` (`v3/@claude-flow/hooks/src/reasoningbank/index.ts`) is Ruflo's pattern-learning memory: `storePattern()` adds new patterns to both an in-memory `Map` and a real `HNSWIndex` (from `@claude-flow/memory`, `maxElements = maxShortTerm + maxLongTerm`); `consolidate()` — invoked automatically every 60s by `HooksLearningDaemon` — prunes old low-usage patterns and deduplicates near-identical ones. Confirmed by direct inspection: `HNSWIndex.removePoint(id)` exists and correctly frees capacity (`hnsw-index.ts:412`, capacity check is against `this.nodes.size`), but `consolidate()`'s prune loop (line ~586) and dedup loop (line ~594) called `deleteFromStorage(id)` (AgentDB only) and never `removePoint()` — confirmed via grep, zero calls to `removePoint` anywhere in the `hooks` package before tonight.

## Competitor Comparison

| System | Mechanism (persistence / ranking / consolidation) | Grade | Source |
|---|---|---|---|
| Qdrant | On-disk HNSW + scalar/binary quantization, overfetch-and-rescore recall recovery; no forgetting layer | A | qdrant.tech/quantization/ |
| Milvus | RaBitQ 1-bit quantization (32x compression), segment-based storage; no consolidation layer | B | Zilliz blog (~Nov 2025) |
| Weaviate | HNSW + 4 quantization modes (PQ/BQ/SQ/RQ); no consolidation layer | B | docs.weaviate.io/weaviate/concepts/vector-quantization |
| Mem0 | Atomic-fact extraction, dense cosine ranking; no published consolidation; LOCOMO SOTA claim actively disputed by Zep | B (contested) | arXiv:2504.19413; Zep rebuttal |
| Letta/MemGPT | Core/archival memory blocks; "sleep-time agents" do LLM-rewrite reflection-based consolidation (docs flag it experimental) | B | docs.letta.com/guides/agents/sleep-time-agents |
| Zep/Graphiti | Bi-temporal knowledge graph; contradicted facts get `invalid_at`, never deleted — consolidation means "never overwrite," not prune | B (contested) | arXiv:2501.13956 |
| LangGraph | Checkpointer (thread state) vs. store (cross-thread); ranking/consolidation explicitly out of scope, left to app code | A | docs.langchain.com/oss/python/langgraph/persistence/ |
| CrewAI | Unified `Memory` class; LLM-inferred importance/recency scoring at write time | B | docs.crewai.com/concepts/memory |
| OpenAI Agents SDK | `SQLiteSession` is a raw conversation log only — no semantic extraction or consolidation (deliberate scope limit, third-party fills the gap) | B | Hindsight/Supermemory integration docs (2026) |

**Where Ruflo stands:** behind Qdrant/Milvus/Weaviate on raw vector-engine maturity (Ruflo's measured HNSW gain ~1.9x-4.7x vs. Milvus's production-scale 32x RaBitQ), but ahead of every agent-memory competitor on principled catastrophic-forgetting mitigation — EWC++ has no analog in Mem0/Zep/Letta/LangGraph/CrewAI. The sharpest gap: no published Ruflo score on the exact benchmarks (LOCOMO, LongMemEval) Mem0/Zep are fighting over, so the EWC++ advantage can't yet be converted into a comparative claim.

## Hypothesis

> Given a `ReasoningBank` instance with a real HNSW index enabled, running `consolidate()` to prune/deduplicate patterns, when `consolidate()`'s prune and dedup loops also call `this.hnswIndex.removePoint(id)` for every id removed from `shortTermPatterns` (not just `deleteFromStorage(id)`), then patterns removed from the pattern maps are also removed from the HNSW index — so repeated `consolidate()` cycles do not exhaust the index's `maxElements` capacity and `storePattern()` continues to succeed — subject to: zero behavior change for still-live patterns' search results; all existing tests green; deterministic, $0, zero-LLM evaluation. Frozen before evaluation; not modified after seeing results.

## Benchmarks

No `.harness/bench.json` corpus exists (confirmed, same as every recent night). Real evaluator: Vitest 4.1.8 against a real, from-source-built `@claude-flow/memory` + `@claude-flow/neural` (both required no-op dist builds in this session before the real AgentDB/HNSW backend would activate instead of silently falling back to in-memory mode — verified via direct internals inspection, not assumed), deterministic, $0, zero LLM calls.

## Evaluation

**evaluated: accepted.** Two new discriminating tests added to `reasoningbank.test.ts` (prune path, dedup path), each constructing a `ReasoningBank` with a tiny `maxElements` so the bug surfaces without thousands of insertions.

Stash-isolated baseline (`git stash` on just `index.ts`, tests kept): **both new tests fail exactly as predicted** — `Error: Index is full, cannot add more elements`, thrown from `HNSWIndex.addPoint` (`hnsw-index.ts:265`) via `ReasoningBank.storePattern` (`index.ts:352`), at the final `storePattern()` call in each test. Candidate (fix restored): both pass. Full `@claude-flow/hooks` package suite: **147/147 passed, 7/7 files**, zero regressions. `tsc --noEmit`: clean, 0 errors.

One pre-existing test (`storePattern > should store multiple different patterns`) timed out once under a tight 20s bound during a full-suite run — confirmed environmental (real sql.js/HNSW cold-init overhead, 6-23s per fresh `ReasoningBank` instance in this sandbox) and unrelated to this diff: it passes in isolation at 23s with a 60s bound, and it exercises `storePattern()`'s basic insert path, not `consolidate()`. Not counted as a regression.

## Darwin Results

Skipped — binary correctness/wiring fix (call an existing, already-correct removal method at the two sites that needed it), no continuous/categorical parameter for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available) to search over. Same skip class as nearly every accepted fix since 2026-08-18.

## SOTA Proof & Witness

```
Session commit:   b93144803bb171b12993b715fe7b2dd936b6edd5
Candidate commit: (this branch's head — see PR for exact SHA)
Gist SHA-256 (pre-witness): e420e43b1941594a939d3ab07f07155681d069faef7a0882080b4478c44f9d13
Witness stamp:    b2ad8c15f87b785fcbdd299e0816f4b163e48b85b8eab7020c565671a4432268
```
Verifier: fetch this file from the branch, strip this block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. **Apply the same removal-completeness audit to other HNSW consumers in the repo** (`smart-retrieval.ts` / `AgentDBAdapter` paths) — this exact bug class (delete from map/DB, forget the vector index) may not be unique to `ReasoningBank`.
2. **`consolidate()`'s dedup loop iterates a stale `Array.from(...)` snapshot while mutating the live Map** — a sibling to `intelligence.ts`'s correct `compactPatterns()` (which guards against this), causing double-counted `duplicatesRemoved` stats and redundant `deleteFromStorage()` I/O calls on an already-removed id. Tiny (~3-5 line) fix, deferred to keep tonight's patch to one conceptual change.
3. **`AgentDBAdapter.update()` (`v3/@claude-flow/memory/src/agentdb-adapter.ts:294-303`) mutates `entry.content` before the fallible embedding-regeneration call** — a throwing `embeddingGenerator` leaves `content` and `embedding` permanently mismatched with no error signal to callers. Real correctness bug, separate file, deferred.
4. **Plugin trust/permission enforcement is manifest-only and never reaches the runtime plugin-extension registry** (`@claude-flow/plugins`'s `plugin-registry.ts`/`enhanced-plugin-registry.ts` never import `trust-policy.ts`) — a plugin correctly flagged `withheld` at install time would run fully trusted if ever registered through that path. Candidate for a future security-deep night.
5. **`DaemonManager`'s auto-restart path (`v3/@claude-flow/hooks/src/daemons/index.ts`) leaks orphaned `setInterval` timers** under overlapping failures during the backoff window (non-atomic `restart()`, no single-flight guard). Candidate for a future automation night.
6. **Add a dimension-aware quantization-mode guard**: Qdrant's documented crossover says binary quantization only pays off at ≥~1024-dim; Ruflo's actual embeddings (all-MiniLM-L6-v2) are 384-dim, below that threshold — worth a config-level audit/guard on a future night rather than assuming binary quantization is a win everywhere.
