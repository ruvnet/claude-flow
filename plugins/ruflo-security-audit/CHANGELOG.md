# Changelog: ruflo-security-audit

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.5 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.4 — 2026-10-11
- fix: security-auditor listed `security report` (not a subcommand) and `security audit --include-dev` (audit is the audit-log store with `--action log|list|export|clear`); tool list corrected
- fix: security-scan depth table described phases the scanner does not have; it now states what `--depth` changes (directory levels for the secrets and code-pattern phases) and tells the model to verify each finding before reporting it
- fix: dependency-check `--fix` needs the user's go-ahead and a clean git tree; audit command validates depth and target before shelling out

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
- feat: function-hook mod (guard, status file, local slash command)

## 0.2.1 — 2026-07-16
- feat: adopt plugin contract — AIDefence static/runtime layered integration (ADR-0001)
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 4 — ruflo-security-audit: --depth full → --depth deep (CLI doesnt support full)
- chore: darwin-plugins iter 3 — ruflo-security-audit: align memory_store namespace to documented security-findings
- chore: darwin-plugins iter 2 — ruflo-security-audit: fix invalid CLI flags (depth=deep not full, drop nonexistent --include-dev / cve --fix / secu…
- chore: darwin-plugins iter 1 — ruflo-security-audit: add ADR-112 'Use when' guidance to skill descriptions
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-03
- feat: ADR-098 Part 1 (slice 1/3) — capability sync for security plugins

## 0.1.1 — 2026-05-03
- feat: ADR-098 Part 3 — security-auditor opus → sonnet
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
