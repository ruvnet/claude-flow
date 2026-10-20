# ruflo-console

ruflo's cockpit inside Claude Code: the `/ruflo` command, its pages, and a band above the prompt. It reads ruflo's own files; anything it cannot measure reads `n/a`. Design notes: ADR-407 (cockpit), ADR-448 (the Room), ADR-446 (plugin mods).

## Drive the console from the command line

`scripts/drive.sh` runs the console through its own model tools (`console_open`, `console_state`, `console_set`, `console_run`) from a real headless Claude, prints what each tool answered, and can assert on it, so a dev loop or CI job can check that a UI shows something.

```bash
RUFLO_E2E_LIVE=1 bash plugins/ruflo-console/scripts/drive.sh \
  --expect 'Waiting for a yes' \
  "$PWD/plugins/ruflo-console" read "Open the Room and quote back what is waiting for a yes."
```

Output is one `CALL <tool> <input>` and one `RESULT <tool> <text>` line per console call (each result cut at 4000 characters), then `COST <usd> CALLS <n>`, then one `EXPECT ok|FAIL /regex/` line per `--expect`.

| Exit | Meaning |
|------|---------|
| 0 | a console call ran and every `--expect` matched (or the run was skipped, see below) |
| 1 | no console tool call ran |
| 2 | usage error: bad level or an invalid `--expect` regex |
| 3 | at least one `--expect` regex (case-insensitive, repeatable) matched no `RESULT` |
| 4 | `CONSOLE_DRIVE_INSTALL` was set and the marketplace add or install failed |

- **What it spends:** about $0.10 per run with haiku, hard-capped at $0.40 (`--max-budget-usd`). Use one to three runs, not a sweep.
- **Isolated config:** the run uses a throwaway `CLAUDE_CONFIG_DIR` seeded with the level you ask for and confirm mode `auto` (your login is copied 0600 and shredded on exit), because `RUFLO_CONSOLE_CONTROL` can only lower the saved setting (ADR-450 T12) and your own saved mode would otherwise decide what a drive does.
- **Why the level is capped:** the level is `read`, `write` or `manage`; `full` is rejected (exit 2). The run happens in a scratch project (`mktemp -d`), with Bash, Write and Edit disallowed, so a drive can never spend money or delete anything.
- **Seeding:** `CONSOLE_DRIVE_SEED=<dir>` copies that directory into the scratch `.claude-flow/` first, for example a `claims/claims.json` to assert the claims view shows it.
- **Skips cleanly:** without `RUFLO_E2E_LIVE=1` or a `claude` binary (on `PATH` or `$CLAUDE_BIN`) it prints `SKIP` and exits 0, so it is safe to call from CI.
- **Extra plugins:** any further arguments are added as `--plugin-dir`. That loads a plugin but does not install it, so `claude plugin configure` cannot see it.
- **Installed plugin (for option rows):** `CONSOLE_DRIVE_INSTALL=<marketplace-dir>:<plugin>@<marketplace>` registers that directory as a marketplace and installs the plugin (user scope) inside the throwaway config only, then runs the drive; the Settings view can then read the plugin's options. Your real `~/.claude/plugins` and saved console settings are never touched, and `claude plugin update` is never run. Prints `INSTALLED <id>`; a bad value exits 2, a failed install exits 4.

```bash
CONSOLE_DRIVE_INSTALL="$PWD:ruflo-mods@ruflo" RUFLO_E2E_LIVE=1 bash plugins/ruflo-console/scripts/drive.sh \
  --expect 'Hide unused agent types' "$PWD/plugins/ruflo-console" read "Open view settings with chip mods, then console_state, and quote the ruflo-mods option rows."
```

## Your project's ADRs (ADR-480)

