# ADR 407: The ruflo-console cockpit: interface, AI terminal and safety contract

Status: Accepted

Date: 2026 10 02

Decision owner: Ruflo maintainers

Scope: the `ruflo-console` Claude Code mod (`plugins/ruflo-console`): its pane layout, BBS look, boot screen, main menu, band, AI terminal, x.ruv.io board, Skills, Hive-Mind and MetaHarness lab, and the rules every view follows

Extends: ADR 404 (Ruflo as a Claude Code mod) and ADR 406 (mission control through compatible mods, §8 interface modes). Preserves ADR 150 (MetaHarness stays removable) and the repository rule that systems may propose and evaluate but never self-promote.

## 1. Decision

The console is the person's cockpit for a ruflo project inside Claude Code: one `/ruflo` command, a docked pane of views, and a band above the prompt. It reads ruflo's files and the CLI's local JSON. It acts only through fixed argv, and every change is confirmed first. It reaches the network only when the person turns it on or asks for something that needs it. This ADR records the contract that the 0.2–0.6 releases converged on, so that later views keep to it.

## 2. Frame and layout

Every page draws, top to bottom:
1. **Banner**: the animated RUFLO logo with the project name.
2. **Wildcat strip**: `RUFLO x.ruv.io AGENTS WELCOME.` and `NETWORKS: …`.
3. **Tabs**: emoji tabs with hotkeys; every view has one (ADR 408 §6).
4. **Block title**: the view's name in two-row half-block art.
5. **Blurb**: `>> icon NAME :: what it is for`.
6. **Body**.
7. **Confirm row**: shown only when an ask is pending.
8. **Footer**: link status, keys, and buttons.

**Compact only inline.** A pane goes compact only when it is *inline* and shorter than the view asks (`isCompactPane`). Compact drops the banner and the spacing, and moves the controls above the body. It keeps the block title and the blurb.

**The dock never goes compact, because it scrolls.** In 0.6.0 the dock went compact on the taller views (Swarm, Claims, Plugins, Learning, Terminal, x.ruv.io, Main Menu), which lost their banner and title while the shorter views kept theirs. That inconsistency is what this rule removes (0.6.2).

## 3. Look, colour and motion

**Look.** `look: 'bbs'` (default) is the neon BBS look. `plain` uses the terminal theme's own colours.

**Colours sit on the xterm‑256 cube where it matters.** Claude Code draws Rasters in 256 colours in some terminals. In tmux the pane emitted `48;5;n` codes, and off-cube dark tints collapsed to brown and grey there. Light is **added** to the wall, never blended into it. Tubes are pink `#d7005f`, yellow `#d7af00` and cyan `#00afd7`, each with a white-hot core.

**Motion must mean data.** A dot runs to a busy agent, a cell pulses after a vote, a cursor blinks while an agent writes back. The boot screen is the one decoration, and it ends by itself.

**Boot screen.** About 3–6 s, shown when the pane opens:
- ATDT, then CONNECT.
- The RuFlo neon sign (`ruflo/assets/ruflo-small.jpeg` drawn in cells: frame on clips and wires, yellow tube lettering, cyan wave badge, brick wall) strikes up tube by tube.
- Each tube cell materialises out of random letters, and the lit sign occasionally glitches (a row slips, cells flash to noise).
- A LOADING bar fills from elapsed time and from the first ruflo reads.

## 4. Main menu

In the BBS look the cockpit lands on the Main Menu, both for a bare `/ruflo` and for auto-open. `/ruflo <view>` still opens that view.

The menu shows:
- **Banner and title**: the banner and a `RUFLO BBS` block title.
- **Host line**: `x.ruv.io ■ Main Menu ■ github.com/ruvnet/ruflo`.
- **Four bordered groups**, each with sub-sections:
  - SWARM: live, work, watch
  - INTELLIGENCE: learn, remember, spend
  - NETWORK & EXTEND: federate, extend
  - TOOLS: run, session
- **Status bar**: a red modem-style bar with this project's live facts and an `Online mm:ss` clock.
- **Prompt**: a `(1:1)` prompt that takes a key or a name. `?` gives help and `O` logs off.

