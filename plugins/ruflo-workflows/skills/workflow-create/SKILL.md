---
name: workflow-create
description: Author a workflow — either an MCP workflow template (persisted, lifecycle) or a native .claude/workflows/*.js orchestration script (agent/parallel/pipeline fan-out)
argument-hint: "<name> [--native] [--steps N]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__workflow_create mcp__plugin_ruflo-core_ruflo__workflow_template mcp__plugin_ruflo-core_ruflo__workflow_list mcp__plugin_ruflo-core_ruflo__workflow_status mcp__plugin_ruflo-core_ruflo__workflow_delete Write Read Edit Bash
---

# Workflow Create

Author a workflow on whichever surface fits the job.

## Pick a surface

- **MCP workflow template** — a persisted definition with a pause/resume lifecycle. Use for long-lived, human-gated, resumable pipelines.
- **Native `.claude/workflows/*.js`** — an imperative orchestration script that fans subagents out. Use for comprehensive fan-out (review, audit, migration, research) where you aggregate structured results in code.

## A — MCP workflow template

1. **List templates** — call `mcp__plugin_ruflo-core_ruflo__workflow_template` to see available templates
2. **Create workflow** — call `mcp__plugin_ruflo-core_ruflo__workflow_create` with steps, conditions, and execution order
3. **List workflows** — call `mcp__plugin_ruflo-core_ruflo__workflow_list` to see all defined workflows
4. **Check status** — call `mcp__plugin_ruflo-core_ruflo__workflow_status` to monitor a workflow
5. **Clean up** — call `mcp__plugin_ruflo-core_ruflo__workflow_delete` to remove unused workflows

Features: sequential/parallel steps, conditional branching, template inheritance, pause/resume approval gates.

## B — Native `.claude/workflows/*.js`

Write a `.js` file under `.claude/workflows/`. It MUST begin with a **pure-literal** `export const meta` block; the body runs inside an async wrapper (top-level `await`/`return` are legal) with these hooks injected:

| Hook | Purpose |
|------|---------|
| `agent(prompt, opts)` | Spawn one subagent; pass `opts.schema` (JSON Schema) to get validated structured output back |
| `parallel(thunks)` | Run thunks concurrently with a **barrier** — `.filter(Boolean)` the results |
| `pipeline(items, ...stages)` | Stream each item through stages independently — **prefer this** over a barrier |
| `phase(title)` / `log(msg)` | Progress grouping / narration |

```js
export const meta = {
  name: 'my-workflow',                 // becomes the invocable name — must be a pure literal
  description: 'one line',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}
const SCHEMA = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } }, additionalProperties: false }
phase('Find')
const found = await agent('find the things', { schema: SCHEMA, agentType: 'tester' })
phase('Verify')
const checked = await parallel((found.items || []).map((it) => () =>
  agent(`verify ${it}`, { schema: SCHEMA })))
return { found, checked: checked.filter(Boolean) }
```

Rules: `meta` is a pure literal (no variables/calls/interpolation); default to `pipeline` over `parallel`; never use `Date.now()`/`Math.random()` (they throw — vary by index instead). Validate syntax (the body is ESM-in-async-wrapper, not a bare module):

```bash
node -e 'const fs=require("fs");let s=fs.readFileSync(".claude/workflows/my-workflow.js","utf8").replace(/^export\s+const\s+meta/m,"const meta");fs.writeFileSync("/tmp/wf.mjs","let agent,parallel,pipeline,phase,log,args,budget,workflow;async function __wf(){\n"+s+"\n}")' \
  && node --check /tmp/wf.mjs && echo OK
```

Run it with the `workflow-run` skill or `Workflow({ name: 'my-workflow' })`. Reference: `.claude/workflows/plugin-contract-audit.js`. See [ADR-0002](../../docs/adrs/0002-native-workflow-orchestration.md).
