# ADR 433: The main menu's entry, and a page title that strikes in when you switch pages

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Scope: `plugins/ruflo-console`: `hooks/menu-entry.ts` (new), `hooks/views/menu.ts`, `hooks/gfx/pictures.ts` (`titlePicture`), `hooks/controller.ts`, `hooks/state.ts` (`pane.menuAtMs`, `pane.viewAtMs`), `hooks/views/frames.ts`, `tests/menu-entry.spec.ts` (new).

Extends: ADR 430 (the menu), ADR 432 (the boot uplink).

## 1. Decision

- **Menu entry, about 6.9 s, after the boot** (and again when Refresh restarts the console): the four group cards light up one after another (a card's border is dim until its turn), each title scrambling into place and its entries locking in one by one (key chip and label scrambling, not yet a button, for 350 ms), then the status bar and the prompt. Badges and the status facts appear last. It plays only in the BBS look with the boot option on. The frame loop re-renders the menu while it plays and stops when it ends.
- **Nothing below moves.** An entry that has not come yet is a blank row of the same height, so a card has the same rows at every age (tested on the element tree).
- **Page titles strike in** for 1.2 s whenever a page is switched to: the letters appear left to right, a bright edge leading and block noise ahead of it. A picture, so the frame loop animates it; with fps 0 it is the still title.
- Motion is a function of the age and a hash, never of a random number.

## 2. Not proven

Seen only as text and element trees, not on a terminal. A press on an entry while it is still scrambling does nothing (it is not a button yet); the hotkeys are handled elsewhere and work.

## 3. Amendment: ASCII glitch in the strike-in

Behind the leading edge, a share of the settled letters (4%, fading to none by the end; first tried at 14%, too loud) flip for a frame to an ASCII character (`#%&@/\|<>=+*`) in pink or cyan, and a title row now and then slips sideways one cell (about one frame in sixteen) and snaps back. Hash-driven, so reproducible; none once the 1.2 s are over (spec: glitch characters appear during the entry and the finished title has none).

## 4. Amendment: the menu banner, and one shared strike-in

The strike-in and its glitch are one function (`strikeIn` in `gfx/pictures.ts`) used by the page titles and by the menu's RUFLO banner. Headers take one age: the time since the page was switched to, or since the menu's entry began (so the banner and the title strike in at launch too), whichever is more recent. With fps 0 they are the still headers.

## 5. Amendment: an occasional glitch after the entry

Once the 1.2 s entry is over, the headers (page titles and the menu banner) glitch now and then: a quarter-second burst about every eight seconds, at a hash-chosen moment in each 8 s slot, in which about 3% of cells flip to an ASCII character and a row may slip a cell. A function of the animation clock alone, so the still header (fps 0, t = 0) is never glitched. Spec: bursts occur, are short (fewer than one frame in eight glitch), and never in the still frame.
