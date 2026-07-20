---
name: goals
description: List active horizons, check goal progress, and view research findings
---
$ARGUMENTS

Show goal and research status:

1. Call `mcp__plugin_ruflo-core_ruflo__memory_list` with namespace `horizons` to enumerate active horizons (use `memory_search` only when filtering by semantic query — `*` is not a valid semantic query)
2. For each horizon, show: objective, current milestone, progress %, target date, drift status
3. Call `mcp__plugin_ruflo-core_ruflo__memory_list` with namespace `research-synthesis` to list completed research reports
4. Show a summary table of horizons and research state
