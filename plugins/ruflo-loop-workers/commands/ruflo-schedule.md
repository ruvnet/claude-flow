---
name: ruflo-schedule
description: Schedule persistent workers via CronCreate
---
$ARGUMENTS
Schedule a persistent background worker using CronCreate.

Usage: /ruflo-schedule <worker> [cron-expression]   (not `/schedule`, which is the built-in cloud-routines command)

Workers (any of the 12 triggers): audit, map, optimize, consolidate, testgaps, predict, document, benchmark, deepdive, refactor, ultralearn, preload.

Default cron expressions:
- audit, testgaps: `*/15 * * * *`
- optimize, map: `*/30 * * * *`
- consolidate, document: `0 * * * *`

Example: /ruflo-schedule audit */15 * * * *
Creates: `CronCreate({ cron: "*/15 * * * *", prompt: "Dispatch the audit worker (hooks_worker-dispatch trigger audit) and report critical findings", recurring: true })`

The job lives in this session only and recurring jobs expire after 7 days. List with `CronList`, remove with `CronDelete`. For a schedule that outlives the session, use `/schedule` (cloud routine) or an OS scheduler running `npx @claude-flow/cli@latest hooks worker dispatch --trigger WORKER`.
