# Changelog: ruflo-agent

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.4 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.3 — 2026-10-11
- fix: the four nested-queen agents passed `content:`/`namespace:` to `aidefence_scan` and `aidefence_is_safe`, whose required parameter is `input`; the screen would have failed validation instead of scanning. Now `input:`, and a failed or unavailable scan is treated as unsafe
- fix: nested-queen agents documented a `ruflo cost` command, a `queen` role for `hive-mind_spawn`, `scope`/`depth_remaining` parameters on the claims tools and `byzantine` as a `hive-mind_consensus` strategy; none exist. Added a verified call-shape table and a note that scope reduction and the depth cap are not enforced by the claims tools
- docs: README tool count corrected (27 WASM tools, 6 managed-agent tools)

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
- feat: ADR-147 nested subagent (depth=5) infrastructure + P2 stage 1
- fix: harden hooks, statusline, security, and plugin MCP integration
- chore: darwin-plugins iter 2 — ruflo-agent: document nested-subagents skill in README
- chore: bring README up to date for the managed (cloud) runtime

## 0.2.0 — 2026-05-12
- feat: rename ruflo-wasm → ruflo-agent + Claude Managed Agents (cloud) runtime — ADR-115 (proposed→accepted, implemented)
