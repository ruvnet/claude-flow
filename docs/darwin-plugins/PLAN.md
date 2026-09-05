# Darwin plugin-evolution loop — plan

Branch: `darwin/plugin-evolution-2026-06-26`
Started: 2026-06-26
Predecessor: `darwin/capability-evolution-2026-06-26` (30 ticks, 4 dims improved, 1 proven SOTA)

## Goal
Deep concurrent review of ALL 34 ruflo plugins + their commands/agents/skills.
Each /loop 5m tick fans out across every plugin in parallel via Workflow,
applies ONE optimization per plugin, runs the plugin's smoke contract,
records the delta.

## Per-tick contract (per plugin, runs in parallel)
1. Read plugin's SKILL.md / agents/ / commands/ / scripts/ contents.
2. Identify ONE small improvement (clearer description, tighter validation,
   missing edge-case test, dead-code removal, broken example, regex bug).
3. Apply the change as a focused edit (≤30 lines).
4. Run the plugin's smoke contract:
     bash plugins/<plugin>/scripts/smoke.sh
   (if smoke.sh exists; else `node plugins/<plugin>/scripts/test-mcp-tools.mjs` etc.)
5. Compare pass/fail counts to prior tick. Improvement = more tests pass OR
   same passes + meaningful code improvement (eg. cleaner regex, better
   error message).
6. Append one JSONL line per plugin to docs/darwin-plugins/log.jsonl.
7. Aggregate per-tick summary: {iter, ts, pluginsImproved, pluginsRegressed,
   pluginsUnchanged, pluginsFailed}.

## Halt conditions
- 3 consecutive ticks where pluginsImproved=0 across all plugins → halt
- 7-day cron TTL (auto)
- Explicit `CronDelete <id>` from user

## Budget (per tick)
- 34 plugins × $0.15 budget each = $5 per tick if all run
- Wall budget: 4 minutes (give Workflow 1m buffer)
- Total session estimate: ~$30-60 over 6-12 useful ticks before plateau

## Dimensions tracked per plugin
- smoke pass rate
- ADR-112 compliance (Use-when guidance in MCP tool descriptions)
- Docstring quality
- Test coverage (count of test files / scripts)
- README freshness (last-updated date vs current)

## Concurrency
Each tick uses Workflow tool with `pipeline()` over the plugin list. Each
plugin's slot:
  - spawns its own `claude -p --max-budget-usd 0.15 --model haiku`
  - reads its directory
  - applies + commits ONE focused change
  - runs its smoke (if present)
  - returns {plugin, change, smokeDelta, action}

Workflow worktree isolation: NOT needed — plugins are in separate dirs and
edits don't conflict. Save the worktree cost.
