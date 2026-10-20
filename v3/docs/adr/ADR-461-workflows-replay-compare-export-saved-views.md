# ADR 461: Workflows page - replay, compare, export and saved views

Status: Accepted

Date: 2026-10-05

Builds on: ADR-458 (the page and its data), ADR-464 (wiring and the slot seams), ADR-453 (confirm-gated verbs)

## 1. Context

The Workflows page shows a run as it is now. People also want to see how a finished run went (what ran when), to set one run beside
another of the same workflow, to keep a summary outside the console, and to find the page where they left it. All four have to use only
what the run folders hold, and none may reach into the shared page files (ADR-464's seams exist for this).

What the files hold limits the design. A run's journal has **no timestamps**. The only moments a run records are each agent's `startedAt`
and, for an agent that ended, its `durationMs` (a run record), or the first and last timestamps of its transcript. Tokens are recorded
once, at the end. There is no per-run cost anywhere in the files. The host's `fs` is read-only, the console may spawn only fixed argv, and
smoke step 8 forbids `sh -c` in the hooks.

## 2. Decision

Four features, each a pure `data/` module with a thin board slot over it, all registered by one import (`views/wf-replay.ts` imports the
other three), so the merge owner adds one line to `views/wf-register.ts`. Each slot is a board slot folded shut by default (one line and an
open button), so the page stays short. No hotkey is taken: the slots register no key, action or tab slot.

**Replay** (`data/wf-replay.ts`, `views/wf-replay.ts`). The timeline is the agents' own start and end moments, ordered by time (an end before
a start at the same instant). A step is one event; `boardAt(run, timeline, step)` re-derives the whole board from the run's agents with
`groupPhases`, so the replayed board is the page's own shape and step N is the same board however the cursor reached it. The last step is
the real board (same states, counts, totals). Not invented: a running agent shows tokens n/a (its final figure is not known mid-run) and its
time is measured to the step; an agent with no start time, or one that ended without a span, is left off and counted on the page; the ruflo
swarm has no history and says so. The cursor is step, jump (to a fraction, to the next or previous phase start), play/pause and a speed of
1, 4, 16, 64 or 256 times. Play is derived from the wall clock at render (`stepNow`), so it needs no timer and cannot run on while paused;
it advances when the page draws (each refresh tick or interaction), which the page says.

**Compare** (`data/wf-compare.ts`, `views/wf-compare.ts`). Only runs with the same workflow name compare. Agents pair by phase and label (the
Nth of a label pairs with the Nth). Marks: `=` same, `~` changed (state or model differs, tokens differ by at least 10%, time by at least
25%), `+` only in B, `-` only in A. A figure either side lacks is n/a and never a change. Totals, counts and notes (a token floor, a run with
no record, differing result text) are shown. The thresholds are exported constants with boundary tests.

**Export** (`data/wf-export.ts`, `data/wf-file.ts`, `views/wf-export.ts`). A markdown summary: phases, agents, tokens, time, results,
provenance; cost only when a source is wired (`setExportCostSource`), else `n/a`. Every free-text field goes through `cleanText` (control
characters out, credential shapes masked) and has table characters escaped; output is capped at 200 kB with a visible cut line. The path must
resolve under the project or the scratchpad (`setExportRoots`), with no `..`, no backslash, no control character, a `.md` name, no link on
the way down (stat per component) and no file already there. The write is a confirm-card `ActionSpec` (`declared: 'write'`): fixed argv
`dd of=<path> conv=excl status=none` (no shell; `conv=excl` fails rather than replace) where the folder exists, else GNU
`install -D -m 0644 /dev/stdin -- <path>`; the text is stdin. Without a wired host reader (`setExportFs`) nothing is written, since a link
could not be ruled out.

**Saved views and pins** (`data/wf-saved.ts`, `wf-saved-live.ts`, `views/wf-saved.ts`). One file, `.claude-flow/console/wf-views.json`,
version 1, at most 64 kB: the cursor by run id, run name, phase title and agent label (so a new run does not move it), filters (at most 8,
set through `updateSaved` by any feature), the search, and up to 20 pinned runs. Decoding never throws and trusts nothing: bad JSON, a
non-object or an unknown version gives defaults with the problem named (and the next change replaces the file); a version **newer** than
this console's is `isForeign` and is neither read nor written. Strings are cleaned, masked and capped on the way in and out. The live half
reads once per project, restores the cursor once the first read has runs (exact run, else the newest of the same name, else leaves it), and
writes when something changed, at most every 2 s, one at a time, a failure keeping the change to retry. The write is the console's own
state file, silent like the other persisted console state, fixed argv (`dd of=` or `install -D`, text on stdin). Removing it is
`rm -f -- <path>` behind the confirm card, after which the cursor is not saved again until something is pinned.

## 3. Consequences

- The page gains four folded sections and no hotkey. Keyboard users reach them with the page's focus ring and Enter; a hotkey would have to
  take one of the letters the tabs already own.
- The saved file creates `.claude-flow/console/` in a project on the first page open. It holds a cursor and names, never run content.
- `install -D` is GNU: on macOS an export to a folder that does not exist yet fails with the tool's own message (name an existing folder).
- Replay resolution is the agents' start and end moments, no finer: a long agent shows as running through its whole span.
- The merge owner must wire four calls (section 5). Until they are made the page still draws; saved views simply do not load or save, and an
  export is refused with a plain reason.

## 4. Test and benchmark plan

Specs in `plugins/ruflo-console/tests/`: `wf-replay.spec.ts` (timeline order and ties, untimed agents, board at every step, scrub
determinism, phase jumps, play on the wall clock, speed clamp), `wf-compare.spec.ts` (matching, marks, both thresholds at their boundary,
unknown figures), `wf-export.spec.ts` (markdown, masking, escaping, cap, path rules, link and existing-file checks, argv has no shell, a real
`dd conv=excl` refusing to overwrite), `wf-saved.spec.ts` (schema, corruption, foreign version, cursor by name, pins, caps, live load,
restore, write gap, failure retry, forget), `wf-replay-views.spec.ts` (registration without a hotkey, fold, the buttons, export through the
confirm card, saved views). Mutation checks flip the end-before-start tie order, the mid-run token carry, the phase jump boundary, both
compare thresholds, the `..` check, the link check, the cell mask, the version gate, the pin cap, the save-gap boundary, the foreign-file
write guards and the unwired-fs refusal: each fails a test. Performance: the timeline is cached per run signature and `boardAt` is linear in
agents; the board draws at most 22 rows. `scripts/bench-swarmui.mjs` is the existing page bench; no new bench is added.

## 5. Wiring (merge owner)

1. `views/wf-register.ts`: `import './wf-replay'`.
2. `controller.ts` init (once, where `host` exists): `setExportFs(host.fs)`; where the scratchpad is known, `setExportRoots(dir)`.
3. After `refreshWorkflows(...)` in `wf-live.ts` or its call sites (open, dump, the refresh tick): `await syncSavedViews(state, host)`.
4. Optional: `setExportCostSource(run => ...)` once a per-run cost source exists; features that filter or search call
   `updateSaved(cwd, s => setFilter(s, key, value))`.

## 6. Rollback

Remove the import line from `views/wf-register.ts`: the page returns to the board alone and nothing else changes. `.claude-flow/console/`
may be deleted by hand or with "Forget saved views"; exports are ordinary files. No other file was edited.
