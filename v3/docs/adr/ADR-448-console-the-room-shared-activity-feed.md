# ADR 448: The Room — a shared live feed where a person, Claude and the swarm watch and talk to each other

Status: Accepted (implemented in ruflo-console 0.33.0; §3.2, the expiry event, shipped in 0.32.2)

Date: 2026 10 04

Scope: `plugins/ruflo-console`: new `hooks/views/room.ts`, `hooks/data/room.ts`, `hooks/room.ts`; edits to `hooks/state.ts` (`ViewId`, `VIEWS`, `Pending`), `hooks/views/pane.ts` (`BODIES`) and `hooks/runner.ts` (`ask`). As built, `hooks/palette.ts` and `hooks/model-tools.ts` carry no room code: the three senders are wired in `hooks/room.ts`, and Claude reads the feed by opening the `room` page and calling `console_state`. The feed lives in memory, per console session.

Builds on: ADR 407 (cockpit), ADR 416 (Timeline and Events — read-only, per-page), ADR 444 (Claude controls the console — the model tools and the pending-confirm contract this ADR extends).

## 1. Why

Testing the console's four model tools end to end (a full page sweep plus `console_set`/`console_run` probes, 2026-10-04) surfaced a real gap: a person asked the console to create a mission; a few minutes and several unrelated console actions later the pending confirm was simply gone — no mission, no error, nothing in `console_state` pointing at what happened to it. Tracing it through the source (`hooks/runner.ts`, `hooks/model-tools.ts`) found two independent ways that happens, both already in the shipped code, neither visible anywhere:

- **`state.pending` is one slot, not a queue.** `ask()` (`runner.ts:141`) assigns it unconditionally. `model-tools.ts:276` *does* guard Claude's own `console_run` against clobbering a person's pending action ("never replaced, never cleared") — but nothing guards the reverse, and nothing guards a person's own second click. Two asks in a row anywhere in the console still only ever leave one pending. (Review note: the one background path that did this to Claude's own pending action, the async guidance offer, was fixed in #3699, ruflo-console 0.32.1; a person's own second click still replaces it, by design.)
- **A confirm older than 30 s is silently dropped.** `PENDING_TTL_MS = 30_000` (`runner.ts:15`); `confirm()` (`runner.ts:147-150`) nulls `state.pending` either way and speaks the "more than 30 s, ask again" outcome through `say()`. (Review note, corrected: `say()` does write `state.outcome`, so the miss is not untraced; but `outcome` is one slot that the next action overwrites, and it is not `control.log` or an event, so the trace is gone as soon as anything else runs.) A person who answers "y" a minute later sees it fail only if they were still looking at that exact screen; `console_state` afterward shows `waiting: null` and, once another action has run, no trace that anything was asked, let alone refused.

