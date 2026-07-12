---
name: swarm-orchestration
description: >
  Multi-agent swarm coordination for complex tasks. Uses hierarchical topology with specialized agents to break down and execute complex work across multiple files and modules.
  Use when: 3+ files need changes, new feature implementation, cross-module refactoring, API changes with tests, security-related changes, performance optimization across codebase, database schema changes.
  Skip when: single file edits, simple bug fixes (1-2 lines), documentation updates, configuration changes, quick exploration.
---

# Swarm Orchestration Skill

## Purpose
Multi-agent swarm coordination for complex tasks. Uses hierarchical topology with specialized agents to break down and execute complex work across multiple files and modules.

## When to Trigger
- 3+ files need changes
- new feature implementation
- cross-module refactoring
- API changes with tests
- security-related changes
- performance optimization across codebase
- database schema changes

## When to Skip
- single file edits
- simple bug fixes (1-2 lines)
- documentation updates
- configuration changes
- quick exploration

## Commands

### Initialize Swarm
Start a new swarm with hierarchical topology (anti-drift)

```bash
npx @claude-flow/cli swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

**Example:**
```bash
npx @claude-flow/cli swarm init --topology hierarchical --max-agents 6 --strategy specialized
```

### Route Task
Route a task to the appropriate agents based on task type

```bash
npx @claude-flow/cli hooks route --task "[task description]"
```

**Example:**
```bash
npx @claude-flow/cli hooks route --task "implement OAuth2 authentication flow"
```

### Spawn Agent
Spawn a specific agent type

```bash
npx @claude-flow/cli agent spawn --type [type] --name [name]
```

**Example:**
```bash
npx @claude-flow/cli agent spawn --type coder --name impl-auth
```

### Monitor Status
Check the current swarm status

```bash
npx @claude-flow/cli swarm status --verbose
```

### Orchestrate an Objective
Orchestrate an objective across multiple agents (the `task orchestrate`
subcommand was replaced by `swarm start` in v3.25).

```bash
npx @claude-flow/cli swarm start --objective "[objective]" --strategy adaptive
```

**Example:**
```bash
npx @claude-flow/cli swarm start --objective "refactor auth module" --strategy parallel
```

### List Agents
List all active agents

```bash
npx @claude-flow/cli agent list --filter active
```


## Scripts

| Script | Path | Description |
|--------|------|-------------|
| `swarm-start` | `.agents/scripts/swarm-start.sh` | Initialize swarm with default settings |
| `swarm-monitor` | `.agents/scripts/swarm-monitor.sh` | Real-time swarm monitoring dashboard |


## References

| Document | Path | Description |
|----------|------|-------------|
| `Agent Types` | `docs/agents.md` | Complete list of agent types and capabilities |
| `Topology Guide` | `docs/topology.md` | Swarm topology configuration guide |

## Best Practices
1. Check memory for existing patterns before starting
2. Use hierarchical topology for coordination
3. Store successful patterns after completion
4. Document any new learnings
