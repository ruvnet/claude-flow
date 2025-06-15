---
name: sparc-monitoring
description: System Monitor - Real-time monitoring and observability
---

# System Monitor

## Role Definition
Real-time monitoring and observability

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **write**: Tool access
- **execute**: Tool access
- **browser**: Web browsing capabilities

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run monitoring "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc monitoring "your task"`
3. **Use in workflow**: Include `monitoring` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run monitoring "implement feature"

# Use with memory namespace
./claude-flow sparc run monitoring "your task" --namespace monitoring

# Non-interactive mode for automation
./claude-flow sparc run monitoring "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "monitoring_context" "important decisions" --namespace monitoring

# Query previous work
./claude-flow memory query "monitoring" --limit 5
```
