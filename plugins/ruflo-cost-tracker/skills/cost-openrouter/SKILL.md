---
name: cost-openrouter
description: OpenRouter real spend — key limit and usage today/week/month, one request's billed cost by generation id, account credits. Use when asked what OpenRouter charged or whether a key is near its limit. Network and API key: asks first.
argument-hint: "key | generation <id> | credits"
allowed-tools: Bash
---

# Cost OpenRouter

Network skill. **Ask the user before running it**, and run it only with their yes.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/openrouter.mjs key --yes
node ${CLAUDE_PLUGIN_ROOT}/scripts/openrouter.mjs generation gen-abc123 --yes
node ${CLAUDE_PLUGIN_ROOT}/scripts/openrouter.mjs credits --yes
```

## Rules

- Without `--yes` the script prints the call it would make and sends nothing.
- The key comes from `OPENROUTER_API_KEY` (credits: `OPENROUTER_MANAGEMENT_KEY`). Never ask the user to paste a key, never print, log or write one.
- OpenRouter's `usage.cost` / `total_cost` is **authoritative**; do not recompute it from list prices.
- `credits` needs a management key (a normal key returns 403). A fresh generation can 404 briefly: retry.
- BYOK rows carry the 5% OpenRouter fee in `usage`, the provider's charge in `upstream_inference_cost`: show both, labelled.
- Fallback and `openrouter/auto` can change the billed model: report `model` and `provider_name` as returned.
