---
name: cost-advise
description: Optimisation findings from your own Claude Code and Codex logs — low cache hit ratio, 1-hour cache writes that did not pay back, sub-agents on a top-tier model, Codex reasoning share, bloated sessions — each with evidence and a what-if saving. Use when asked how to cut spend or why it is high.
argument-hint: "[--since 7d] [--provider claude|codex|grok|all] [--format json|markdown]"
allowed-tools: Bash
---

# Cost Advise

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/advise.mjs --since 7d
```

## Rules for presenting findings

- Savings are **what-if repricings of the same tokens** at another rate. They say nothing about quality; tell the user to spot-check before switching a model.
- A finding with `saving n/a` has no defensible number (no measured delta exists). Do not invent one.
- Do not change settings, models or CLAUDE.md on the user's behalf; present the action and let them choose.
- Prefer the largest controllable lever first: cache discipline, then model tier for sub-agents, then reasoning effort, then context size.
- Pair with `cost-ledger` for the totals and `cost-session` to drill into one expensive session.
