# ADR 473: Console: a transcript that grew is parsed from where it ended, not from its first line

Status: Accepted

Date: 2026-10-06

Builds on: ADR-458 (workflows reader), ADR-459 (drill and search), ADR-468 (the first bench pass)

## 1. Context

ADR-468 made an unchanged transcript free (size and mtime say "unchanged", the parse is kept) but a transcript that changed was parsed again from
its first line: a live agent appends lines every few seconds, so every refresh of a busy run re-parsed megabytes to learn about a few kilobytes.
The search had the same shape: its first draw after the first typed query parsed every transcript it scans (the memo was empty), 330 to 590 ms
on the 6 runs x 60 agents x 400 KB bench project, and nothing could make that cheaper because there was nothing to resume from.

What the host can do bounds the fix. The engine's `$.fs` has `read` (whole file, rejected over 4 MiB), `list`, `stat`, `exists` and `write`:
no read from an offset, no tail read. `readTail` exists only on the console's own test and bench file systems. So today a transcript over 3 MB
is not read at all, and a smaller one is read whole. What can be saved on every host is the parse (the larger cost: 34 ms of a 3 MB refresh is
parsing, the read is a memcpy). What can be saved in bytes read is only where a host offers `readTail`. This ADR makes the parse incremental on
every host and says plainly that the read is incremental only there.

## 2. Decision

**A parse state per transcript** (`hooks/data/wf-incr.ts`, `wf-incr-activity.ts`): how far the text was consumed (always just after a newline),
a short anchor of the text before that point, the first 512 characters, and the running figures. Two folds share it: `FactsIncr` (tokens, tool
calls, first and last timestamps, model: what `parseTranscript` answers) and `ActivityIncr` (the entry ring, calls paired with results, touched
files: what `parseActivity` answers).

**Resuming is checked, never assumed.** A new text continues the old one when, for a whole file, its first characters match the old first
characters and the text just before the consumed point matches the anchor; for a tail window (which slides), when the anchor is found exactly
once in it and is at least 1024 characters long. Anything else (truncation, a rewrite, a window that slid past the anchor, an ambiguous match, a
different `tag` for the same bytes) is parsed whole. The fallback is always a full parse, never a guess. Same text and tag is the held answer.

**An unfinished last line is parsed for the answer and not committed**: the fold applies it, builds the answer, and takes it back (an undo log
over the ring, the id map, the files and the result it touched), so the next call sees that line again, finished, and it is counted once.

**Bounded.** The ring keeps the newest 2000 entries as before; the ids of calls that left it are kept (50,000, oldest first) so a late result for
one is absorbed as the whole-text parse absorbs it, not turned into a message. The memo is bounded by the text it holds (24 M characters), oldest
state out, as before. `LINE_CAP` (3,000,000 characters, the read cap) is shared by `jsonLines` and the incremental scan: a longer line is not read.

**The reference parsers are untouched** and are the oracle in `tests/wf-incr.spec.ts`: the incremental code is written beside them, not under
them, so a test that compares the two can fail. Only `jsonLines` gained the line cap, and `str`/`num` and a few activity helpers were exported.

**Wiring.** `data/workflows-read.ts` keeps a `FactsIncr` per path (the folder reader). `data/wf-drill-io.ts`'s `parsedOf` goes through
`data/wf-incr-store.ts`, which keeps an `ActivityIncr` per path under the old memo budget and the old `parsedStats()` (plus `resumed`, `fed`,
`warmed`). A tail read carries a tag (size and mtime) so two windows that read the same at different places are told apart.

