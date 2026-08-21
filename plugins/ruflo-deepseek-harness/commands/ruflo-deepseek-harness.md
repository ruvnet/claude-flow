---
name: ruflo-deepseek-harness
description: DeepSeek harness integration — chat and reasoning-mode completions via the OpenAI-compatible DeepSeek API, wrapped as ruflo skills with graceful degradation (ADR-150 pattern)
---

DeepSeek harness commands. All shell out to
[`scripts/_deepseek.mjs`](../scripts/_deepseek.mjs) which hits DeepSeek's
`https://api.deepseek.com/v1/chat/completions` endpoint using
`DEEPSEEK_API_KEY` from the environment. The plugin never becomes a hard
runtime dependency of ruflo — with the key unset or the API unreachable
every script exits 0 with a `{ status: 'degraded', reason }` envelope,
matching the ADR-150 removability contract used by the sibling
`ruflo-metaharness` plugin.

**`deepseek chat --prompt <text> [--system <text>] [--model deepseek-chat] [--temperature 0.7] [--max-tokens 1024] [--format table|json] [--alert-on-error]`** — one-shot completion against the non-reasoning `deepseek-chat` model.
1. Run `node plugins/ruflo-deepseek-harness/scripts/chat.mjs --prompt "..."`
2. Emits `{ status, model, content, finishReason, usage }` as JSON (default) or the bare content (`--format table`)
3. `--alert-on-error` exits 1 on any degraded/error status — CI-friendly gate
4. See [`skills/deepseek-chat/SKILL.md`](../skills/deepseek-chat/SKILL.md)

**`deepseek reason --prompt <text> [--system <text>] [--model deepseek-reasoner] [--max-tokens 4096] [--show-reasoning] [--format table|json] [--alert-on-error]`** — reasoning-mode completion; separates `reasoning_content` (chain of thought) from `content` (final answer).
1. Run `node plugins/ruflo-deepseek-harness/scripts/reason.mjs --prompt "..."`
2. `temperature`/`top_p` are NOT forwarded — DeepSeek ignores them for reasoner models
3. JSON output always includes `reasoning` + a `reasoningTokens` cost breakdown; table mode omits reasoning unless `--show-reasoning` is passed
4. See [`skills/deepseek-reason/SKILL.md`](../skills/deepseek-reason/SKILL.md)

## Environment

- `DEEPSEEK_API_KEY` — required to actually call the API. Without it every
  script exits 0 with `{ status: 'degraded', reason: 'DEEPSEEK_API_KEY is not set' }`.
  Get a key at https://platform.deepseek.com.

## ADR-150 invariants (same as ruflo-metaharness)

1. **Removable** — `rm -rf plugins/ruflo-deepseek-harness/` must leave ruflo working.
2. **No hard dependency** — nothing in ruflo's `dependencies`. This plugin's
   scripts import only Node built-ins + `fetch` (Node 18+).
3. **Graceful degradation** — every script exits 0 with a JSON envelope on
   failure. Pass `--alert-on-error` to opt into hard failure for CI gates.
