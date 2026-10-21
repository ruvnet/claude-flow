# Changelog: ruflo-adr

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-adr`.

## 0.5.8 — 2026-10-14
- fix: the ADR parser reads the leading status keyword, so `superseded by [ADR-025](…) (date)`, `accepted (date) — note` and `Accepted (date) · **AMENDED …**` are no longer indexed as Unknown (adr-review enforces only accepted ADRs, so those ADRs were being skipped); `superseded by ADR-X` now records the supersedes edge; README.md, index.md and template*.md files in docs/adr are no longer indexed as ADRs; `adr-verify` reports any ADR left at Unknown (exit 1 under VERIFY_STRICT=1) (#4126, thanks @ronmikailov)

## 0.5.7 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.5.6 — 2026-10-11
- fix: adr-review, `adr graph` and the adr-architect agent called `agentdb_causal-query` and `agentdb_hierarchical-query`, which are not tools; relationships are now read from the `adr-edges` memory namespace (`memory_list`) and the hierarchical lookup uses `agentdb_hierarchical-recall`

## 0.5.5 — 2026-10-11
- fix: keep the last ADR's Context when the file ends without a following heading, and keep literal `Z` characters (#4027, thanks @rudycelekli)
- fix: scan each real directory once so symlink cycles cannot loop (#4034, thanks @rudycelekli)

## 0.5.4 — 2026-10-07
- fix: run the installed ruflo CLI before `npx @claude-flow/cli@latest` in cost-tracker, adr and metaharness
- fix: use a key separator the memory validator accepts for edges
- chore: 3.55.0 versions, leaf pins, lockfiles, plugin bumps, changelog
- chore: smoke step 20 counts spawnCliSync() memory calls too

## 0.5.3 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.5.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.5.1 — 2026-10-04
- fix: live-check guard defects in 8 plugins (adr, ddd, federation, deepseek, browser, bbs, chatgpt, pods)

## 0.5.0 — 2026-10-04
- feat: mod (guard/status/command) as function hooks, ADR-445 pattern
- fix: repair CI regressions surfaced by the integrated community fixes
- fix: retain qualified relations without parsing narrative as edges
- fix: fail closed when verification cannot read a complete graph
- fix: use project root for imports and fail on write errors
- fix: skip .brain when walking for ADRs (#2911)
- fix: complete reports and consistent initialization for v3.32.37
- fix: tracker-sweep 2026-07-26 (v3.32.10) — 9 bugs + promo seed + follow-ups
- chore: and 1 more changes (git log -- plugins/ruflo-adr)

## 0.4.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration

## 0.4.0 — 2026-07-14
- feat: reconcile deleted ADRs — hard-delete primitive + drop-and-rebuild reindex
- feat: split cli into cli-core (lite) + cli (umbrella) — alpha.5
- fix: 3 user-reported bugs — #2469 SKILL.md markdown, #2473 witness drift, #2474 ADR importer
- chore: darwin-plugins iter 3 — ruflo-adr: fix misleading verify.mjs exit-code header comment
- chore: darwin-plugins iter 2 — ruflo-adr: fix stale skills table + smoke count (3→4 skills, 10→15 tests)
- chore: darwin: iter 5 adr-coverage — handle full-bold MADR status style **Status: Value**

## 0.3.0 — 2026-05-05
- feat: one-shot import + verify scripts (v0.3.0)
