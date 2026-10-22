# ADR 421: The boot screen brings every area online

Status: Accepted (ships in ruflo-console 0.22.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/gfx/boot.ts`, `hooks/views/frames.ts`, `hooks/state.ts` (`BOOT_MIN_MS`, `BOOT_MAX_MS`), `tests/diagrams.spec.ts`.

Extends: ADR 407 (the BBS look and boot). Companion to ADR 420 (the tour GIF).

## 1. Context

The boot screen was a modem dial-up (`ATDT`, `CONNECT`), the neon sign striking up, a handshake line and a loading bar, drawn into a Raster about 19 rows tall. In a tall pane (a docked cockpit is the full terminal height, 50 rows or more) the other two thirds stayed empty for the 3.2 seconds it played, and it said nothing about what the console is. Someone opening it for the first time saw a logo, then a menu.

## 2. Decision

Keep the dial-up and the sign, and add a **boot log** under them that brings every area of the console online:

- 26 areas, one per view but the menu, in menu order (Missions, Overview, Swarm, Hive-Mind, Claims, Approvals, Automation, Learning, Neural, Vector Lab, Memory Lab, MetaHarness, Self-Evolution, Security, Federation, x.ruv.io, Plugins & Mods, Skills, Plugin Catalog, Dev Tools, Cost & Budget, Timeline, Events, Performance, AI Terminal, Settings), each with a few words on what it is, then a `READY` line.
- One area starts every 120 ms: `[ .. ]` while it starts, `[ OK ]` once the next has begun. The log starts at 1.5 s, after the handshake line is typed.
- The log fills the pane: `bootPicture` takes the pane's body rows (`state.pane.rows`) and the log uses every row under the sign. In a short pane it scrolls, the newest lines in view and the oldest gone; with no rows known it is the sign alone, as before.
- The loading bar now also follows the log, so it moves steadily and reads 100% as `READY` appears, not only when the first reads land.
- The boot plays for at least 5.4 s (was 3.2) and at most 8 s (was 6): long enough for the whole log, still ending by itself, still only with the bbs look and the boot option on. The boot picture is up to 90 columns wide (was 72).

## 3. Alternatives considered

- **A longer sign animation.** Rejected: more time on the same picture; the log says what the console is.
- **Drawing the log as text rows beside the Raster.** Rejected: the boot owns the pane, and one Raster keeps the dial-up, sign and log on one clock.
- **Reading the area list from the view table.** Deferred: the list carries a few words per area that the view table does not hold, so it is its own short table (`BOOT_MODULES`); a test checks every entry appears in order, and another that there is one line for every view but the menu.

## 4. Consequences

A first open now shows what is in the cockpit while it loads. A recording gets a boot that fills a full-height dock. The boot is five seconds longer in the worst case; the boot option still turns it off.

## 5. Tests

`tests/diagrams.spec.ts`: nothing logged before the handshake; `[ .. ]` then `[ OK ]` at the right times; every area present in order with `READY`; a short pane shows the newest lines; no rows given gives the sign alone; the span is 5.4 to 8 s.
