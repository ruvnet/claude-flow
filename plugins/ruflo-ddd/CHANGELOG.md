# Changelog: ruflo-ddd

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.6 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.5 — 2026-10-11
- fix: ddd-context, ddd-aggregate and REFERENCE.md store the domain graph with real tool parameters (agentdb_hierarchical-store key/value/tier plus agentdb_causal-edge sourceId/targetId/relation); the old `--parent/--child/--relation` form did not exist and failed on the required key/value
- fix: drop the invalid `--train-neural` post-task flag; smoke expectation corrected to 13

## 0.3.4 — 2026-10-08
- feat: native Codex hooks (`.codex-plugin`, `hooks/codex-hooks.json`, generated `codex-hook.cjs`) reusing the existing guard, screen and status functions
- fix: allow native freeform tool inputs in the Codex adapter and version the Codex hook repair

## 0.3.3 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.3.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.3.1 — 2026-10-04
- fix: live-check guard defects in 8 plugins (adr, ddd, federation, deepseek, browser, bbs, chatgpt, pods)

## 0.3.0 — 2026-10-04
- feat: function-hook mod (secret guard, /ddd-mod, status file)

## 0.2.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 2 — ruflo-ddd: fix malformed Bash() permission patterns in skill frontmatter
- chore: darwin-plugins iter 1 — ruflo-ddd: add 'Use when' guidance to skill descriptions (ADR-112)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-04
- feat: v0.2.0 — adopt plugin contract (ADR-0001, namespace coordination, smoke as contract)

## 0.1.1 — 2026-05-03
- chore: ADR-098 Part 2 (slice 2/4) — token diet for ruflo-ddd/domain-modeler

## 0.1.0 — 2026-04-29
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
