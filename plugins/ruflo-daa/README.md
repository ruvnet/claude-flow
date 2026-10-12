# ruflo-daa

Dynamic Agentic Architecture with cognitive patterns, knowledge sharing, and adaptive agents.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-daa@ruflo
```

## Features

- **Adaptive agents**: Agents that learn and evolve from interactions
- **Cognitive patterns**: Structured reasoning strategies for decision-making
- **Knowledge sharing**: Cross-agent learning and collective improvement
- **Performance tracking**: Efficiency and accuracy metrics over time

## Commands

- `/daa` -- DAA dashboard with learning metrics and active agents

## Skills

- `daa-agent` -- Create and adapt Dynamic Agentic Architecture agents
- `cognitive-pattern` -- Define cognitive patterns for agent reasoning

## MCP surface (8 tools)

All defined at `v3/@claude-flow/cli/src/mcp-tools/daa-tools.ts`:

| Tool | Purpose |
|------|---------|
| `daa_agent_create` | Initialize an adaptive agent |
| `daa_agent_adapt` | Trigger manual adaptation from feedback |
| `daa_workflow_create` | Define a cognitive workflow |
| `daa_workflow_execute` | Run a cognitive workflow |
| `daa_knowledge_share` | Propagate learnings across agents |
| `daa_learning_status` | Adaptation progress metrics |
| `daa_cognitive_pattern` | Define a reasoning pattern |
| `daa_performance_metrics` | Efficiency / accuracy stats |

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-daa/scripts/smoke.sh` is the contract.

## Intelligence-pipeline alignment

DAA cognitive patterns feed the **JUDGE** phase of the 4-step intelligence pipeline (RETRIEVE → JUDGE → DISTILL → CONSOLIDATE) defined by [ruflo-intelligence ADR-0001](../ruflo-intelligence/docs/adrs/0001-intelligence-surface-completeness.md). When a task is routed via `hooks_route` and a similar past trajectory is retrieved, DAA cognitive patterns provide the structured reasoning to evaluate fit before adaptation.

`daa_knowledge_share` writes pattern propagation events that `hooks_intelligence_learn` can consume during the DISTILL phase.

## Namespace coordination

This plugin owns the `daa-patterns` AgentDB namespace (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`daa-patterns` is accessed via `memory_*` tools (which route by namespace). The agent file's CLI examples are correct (`memory store --namespace daa-patterns`).

## Verification

```bash
bash plugins/ruflo-daa/scripts/smoke.sh
# Expected: "13 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-daa plugin contract (pinning, namespace coordination, intelligence-pipeline alignment, smoke as contract)](./docs/adrs/0001-daa-contract.md)

## As a mod

Since this version the plugin is also a function-hook mod (ADR-445 pattern; needs Claude Code 2.1.287 or later). It never calls the network or spawns a process, and it only tightens: it can refuse a call, never allow one.

- **Guard** (default on): refuses `daa_*` tool calls that hold a key, token or password. The reason names the kind of secret, never the value.
- **`/daa-mod`**: answered locally, no model turn: `status`, `scan <text>` (would the guard refuse this?), and `tools` (the connected `daa_*` tools).
- **Status file**: `.claude-flow/daa-mod/status.json` (`{version, updatedMs, guard, blocked}`), written at session start and when a call is blocked.
- **Option**: `guard` (`on` | `off`, default `on`) in the plugin's `userConfig`.

Test it: `claude plugin test plugins/ruflo-daa` and `bash plugins/ruflo-daa/scripts/smoke.sh`.
