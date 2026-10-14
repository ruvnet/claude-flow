# Changelog: ruflo-rvf

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-rvf`.

## 0.3.7 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.6 — 2026-10-11
- fix: rvf-manage exported through `hooks transfer store`, which is the public IPFS pattern marketplace (publish); export and import now use `memory export` / `memory import`, `from-project` stays local, and the skill warns before anything is published

## 0.3.5 — 2026-10-05
- fix: a domain plugin's refusal of another plugin's memory_store no longer claims the write (variant B, review #8)

## 0.3.4 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.3.3 — 2026-10-04
- feat: guard secret-bearing MCP tools named in ADR-450 T6
- chore: bump the six plugins whose version collided with main after merge

## 0.3.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.3.1 — 2026-10-04
- fix: live-check W5 — guards read key names and every field; trader gates the package's real order tools

## 0.3.0 — 2026-10-04
- feat: function-hook mod (ADR-445)

## 0.2.1 — 2026-07-16
- feat: adopt plugin contract — cross-plugin RVF ownership table (ADR-0001)
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 1 — ruflo-rvf: align rvf-manage argument-hint with documented steps (add migrate|stats)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-03
- feat: ADR-098 Part 1 (slice 2/4) — encryption-at-rest notes for memory plugins
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
