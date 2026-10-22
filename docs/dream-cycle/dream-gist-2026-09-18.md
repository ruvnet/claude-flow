# Memory SOTA Report — 2026-09-18

**TL;DR**: `AgentDBAdapter.store()` (`v3/@claude-flow/memory/src/agentdb-adapter.ts`) — the default in-process write path behind `storeEntry()` — never checked for an existing entry under the same `(namespace, key)` before writing. Since `entry.id` is always a fresh random id (`generateMemoryId()`), a second `store()` call for the same logical key left the prior occupant as a permanent orphan: unreachable via `getByKey()`, but still live in `entries`/`namespaceIndex`/`tagIndex` and, for embedded entries, still a point in the HNSW index — so `search()`/`semanticSearch()` returned stale duplicates forever. This exact gap was independently flagged by two prior nightly scans (2026-09-12 memory scan, 2026-09-17 memory scan) as "a strong candidate for a future memory DEEP night." Tonight closes it by reusing the adapter's own already-tested `delete()` path to evict the prior occupant before storing the new entry — a ~15-line, single-file, single-conceptual-change fix.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Qdrant/Weaviate's documented idempotent-upsert pattern: deterministic id derived from the natural key (UUIDv5), not a random id | Qdrant Points docs, Weaviate `generate_uuid5` docs (current) | A |
| Milvus `upsert()` = transactional delete-by-PK + insert; Sept-2026 change (PR #53158/#53511) made Full-AutoID upsert *preserve* the existing PK instead of reallocating | milvus.io upsert docs + linked PRs, Sept 2026 | A |
| Mem0 has an open TOCTOU race in its own hash-based dedup: `add()` snapshots existing memories, checks the stale snapshot after an LLM round-trip — two concurrent calls for the same fact both insert | github.com/mem0ai/mem0#6531, filed 2026-07-23, open | A |
| Cross-vendor pattern for quantized-vector distance (Qdrant, Weaviate, OpenSearch): Asymmetric Distance Computation — keep the query unquantized, compare against quantized document vectors | OpenSearch ADC blog (2025-12-16), Qdrant/Weaviate quantization docs | A |
| RaBitQ is real and shipped — in `@claude-flow/cli/src/memory/rabitq-index.ts` (WASM, 32x compression), not `@claude-flow/memory`; CLAUDE.md's claim isn't fabricated, just cross-package | Direct source read tonight | A |

## Ruflo Current Capability

Four backends implement `IMemoryBackend`: `AgentDBAdapter` (default, in-process, HNSW-backed), `sqlite-backend.ts`, `sqljs-backend.ts`, `hybrid-backend.ts` (delegates reads-by-key to sqlite only). Tonight's architecture review confirmed the bug end-to-end: `AgentDBAdapter.store()` had no key-dedup; `sqlite-backend.ts`'s schema has no `UNIQUE(namespace,key)` (only `sqljs-backend.ts` does — a cross-backend inconsistency); `hybrid-backend.getByKey()` is hard-wired to the unordered SQLite read. A working precedent already existed in-repo: `v3/@claude-flow/cli/src/memory/memory-initializer.ts` has both `UNIQUE(namespace,key)` and a wired `removeHNSWEntriesByKey()` — the newer `@claude-flow/memory` package never carried it forward. Tonight closes the default-adapter gap; the SQLite-schema half (candidate C, 4.00) and the HNSW binary/scalar quantization dispatch bug (candidate B, 4.35, same class as merged PR #3093/#3094) remain open.

## Competitor Comparison

| Competitor | Idempotent upsert-by-key | Quantized-distance correctness (ADC) | Grade |
|---|---|---|---|
| Qdrant | Deterministic UUIDv5-from-key is the documented pattern | Yes — genuine asymmetric quantization since v1.15 | A |
| Weaviate | `generate_uuid5(key)` re-write replaces the object | Yes, explicit rescore/oversampling for SQ/BQ/RQ | A |
| Milvus | PK-based upsert (delete+insert); Sept-2026 fix preserves PK under AutoID | — | A |
| Mem0 (agent memory) | Intent is right (content-hash key) but has an open TOCTOU dedup race (#6531) | — | A |
| LangGraph / CrewAI | Client-supplied key (LangGraph) or LLM-mediated semantic consolidation, no hash-of-key (CrewAI, deliberate — natural-language facts rarely repeat verbatim) | — | B |

Synthesis: Ruflo's `auto-memory-bridge.ts` already does the *right* thing structurally (content-hash dedup key, pre-fetch existing hashes) — the same shape Mem0 just got a TOCTOU bug filed against; tonight's fix doesn't touch that concurrency question, which is a disclosed follow-up risk, not solved tonight. On quantized-distance correctness, Ruflo's merged PQ dispatch (`productQuantizeDistance()`) is genuinely at parity with Qdrant/Weaviate's ADC pattern; binary/scalar remain unfixed (candidate B, not selected tonight).

## Hypothesis

> Given `AgentDBAdapter.store()`, when a second `store()` call targets an entry sharing `(namespace, key)` with an already-stored entry, then the prior entry should be fully evicted (`entries`, `namespaceIndex`, `tagIndex`, `keyIndex`, and — when embedded — the HNSW index) before the new entry is stored, relative to baseline where the prior entry persists forever as an orphaned duplicate returned by `search()`/`semanticSearch()`, subject to: (1) a genuinely new `(namespace,key)` is unaffected; (2) reuses `delete()`'s existing tested cleanup rather than duplicating it; (3) no change to public entry/search-result shapes; (4) all existing tests remain green; (5) $0, fully deterministic evaluation.

Frozen before evaluation; not modified after seeing results.

## Benchmarks / Evaluation

**evaluated: accepted.** Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls. New file `v3/@claude-flow/memory/src/agentdb-adapter-upsert.test.ts` (4 tests).

Baseline (pre-diff): 2 of 4 new tests fail for exactly the predicted reason (`get(first.id)` returns the stale entry instead of `null`; `search()` returns both `'stale-fact'` and `'fresh-fact'`). The other 2 (new key, cross-namespace) pass both ways — correct controls. Candidate: 4/4 pass. Full `@claude-flow/memory` suite: baseline 517 passed/1 failed (518, 25 files) → candidate 521 passed/1 failed (522, 26 files) — the 1 failure is `auto-memory-bridge.test.ts`'s pre-existing chmod-based read-only test, identical both ways (sandbox runs as root, bypasses the `chmod`). `tsc --noEmit`: 0 errors both ways.

**Independent adversarial critique** (separate subagent, no authoring context, re-verified the stash-isolation result itself): **CONFIRMED-WITH-CAVEATS**. Confirmed diff scope (only the 2 named files touched), confirmed `storeEntry()` also benefits (no bypass path), confirmed embedding-present/absent transitions and `entry.id === existingId` are handled correctly, confirmed O(1) added cost, confirmed zero new I/O/network/credential surface. **Real disclosed gap**: no mutex — under truly *concurrent* `store()` calls for the same `(namespace,key)` (e.g. `Promise.all([...])`), both can read `keyIndex.get()` before either writes, and both insert, reproducing the same orphan bug for the concurrent case. All 4 new tests are sequential and don't exercise this. Verdict scoped to **ACCEPT for sequential re-stores** (today's only exercised production pattern); concurrent-store safety is an explicit, disclosed follow-up, not fixed tonight.

## Darwin Results

Confirmed real interface: `npx ruvector@0.3.1 harness darwin <config> --execute`. Skipped — binary correctness fix, no continuous/categorical fitness-gradient parameter. Same class as most recent nights.

## Flywheel Evidence

Confirmed real interface: `npx ruvector@0.3.1 harness flywheel {verify <bundle>|gate <evidence>}` — targets signed LLM-scored replay bundles, not deterministic code fixes; none exists for this candidate. Evidence retained as: 4 new tests, this gist, the linked issue, stash-isolated baseline/candidate comparison, adversarial critique — consistent with every accepted night since 2026-08-18.

## Reward Hack Check

No standalone reward-hack CLI reachable. Manual checklist: no existing test weakened (new file only); no gold data touched; no cherry-picking (full suite reported both ways, the 1 pre-existing failure disclosed); no seed manipulation; zero cost.

## Security Review

Not security-sensitive: pure in-process bookkeeping (reuse of the existing `delete()` path), no new I/O/network/credential/filesystem surface. The disclosed concurrency gap (above) is a correctness/data-integrity risk under concurrent writers, not a security boundary issue.

## Post-review addendum (2026-09-18, same night)

ruvnet reviewed at `eb499928c` and found two further public-path gaps the first pass missed: (1) `AgentDBAdapter.bulkInsert()` — which `UnifiedMemoryService.bulkInsert()` forwards to — bypassed the same-key dedup entirely, so a batch with duplicate `(namespace,key)` values or one replacing an already-stored key still left old ids reachable; (2) `store()` deleted the prior occupant *before* validating the replacement via `HNSWIndex.addPoint()` (fallible: dimension mismatch, full index), so a rejected write lost the prior value outright instead of merely duplicating it. Both fixed in `8636bbac5`: `bulkInsert()` now computes superseded ids (pre-existing occupant + intra-batch duplicate-key losers) from a pre-mutation snapshot and evicts them via a shared `evictEntry()` primitive after the batch is indexed; `store()` now runs `addPoint()` before eviction, so a rejected replacement fails clean. 5 new tests added per the review's request, including a hand-built two-promise-gate harness for the disclosed concurrent-store race (a plain `setTimeout` delay does not actually interleave two async calls in Node — confirmed empirically, the first attempt at this test could not reproduce the race at all). Full suite: 521→526 passed (+5), same 1 pre-existing unrelated failure, `tsc --noEmit` clean.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `e558f0c0fc29c1a658085f6e6f80ad27d4fe811f` |
| Gist SHA-256 (pre-witness content) | `c5c9c86da1136fd9280a8a1a40b58679e993bd02574c10756103ba3f3663650a` |
| Witness stamp | `d4d020625c6468c7c955e0081ab7eb74ef2259ca4e4dd0a50a0e02f511bbf82f` |

Verifier procedure: fetch this gist, strip the witness table's filled values back to `PENDING`, SHA-256 the result, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Scan Findings: plugins

`PluginManager.installFromNpm` (`manager.ts:149-221`) validates only the package-name string and runs `npm install` unconditionally — never reads `PluginEntry.permissions`/`.trustLevel`/`.securityAudit` against `PluginStoreConfig`, despite these being fully modeled and named in SECURITY.md as the mitigation. `--verify` (checksum) is parsed and never used. New tonight: `trust/trust-anchors.json` declares an "ADR-145 PluginIntegrityVerifier" schema with a placeholder all-zero key and `owner: "PLACEHOLDER"` — zero TS references anywhere; the control was never implemented. Comparison: npm ships `--provenance`/Sigstore attestations verifiable pre-install; Ruflo's installer resembles VS Code Marketplace's weaker identity-only model (malicious-extension detections nearly quadrupled there in 2025, per ReversingLabs). Not selected tonight (SCAN); real gap for a future capabilities/security night.

## Scan Findings: automation

No in-repo cron/workflow drives the nightly dream-cycle trigger — it lives outside this repo, so tonight's confirmed 2-night no-run gap (2026-09-13/14, no branch/PR/issue for either date, verified via `git ls-remote`) is genuinely unexplained from repo config. The one visibility fix for this class of gap, `dream-cycle-backlog-guard.yml`, has itself sat as draft PR #3205 since 2026-09-05 (13+ days, zero activity) — the detector for "things go stale unmerged" is itself stale and unmerged. Separately: `hooks/README.md` documents 12 named background workers; the actual `ALLOWED_WORKERS` allowlist in `src/workers/index.ts` has 11 completely different names, zero overlap, and only 5 worker files exist on disk. Not selected tonight (SCAN); merge #3205 first, then treat the doc/implementation drift as a themed future `automation` night.

## Competitors Reviewed

Qdrant, Weaviate, Milvus, LanceDB, Mem0, Zep/Graphiti, Letta, LangGraph, Microsoft Agent Framework/AutoGen, CrewAI, OpenAI Agents SDK (memory-deep comparison); npm provenance/Sigstore, VS Code Marketplace (plugins scan); GitHub Actions scheduled-workflow reliability (automation scan).

## Additional candidates surfaced but not selected tonight (STEP 3.2)

Scored under `0.25·Ruflo_fit + 0.20·testability + 0.20·measurability + 0.15·production_value + 0.10·novelty + 0.10·reviewability`. Selected candidate (A, same-key upsert) scored **4.70**, highest of five.

1. **[4.35] B — HNSW binary/scalar quantization distance dispatch bug**: same class as merged PQ fix (#3093/#3094); no `binaryQuantizeDistance()`/`scalarQuantizeDistance()` exists, so those types fall through to generic cosine/euclidean on packed bitmasks/min-range-polluted arrays. Dead code today (never configured/tested), lowering urgency, not correctness risk. Strongest standalone second choice.
2. **[4.00] C — `sqlite-backend.ts` `UNIQUE(namespace,key)` + `ON CONFLICT DO UPDATE`**: closes the other backend's half of tonight's bug class; not the default path, left for follow-up.
3. **[3.35] D — Architectural**: two unequal quantizers exist (`@claude-flow/cli`'s real WASM RaBitQ vs. `@claude-flow/memory`'s broken hand-rolled binary/scalar) — gate the broken one or port the real one.
4. **[2.95] E — Consolidator threshold calibration**: replace the fixed 0.95 cosine cutoff with a calibrated percentile (arXiv:2605.08538 uses 0.559 at p99) or Mem0-style write-time classification. Needs a labeled corpus — out of scope tonight.

## Recommended Next Steps

1. **Merge tonight's linked draft PR** (human review required).
2. **Add a per-key async lock to `AgentDBAdapter.store()`/`bulkInsert()`** — the still-open, now-doubly-disclosed gap (adversarial critic, then human review): sequential re-stores and same-batch/batch-vs-pre-existing replacements are now safe, concurrent `Promise.all()` re-stores of the same key across separate calls are not.
3. **Fix candidate B** (HNSW binary/scalar quantization distance dispatch) — same mechanical shape as the already-reviewed PQ fix.
4. **Check `auto-memory-bridge.ts`'s hash-dedup path for the same TOCTOU race Mem0 just filed** (#6531) — structurally similar snapshot-then-insert shape, not verified either way tonight.
5. **Merge draft PR #3205** (`dream-cycle-backlog-guard.yml`) — the missing heartbeat for exactly the no-run-gap class tonight's automation scan re-confirmed.
6. **Reconcile `hooks/README.md`'s 12-worker roster against the actual 11-name `ALLOWED_WORKERS` allowlist** — a future `automation` night should resolve which is wrong.
