# ADR 468: Workflows page and autopilot: measured costs, the fixes, and the gate that holds them

Status: Accepted

Date: 2026-10-06

Builds on: ADR-458 (workflows reader), ADR-459 (drill and search), ADR-464 (page slots), ADR-466 (mission autopilot)

## 1. Context

The Workflows page is drawn on every frame while it is open and the autopilot ticks once a minute for weeks. Neither had been
measured under the load a real project and a long run put on them. `scripts/bench-workflows.mjs` and `scripts/bench-autopilot.mjs`
now do: every input is generated (no fixtures on disk), the page is drawn through the real page and slots into a recording kit
(the engine's own layout is not in it), and each case prints median, p99, bytes allocated and a digest of what it computed, so a
BEFORE and an AFTER run can be compared for the same answer and not only the same speed. All digests were identical across the change.

## 2. Findings and decisions

Measured on one host (node 22), BEFORE at 640abdaeb, AFTER on this branch. Frame cases: 6 runs x 60 agents of transcript in memory.

| Case | Before | After | Cause and fix |
|---|---|---|---|
| Page frame, 20 runs / 200 on disk | 64 / 61 ms | 0.06 / 0.08 ms | The parse memo held 24 transcripts; the search panel asked for all ~340 on every frame, so each draw parsed them again. The memo is now bounded by the text it holds (24 M characters), and a query too short to search reads nothing. |
| Page frame, drill open | 1488 ms | 0.07 ms | Same cause. |
| Page frame, a query typed | 1436 ms | 0.12 ms | Same cause; the search memo now compares the transcript text by identity, and `search` parses lazily only as far as its scan cap (new optional `isHeld` counts the rest without a parse). First draw after typing: 1537 ms to 327 ms. |
| Tail reads of transcripts over the read cap, per refresh (360 agents) | 360 x 400 KB | 0 | Each refresh re-read every oversized transcript. The listing's size and mtime now stand for "unchanged" and the parsed figures (not the text) are kept. |
| `foldJournal`, 100,000 events | 15.5 s (10.8 s earlier run) | 53 ms | A scan of the step and park lists per event (quadratic). Indexes by step id, open park id and park task. 8k events: 65 ms to 2 ms. |
| Replay of an 8k-line journal on each tick | 83 ms | 0.000 ms when unchanged (10 ms when changed) | The console replayed the journal every minute; the read cache returns the same text while the file is unchanged, so the last replay is kept (`replayJournal`, one slot, keyed by the text). |
| `encodeLine` x 100,000 | 209 ms | 131 ms | A parse of the washed text, to stringify it again, produced the same bytes: one pass. |

Not changed, with the figure: `parseTranscript` 5 MB 21 ms and `parseActivity` 5 MB 44 ms (linear, read only when the file changes); 50 MB
parses once in 0.3 / 0.6 s and is not a product path (a file over 3 MB is tail-read, 400 KB); a refresh with the page open, nothing
changed, 5 ms; closed, 0.000 ms; the reader at 200 runs on disk, 1.7 ms; replay `boardAt` at 2000 agents 0.6 ms; a conversation
thread fed 1000 messages (it keeps 100) draws in 0.04 ms, adding them costs 30 us each, nearly all `maskSecrets`; `tick` 0.02 ms, 10,000
tick+fold a second. The credential mask is the largest single cost left in every parse (23% of a profile) and is left alone: no cheaper
prefilter was proved to mask exactly what it masks.

## 3. The gate

Budgets are in the scripts (median ms for one draw or one timer tick; p99 within the larger of 16 ms or three times the budget):
page frame 6, drill frame 8, query-active frame 8, conversation frame 3, refresh closed 0.05, refresh open 60, search 120, replay
`boardAt` at 2000 agents 12, journal replay 40, `tick` 0.25, fold of 100k events 400. `--check` exits 1 on a miss.

    NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-workflows.mjs --check [--quick] [--only frame,search]
    NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-autopilot.mjs --check

`tests/bench-guards.spec.ts` holds the fixes without timing: the new fold agrees with the old scan-per-event fold on seeded random journals, the
encoder writes the old bytes, an unchanged journal is not replayed, a live project's transcripts stay parsed, a frame with no query parses
nothing, search stops parsing at its cap, and an unchanged oversized transcript is not read twice. Each of its guards was mutation-checked
(reverting the fix makes it fail). One test is timing-sensitive: 60,000 events fold in under 1.5 s (measured 40 ms).

## 4. Consequences

- No file format changed: the journal bytes are identical (a test proves it), the tail figures and the parse memo are in memory only.
- The tail skip needs the host's `fs.list` to return `mtimeMs` (the reader's own run ordering already does); without it the reads happen as before.
- `replayJournal` is one slot: two consoles with different journals in one process would replace each other's answer (correctly, never wrongly).
- The parse memo can hold up to 24 M characters of transcript text as parsed records.

## 5. Not done

A transcript that grows is still parsed whole when it changes (a refresh reads only unchanged files for free; a delta parse was not built).
Frame costs are of the recording kit, not the engine's layout.

## 6. Rollback

Revert the commit. Nothing else depends on it; the scripts and the spec go with it.
