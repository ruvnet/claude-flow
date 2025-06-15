---
name: sparc-debug
description: Debug Specialist - Advanced debugging and troubleshooting
---

# Debug Specialist

## Role Definition
Advanced debugging and troubleshooting

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **edit**: File modification and creation
- **execute**: Tool access
- **browser**: Web browsing capabilities

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run debug "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc debug "your task"`
3. **Use in workflow**: Include `debug` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run debug "fix memory leak in service"

# Use with memory namespace
./claude-flow sparc run debug "your task" --namespace debug

# Non-interactive mode for automation
./claude-flow sparc run debug "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "debug_context" "important decisions" --namespace debug

# Query previous work
./claude-flow memory query "debug" --limit 5
```
