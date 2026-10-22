# ADR 486: Session workspace: attention queue, session browser and preview

Status: Accepted (phase 1 implemented; items 4 to 6 accepted as roadmap)

Date: 2026-10-09

Builds on: ADR-448 (the Room), ADR-473 (incremental transcripts, and what the host `$.fs` can read), ADR-481 (one sanitiser for drawn text), ADR-444 (Claude controls the console), ADR-477 (toasts), ADR-406 (mission observation)

Numbering: ADR-487 is taken twice (the x-gateway query tools, and the open ruvnet-brain grounding change); this is 486.

## 1. Context

Twenty agents are only manageable if the person is told which one needs them. Today the Room shows the one pending confirm, an event feed and the
mods; the Workflows page reads one project's workflow runs. Nothing lists the Claude Code, Codex and Ruflo sessions on the machine together, and
nothing says "this one is waiting for you" unless it was started through the console. Design input (rUv, 2026-10-09): a unified session
workspace with an attention queue and a live preview, in this order of value: (1) attention queue, (2) session browser, (3) preview beside the
list, (4) mission composer, (5) search previous work, (6) fork and compare. The biggest risk named was associating the wrong terminal or
transcript with a session.

Reference material: a public project's dashboard and harness docs were read for the shape of the idea only. No code or text was taken from it
(its licence is unknown); everything here is implemented from the requirements above and from formats read on this machine.

## 2. Decision

**One workspace on the existing Room, not a new destination.** The Room already owns "waiting for a yes", the feed and the mods, so it gains a
**Needs you** queue, a **Sessions** browser grouped by repository and worktree, and a **Preview** of the selected session. The Overview gains one
line with the four counts. `sessionWorkspace` (default on) turns the section off; `sessionPreview` (default on) turns off every line of a
session's response, tool, files and tests (titles stay, they name the row).

### 2.1 Harness adapters declare what they can do

`hooks/data/harness.ts` defines `HarnessAdapter { id, label, capabilities, scan(env) }`. Capabilities are `discovery, preview, approvals, resume,
fork, messaging, stop`, each `{ supported, why }`. An action a harness has not declared stays unavailable and the page says why (Enter on a
row shows "open: unavailable (reason)"). Declared, verified against the on-disk formats on this machine:

| adapter | discovery | preview | approvals | resume | fork | messaging | stop |
|---|---|---|---|---|---|---|---|
| `claude` (`<config>/projects/<folder>/<id>.jsonl`) | yes | yes | no: Claude Code writes no pending permission request into the transcript | no | no | no | no |
| `codex` (`<codex>/sessions/Y/M/D/rollout-*-<id>.jsonl`) | yes | yes | no: none appears in the rollouts read | no | no | no | no |
| `ruflo` (mission observation, agent stores; no disk read) | yes | status and counts only | yes: `awaitingAuthorization` | no | no | no | no |

`resume` is "no" everywhere because opening a session is a model turn; browsing must never start or wake one. The cost label is **reported**
(Claude's `cost-state.totalCostUSD`, a mission's settled spend), **estimated** (a mission's estimate; nothing is estimated for transcripts, there
is no price table here) or **unavailable**, shown as such, never as zero.

### 2.2 Identity, and what is not sure stays unassigned

Identity is `harness + canonical home + native id`. The native id is the file name's id. A row becomes **unassigned** when an entry inside the file
names a different id (Claude's `sessionId`, Codex's `session_meta.id`) or when two files claim the same id. An unassigned row sits in its own
bucket, shows no title from the file, no preview and no cwd, and raises **no attention item**. Duplicated rows get distinct keys so selecting one can
never select (or show) the other. The recorded `cwd` is split into repository and worktree by path alone (`<repo>/.claude/worktrees/<name>` and
kin): no git runs, no disk is touched. Where a file's cwd cannot be read (a transcript the host cannot read) the group is the project folder's
name; it is never decoded back into a path.

### 2.3 The attention queue

Kinds, in order: `needs-approval, question, failed, completed-unread`. Rules:

- **Approvals and questions stay until the harness stops reporting them**; looking at one never clears it. The console's own pending confirm is an
  approval item for as long as `state.pending` is set.
- **Read means viewed.** A failure or a completion clears only after a frame actually drew that session's preview text (`noteShown`), committed by
  the page's tick (`commitViewed`) while the Room is the page in front and the pane is shown. A placeholder, an error line, a text answer, a hidden
  pane, another page, or `sessionPreview` off clears nothing. A cleared failure returns if the session moves on to something newer.
- **History is not unread.** The first run records a baseline; completions older than it are not queued. The viewed map (at most 500 entries,
  numbers only) is the only thing persisted, in the plugin's store.
- **Unknown stays unknown.** A claude failure is "the last tool failed and nothing followed it for 30 s"; a question is an open `AskUserQuestion`; a
  completion is a `turn_duration` after the last conversation line. Anything else is not guessed.
- **Stale is shown.** When listing fails the earlier rows are kept, marked stale, with the adapter reported FAILED; a read that fails keeps the
  earlier summary.

### 2.4 Discovery is local, bounded and incremental

