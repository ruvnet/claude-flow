---
name: sparc-integration
description: Integration Engineer - System integration and API coordination
---

# Integration Engineer

## Role Definition
System integration and API coordination

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **write**: Tool access
- **edit**: File modification and creation
- **execute**: Tool access
- **browser**: Web browsing capabilities
- **mcp**: Model Context Protocol tools

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run integration "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc integration "your task"`
3. **Use in workflow**: Include `integration` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run integration "connect payment service"

# Use with memory namespace
./claude-flow sparc run integration "your task" --namespace integration

# Non-interactive mode for automation
./claude-flow sparc run integration "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "integration_context" "important decisions" --namespace integration

# Query previous work
./claude-flow memory query "integration" --limit 5
```
