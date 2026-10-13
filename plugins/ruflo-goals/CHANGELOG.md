# Changelog: ruflo-goals

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.4.5 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.4.4 — 2026-10-11
- fix: dossier-collect and dossier-investigator treat fetched web text as untrusted data: AIDefence screening, no instruction following, public http(s) hosts only, writes confined to the dossier output; aidefence_scan and aidefence_is_safe added to dossier-collect allowed-tools
- fix: ADR cross-link repaired; smoke expectation corrected to 16

## 0.4.3 — 2026-10-07
- fix: research-list runs the installed ruflo CLI before npx @latest
- chore: 3.55.0 versions, leaf pins, lockfiles, plugin bumps, changelog

## 0.4.2 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.4.1 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.4.0 — 2026-10-04
- feat: goals, graph-intelligence, intelligence, iot-cognitum as mods

## 0.3.0 — 2026-10-04
- feat: capped, screened deep-research with run marker and research record (ADR-438)
- chore: bump ruflo-console 0.28.0, ruflo-goals 0.3.0, ruflo-mods 0.1.1; baseline research.test.ts

## 0.2.1 — 2026-07-16
- feat: adopt plugin contract — legacy-vs-canonical namespace mapping + ADR-099 anchor (ADR-0001)
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- fix: resolve 5 issues from May 1-3 (#1697 #1698 #1686 #1691 #1694)
- chore: darwin-plugins iter 3 — ruflo-goals: sync smoke-check description with Accepted ADR status
- chore: darwin-plugins iter 2 — ruflo-goals: fix invalid --train-neural flag on post-task (belongs to post-edit)
- chore: darwin-plugins iter 1 — ruflo-goals: use memory_list (not memory_search '*') in /goals
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-03
- feat: dossier-investigator agent + dossier-collect skill (ADR-099)
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
- fix: add $ARGUMENTS to goals command for Claude Code plugin convention
- chore: refine: expand ruflo-goals agents with full methodology and MCP tool guidance

## 0.1.0 — 2026-04-27
- feat: add ruflo-goals plugin — GOAP planning, deep research, horizon tracking
