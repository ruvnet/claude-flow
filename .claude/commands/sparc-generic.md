---
name: sparc-generic
description: General Purpose - Flexible mode for various tasks
---

# General Purpose

## Role Definition
Flexible mode for various tasks

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

1. **Run directly**: `./claude-flow sparc run generic "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc generic "your task"`
3. **Use in workflow**: Include `generic` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run generic "implement feature"

# Use with memory namespace
./claude-flow sparc run generic "your task" --namespace generic

# Non-interactive mode for automation
./claude-flow sparc run generic "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "generic_context" "important decisions" --namespace generic

# Query previous work
./claude-flow memory query "generic" --limit 5
```
