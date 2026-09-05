---
name: intelligence
description: Intelligence dashboard -- stats, metrics, model routing, routing rationale on demand
---

Show the intelligence system dashboard:

1. Call `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_stats` to get pattern counts, trajectory history, and SONA learning state.
2. Call `mcp__plugin_ruflo-core_ruflo__hooks_metrics` to get the metrics dashboard (trajectory throughput, learn-cycle latency, pattern delta).
3. Call `mcp__plugin_ruflo-core_ruflo__hooks_model-stats` for 3-tier model routing distribution (Tier 1 booster / Tier 2 Haiku / Tier 3 Sonnet/Opus).
4. Call `mcp__plugin_ruflo-core_ruflo__neural_status` for neural pattern + SONA / MoE state.
5. **(Optional `--why <task>`)** — Call `mcp__plugin_ruflo-core_ruflo__hooks_explain` with the task to get the routing rationale.

Present a summary table:
- Pattern count + active trajectories (from intelligence_stats)
- Tier distribution % (from model-stats)
- Last consolidation timestamp (from neural_status / intelligence_stats)
- Recent metric deltas (from hooks_metrics)
- Routing rationale paragraph (only when `--why` given)

If patterns are stale, suggest:
```bash
mcp tool call hooks_pretrain --json
mcp tool call agentdb_consolidate --json
```
