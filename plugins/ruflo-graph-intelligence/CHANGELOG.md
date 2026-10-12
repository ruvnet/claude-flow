# Changelog: ruflo-graph-intelligence

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.2.0-alpha.5 — 2026-10-09
- chore: drop the unused `categories` key from plugin.json (claude.ai plugin validator warns on it; nothing read it)

## 0.2.0-alpha.4 — 2026-10-05
- fix: vitest suites in agntcy, arena and graph-intelligence are *.spec.ts so claude plugin test collects only the kit tests

## 0.2.0-alpha.3 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.2.0-alpha.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.2.0-alpha.1 — 2026-10-04
- feat: goals, graph-intelligence, intelligence, iot-cognitum as mods
- feat: ADR-130 — unified graph intelligence backend (P1-P6)
- fix: 5 CI failures — Build V3, Static guards, ADR-112, witness verify, supply-chain audit
- fix: make plugin.json repository field a string
- chore: darwin-plugins iter 2 — ruflo-graph-intelligence: remove broken bench script (missing scripts/benchmark-substrate.mjs)
- chore: darwin-plugins iter 1 — ruflo-graph-intelligence: add ADR-112 'Use when' guidance to 5 MCP tool descriptions
- chore: bump vitest in /plugins/ruflo-graph-intelligence

## 0.1.0-alpha.1 — 2026-05-18
- feat: #2044 ADR-123 Phases 6.5+7 — streaming bridge + signed PR artifacts (beyond-SOTA)
- feat: #2044 ADR-123 Phases 5+6 — portfolio CG + AIDefence + jujutsu + JL + GOAP-LP
- feat: #2044 ADR-123 Phases 2-4 — 5 adapters across 5 wedges
- feat: #2044 ADR-123 Phase 1 — ruflo-graph-intelligence plugin foundation
