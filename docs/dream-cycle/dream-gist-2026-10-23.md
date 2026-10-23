# Memory SOTA Report — 2026-10-23

TL;DR: In 2026, every major vector-DB and agent-memory vendor's hard problem is index hygiene — deleting/compacting/deduplicating without orphaning data (Qdrant's `deleted_threshold` vacuum, Weaviate's tombstone-cleanup "Phantom Tombstones" incident, LanceDB's lazy-delete-then-compact-then-cleanup). Tonight's own memory deep-dive found Ruflo has a far more basic problem on the exact same axis: `AgentDBBackend`'s entire SQL-fallback persistence path — `createSchema()`/`storeInAgentDB()`/`getFromAgentDB()`/`deleteFromAgentDB()` — has been **100% dead code** against the real, currently-pinned `agentdb@3.0.0-alpha.20` package since it was written. Every memory entry has lived only in a per-instance in-memory `Map`, silently, with `getStats()`/`available` reporting a healthy persisted backend the whole time. Fixed tonight, real evaluation attached.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| ReasoningBank: distilled self-judged trajectory memory w/ MaTTS test-time scaling | arXiv:2509.25140, ICLR 2026 accepted, code public | A |
| Extended RaBitQ: B-bit/dim quantization dial (generalizes Ruflo's fixed 32x RaBitQ) | ACM SIGMOD 2025 (PACMMOD v3n3a202), arXiv:2409.09913 | A |
| FGGM: Fisher-masking continual learning without old-task data (EWC successor candidate) | arXiv:2601.18261 (Jan 2026) | B |
| Filtered-ANN benchmark: Ruflo currently brute-forces every filtered vector search, forfeiting HNSW entirely | arXiv:2509.07789 (Fudan, Sep 2025) | B |
| FadeMem: decay-based forgetting vs. Ruflo's hard-cutoff TTL/dedup | arXiv:2601.18642 (Jan 2026) | C |

## Ruflo Current Capability

`@claude-flow/memory`'s `AgentDBBackend` wraps the real `agentdb` npm package as a durability layer behind an in-memory cache, with an HNSW adapter (`AgentDBHnswAdapter`) built directly from `HNSWIndex` (the earlier `getController('hnsw')` dead-code finding, #4249, is confirmed fixed and shipped in #4322/3.59.0 — not re-opened). `ReasoningBank.consolidate()`'s HNSW orphan-leak (#4271) and `AutoMemoryBridge`'s additive-only delete gap (#4138) are both confirmed still fixed and present at HEAD.

Tonight's finding is upstream of all of that: `this.agentdb.database` is a raw **better-sqlite3** `Database` (confirmed via direct inspection of its prototype: `prepare`, `exec`, `transaction`, `pragma`, `close` — no `.run`/`.get`). The fallback code's compatibility checks (`typeof db.run === 'function'`, `typeof db.get === 'function'`) test for a method that has never existed on any installed `agentdb` version, so they're always false:

- `createSchema()` returns immediately without creating the `memory_entries` table.
- `storeInAgentDB()`/`getFromAgentDB()`/`deleteFromAgentDB()` all hit the same guard and silently no-op, wrapped in empty `catch {}` blocks that swallow even a real thrown error.

Direct reproduction, before any fix: a fresh `AgentDBBackend` (`:memory:`, real `agentdb`) reports `available: true`; after `store()`, `this.agentdb.database.prepare('SELECT * FROM memory_entries...')` throws `no such table: memory_entries`. Fixing just the API-shape check (swap for `.prepare(sql).run(...)`/`.get(...)`) uncovers a **second, independent** latent bug underneath: the schema's `references` column is unquoted, and `references` is a SQLite reserved keyword — `CREATE TABLE`/`INSERT` both throw `SqliteError: near "references": syntax error`, again silently swallowed by the same empty catches. Two stacked bugs, same masking mechanism, same severity class as the ledger's prior "aspirational integration code checking a never-real API" findings (2026-08-30 diskann-backend.ts, 2026-10-10 graph-analyzer.ts, 2026-10-17/#4249) — except this one is the persistence layer itself, not a peripheral acceleration path.

A third, separate defect compounds it: `update()`/`delete()` never had the AgentDB-fallback `get()` already has, so even with persistence fixed, a cache miss (second instance/process against the same `dbPath`) made them no-op immediately.

## Competitor Comparison

| Competitor | Stale-entry deletion w/o orphans | Dedup/consolidation |
|---|---|---|
| Qdrant | Soft-delete + background Vacuum Optimizer; `points_count` explicitly documented as approximate post-delete | none (index hygiene only) |
| Weaviate | Tombstone + async cleanup; real incident GH#5019 "Phantom Tombstones" from a restart mid-condense | none |
| LanceDB | Lazy delete; `optimize()` = compaction (strips rows) + cleanup (frees disk); compaction alone doesn't free space | none documented |
| CrewAI | Manual-only, no background pruning | Cosine-threshold batch dedup (0.98) + LLM-mediated consolidate (0.85), both documented | 
| Mem0 (v3) | Append-only; no auto-delete | Exact-match MD5 hash only, not semantic |
| Zep/Graphiti | Non-destructive: supersede via `invalid_at` timestamp, never garbage-collects | Hybrid cosine+BM25 entity/fact dedup (official) |
| Letta (MemGPT) | No soft-delete primitive; hard REST delete only, retention "indefinite" per own docs + arXiv:2606.15903 | None found |

Ruflo's direct `removePoint`-on-delete approach (once persistence actually works) sidesteps the whole soft-delete/compaction-race bug class the vendors above live with — but tonight shows that promise was resting on a persistence layer that never actually wrote anything to disk.

## Hypothesis

Given an `AgentDBBackend` instance whose entry exists only in the persisted `agentdb` layer (not the current instance's in-memory cache — e.g. a second instance/process against the same `dbPath`), when (a) `createSchema()`/`storeInAgentDB()`/`getFromAgentDB()`/`deleteFromAgentDB()` use `agentdb`'s real synchronous `database.prepare(sql).run()/.get()` API instead of the never-real async `db.run()/db.get()` shape, (b) the `references` column is quoted to avoid the reserved-keyword syntax error, and (c) `update()`/`delete()` fall back to the persisted layer exactly as `get()` already does — then store/get/update/delete should all round-trip correctly across a cache-miss, instead of silently no-op'ing — subject to: zero change to the in-memory-hit fast path, zero regression to the existing suite, deterministic $0 zero-LLM Vitest evaluation. Frozen before evaluation; not modified after.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8 against the real `agentdb@3.0.0-alpha.20` + better-sqlite3 (freshly `pnpm install`-ed this session; `v3/` had no `node_modules`). 3 new tests added to `agentdb-backend.test.ts` (2 discriminating: delete/update a cache-miss persisted-only entry; 1 negative control: a genuinely never-stored id stays a no-op). Stash-isolated baseline: both discriminating tests fail — `get()` itself returns `null` post-cache-clear (persistence never happened), confirming the bug is real, not hypothetical. Candidate: 3/3 pass. One pre-existing test (`agentdb-backend-lock.test.ts`) needed updating — its manual probe table name collided with the schema now actually being created; renamed, intent preserved, both its tests still pass. Full `@claude-flow/memory` suite: 648/649 both baseline and candidate (1 pre-existing environmental failure — a read-only-file permission test that no-ops running as root — confirmed identical via a separate stash/pop re-run), plus the 3 new tests in the narrower run above. `tsc --noEmit`: 0 errors both ways.

## Darwin Results

Skipped — binary correctness fix (an API-shape/SQL-identifier/control-flow bug), no continuous or categorical parameter for Darwin's real interface to search over. Same skip class as nearly every accepted fix since 2026-08-18.

## SOTA Proof & Witness

```
Session commit:   a413f478123085c0f67cab18e19f64b4859eb367
Report SHA-256:   PENDING
Witness stamp:    PENDING
```
Verifier: fetch this file from the PR's branch, strip the Witness block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. Audit every other `@claude-flow/memory`/`@claude-flow/hooks` call site that checks `typeof db.run`/`typeof db.get` against `agentdb`'s `.database` for the same dead-API-shape pattern (grep found none outside `agentdb-backend.ts`, but `sqlite-backend.ts`/`sqljs-backend.ts` use a *different*, independently-correct schema — worth a direct confirmation pass on a future memory night).
2. Fix the filtered-ANN brute-force fallback (`searchWithAgentDB`) using 2025/2026 filtered-HNSW literature (arXiv:2509.07789, ACORN) instead of permanently degrading to O(n) whenever a search carries metadata filters.
3. `ReasoningBank.consolidate()`'s dedup loop (`hooks/src/reasoningbank/index.ts:597-613`) re-compares/re-deletes already-removed patterns in 3+-way similarity clusters, inflating `duplicatesRemoved` and making redundant `removePoint()`/`deleteFromStorage()` calls — small, Vitest-testable, deferred to a future memory night in favor of tonight's higher-severity persistence fix.
