# ADR 430: The main menu: an accent for each group, key chips, live badges and a palette strip

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/menu-style.ts` (new, pure), `hooks/views/menu.ts` (`GROUPS` exported; the group box, the key, the badge, the strip), `tests/menu-style.spec.ts` (new).

Extends: ADR 407 (the BBS look and its Main Menu), ADR 429 (the band, whose facts the badges share).

## 1. Context

The Main Menu is the first screen in the BBS look: five bordered groups, each a title, short sub-sections, and entries as a key and a button, under the mission strip and a red status bar. Every group was drawn the same, in one grey border and the one title colour, so the eye had nothing to find a group by, the keys (the fastest way in) looked like part of the label, and nothing on the menu said where anything was going on: approvals waiting, a mission under way and 235 high findings looked the same as an empty project.

## 2. Decision

In the BBS look:

- **An accent for each group.** Its border, a solid title bar (dark ink on the accent) and its key chips are in it: SWARM amber, INTELLIGENCE cyan, SAFETY & OPS red, NETWORK & EXTEND green, TOOLS violet.
- **Key chips.** The key of an entry is a solid chip in the group's accent, ` 1 `, instead of `(1)` in the label colour, so the keys read as the commands they are.
- **A palette strip** of the five accents across the top, as a BBS drew its palette.
- **Badges, in both looks.** An entry carries a short badge when there is something to say about the page it opens: approvals waiting (loud), alerts (`⚠ n`, loud), the mission's progress (`3/15`), busy agents (`▶ n`), claims, high or critical findings (`🔒 n`, loud only when one is critical), spend from a cent, a running terminal, an update not yet taken (`⬆ 0.27.0`, loud). They come from the facts the band above the prompt reads, so the two cannot disagree, and an entry with nothing to say gets none, never a zero.

The plain look keeps the theme's colours, with no accents, chips, strip or title bars, and gets the badges in the theme's warn and info colours.

Nothing moves: every part is static, so `fps: 0` and a terminal that redraws slowly lose nothing.

## 3. Colours

Every colour this adds is a step of the xterm 256-colour cube or its grey ramp, so it renders the same where a terminal has no truecolor, and in tmux (the console's Rasters render in 256 colours there). The ink on an accent is `#1c1c1c`; the spec holds its contrast to 4.5 against each of the five, which is the WCAG floor for text a person must read. The status bar's two colours, which were off the palette (`#8b1a1a` and `#ffd319`), moved to the nearest steps (`#870000`, `#ffd700`).

## 4. Alternatives considered

- **A cursor that moves over the entries with the arrow keys, the selected row filled.** Not done: it is a change in how the menu takes keys, with its own state and tests, and the keys already reach every page. It is the next thing to try, not part of this.
- **A gradient across the title bars.** Rejected: a Text takes one colour, so a gradient is a run of Texts per bar, for a small gain over a solid bar, and it breaks when the width changes.
- **Theme colour names for the accents.** Rejected: a theme can make them near each other, and an unknown name can make the host refuse the tree (ADR 429). The palette's own hexes are the same on every theme.
- **Showing a zero for an empty badge.** Rejected, as on the band: a part with nothing to say is left out.

## 5. What this does not prove

It has not been seen. The spec holds the colours, the contrast and what a badge says; the layout is in the kit tests (which need the `claude-code/testing` host package and run in CI) and the real screen. Two things to look at first: a group's title bar and chips against a **light** terminal background (the bar and chips carry their own ground, but a badge and the sub-section rules are drawn on the terminal's), and the width of the longest entry with its badge at the narrowest two-column pane.

## 6. Tests

`tests/menu-style.spec.ts` (9): every group has an accent and no accent is without a group; the palette is the accents in menu order; every colour is on the 256 palette; the ink on each accent has contrast 4.5 or more and no two groups share a colour; the spec's own checks fail on a colour off the palette and on ink that cannot be read; an empty state has no badges; approvals and alerts are loud and claims are information on the pages they open; spend shows only from a cent, findings only when high or critical (loud only for critical), a running terminal, and an update not yet taken; and only pages that exist are badged.

## 7. Amendment: the strip moves, and the search finds what is on a page

- **The palette strip is animated.** It is now a picture (`palettePicture`, registered by `picturesOf` for the menu in the BBS look), not a row of Texts: one block of each accent across the width and a band of light that sweeps along it and starts again, about 28 cells a second, three cells a frame at the default 8 fps. Being a picture, it moves with the frame loop that already runs for the menu's other pictures, and costs one element, not one per cell. At `t` = 0 the light is off the strip and the cells are exactly the accents, so with `fps: 0` it draws that still strip; a surface that cannot draw pictures gets the Text strip as before. It is decoration and carries no data.
- **The menu lists every page, but the search finds only pages.** Checked: all 26 pages and the three commands (palette, help, log off) are on the menu, none missing and none unknown. The menu prompt and the nav search match a page's name, key, group and one-line description, so a feature that is a section of a page (sentries, the loop manager, Updates in Settings, AIDefence) was not found by its own name. The descriptions of Security, Settings and Automation now name them, and `tests/nav-state.spec.ts` holds that searching for `sentries`, `doctor`, `aidefence`, `updates`, `loops`, `autopilot` and `kanban` finds the page each is on (which found one more gap, `aidefence`, when first run).
- **Tests:** `tests/diagrams.spec.ts` (4): one row of blocks, exactly the colours at rest, a band that brightens only the cells it is on, moves about three cells a frame and starts again, and survives a tiny width and no colours; `tests/pure.spec.ts`: the strip is on the BBS menu only, as wide as the menu's rows, and still at fps 0.

