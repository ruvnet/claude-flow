# Changelog: ruflo-cost-tracker

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-cost-tracker`.

## 0.28.2 — 2026-10-12
- fix: a failed Stop-hook telemetry write is logged to ~/.claude-flow/logs/cost-tracker-failures.log (capped at 512 KB, rotated to the newest 200 lines) instead of being discarded; the hook still never blocks a turn (#3227, #4078, thanks @nicholas-ruest)

## 0.28.1 — 2026-10-11
- fix: cost-analyst uses `neural train --pattern optimization` (there is no `--pattern-type`, and `cost-optimization` is not a valid pattern) and drops the invalid `--train-neural` post-task flag
- fix: `cost workers` and the analyst call `hooks_worker-status({ includeCompleted: true })` and pick out the optimize and benchmark entries (the tool has no worker-name filter)
- fix: cost-track verification call written as a real memory_search call; cost-federation ADR link repaired; smoke expectation corrected to 63

## 0.28.0 — 2026-10-08
- feat: read Grok CLI sessions (usage.json) into the cost ledger (`--provider grok`)
- fix: Grok prices are list prices and are flagged approximate in the ledger output (subscription billing may differ)

## 0.27.2 — 2026-10-07
- fix: run the installed ruflo CLI before `npx @claude-flow/cli@latest` in cost-tracker, adr and metaharness
- chore: 3.55.0 versions, leaf pins, lockfiles, plugin bumps, changelog

## 0.27.1 — 2026-10-04
- feat: missions Claude knows about, gate evidence, mission spend and a loop manager (ADR-443)
- feat: mission spend (ledger --from/--to/--project, mission-cost module and rows)
- fix: replace every | in the model label (CodeQL js/incomplete-sanitization)

## 0.27.0 — 2026-10-04
- feat: multi-provider cost ledger, price book, advisor and Cost page (ADR-437)

## 0.26.3 — 2026-07-29
- fix: Codex hooks.json schema + PreToolUse verdict compat
- fix: re-anchor #1862 marker + refresh manifests after #2721
- fix: make ruflo-core/ruflo-cost-tracker hooks Windows-native

## 0.26.2 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: preserve memory JSON across Windows npx
- chore: confirm npx installs in fixtures
- chore: prepare stable Ruflo 3.32.1

## 0.26.1 — 2026-07-16
- fix: ship stable Windows-safe Ruflo integration
- fix: add Windows shim ruflo-hook.cjs (#1902/#1903/#1904, #2132)
- chore: darwin-plugins iter 3 — ruflo-cost-tracker: fix subcommand count heading (20→23)
- chore: darwin-plugins iter 2 — ruflo-cost-tracker: dedupe 'budget' keyword in plugin.json

## 0.26.0 — 2026-06-16
- feat: wire codemod benchmark into cost-trend (ADR-143 follow-up)
- feat: split cli into cli-core (lite) + cli (umbrella) — alpha.5
- fix: spawnSync npx ENOENT on Windows
- fix: resolve from anywhere + free HEALTH_PORT (#1930)
- fix: ruflo-cost-tracker encodeProjectPath handles Windows backslash + drive colon
- chore: v3.11.0 — router ADR-148/149 + cost-tracker observability + fleet audits
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.16.1 — 2026-05-05
- chore: consistency audit — agent + README mention all 13 skills (v0.16.1)