## 5. Band above the prompt

The band says what is happening now, most urgent first, so a narrow band truncates the least useful parts:
1. What needs a person (approvals, warn/bad alerts).
2. Who is working on what and for how long (`▶ coder on <task> 2m`).
3. The AI terminal's runs (`💻 codex answering 1m`).
4. The newest event while it is under a minute old.
5. When nothing moves: `idle · N agents ready · last activity 3m ago`.
6. Standing context last: claims, then this session's spend.

Totals (patterns learned, router picks) live in their own views, not on the band.

Every part is a link: a click opens the console on the view it is about, with the keys. The same holds for the main menu's status-bar facts and the Wildcat strip's network names.

## 6. AI terminal

The terminal view is a conversation with **codex**, **claude**, a **swarm** of both at once, or one **ruflo** CLI command.

**Sessions.** Each agent keeps a session per project, saved under `$.store` as `ruflo-console/term:<cwd>`. Only id-shaped strings come back from the store, since each becomes an argv element. A follow-up carries the context:
- codex: `codex exec --json --sandbox read-only --skip-git-repo-check -`, then `codex exec resume --json -c sandbox_mode="read-only" <thread> -`.
- claude: `claude -p --output-format stream-json --verbose --include-partial-messages --permission-mode plan --max-budget-usd 1`, with `--session-id <uuid>` the first time and `--resume <uuid>` after.

**Prompt safety.** The person's text reaches an agent on **stdin, never as an argument**, so it cannot be read as a flag. ruflo commands are split into words with no shell.

**Streaming.** Output is read through `$.process.spawn` (`hooks/stream.ts`):
- claude's answer types out from text deltas.
- Commands, file changes and tool calls show as they run.
- Each turn ends with its cost and token count.
- If a stream ends with events but no answer drawn, the terminal says the format may have changed.
- Every run is capped at ten minutes, and `s` stops it.

**Spending.** Starting or resuming a session is asked once: Enter shows the exact command, and Enter again runs it. An empty Enter also confirms, because the engine empties the field on submit. After that the session is live and Enter sends. A ruflo command is asked every time.

**Keys.** The field takes the keys when the view opens and after a harness pick (`$.ui.focus`). `/codex`, `/claude`, `/swarm`, `/ruflo` and `/new` work from inside the field.

**Scrolling.** The conversation is a window that scrolls: ▲ older, ▼ newer and ⤓ end, or `/up`, `/down` and `/end` from the field. While the window is scrolled up, new output waits below and is counted; it never pulls the view down.

**Framing.** Each turn is framed: `╭─ you → agent`, then `├─ agent`, then a gutter in that agent's colour, closed by `╰─ ✓ 3 s · $0.012`. Answers get a light reading of markdown (headings, bullets, framed code) and wrap at word boundaries. A past question can be clicked to put it back in the field.

## 7. x.ruv.io board

A BBS main menu of what the open federation offers: join, roster, sync, work claims, channels, registry, and the admin-only invites, admit and publish. `▸ open` puts the matching `ruflo federation …` command into the terminal; it does not run it.

The registry and the roster come from the network, so they run only with `federationNetwork` on. Third-party text is labelled unvetted.

## 8. Actions and authority

Every change goes through the runner as one fixed argv and is confirmed first. The confirm row prints the exact command line (`ActionSpec.shows`) and notes any cost. Reads run at once.

The console never promotes, publishes or expands its own authority. MetaHarness promotion is shown as a command for the person to run, never offered as a one-key action from the pane.

## 9. Skills

A Skills view on the `npx skills` CLI (`views/skills.ts`, `data/skills.ts`, `skills.ts`). It has no hotkey and is reached from the menu (NETWORK & EXTEND → extend) or by typing `skills`.

**Installed.** `skills ls --json` for the project and `ls -g --json` for global. Both run when the view opens.

**Search.** `skills find <query>` prints text, not JSON. The console strips its ANSI and parses `owner/repo@skill  N installs` with its skills.sh URL.

