# Changelog: ruflo-arena

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.2.6 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.2.5 — 2026-10-11
- fix: `/arena` told Claude to call MCP tools the plugin never registers (`arena/run`, ...), so a plain install could not run it. It now uses the CLI (`node dist/cli.js ...`, with the build prerequisite stated) and says so when it cannot run, instead of inventing results

## 0.2.4 — 2026-10-09
- chore: drop the unused `categories` key from plugin.json (claude.ai plugin validator warns on it; nothing read it)

## 0.2.3 — 2026-10-05
- fix: vitest suites in agntcy, arena and graph-intelligence are *.spec.ts so claude plugin test collects only the kit tests

## 0.2.2 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.2.1 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.2.0 — 2026-10-04
- feat: mod (guard/status/command) as function hooks, ADR-445 pattern

## 0.1.0 — 2026-07-16
- feat: add ruflo-arena — competitive ruliology (arenas, tournaments, co-evolution)
- fix: post-merge review patches for #2315 (5 items)
- chore: darwin-plugins iter 3 — ruflo-arena: align README evolve example with CLI default (300, not 400)
- chore: darwin-plugins iter 1 — ruflo-arena: add ADR-112 'Use when' guidance to run/get and run/list descriptions
