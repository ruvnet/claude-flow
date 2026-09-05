---
name: loop-worker
description: Run Ruflo background workers using Claude Code native /loop scheduling
argument-hint: "<worker-name>"
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch mcp__plugin_ruflo-core_ruflo__hooks_worker-status ScheduleWakeup
---
Use `/loop` for in-session periodic workers. Cache-aware delays keep prompt cache warm:
- Delay formula: `min(270, cache_ttl * 0.9)` -- default 270s

Dispatch a worker via MCP: `mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch({ trigger: "WORKER_NAME" })`

Then schedule the next iteration: `ScheduleWakeup({ delaySeconds: 270, reason: "next WORKER_NAME iteration" })`

### Available Workers

| Worker | Interval | Description |
|--------|----------|-------------|
| audit | 270s | Security analysis |
| optimize | 270s | Performance optimization |
| consolidate | 600s | Memory consolidation |
| predict | 270s | Predictive preloading |
| map | 600s | Codebase mapping |
| testgaps | 270s | Test coverage analysis |
| document | 600s | Auto-documentation |
| benchmark | 600s | Performance benchmarking |

MCP tool responses include `[LOOP_SUGGESTION]` and `[CRON_SUGGESTION]` hints -- follow them.
