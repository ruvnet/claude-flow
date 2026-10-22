# Changelog: ruflo-intelligence

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.4.5 — 2026-10-14
- fix: neural-train step 6 passes `data` (neural_train only learns from it and now answers `success: false, status: "empty"` without it), and step 8 says `neural_patterns`/`neural_predict` do not see what trajectories, SONA and the ReasoningBank learned (a separate store; check it with `hooks_intelligence_pattern-search` / `hooks_intelligence_stats`) and that `neural_predict` applies a similarity floor (#4156); intelligence-transfer uses the top-level `transfer-store` command (the nested `hooks transfer store <sub>` only printed help) and warns that the built-in genesis registry is an offline placeholder, not signed or popular data (#4157; thanks @ronmikailov)

## 0.4.4 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.4.3 — 2026-10-11

- Fix: skills, commands and README called tools and CLI flags that do not exist or have different parameters (checked against `@claude-flow/cli` 3.56.5 `--help` and the MCP tool schemas): `neural_train` needs `modelType` (there is no `patternType`/`--pattern-type`; the CLI flag is `--pattern`), `neural patterns --list` is `--action list`, `hooks pretrain`/`build-agents`/`explain` flags, `hooks_model-outcome` takes `{ task, model, outcome }`, `hooks_intelligence_trajectory-end` takes a boolean `success`, `ruvllm_microlora_adapt` has no consolidate option (EWC++ runs in `hooks_intelligence_learn`), and `mcp tool call` is `mcp exec -t TOOL -p JSON`.
- Fix: `intelligence-transfer` claimed `hooks_transfer` publishes to and loads from IPFS by CID. It only copies patterns from another local project (`{ sourcePath, filter, minConfidence }`); marketplace browse/download/publish is `hooks transfer store ...` and needs `PINATA_API_KEY` + `PINATA_API_SECRET`. The skill is rewritten accordingly, with a PII scan and explicit confirmation before any publish.
- Fix: `hooks_intelligence` is a status call (it echoes `mode`); the README no longer says it switches architecture. Removed the invalid `post-task --train-neural` flag from examples.

## 0.4.2 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.4.1 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.4.0 — 2026-10-04
- feat: goals, graph-intelligence, intelligence, iot-cognitum as mods

## 0.3.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- chore: darwin-plugins iter 3 — ruflo-intelligence: align plugin.json tool-count breakdown with README inventory
- chore: darwin-plugins iter 1 — ruflo-intelligence: correct Tier 1 to deterministic codemod (ADR-143)

## 0.3.0 — 2026-05-04
- feat: v0.3.0 — surface completeness, 4-step pipeline, IPFS transfer, namespace coordination
- feat: ADR-098 Part 4 — standardize neural-learning hook
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
