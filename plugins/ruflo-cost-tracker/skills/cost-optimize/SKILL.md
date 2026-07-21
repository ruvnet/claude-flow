---
name: cost-optimize
description: Analyze token usage patterns and recommend cost optimizations with estimated savings
argument-hint: ""
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store mcp__plugin_ruflo-core_ruflo__agentdb_semantic-route mcp__plugin_ruflo-core_ruflo__hooks_model-outcome Bash
---

# Cost Optimize

Analyze recent token usage across agents and models, identify waste, and recommend specific optimizations with estimated dollar savings.

## When to use

When costs are higher than expected or you want to proactively reduce spending. Analyzes model selection efficiency, cache utilization, agent redundancy, and prompt efficiency.

## Steps

1. **Load usage data** -- call `mcp__plugin_ruflo-core_ruflo__memory_search` on the `cost-tracking` namespace (last 7 days). The `memory_*` tools route by namespace; use them — not `agentdb_hierarchical-*` (which routes by tier).
2. **Analyze model fit** -- for each agent, assess whether the model tier matches task complexity:
   - Agents doing simple tasks (formatting, linting) on Sonnet/Opus → suggest Haiku or Agent Booster
   - Agents doing complex tasks (architecture, security) on Haiku → flag quality risk
3. **Check cache rates** -- compute cache hit rate per agent; if below 60%, recommend enabling or improving prompt caching (90% cost reduction on cache reads)
4. **Detect redundancy** -- look for multiple agents performing overlapping tasks, or agents being spawned for work that could be batched
5. **Estimate savings** -- for each recommendation, calculate: current cost, projected cost after optimization, dollar savings, percentage reduction
6. **Search prior optimization patterns** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search` (ReasoningBank-routed; **don't** pass a `namespace` argument — pattern-* tools ignore it).
7. **Store the optimization pattern** -- two paths:
   - **Pattern store (typed, recommended)**: `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store` with `type: 'cost-optimization'`. Don't pass a `namespace` arg — ReasoningBank routes it; on bridge unavailability the fallback writes to the reserved `pattern` namespace with `controller: 'memory-store-fallback'` (see ruflo-agentdb ADR-0001).
   - **Plain store (namespace-routable)**: `mcp__plugin_ruflo-core_ruflo__memory_store --namespace cost-patterns` — this DOES respect the `cost-patterns` namespace because `memory_*` is namespace-routed.
8. **Close the routing feedback loop — auto-emit `hooks_model-outcome`** -- for each downgrade recommendation, format the outcome-emit command as part of the recommendation table so it can be run directly:

   ```bash
   # success path (downgrade worked)
   node plugins/ruflo-cost-tracker/scripts/outcome.mjs "<task-description>" <model> success

   # escalated path (had to upgrade after downgrade attempt)
   node plugins/ruflo-cost-tracker/scripts/outcome.mjs "<task-description>" <model> escalated
   ```

   The script wraps `npx @claude-flow/cli hooks model-outcome -t ... -m ... -o ...` with explicit-argv `spawnSync` so quoting is safe. Without this signal the router does not learn from cost-tracker's recommendations and the booster bypass rate (see `cost-booster-route` skill) does not improve over time. This is the typed equivalent of the legacy `routing-outcomes` namespace (see ruflo-intelligence ADR-0001 §"Neutral").
9. **Report** -- display: ranked recommendations with savings estimate, total potential savings, implementation priority (quick wins first), and any model-outcome events emitted in step 8

## CLI alternative

```bash
npx @claude-flow/cli@latest memory search --query "cost optimization strategies" --namespace cost-patterns
npx @claude-flow/cli@latest memory store --key "opt-2026-05-04" --value '{...}' --namespace cost-patterns
```
