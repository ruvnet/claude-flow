# ADR 432: A data-driven cyberpunk boot log, and Refresh that replays it

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/boot-facts.ts` (new), `hooks/gfx/boot-cyber.ts` (new), `hooks/gfx/boot.ts`, `hooks/views/frames.ts`, `hooks/bindings.ts` (`restart`), `hooks/views/pane.ts`, `tests/boot-cyber.spec.ts` (new).

Extends: ADR 426 (the self-check the log reports), ADR 430 (the menu's look).

## 1. Decision

- **The log under the sign is an uplink drawn from real data.** A title strip scrambles into place (`RUV.NET // RUVECTOR CONSTELLATION`, rUv, the console version and git build); the ruvector constellation (ruflo, agentdb, sona, ruvector, rvf, ruvllm, rulake, ruqu, rvdna) is drawn as stars and lines; a signal row cycles the project's real numbers (agents, claims, tasks, patterns, plugins, missions); a scan grid lists the 26 console areas with the self-check's verdict; READY closes it.
- **Nothing is invented.** A star is lit only if `boot-facts` found evidence (the CLI version probe, the memory and intelligence probes, the installed-plugin list, the neural and SONA files); a dark star says why. A data pulse runs only along a line whose two ends are both lit. READY says `ALL STARS ALIGNED` only when every star is lit and every area verified; otherwise it counts failed areas and dark stars.
- **Reproducible.** Motion is a function of the age and a hash, never `Math.random`.
- **An easter egg** sits mid-boot (2.4 to 3.8 s): a ghost signal of the binary for `rUv` that decodes byte by byte.
- **Fallback.** Under 64 columns, or without room for the title, scan grid and READY, the plain log is drawn as before.
- **Refresh restarts the intro.** The footer Refresh button and the `r` key now reset the boot clock (so the intro plays again, in the BBS look with the boot option on) and then do the full re-read. The Cost page's own "Refresh cost" button and `/ruflo refresh` stay plain re-reads.

## 2. What this does not prove

Seen only through `Grid` text in specs, not on a terminal. The constellation's evidence is by plugin name (`ruflo-ruvector`, `ruflo-rvf`, `ruflo-ruvllm`, `rulake*`, `ruqu*`, `rvdna*`), so a package installed another way reads as dark.

## 3. Tests

`tests/boot-cyber.spec.ts` (8): evidence lights stars, READY matches the evidence, the egg's window, determinism and scramble, the narrow fallback, and the boot replaying from a reset clock.

## 4. Amendment: motion that stays true to the data

Lines draw outward over 350 ms once both their stars are up; a lit star flashes on with `✺` as it locks; a dark star flickers as if trying to light, then settles as `☆` (it is never drawn lit); an area's name is cyan while it is scanned and white once read; after the scan a wave of light runs across the lit stars only. Specs: lock-on only for a lit star, no lit glyph with no evidence, lines drawn progressively.

## 5. Amendment: no modem dial-up

The first two boot rows (`ATDT ruflo.local   RING… RING…` and `CONNECT 115200 / ARQ / V.42bis`) are gone, along with the "CONNECT" in the no-picture fallback. The sign starts to strike at 400 ms instead of 900, since there is no line to wait for, and the boot log gains the two rows. A spec checks that no frame of the boot shows them.

## 6. Amendment: a border round the whole animation area

The boot's neon sign sits inside a double-line border (`╔═╗ ║ ╚═╝`) that encloses the whole animation area, the brick wall included: it runs along the edge of the picture, with a row above the sign and a row below it (the sign moves down one row; the boot's fixed rows are two more than before). It is dim until the sign switches on, then a run of light goes round it clockwise from the top left: a white leading cell, ten cells of blue behind it, then pink. Once the run has gone all the way round, the whole border is one pink and stays so. Specs: the four corners at the picture's edges at 90, 60 and 44 columns; dim before the sign; white, blue and pink mid-strike; exactly one colour (pink) when complete and later; removing the call or the single-colour rule fails them.

## 7. Amendment: the whole uplink in a narrow or short pane (0.26.1)

The uplink needed 64 columns and 33 rows, so a narrow cockpit (the README's phone-sized walkthrough) fell back to the old plain log: no title strip, constellation, scan grid, easter egg or READY line. It is now drawn from 48 columns. The constellation has a compact five-row form (the same nine stars) when the pane lacks the rows for seven, and is left out only when it is shorter still (the title, signal row, scan grid and READY are always there). Every line of text picks the longest of several forms that fits the width (the title strip, the easter egg, the READY sentence), so nothing is cut mid-word. Specs: the whole uplink at 48, 60 and 72 columns with no line wider than the pane; the compact constellation in a shorter pane and none in a shorter one still; ALL STARS ALIGNED whole at 60 columns; the plain log under 48.
