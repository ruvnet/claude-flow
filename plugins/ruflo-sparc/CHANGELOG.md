# Changelog: ruflo-sparc

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

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
- fix: live-check W5 — guards read key names and every field; trader gates the package's real order tools

## 0.3.0 — 2026-10-04
- feat: function-hook mod (guard, status file, local slash command)

## 0.2.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 3 — ruflo-sparc: correct sparc-implement description to name actual SPARC phases (Pseudocode + Architecture)
- chore: darwin-plugins iter 2 — ruflo-sparc: fix namespace count (4→3 owned + patterns consumed)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-04
- feat: v0.2.0 — adopt plugin contract + phase-to-plugin alignment table (ADR-0001)
- feat: ADR-098 Part 4 — standardize neural-learning hook
- fix: rename plugin commands to avoid built-in conflicts; bump default Opus to 4.7

## 0.1.0 — 2026-04-29
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
