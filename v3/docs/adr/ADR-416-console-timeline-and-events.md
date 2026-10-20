# ADR 416: The Timeline and Events pages

Status: Accepted (ships in ruflo-console 0.18.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/watch.ts`, `hooks/views/manage.ts` (the Timeline and Events views), `hooks/views/frames.ts` (the Gantt window).

Extends: ADR 407. Companion to ADR 412 (answers open where asked) and ADR 411 (Ask Claude).

## 1. Context

Both pages were thin. The Timeline drew one Gantt picture of the last 15 minutes with a legend; there was no way to look further back or to read who was actually busy. The Events page listed the last 18 events, filtered only by a button that cycled through the kinds, and the newest line moved under the cursor as events arrived. rUv asked for a better timeline and the same for events.

## 2. Decision

### 2.1 Timeline
- **Look back 5, 15 or 60 minutes** (chips; default 15). The Gantt picture and the lane spans use the chosen window.
- **Who was busy:** under the picture, one row per lane (Claude's main session and subagents, then each ruflo agent): busy time as a share of the time that lane was observed in the window, the observed minutes, and the tool calls seen. A lane with no status seen says so rather than showing 0%. Each row has **✦ ask Claude** (a worded question about that lane's numbers, sent to the main UI; it asks first).
- Only what the console observed since it loaded is counted; before that a lane is blank, as before.

### 2.2 Events
- **Kind chips with counts** (all, and each kind that has events), replacing the cycle button (kept as `f`).
- **Find:** a text field matching the event text or its kind, with a clear button.
- **Pause / resume:** pausing stops the tail where it is (events arriving later are counted as "N new" in the title and not shown), so a line can be read; resuming shows them.
- **Per-minute sparkline** of the last 15 minutes of the shown events.
- **Paging** back through the 300 kept events, 12 at a time (older / newer); a new filter or search returns to the newest page.
- **One event opens for detail** (click a line): its full text, kind, ISO time and agent, and **✦ ask Claude about this event**.

### 2.3 State and actions
All of it is `WatchState` in `watch.ts` (range, query, pause point, open event, page), pure over `state.events` and `state.statusLog`, with `WatchActions` bound in `bindings.ts`. Nothing reads or writes ruflo.

## 3. Alternatives considered

- **Stream events with a live scroll.** Rejected: a moving list cannot be read or clicked; pause plus paging is the terminal-friendly answer.
- **Store more history.** Rejected here: the cap (300 events) is a memory bound; the pause and page controls make it usable.
- **A separate per-agent page.** Rejected: the drill-down page exists (the agent view); the lane rows summarise and ask.

## 4. Consequences

- Both pages are usable for longer sessions; asking about a lane or an event is one click and one confirm.
- The window change redraws the picture on the next frame; spans older than the window are clipped, not recomputed.

## 5. Safety

Read-only over what was observed; the only outward action is Ask Claude, which asks first, quotes data and screens nothing typed (the search text stays local).

## 6. Tests

`tests/watch.spec.ts` (filter and search, pause, counts and per-minute, paging, open toggle, range values, which page an ask goes to), `tests/watch.test.ts` (the look-back chips redraw the title; the Events chips, find field, pause and clear), and the dead-button sweep covers every button on both pages.
