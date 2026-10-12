# Changelog: ruflo-aidefence

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.2 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.3.1 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.3.0 — 2026-10-04
- feat: mod (guard/status/command) as function hooks, ADR-445 pattern

## 0.2.1 — 2026-07-16
- feat: adopt plugin contract + canonicalize 3-gate pattern (ADR-0001)
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 2 — ruflo-aidefence: declare allowed-tools on /aidefence command
- chore: darwin-plugins iter 1 — ruflo-aidefence: add ADR-112 'Use when' guidance to SKILL descriptions
- chore: aidefence 2.3.0 surface in ruflo-aidefence/-browser/-federation READMEs
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-03
- feat: ADR-098 Part 1 (slice 1/3) — capability sync for security plugins
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