**Warm-up for the search.** After each refresh, `workflows-read.ts` parses the transcripts it just read, in the order the search walks them (live
runs first, then each run's phases and agents), up to 400,000 characters a refresh (about 10 ms, inside a frame) and up to the memo's budget, so
the first draw after a typed query finds them parsed. The warm-up never parses a tail and is not counted in `parsedStats().parses`
(`warmed` counts it). This changes what `bench-guards.spec.ts` asserts: typing no longer parses more than an idle frame, because the refresh
already did; the old assertion now runs on an emptied memo, and a new one holds the warm case.

Not done, with the reason: `usageOfTranscript` (the cost read, `data/wf-cost.ts`) is called from `wf-cost-live.ts`, which another lane owns, and it
re-reads and re-parses on a size/mtime signature there. An incremental usage fold belongs next to that call; it is a follow-on.

## 3. Evidence

`tests/wf-incr.spec.ts` (54 tests): seeded random transcripts (assistant lines with usage and tool calls, streamed repeats, results for known,
early, unknown and evicted calls, errors, thinking, meta and attachment lines, junk, half lines, non-objects, CRLF and LF, astral characters and
escape sequences, 7,000-character lines), cut at random characters and grown step by step, for facts and activity, each step equal (`toEqual`)
to `parseTranscript` / `parseActivity` of the same text; the same past the entry ring (4,400 lines); truncation, rewrite and replacement;
an unfinished line taken back; a line over the cap; tail windows sliding over a growing file, compared with the whole parse of the file from the
first complete line of the first window (what a tail state means: it also knows the lines of the windows before this one). Through the readers: a
transcript that grew between two refreshes, and a tail-read one.

Mutations (19 mutants of the two source files, each applied alone and the spec run): anchor
compare skipped, head compare skipped, truncation guard removed, tail ambiguity check removed, tail minimum anchor removed, partial line consumed,
unfinished line never taken back, `same` ignoring the tag, facts line number not advanced, evicted ids forgotten, `dropped` ignoring ring overflow,
dedupe by id removed, `callIndex` not made relative, calls dropped from the ring not counted, and the undo of a result, of a status, of a message and
of the files, and the skipped count. All are dead now; the first pass left six alive, and what killed each is worth saying:

- anchor compare, head compare: a new test edits a character in the first 512 characters, and one in the text just before the parsed point, and
  appends (the resume must be refused).
- truncation guard: an equivalent mutant (the anchor compare already refuses a text shorter than the parsed point), so the redundant guard was removed
  from the source and a test that cuts a text shorter was added.
- `dropped` ignoring ring overflow: a new test with an unfinished last line that pushes the full ring over its cap.
- facts line number: `index = usage.size` is equivalent in its output (the key it makes is just as unique), so the mutant was replaced by
  `index = 0`, which the property test kills.
- undo of a result and of a status: these survived a second time, and the cause was a real defect, not a missing test: the cursor's head covered the
  unfinished last line, so any text under 512 characters never resumed (it re-parsed whole each time). The head now covers the committed part only;
  a new test that takes a pending result back then kills both mutants.
- partial line consumed: an infinite loop (the scan never advances past an unterminated line), killed by the runner's timeout, counted as killed.

`scripts/bench-workflows.mjs` (median ms, one host, node 22, load average ~30 so absolute numbers are noisy; BEFORE is the same script on
`origin/main` f1c52f70f, AFTER on this branch, every answer digest-compared):

| Case | Before | After |
|---|---|---|
| 50 lines appended to a 3 MB transcript (read whole), activity | 37-39 ms (whole parse) | 0.37 ms (19,584 characters parsed), answers identical to the whole parse at every step |
| the same, facts | 17-19 ms | 0.09 ms |
| 50 lines appended to a 5 MB transcript (400 KB tail window), activity / facts | 3.9-6.8 / 1.7-3.2 ms | 0.35-0.61 / 0.13-0.25 ms |
| the same, 50 MB | 3.7-4.5 / 1.5-2.1 ms | 0.58 / 0.17 ms |
| tail state against the whole parse of the 5 MB and 50 MB files from its anchor | n/a | identical |
| refresh at 200 runs on disk (newest 6 with 8 transcripts of 2.4 MB), one transcript grew by 50 lines | 16-17 ms | 1.8-3.6 ms |
| the same, unchanged (settled) | 0.65-0.75 ms | 0.46-0.55 ms |
| first draw of a typed search, project that fits the memo (120 transcripts, 12 M characters): memo cold | 112-141 ms | 112-141 ms (nothing to resume from) |
| the same, memo warmed by 40 refreshes | 112 ms, 120 parses | 6.2 ms, 0 parses on the frame |
| the same on 6 runs x 60 agents x 400 KB (its search scans 31 M characters, over the 24 M memo): cold / warmed by 100 refreshes | 355-465 / 347-412 ms | 355-590 / 102-141 ms (59 of the 78 transcripts parsed ahead; 19 still parse on the frame) |
| a warm-up tick (it comes on top of a refresh) | n/a | median 4-12 ms, slowest 12-22 ms |

`--check` holds budgets for the new cases (activity append 8 ms, facts 5 ms, the 200-run refresh with an append 40 ms, a warmed first draw 16 ms, a warm-up
tick 60 ms); the digests of the existing cases are unchanged. While the warm-up is working (the first minutes after a page opens, about one 400 KB
transcript a refresh) a refresh costs the warm-up on top; once the memo is full or the transcripts are current it costs what it did before.

## 4. Consequences

- A busy run's refresh costs the new lines, not the file: 37 ms to 0.4 ms for 50 lines onto 3 MB.
- The first search of a page left open is 15x faster on a project that fits the memo; a cold one (typed before any refresh) still pays the parse, and a
  project whose search scans more than the 24 M memo holds still parses the rest on the frame. The memo budget is not changed here.
- A tail state carries the history of earlier windows (more calls counted than a fresh window would), and says so only through this ADR.
- On the real engine nothing is read less: only the parse is. A host with a ranged read would also save the bytes.
- A state costs its ring (up to 2000 entries) and a copy of them in the answer while a transcript is held; the memo budget counts the text only.

## 5. Companions in this change

- `scripts/kit-seq.sh` runs the 25 kit tests one file at a time with `claude plugin test` in a temp COPY of the plugin (the CLI refuses a
  symlinked tree as path traversal): hooks, catalog, types, tsconfig, plugin.json and the test fixtures are copied, one `*.test.ts` is swapped in
  at a time, and the directory is removed on exit. Run all at once at load average 30+, 3 to 8 view tests exceed their own 5 s limits; one at a
  time they do not. It prints a line per file and a total, and exits 1 on any failure.
- `scripts/typecheck.sh`: `tsc -p` stops at TS2688 in a fresh clone or worktree because `.claude-plugin/types/` (written by Claude Code when it
  loads the plugin, gitignored on purpose: early access, regenerated per release) is not there. The script copies it from the main checkout or the
  installed plugin when missing, then runs tsc. With it, the specs type-check; six errors remain in sources owned by other lanes (listed in the
  change's report).
