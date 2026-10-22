# ADR-457: Memory health in the console's Memory Lab

- Status: Accepted
- Date: 2026-10-05
- Plugin: `plugins/ruflo-console` (`hooks/data/memory-health.ts`, `hooks/views/memory-health.ts`, `hooks/views/memory-lab.ts`)

## Context

The Memory view shows counts, namespaces and a browse list, but not whether the store is healthy: whether the same fact was stored twice, whether entries nobody ever recalls pile up, or whether a whole namespace is dead weight. Everything needed is already printed by `memory list --format json` (key, namespace, size, accessCount, createdAt, updatedAt, hasEmbedding). That list carries no value, so a health view can be built without reading any memory content.

## Decision

1. `data/memory-health.ts` holds the pure analysis (`analyseHealth`) and one read-only probe (`memoryHealthProbe`: `memory list --format json --limit 1000`, 120 s cadence, only while the memory view is in front).
2. Duplicates are judged on key and size only. Exact: same normalised key (case and separators removed) and same size, in different places. Near: key-word Jaccard >= 0.75 with sizes within 20 %, or the same normalised key with a different size. Clusters are the connected components of those pairs.
3. "Recalled" means `accessCount > 0`, the counter the CLI bumps on retrieval. There is no last-recalled timestamp, so stale means never recalled AND not updated for 30 days. A recalled or undated entry is never called stale. A never-recalled namespace is one where every listed entry has accessCount 0.
4. Documented caps, always printed in the section's first line, never silent: HEALTH_CAP 1000 newest entries read (with "of N stored" when the store is bigger), PAIR_CAP 500 000 key comparisons (newest entries are compared first; when the budget stops the run the line says how many entries were compared), 5 clusters / 5 stale rows drawn with "+N more" while the counts above stay exact.
5. The view (`views/memory-health.ts`, mounted as the first section of `memoryLabRows`) draws summary gauges, clusters, stale entries and recall per namespace. Absent or failed probe: a single honest line (the probe's own error, or "not registered in this build"). Empty store: an empty-state line. No number is invented.
6. Consolidate is the existing `mem-consolidate` lab entry (`agentdb_consolidate`, a write) behind the lab's confirm card; the button re-homes the answer to the health section. It merges and promotes across tiers; it does not delete the listed keys, and the UI says so. Deleting stays the existing per-entry DELETE.

## Consequences

- Two stores exist (`.swarm/memory.db` read by the CLI, `.swarm/agentdb-memory.db` written by MCP); health reads the first only, like the browse list. When the CLI refuses an unsafe sql.js read (active WAL), the probe error is shown instead of a stale figure.
- Key/size similarity misses duplicates stored under different keys and flags look-alike keys with different content. This is the price of reading no values; the line "from key and size only, no values read" says it.
- Integrator wiring is required (below); without it the section shows "not registered".

## Test and benchmark plan

`tests/memory-health.spec.ts`: key normalising, exact and near clustering, size guard, stale rules (recalled and undated never stale), never-recalled namespaces, pair-budget truncation message, probe reader (drops rows without a key, never carries a value, fixed argv), view states (no probe, failed probe, empty, real sample with consolidate button), and a 1000-entry timing test (measured about 0.1-0.2 s on the dev host; bound 5 s).

## Rollback

Delete the section line in `views/memory-lab.ts`, the two new files and the probe registration; nothing persists and no schema changes.
