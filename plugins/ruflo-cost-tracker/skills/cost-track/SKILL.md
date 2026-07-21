---
name: cost-track
description: Auto-capture per-session token usage from the Claude Code session jsonl and persist to the cost-tracking namespace
argument-hint: ""
allowed-tools: Bash mcp__plugin_ruflo-core_ruflo__memory_store
---

# Cost Track

Reads the active Claude Code session jsonl (`~/.claude/projects/<encoded-cwd>/<session>.jsonl`), tallies assistant-message `usage` per model, computes USD cost using REFERENCE.md pricing, and writes a structured record to the `cost-tracking` AgentDB namespace. This is the **producer** that gives `cost-report` and `cost-optimize` real data to consume.

## When to use

- After a meaningful chunk of work, to capture spend for the report.
- At session-end to persist the final tally.
- Periodically during long sessions (cron-friendly — see `/loop 30m`).

## Steps

1. **Run the tracker** from the project root:

   ```bash
   node plugins/ruflo-cost-tracker/scripts/track.mjs
   ```

   The script auto-discovers the session jsonl from the current working directory. To pin a specific session: `TRACK_SESSION=/path/to/session.jsonl`. To dry-run (no memory write): `TRACK_DRY_RUN=1`.

2. **Inspect the markdown summary** — total cost, per-model and per-tier breakdowns, and the persisted memory key.

3. **Verify persistence** — `mcp__plugin_ruflo-core_ruflo__memory_search --query "session-" --namespace cost-tracking` should list the new record. `cost-report` step 1 reads from this namespace.

## Record shape (in `cost-tracking` namespace)

Key: `session-<sessionId>`. Value (JSON):

```json
{
  "sessionId": "1dba3b8c-...",
  "cwd": "/Users/cohen/Projects/ruflo",
  "startedAt": "2026-05-04T...",
  "endedAt": "2026-05-05T...",
  "messageCount": 234,
  "byModel": {
    "claude-opus-4-7": {
      "tier": "opus",
      "input_tokens": 12345,
      "output_tokens": 6789,
      "cache_creation_input_tokens": 800000,
      "cache_read_input_tokens": 2000000,
      "messages": 50,
      "cost_usd": 1.23
    }
  },
  "byTier": { "haiku": 0.0, "sonnet": 0.45, "opus": 1.23, "unknown": 0 },
  "total_cost_usd": 1.68,
  "capturedAt": "2026-05-05T..."
}
```

## Pricing source of truth

The script's `PRICING` constant mirrors REFERENCE.md "Model pricing (USD per 1M tokens)". Update both together when prices change. Cache-write tokens are billed at `cache_write` rate; cache-read tokens at `cache_read` (per Anthropic billing docs).

## Env overrides

| Env | Default | Purpose |
|---|---|---|
| `TRACK_CWD` | `process.cwd()` | Override which project's sessions to scan |
| `TRACK_SESSION` | most-recent jsonl | Pin a specific session file |
| `TRACK_OUT` | unset | Also write the JSON summary to this path |
| `TRACK_DRY_RUN=1` | unset | Skip the `memory store` call |
| `TRACK_QUIET=1` | unset | Suppress markdown output |
| `TRACK_NAMESPACE` | `cost-tracking` | Override target namespace |

## Cross-references

- `cost-report` (consumer) — reads records produced by this skill
- REFERENCE.md "Cost attribution formula" — the math the script implements
- `cost-budget-check` (consumer; landing in P2) — reads totals to evaluate alerts
