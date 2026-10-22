# ADR 422: Cards, a grouped nav, and asks that stay on their page

Status: Accepted (ships in ruflo-console 0.23.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/views/card.ts`, `hooks/views/marks.ts`, `hooks/views/nav.ts`, `hooks/views/common.ts` (`rule`, `section`, `confirmRow`), `hooks/views/pane.ts`, `hooks/views/frames.ts`, `hooks/runner.ts`, `hooks/state.ts` (`Pending.view`), `tests/card.spec.ts`, `tests/missions.test.ts`.

Extends: ADR 407, ADR 412 (answers open where they were asked). Companion to ADR 421 (the boot screen).

Superseded in part by: ADR 424 (the nav card is now the compact nav).

## 1. Context

A page was a long column of rows with a ruled heading between its sections. Where one section ended and the next began was a thin line; the flat tab bar listed some views by icon and hid the rest behind the main menu; and an ask raised on one page (for example Mission Control's "ask claude -p for guidance") was drawn in full on every page you moved to, above the content, with a Yes button that answered a question you were no longer looking at.

## 2. Decision

**Cards.** Every section of a page, its header and the rows after it, is drawn in its own rounded, bordered box, so the groups of a page are obvious and a page reads as a short stack of units.
- Views are unchanged: `rule` and `section` mark the header elements they build (by identity, in `views/marks.ts`), and a wrapper around the kit's Box (`withCards`, `views/card.ts`) regroups any column that holds headers into one card per header. The wrapper sits inside the attention kit (ADR 412), so a confirm or an answer is still placed inside the card that holds the clicked row, right under it.
- A card spends two columns on its border and two on its padding. The page is drawn with `columns` narrowed by `CARD_COLUMNS` (4), and pictures are drawn to that width (`picturesOf`), by the render and by the frame loop alike, so nothing a view clips to its width overflows the frame.
- Cards are drawn when the page is at least 60 columns wide and the pane is not a compact inline one (its few rows go to content), and not in the plain-text dump (`/ruflo dump`).
- The welcome strip and the gaps above the nav are dropped from pages in cards (they stay on the main menu); the rows go to the nav.

**A grouped nav.** In cards the flat tab bar is one bordered NAV card with a row per group of the main menu (Swarm, Mind, Safety, Network, Tools), every view a button with its hotkey and the open one marked.
- Every view is a click from every page. A hotkey is given only to the views that had one in the flat bar, so no new key can collide with a page's own.
- Big groups are split into rows of at most six, so names stay readable: `auto` spells the richest form (full names, then short names, then icons) whose widest row fits the page; `icons`, `brief` and `full` still force a form.

**Asks stay on their page.** A pending ask records the page that raised it (`Pending.view`). There it is drawn in full as before. On any other page it is one line, "An ask is waiting on Missions: …", with **Go there** and **Cancel (n)**, and no Yes button; the footer says nothing twice. Headless `/ruflo yes` and `/ruflo no` are unchanged.

**Boot log completeness.** The boot log (ADR 421) has one line for every view but the menu (it was missing the Plugin Catalog); a spec keeps it so.

## 3. Alternatives considered

- **Converting each view's `rule` calls to a `card()` call.** Rejected: 112 call sites in 30 files and every one a chance to break a confirm's placement; marking the headers changes two functions.
- **Wrapping the finished body after it is built.** Rejected: it would read the engine's element shapes and run after the attention kit placed its panel, so a confirm could land outside its card.
- **Giving every view a hotkey in the nav.** Rejected: letters like `d`, `s` and `f` are already a page's own keys.

## 4. Consequences

Pages are taller by two rows per card; a docked cockpit (the full terminal height) absorbs that, and a compact inline pane keeps its plain layout. The nav is five to seven rows instead of three, paid for by the dropped welcome strip. An ask raised on one page and forgotten is a one-line reminder everywhere else, not a question that follows you.

## 5. Tests

- `tests/card.spec.ts` (pure): a column of headers is regrouped into one bordered card per header, the spacer above a header is dropped, a column with none is left as it was, cards only where the width and pane allow, every view but the menu is in exactly one nav group, and the boot log has a line for every view but the menu.
- `tests/missions.test.ts` (kit): an ask raised on Missions shows in full there, as a one-line pointer with Go there and Cancel on Swarm, and in full again after Go there; the nav groups are on the page.
- The existing kit and live-smoke suites pass with cards on (every view draws, every button sweep runs), including the animation frame loop, which caught a width mismatch while this was built.
