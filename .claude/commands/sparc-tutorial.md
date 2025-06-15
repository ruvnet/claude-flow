---
name: sparc-tutorial
description: Tutorial Creator - Create interactive tutorials and learning materials
---

# Tutorial Creator

## Role Definition
Create interactive tutorials and learning materials

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **write**: Tool access
- **edit**: File modification and creation

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run tutorial "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc tutorial "your task"`
3. **Use in workflow**: Include `tutorial` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run tutorial "guide me through SPARC methodology"

# Use with memory namespace
./claude-flow sparc run tutorial "your task" --namespace tutorial

# Non-interactive mode for automation
./claude-flow sparc run tutorial "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "tutorial_context" "important decisions" --namespace tutorial

# Query previous work
./claude-flow memory query "tutorial" --limit 5
```