The console already has three real pages for *watching* (Timeline, Events, Approvals) and three real ways to *write into the room* (`broadcast`, `mission-aside`, `mission-guide` — ADR 406/443, `hooks/mission-palette.ts:34-35`, `hooks/palette.ts:136`). Nothing puts the two together, and nothing makes the one pending confirm — the single most consequential thing on screen — impossible to miss. The user asked for a dashboard that helps a human and the agents "see what's happening" and collaborate; this ADR is that page, built from what already exists rather than a fourth notification system (the claims lesson: don't build a fifth of something that already has four).

## 2. What was checked

- `hooks/state.ts:24` (`ViewId`), `:35` (`VIEWS`) and `hooks/views/pane.ts:62-91` (`BODIES`, the render dispatch) are the only three places a page is wired in; two letters are free on the tab row (`VIEWS` keys in use: `0-9 b c g q e w i z u f a l v t d m s`; `h j k n o p r x y` are not), so the new page needs no existing key moved.
- `hooks/watch.ts` + `hooks/views/manage.ts` (ADR 416) already hold `ConsoleEvent` history (300 kept, paged) and the per-lane busy/idle timeline; this ADR reads both, it does not re-collect them.
- `hooks/model-tools.ts:94` (`say`) already writes `control.log: ControlEntry[]` — every tool call Claude makes through the four `mcp__ruflo-console__` tools, with its outcome. That is exactly "what Claude is doing", already recorded, just not shown next to anything else.
- `hooks/palette.ts:68,136` and `hooks/mission-palette.ts:34-35`: `broadcast <text>`, `mission-aside <question>` and `mission-guide <instruction>` are the three existing, already-confirm-gated ways something typed by a person reaches the hive or Claude. A fourth input box was rejected for the same reason the claims system is not getting a fifth tracker.
- Read `hooks/views/manage.ts`'s `timelineView`/`eventsView` in full: both are strictly read-only (ADR 416 §5), their one outward action is "ask Claude", itself gated. The Room differs on purpose: it is the one page meant to be written into, by a person or by an agent action that lands in it as a side effect.

## 3. Decision

### 3.1 The page

A new view, `room` (`ViewId`, key `r`, icon `💬`, label "The Room", blurb "what the people and the agents here are saying and doing, live — and the one thing waiting for a yes"), `rows: 30`. Layout, newest first:

1. **The pending banner, always first, bold, never scrolled past.** If `state.pending !== null`: its label, what it expects, which page raised it (`pending.view`), and **how old it is against the 30 s window** (`Date.now() - pending.askedAtMs`), so a person sees "22s — answer soon" instead of discovering the miss after the fact. This is the same data `pane.ts`'s confirm row already has; The Room is where it is unmissable instead of a line under whichever page happened to be open.
2. **Say something** — three fields, not a new one: the existing `broadcast`, `mission-aside` and `mission-guide` palette entries, run exactly as `/ruflo run <id> <text>` would (`console_run`'s own contract). Each still asks first, per its existing class; the Room adds no bypass.
3. **The feed** — one merged, chronological list:
   - every `ConsoleEvent` from `watch.ts` (swarm, claim, memory, mod — unchanged from Events), tagged by kind as today;
   - every `ControlEntry` from `control.log` (Claude's own tool calls and their outcome — unchanged from the Claude-control section on Overview, ADR 444 §3), tagged `🤖 claude`;
   - the three text actions above, tagged by who sent them, the moment they're confirmed.

   Same mechanics as Events (ADR 416 §2.2): kind chips, find, pause/resume, paging — reused, not reinvented, because Events already solved "a feed too long to read live."
4. **Who's here** — the per-lane busy/idle summary `timelineView` already computes (`manage.ts:27-57`), condensed to one line per lane (name, busy % of the last 15 min, last tool call), each with the existing "✦ ask Claude" button.

### 3.2 The one behavioral fix this ADR makes (not just a new page) — implemented

An expired confirm must leave a trace. `confirm()` (`runner.ts:147-150`) gains one `record(state.events, …)` call (done, with `tests/runner.spec.ts`): when `isFresh` is false, push a `ConsoleEvent` (kind `tools`) ("a confirm for '<label>' arrived 46s after the ask and was not run — answer within 30s next time") before nulling `pending`, the same way every other event reaches `watch.ts`. This is the minimum fix that makes the failure mode this ADR found show up in the feed it just built, instead of nowhere. It does **not** extend the TTL, add a queue, or change who may answer a pending — those are explicitly deferred (§5).

### 3.3 Model tools

`console_state`'s existing `waiting` field is unchanged (ADR 444 §3). Add nothing new to the four tools: Claude already reads the feed by opening `room` and calling `console_state`, and already writes into it through `console_run` on `broadcast`/`mission-aside`/`mission-guide`, exactly as it would on any other page. No fifth tool.

## 4. Alternatives considered

- **Fold this into Overview instead of a new page.** Rejected: Overview (ADR 407) is a dashboard of subsystem health, not a timeline; the Claude-control log already lives there as one section and stays there — The Room transcludes it, it does not move it.
- **A new "post a note" palette entry instead of reusing `broadcast`/`mission-aside`/`mission-guide`.** Rejected: three confirm-gated, classified, tested text actions already do this; a fourth would need its own classification, its own confirm copy, and its own place in the 40-action and AIDefence checks for no new capability.
- **Queue every pending confirm instead of one slot.** Rejected for this ADR: it is a bigger behavioral change to `runner.ts` than a new page should carry, touches the model-tools refusal contract in ADR 444, and the TTL-trace fix in §3.2 is the narrower, lower-risk way to make the current single-slot model legible instead of silent. Worth its own ADR if a person or Claude regularly needs to stack more than one ask.
- **Stream the feed live with auto-scroll.** Rejected for the same reason ADR 416 rejected it for Events: unreadable, unclickable; pause/resume plus paging, reused as-is, already won that argument.

## 5. Not decided here

- Queuing more than one pending confirm.
- Changing the 30 s TTL.
- A feed entry becoming clickable the way an Events line is (ADR 416 §2.2) — likely yes, deferred to keep this ADR's diff to the merge, not new interaction.
- Whether `room` joins `CORE_TABS` (the keyless-view tab set) — a design call for whoever builds it, not an architectural one. (Built in 0.33.0: `room` is in `CORE_TABS`, `hooks/views/pane.ts:57`.)

## 6. Consequences

- One new page, wired through the three existing extension points (`ViewId`, `VIEWS`, `BODIES`); no new state machine, no new confirm path, no new tool.
- `confirm()` gains one `ConsoleEvent` push on the expiry branch — the only change to existing behavior, and it is additive (an event appears; nothing stops firing that fired before).
- The feed's volume is the union of Events' volume and Claude's own call log; the existing 300-event cap and paging (ADR 416) bound it the same way.
- Three already-gated write actions get a second entry point (The Room, in addition to the palette and `/ruflo run`); no new classification, no new confirm copy, no change to who may run them or at what control level.

## 7. Tests

`tests/room.spec.ts`: the pending banner renders the age against the 30 s window and the raising page; the merged feed interleaves `ConsoleEvent` and `ControlEntry` in time order; the three text actions run the same `ActionSpec` the palette would (assert on the dispatched id and args, not a new code path); pause/resume and paging behave as `tests/watch.spec.ts` already asserts for Events, reused against the merged feed. `tests/runner.spec.ts` gains one case: a `confirm()` call after `PENDING_TTL_MS` produces exactly one new `ConsoleEvent` naming the expired label, and still leaves `state.pending === null`. The dead-button sweep (ADR 416 §6) covers every button on the new page.

## 8. Implementation notes (0.33.0)

- **No hotkey.** The ADR said `r` was free; it is not: `p x r h j k y n o` are reserved for the footer, the confirm row, scrolling and the menu prompt (`tests/nav.spec.ts`), and every other letter is taken. The Room is a named-only page like Sandbox: reached from the menu (Safety → Room), `/ruflo room` and `console_open view=room`. Its label is `Room` (the banner format wants one word); its title on the page is "The Room".
- **Shape as decided:** `hooks/data/room.ts` (pure feed, banner, status), `hooks/room.ts` (state and actions), `hooks/views/room.ts` (page). No fourth tool, no new confirm path: the three senders are the existing `broadcast`, `mission-aside` and `mission-guide` entries run through `runner.runById`, and the page only offers them once there is a draft.
- **What the person said** is kept (at most 50) with the label its confirm showed; its state (waiting for your yes, sent, not sent: why, not confirmed) is derived from the pending action and the last outcome, never assumed.
- **Limits that hold:** draft 500 chars, find text 80, feed 200 items after a merge of at most ~600, every text from every source passes `plain()` (control and bidi characters stripped, length cut), and nothing in the feed is an action: an instruction inside an event is only text. Measured: merging 300 events, 200 Claude actions and 50 sayings takes well under 5 ms (asserted in `tests/room.spec.ts`).
- **Checked live:** a real Claude (haiku) opened the page through `console_open` and read its four sections through `console_state`.
- **Tests:** `tests/room.spec.ts` (13), plus the page is covered by the dead-button sweep, the every-affordance-refused sweep, the guide, ask, nav, boot-log and self-check suites (kit suite 211/0, vitest 871 at the time; about 990 `it(`/`test(` calls in 103 files on 2026 10 05).
