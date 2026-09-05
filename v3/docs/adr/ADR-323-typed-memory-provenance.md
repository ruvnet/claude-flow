# ADR-323: Typed Memory Provenance in AgentDB

**Status:** Accepted
**Date:** 2026-07-28
**Supersedes:** the dream-cycle research PR #2804's `ADR-322-dream-cycle-memory-typed-provenance.md` (closed as superseded — its filename collided with the already-merged `ADR-322-metaharness-flywheel-integration.md` from #2817, and its proposed schema target was wrong; see "Correction" below).

## Context

Ruflo's AgentDB (`memory_entries` table) stores every memory entry as flat text with an HNSW vector embedding — no typing of *who or what produced it*. In multi-agent deployments, a user's stated claim, an agent's own output, a raw tool result, and a system observation can all land in the same shared namespace (e.g. `collaboration`, `patterns`) indistinguishably.

The 2026-07-28 dream-cycle research report (PR #2804) identified this as "provenance-role collapse," citing:
- **arXiv 2605.25869 (MemIR, May 2026)** — a 3-layer typed representation (raw evidence → retrieval cues → factual claims) with provenance-scoped utilization outperforms flat baselines on LoCoMo + BEAM-100K.
- **arXiv 2607.01071 (MemSyco-Bench, Jul 2026)** — retrieved memories induce sycophancy: agents over-align with user-stated facts at the cost of factual accuracy when provenance isn't enforced at retrieval time.

## Correction to the original dream-cycle proposal

The dream-cycle PR's proposed decision was:

```sql
ALTER TABLE vector_indexes ADD COLUMN provenance_type TEXT ...
```

This targets the wrong table. `vector_indexes` is per-*namespace* HNSW index metadata (id, name, dimensions, HNSW params, `total_vectors`) — one row per namespace, not one row per memory entry. The correct target, and what this ADR actually implements, is `memory_entries` — the per-record table that already carries `tags`/`metadata`/a `type` enum (`semantic`/`episodic`/`procedural`/`working`/`pattern`) in exactly the shape a new typed column belongs in.

The dream-cycle PR (#2804) was closed without merging; this ADR and its implementation replace it, corrected against the real schema.

## Decision

Add a `provenance_type` column to `memory_entries`, mirroring the existing `type` column's convention (`TEXT DEFAULT ... CHECK(...)` on fresh installs; plain `TEXT DEFAULT` — no CHECK — in the `ensureSchemaColumns()` migration path for existing DBs, consistent with how `type`/`status` are backfilled):

```sql
-- Fresh installs (memory-initializer.ts CREATE TABLE)
provenance_type TEXT DEFAULT 'unknown' CHECK(provenance_type IN (
  'user_claim', 'agent_output', 'system_observation', 'tool_result', 'unknown'
))

-- Existing DBs (ensureSchemaColumns() migration)
ALTER TABLE memory_entries ADD COLUMN provenance_type TEXT DEFAULT 'unknown'
```

Application-level validation (`isValidProvenanceType()`, exported from `memory-initializer.ts`) is the actual enforcement mechanism — both `storeEntry()` and `bridgeStoreEntry()` reject an invalid value with a typed error before touching either backend, rather than surfacing a raw SQLite CHECK-constraint failure. This is why the migration path omits the CHECK: it's belt-and-suspenders on fresh installs, not the primary guard.

### Write path

- CLI: `memory store --provenance <type>` (choices-validated by the CLI parser itself, then re-validated in `storeEntry()`).
- MCP tool: `memory_store`'s `provenance_type` parameter.
- Both default to `'unknown'` when omitted — the same value existing (pre-ADR-323) entries get on migration, so there is no behavior change for callers that don't opt in.

### Read path

- CLI: `memory search --provenance-filter <comma-separated types>`.
- MCP tool: `memory_search`'s `provenance_filter` array parameter.
- Applies across all three internal search strategies (RaBitQ pre-filter, in-memory HNSW, and the brute-force/BM25-hybrid SQL path) — see "Implementation note" below for why this needed a specific design after an initial approach crashed the CLI.
- Applies to SmartRetrieval (RRF/MMR) by binding the provenance filter into every raw search used for query expansion. The external package does not need to understand the field and cannot widen the caller's trust scope.

## Implementation note: why RaBitQ/HNSW aren't skipped for a filtered search

The first implementation attempt, when a provenance filter was requested, skipped the RaBitQ and in-memory-HNSW acceleration paths entirely (neither carries `provenance_type` on their candidates) and went straight to a brute-force SQL query with the filter applied server-side. This was simpler to write, but reproducibly **crashed the CLI process on exit** (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` on Windows) — after printing correct JSON output. Confirmed via bisection: removing the `if (!provenanceFilter?.length) { …RaBitQ…HNSW… }` skip and always executing those two dynamic-import branches (regardless of whether a filter was requested) eliminated the crash across repeated runs.

The root cause was not fully isolated (a libuv async-handle timing issue tied to skipping the `import('./rabitq-index.js')` / `searchHNSWIndex()` calls, likely interacting with the embedder's own async initialization) — rather than ship a fix for a symptom without full confidence in the mechanism, the design was changed to avoid the crashing code shape entirely:

- **RaBitQ path**: `provenance_type` is now fetched in the *same* per-candidate SQL query that already looks up `content`/`embedding` for reranking — no extra round-trip, and the branch always runs.
- **HNSW path**: after the existing threshold filter, a single batched lookup by `(namespace, key)` — the schema's natural unique pair — fetches `provenance_type` for the candidate set, and results are filtered against it. This branch also always runs; on lookup failure it fails closed (returns no results) rather than silently ignoring the filter.
- **Brute-force path**: filters directly in the SQL `WHERE` clause (`provenance_type IN (...)`) — no candidates to reconcile after the fact.

Net effect: correctness is now handled per-path rather than by bypassing acceleration, and the crash reproduced 100% of the time before the fix and 0% of the time (multiple repeated runs) after it.

## Consequences

**Positive:**
- Retrieval can now distinguish "the user said X" from "an agent inferred X" from "a tool reported X," addressing MemSyco-Bench's sycophancy finding directly.
- Fully backward compatible: existing entries read as `'unknown'`; no caller is required to pass a provenance type.
- No acceleration path (RaBitQ/HNSW) is sacrificed for provenance-filtered queries.

**Negative / open gaps (stated plainly, not glossed over):**
- Filtering an ANN candidate window can underfill the requested page. Filtered RaBitQ/HNSW searches therefore fall through to the authoritative filtered SQL scan whenever the accelerated window does not fill the requested limit.
- Plugin SDK enforcement (requiring official plugins to pass `provenance_type` on writes, with a `pre-edit` lint gate) — proposed in the original dream-cycle research — is **not implemented** in this ADR. Scoped out as a separate, larger change touching the plugin SDK contract.
- The `audit` worker webhook-trigger idea from the same dream-cycle report is unrelated to provenance typing and is not part of this ADR.
- No governance/rollback layer (the dream-cycle report's AOEP-v0 reference) — this ADR is the typing primitive only, not a full governance system.

## References

- arXiv 2605.25869 — MemIR: Typed Memory Intermediate Representation
- arXiv 2607.01071 — MemSyco-Bench: Sycophancy in Agent Memory
- Dream-cycle research: PR #2804 (closed, superseded by this ADR)
- `v3/@claude-flow/cli/src/memory/memory-initializer.ts` — schema, `storeEntry()`, `searchEntries()`
- `v3/@claude-flow/cli/src/memory/memory-bridge.ts` — `bridgeStoreEntry()`, `bridgeSearchEntries()`
- `v3/@claude-flow/cli/src/commands/memory.ts` — `memory store --provenance`, `memory search --provenance-filter`
- `v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts`, `v3/@claude-flow/cli-core/src/mcp-tools/memory-defs.ts` — MCP tool schemas
- `v3/@claude-flow/cli/__tests__/adr-323-memory-provenance.test.ts` — end-to-end regression guard, including the crash-repro test
