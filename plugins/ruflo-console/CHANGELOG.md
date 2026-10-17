# Changelog: ruflo-console

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-console`.

## 0.44.3 — 2026-10-15
- fix: the rest of Mission Control's prose wraps at 80 columns (tmux) instead of ending in "…" (#3899): a launch step's detail (Claude's guidance note, the screen verdict, the next task's title) moves onto wrapped rows under its step when it does not fit beside it, and the "Create the mission and its tasks" label no longer runs into its detail; on the record, the expanded mission's state, plan, evidence, executor and blocked-reason lines, the stale and attention notes, the legend and the observation note wrap; the Mission options "not offered by this session" hint wraps.

## 0.44.2 — 2026-10-14
- fix: the console reads the project on Windows (#4175, thanks @GangOn0215). Every path under the working directory came out as `C:\dev\app/C:\dev\app/.claude-flow/...` (the working directory prefixed twice, because the host wrapper counted only a leading `/` as absolute), so every read failed with ENOENT, the project showed as "Unregistered" and the pane never opened on its own. A drive path (`C:\x` or `C:/x`) and a UNC share (`\\server\share`) now count as absolute (`hooks/data/abs-path.ts`). Tested on win32-style paths only: no Windows machine was available to run the pane. The same leading-`/` test still guards a few other spots (ADR folder, event export, workflow file, mission cost, plugin catalog); those refuse Windows paths rather than misplace them, and are left to the Windows work in #4036.

## 0.44.1 — 2026-10-14
- feat: `ruflo tui` Stages B and C: every console view in the terminal with its actions, pinned panes and a parity check against the console (#4188)

## 0.44.0 — 2026-10-14
- feat: `ruflo tui` draws what the console draws. The pictures of the pages (the Classic BBS block-letter titles, the Orbital masthead with its globe, the swarm topology, gauges and charts) are drawn as coloured cells through a terminal Raster, 24-bit where the terminal says so and the nearest of 256 otherwise, and as the words they fall back to with NO_COLOR, a dumb terminal, `--no-pictures` or fewer than 44 columns. Every glyph is a code point that goes through the same sanitiser as the text: a control, invisible or wide one becomes a space
- feat: the looks of the console in the terminal: Classic BBS (the default, as in the console), Orbital and plain; `--look` picks one and the `t` key steps through them; `--boot` plays the look's start-up screen first
- feat: pictures move at `--fps` (0-30, default 8, the console's own default; 0 and `--no-anim` draw them still). An animation tick rewrites only the rows that changed, nothing is drawn while the terminal reports it is behind another window, and a slow terminal skips frames rather than queueing them
- fix: `ruflo tui --plain` prints the plain look, so a script's frame has the same words as before

## 0.43.7 — 2026-10-14
- fix: Mission Control's prose wraps on word breaks instead of ending in "…" at 80 columns (tmux): the kind description, the empty-goal hint, the lifecycle line and each planned task line (#3899, the rest of what 0.40.2 did for Approvals and a mission's objective).

## 0.43.6 — 2026-10-14
- fix: the analyze page describes REVIEWERS as reviewer roles suggested from file paths and risk, not people from the history (#4163, thanks @rudycelekli)

## 0.43.5 — 2026-10-12
- fix: the Skills page runs a pinned skills CLI (`skills@1.7.2`, like the AI page's pinned Codex) instead of whatever npm `latest` is: `npx -y skills` fetched and ran the newest release on every visit to the page (it lists on open) and on every add, remove, update, init and use, with the person's permissions. The hints name the pin from one constant. The pin fixes the top-level package only: its own dependencies (tar, yaml) are npm ranges resolved on the first fetch, and the first run needs the network. 1.7.2 is published by vercel-labs/skills with no install-time scripts (#4113, thanks @martinvlad)

## 0.43.4 — 2026-10-12
- fix: the console's pictures show on Claude Code Desktop, the editor and the mobile app. The banner, title art, topology, maps, gauges and charts were all missing there, and so were the text lines meant to stand in for them: the host completes every element table with every name, and on those surfaces its `Raster` draws an empty fragment, so the console believed it could draw pictures and drew empty boxes. The surface now decides (not the table): the terminal keeps its `Raster` and gets no `Svg`; Desktop, VS Code and mobile get each picture as one `Svg` of the same cells (Block Elements and braille glyphs as rectangles, other glyphs placed cell by cell, colours kept, background transparent). A picture that would pass the host's 131,072-character `Svg` limit falls back to its text line, so one large picture cannot invalidate the whole tree; nothing is blitted where nothing is mounted; and a host that does not name its surface is treated as the terminal. The model-facing text is unchanged (#4111, thanks @proffesor-for-testing, #4112)

## 0.43.3 — 2026-10-12
- fix: `console_state` tells Claude that a confirm card expired: `lastResult` carries `expired: true` after a card nobody answered was cleared unrun at 30 s (the runner already set the flag; the tool left it out), so Claude can tell "you did not answer" from a run that failed without reading the detail text. An ordinary result has no `expired` field (#3985 follow-up, thanks @proffesor-for-testing, #4067)

## 0.43.2 — 2026-10-12
- fix: removing a worktree no longer runs the repository's own programs, and no longer deletes unsaved files: `git worktree remove` runs its own status, which ran `core.fsmonitor` and the `post-index-change` hook, and with `status.showUntrackedFiles=no` it read a worktree holding new files as clean and deleted them. The removal, the worktree status probe, the changed-files read and `describe --dirty` now switch the fsmonitor (and for removal and describe, hooks) off, and list untracked files whatever the setting says (#4090, thanks @proffesor-for-testing, #4092)
- fix: a `filter.<name>.clean`, `.smudge` or `.process` command in a repository's config no longer runs when the console compares a worktree with HEAD: before the removal, the worktree status and the diff drill-down, it lists the configured drivers (a config read) and blanks each one on the command line; a driver name it cannot blank exactly refuses the probe instead of running it

## 0.43.1 — 2026-10-12
- fix: `ruflo tui` marks the page on screen in the page bar: on the AI page it kept the previous page lit (`5 Missions`, or `1 Overview` after a number key) because the bar was painted from the console view the session last showed and the AI page is not one; it is now drawn from the page itself, through Tab, Shift-Tab, letters, digits and resize
- fix: `ruflo tui --help` and the console README list the page keys as `1-6` and `o c s e m a` (they said `1-5`); a test holds the help text
- fix: the CLI no longer builds its trust-store path (`~/.config/ruflo/policy-trust`) from an empty or relative `$HOME`, which put the anchor mirror and key under the working directory; it uses the account home, or says `$HOME` must be absolute

## 0.43.0 — 2026-10-12
- feat: an optional Orbital look (black telemetry panels, square borders, a rotating globe, a scan sweep and a shaded Ruflo header that stays visible after boot) and Theme Studio: pick Classic BBS, plain or Orbital, six bundled color presets, up to twelve named custom themes, a color picker with a 3:1 minimum contrast, motion layers and speed, and a generate-console-theme skill whose JSON is imported through a strict, size-bounded schema. Classic BBS stays the default; open it from Main Menu → Tools, Settings or /ruflo themes
- fix: Theme Studio has its own boot-log line and help guide, and is reached by name (every hotkey letter is taken)
- chore: the Orbital globe reads a one-degree land mask built once, not nine polygon tests per cell per frame (about a third less time per frame); `scripts/bench-theme.mjs` measures the per-tick cost of every animated picture; 45 adversarial specs pin the theme import (closed schema, control and bidi characters, prototype keys, size bounds, hostile saved stores)

## 0.42.7 — 2026-10-11
- feat: `ruflo tui` has five pages: Overview, Cost, Swarm, Events and Missions (keys 1 to 5, or o c s e m; Tab and Shift-Tab cycle). A page bar shows where you are, a key line says what the keys are, and the terminal redraws on a resize (a short bar under 60 columns, a one-line notice under 40). Room is left out on purpose: it is a message box and Claude sessions this host does not have (ADR-489)
- fix: on the standalone terminal the shared chrome no longer draws what only Claude Code can do: no tab bar, footer buttons, Launch section, Ask Claude buttons or Claude control card, and buttons that nobody can press are not drawn (a state chip such as `● all 0` and a section title are). Under Claude Code nothing changes: every new branch is behind `state.isStandalone`
- fix: Missions on the standalone terminal reads the mission record only (ADR-406); the goal field, plan and research launch are Claude turns and are not shown

## 0.42.6 — 2026-10-10
- fix: the Plugin Catalog says "mod synced here, plugin not installed" (and marks the row ◇) for a mod Claude Code loaded by sync, such as ruflo-arena@synced, instead of a flat "not installed" that contradicted the Plugins page; the install button stays (#3979)
- chore: work-in-progress and merge lines are dropped from the console and mods changelogs shown on What's new (#3979)

## 0.42.5 — 2026-10-10
- fix: every confirm route answers the card the person saw. A typed /ruflo yes answers only a card that was put in front of you (drawn in the open pane, or named in the answer to your own /ruflo run) and /ruflo yes <id> names its card; otherwise it runs nothing and says the card's id (#3983)
- fix: Enter again in the terminal, skills and automation fields answers the card that field raised, by its id, not a later card that merely reads the same; an auto-confirmed Claude call settles only the card it started, so an unrelated write that lands while a read is still running is left to the person (#3983)

## 0.42.4 — 2026-10-10
- fix: a confirm card nobody answers is cleared unrun at 30 s on the console's own clock, with one event and "expired: ask again" as the last result, so it no longer blocks every later Claude action; a Yes after the window still runs nothing, and the Room stops counting past 30 s (#3984)
- feat: Claude can withdraw its own waiting write ask (console_run ask-withdraw), never the person's card and never a spend, install, network or delete card; at most 3 a minute, with a cooldown on re-asking the same thing (#3984)
- fix: the ADR and skills entries say what to open (console_open adrs, console_open skills) instead of "not wired yet" (#3984)

## 0.42.3 — 2026-10-10
- fix: the session workspace keeps other projects' folders, working directories and git branches out of text answers (what console_state and ask-claude read): the group headings, the cwd and branch line and the unassigned titles name a session by harness and position, never by a recorded path; an adversarial test draws every view with canaries in every transcript field and a failed listing and finds none (#3981, ADR-486 section 3)
- fix: Needs you raises a failure only after the 30 s quiet period (ADR-486 2.3), not for a permission refusal, an Esc or a Codex interrupted turn, and a failure already seen stays seen when only cost or title lines are appended; a time in the future can no longer silence a session; one 12 MB read budget per pass is shared by every adapter and enforced before each read; attention.json is refreshed at least every 5 minutes and a failed write backs off; the Room's Who is here lists only agents with recent activity, keeps your main session first and counts what it leaves out (#3981)

## 0.42.2 — 2026-10-10
- fix: numbers read from CLI JSON are bounded at the reader (a count of 1e999 no longer draws Infinity on the band); an unreadable count stays visible as unknown rather than a measured 0, and a listed finding is never hidden by an under-reporting summary (#3822)
- fix: a mission resume made by Claude keeps each task's hand-out count, so resuming cannot buy more billed hand-outs after the limit paused the mission (#3823)

## 0.42.1 — 2026-10-10
- fix: Mission Control create retries only a real policy-state lock timeout (and a silent failure or a wait that ran out), reads the CLI's own Result: line rather than the Parameters object, undoes every open task of the mission when it must abort, asks the mission record to cancel, and reads the stores back so the result says what they show, not what was asked (#3945)
- fix: a run that reports for itself (mission create, the ADR page writes) now becomes the console's outcome when it ends, so console_state.lastResult carries how it ended however long it took (#3945)

## 0.42.0 — 2026-10-09
- feat: an optional, detect-only Grounding line for Stuart Kerr's third-party ruvnet-brain plugin: Overview says whether it is on, not installed, installed but disabled, or unknown (read from the plugin list and your settings; ruflo works the same without it, and nothing of it is bundled or copied) (ADR-487)
- feat: with the brain on and a mission that names the ruvnet stack (RuVector, RVF, AgentDB, ruflo ...), Claude's mission context carries one fixed line pointing at `search_ruvnet`; Settings → "RuvNet Brain nudge" turns it off (default on). The console never calls the brain and no mission text enters the line
- feat: Settings → "RuvNet Brain install hint" (default off): one dismissible toast per session and an Overview line link its repository when it is not installed; the console never installs it

## 0.41.0 — 2026-10-09
- feat: session workspace on the Room (ADR-486): a Needs you queue (approvals, questions, failures, finished work) across Claude Code, Codex and Ruflo sessions, a session browser grouped by repository and worktree, and a preview of the selected session (latest response, current tool, edited files, test result, cost labelled reported, estimated or unavailable). Discovery is local and read-only: no model call, no process, no wake. Sessions with an ambiguous identity go to an unassigned bucket and raise nothing. A finished session clears only after its preview was drawn. The Overview shows the four counts. Options: sessionWorkspace, sessionPreview (both on).
- feat: ruflo-mods can show those four counts. The console's only write is that summary (counts only, .claude-flow/console/attention.json, in a ruflo project, when a count changes), through the same path Events persistence uses.

## 0.40.8 — 2026-10-09
- fix: an ADR scope glob with many stars no longer freezes the console: the matcher is a bounded two-pointer scan instead of a regex (a 16-star glob against a short path took 38 s; it now takes microseconds, at the real input caps under 10 ms for 9,600 pairs); results are identical on legitimate globs (ADR-480)
- fix: an ADR title over 120 characters is refused with the count on every path (the page field, the `adr-propose` palette entry, `/ruflo run`, `console_run`) instead of being cut into the file name, and a draft whose title was shortened from a mission's objective says so on the confirm card (ADR-481)
- fix: the ADR digest handed to a spawned subagent is checked against the console's exact shape and re-rendered with each record's text quoted; a plugin named `__proto__`, `constructor` or `toString` can no longer corrupt the What's new record (#3941, #3942, thanks @proffesor-for-testing)

## 0.40.7 — 2026-10-09
- fix: the console's disk writes work on macOS and the BSDs: BSD `dd` and `install` refuse `oflag=append`, `conv=excl` and `-D`, so every append (Events, Timeline, the autopilot journal), exclusive create (ADR records, exports, `.gitignore`), create-with-folders and the journal archive copy failed there. The host is asked once (`uname -s`, with its own 3 s deadline and a `process.platform` fallback); Linux keeps the exact GNU argv, other kernels run one of seven constant `sh -c` scripts (frozen set, the path only ever as quoted `$1`, a link or non-regular target refused, `set -C` for O_EXCL), and a failed ADR write says why instead of "it may have appeared meanwhile" (#3938, #3939, thanks @proffesor-for-testing)

## 0.40.6 — 2026-10-09
- fix: times read as times and a swarm reads as itself: the AgentDB mod's "written" age no longer shows 100020735d ago or 0s for a future stamp (it reads n/a), a swarm's agent count and status agree on Overview, Swarm, the topology graph, the status bar and Workflows (a swarm with no listed members says so; "stalled" needs evidence, not just an old record), Workflows agent ages show days, and `mission-goal` says it replaces the goal instead of "nothing is written" (#3935, #3936, thanks @proffesor-for-testing)

## 0.40.5 — 2026-10-09
- fix: a verdict command's "found something" exit (security scans, AIDefence checks, MetaHarness mcp-scan, threat-model and drift) is an answer, not a failure: Claude is told what was found, and a failed run names its real reason (the [ERROR] line, a wrapped tool error) instead of the CLI's [WARN] banner; the answer is read out of stdout in bounded time (#3933, #3934, thanks @proffesor-for-testing)

## 0.40.4 — 2026-10-09
- fix: a task an older CLI stored as "complete", "done", "canceled" or "running" reads as its canonical state everywhere the console decides on status: the kanban lane, Mission Control (it is never handed to Claude again), mission cancel, and the workflow task links (#3931, #3932, thanks @proffesor-for-testing)

## 0.40.3 — 2026-10-08
- fix: the approvals badge (band "n to approve", menu badge, change notices, and the Approvals header) counts only rows a person can act on; a refused mod or a permission deny has no approve or deny action, stays listed on the page as a notice, and no longer holds the badge up with nothing to press (#3920)

## 0.40.2 — 2026-10-08
- fix: a Yes runs only the card it was pressed on: every confirm card has an id and the Yes, Always allow and Always accept buttons carry it, so a card that took the first one's place (the person's own ask) is never answered by a Yes meant for the old one; the stale Yes runs nothing and says so (ADR-450 T17)
- fix: an ask of Claude's that was screened first and landed after its tool call returned is checked against the level and Stop as they are when it lands; a level lowered meanwhile wins
- fix: everything handed to the model goes through one sanitiser (modelLine: escape sequences, then control and invisible characters removed so they cannot split a credential, then invite codes masked, then the cut, then the line withheld if it holds a secret shape): failed-run details, the "already waiting" refusal, the "waiting for the person" and "started" answers, refusals that echo the model's own input, palette entry ids and thrown errors no longer quote a token or an x.ruv.io invite code; a version such as v2.1.0-beta.3 is no longer masked as an invite
- fix: escape stripping is linear: a megabyte of unterminated OSC introducers took seconds, now milliseconds; an unterminated OSC ends at the next introducer or the end of the text
- fix: a mission state, task status, hive role, audit severity or plugin named toString, constructor or __proto__ draws as unknown instead of as native code, and no longer throws in Settings
- fix: Approvals and a mission's objective wrap at narrow widths (80 columns in tmux) instead of being cut with "…" (#3899)

## 0.40.1 — 2026-10-08
- fix: a settings write (or any confirmed ruflo CLI action) no longer aborts with "still running after 90000ms" when the CLI is not in the npm cache (#3914): with the ruflo CLI option on npx it now uses ruflo on PATH, a project-local bin, or the cached npx copy first, and only then a cold download, which gets a 5 minute limit and says "first run downloads the ruflo CLI"
- fix: a timeout or an uncached npx now ends as an error that names the fix (npm i -g ruflo, or npx -y @claude-flow/cli@latest --version once), and a retry after the cache is warm runs at once

## 0.40.0 — 2026-10-08
- feat: advisor checkpoints for mission loops (ADR-483), off by default (Settings → Advisor checkpoints): a read-only second opinion before a plan locks, when the same check fails twice in a row, and before a mission is declared done; a third failure in a row pauses the mission
- feat: each consult is a separate claude -p turn in plan mode on the model you choose (Settings → Advisor model), asked first with the exact command, under the turn budget and the mission spend cap; it is not Claude Code’s in-session advisor, which a mod cannot call
- feat: Loop tab shows the failure state, the consults, the advisor’s cost as claude reported it beside the mission total, and the last answer
- feat: Settings → Subagents return summaries only adds one line to the mission loop prompt

## 0.39.1 — 2026-10-07
- fix: text you type is never silently shortened (ADR-481): the mission goal (was cut at 500 characters), the question, the aside, the guide, the research question, a loop task, help and ask questions, room messages, palette text, start fields, workflow guidance and messages, templates, security and memory fields, the Gates setting and the recall prompt now keep every character; the goal, the loop prompt and the mission context carry it whole
- fix: the one-line field no longer hides what you typed: under any field whose text passes one line, a bordered mirror shows every line (wrapped, growing to 12 lines, then the last lines with a count) with a line count; type a backslash and n for a new line, and Enter sends all of it
- fix: a goal, objective, question or note is drawn in full (wrapped), with an explicit "+N more lines" marker past 40 lines, instead of one clipped line; the Mission Control header shows the objective in full
- fix: over a real limit the action is refused before anything is sent, with the exact limit and the characters over (the field's own 10,000, an argument's 8,000, a ruflo mission objective's 2,000, a loop task's 4,000) and the text stays in the field; AIDefence now screens all of a long text, not its first 2,000 characters

## 0.39.0 — 2026-10-07
- feat: ADRs page under TOOLS: find, propose, accept, reject, deprecate and supersede your own project's Architecture Decision Records, with the exact file and diff in the confirm (ADR-480)
- feat: the page finds your project's ADR folder (docs/adr, docs/adrs, doc/adr, adr, docs/architecture/decisions, docs/decisions ...) or the one in Settings, follows the style of your existing ADRs (MADR, Nygard / adr-tools, ruflo style) and offers to initialise a project that has none
- feat: attach ADRs to a mission: Claude's mission context, the task instruction and spawned swarm agents carry the accepted decisions; changed files are compared with the paths those ADRs name at verify time (a warning in the record, never a block)
- feat: ADR lint (duplicate numbers, dangling or one-sided supersedes, no status or date, missing from the index, broken links); palette entries adr-propose, adr-accept, adr-supersede and more, at the write control level
- feat: Settings gain ADR folder, ADR style and ADR file name pattern

## 0.38.0 — 2026-10-07
- feat: What’s new page under TOOLS: each installed ruflo plugin’s bundled CHANGELOG.md, newest first, with a divider at the last look, breaking changes pinned until dismissed, a new marker on the nav, and one info toast per new version (ADR-478)
- feat: CHANGELOG.md in every plugin, in a fixed format the page parses; the smoke contract checks it for console, mods, swarm and protector
- chore: Settings, Events and update-check ADRs brought up to date; ADR-479 for the MCP HTTP bearer token
- fix: a toast needs no engine.create (bind at session.start too), a throwing clock falls back to the wall clock; update the cost ladder expectati…
- fix: console toasts release held errors on a timer; settings section names toasts; ADR wording

## 0.37.0 — 2026-10-07
- feat: shared toast system with levels, dedupe, persistence and Settings (ADR-477)
- fix: CONSOLE_VERSION follows the manifest (0.36.1)

## 0.36.1 — 2026-10-07
- feat: Settings puts Claude control and spending first, folds ruflo config and plugin options to the end

## 0.36.0 — 2026-10-07
- feat: 0.36.0 integration: eventsPersist option, shared whole-batch append argv, hostile-time hardening, init ignores console/
- fix: log Claude's refused request when the person's card is waiting; mission-auto why when not wired; document the local-read allowlist
- fix: session control cap, gate on read-only entries that act, hostile text/data, mission auto-run guards (#3814 #3815 #3816 #3817 #3818)

## 0.35.0 — 2026-10-06
- feat: autopilot envelope editor, parallel hand-over, spend windows, band segment, and the first live run (ADR-470)
- feat: recorded recalls, real vectors on the memory map, log-based stale (ADR-472)
- fix: control plane measured in an interactive session (ADR-471)
- fix: Workflows layout at every dock width, replay play loop, quiet stale presses (ADR-469)
- chore: 0.35.0; re-sign the helpers manifest for the recall-log hook changes (ADR-472)
- chore: incremental transcript parsing, kit-seq runner, tsc clean for specs (ADR-473)

## 0.34.1 — 2026-10-06
- feat: wire control plane, conversation and mission autopilot into the Workflows page (ADR-465, ADR-466)
- feat: interactive control plane and multi-model bridge (ADR-465)
- feat: control tab, Conversation board, truthful stop/message wording (ADR-465 wip)
- feat: autopilot live loop, panel, parked queue and tests (ADR-466)
- feat: conversation model, transports, tests with fake transports (ADR-465 wip)
- feat: autopilot pure core - envelope, journal, step machine, adapt gate, guards (ADR-466)
- feat: control plane data (stop, message, redirect), targets registry, send transports (ADR-465 wip)
- feat: merge the five Workflows features and wire their seams (ADR-459..463)
- chore: and 38 more changes (git log -- plugins/ruflo-console)

## 0.33.23 — 2026-10-05
- feat: band notices, tone border, /ruflo band|notices|quiet (0.33.23)
- feat: Project Anatole section in Security & Doctor (0.33.23)
- fix: keep the Router's running-success curve (an existing test and feature); only explain why it is empty
- fix: the Router block says why it is empty and does not stretch a flat curve over nine outcomes
- fix: the Learning pulse charts mean one thing each and line up (0.33.22)
- fix: smoke step 12 accepts the excluded list as well as the CI baseline for kit tests
- fix: status.json carries version 1 and the *Ms times the Mods scan needs; the console maps the plugin to Security & Doctor
- fix: the Optimizer's answer panel is framed like every other result
- chore: and 3 more changes (git log -- plugins/ruflo-console)

## 0.33.24 — 2026-10-05
- feat: the band shows how long Claude has been working, the tool-call rhythm and the context gauge (0.33.24)
