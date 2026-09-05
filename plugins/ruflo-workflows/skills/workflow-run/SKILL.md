---
name: workflow-run
description: Run a workflow — drive an MCP workflow lifecycle (execute/pause/resume/cancel) or invoke + resume a native .claude/workflows/*.js orchestration via the Workflow tool
argument-hint: "<workflow-id-or-name>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__workflow_execute mcp__plugin_ruflo-core_ruflo__workflow_run mcp__plugin_ruflo-core_ruflo__workflow_pause mcp__plugin_ruflo-core_ruflo__workflow_resume mcp__plugin_ruflo-core_ruflo__workflow_cancel mcp__plugin_ruflo-core_ruflo__workflow_status Workflow Read Bash
---

# Workflow Run

Run and manage a workflow on either surface.

## A — MCP workflow lifecycle

When you need to run a persisted definition and control its lifecycle (pause/resume/cancel):

1. **Execute** — call `mcp__plugin_ruflo-core_ruflo__workflow_execute` or `mcp__plugin_ruflo-core_ruflo__workflow_run` with the workflow ID
2. **Monitor** — call `mcp__plugin_ruflo-core_ruflo__workflow_status` to check progress and step outcomes
3. **Pause** — call `mcp__plugin_ruflo-core_ruflo__workflow_pause` to halt at the current step
4. **Resume** — call `mcp__plugin_ruflo-core_ruflo__workflow_resume` to continue from where paused
5. **Cancel** — call `mcp__plugin_ruflo-core_ruflo__workflow_cancel` to abort the workflow

Execution modes: **sequential**, **parallel** (independent steps), **conditional** (branch on outcome), **manual gate** (pause for human approval).

## B — Native `.claude/workflows/*.js`

When you need a deterministic subagent fan-out, run a named native workflow with the `Workflow` tool. The named workflows are the `meta.name` of each `.claude/workflows/*.js` file (list them with `/workflow` or `ls .claude/workflows/`).

```js
Workflow({ name: 'plugin-contract-audit' })                    // run a named workflow
Workflow({ name: 'plugin-contract-audit', args: 'ruflo-agentdb' })  // pass args → the script's `args` global
Workflow({ scriptPath: '.claude/workflows/foo.js' })           // run a script by path
Workflow({ scriptPath, resumeFromRunId: 'wf_…' })              // resume — unchanged agent() calls return cached
```

Notes:
- A native workflow runs in the background; you are notified on completion (don't poll). Watch live progress with `/workflows`.
- Pause/resume here is **journal-based** (`resumeFromRunId`), not the MCP state machine. Stop a run first, then resume from its `runId`.
- To author a new native workflow, use the `workflow-create` skill.

See [ADR-0002](../../docs/adrs/0002-native-workflow-orchestration.md).
