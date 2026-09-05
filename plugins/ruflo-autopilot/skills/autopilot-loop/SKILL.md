---
name: autopilot-loop
description: Run an autonomous /loop iteration -- check progress, work on next task, schedule next wake
argument-hint: ""
allowed-tools: mcp__plugin_ruflo-core_ruflo__autopilot_status mcp__plugin_ruflo-core_ruflo__autopilot_predict mcp__plugin_ruflo-core_ruflo__autopilot_log mcp__plugin_ruflo-core_ruflo__autopilot_progress mcp__plugin_ruflo-core_ruflo__autopilot_disable ScheduleWakeup Agent
---
Run one autopilot iteration using Claude Code's native /loop:

1. Check status: `mcp__plugin_ruflo-core_ruflo__autopilot_status`
2. If all tasks complete or max iterations reached, call `mcp__plugin_ruflo-core_ruflo__autopilot_disable` and stop
3. Get prediction: `mcp__plugin_ruflo-core_ruflo__autopilot_predict` for the optimal next action
4. Execute the predicted task (spawn agent, edit code, run tests, etc.)
5. Log via `mcp__plugin_ruflo-core_ruflo__autopilot_log`
6. Schedule next: `ScheduleWakeup({ delaySeconds: 270, reason: "next autopilot iteration" })`

### Cache-Aware Scheduling

Always use delay 270s (under 300s cache TTL) to keep the prompt cache warm between iterations.

### Task Sources

Autopilot discovers tasks from:
- **team-tasks**: Claude Code TaskList entries
- **swarm-tasks**: MCP task_list entries
- **file-checklist**: Markdown checkbox items in tracked files

Configure: `mcp__plugin_ruflo-core_ruflo__autopilot_config({ taskSources: ["team-tasks", "swarm-tasks"] })`
