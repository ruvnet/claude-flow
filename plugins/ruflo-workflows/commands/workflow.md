---
name: workflow
description: Workflow management -- list MCP workflows + templates and native .claude/workflows/*.js scripts
---

Manage workflows across both surfaces:

## MCP workflows (persisted, lifecycle)

1. Call `mcp__plugin_ruflo-core_ruflo__workflow_list` to show all defined workflows
2. Call `mcp__plugin_ruflo-core_ruflo__workflow_template` to show available templates
3. Show workflow IDs, status (running/paused/completed), and step progress

## Native workflows (`.claude/workflows/*.js`)

4. List the native orchestration scripts: `ls .claude/workflows/*.js` (each file's `meta.name` is its invocable name)
5. For each, read the `export const meta` block and show `name` + `description` + phase titles
6. Run one with the `Workflow` tool — `Workflow({ name })` — or author a new one via the `workflow-create` skill

See ADR-0002 for when to use which surface.
