---
name: observe-metrics
description: Aggregate and display system metrics with anomaly detection for a time period
argument-hint: "[--period 1h]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store mcp__plugin_ruflo-core_ruflo__agentdb_semantic-route Bash
---

# Observe Metrics

Aggregate counters, gauges, and histograms from the observability namespace and flag anomalies.

## When to use

When you need a snapshot of system health -- task completion rates, error rates, active agent counts, memory usage, and token consumption. Useful for monitoring swarm performance and detecting degradation.

## Steps

1. **Retrieve metrics** -- call `mcp__plugin_ruflo-core_ruflo__memory_search --namespace observability` (or `memory_list`) to fetch metric records for the specified period (default: 1 hour). The `memory_*` tool family routes by namespace; `agentdb_hierarchical-*` does NOT, so use `memory_*` here.
2. **Aggregate** -- compute:
   - Counters: sum totals (tasks_completed, errors, token_usage)
   - Gauges: current values (active_agents, memory_usage_bytes)
   - Histograms: p50, p95, p99 (task_duration_ms, span_duration_ms)
3. **Compute baselines** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search` (ReasoningBank-routed; **don't** pass a `namespace` argument — pattern-* tools ignore it) to establish baseline values for each metric.
4. **Flag anomalies** -- mark metrics deviating >2 standard deviations from baseline with direction (above/below) and severity
5. **Store patterns** -- two paths (per ruflo-cost-tracker ADR-0001 dual-path pattern):
   - **Pattern store (typed, recommended)**: `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store` with `type: 'metric-snapshot'`. No namespace arg.
   - **Plain store (namespace-routable)**: `mcp__plugin_ruflo-core_ruflo__memory_store --namespace observability` for the snapshot tied to a timestamp.
6. **Report** -- display: metric name, current value, baseline, deviation, trend (up/down/stable), anomaly flag; overall health score (green/yellow/red)

## CLI alternative

```bash
npx @claude-flow/cli@latest memory search --query "system metrics for last hour" --namespace observability
```
