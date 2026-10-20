# Changelog: ruflo-ruvllm

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.6 — 2026-10-14
- fix: document the `@ruvector/ruvllm-wasm` add-on that the WASM-backed `ruvllm_*` tools need (README Requirements, `llm-config` and `chat-format` skills); the CLI now returns an install hint instead of a bare ERR_MODULE_NOT_FOUND (#4149)

## 0.3.5 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.4 — 2026-10-11
- fix: chat-format claimed Claude/GPT/Gemini/Ollama/Cohere provider formatting; the tool formats local-model templates (llama3, mistral, chatml, phi, gemma, or a model id) and the WASM HNSW router holds about 11 patterns
- fix: llm-config described MicroLoRA as saved adapter weights trained on data; instances are in-process, lost on MCP restart, and adapt from a 0-1 quality signal; /ruvllm status describes what ruvllm_status really returns

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

## 0.2.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 2 — ruflo-ruvllm: align chat-format argument-hint with 5 supported providers
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-04
- feat: v0.2.0 — adopt plugin contract + cross-plugin tool ownership table (ADR-0001)
- feat: ADR-098 Part 4 — standardize neural-learning hook
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
