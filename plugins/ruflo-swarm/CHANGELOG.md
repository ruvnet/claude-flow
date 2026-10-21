# Changelog: ruflo-swarm

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.7 — 2026-10-11
- fix: `swarm watch --stream`, `swarm health` and `swarm shutdown` are not ruflo CLI subcommands; added `scripts/swarm-watch.mjs`, a Monitor-friendly poller of `swarm status --format json` that prints NDJSON on change, and pointed watch/monitor-stream at it; health and stop use `swarm_health`, `swarm stop` / `swarm_shutdown`
- chore: release the host-specific Codex hook manifest merged in #4050

## 0.3.6 — 2026-10-09
- fix: the ADR digest read from `.claude-flow/console/adr-digest.json` is accepted only in the exact shape ruflo-console writes (its header, one line per listed record with that record's status, no hidden or bidi characters) and is re-rendered with each record's text as a quoted value, inside the swarm's own framing that says it is project data and not an instruction (#3941, #3942, thanks @proffesor-for-testing)

## 0.3.5 — 2026-10-07
- feat: a spawned subagent is given the accepted ADRs attached to the active ruflo-console mission (masked, capped, as data), and its member row names them; option injectAdrs, on by default, nothing added without an attached ADR (ADR-480)

## 0.3.4 — 2026-10-07
- feat: shared toast system with levels, dedupe, persistence and Settings (ADR-477)
- feat: shared toast policy and its call sites (ADR-477), work in progress
- fix: a toast needs no engine.create (bind at session.start too), a throwing clock falls back to the wall clock; update the cost ladder expectati…

## 0.3.3 — 2026-10-05
- chore: drop provably unused hasSecret/tidy, swarm PLUGIN_NAME, ruos parseProbe; fix guidance screen header

## 0.3.2 — 2026-10-05
- fix: honour panel: off for the explicit pane subcommand (0.3.2)

## 0.3.1 — 2026-10-02
- feat: keep every command (ADR-406), headless views, ADR-406 catalog and missions
- feat: auto-open only in a ruflo project, remember a person's close, every action argv tested
- feat: one /ruflo command, auto-start, diagrams, palette and management views
- feat: show ruOS-hosted agents and hosts (ruflo-ruos contract); keep pane state per folder
- feat: label teammates by name and unknown loops honestly; document the mod
- fix: bump to 0.3.1 so the panel=command default reaches installed copies
- fix: never pass a dash-led task text to the router as an argv value
- chore: allow-list note for the ruflo-mods refuse-risky trust gate
- chore: and 3 more changes (git log -- plugins/ruflo-swarm)

## 0.3.0 — 2026-10-01
- feat: swarm mod skeleton: readers, members, pane view, actions, commands

## 0.2.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 3 — ruflo-swarm: align swarm-init argument-hint with 6 supported topologies
- chore: darwin-plugins iter 2 — ruflo-swarm: fix nonexistent Agent tool reference in swarm-init skill
- chore: darwin-plugins iter 1 — ruflo-swarm: add ADR-112 'Use when' guidance to swarm-init skill description
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-04
- feat: v0.2.0 — adopt plugin contract + 12-tool MCP surface (ADR-0001)
- feat: ADR-098 Part 4 — standardize neural-learning hook
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
- fix: publish @claude-flow/plugin-agent-federation@1.0.0-alpha.3 with ruflo-federation bin

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
