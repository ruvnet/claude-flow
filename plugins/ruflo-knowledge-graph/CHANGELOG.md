# Changelog: ruflo-knowledge-graph

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.6 — 2026-10-14
- fix: kg-traverse reads edges with `agentdb_graph-query` (k-hop) and `agentdb_graph-pathfinder`, not the write-only `agentdb_causal-edge`; it no longer calls `agentdb_context-synthesize` (entity records are not validated task episodes, so it always answered `no-eligible-episodes`) and says what to do when encryption at rest (RFE1) makes the graph unreadable; the graph-navigator agent lists the same read tools (#4135, #4161, thanks @ronmikailov)

## 0.3.5 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.4 — 2026-10-11

- Fix: relation weights in the `graph-navigator` agent disagreed with `kg-extract` (imports 1.0 vs 0.9, implements 0.9 vs 0.7, references 0.5 vs 0.3) and omitted `type-depends-on`; aligned to the skill. Removed invalid `neural train --pattern-type knowledge-graph` (the flag is `--pattern` with a fixed set of values) and `--train-neural`.

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
- fix: #2049 — separate `import type` from value imports + drop disabled semantic-route + CI guard
- fix: correct embeddings_embed → embeddings_generate + adopt plugin contract (ADR-0001)
- chore: darwin-plugins iter 3 — ruflo-knowledge-graph: flag semantic-route as disabled in agent tool list (matches kg.md + ADR-0001)
- chore: darwin-plugins iter 2 — ruflo-knowledge-graph: fix README namespace claim (kg-graph → knowledge-graph) to match actual code
- chore: darwin-plugins iter 1 — ruflo-knowledge-graph: kg search uses pattern-search (semanticRouter disabled per #2049)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-03
- feat: ADR-098 Part 1 (slice 4/4) — G7 controllers in agentdb + knowledge-graph

## 0.1.0 — 2026-04-29
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
