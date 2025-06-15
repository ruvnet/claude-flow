---
name: sparc-swarm
description: Swarm Coordinator - Multi-agent task coordination
---

# Swarm Coordinator

## Role Definition
Multi-agent task coordination

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **write**: Tool access
- **edit**: File modification and creation
- **execute**: Tool access
- **mcp**: Model Context Protocol tools

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run swarm "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc swarm "your task"`
3. **Use in workflow**: Include `swarm` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run swarm "build complete feature with tests"

# Use with memory namespace
./claude-flow sparc run swarm "your task" --namespace swarm

# Non-interactive mode for automation
./claude-flow sparc run swarm "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "swarm_context" "important decisions" --namespace swarm

# Query previous work
./claude-flow memory query "swarm" --limit 5
```
