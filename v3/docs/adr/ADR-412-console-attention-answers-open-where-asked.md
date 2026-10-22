# ADR 412: Answers open where they were asked

Status: Accepted

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/views/attention.ts`, `hooks/register.ts` (`ui.press`, `ui.input`), `hooks/runner.ts` (origin), `hooks/views/pane.ts`, `hooks/views/common.ts` (`confirmRow`, `confirmInline`), the lab views' `slot`, `hooks/memory-lab.ts` (its own panels).

Extends: ADR 407. Detail of ADR 408 sections 5, 11 and 11a.

## 1. Context

The console is a tall scrolling page of sections full of buttons. Each action that asks (a confirm) or answers (a result) used to draw in a fixed place: the confirm above the whole body, the lab result in one block far from the button. A person clicking a row halfway down the page had to scroll up to confirm and down to read, and often did not notice that anything was waiting. rUv reported this for the Memory Lab and then for MetaHarness, and asked for it on every page: either scroll to the area or move it below the click, with a clearer sign that something needs a click.

## 2. Decision

### 2.1 Know where the click came from
The engine raises `ui.press` for a pressed `Button` and `ui.input` for an `Input`, and hooks run **before** the element's own `onPress`. `register.ts` records the pressed key in `state.lastPressed` (a submit for an Input; the confirm keys `confirm`, `cancel`, `remember`, `always` are answers and never move it). `runner.ask`, the single entry for every action, turns it into `state.origin` and clears `lastPressed`. A headless run (the palette, `/ruflo run`) has no press, so no origin.

### 2.2 Place the panel after the child that holds the origin
When an origin is waiting, the page is drawn through a kit whose **column Box** watches for it: the first column holding the origin's element gets the **panel** (the confirm unless the view draws its own, the outcome of the last action, and a lab's result lines) right after that child. Which element holds the origin is learned from keys already on the elements (the same `key` the tests read) and remembered by identity in a `WeakMap`; the engine's element shapes are not otherwise touched. A quiet page (no origin) is drawn with the plain kit, so it costs nothing extra.

### 2.3 Lab results are donated, not duplicated
A lab view hands its result block to the panel (`slot`): the block alone is drawn once to find its rows (reused while the view, width, result, scroll and spinner are unchanged), then the page is drawn with the panel placed and the block hidden. If the origin is not on screen (a hotkey, the palette, a folded section) the confirm falls back to the top and the lab keeps its block at its foot, so nothing is ever lost.

### 2.4 Say that something is waiting
The confirm is headed `▶ CONFIRM NEEDED — click Yes or press y`, and the status row says `⚠ confirm needed: <what> — y yes · n cancel` wherever the confirm sits, so a pending ask is visible without scrolling.

### 2.5 Views that already placed their own
Mission Control, Hive-Mind and Memory Lab place their asks in their own areas (`confirmInline`); the panel skips the confirm for them and still carries outcomes. An ask with scope `ask` (Ask Claude, Launch) is always drawn by the panel.

## 3. Alternatives considered

- **Scroll the pane to the confirm.** Rejected: the pane's scroll belongs to the engine and moves under the person; placing the confirm under the click needs no scroll.
- **Wrap every `Button` to record presses.** Tried; rejected: it cost about 1 s on the Dev Tools sweep (about 30%) because every render wrapped every button. Hooks cost nothing per render.
- **Per-view code in every lab.** Rejected: nine views, nine chances to drift; one mechanism and a one-line `slot` per result block.
- **Draw the confirm in a modal.** Rejected: the mod API has no modal for panes, and a modal hides the context the person is deciding about.

## 4. Consequences

- Every page behaves the same; a new lab gets the behaviour by calling `slot` once.
- The page is drawn twice for a frame in which a lab result is on screen and its inputs changed; steady state is one draw.
- The origin is the last press that raised an ask: an async result arriving much later still draws under that press until the next ask.

## 5. Safety

The panel holds the same confirm the pane always drew (same argv, same note, same Yes/Cancel); it never auto-answers; the fallback is the old location.

## 6. Tests

`tests/attention.test.ts` (MetaHarness and Dev Tools: the confirm is the very next button after the pressed one, the result follows, nothing twice; a folded or headless ask goes to the top), the Memory Lab placement test in `tests/labs.test.ts`, and the kit tests of the Loop Manager, Learning and Optimizer sections, each of which asserts its confirm sits under its button.
