# ADR 425: The Missions list: one line a mission, attention first, and a stale record flagged

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/mission-list.ts` (new, pure), `hooks/views/missions.ts` (`observationRows`), `tests/mission-list.spec.ts` (new), `.claude-plugin/plugin.json` (0.26.0), `scripts/smoke.sh` (version check).

Extends: ADR 409 (the Mission Control planner and lifecycle), ADR 407 (the cockpit), ADR 424 (the compact nav, which the Missions page is reached from).

Mission record decision: the CLI (`v3/@claude-flow/cli/src/missions`) and ADR 409 cite the mission-record decision as **ADR 406**. The file numbered 406 in this tree (`ADR-406-ruflo-mod-command-compatibility.md`) is a different decision (command compatibility). The mission-record decision has no file in this tree, so the number collides and the mission record is not citable by file here. This ADR does not rename either; the collision is recorded so it can be resolved where the mission record lives.

## 1. Context

The Missions list shows the record `.claude-flow/missions/observation.json` writes. It drew the first six missions in the order of their last update, each as a block of four or more lines (objective, state and revision, plan, evidence and budget, plus executor and blocked lines when present), and then `+N more` with no way to reach them.

Three things made it hard to act on:

- A failed or blocked mission could sit below newer, healthy ones, so the thing that needed attention was the easiest to miss.
- Six blocks took about 24 lines, and anything past six was not reachable from the list.
- The view said when the record was observed but not whether that was recent. The daemon writes the record after each change, so an old observation usually means the daemon has stopped, and the list read as current.

The read-only rule stands: the console takes no mission action from this list (ADR 409 and ADR 406 route actions through `ruflo mission action` with a request id and the expected revision).

## 2. Decision

- **One line a mission.** Each row is a state glyph, the objective cut to 36 characters, the state, `tasks done/planned`, `verified/evidence`, and the budget (`settled of ceiling`, `settled`, or `no budget`).
- **Attention first.** Missions sort by rank: blocked and failed; then running, verifying, pause and cancel requested; then queued, paused, awaiting authorization, planned and draft; then completed and cancelled. Within a rank, the most recently updated first. The header counts the missions that need attention.
- **The cursor is the expanded row.** `j` and `k` move the cursor through the list with the existing `state.select.item`, the same as the memory lab and the other lists. The cursor's mission is drawn in full (the existing detail block) below the list. No new state.
- **A window of ten.** The list shows ten rows around the cursor; the rest are counted as `+N more not shown · j and k scroll`.
- **A stale record is flagged.** When the observation is older than `STALE_AFTER_MS` (10 minutes), the view says so, with the age, and that the daemon may have stopped. An observation with no time is treated as undated and gets no warning.
- **The logic is pure.** Ranking, freshness, the row text, the cursor clamp and the window live in `hooks/mission-list.ts` with no view or kit import, so `tests/mission-list.spec.ts` runs without the Claude Code test kit.
- **A `+` marks a floor.** When the record cut the plan short (`taskCount` above the tasks it sent), the done count reads `1+/9`, not `1/9`, so the count is never presented as complete.

## 3. Alternatives considered

- **Keep the six blocks and add paging.** Rejected: paging hides the same five lines per mission and still makes the list long.
- **A detail page for each mission.** Rejected: a page per mission adds a navigation step to every check, where the cursor shows the detail in place.
- **Clickable rows.** Deferred: a `Button` per row would make the row the click target, but the live click path needs a smoke run on the Claude Code UI before it is relied on. The keyboard cursor ships first.
- **Filtering by state.** Deferred: the attention-first order answers the common question (what is wrong) without another control. Filtering can follow if the list grows past one window.
- **A staleness threshold from the daemon's own interval.** Rejected for now: the record does not carry the daemon's interval. A fixed ten minutes is a visible choice that can be tuned in one constant.
- **Changing the mission actions.** Out of scope: the read-only rule is the safety boundary and stays.

## 4. Consequences

- **Lines, measured by the spec.** Six missions: about 24 lines before (four per mission, more with executor or blocked lines), 10 now (six rows, one expanded block of four). Twenty-five missions: 24 plus the `+19` line before, 15 now (ten rows, one hidden line, four expanded). The spec asserts the six-mission case.
- **Attention is visible without a scan.** A failure is the first row and the header names how many there are.
- **The threshold is a judgement.** Ten minutes suits a daemon that writes on each change and is idle for long stretches only when nothing is happening. A quiet but healthy workspace can show the stale note; the note says the daemon "may" have stopped, not that it has.
- **The mission-record number stays ambiguous** until the owning ADR is filed under its own number. Code comments that say ADR-406 for missions are left as they are.

## 5. Tests

- `tests/mission-list.spec.ts` (pure, 13 tests): the rank of each group of states; the order (failure above a newer running mission, newest first within a rank, input not mutated); the attention count; the freshness boundaries (undated, fresh, exactly at the threshold, stale one millisecond past); the row (state, tasks, evidence and budget on one line; a `+` on a cut plan; the budget phrases; a cut and a missing objective); the cursor clamp; an empty list; six missions as one line each plus one expanded block; a window that keeps a cursor at index 20 on screen and counts the rest; the window at the top and at the end.
- `tests/missions.test.ts` (kit, unchanged): its expectations are on the mission detail block and the empty state, which this change does not alter. It cannot load on a machine without the `claude-code/testing` host package; CI (ADR 413) runs it.
- The console suite: 346 tests pass. 22 files fail to load because the `claude-code/testing` host package is absent here; each fails only on that import, and none on this change. The count is higher than on the earlier base because `origin/main` carries more kit tests.
- Live: not yet run. The next step is a live smoke of the Missions page with a record that has a blocked mission, a stale observation and more than ten missions, checking the cursor, the window and the stale note in the real Claude Code UI.
