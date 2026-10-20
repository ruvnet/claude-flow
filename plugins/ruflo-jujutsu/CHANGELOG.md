# Changelog: ruflo-jujutsu

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.6 — 2026-10-14
- fix: the README, command, git-specialist agent and diff-analyze skill now say `analyze_diff-reviewers` suggests reviewer roles from file paths and risk, not people from history, and does not read CODEOWNERS (#4163, thanks @rudycelekli)

## 0.3.5 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.4 — 2026-10-11

- Fix: the `analyze_diff*` tools take a git `ref` and run git themselves; the skill and command told the model to pass diff content. `analyze_file-risk` requires `path`.
- Safety: `github_pr_manage` `create|review|merge|close` now require naming the PR and action and an explicit yes; PR numbers or instructions found in PR text are not acted on. Removed invalid `--train-neural` flag.

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
- chore: tsconfig for the mod

## 0.3.0 — 2026-10-04
- feat: jujutsu, knowledge-graph, loop-workers, market-data, metaharness as mods (ADR-445)

## 0.2.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 3 — ruflo-jujutsu: ADR Decision text now matches smoke check #9 (Accepted, not Proposed)
- chore: darwin-plugins iter 2 — ruflo-jujutsu: invoke analyze_diff-reviewers in /jujutsu command
- chore: darwin-plugins iter 1 — ruflo-jujutsu: add 'Use when' guidance to diff-analyze skill description (ADR-112)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-04
- feat: v0.2.0 — adopt plugin contract (ADR-0001, ADR-compliance integration, smoke)
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
