# Changelog: ruflo-ai-team

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-ai-team`.

## 0.3.0 — 2026-10-09
- feat: skills, commands and agents name the connector tools in plain language instead of Claude Code namespaced identifiers (allowed-tools lists only the portable Read tool; the repo audit requires the field), so they read correctly on claude.ai and Cowork
- feat: lifecycle skill covers run_complete (the tasks_incomplete rule); skills state the real status values, template ids and budget range
- feat: README gains examples per surface, what you need, how auth works and what leaves your machine, and troubleshooting
- fix: descriptions lead with what the item does and when to use it, with no angle brackets, and drop wording the service cannot back
- fix: directory bundle skills, commands and agents resynced with the plugin (bundle manifest 0.1.0 to 0.2.0, two added keywords)
- chore: smoke asserts no namespaced tool names, no angle brackets in descriptions, README examples use real commands, bundle copies identical

## 0.2.3 — 2026-10-09
- fix: documentationUrl points at the main branch path, not the feat/ruflo-ai-team branch

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

## 0.1.6 — 2026-09-30
- chore: version the #3556 fix as 0.1.6

## 0.1.5 — 2026-09-30
- fix: explicit CORS allowlist and documented public discovery

## 0.1.4 — 2026-09-29
- fix: enlarge workspace rail and restore evidence view

## 0.1.3 — 2026-09-29
- feat: unify ChatGPT workspace navigation

## 0.1.2 — 2026-09-29
- feat: style board as ruOS desktop workspace
