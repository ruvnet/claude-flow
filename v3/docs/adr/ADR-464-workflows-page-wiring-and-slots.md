# ADR 464: Workflows page wiring and its slot seams

Status: Accepted

Date: 2026-10-05

Builds on: ADR-458 (the page itself), ADR-444 (Claude controls the console), ADR-453 (confirm-gated verbs)

Reserved and untouched: ADR-459 (drill) to ADR-463

## 1. Context

ADR-458 shipped the Workflows page's data, key reducer and drawing, but nothing reached it: no view id, no menu entry,
no state, no refresh. Five features (on `feat/mind-all`) also want to add to that page, and a shared file edited by six
writers is where merges go wrong.

## 2. Decision

**Wire it.** `workflows` is a view in `VIEWS` (after Claims; label Workflows, 34 rows) with **no hotkey**: every digit and
letter is a tab key or a reserved one (footer `p x r h`, confirm `y n`, scroll `j k`, menu `o`), as for Room and Sandbox.
It is in the nav's SWARM group, the menu's SWARM > observe section beside Swarm Topology, the boot log, the ask table
(`ruflo-workflows:workflow`), the help guide for Swarm, and `/ruflo workflows` (and `/ruflo dump workflows`, which reads first).

**State.** `state.wf` (`wf-state.ts`, a leaf module): the last read (runs already washed), when, the last error, the
cursor, the inspector tab, and each run's state as of the last read.

**Refresh, outside the controller.** `wf-live.ts: refreshWorkflows` reads Claude Code's run folders through the host's read-only `fs`
only while `state.view === 'workflows'` and the pane is open and shown (or there is no pane, as in a dump). It runs when the page opens
(`view-open.ts`) and on the controller's existing refresh tick (one call in `controller.ts`, 495 lines). One read at a time; a failed
read keeps the runs on screen with a warning line. Bounds are ADR-458's (6 runs, 60 agents, 3 MB per transcript, cap printed on the page).

**Washing.** `data/wf-clean.ts` strips control characters and masks credential-shaped text in every free-text field (labels, phase titles,
models, last tool, result preview, ruflo agent names) once per read, before the page, a notice or a slot sees it. Ids and paths are not
masked (a session id is 36 characters of `[0-9a-f-]` and would read as a key). A transcript path is shown only if it is under
`<configDir>/projects/` with no `..` part.

**Keys.** A pane hotkey is one lowercase letter or digit (the engine refuses `[ ] ? Enter`; found when the matrix mounted the page), and
`h` is Help's. So: `j k` move, `b` / `l` focus the phases / agents column, `u` / `i` switch run, `d` inspects or closes the inspector.
Each is also a button, so Enter on a focused button and the mouse work; Esc stays the pane's. `/ruflo next|prev` moves the cursor as `j k`.
View-local keys shadow tab keys while the page is open, as Claims' do. ADR-458's stop-agent hotkey `x` (the footer's Actions) was removed.

**Notices.** A workflow run that changed to finished or failed between two reads raises one band notice (deduped by the notice ring).
Reads happen only while the page is open, so this is not a background watcher; it says what changed while the person looked.

**What the console cannot do.** (Amended by ADR-465: it now can, through the engine's own TaskStop and SendMessage, behind the engine's permission check and the confirm card.) It could not stop or message a running Claude Code workflow when this was written. Where those buttons would be, the page says so
and where to do it (Claude Code's Workflows panel, TaskStop). The only writes are ADR-458's: stop and spawn a ruflo agent behind the confirm card.

**Seams.** `views/wf-slots.ts` is a registry; features call `registerSlot` from their own module and edit no shared file. Kinds:
`board` (a section under the run board), `tab` (an inspector tab), `key` (a hotkey button), `action` (a confirm-gated ruflo verb), `notice`
(drafts after a read). Registration is pure and refuses, with a reason and no throw: a bad or repeated id, a missing function or title, a
hotkey that is not one lowercase letter or digit, a hotkey the page owns (`p x r h y n j k l b d o u i`) or another slot holds, and a
13th slot of a kind. A slot that throws is caught where it is called and costs one line. `views/wf-register.ts` is the only file the
merge owner edits: one `import '../wf-<feature>'` line per feature.

## 3. Consequences

- The page is reachable and live, and costs nothing while it is closed.
- Six writers can extend it without touching `state.ts`, `controller.ts`, `pane.ts`, `bindings.ts` or the page itself.
- A slot's own drawing is not washed by the page: a slot that draws file text must call `cleanText` (exported from `data/wf-clean.ts`).
  Notice text from a slot is washed by the registry's caller.
- The run record of a finished run appears up to 10 s late (the reader's missing-file recheck), so a finish notice can lag by that and a tick.
- Keyless: it is not in the tab bar unless open; the nav, the menu and the name reach it.

## 4. Test and benchmark plan

`tests/wf-wire.spec.ts` (22 tests, vitest, no engine): reachability, refresh gating (other view, closed pane), join of a concurrent read,
error path, washing, notices (first read silent, finish raises one, slot notices masked, throwing slot contained), keys and hotkeys, path
validation, page drawing at 40/80/150 columns, every slot kind, and the registry's refusals. Mutation-checked: removing a reserved key, the
slot cap, the `..` check, the view gate, the first-read guard, the mask and the cannot-stop line each fail a test. The engine matrix
(`tests/matrix.test.ts`) mounts the page at 80 and 150 columns. Benchmark: `scripts/bench-swarmui.mjs` (ADR-458) already covers the read and
the draw at 1k and 10k agents; the wiring adds one `Map` build per read.

## 5. Rollback

Remove the `workflows` row from `VIEWS` and the type, the five registrations (nav row, menu section, boot module, area row, ask entry), the
`wf` field, the one call in `controller.ts` and the `pane.ts` body. The data modules and ADR-458's view stay; nothing is persisted.
