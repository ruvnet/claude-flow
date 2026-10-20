# Changelog: ruflo-market-data

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.5 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.4 — 2026-10-11

- Fix: candles were routed into the `ruvllm_hnsw_*` router, which the tool documents as holding about 11 patterns. Candle history is now retrieved by key from the `market-data` namespace; the router is described as a small prototype classifier; `ruflo-ruvector` is the pointer for nearest-neighbour search over history.
- Security: ingest treats the feed as untrusted data (numeric fields only, reject non-finite rows, never act on feed text). Added a note that the plugin does analysis only and places no orders. Removed invalid `neural train --pattern-type market-data` and `--train-neural`.

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
- feat: jujutsu, knowledge-graph, loop-workers, market-data, metaharness as mods (ADR-445)

## 0.2.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 3 — ruflo-market-data: align market patterns command with SKILL.md dual-path store
- chore: darwin-plugins iter 1 — ruflo-market-data: fix market ingest cmd to use memory_store (hierarchical-* ignores namespace)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-04
- fix: v0.2.0 — fix 3 functional bugs (embeddings_embed + namespace-routing) + adopt plugin contract (ADR-0001)

## 0.1.0 — 2026-04-29
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
