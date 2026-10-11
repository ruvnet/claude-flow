---
name: loop-worker
description: Run Ruflo background workers using Claude Code native /loop scheduling
argument-hint: "<worker-name>"
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch mcp__plugin_ruflo-core_ruflo__hooks_worker-status ScheduleWakeup
---
Use `/loop` for in-session periodic workers. Pick the delay from what you are waiting for:
- With the 5-minute prompt-cache TTL, `min(270, cache_ttl * 0.9)` = 270s keeps the cache warm (ruflo-autopilot ADR-0001 owns that heartbeat).
- If the `ScheduleWakeup` tool description says this session uses the 1-hour TTL, a 270s wake buys nothing; poll at 1200-1800s unless the worker finishes faster.

Dispatch a worker via MCP: `mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch({ trigger: "WORKER_NAME" })`. It runs in the background by default (`background: true`), so check on it with `hooks_worker-status` instead of waiting inline.

Then schedule the next iteration. `ScheduleWakeup` needs the loop prompt back so the next firing re-enters the loop:
`ScheduleWakeup({ delaySeconds: 270, reason: "next WORKER_NAME iteration", prompt: "/loop <the same /loop input>", noop: false })`

Stop the loop when the worker reports nothing new twice in a row: `ScheduleWakeup({ stop: true })`.

### Available Workers

| Worker | Interval | Description |
|--------|----------|-------------|
| audit | 270s | Security analysis |
| optimize | 270s | Performance optimization |
| consolidate | 600s | Memory consolidation |
| predict | 270s | Predictive preloading |
| map | 270s | Codebase mapping |
| testgaps | 270s | Test coverage analysis |
| document | 600s | Auto-documentation |
| benchmark | 600s | Performance benchmarking |

MCP tool responses include `[LOOP_SUGGESTION]` and `[CRON_SUGGESTION]` hints -- follow them.
