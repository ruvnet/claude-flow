# Changelog: ruflo-agentdb

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-agentdb`.

## 0.4.10 — 2026-10-14
- fix: the README no longer says the smoke script "calls each documented MCP tool": the default run is an offline structure and documentation check, and `smoke.sh --live` now really exercises the CLI in a temp directory (`agentdb_health` must report available and durable; a `agentdb_hierarchical-store` then `agentdb_hierarchical-recall` round trip must return the entry; the old L1 called a `claude-flow mcp call` command that does not exist) (#4133, thanks @ronmikailov)

## 0.4.9 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.4.8 — 2026-10-11
- fix: vector-search no longer cites the retired 12,500x headline as current and no longer claims millions-of-vectors capacity that was never measured (measured at N=5k and N=20k)
- fix: agentdb tool count corrected from 15 to 20; documented the graph-query, graph-pathfinder and the three destructive delete tools (with a confirm-first rule)
- chore: ruvector pin 0.2.25 -> 0.2.27 in the agent doc, matching the CLI's own dependency

## 0.4.7 — 2026-10-05
- fix: NFKC-fold recalled memories and judge key/value pairs before attaching (ADR-450 T5), 0.4.7

## 0.4.6 — 2026-10-05
- feat: screen the file memory_import reads (0.4.6)

## 0.4.5 — 2026-10-05
- feat: guard four more free-text writers (0.4.5)

## 0.4.4 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.4.3 — 2026-10-04
- fix: guard reads name/value pairs and refuses inputs past the screen budgets (0.4.2)
- chore: bump the six plugins whose version collided with main after merge

## 0.4.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)

## 0.4.1 — 2026-10-04
- feat: AgentDB mod section on the Memory page + Help guide (0.31.0)
- fix: live-verified recall (0.4.1) + live harness and validation report
- fix: frame cannot be closed from inside a memory; zero-width chars cannot hide a secret (security review)
- fix: command is /agentdb-mod; reader fallthrough + keyword retry (found by a live run)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.4.0 — 2026-10-04
- feat: AgentDB as a mod (ADR-445)
