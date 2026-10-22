# Memory SOTA Report — 2026-10-13

TL;DR: Ruflo's `AutoMemoryBridge.importFromAutoMemory()` (the production path
wired into every Claude Code session via `SessionStart`) is additive-only —
it never deletes an AgentDB entry whose source markdown heading was removed.
Deleted content stays retrievable via semantic search indefinitely. This is
genuinely behind 2026 practice, not merely typical of it: LangChain's
`index()` API ships a direct, official blueprint (`cleanup="scoped_full"`)
for exactly this per-source diff-and-delete pattern. Fixed tonight with a
~100-line, zero-schema-migration patch that mirrors an existing Ruflo
precedent (`agentdb-adapter.ts`'s same-key eviction logic).

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| LangChain's `index()` `cleanup="scoped_full"` mode is the official, reproducible pattern for per-source diff-and-delete sync into a vector store | langchain docs, maintained through 2025/26 | A |
| Zep/Graphiti's bi-temporal "never hard-delete, mark `invalid_at`" is the considered 2026 agent-memory answer to unreliable LLM-judged deletes | arXiv:2501.13956 (Jan 2025); Thoughtworks Radar "Trial" Apr 2026 | A |
| Mem0's own repro shows ~25% malformed-JSON failures when an LLM is trusted to decide ADD/UPDATE/DELETE — the stated reason the field avoids naive hard-delete-on-diff | arXiv:2606.15903 (2026) | B |
| No mainstream vector DB (Qdrant/Weaviate/Milvus/LanceDB/Vespa) auto-detects source deletion — a deliberate layering choice, not an oversight (the DB has no concept of "source") | Qdrant/Weaviate/Vespa official docs, 2026 | B |

## Ruflo Current Capability

`importFromAutoMemory()` (`v3/@claude-flow/memory/src/auto-memory-bridge.ts:380-495`)
keys each entry `auto-memory:${file}:${heading}` and tags
`metadata.sourceFile`/`metadata.heading`, but only ever *inserts*: it diffs
new content against a content-hash set to skip/insert, and never computes
"keys AgentDB has for this file that this pass didn't re-see." Confirmed
by code reading and grep (zero `delete`/`bulkDelete` calls in the file,
despite 15+ other files in the package already using
`IMemoryBackend.bulkDelete`). `curateIndex()`'s `MEMORY.md` rebuild reads
topic files directly, so it's unaffected — the leak is specifically
semantic search / `memory query` against the `auto-memory` namespace
surfacing content a human deleted, forever.

## Competitor Comparison

| System | Handles source-deletion sync? | Mechanism | Grade |
|---|---|---|---|
| LangChain `index()` API | **Yes** | content-hash diff + `cleanup="full"`/`scoped_full"` deletes anything the latest pass didn't return | A |
| Zep / Graphiti | Yes (by design, non-destructive) | bi-temporal edges; contradicted facts marked `invalid_at`, never hard-deleted | A |
| Mem0 | Partial, fragile | LLM judges ADD/UPDATE/DELETE per call; ~25% malformed-JSON in independent repro | B |
| Qdrant / Weaviate / Milvus / LanceDB / Vespa | No (deliberate) | deletion primitives exist (TTL, filter-delete, tombstone+compaction) but no source-diff logic — "no concept of source" is the stated design boundary | A/B |
| LangGraph store | TTL only, not source-aware | `store.ttl`/`sweep_interval_minutes`, not retroactive | A |
| AutoGen / OpenAI Agents SDK | No native answer | delegated to third-party bolt-ons (Mem0 etc.) | — |

Ruflo's gap is genuinely behind the honest 2026 baseline at the layer that
matters: raw vector DBs are no worse off, but Ruflo's bridge *is* the
orchestration/agent-memory layer, where this is an active, published,
already-has-reference-designs problem (LangChain ships the recipe).

## Hypothesis

> Given a workload of N previously-imported auto-memory markdown files in
> AgentDB's `auto-memory` namespace, when `importFromAutoMemory()` is
> extended to diff each file's current parsed heading-keys against the
> AgentDB entries previously tagged with that file's `metadata.sourceFile`
> and delete entries no longer present, then entries for headings removed
> from the source file should be deleted from AgentDB within one import
> call (baseline: they persist indefinitely), subject to: (a) entries in
> other namespaces or other source files are unaffected; (b) a per-file
> parse yielding zero entries for non-empty content does not trigger
> deletion (false-full-wipe guard); (c) a per-file read failure does not
> abort processing of other files and does not trigger deletion for that
> file; (d) all existing tests remain green.

Frozen before evaluation; not modified after.

## Benchmarks

Not a performance candidate — this is a correctness/wiring fix (same class
as nearly every ACCEPT in the ledger since 2026-08-18). No benchmark corpus
applies; evaluation is via discriminating unit tests + full-suite
regression, as for every prior wiring/correctness fix in this ledger.

## Evaluation

Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls.

- `auto-memory-bridge.test.ts`: **7 new discriminating tests** (delete on
  removed heading; no-op when heading set unchanged; per-file scoping —
  same heading text in another file untouched; false-wipe guard on
  non-empty-zero-entry parse; per-file read failure caught without
  aborting the batch or deleting that file's own entries; delete-sync for
  a file removed entirely from disk, not just emptied; suspicious-empty-
  directory guard on the same). Stash-isolated (`git diff`/`checkout`/
  `apply` on the source file only, tests left in place): **baseline fails
  all 7**, candidate passes all 7.
- Full `@claude-flow/memory` suite: baseline 606/607 (1 pre-existing
  chmod-under-root flake); candidate 611/614 (+7 new tests; same chmod
  flake plus 2 CPU-contention-sensitive timing tests —
  `consolidator-embedding-benchmark.test.ts` and
  `controller-registry.test.ts`'s 500ms init-time assertion — in files
  this diff does not touch; reproduced failing in isolation, and
  independently confirmed non-deterministic by *not* reproducing on a
  second full-suite baseline run in this same sandbox).
- `tsc --noEmit`: 0 errors, both ways.

**Adversarial critique**: independent critic reviewed the actual diff
(not just the design), verdict **CONFIRMED-WITH-CAVEATS**, then
re-verified after caveats were addressed:
1. *Fixed*: a source file deleted entirely from disk (not emptied) was
   never visited by the per-file loop, so its entries were a permanent,
   undisclosed orphan — closed by a second delete-sync pass over
   `existingByFile` (already fetched, no extra query) diffed against the
   current directory listing, with its own suspicious-empty-directory
   guard.
2. *Fixed*: the try/catch around the per-file read did not also cover
   `parseMarkdownEntries()` — widened to cover both.
3. *Fixed*: the read-failure test asserted "doesn't delete that file's
   entries" without ever seeding an old entry for that file, so the
   assertion was vacuously true — now seeds `broken.md` with a stale
   entry first.
4. *Disclosed, not fixed*: `fetchExistingAutoMemoryIndex()`'s pre-existing
   `limit: 10_000` cap (unchanged by this diff) now also bounds
   delete-sync visibility at that same scale — inherited, not introduced,
   flagged for a future night if the `auto-memory` namespace grows past it.

## Darwin Results

Skipped — binary correctness/wiring fix, no continuous parameter with a
fitness gradient for Darwin's real interface to search over. Same skip
class as nearly every accepted fix since 2026-08-18.

## SOTA Proof & Witness

```
Session commit:   55e2c9011c20d25e347a175427ca8084dacde40c
Gist SHA-256:      b377c4bfed43cceb8589ac54c054f17642bc2944c6f67019072ce85b2e96ded1
Witness stamp:     e32bb6776f3d0d96a23dd989a8249de23ed68f757a750d21bd4d4b449c8bfd7b
```

Verifier: strip the three values above back to `PENDING`, SHA-256 this
file, concatenate with the session commit, SHA-256 again — must equal the
witness stamp. See the paired issue's own Witness section for the filled
values, computed once this file reached its final content.

## Recommended Next Steps

1. **Port the same diff-and-delete pattern to the sibling "edited-content"
   leak**: editing (not removing) a heading's body also leaves the
   pre-edit row forever retrievable under a stale content-hash — same root
   cause, same code path, flagged by tonight's deep-research pass as
   candidate #2 (composite 4.00).
2. **Fix the `scripts/live-ruflo-mods-options.sh` single-plugin-dir gap**
   (plugins SCAN): `plugin.register` structurally cannot fire under the
   current live-verification script because it only ever loads one plugin.
   Point `--plugin-dir` at the parent `plugins/` directory (or add a
   second flag) to resolve last night's disclosed ADR-451 ambiguity.
3. **Reconcile or wire up `PluginStoreConfig`'s dead security fields**
   (plugins SCAN): `minTrustLevel`, `blockedPlugins`,
   `requirePermissionPrompt` etc. are documented in `SECURITY.md` as
   default-secure behavior but are never read anywhere — the real
   enforcement path (`trust-policy.ts`, #3557) ignores them entirely.
   Either wire them in or correct the documentation.
4. **Harden or retire the un-hardened `worker/dispatch` MCP tool**
   (automation SCAN): `@claude-flow/mcp`'s `worker/dispatch`/`worker/status`
   (distinct from the already-hardened `hooks_worker-dispatch` in
   `@claude-flow/cli`) returns hardcoded, input-independent fabricated
   results for all 12 workers (e.g. `executeAudit()` always reports
   `2 high / 5 medium / 8 low` vulnerabilities regardless of the real repo
   state) with no disclosure field — the exact dishonesty class #1700/#1845
   already fixed on the sibling tool, un-ported to this second live surface.
   Worth its own `automation` DEEP night.
5. **Add a same-day "missed dream-cycle run" alert** (automation SCAN):
   no in-repo cron/workflow drives the nightly trigger (confirmed by grep,
   again, tonight), so a fully-silent no-run night (seen 10 times since
   2026-08-20, including 2026-10-04) is currently only discovered days
   later by a human/agent re-deriving it from `git ls-remote`. A small
   daily-scheduled workflow checking for today's `dream/<date>-*` branch
   would close that discovery gap, even though it can't fix the external
   scheduler itself.
