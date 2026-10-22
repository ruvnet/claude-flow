# ADR 420: A tool-coverage audit of the whole console, and a live smoke that cannot pass on nothing

Status: Accepted

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `scripts/e2e-smoke.sh`; the README tour GIF (`docs/assets/ruflo-console-tour-9x11.gif`).

Extends: ADR 407, ADR 411 (the plugin map), ADR 413 (the regression system), ADR 419 (the first audit).

## 1. Context

ADR 419 audited the Memory Lab and Automation. The roadmap still listed dedicated surfaces for federation and connectors, for agents and runtimes, and for the domain plugins. Before building any, every MCP tool name in `v3/@claude-flow/cli/src/mcp-tools` was compared with the tool names the console's hooks reference.

## 2. Audit

A tool name that is not referenced is not necessarily unreachable: autopilot, swarm, hive-mind, claims, hooks, memory, config and metaharness are driven through the `ruflo` CLI commands (`ruflo autopilot status`, `ruflo swarm init`, and so on), so a name search reads them as missing when they are covered. What remains, after taking those out:

| Family | State |
|---|---|
| federation, x_federation, managed_agent, terminal, github, analyze | Fully reached (the two exceptions below are deliberate) |
| `federation_bbs_human_join`, `x_federation_invite_mint` | Deliberately not offered: each mints a bearer secret, which the console never shows (ADR 417); the invite row types its command into the terminal |
| `wasm_agent_*` (13 of 14), `browser_*` sessions | Not reachable through `mcp exec`: these tools keep their agents or sessions inside the MCP server process that answers, and `mcp exec` starts a fresh process per call, so an agent created by one call is gone for the next. The console reaches what is stateless (the gallery, list); the rest belongs to a long-running MCP connection, which Claude Code already has |
| `agenticow_speculate/ingest/query`, `transfer_store-*`, `daa_workflow_execute`, `ruvllm_*` adapt/route | Gated or spending (model or network calls); reached from the Launch rows and the Plugin Catalog, which ask first |
| `agentdb_feedback/batch/*-delete`, `memory_*` raw store and delete | Covered by the Memory Lab's own entries and the learning loop; the deletes are terminal-only (ADR 419) |
| `business_pod_*`, the domain plugins (iot-cognitum, market-data, music, neural-trader) | Catalog-only by design (ADR 411): device writes, spend, or live trading, never from a button |

Conclusion: there is no further tool family worth a new surface. The plugin map already places every plugin directory, enforced by `plugin-coverage.spec.ts`.

## 3. Decision

1. **No new surfaces.** The audit is recorded here so it is not repeated.
2. **The live smoke is fixed.** `scripts/e2e-smoke.sh` had three defects that made it pass or fail for the wrong reasons:
   - it captured each view to `$OUT/../screens/<id>`, outside the run directory, so every capture was lost and every "draws" check failed;
   - its "no render error on screen" check passed when the capture did not exist (a grep on a missing file finds no error text), so a missing capture looked healthy; a missing or empty capture is now its own failure;
   - the Terminal and Skills views hold a focused field, so the slash commands typed after them reached the view and not Claude's prompt, and four later views failed to open; Escape is sent first.
   Run live against Claude Code 2.1.287 with the installed 0.21.0 build, all 28 views draw and no hook failure is logged.
3. **The README tour is a full-screen 9:11 GIF**, recorded from the installed plugin cache (not a worktree) in a 190x52 terminal with `RUFLO_CONSOLE_PANEL=command` (so `/ruflo` opens the cockpit and the dial-up boot plays on camera) and `RUFLO_CONSOLE_COLUMNS=100`. At that width the cockpit docks beside Claude at the full terminal height; the frames are rendered with `agg` and cropped to the dock (1237x1512 px) and scaled to exactly 1080x1320. Pages are opened by typing their `/ruflo <page>` command into Claude's prompt (every page, 26 of them, in order, on the grey theme), so a later hotkey never types into a field, and the Missions goal is typed into the cockpit's own field with the guidance confirm cancelled by click. An earlier attempt in a 96-column terminal seated the cockpit inline above Claude's prompt, where the layout caps its height near 30 rows, so it filled only half the frame; the wide split tour stays in `docs/assets/ruflo-console-tour.gif` and is linked from the README.

## 4. Alternatives considered

- **A WASM-agent surface backed by a persistent MCP connection.** Rejected for the console: it would need a second long-lived server beside the one Claude Code already runs.
- **Treating the smoke's SKIP-without-credentials as enough.** Rejected: a smoke that can pass without capturing anything is worse than none.

## 5. Safety

The smoke and the recording copy the person's Claude login (`~/.claude/.credentials.json`) into a throwaway `CLAUDE_CONFIG_DIR` with mode 0600 and shred it on exit; they never point the real `~/.claude` at a test, take no model turn, and write no ruflo state.

## 6. Tests

`RUFLO_E2E_LIVE=1 bash plugins/ruflo-console/scripts/e2e-smoke.sh` (28 views, plus the debug-log check): 0 failures after the fixes. Without `RUFLO_E2E_LIVE=1` it still prints SKIP and exits 0, which `smoke.sh` step 15 checks.

## Amendment (2026 10 03): the README walkthrough is the narrow cockpit

GitHub shrinks the README GIF to the reader's screen width, so a 126-column cockpit is unreadable on a phone. The README now leads with `docs/assets/ruflo-console-walkthrough.gif`, recorded from the narrow cockpit (60 columns, a 40-row pane, 22 px type, short captions, cropped to the cockpit and to above Claude's own prompt lines, 776 x 1018), and links `ruflo-console-walkthrough-wide.gif` (the wide cockpit, where each icon spells its word). Both are recorded from a live pane with an isolated config and a trimmed read-only copy of the marketplace (so Plugins and the Catalog have content; nothing is installed), running the committed code of the release; no model turn is made. Watching them found defects no spec had: see the last amendments of ADR-430.

## Amendment (2026 10 03, 0.26.1): near-square, the whole boot, quicker between pages

The README walkthrough is recorded from a 78-column, 32-row cockpit (a 974 x 986 frame: near-square, and still large enough to read on a phone), in which the boot's whole uplink now draws (it had fallen back to the old plain log in the 60-column frame: ADR-432 section 7). Transitions between pages are about half as long (the walkthrough runs about 100 s, from 150), while the boot, the menu's entry and the refresh replay keep their full length.
