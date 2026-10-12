# Changelog: ruflo-metaharness

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.2.5 — 2026-10-09
- fix: seven harness-* skill descriptions no longer carry angle-bracket placeholders (claude.ai strips them as XML tags)

## 0.2.4 — 2026-10-07
- fix: run the installed ruflo CLI before `npx @claude-flow/cli@latest` in cost-tracker, adr and metaharness
- chore: 3.55.0 versions, leaf pins, lockfiles, plugin bumps, changelog

## 0.2.3 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.2.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: MetaHarness parse bench ceiling 30us on the median — the CI runner's p50 is 6us for the 5-finding payload
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- fix: gate the parseMcpScanText perf bench on the median, not the mean
- chore: keep the perf bench's output when its smoke step fails
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.2.1 — 2026-10-04
- fix: live-check W5 — guards read key names and every field; trader gates the package's real order tools

## 0.2.0 — 2026-10-04
- feat: jujutsu, knowledge-graph, loop-workers, market-data, metaharness as mods (ADR-445)
- feat: add ADR-324 agentic policy engine
- fix: handle help and reject unknown arguments before execution
- fix: use the @metaharness/* and ruflo CLI already installed instead of npm-installing at tool-call time
- fix: address #3045 #3064 #3065 + new ruflo-deepseek-harness plugin (3.38.13)
- fix: complete reports and consistent initialization for v3.32.37
- fix: resolve current runtime and verification defects for v3.32.36
- chore: MetaHarness hardening: repair the dependency contract + strict sequential promotion evidence
- chore: and 1 more changes (git log -- plugins/ruflo-metaharness)

## 0.1.1 — 2026-07-16
- feat: review-driven upgrades — perf, security, SOTA capabilities (6-agent concurrent implementation)
- feat: learn + gepa integration — metaharness@0.3.0 / darwin@0.8.0 (15 MCP tools)
- feat: integrate @metaharness/redblue@~0.1.1 — adversarial red/blue LLM testing
- feat: integrate @metaharness/darwin@0.3.1 + bump umbrella to 0.2.6
- feat: generatedAt timestamp on all --format json outputs (iter 112)
- feat: drift-from-history table surfaces path + wall (iter 96)
- feat: drift-from-history exposes derived timing.path label (iter 95)
- feat: weekly cron uses iter-78 alert-on-new-severity (iter 79)
- chore: and 122 more changes (git log -- plugins/ruflo-metaharness)

## 0.1.0 — 2026-06-16
- feat: Phase 1 MVP plugin — 5 skills + ADR-150 constraint enforcement (iter 1)
