# ADR 469: Workflows page layout at every dock width, and a clock for replay

Status: Accepted

Date: 2026-10-06

Builds on: ADR-458 (the page), ADR-459 (drill-down), ADR-461 (replay, compare), ADR-463 (worktrees, templates), ADR-464 (slots)

## 1. Context

Recordings of the Workflows page at the widths the engine really gives the dock (about 60 to 125 columns, `RUFLO_CONSOLE_COLUMNS`
overrides) showed six defects:

1. The drill breadcrumb's last crumb (`Agent · Activity`, `Agent · Log`...) wrapped one letter per row at narrow widths.
2. A run's id in the Phases footer and in Compare (`B le-btr`) was cut from the left.
3. Button rows ran past the right edge at 60 and 72 columns (`[ Close` cut, stray letters past the border); the inspector's tab row
   clipped at 60 so the `control` tab could not be clicked. The extras row (every key and action slot, nine buttons) was 193 cells wide
   at every width, even 125.
4. On the wide Files tab, `Read diff stat` touched the worktree path with no space.
5. Compare labelled a run `B le-btr`: the same left-cut family as 2.
6. One unreproduced `ui.press hook skipped... no handler is held under handle` after a resize.

Replay also only advanced when something else redrew the page: pressing play moved nothing until the next refresh tick.

Root causes. (1)(3)(4): the engine gives a Button its label plus `[ ` and ` ]`, gives a plain Text its length, and only a Text with
`wrap: 'truncate-*'` gives way; a row that asks for more than the pane overflows, and a plain Text left almost nothing wraps by letter.
Every row was built as one fixed `row(...)` of however many buttons there were. (2)(5): `shortId` (data/parse.ts) takes the last six
characters of the id when its last word is shorter than four (`sample-btr` becomes `le-btr`), a cut through the middle of a word.
(6): the host holds a Button's `onPress` only for the life of the drawing that made it (the engine's own type comment), so a click
sent while the pane was redrawn (a resize) can reach a drawing that is gone.

## 3. Decision

**One layout module, `views/wf-layout.ts`.**
`flow(ctx, buttons, key, lead?)` packs buttons into rows no wider than the pane (each at label + 4 cells, emoji at two), wrapping to
`key-2`, `key-3` where a row is full; a label longer than a row is clipped with an ellipsis, never overrun; every button stays, in order,
and clickable. `crumbRow` draws the breadcrumb: the whole trail while it fits, then `Runs › … › Agent: x` (middle crumbs folded), then
`… › last`, and only then a clipped last crumb; the last crumb is a `truncate-end` Text, so it cannot fall to a letter per row, and the
sub-tab (Activity, Log, Files, Result) is no longer in the crumb: it is the `view` tab row of its own below it. `runTag` names a run by its
last word, or by whole words where that is too short (`sample-btr`), never a cut through a word. `safe` wraps a handler so a throwing closure
changes nothing and says nothing.

Used for: the page's move row, extras row and tab row; the drill's moves, breadcrumb, tab row, log head, loaders; replay controls;
compare controls; the inspector's agent actions and transcript button; template pick and choice rows; the worktree read button; the
search's loader. The Files tab draws the path then one space then the button, and the unbound case is two lines, not one row.
`rule` and `section` headers in `common.ts` clip their title and right-hand text to the pane (a `truncate-end` Text), so a long phase title
or slot title cannot push the row past the border.

**Replay has a clock.** `data/wf-replay.ts: settle(ui, timeline, now)` brings a playing replay up to now and re-bases it there (the clock
keeps its fractional progress, so two events minutes apart are reached by ticks), stops at the end, and carries at most `TICK_MAX_STEPS`
(400) events per call. The page's `workflows.tick(name, ms, fn)` action (wf-actions.ts) runs `fn` on the console's own clock
(`host.every`, one timer per name in `state.timers`, so the console's stop cancels it), redraws after each call, and ends the timer when `fn`
answers false, throws, the page is not the one in front, or the pane is hidden. Replay starts it on play (every 400 ms) and on any draw that
finds the replay playing (so coming back to the page resumes it), and `replayTick` ends it at the end or on pause. A surface without
the action keeps the old behaviour (it advances on the next redraw).

**Orphaned presses.** The only place a press can be orphaned is the engine's drawing handle. `hooks/press-guard.ts: tolerantPress` wraps the
`ui.press` hook's `next(e)`: a rejection saying `no handler is held` answers `{ element }` quietly; any other failure still propagates. The page's
own handlers are all `safe`.

## 4. Consequences

- Rows that were one line become two at the narrowest widths (the move row at 56 columns is two rows); reading order is unchanged.
- The drill's crumb at the agent level reads `Agent: label`; the tab is shown on the tab row. Specs that matched `Agent · Activity` were updated.
- `shortId` itself is unchanged (not this page's file); the Workflows views stopped using it for run names. Other pages that use it keep its cut.
- A playing replay costs one timer, a bounded scan and one redraw per 400 ms while the page is open; none while it is closed or paused.
- A stale click is dropped silently; it cannot be told from the engine's own message by anything but its text, so the pattern is narrow.
- The press hook change is in register.ts (a one-line wrap), the only edit outside the Workflows views, data and actions.

## 5. Tests

- `tests/wf-layout.spec.ts` (24): draws the full page (every slot, replay/compare/export/saved opened, inspector open) at 56, 60, 72, 80, 100 and 125 columns in both looks, and the drill at every level and tab plus search at the same widths, with a meter (`tests/fixtures/wf-layout-rig.ts`) that sums a row the way the engine lays it out: no row wider than the pane, no plain Text squeezed to a letter, every button reachable, the crumb folded before it wraps with its last crumb whole and no tab name in it, a space before `Read diff stat`; helper tests for `flow`, `rule`, `runTag`, and the meter itself.
- `tests/wf-replay-tick.spec.ts` (9): a fake host and clock; play starts one timer and ticks advance it with no other redraw; it stops at the end, on pause, when the page is left and when the pane is hidden; a throwing tick ends; `settle` is bounded (5000 events, one call, at most 400 steps), keeps partial progress across ticks, ends at the last event.
- `tests/press-guard.spec.ts` (4): the stale-handle answer, other failures propagate, handlers never throw.
- Mutation-checked: no wrapping in `flow` (18 fail), no crumb fold (3), an unclipped rule title (2), no space before the diff button (1), no label clip (2).

## 6. Rollback

Revert the commit. `flow` and `crumbRow` are additive helpers; the views return to their fixed rows. The `tick` action is optional in
`WorkflowsActions`, so removing it leaves replay advancing on redraw as before. The press guard is one wrapped line in register.ts.
