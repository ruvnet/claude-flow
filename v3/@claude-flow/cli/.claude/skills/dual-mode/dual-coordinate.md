---
name: dual-coordinate
description: Coordinate hybrid Claude Code + Codex workflows
---

# Dual Coordinate Skill

Coordinate hybrid workflows that use Claude Code for interactive reasoning and Codex for parallel background execution.

## Usage

```
/dual-coordinate --workflow <workflow-name> --task "<task-description>"
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--workflow` | hybrid_development | Workflow template to use |
| `--task` | required | Task description |
| `--interactive-first` | true | Start with interactive phase |

## Available Workflows

### hybrid_development
Design interactively, implement in parallel, review interactively.

```
/dual-coordinate --workflow hybrid_development --task "Build user authentication"
```

### parallel_feature
Spawn multiple Codex workers for parallel implementation.

```
/dual-coordinate --workflow parallel_feature --task "Implement REST API"
```

### design_and_execute
Interactive design phase, then batch execution.

```
/dual-coordinate --workflow design_and_execute --task "Refactor auth module"
```

## How It Works

1. **Routing Decision**: Analyzes task to determine optimal platform split
2. **Interactive Phase**: Complex reasoning in Claude Code
3. **Parallel Phase**: Spawns Codex workers for execution
4. **Review Phase**: Returns to Claude Code for quality review
5. **Result Collection**: Aggregates worker results from memory

## Generated Commands

```bash
# Phase 1: Interactive (Claude Code)
# [Current session handles design/planning]

# Phase 2: Parallel (Codex)
{{#each workers}}
claude -p "{{this.task}}" --session-id {{this.id}} &
{{/each}}
wait

# Phase 3: Review (Claude Code)
npx claude-flow@v3alpha memory list --namespace results
```

## Example: Full Hybrid Workflow

```
/dual-coordinate --workflow hybrid_development --task "Build user profile API"
```

This will:
1. **Design Phase** (Interactive): Discuss requirements, design endpoints, plan implementation
2. **Implement Phase** (Headless): Spawn coders, testers, docs writers in parallel
3. **Review Phase** (Interactive): Review implementation, discuss improvements

## Related Skills

- `/dual-spawn` - Spawn headless workers only
- `/dual-collect` - Collect results from workers