**TOOLS → ADRs** manages the Architecture Decision Records of the project you run Claude Code in (not ruflo's own).

- **Finding them.** The console looks for `docs/adr`, `docs/adrs`, `doc/adr`, `adr`, `docs/architecture/decisions`, `docs/decisions` and `architecture/decisions`, or the folder in *Settings → ADR folder*. A folder that is a link is never read. With none, **initialise ADRs here** asks first, then creates the folder and `0001-record-architecture-decisions.md`; nothing is overwritten.
- **Reading them.** MADR front matter, Nygard / adr-tools `## Status` sections (`Superseded by [5. …](0005-….md)`), ruflo-style `Status:` lines, log4brains and plain markdown with no status all parse; a file that does not parse still lists. Filter by status, words and scope; the detail shows links both ways, the decision, and the missions it is attached to; the health strip is the lint.
- **Writing them.** *propose* takes the next number and the style your ADRs already use (override in Settings: ADR style, ADR file name pattern). Accept, reject, deprecate or supersede from a record's detail. Each shows the exact file and the diff, writes only that on your Yes, and leaves a file that changed since alone.
- **Missions, loops, swarms.** Attach ADRs to the active mission (the page suggests some from the goal's words; you decide). Claude's mission context, each task's instruction and spawned swarm agents (ruflo-swarm 0.3.5) are told the accepted decisions, masked and capped. At *verify*, changed files are compared with the paths the attached accepted ADRs name: a warning in the mission record. **That compares paths only. It does not prove a change follows or breaks a decision, and it never blocks.** When a mission is done, *draft an ADR from this mission* prepares a proposed record from its goal and tasks; the decision is yours to write.
- **For Claude.** `/ruflo run adr-propose <title>`, `adr-accept <n>`, `adr-supersede <old> <new>`, `adr-attach <n>` and the rest are palette entries, so Claude reaches them through `console_run` at the *write* control level (reading the page is *read*); a change still waits for your Yes on the diff.

## In a terminal of its own: `ruflo tui` (ADR-489)

The same views the mod draws, on five pages (Overview, Cost, Swarm, Events, Missions), drawn by a small standalone terminal host instead of Claude Code, and a sixth, AI, that asks Codex or OpenRouter. The five are read-only; the AI page shows a card of exactly what would be sent and sends only after a `y`; `npx ruflo tui` (the `ruflo` package and `@claude-flow/cli` carry the bundle).

```bash
npx ruflo tui                    # interactive: 1-6 or o c s e m a pick a page, Tab/Shift-Tab cycle, j/k, PgUp/PgDn, g/G, r refresh, q quit
npx ruflo tui --view swarm       # start on the Swarm page
npx ruflo tui --view ai --model openai/gpt-4o-mini --max-spend-usd 0.1   # ask OpenRouter on a cheap model, stopping at $0.10 reported (key in $OPENROUTER_API_KEY, never shown)
npx ruflo tui --no-ai            # without the AI page
npx ruflo tui --plain | head -40 # one plain frame, exit 0: for scripts and CI
npx ruflo tui | cat              # no terminal and no --plain: a one-line hint on stderr, exit 2
```

From a checkout, build the bundle first: `node plugins/ruflo-console/scripts/build-tui.mjs`. Room is not in the terminal (it is a message box and Claude sessions). **AI page:** Ctrl-T picks Codex or OpenRouter, Enter shows the card, `y` sends, `n` or Esc cancels, Ctrl-S stops a running answer, Esc hands the keys back to the page bar. Codex runs read-only and only as the pinned 0.162.0 release (never `current` or PATH); OpenRouter goes to `openrouter.ai` over https, or to a host a `--convo-targets` entry names (`endpoint:<name>=<https-base-url>|<KEY_ENV>|<model>`); a key is read by its variable name and never drawn. Details and what is not done yet: ADR-489 section 4. A terminal narrower than 60 columns gets a short page bar, and under 40 a one-line notice.

## Toasts (ADR-477)

Settings → Interface and updates → **Toasts** sets what the ruflo plugins may show over the transcript: `all`, `important` (warnings and errors) or `off`, with a mute chip each for `console`, `swarm`, `protector` and `mods`. It is kept in the console's store and mirrored to `.claude-flow/console/toast-prefs.json`, which the other plugins read. Every toast, drawn or not, becomes an event on the Events page (`toast <source> <glyph> <text> [off|muted|deduped|…]`); the other plugins' digests are read from `.claude-flow/console/toasts/<source>.jsonl`, masked and capped. The console itself also toasts a mission that finishes (`ok`) or loses a task (`error`), and its update notes by level. Design and contract: [ADR-477](../../v3/docs/adr/ADR-477-mod-toasts.md).

## Room and Mods

Open it with `/ruflo room` (menu: Safety → The Room).

- **Waiting for a yes**: the one confirm that is pending, with the seconds left to answer it.
- **Needs you, Sessions, Preview** (ADR-486): approvals, questions, failures and finished work across Claude Code, Codex and Ruflo sessions, including ones started outside Ruflo; the sessions grouped by repository and worktree; and a preview of the one you pick (latest response, current tool, edited files, test result, cost labelled reported, estimated or unavailable). Discovery is local and read-only: no model call, no process, nothing woken (the one write is a four-count summary ruflo-mods can show). The Sessions list starts folded; jumping to a session from the queue opens it. A finished session leaves the queue only after its preview was drawn; a session whose identity is ambiguous goes to an *unassigned* bucket and raises nothing. Transcript text is never saved, never sent to a model and never included in a text answer. Options `sessionWorkspace` and `sessionPreview` (both on).
- **The feed**: events, Claude's console actions and what you said, newest first. Filter by who, search, pause, page back. **⛔ blocked** shows only what was refused or failed: Claude's actions the control log marked denied or error, and events that say denied. Press a line to open it; an event that came from a page of its own (swarm, claims, learning, plugins, missions) offers a jump button to that page.
- **Mods**: one line per plugin mod that has written `.claude-flow/<name>-mod/status.json`. Press a line for its detail: what it guards (the file's own `summary`), guard, calls, blocked, the *class* of its last refusal (`secret`, `destructive`, `path`, `network`, `policy`, `other`; the refused text is never kept), `modVersion`, session start, last write, file age, and a stale marker when the last write was an earlier session.

A status file is data, not instructions: it is size-capped, shape-checked (`version: 1` only), and every string is stripped of control and bidi characters and cut to length before it is drawn. `summary`, `modVersion` and `lastDenied` are optional; a mod that does not write them shows "not reported".

## Project Anatole in Security & Doctor

An optional **Project Anatole** section on the Security & Doctor page (key `u`) lists, runs and edits the `ruflo-protector` mod (ADR-453). Without the plugin it is one line: `claude plugin install ruflo-protector@ruflo`.

- **Reads** `.claude-flow/protector-mod/status.json`, `rules.json` and the last 200 lines of `alerts.jsonl` through the bounded, regular-file-only reader (a file over 64 KB is refused; every field is whitelisted and cleaned). It is labelled *reported by the mod, unauthenticated*: any process can write those files.
- **Shows** the mode, the baseline's maturity ("learning 62%"), open alerts by severity, blocked and `degraded`; one row per rule (OWASP refs, severity, an off · notify · block chip, hits and acked share over the last 200 alerts, "changed from default"); the open alerts with `ack` and `allow`. The Findings meter counts open alerts, labelled as Anatole's.
- **Runs** `/protector run` and `/protector replay` into the page's Result panel.
- **Edits** the mode (off, learn, notify, enforce) and per-rule modes through `/protector`; every change asks first and its confirm row starts with `Effect:`. `enforce` is declared an install-class action and `reset-baseline` a delete-class one, so Claude's console tools always wait for you on both (palette ids `anatole-mode`, `anatole-rule`, `anatole-ack`, `anatole-allow`, `anatole-reset`, `anatole-run`, `anatole-replay`).

## Orbital theme

An optional dark telemetry look inspired by compact system monitors: black panel background, square red borders, warm red headings, muted readable values and green health indicators. It uses the existing live views and command palette; no extra polling, simulated metrics or model calls. BBS remains the default.

Choose Settings → ruflo-console → Look → orbital, or run in your shell:

```sh
printf '%s\n' '{"look":"orbital"}' | claude plugin configure ruflo-console@ruflo --values-stdin
```

Reload plugins after changing the option. Select `bbs` or `plain` to restore those looks. A dark terminal background gives the closest match; terminal graphics and host controls keep their existing renderer. Narrow panes retain the existing responsive layout.

Orbital keeps the original Ruflo block mark visible after boot on every page, above navigation. Wide headers use an eight-row composition with a shaded block extrusion, moving highlight, rotating ASCII Earth and travelling scan. Smaller panes retain the original two-row block mark inside a compact header. The optional boot intro uses the same Earth rotation (one turn per 12 seconds), with actual self-check counts below it. It runs for 1.5 seconds when data is ready, at most 6 seconds while data is pending. Set `fps` to `0` for still headers and no boot intro. Existing frame scheduling stops motion in hidden or unfocused panes. The sweep and globe are decoration, not measured activity or a progress percentage.

Orbital adapts to the pane allocation. Below 48 drawing columns or 30 available rows, boot uses a compact check summary of at most nine rows. Failure totals remain near the top, with the first failing area shown when a third row fits. The persistent header uses its expanded layout from 78 drawing columns with eight available header rows. Short panes keep two rows; the native host's text-only mode below 44 pane columns retains a text Ruflo identity. Header width reserves the existing toolbar icon space and is capped at 120 columns. Resize dimensions are recorded before the header is mounted so the animation loop continues at the new size. The existing live topology remains in the Swarm page body; Theme Studio provides the decorative orchestration preview.

### Theme Studio

Open **Main Menu → Tools → Theme Studio**, the **Tools** navigation group, or `/ruflo themes`. Settings also links to the studio. Choose Classic BBS, Terminal plain or Orbital. Studio selections persist and override the plugin's configured look until **Use configured look** is selected.

Six bundled **Color presets** load with one click and persist across sessions. They retain the animated Ruflo header, globe, stars and topology at standard speed. Bundled presets do not consume the twelve custom theme slots. Every primary foreground role meets at least 4.5:1 contrast against its background; decorative shading may be dimmer.

| Preset | Palette |
| --- | --- |
| Arctic | Ice cyan, seafoam and deep navy |
| Synthwave | Orchid, mint and dark violet |
| Amber CRT | Warm amber, parchment and dark bronze |
| Emerald | Jade, pale green and forest black |
| Solar Flare | Peach, gold and dark terracotta |
| Moonlight | Periwinkle, silver and midnight blue |

Select a preset to load it immediately. Edit colors or motion and choose **Save and apply** to create a custom copy; bundled originals remain available. Portable version 1 JSON presets also load through **AI → Import theme JSON**, followed by **Save and apply**. **Use configured look** restores the plugin setting.

### Reproduce the theme workflow demo

The demo drives actual console view handlers through boot, Main Menu, all six presets, custom color and motion, save, fresh state restoration from a local JSON store, portable JSON import, reduced motion, and 80/116 column layouts. It checks each transition and writes `receipt.json`. This is a renderer integration demo, not a native Claude host recording: other console actions are not exercised, the FPS setting is changed by the harness, and no AI provider is invoked.

From the repository root, with Node:

```sh
npx tsx plugins/ruflo-console/scripts/theme-demo.mts /tmp/ruflo-demo-new
```

Use a fresh output directory. The capture refuses to overwrite an existing `demo-session.json`; omitting the directory creates a unique temporary directory and prints its path. Outputs are `frames.json` (the captured terminal cells for every step, with a caption, palette and column count) and `receipt.json` (what was and was not exercised: no native host, no AI provider). Turning the frames into a GIF or video is left to your own renderer; the repository ships none, so no Python or image library is needed.

For a genuine animated vector export of those same captured frames, run (Node only):

```sh
node plugins/ruflo-console/scripts/render-theme-svg.mjs /tmp/ruflo-demo-new
```

`ruflo-console-demo.svg` contains text runs, block rectangles and reusable row symbols (the font is your system monospace), replayed with native SVG discrete animation over the same 38 seconds. It has no embedded images, video, scripts or other external assets. The complete 456-frame replay is approximately 20 MB. It scales through its viewBox; open the file in an SVG animation capable browser when a document preview shows only a still frame.

The terminal color picker provides swatches and exact `#RRGGBB` entry for headings, success, failure, warning, information and background. Preview the globe and swarm motion, adjust speed and decorative layers, then **Save preview and apply**. Up to twelve named custom presets are stored locally through the host; reusing a name replaces that preset. Failed saves leave the active theme unchanged. Settings `fps: 0` still disables animation. Layouts retain the compact/narrow fallbacks.

**Generate with Claude** or **Generate with Codex** runs the bundled `generate-console-theme` skill through AI Terminal with its existing confirmation and model controls. Enter the design brief first, generate a preset, then paste the returned JSON into **Import theme JSON** and review before saving. The generator produces palette and motion variations of the existing Orbital renderer, not executable animation code. No additional API credentials are requested. Installed Claude plugins discover the bundled skill; Codex can read `plugins/ruflo-console/skills/generate-console-theme/SKILL.md` directly in this checkout.

Imports are limited to 4096 characters and a strict version 1 data schema. Status labels and actual check results remain unchanged. Saving requires at least 3:1 foreground/background contrast; the generator aims for 4.5:1.

Theme Studio uses focused Colors, Motion and AI tabs. At 100 content columns it places the editor beside a persistent globe and routing preview; narrower panes stack both panels with a compact routing strip. A single color role picker replaces the repeated swatch lists. Minimum contrast is shown before saving, and Discard draft changes restores the active palette without deleting saved themes.
