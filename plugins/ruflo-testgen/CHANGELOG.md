# Changelog: ruflo-testgen

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.3 — 2026-10-12
- fix: tdd-workflow reports the observed validation outcome to `hooks_post-task` instead of a literal `success: true` (#4085)

## 0.3.2 — 2026-10-11
- fix: tdd-repair now enforces that the failing test is not edited (original bytes restored, attempt scored failed with `test-file-modified`) instead of only asking in the prompt, with a node:test; docs no longer claim Bash is a sandbox with no network or arbitrary writes
- fix: testgen command put user text inside double quotes in shell commands; test-gaps used a `--limit` flag `coverage-gaps` does not have

## 0.3.1 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…

## 0.3.0 — 2026-10-04
- feat: function-hook mod (guard, status file, local slash command)

## 0.2.1 — 2026-07-16
- feat: Test-Driven Repair via headless `claude -p` (ADR-175-inspired)
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 3 — ruflo-testgen: smoke step 2 covers new tdd-repair skill
- chore: darwin-plugins iter 2 — ruflo-testgen: fix stale namespace name in ADR (testgen-gaps → test-gaps)
- chore: darwin-plugins iter 1 — ruflo-testgen: add 'Use when' trigger guidance to test-gaps skill description (ADR-112)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-04
- feat: v0.2.0 — adopt plugin contract + SPARC Refinement-phase ownership (ADR-0001)
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