No model call, no process, no wake. Every file is stat-ed first (a link is refused, a vanished file dropped) and read again only when size or mtime
changed; a pass reads at most 12 MB. A fast pass runs every second while the pane is shown (the 60 newest sessions, the 8 most recently active
project folders, folders whose mtime moved) and a full relist every 15 s; a closed pane scans every 30 s. A window is the whole file under 2 MB
or its last 256 KB where the host offers `readTail`; a line over 400 KB is skipped unparsed, at most 30,000 lines are looked at, and nothing uses
a backtracking pattern on file text. **The host `$.fs` has no tail read (ADR-473)**, so on the real host a transcript over 2 MB is listed from its
stat and shows "larger than this host can read" instead of a preview; it is not guessed from the folder name. Previews are computed during the scan,
so moving the selection does no I/O. A pass that reaches its 12 MB read budget leaves the rest unread (the row says "not read yet") for the next pass.
The budget is one per workspace pass, shared by every adapter, and reads are taken one at a time across all of them: never-read files first,
first come first served (a file that did not fit is remembered with when it was first seen), then changed files least recently read first, so
neither a stream of new sessions nor a set that changes on every pass can starve a file. Where the host bounds reads (`readTail`) a read is
capped at what the pass has left; without it (today's host) a read that comes back larger than it reserved ends the pass's reads, so a pass
overruns by at most one file's growth since its stat (at most the engine's 4 MiB).

**The 2 s promise has a scope.** Surfacing within 2 s (a 1 s tick plus a pass of a few milliseconds) holds for the tracked sessions: the 60 most
recently written per adapter. A dormant session outside them that wakes by appending to its file (the folder's mtime does not move) is found by
the next 15 s relist, not within 2 s. The Sessions list starts folded so the Room's own sections stay in view; "Needs you" is always open.

### 2.5 Mission context

A Ruflo mission row shows the active task and what it follows, how many of its tasks are claimed, the ADRs attached to it, and how much of its
evidence is verified, from the observation, the ledger and the claims the console already reads. Only what exists is shown.

### 2.6 ruflo-mods

`sessionAttention` (default off) adds one `attention:` row to `/ruflo-mods` with four counts and when they changed. The console keeps those counts
(only) in `.claude-flow/console/attention.json`, in a ruflo project, rewritten when a count changes and at least every 5 minutes while the workspace
runs (a failed write is retried after 30 s, doubling to 5 minutes); a summary older than 15 minutes (or with no believable time) is shown as
STALE, because the console closed or the workspace is off. No gating behaviour changed.

## 3. Threat model

| threat | control |
|---|---|
| Wrong session shown or acted on | identity above; unassigned bucket; distinct keys; lookup only by key; a property test draws every row and checks no other row's words appear |
| Escape sequences, bidi, control characters, credentials in transcript text | every string drawn is cut and cleaned at read time by the one sanitiser (`plain` + the workflows `cleanText` mask, ADR-481 rules); a title or path is cleaned too |
| Transcript text reaching a model | the preview lives in a side table, not in `State`; `viewText` (what `console_state` and ask-claude read) draws structure and "transcript text is not included", and transcript titles read `claude session <id>`; anything a model sees still passes `modelLine` |
| Transcript text on disk, in snapshots, recordings, telemetry | nothing is written but the viewed map and four counts; a test dumps the whole console state and the store and finds no transcript text |
| Hostile JSONL: huge, garbage, one enormous line, deep nesting | window and line caps above, 12 MB per pass, at most 60 tracked sessions per adapter; a 5 MB garbage fixture is bounded and its escape/bidi/credential content stripped |
| Path traversal and symlinks | project and file names are matched against fixed patterns; a link (by listing or by stat) is never read; a linked project folder is never entered; tested on a real directory |
| Waking an agent | no adapter spawns or messages; a test fails the host's `run` and `spawn` and scans |
| ReDoS | no nested quantifiers on file text; a pathological line is timed |

## 4. Roadmap (accepted, not built)

4. **Mission composer** (goal, project, harness; model, budget and permissions behind an options panel). Only offers a harness whose adapter
   declares the action, and starts a session through the existing confirm-gated mission path.
5. **Search previous work**, text first, then RuVector semantic over the same bounded windows, with passages shown and resume offered only
   where `resume` is declared. Search results obey 2.2 and the threat model; an index would hold derived vectors, never raw transcripts.
6. **Fork and compare**: branch a task into isolated worktrees (ADR-441 worktree-per-writer) and compare tests, cost and changes. Needs `fork`
   declared by the harness and one writer per worktree; cost compares only like labels.

## 5. Alternatives

- **A new top-level page.** Rejected: the Room already holds pending asks and events; a second place to look defeats the point.
- **Read approvals from the terminal or the process list.** Rejected: associating the wrong terminal is the named risk, and it needs a process
  read. Approvals come from what the harness reports.
- **Decode the project folder name into a cwd.** Rejected: the encoding is lossy.
- **Persist previews for fast starts.** Rejected: it would write transcript text. The scan is fast enough.
- **Mark read on selection.** Rejected: selecting is not seeing; the draw is the evidence.

## 6. Consequences

- The Room is longer by the queue (the Sessions list starts folded); the section is off with one option, and the preview with another.
- On the real host a session over 2 MB has a row and no preview until the host offers a tail read; Codex rollouts with a `session_meta` id that
  differs from the file name (4 here) are unassigned rather than guessed.
- Claude and Codex approvals are not detected. They will appear when a harness exposes them, behind a verified format and a new capability claim.

## 7. Verification

`tests/sessions.spec.ts`, `sessions-safety.spec.ts`, `sessions-real-fs.spec.ts` (synthetic fixtures only), mods `tests/attention.test.ts`. A
read-only pass over this machine's real stores found sessions, ambiguity and timings (reported in the PR). Not verified: behaviour of a live Claude
Code permission prompt in the transcript; Codex approval events; the host's `$.fs` read latency under load.
