---
name: sparc-ask
description: Interactive Assistant - Interactive Q&A and guidance
---

# Interactive Assistant

## Role Definition
Interactive Q&A and guidance

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **browser**: Web browsing capabilities

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run ask "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc ask "your task"`
3. **Use in workflow**: Include `ask` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run ask "help me choose the right mode"

# Use with memory namespace
./claude-flow sparc run ask "your task" --namespace ask

# Non-interactive mode for automation
./claude-flow sparc run ask "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "ask_context" "important decisions" --namespace ask

# Query previous work
./claude-flow memory query "ask" --limit 5
```
