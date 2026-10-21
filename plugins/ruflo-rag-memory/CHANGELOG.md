# Changelog: ruflo-rag-memory

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.7 — 2026-10-14
- fix: memory-search, the memory-specialist agent, `/recall` and `/ruflo-memory` no longer tell the model to run `ruvector search --hybrid` / `--graph-rag` (the ruvector CLI takes a database path and a `--vector` JSON array, not a text query); they use `memory search --type hybrid` and `--smart`, say plainly that this plugin has no text-query Graph RAG, and single-quote the query as untrusted shell input (#4153, thanks @rudycelekli for the PR and @ronmikailov for the report)

## 0.3.6 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.5 — 2026-10-11
- fix: `npx ruflo recall` and `npx ruflo memory bridge` do not exist; docs use `memory search -q`, `/recall`, `memory_import_claude` and the auto-memory helper
- fix: the recall command put user text inside double quotes in a shell command (`$(...)` would run) and suggested `npx ruvector search --hybrid`, which is not a valid call; it now single-quotes the query and uses `memory search --smart` / `--type hybrid`

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
- feat: adopt plugin contract — claude-memories reserved-namespace consumer (ADR-0001)
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 3 — ruflo-rag-memory: replace remaining unverified HNSW perf table with measured audit numbers
- chore: darwin-plugins iter 2 — ruflo-rag-memory: replace unverified 150x-12,500x HNSW claim with measured numbers from intelligence audit
- chore: darwin-plugins iter 1 — ruflo-rag-memory: replace unverified 150x-12,500x HNSW claim with measured numbers
- chore: darwin: iter 22 advance — memory documentation (Quick Start + EXAMPLES.md)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-03
- feat: ADR-098 Part 1 (slice 2/4) — encryption-at-rest notes for memory plugins
- feat: wire SmartRetrieval (ADR-090) into production memory pipeline
- feat: upgrade neural-trader, ruvector, rag-memory plugins to wrap npm packages
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
- fix: rename plugin commands to avoid built-in conflicts; bump default Opus to 4.7

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
