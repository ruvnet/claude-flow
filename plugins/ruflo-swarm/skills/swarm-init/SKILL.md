---
name: swarm-init
description: Initialize a multi-agent swarm with anti-drift configuration. Use when starting a complex multi-file task that needs 3+ coordinated agents (feature implementation, refactor across modules, security audit). Skip for single-file edits or quick questions.
argument-hint: "[--topology hierarchical|mesh|hierarchical-mesh|ring|star|adaptive]"
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__swarm_init mcp__plugin_ruflo-core_ruflo__swarm_status Task SendMessage
---
Initialize a hierarchical swarm for coordinated multi-agent work.

Via MCP: `mcp__plugin_ruflo-core_ruflo__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })`

Or via CLI:
```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

Then spawn named agents in ONE message via Claude Code's `Task` tool with `name:` (for `SendMessage` addressability) and `run_in_background: true` (for parallel execution). Use `EnterWorktree` per agent for git-safe parallel work, and `SendMessage` for inter-agent coordination.

For larger teams (10+), use hierarchical-mesh topology:
```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical-mesh --max-agents 15 --strategy specialized
```
