---
name: cost-report
description: Generate a cost report showing token usage and USD costs by agent and model
argument-hint: "[--period today]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__agentdb_semantic-route Bash
---

# Cost Report

Generate a comprehensive cost report showing token usage, USD costs, and budget utilization for the specified period.

## When to use

When you need to understand current spending -- how much each agent costs, which models consume the most budget, and whether you're on track to stay within budget.

## Steps

1. **Retrieve usage** -- call `mcp__plugin_ruflo-core_ruflo__memory_search` (or `_list` / `_retrieve`) on the `cost-tracking` namespace for the specified period (default: today). The `memory_*` tools route by namespace string; the `agentdb_hierarchical-*` tools do **not** (they route by tier `working|episodic|semantic`), so don't use them here. See [ruflo-agentdb ADR-0001 §"Namespace convention"](../../../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md) for the routing contract.
1a. **Read measured booster data** -- if `docs/benchmarks/runs/latest.json` exists, load it via `Bash`-shelled `node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync("docs/benchmarks/runs/latest.json")).summary))'`. This provides Tier 1 measured values — booster cost/edit ($0), avg latency, win rate, plus any LLM baseline that was run (Gemini, Sonnet 4.6, Opus 4.7 latencies and per-edit costs). Use these in step 4 for the **measured** Tier breakdown rather than estimated.
2. **Compute costs** -- for each record, calculate cost using model pricing:
   - Haiku: $0.25/M input, $1.25/M output
   - Sonnet: $3.00/M input, $15.00/M output
   - Opus: $15.00/M input, $75.00/M output
   - Include cache write/read costs where applicable
3. **Aggregate by model** -- sum costs per model, compute percentage share
4. **Aggregate by tier** -- classify each record as Tier 1 / Tier 2 / Tier 3 using **three** signals (in priority order): (a) bench data from step 1a — for any record that maps to a measured booster intent, use $0 / measured-latency directly; (b) the `[AGENT_BOOSTER_AVAILABLE]` flag stored by the `cost-booster-route` skill in `cost-tracking`; (c) the model name as fallback (`haiku` → Tier 2; `sonnet`/`opus` → Tier 3). Sum costs per tier, compute share, and count Tier 1 bypasses. The tier breakdown is the most actionable single line — it tells the user what fraction of Sonnet/Opus spend was Tier 1-eligible.
5. **Aggregate by agent** -- sum costs per agent, include the model each agent used
6. **Check budget** -- recall budget configuration via `memory_retrieve` and compute utilization percentage, check alert thresholds (50%/75%/90%/100%)
7. **Report** -- display: total cost, budget remaining, **tier breakdown** (Tier 1 / Tier 2 / Tier 3), model breakdown, agent breakdown, active alerts. See REFERENCE.md §"Cost report shape" for the canonical layout.

## CLI alternative

```bash
npx @claude-flow/cli@latest memory search --query "cost report for today" --namespace cost-tracking
npx @claude-flow/cli@latest memory list --namespace cost-tracking
```
