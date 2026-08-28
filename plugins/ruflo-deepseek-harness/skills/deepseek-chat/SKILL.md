---
name: deepseek-chat
description: "One-shot chat completion against DeepSeek's `deepseek-chat` model via the OpenAI-compatible /v1/chat/completions endpoint. Reads DEEPSEEK_API_KEY from the environment; degrades gracefully (exit 0 with a JSON status:degraded envelope) when the key is missing or the API is unreachable. Use for non-reasoning tasks — summarization, extraction, quick classification — where deepseek-reasoner would be overkill."
argument-hint: "--prompt <text> [--system <text>] [--model deepseek-chat] [--temperature 0.7] [--max-tokens 1024] [--format table|json] [--alert-on-error]"
allowed-tools: Bash
---

Wraps DeepSeek's chat/completions endpoint in the same subprocess-invocation
shape as the other `ruflo-*-harness` skills (see ruflo-metaharness's
`harness-score` for the reference). No library import on ruflo's boot path.

## When to use

- You want a cheap, fast completion from a non-reasoning model.
- The task fits in a single request/response — no multi-turn context.
- You want the raw content back as JSON so downstream tooling can consume it.
- For reasoning-heavy tasks (proofs, multi-step planning, hard debugging),
  use `deepseek-reason` instead — same plugin, different model.

## Algorithm

Implementation: [`scripts/chat.mjs`](../../scripts/chat.mjs).

1. Read `DEEPSEEK_API_KEY` from env. If missing, emit
   `{ status: 'degraded', reason: 'DEEPSEEK_API_KEY is not set', ... }`
   and exit 0 (ADR-150-style graceful degradation).
2. POST to `https://api.deepseek.com/v1/chat/completions` with
   `{ model, messages, temperature?, max_tokens? }`. 60s hard timeout.
3. Extract `choices[0].message.content` and usage counters.
4. `--format table` prints only the content (for piping); `--format json`
   (default) returns the full envelope.
5. `--alert-on-error` exits 1 on any degraded/error status (CI-friendly).

## Example

```bash
node plugins/ruflo-deepseek-harness/scripts/chat.mjs \
  --prompt "In one sentence: what is HNSW?" \
  --temperature 0.2
```

Sample output:

```json
{
  "status": "ok",
  "model": "deepseek-chat",
  "content": "HNSW is a graph-based approximate nearest neighbor …",
  "finishReason": "stop",
  "usage": { "promptTokens": 12, "completionTokens": 34, "totalTokens": 46 }
}
```
