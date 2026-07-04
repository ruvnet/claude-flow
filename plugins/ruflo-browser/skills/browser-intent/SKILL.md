---
name: browser-intent
description: Execute a natural-language browser intent via page-agent (browser_act) when the target is easier to describe than to select — degrades gracefully when page-agent or an OpenAI-compatible LLM provider isn't configured
argument-hint: "<task-description> [--url <url>] [--session <id>]"
allowed-tools: mcp__claude-flow__browser_act mcp__claude-flow__browser_open mcp__claude-flow__browser_snapshot mcp__claude-flow__browser_close mcp__claude-flow__aidefence_has_pii mcp__claude-flow__aidefence_is_safe Bash Read
---

# Browser Intent

Natural-language layer on top of the low-level `browser_*` selector tools. Where `browser-extract` and `browser-form-fill` compose selector-based primitives (`browser_click`, `browser_fill`, `browser_snapshot`), `browser-intent` lets the caller say what they want ("Click the login button", "Fill the search box with cats and submit") and delegates execution to [page-agent](https://github.com/alibaba/page-agent) — in-page injected JS that turns the DOM into text and drives an LLM tool-call loop against it.

## When to use

- The target element is easier to describe in words than to select reliably (dynamic class names, ambiguous structure, A/B-tested markup).
- A one-shot interaction where writing out a selector chain isn't worth it.
- Prefer `browser_click` / `browser_fill` / `browser_snapshot` directly when you already know the exact selector or ref (`@e1`) — `browser_act` adds LLM latency + cost that a direct selector call doesn't.

## Steps

1. **Call `browser_act`** with a `task` string, and optionally `url` (navigates first) and `session` (default `"default"`):
   ```
   mcp__claude-flow__browser_act({
     task: "Click the login button",
     url: "https://example.com/account",
     session: "my-session"
   })
   ```
2. **Read the response contract**:
   - `{ success: true, result, steps, history, contentFlagged, llmSource }` — the intent executed. `result` is the AIDefence-gated final text page-agent produced; `history` is the full step trace (reflection + action + tool result per step); `steps` is `history.length`.
   - `{ success: true, degraded: true, reason, hint }` — page-agent isn't installed, or no OpenAI-compatible LLM provider is configured. **Never treat `degraded: true` as an error to retry** — surface the `hint` and fall back to selector-based `browser_*` tools instead.
   - `{ success: false, error, ... }` — a real failure (browser open failed, injection failed, execution timed out, or page-agent's own `execute()` reported `success:false`).
3. **On `contentFlagged: true`**, the returned `result` has already been redacted by AIDefence (PII or a prompt-injection/threat pattern was detected in the page-agent output) — do not attempt to recover the original text.
4. **Prefer a recorded session** (`browser-record`) when the interaction matters enough to replay later; `browser_act` itself does not open an RVF container — it operates on whatever session id you pass (or `"default"`).

## Provider requirements (why this degrades so often)

`page-agent` calls its LLM directly from the browser page context via a plain OpenAI-compatible `POST {baseURL}/chat/completions`. That means:

- A bare `ANTHROPIC_API_KEY` is **not sufficient** — Anthropic's native API is a different shape (`/v1/messages`).
- Configure one of: `OPENROUTER_API_KEY` (OpenRouter, OpenAI-compatible), `OLLAMA_API_KEY` (Ollama Cloud, OpenAI-compatible), or `CLAUDE_FLOW_PAGE_AGENT_BASE_URL` + `CLAUDE_FLOW_PAGE_AGENT_API_KEY` for a custom OpenAI-compatible endpoint.
- The real provider key **never** enters the page: `browser_act` starts a short-lived loopback HTTP proxy that holds the key server-side and injects the real `Authorization` header itself. The page only ever sees a `127.0.0.1` URL and a placeholder key string.

## Caveats

- `page-agent` is an `optionalDependencies` entry (`npm i page-agent` if the doctor/degraded hint asks for it) — this plugin stays fully operational without it; you simply lose the natural-language layer and fall back to selector-based tools.
- The npm bundle's demo auto-init tail (which would otherwise construct a second `PageAgent` instance against Alibaba's public test endpoint) is stripped before injection — you should never see traffic to a `page-ag-testing-*` host from this tool.
- Every successful `browser_act` call best-effort records the intent + resulting trajectory into the `browser` memory namespace (ADR-174 distillation loop). This is fire-and-forget — a memory-store failure never fails the tool call.
- `timeoutMs` (default 120000) bounds how long `browser_act` polls for `execute()` to settle; a slow multi-step intent may need a higher value.
