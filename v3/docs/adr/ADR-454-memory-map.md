# ADR 454: The memory map: a 2D picture of the AgentDB store in the Memory Lab

Status: Accepted

Date: 2026-10-05

Builds on: ADR-445 (AgentDB as a mod); the Memory Lab (`views/memory.ts`, `memory-lab.ts`)

## 1. Context

The Memory Lab lists AgentDB's counts, a bar per namespace, a recency strip and a paged browse list. Nothing shows the store as a whole: how entries group, which are read often, and where a search lands. A picture does that at a glance, but a 2D picture of a vector store invites the reading "near means similar", and that reading is only true when the positions come from the embeddings.

What the console can read today, without a new network call or a read of the database files: `memory list --format json` prints, per entry, `key`, `namespace`, `size`, `accessCount`, `updatedAt`, `hasEmbedding`. It does not print the embedding vector. Search output (`memory search`, unified search) prints hits as `score  namespace/key`.

## 2. Decision

Add a **Memory map** section to the Memory view, under the namespace bars.

- **Positions are a layout, labelled as one.** The stored embedding is not readable through `memory list`, so the default layout is `hash`: namespaces sit on a fixed ring ordered by name, and each entry is scattered inside its namespace's cluster by a hash of its key (FNV-1a). Near means the same namespace and nothing more. The section says so in words ("layout: NOT similarity") and its rule reads `hash layout`.
- **Embedding layout exists, but only on real vectors.** If every listed entry carries an `embedding` array, positions come from a fixed two-hyperplane random projection (`projectVector`) and the label reads `embedding layout`; one missing vector drops the whole map back to `hash`. No current probe supplies vectors, so today the map is always `hash`; the path is there so a future read-only vector probe lights it with no view change.
- **Colour is the namespace** (stable by sorted name, ten colours cycling), with a legend row per width showing each namespace's listed count.
- **Dot size is the access count**: `·` never or unknown, `•` 1-2, `●` 3-9, `◉` 10 or more. When the map's own list is not loaded and it falls back to the Namespaces sample (which drops `accessCount`), every dot is a speck and the legend says "read counts n/a".
- **Search lights its hits.** After a memory or unified search, entries named in the last result's lines (parsed from `score  namespace/key`) are drawn as a white `◆` with `( )` beside it and every other dot is dimmed. The line below the map says how many of the listed entries lit and how many hits fall outside the listed sample (the map covers the newest 500 entries, like the namespace bars).
- **Empty states are honest**: `reading memory list …`, the probe's error, or `nothing stored yet`; no placeholder dots.

Data comes only from `memory list` (one new probe, `memmap`, same argv as the Namespaces probe plus the `accessCount` it drops) and from the last Lab result already in state. No private memory content is read: keys and namespaces are already shown by the browse list. No mutation is added.

Files: `gfx/memmap.ts` (layout, projection, picture), `data/memmap.ts` (probe, readers), `views/memmap.ts` (section), the one-line mount in `views/memory.ts`, `tests/memmap.spec.ts`.

## 3. Consequences

- The picture can mislead only through its layout; the label is on the rule and in a note, and the embedding label cannot appear without vectors.
- A second `memory list --limit 500` every 60 s while the Memory view is open (the same cost as the Namespaces probe). The integrator may instead add `accessCount` to `MemoryEntry` and the Namespaces parser and drop the `memmap` probe; the view already falls back to the sample.
- Two dots in one cell show the busier one (or a hit); with 500 entries on a ~100x14 plane some overlap is unavoidable.
- A search hit whose key is over 60 characters is matched by the lab's 60-character prefix; hits from another store (unified search over the second DB) are counted as outside the sample, not drawn.

## 4. Test and benchmark plan

`tests/memmap.spec.ts`: layout determinism and bounds, namespace clusters apart, mode rules (vectors on all or hash), projection near/far, hash stability, glyph tiers, hit lighting and ringing, empty picture, `memory list` and search-line readers against the captured fixtures, probe argv, and the view's empty, filled and fallback states. Benchmark: layout and picture for 500 entries should take well under a frame (a few ms); not gated in CI.

## 5. Rollback

Delete the `...memmapRows(ctx)` item in `views/memory.ts` and the new files; unregister the `memmap` probe. Nothing persists and no state shape changes.
