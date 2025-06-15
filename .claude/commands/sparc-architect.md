---
name: sparc-architect
description: System Architect - Design system architecture and create component diagrams
---

# System Architect

## Role Definition
Design system architecture and create component diagrams

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **write**: Tool access
- **edit**: File modification and creation
- **browser**: Web browsing capabilities
- **mcp**: Model Context Protocol tools

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run architect "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc architect "your task"`
3. **Use in workflow**: Include `architect` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run architect "design microservices architecture"

# Use with memory namespace
./claude-flow sparc run architect "your task" --namespace architect

# Non-interactive mode for automation
./claude-flow sparc run architect "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "architect_context" "important decisions" --namespace architect

# Query previous work
./claude-flow memory query "architect" --limit 5
```
