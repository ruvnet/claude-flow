# ADR 424: A compact nav: groups, one group's pages, and a search

Status: Accepted (ships in ruflo-console 0.25.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/nav-state.ts`, `hooks/views/nav.ts`, `hooks/state.ts` (`navPick`, `navQuery`), `hooks/bindings.ts`, `tests/nav-state.spec.ts`, `tests/nav.test.ts`.

Extends: ADR 422 (cards and the grouped nav), which this replaces for the nav card.

Superseded in part by: ADR 442 (the Plugins page sits in TOOLS, not NETWORK).

## 1. Context

The grouped nav of ADR 422 listed every page at once: a title row with the style chooser, then a row per group, nine rows in a bordered card at 100 columns. It was complete but long, and finding a page meant reading all of it.

## 2. Decision

The nav card is two or three rows.

- **Row 1:** `[0: 📟 MAIN]`, the five groups (SWARM, MIND, SAFETY, NETWORK, TOOLS) with the open page's group marked `[MIND ▾]`, and a 🔎 search field. Group icons appear only on a wide dock. Where the search field does not fit on the row (below about 100 columns) it takes its own row.
- **Row 2 (and 3):** only the pages of the open group, as `[k: 📟 NAME]` with the open page marked; a group of nine is two rows. Names are spelled as wide as the row allows (full, then short, then icons), or as the person's Settings choice.
- **Groups.** Clicking a group chip shows that group's pages while the page stays open (`navPick`, tied to the page it was made on: once the page changes the nav follows the page's own group again).
- **Search.** Words typed in the field list the pages whose name, group or description holds every word, names first, at most twelve, with a count ("3 found for “lab”") and a ✕ to clear; one match opens that page; no match says so.
- **Hotkeys are unchanged and global.** A page's number or letter is the one it had in the flat tab bar and works from every page: the pages that are not showing are in the card as hidden buttons (`display: none`), which the engine still arms.
- **Nav style** (auto, icons, brief, full) moved off the card to Settings, where it already was a choice, so the card has no chooser row. `auto` picks the richest form that fits the rows it is showing.
- The flat tab bar stays for compact inline panes and the narrow layout.

## 3. Alternatives considered

- **Hiding the hidden pages' hotkeys with their buttons.** Rejected: number keys that stop working from another group's page would be a regression for people who navigate by key.
- **One flat row of 26 icons.** Rejected: that is the old bar, which hid most pages behind the menu.
- **Search that filters live as you type.** Deferred: the field submits on Enter; live filtering needs a change event the pane's Input does not give.

## 4. Consequences

The nav went from nine rows to three at 100 columns (four at 80), so a page starts higher on screen. Every page is at most a group click, a search, or a key away. The search is also how someone who does not know the group names finds a page.

## 5. Tests

- `tests/nav-state.spec.ts` (pure): the group of a page and the group shown (a pick holds only on its page; an agent drill-down keeps its source page's group); at most six pages a row; the search finds by name, group or description, needs every word, ranks names first, never lists the menu; the actions (a group pick, a one-match search opening its page, clear).
- `tests/nav.test.ts` (kit): the five group chips and the Main button are there, the open group is marked, every page including the other groups' is a button, a chip shows another group's pages, the search lists matches with a clear button and says when none match.
- Live: from Swarm, `7` opened Learning and `b` opened Hive-Mind though neither was showing, in the real Claude Code UI; the live smoke draws all 27 pages.