**Changes.** Each of these goes through the runner, is confirmed first, and re-lists installed skills afterwards:
- `add <id> [-g] -y`
- `remove <name> [-g] -y`
- `update [name] -y`
- `init <name>`

**Edit.** "Edit" hands the skill's name and path to the AI terminal. The console never writes skill files itself.

**Input rules.** Input is validated before it reaches any argv: no leading `-`, only `[A-Za-z0-9@/._ -]`, and a length cap.

**Network.** The reads reach the network (the npx package download, and skills.sh for search), so they run only when the person acts.

## 10. Hive-Mind

A dedicated Hive-Mind view (`views/hive.ts`, `hive.ts`, `data/hive.ts`, `gfx/hive.ts`), keyless, after Swarm. Its data comes from `.claude-flow/hive-mind/state.json`, with worker roles and liveness from `.claude-flow/agents.json`, where `hive-mind spawn` writes.

**What it shows:**
- the queen's id, term and election time
- the consensus strategy
- members with roles and liveness
- fault tolerance from the CLI's own formulas (byzantine f < n/3, raft f < n/2)
- open proposals: per-voter ballots, votes against the required count, the raft timeout and the quorum preset
- decided proposals as history
- broadcasts and shared-memory keys

Gossip and crdt state no tolerance bound and read n/a.

**Actions.** Each is confirmed first:
- vote, cast through `hive-mind consensus`, which carries the capability token the console never reads
- propose, broadcast and spawn, through `mcp exec`

**Votes.** A vote is cast **as the next registered worker that has not voted**. The CLI counts only registered workers, and it exits 0 when it refuses a vote. Earlier palette and Approvals votes, cast as `console-operator`, were therefore dropped silently. All three paths now share this rule. With no worker left, they say why and run nothing.

**Picture.** A honeycomb Raster with the queen at the centre. A cell pulses for 2 s after that member's vote, join or leave. The Swarm view keeps a summary with `▸ open hive`.

## 11. MetaHarness lab

The MetaHarness view (`views/metaharness.ts`, `views/mh-lab.ts`, `mh-lab.ts`) keeps Readiness, Flywheel and the audit trend. It adds a lab of every verb, each checked against `commands/metaharness.ts` and the MCP schemas. Each lab entry is also a palette id (`/ruflo run mh-genome`), so it works headless.

**Inspect: runs at once, $0.**
- score, genome, mcp-scan (findings by severity), threat-model, `doctor --component metaharness`
- audit-trend and similarity, comparing the newest audit-list key with an older one
- drift-from-history `--dry-run`, flywheel receipts
- gepa genome and render; gepa analyze is typed into the terminal, since it needs a transcript path
- bench verify, evolve without `--confirm` (it only plans), learn without `--run`
- redblue attack, redblue `--mock-judge`

**Writes: confirmed first.**
- oia-audit (to memory)
- bench create, redblue init
- evolve `--confirm` (local compute, no model calls)
- flywheel run `--proposer local`

**Spends: confirmed first, and the confirm row says so.**
- redblue with a real judge, capped at `--max-cost-usd 3`
- security-bench, which may call models (MCP only)
- `learn --run`, which is typed into the terminal, so it is asked twice

**Never from the pane.** `flywheel promote <receipt> --public-key <pem> --confirm` is shown as a command for the person to run themselves (§8), and the same goes for evidence-reset. `mint` is not surfaced.

**Result panel.** Shows the label, the exit, the cost note and the output lines. j/k scrolls it.

The audit-list probe now reads the fields the CLI emits (`key`, `startedAt`, `finishedAt`); before, the trend never had real points.

## 11a. Labs and starts (0.8.0)

Every ruflo capability is a view with buttons and fields, never a command to copy. Besides the first eleven areas, 0.8.0 adds keyless views reached from the main menu, the tab, or `/ruflo <name>`:

