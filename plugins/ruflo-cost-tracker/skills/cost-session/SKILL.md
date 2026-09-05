---
name: cost-session
description: Per-message cost breakdown within a single session. The drill-down companion to cost-anomaly — when an outlier session is flagged, this surfaces the specific expensive messages so operators can see whether the cost came from output tokens, cache writes, or model escalations.
argument-hint: "[--session-id <id>] [--top 20] [--since <iso-ts>] [--format table|json]"
allowed-tools: Bash
---

When cost-anomaly flags a session as a >3.5σ outlier, the next question
is "which MESSAGES were expensive?". cost-session answers that.

| Question | Skill |
|---|---|
| "Which sessions cost the most?" | `cost-conversation` |
| "Which sessions are outliers?" | `cost-anomaly` |
| **"Which messages in THIS session were expensive?"** | **`cost-session`** ← this |

## Algorithm

Implementation: [`scripts/session.mjs`](../../scripts/session.mjs).

1. Resolve session jsonl: `--session-id <id>` (scans `~/.claude/projects/*/`)
   or `--latest` (default; picks most-recently-modified jsonl).
2. Parse all assistant messages with `usage` blocks.
3. Cost each message via shared PRICING (`_prices.mjs`).
4. Sort descending by `cost_usd`, surface top-N (default 20).
5. Compute p50/p90/p99 of message costs for in-session percentile context.
6. Flag the top message if it's >2× the p99 — that's an in-session outlier.

## Why this matters: cache writes are the silent cost

Example real session, top message:
```
| # | Model    | In | Out | Cache W | Cache R | Cost      |
| 1 | opus-4-7 | 6  | 569 | 881898  | 0       | $16.58    |
```

Without the **Cache W** column it looks like "569 output tokens cost
$16" — that's wrong by 380×. The actual cost is ephemeral 1h cache
write at opus pricing: 881,898 tokens × $18.75/1M = $16.54.

Operators reading the table see immediately: "the model wrote 881K
tokens to ephemeral cache". From there the question becomes "why did
we cache 881K tokens of context for a 6-input request?" — that's a
real engineering signal.

## Drill-down workflow

```bash
# Step 1: find outliers across all sessions
cost anomaly --alert-on-outliers 1 || cost anomaly  # see which session-ids

# Step 2: drill into the flagged session
cost session --session-id <flagged-id> --top 10

# Step 3: open that jsonl at the timestamp the top message reports,
# inspect the prompt + tool calls
```

## Percentile context

Top of output:
```
| p50 (median) message | $0.85 |
| p90 message          | $1.45 |
| p99 message          | $1.74 |
```

Lets operators ask "is this top message a 2× outlier or a 380× one?"
without having to compute it themselves. The "top is >2× p99" footer
fires when the answer is "yes, this is an in-session outlier worth
investigating".

## --since filter

Useful for drilling into a specific time range within a long session:

```bash
cost session --since 2026-06-16T13:00:00Z --top 5
```

Only messages with `timestamp >= --since` are considered.

## Edge cases

- No costed assistant messages → "_No costed assistant messages_" + exit 0.
- `--session-id` not found in any project's jsonls → exit 2 with error.
- `--top` must be a positive integer → exit 2.
