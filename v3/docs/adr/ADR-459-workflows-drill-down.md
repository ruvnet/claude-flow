# ADR 459: Workflows drill-down: levels, activity, log, files, result, search

Status: Accepted

Date: 2026-10-05

Builds on: ADR-458 (the page and its data), ADR-464 (the page's wiring and slot seams)

## 1. Context

The Workflows page shows a run, its phases and one phase's agents, and an inspector with the numbers of one agent. It cannot answer
the next questions: what did that agent do, what did it say, which files did it touch, what did it hand back, and where in all of this
did the word X appear. The answers are in files Claude Code already writes (the agent's transcript, the run's journal, the agent's
worktree), so the console can show them without running anything, if it keeps to what it can verify and says what it cannot read.

The seams are fixed by ADR-464: a feature adds a slot from its own module and edits no shared file. A slot is handed the frame's
context and the cursor (no host, no `fs`), a pane hotkey is one lowercase letter or digit the page does not own, and Enter, Esc, `h`
(Help's) and `/` are not available to a slot.

## 2. Decision

**Levels.** `Runs > Phases > Agents > one Agent (Activity | Log | Files | Result) > one tool call or message`, drawn by a board slot under
the run board with a clickable breadcrumb. The first three levels are the page's own cursor (a key there sends the page the `h l j k [ ]`
it already understands), so the board and the drill never disagree. From the agent down the position is the drill's own, kept in a
module record keyed by the console's `State` (the page's `WfUi` is closed).

**Keys.** Eight key slots, each trying its letters in turn because another feature may hold one: `g` deeper (then `e`), `z` back, `m`
next, `w` prev, `t` next tab, `f` follow, `v` level filter, `s` search (the field takes the keys). Every one is also a button. Enter,
Esc, `h` and `/` cannot be bound through a slot: `drillKey(env, verb)` is exported so the merge owner can route them if the page grows
that, and until then this is stated rather than faked.

**Activity** is the tool-call timeline: each `tool_use` paired with its `tool_result` by id (a streamed message repeats its blocks, a call
counts once), with time from the first call and span, a mark for ok, error and no result in the part read. **Log** is the transcript tail,
one washed line per entry, with a level filter (all, messages, tool calls, errors), a scope (this agent, or the whole phase merged by
time, each agent's newest 400 lines) and follow, which pins the window to the newest line and is re-drawn on the page's refresh: it is
not a stream and the page says so. **Files** lists the files the tool inputs name, with what was done to each, and the worktree's diff
stat when the agent had one. **Result** is the structured return the run's journal kept for the agent. The deepest level shows one call
(input and output) or one message in full, scrolled by buttons.

**Search** is one field under the panel over every level at once: run names and ids, phase titles, agent labels and previews, tool calls
(name, summary, input), transcript text (messages and outputs) and mission tasks when `observation.json` has them. Hits are grouped by
level (six shown a group, all counted) and a click, or Enter in the field for the first, goes to the exact place: the cursor, then the
sub-tab and the call or line. A mission task has no place on this page, so its hit opens the Missions page. It searches only what is in
memory and says how many agents' transcripts were not (never guessing), and the scan stops at 8,000,000 characters and says so.

**What is read, and by whom.** Views never read. They look at what is already in memory: the console's read cache, which the page's own
refresh fills for runs still in progress. A finished run's figures come from its record, so the page does not read its transcripts, and a
transcript over the 3.0 MB read cap is only tail-read by the host. For those the drill offers a button, and the buttons work only if the
merge owner calls `bindWorkflowDrill(state, host)` once at boot (the host is not part of a slot's environment). Unbound, the drill draws
everything the cache holds and says, in place, what it could not read and why: no dead button. Bound, the loaders are:

- a transcript: `<configDir>/projects/**/agent-<id>.jsonl`, whole to 3.0 MB, else the last 400 KB;
- the journal: `<run dir>/journal.jsonl` to 1.0 MB, for one agent's result;
- the worktree: one process, `git --no-optional-locks -c core.fsmonitor=false -C <worktree> diff --numstat --no-renames --no-color
  --no-ext-diff --no-textconv HEAD --`, fixed argv with no shell, only for a worktree path inside the project's working directory with no
  `..` part, 8 s, output cut at 200 KB and 400 files. It reads tracked changes only and says so; it is not behind the confirm card because
  it changes nothing.

Paths are checked before any read: a transcript or journal path must lie under `<configDir>/projects/` with no `..`, NUL or newline.

**Washing.** Every string kept from a file passes `cleanBlock`: whole ANSI sequences removed, controls (newline kept), hidden and bidi
characters, credentials masked (the mask runs over a little more than the cap, so a token straddling the cut is masked whole), then cut.
Ids and paths are not masked. Caps are printed: characters per field (6,000, "first N of M"), entries per transcript (newest 2,000), rows
on screen, the transcript read cap and the scan cap.

**No stop, no message.** The console cannot stop or message a running Claude Code workflow. The page already says so where that would be
(ADR-464); the drill adds no verb and no button for it, and none for a ruflo agent either: it keeps no transcript, worktree or return, so
the drill says that instead of opening an empty level.

**Seam use.** Board slots `drill` and `drill-search`, eight key slots, one notice slot (`drill-follow`) used as the "a read just finished"
tick that re-reads the held tail of a followed log. `views/wf-register.ts` gets one line: `import '../wf-drill'`.

## 3. Consequences

- The drill costs nothing while closed beyond one hint line and the search field; parsing is memoised by the transcript text itself.
- On a finished run, or a transcript over the read cap, the drill is only as complete as the host binding. That is the one decision the
  merge owner takes: call `bindWorkflowDrill` (recommended) or accept the stated empty states.
- The whole-phase log re-merges each draw: 66 ms at 60 agents, worst case, about 10 ms for a typical phase.
- Enter, Esc, `h` and `/` are buttons and letters until the page lets a slot see them.
- The follow tick for a tail-read transcript fires once per page read, so it moves at the console's refresh cadence.

## 4. Test and benchmark plan

`tests/wf-data.spec.ts` (31 tests): washing and caps (the boundary, a straddling token), pairing by id, errors, the tail and the entry cap,
the journal result, the log's filters, merge and window, the trail's every step and refusal, the search's levels, jumps, unread and caps.
`tests/wf-drill.spec.ts`, `wf-drill-read.spec.ts` and `wf-drill-search.spec.ts` (31 tests) run the real page over an in-memory disk:
registration and key fallback, the walk from Runs to one call and back, no credential or escape at any level, the diff argv, the path and
worktree refusals, the finished-run empty state and the on-demand read, the tail, the search by click and by Enter. Mutation-checked: the
field cap boundary, pairing by id, the level filter, the mask, the finished-run empty state, hit grouping, the ruflo gate, the
project-directory gate, follow, the scan cap, the diff hardening flags, the jump's filter reset and the no-mask rule for paths (two mutants) each fail a test.
Measured (this host): parsing a 4.8 MB, 6,000-line transcript 59 ms once (then memoised); a real 0.35 MB workflow transcript 4 to 13 ms;
search over 60 agents of 2,000 entries 23 ms (the cap stops it); filter and window 0.1 ms.

## 5. Rollback

Remove the `import '../wf-drill'` line from `views/wf-register.ts` (and the `bindWorkflowDrill` call if added). The page returns to ADR-464's
board. Nothing is persisted and no file outside the new modules was edited.