| View | What it covers | Notes |
|---|---|---|
| Memory Lab | browse, search, store, delete, AgentDB, embeddings, upkeep | two stores; the CLI reads one, the view warns |
| Cost & Budget | set a budget, where spend goes, the burn projection | the one write sends only `costBudgetUsd` to `claude plugin configure ruflo-mods@ruflo --values-stdin` |
| Security & Doctor, Performance | scans, paste check, policy, every doctor check; metrics, profile, benchmarks | scans write `.claude/security-scans`, so they ask first |
| Automation, Learning Lab | workflows, the 12 workers, autopilot, sessions, config, a task kanban; train, route, explain | per-row verbs come from the lists last read |
| Vector Lab | the ruvector CLI (pinned version): shared brain, RVF, workers, edge, hooks, identity | rvlite queries are MCP-only and go to the terminal typed, never run |
| Self-Evolution | flywheel receipts, ledger, lineage, the policy gate, the witness, Autogenous and rGi | promotion is never offered from the pane |
| Dev Tools | GitHub reads, diff analysis, agenticow, WASM, browser, terminal, providers, maintenance | GitHub rows are read-only |
| Skills (plus) | use without installing, preview, add to chosen agents, update, restore, sync | |

Empty sections offer the start (`init`, `daemon`, `swarm`, spawn, `hive-mind init`, `pretrain`, a task, a mission) as a confirm-gated button. The x.ruv.io board's rows are whole-row buttons: pressing a name runs its read, asks for its write, or focuses its field; unregister says why in the Result panel (the gateway has no leave endpoint).

Two layout rules came from live clicks that seemed dead: the Result panel sits at the top of the x.ruv.io board and the confirm row above every view's body, because in a tall view anything below the fold is never seen.

`tests/conformance.spec.ts` (`RUFLO_CONFORMANCE=1`) runs every action's argv against the real CLI's help and source, every `mcp exec` tool name against the registered tools, and the Vector Lab's argv against the ruvector CLI.

## 11b. Plugin Catalog (0.9.0)

