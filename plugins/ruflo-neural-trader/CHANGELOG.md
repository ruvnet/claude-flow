# Changelog: ruflo-neural-trader

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.6 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.5 — 2026-10-11

- Fix (checked by running neural-trader 2.8.11 offline): `--regime-detect`, `--var`, `--indicators`, `--correlation`, `--position-sizing` (standalone), `--risk-tolerance`, `--sector-analysis`, `--model X --symbol T` (without `--train`/`--predict`), `--strategy X --create` and `--broker`/`--swarm` all answer "Unknown command". Docs now use the handled forms (`--regime`, `--risk assess --returns`, `--train`, `--predict`, `--strategy-create`) and say which features have no CLI flag.
- Fix: several handlers return demo output (`--regime` classifies a built-in sample, `--risk assess` without `--returns` uses a 7-value sample, `--portfolio` returns equal weights, `--train`/`--predict` return `upstreamStub: true`). Skills now require reading `dataSource`/`note`/`upstreamStub` and not presenting demo output as market analysis.
- Safety: backtests and signal scans run on synthetic bars unless `--live` is passed (and silently fall back to them if the fetch fails). `trader-backtest` now refuses to sign a result for paper-to-live promotion when any `dataSource` is not `yahoo-finance`. The `live` command is documented as unavailable (no broker path exists in 2.8.11); nothing enforces circuit breakers automatically, and the risk-analyst docs no longer claim it does.
- Fix: `trader-signal` used `expiresAt` (not a `memory_store` parameter, so signals never expired); it is `ttl` in seconds. `neural_train` takes `modelType`, `agentdb_pattern-store` takes `{ pattern, type, confidence }`.

## 0.3.4 — 2026-10-05
- fix: a domain plugin's refusal of another plugin's memory_store no longer claims the write (variant B, review #8)

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
- feat: migrations, music, neural-trader, observability as mods (tighten-only guard, /<x>-mod, status file)

## 0.2.1 — 2026-07-16
- feat: #48 — benchmark suite (signal, backtest, memory-recall)
- feat: #55 — wire native sublinear CG dispatch (40-60× when available)
- feat: #2068 ADR-126 Phase 6 — feature attribution via single-entry PR
- feat: #2068 ADR-126 Phase 5 — SendMessage risk-gate pipeline
- feat: #2068 ADR-126 Phase 4 — Ed25519-signed backtest artifacts
- feat: #2068 ADR-126 Phase 3 — portfolio CG via sublinear/solve (40-60x)
- feat: #2068 ADR-126 Phase 2 — ADR-125 memory lifecycle (TTL + dedup + warm HNSW doc)
- feat: adopt plugin contract — already-compliant namespaces + 4-namespace claim (ADR-0001)
- chore: and 15 more changes (git log -- plugins/ruflo-neural-trader)

## 0.2.0 — 2026-04-30
- feat: upgrade neural-trader, ruvector, rag-memory plugins to wrap npm packages

## 0.1.0 — 2026-04-29
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
