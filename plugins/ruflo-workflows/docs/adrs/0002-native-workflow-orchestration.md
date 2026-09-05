---
id: ADR-0002
title: ruflo-workflows adopts native Claude Code Workflow orchestration (.claude/workflows/*.js) alongside the MCP workflow_* surface
status: Accepted
date: 2026-05-29
authors:
  - coder (Claude Code)
tags: [plugin, workflows, orchestration, native-workflow, claude-code, agent-fanout]
---

## Context

[ADR-0001](./0001-workflows-contract.md) established `ruflo-workflows` as the canonical wrapper for the **10 `workflow_*` MCP tools** (`v3/@claude-flow/cli/src/mcp-tools/workflow-tools.ts`). That surface is *declarative and persisted*: a workflow definition is created, then run/paused/resumed/cancelled through a state machine, with state indexed in the `workflows-state` AgentDB namespace.

Claude Code has since shipped a second, complementary capability — the **native `Workflow` tool**. It executes a JavaScript orchestration script that fans subagents out deterministically via four hooks:

| Hook | Purpose |
|------|---------|
| `agent(prompt, opts)` | Spawn one subagent; with `opts.schema` it returns validated structured output |
| `parallel(thunks)` | Run thunks concurrently with a barrier (await all) |
| `pipeline(items, ...stages)` | Run each item through all stages independently, no barrier |
| `phase(title)` / `log(msg)` | Progress grouping and narration |

These scripts live in `.claude/workflows/*.js`. Each begins with a pure-literal `export const meta = { name, description, phases }` block; the file's `meta.name` makes it an invocable **named workflow** (`Workflow({ name })`) that also surfaces in the skill/workflow list. The repo already contains one such script — `.claude/workflows/intelligence-system-hardening.js`.

The two surfaces solve different problems and neither subsumes the other:

| Dimension | MCP `workflow_*` (ADR-0001) | Native `Workflow` JS (this ADR) |
|-----------|------------------------------|----------------------------------|
| Form | Declarative definition + lifecycle state machine | Imperative JS orchestration script |
| Unit of work | Persisted workflow steps | Subagents (`agent()`) |
| Persistence | Stateful, resumable across sessions (`workflows-state`) | Per-run journal; resume via `resumeFromRunId` |
| Concurrency | Engine-scheduled steps | `parallel()` barrier / `pipeline()` streaming |
| Best for | Long-lived, pausable, human-gated pipelines | Comprehensive fan-out: review, audit, migration, research |
| Location | AgentDB definitions | `.claude/workflows/*.js` |

Before this ADR the plugin documented only the MCP surface, so users had no in-plugin guidance for authoring or running the native scripts that the project is already accumulating.

## Decision

1. Add this ADR (Accepted). ADR-0001 remains Accepted and unchanged; this ADR **amends** it by adding a second surface, it does not supersede it.
2. The plugin documents **both** surfaces. README gains a "Native Workflow Orchestration" section: the four-hook API, the pure-literal `meta` requirement, the `.claude/workflows/*.js` location/discovery rule, invocation (`Workflow({ name })` / `{ scriptPath }` / `{ resumeFromRunId }`), and a decision table for choosing MCP-vs-native.
3. Skills extend to cover authoring and running native scripts:
   - `workflow-create` — how to author a `.claude/workflows/*.js` (meta block, hook API, schema-validated agents, `parallel` vs `pipeline`).
   - `workflow-run` — how to invoke a named native workflow and resume it, in addition to MCP run/pause/resume/cancel.
4. The `workflow-specialist` agent and `/workflow` command become surface-aware: the command also lists `.claude/workflows/*.js`; the agent knows when to reach for native fan-out vs the MCP lifecycle engine.
5. Ship a reference native workflow — `.claude/workflows/plugin-contract-audit.js` — that runs every `plugins/*/scripts/smoke.sh`, fans diagnosis agents out over the failures, and reports. It is the executable example of the new capability and is directly useful for the repo's "smoke as contract" discipline.
6. Bump `0.3.0 → 0.4.0` (minor: additive capability). Keywords add `native-workflow`, `agent-fanout`, `pipeline`, `parallel`.
7. `scripts/smoke.sh` is reconciled with current reality (version, ADR-0001 now Accepted) and extended with native-surface checks: ADR-0002 present + Accepted, README native section + four-hook API documented, `.claude/workflows/` location referenced.

## Consequences

**Positive:** the plugin now reflects the full workflow capability of the platform, not just the MCP slice. Authors get a documented, validated path to write fan-out/pipeline orchestrations, with a working reference script. The audit workflow turns the project's 32 plugin smoke contracts into a one-call parallel sweep.

**Negative:** two surfaces means contributors must pick the right one; the README decision table mitigates this. The native scripts are project-level (`.claude/workflows/`), not shipped inside the plugin package, so the plugin documents and exemplifies them rather than bundling them.

**Neutral:** the `workflows-state` namespace claim is unchanged and applies to the MCP surface only; native scripts persist via the per-run journal, not AgentDB.

## Verification

```bash
# Plugin contract (documents both surfaces; stays inside the plugin boundary):
bash plugins/ruflo-workflows/scripts/smoke.sh
# Expected: "15 passed, 0 failed"
```

The reference native workflow is project-level (`.claude/workflows/`), not part of the plugin
package, so its syntax is validated separately rather than from the plugin smoke. A native
workflow body runs inside an async wrapper (top-level `await`/`return` are legal), so it is
checked as an async-wrapped ES module with `meta` kept as a module export:

```bash
node -e 'const fs=require("fs");let s=fs.readFileSync(".claude/workflows/plugin-contract-audit.js","utf8").replace(/^export\s+const\s+meta/m,"const meta");fs.writeFileSync("/tmp/wf.mjs","let agent,parallel,pipeline,phase,log,args,budget,workflow;async function __wf(){\n"+s+"\n}")' \
  && node --check /tmp/wf.mjs && echo OK
```

## Related

- [`0001-workflows-contract.md`](./0001-workflows-contract.md) — the MCP `workflow_*` contract this ADR amends
- `.claude/workflows/intelligence-system-hardening.js` — first native workflow in the repo
- `.claude/workflows/plugin-contract-audit.js` — reference native workflow shipped with this ADR
- `plugins/ruflo-loop-workers/docs/adrs/0001-loop-workers-contract.md` — sibling automation surface (recurring loops)
- `plugins/ruflo-sparc/docs/adrs/0001-sparc-contract.md` — SPARC phase transitions as workflows

## Implementation status

ADR-0002 accepted. Native-workflow documentation added to README + both skills + agent + command; plugin bumped to v0.4.0; reference workflow `.claude/workflows/plugin-contract-audit.js` authored and syntax-validated; smoke gate extended to 15 checks covering both surfaces.