`/ruflo market` (the Plugins view's ▸ button, the main menu, the tab) lists every plugin the ruflo marketplace offers, read from the marketplace clone on disk: nothing is run to draw it. Each row shows its state (■ enabled, □ installed, · not installed) and what it ships (S skills, A agents, C commands, MCP, MOD for function hooks, from a `hooks/register.ts`). Pressing a row opens its skills (with the description from each SKILL.md), agents and commands above the list; ▸ view reads the file from disk (bounded, read-only) and ▸ use types `/<plugin>:<skill>` into the AI terminal draft without sending it. Modes (all, installed, not installed, mods, has skills, has agents) and a text filter narrow the list.

A change is one fixed `claude plugin <install|uninstall|enable|disable|update> <name>@ruflo --scope user` argv on the confirm row, with its cost in words (install and update reach GitHub). Only a name found in the catalog is ever put in an argv; `/ruflo run catalog-install <name>` (and the other four verbs) works headless and refuses anything else. Conformance checks that each verb exists and takes `--scope`. A button sweep (`tests/sweep.test.ts`) presses every button of every view and fails on one that changes nothing, except a short allowlist of cursor-only and self-link buttons.

## 11c. Settings, the AI terminal and the page chrome (0.10.0)

- **Page titles.** Every page but the main menu leads with `RUFLO ░▒▓▒░ PAGE ░▒▓` (the RUFLO letters sweep like the menu banner) and its purpose line, then the welcome and network lines with a blank row either side, then a titled **NAV** bar. The menu keeps the RUFLO banner. The nav spells its tabs as auto, icons only, icon and brief title, or icon and full title (saved; Settings > Interface).
- **Settings** (`/ruflo settings`) is driven by `claude plugin configure <plugin> --json`, so the console, ruflo-mods and every ruflo plugin with options share one editor; `ruflo config get|set` covers a curated list of ruflo keys; the AI terminal's model and per-turn budget are saved preferences. Simple shows the few that matter, advanced shows all; a search box finds any setting in either level; a ● marks a value that differs from its default. A change is `claude plugin configure <plugin>@ruflo --values-stdin` with one key (values are single-line strings) behind a confirm; an option that looks like a secret is never shown or edited.
- **AI terminal.** `claude -p` is the default. An **ask** link (Settings, Self-Evolution) sends its explaining prompt at once, so the reply streams in with no second click. **Always accept AI turns** (confirm row, reset in Settings) skips the confirm for claude, codex and swarm turns, which stay read-only, in plan mode and under the saved budget; ruflo commands still ask. The conversation is a window with a clickable scrollbar; the wheel and PgUp/PgDn move it (the `ui.scroll` hook) so the header and the field stay put.
- **Remembered actions.** A low-risk ruflo command (spawn a hive scout) offers **Always allow “<kind>”**; that kind then runs without asking. A kind is the command (for `mcp exec`, the tool). Never offered for anything that reaches the network, spends, deletes, publishes, registers, grants, restarts, changes configuration, runs another program or takes stdin (`hooks/remember.ts`). Settings lists each kind and forgets it.
- **Entry fields** clear after Enter (the field is drawn from `state.fieldText`, emptied on submit); a field that passes its own `value` is a form field its caller owns.
- **Collapsible sections** (`section()`): the header is a button (▾/▸); the AI terminal's harness picker is the last section of its page.
- Hive-Mind's ACT menu leads the page, in its own frame.

## 12. Release gates

A console change ships only when all of these hold:
- `npx tsc -p .`, `claude plugin test .` and `scripts/smoke.sh` pass, along with the vitest specs.
- `plugin.json` is bumped, because the install cache changes only on a version change.
- After merge, the person's installed copy is updated (`claude plugin marketplace update ruflo`, then `claude plugin update ruflo-console@ruflo`) and checked by grepping the cache.
- The tour GIF is re-recorded from a live pane: `~/Pictures/ruflo/ruflo-console-tour-neon.gif` and `docs/assets/ruflo-console-tour.gif`.

The recording driver aborts rather than type into Claude's own prompt. It never presses Enter unless that prompt is empty.

## 13. Consequences

- One frame contract for every view makes consistency testable. A docked short pane must still draw its banner and title, and a kit test asserts that.
- The AI terminal spends money on the person's own plans. It mitigates that with confirm-once-per-session, read-only and plan modes, a per-turn budget cap and a ten-minute cap.
- The 256-colour constraint limits the palette, but the cockpit reads the same in every terminal.

## 14. Sources

- `plugins/ruflo-console/hooks/{state,harness,stream,bindings,controller}.ts`, `hooks/views/{pane,frames,menu,bar,terminal,xruv}.ts`, `hooks/gfx/{neon,boot,pictures}.ts`
- PRs #3625–#3632 (band, BBS look, Wildcat round, neon boot, AI terminal, compact and focus fixes) and the 0.7.0 release (Skills, Hive-Mind, MetaHarness lab, scrollable framed terminal, clickable band and strip, now-first band, grouped menu)

## Update 2026-10-07: the Settings page's section order (PR #3887)

Section 11c describes Settings as an editor driven by `claude plugin configure`; it does not fix an order. The order is now deliberate, most
consequential first, and long lists last. Checked against `plugins/ruflo-console/hooks/views/settings.ts` (the render function from the
`rows.push(...section(...))` calls near its end; the change is commit 5a0e5bff4, merged as #3887).

With no search text, the page shows these sections, top to bottom. Each is a folding section (`section()` in `hooks/views/common.ts`):
its header toggles it for the session, and all are open by default except where noted.

| # | section (header) | what is in it |
|---|---|---|
| 1 | Claude control & spending | the five items `ai-model-control`, `ai-model-confirm`, `ai-accept`, `ai-budget`, `ai-mission-cap`, and a dim line saying claude runs read-only in plan mode and codex in a read-only sandbox, which this view never widens |
| 2 | AI terminal | the remaining `ai-*` items (model and other per-turn settings, saved here and applied to the next turn) |
| 3 | Interface & updates | the `ui-*` items: nav style, Updates (ADR-428), Toasts and the per-source mute chips (ADR-477). Its right-hand note reads "the main nav, update checks, toasts" |
| 4 | Remembered actions | the kinds the person chose "Always allow" for; folded by default when there are none |
| 5 | ruflo config | the curated `ruflo config get / set` keys (`core-*`) |
| 6 | Plugin options | the plugin picker, then the selected plugin's options from `claude plugin configure <plugin> --json` |

What changed: Plugin options and ruflo config used to be the first two sections and are now the last two; the model-control, confirm,
auto-accept and budget items moved out of AI terminal into their own first section; "Interface" became "Interface & updates". The
levels (simple or advanced), "changed only", "read again" and the search box are unchanged and sit above the sections.

With search text the page is a flat list grouped by source (`── UI`, `── ruflo-console`, and so on), not sections, so the order above does
not apply and any setting is found in either level. `hooks/settings-palette.ts` lists headless commands (`settings-set` and the like), not
sections; it needs no change and has none.

## Update 2026-10-08: how a confirmed action reaches the ruflo CLI (0.40.1, #3914)

§8 says every change runs as one fixed argv. The prefix of that argv comes from the ruflo CLI option (`CLI_PREFIXES`: `npx-offline` (default),
`npx`, `ruflo`, `claude-flow`), and the runner's limit for an action without its own `timeoutMs` is 90 s. With `npx` in a project whose
npm cache lacked `@claude-flow/cli`, a settings write started a cold download (about 2.5 GB; 36 s on a fast link, longer on a slow or loaded
one), was aborted at 90 s and showed the raw "still running after 90000ms". Now (`hooks/launcher.ts`, used by `hooks/runner.ts`):

- The explicit choices `npx-offline`, `ruflo` and `claude-flow` run exactly as chosen. Only `npx` (the person allowed the network) resolves a
  launcher once per session, cheapest first: `ruflo` on PATH, `node_modules/.bin/ruflo`, `node_modules/.bin/claude-flow`, the cached
  `npx --offline` copy (each probed with `--version`), and last the online `npx`, called a cold run.
- A cold run gets a 300 s limit and the outcome line reads "first run downloads the ruflo CLI: this can take a few minutes". It is not kept:
  the next write re-resolves, finds the warmed cache and runs at the ordinary limit.
- A timeout, or `ENOTCACHED` from `npx --offline`, ends the action as an error naming the fix: `npm i -g ruflo`, or
  `npx -y @claude-flow/cli@latest --version` once. Read probes keep their own limits and the existing "ruflo CLI not cached" hint.
- Reads and other callers that build `[...CLI_PREFIXES[cli], ...]` themselves (drill logs, the terminal harness, mission specs) are unchanged.

## Update 2026-10-08: a Yes names its card (0.40.2)

§8's confirm step ran whatever was pending when the Yes arrived. A second ask that replaced the first card (the person's own ask can still replace a
waiting card) made a Yes pressed on the first card run the second: a `memory store` argv ran from a Yes meant for something else. Now
(`hooks/runner.ts`):

- Every ask the runner queues gets an id (`Pending.id`, a counter that only rises). The confirm row's Yes, "Always allow" and "Always accept
  AI turns" buttons carry the id of the card they were drawn for, and `runner.confirm(seen)` runs only when `seen` is the id of the card now
  waiting. Otherwise it runs nothing, leaves the new card in place, answers "the card changed before your Yes", and records an event.
  "Always allow" and "Always accept" on a replaced card also remember nothing and keep the draft.
- A Yes without an id (`/ruflo yes`, the terminal's Enter on the asked line) still answers the card that is waiting; those read the card on
  screen in the same step. A second Yes on a card that already ran finds nothing waiting and is a quiet no-op, so it cannot overwrite the answer.
- An ask of Claude's that was screened first and so landed after its tool call returned is checked against the level and Stop as they are
  when it lands (`landingRefusal`, model-tools.ts); a level lowered while the screen looked wins.

Regression tests: `tests/deferred-asks.spec.ts`. The same release wraps Approvals and a mission's objective at narrow widths instead of
cutting them with "…" (#3899, `paragraph` in `views/common.ts`, `tests/narrow-width.spec.ts`).
