# ADR 446: The plugin fleet as mods: a guard, a status file and a `-mod` command per plugin

Status: Accepted (implemented in 39 plugins, each bumped one minor version)

Date: 2026 10 04

Builds on: ADR-404 (ruflo as a mod), ADR-445 (AgentDB as a mod)

## 1. Decision

Every ruflo plugin that had no hooks (39 of them) now ships a small function-hook mod (`hooks/hooks.json` naming `./register.ts`), following ADR-445. Each mod has, at minimum:

- **A status file** `.claude-flow/<short>-mod/status.json` (`version: 1`, counters), which the console can read.
- **A local command** `/<short>-mod` (`status`, `scan <text>`, and a read-only verb or two), answered with no model call. The name carries `-mod` because a plugin's markdown command cannot be re-registered or hooked (found in ADR-445).
- **A tighten-only `tool.call` guard** on the plugin's own tools where its domain has something to refuse: secrets into stores, personal data into public stores (IPFS transfer, dossiers), destructive calls without an explicit confirm flag (intelligence reset, fleet or device deletes), runaway limits (autopilot iteration cap). Default on, option to turn off. The denial reason never repeats the matched value. A plugin that owns no tools (agntcy, arena) gets status only.

Not done, on purpose: per-prompt context (ADR-445 piece 1) is not added to any of the 39 (no domain was a clear fit), and `ruflo-core` and `ruflo-cost-tracker` keep their classic hooks because `ruflo-mods` already owns those events through the handshake (ADR-404); the existing mods (`ruflo-mods`, `ruflo-console`, `ruflo-swarm`, `ruflo-ruos`, `ruflo-agentdb`) are unchanged.

## 2. How it was built and checked

Eight headless workers, each in its own git worktree and branch from main, each owning 4 to 7 plugins and nothing else; merged into one branch with no conflicts. Checked by the integrator, not taken from the workers' reports: every branch touches only its assigned plugin directories; `claude plugin validate` passes for all 39; each plugin's own smoke passes (fleet-wide `smoke-all-plugins`: 46 of 46 plugins); no hook file makes a network or process call (`$.http`, `$.process`, `child_process`, `fetch`); every hook file is under 500 lines. `claude plugin test` passes for every mod's own tests; for four plugins (agntcy, arena, graph-intelligence, plugin-creator) the harness also tries to load files that are not mod tests (their existing vitest suites, the plugin-creator mod template) and reports them as failed to load; those files are unchanged and run under their own runners.

Count note (2026 10 05, from the tree): `plugins/` has 46 plugin directories, each with a manifest, and 44 of them ship a function-hook mod. 35 have a `hooks/status.ts`. "39" is the number of plugins this ADR's eight workers added a mod to; the other mods are the five existing ones (`ruflo-mods`, `ruflo-console`, `ruflo-swarm`, `ruflo-ruos`, `ruflo-agentdb`). The "46 of 46" smoke figure was a run result on the day, not re-run for this note.

## 3. Consequences and follow-ups

- Each mod carries its own copy of the small secret screen from ADR-445 (`screen.ts`): plugins install as separate directories, so there is nowhere shared to import from. A fix to the screen must be applied in each copy. Since PR #3711, `scripts/sync-mod-screen.mjs` regenerates the shared region of each copy from one source and the all-plugins smoke runs it with `--check`.
- 39 more slash commands (`/…-mod`) and 39 small status files per project. The console lists them from ruflo-console 0.33.1 (PR #3707, a Mods section on the Room and a count on Overview).
- The guards watch tool names by string; a tool renamed in the CLI silently stops being guarded. A fleet check that every watched name exists in the tool registry is a follow-up (a spot check found only prefixes and tools served by other MCP servers missing).
- Workers shared `/tmp/modgen` and one overwrote another's generator; their generated output was unaffected, but the next fan-out should give each worker a private scratch directory.
