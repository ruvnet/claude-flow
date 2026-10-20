---
name: cron-schedule
description: Schedule persistent background workers via CronCreate
argument-hint: "<worker-name> [--interval CRON]"
allowed-tools: CronCreate CronList CronDelete mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch
---
Use `CronCreate` for a worker that should fire on a clock while this Claude Code session is open:

`CronCreate({ cron: "*/15 * * * *", prompt: "Dispatch the audit worker with mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch({ trigger: \"audit\" }) and report anything critical", recurring: true })`

The parameters are `cron` (five-field expression), `prompt` and `recurring`. A `schedule:` field does not exist. These jobs live in the session: they stop when you close it, and recurring jobs expire on their own after 7 days. Cancel one sooner with `CronDelete` (find its id with `CronList`). For a worker that must keep running after the session ends, use `/schedule` (cloud routines) or an OS scheduler (cron, systemd timer) that calls `npx @claude-flow/cli@latest hooks worker dispatch --trigger audit`.

### Recommended Schedules

| Worker | Cron | Description |
|--------|------|-------------|
| audit | `*/15 * * * *` | Security scanning |
| optimize | `*/30 * * * *` | Performance optimization |
| consolidate | `0 * * * *` | Memory consolidation |
| map | `*/30 * * * *` | Codebase mapping |
| testgaps | `*/15 * * * *` | Test coverage analysis |
| document | `0 */2 * * *` | API documentation |

### When to Use Cron vs Loop

- **`/loop`**: In-session, self-pacing. Use for active development.
- **CronCreate**: In-session, fixed clock, auto-expires after 7 days. Use for regular checks while you work.
- **`/schedule` or an OS scheduler**: Survives the session. Use for CI-style monitoring.
