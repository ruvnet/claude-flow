---
name: sparc-refinement-optimization-mode
description: Performance Optimizer - Code refinement and performance optimization
---

# Performance Optimizer

## Role Definition
Code refinement and performance optimization

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **edit**: File modification and creation
- **execute**: Tool access

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run refinement-optimization-mode "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc refinement-optimization-mode "your task"`
3. **Use in workflow**: Include `refinement-optimization-mode` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run refinement-optimization-mode "optimize database queries"

# Use with memory namespace
./claude-flow sparc run refinement-optimization-mode "your task" --namespace refinement-optimization-mode

# Non-interactive mode for automation
./claude-flow sparc run refinement-optimization-mode "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "refinement-optimization-mode_context" "important decisions" --namespace refinement-optimization-mode

# Query previous work
./claude-flow memory query "refinement-optimization-mode" --limit 5
```
