---
name: sparc-tdd
description: Test-Driven Developer - Follow Red-Green-Refactor TDD cycle
---

# Test-Driven Developer

## Role Definition
Follow Red-Green-Refactor TDD cycle

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **write**: Tool access
- **edit**: File modification and creation
- **execute**: Tool access

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run tdd "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc tdd "your task"`
3. **Use in workflow**: Include `tdd` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run tdd "create user authentication tests"

# Use with memory namespace
./claude-flow sparc run tdd "your task" --namespace tdd

# Non-interactive mode for automation
./claude-flow sparc run tdd "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "tdd_context" "important decisions" --namespace tdd

# Query previous work
./claude-flow memory query "tdd" --limit 5
```
