# Changelog: ruflo-loop-workers

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.6 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.5 — 2026-10-12

- Fix: the loop-worker skill lists all 12 workers with the priorities `hooks worker list` reports (it listed 8); the four added workers (ultralearn, deepdive, refactor, preload) have suggested cadences, and the intervals are documented as suggestions the dispatcher does not enforce (#4043)
- Fix: the skill says not to poll background work with short `ScheduleWakeup` calls (use a 1200s+ fallback)

## 0.3.4 — 2026-10-11

- Fix: `CronCreate` takes `{ cron, prompt, recurring }` (not `schedule`, and not positional arguments), and its jobs are session-scoped and expire after 7 days; docs no longer say they survive restarts. Use `/schedule` or an OS scheduler for that.
- Fix: `ScheduleWakeup` examples now include the required `prompt`; the 270s heartbeat is documented as applying to the 5-minute cache TTL, with 1200-1800s for sessions on the 1-hour TTL.
- Fix: `hooks_worker-dispatch` has no `scope` field (use `context`); `/ruflo-schedule` no longer claims to be `/schedule`; map interval aligned to 270s; invalid `--train-neural` flag removed.

## 0.3.3 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.3.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.3.1 — 2026-10-04
- fix: live-check W5 — guards read key names and every field; trader gates the package's real order tools

## 0.3.0 — 2026-10-04
- feat: jujutsu, knowledge-graph, loop-workers, market-data, metaharness as mods (ADR-445)

## 0.2.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 2 — ruflo-loop-workers: drop invalid --train-neural flag from post-task example
- chore: darwin-plugins iter 1 — ruflo-loop-workers: list all 12 workers in /ruflo-loop command (was 7, plugin.json contract is 12)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-04
- feat: v0.2.0 — adopt plugin contract + 12-worker trigger map (ADR-0001)
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
- fix: rename plugin commands to avoid built-in conflicts; bump default Opus to 4.7

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
