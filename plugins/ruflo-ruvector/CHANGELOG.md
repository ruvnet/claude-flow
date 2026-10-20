# Changelog: ruflo-ruvector

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-ruvector`.

## 0.3.7 — 2026-10-14
- fix: `vector-hyperbolic` no longer claims a normalised text embedding encodes depth (every unit-norm vector lands at the same radius); it now says to set radius from depth and measure on your own tree (#4159, thanks @ronmikailov)

## 0.3.6 — 2026-10-14
- fix: pin ruvector@0.3.3, which bundles the ONNX wasm that 0.2.25 lacks, so `embed text` works with no add-on; drop the `ruvector-onnx-embeddings-wasm` remedy that never fixed it, and refresh the limitation tables against 0.3.3 (`optimize`, `force-learn`, `midstream` now run; 97 MCP tools) (#4158)

## 0.3.5 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

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
- feat: function-hook mod (ADR-445)

## 0.2.2 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- chore: darwin-plugins iter 3 — ruflo-ruvector: fix stale 103 MCP tool count in agent (missed by iter 2)
- chore: darwin-plugins iter 2 — ruflo-ruvector: correct MCP tool count 103→91 (verified via mcp tools)
- chore: darwin-plugins iter 1 — ruflo-ruvector: add ADR-112 'Use when' trigger to vector-engineer agent description

## 0.2.1 — 2026-05-04
- fix: pin ruflo-ruvector to ruvector@0.2.25 + expand verified CLI surface

## 0.2.0 — 2026-04-30
- feat: upgrade neural-trader, ruvector, rag-memory plugins to wrap npm packages
