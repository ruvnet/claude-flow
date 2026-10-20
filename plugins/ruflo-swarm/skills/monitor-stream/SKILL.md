---
name: monitor-stream
description: Stream live swarm events using the Monitor tool for real-time observability
argument-hint: ""
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__swarm_status mcp__plugin_ruflo-core_ruflo__swarm_health Monitor
---
Use the Monitor tool to stream swarm events in real time instead of polling:

Run via Monitor: `node "${CLAUDE_PLUGIN_ROOT}/scripts/swarm-watch.mjs"` (add `--interval 5` for faster updates; minimum 2 s)

There is no `swarm watch` in the ruflo CLI, so this script polls `swarm status --format json` and prints one NDJSON line when it changes (`swarm.snapshot`, `swarm.changed`, `swarm.error`). It shows status and agent-count changes, not individual task or memory events. Each stdout line triggers a notification.

For one-shot status, use MCP: `mcp__plugin_ruflo-core_ruflo__swarm_status` or `mcp__plugin_ruflo-core_ruflo__swarm_health`.

Prefer Monitor over polling `swarm status` in a loop. See ADR-091 for rationale.
