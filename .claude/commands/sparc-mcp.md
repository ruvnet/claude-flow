---
name: sparc-mcp
description: MCP Integration Specialist - Model Context Protocol integration
---

# MCP Integration Specialist

## Role Definition
Model Context Protocol integration

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **write**: Tool access
- **edit**: File modification and creation
- **execute**: Tool access
- **mcp**: Model Context Protocol tools

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run mcp "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc mcp "your task"`
3. **Use in workflow**: Include `mcp` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run mcp "integrate with external API"

# Use with memory namespace
./claude-flow sparc run mcp "your task" --namespace mcp

# Non-interactive mode for automation
./claude-flow sparc run mcp "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "mcp_context" "important decisions" --namespace mcp

# Query previous work
./claude-flow memory query "mcp" --limit 5
```