## 8. Amendment: the strip, the prompt, the footer and the sections wear the same design

What the owner pasted from the menu: `test ▯▯▯▯▯▯▯▯▯▯ 0/15` over `nothing ready ⏸ pause`, then `T - 01:00`, then `(1:1) (ruflo: ruflo): a key or a name, then Enter (? for help)`, then a footer whose buttons ran off the edge (`keys of…[ Palette ][ Actions ]…[ Help ][`). The last line of the message was cut off at "make the sub sections use a similar design for f…", so "sub sections" is read here as the sections of every page, not the menu's sub-sections only; if it meant something else (a footer, a form), say so.

- **The Mission Control strip is a card** in the BBS look: a solid amber title bar, the goal with a coloured bar and a percentage, a status line, and the buttons under it. The plain look keeps its lines. Every key is the one the plain strip had (`menu-goal`, `menu-mc-next`, `menu-mc-pause`, `menu-go-missions-top`).
- **"nothing ready" said four different things.** `stripStatus` now says which: `no tasks yet: plan the goal first`, `✔ every task is done`, `⏸ paused: resume to carry on`, `◐ running t4 …`, `▶ next t1 [research] …`, or `waiting: the next task needs one that is not done`, in a colour for each. Its title budget follows the real prefix, which a spec found it did not at first (the line could overrun its width).
- **`T - 01:00` is gone.** It repeated the status bar's `Online 01:00`.
- **The prompt is in a box** like the cards (violet, the TOOLS accent), with the project and a `❯` as its label and a shorter placeholder. The plain look keeps `(1:1) (ruflo: project)`.
- **The footer fits.** It was a status text and seven buttons with no width budget, so below about a hundred columns the last buttons were cut in half. Each button now has a full label, a short one and a priority; `fitFooter` shows as many in full as fit, shortens the least important first (`Refresh` becomes `r`), and only then drops them, and a dropped button is kept hidden so its hotkey still works. In the BBS look the status is coloured (`[LINK OK]` green, `keys on` green, `keys off` amber).
- **Sections and cards wear the page's accent.** A page's section headers (the title, the rule, and the right-hand text) and the border of its cards are drawn in the accent of the nav group it is in, which is the colour of the menu group that lists it: Swarm pages amber, Mind cyan, Safety red, Network green, Tools violet. A spec holds that every nav group has one of the five accents, that every page in a group has it, and that it is the colour the menu gives the same page.
- **Tests:** `tests/footer-layout.spec.ts` (6: full when there is room, shortening in priority order, never wider than its room at any width, dropping the least important, hiding everything with no room, keeping the order); `tests/mission-strip.spec.ts` (7); `tests/menu-style.spec.ts` (12: now also the status tones and the nav accents are on the 256 palette, and agree with the menu).
- **Not seen.** A header's title is a Button, which cannot be coloured, so on a page the title keeps the theme's colour and only its rule, its right-hand text and the card border take the accent. The strip card, the boxed prompt and the footer's coloured status are in the kit tests (which need the host package) and have not been drawn.

## 9. Amendment: a chip is drawn inverse, not in fixed ink on a background

The owner reported that selecting `4: 📌 Claims` made the selected text disappear. That is the open page's chip, which ADR 430 drew as dark ink (`#1c1c1c`) on the accent as an explicit background. I could not see the screen, so the cause is not confirmed; the design had a failure mode that fits it exactly. Fixed ink is only legible if the host draws the background under it. If it does not, near-black text sits on a dark terminal and is gone.

Every chip is now drawn **inverse**: the accent is the text's colour and `inverse` is set, so the text takes the terminal's own background colour over the accent. Inverse cannot vanish, and where a host does not honour it the chip falls back to text in the accent colour, which reads on a dark terminal. This covers the menu's group title bars and key chips, the mission strip's title bar, the cost tags on run rows, and the nav's open page and open group. The `INK` constant is gone, so it cannot come back by accident.

What changes in the tests: the contrast check no longer measures dark ink on an accent (there is none); it holds each accent to a contrast of 4.5 as text on a dark terminal, the degraded case. And `tests/design.spec.ts` states the rule itself: rendering the menu, the nav card, the mission strip and the cost tags in the BBS look, no `Text` has a `backgroundColor` (checked by putting a fixed-ink chip back in the menu and watching it fail, naming the chip).

On a light terminal an inverse chip is the terminal's light background over the accent, which has weak contrast; the console's pages are designed for a dark terminal and this has not been looked at on a light one.

## Update 2026-10-08: the approvals badge counts only actionable rows (0.40.3)

The approvals badge on the menu, the band ("n to approve") and the change notices counted every row of the Approvals page, including a refused mod and a permission deny, which carry no approve or deny action. A single deny kept "1 to approve" up with nothing to press (#3920). The badge now counts `waitingApprovalsOf(state)`: rows with at least one action. The notice rows stay on the page, and its header names them apart (`1 to approve · 2 notices`). Regression test: `tests/approvals-badge-3920.spec.ts`.
