# Changelog: ruflo-iot-cognitum

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.4 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.3 — 2026-10-11

- Security: `npx -y -p @claude-flow/plugin-iot-cognitum@latest` replaced with the pinned `@1.0.0` (the CLI controls real fleets; `@latest` ran whatever was published last).
- Safety: `iot-firmware` (deploy/advance/rollback) and `iot-fleet delete` now require the fleet, version and stage to be stated and explicitly confirmed by the user; `advance` requires a clean canary `status` + `iot-anomalies` check first. Removed invalid `--train-neural` flag from agent examples.

## 0.3.2 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.3.1 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.3.0 — 2026-10-04
- feat: goals, graph-intelligence, intelligence, iot-cognitum as mods

## 0.2.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 2 — ruflo-iot-cognitum: correct stale source-file count (32→39)
- chore: darwin-plugins iter 1 — ruflo-iot-cognitum: add 'Use when' trigger guidance to iot-anomalies skill (ADR-112)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-04
- feat: v0.2.0 — adopt plugin contract (ADR-0001, federation trust-model parallel, smoke)

## 0.1.1 — 2026-05-03
- feat: ADR-098 Part 4 — standardize neural-learning hook
- feat: full-coverage smoke + iot query/ingest fixes; link to cognitum.one (1.0.0-alpha.4)
- feat: ship @claude-flow/plugin-iot-cognitum@1.0.0-alpha.2 with cognitum-iot bin
- chore: ADR-098 Part 2 (slice 1/4) — token diet for iot-cognitum/device-coordinator

## 0.1.0 — 2026-04-29
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
