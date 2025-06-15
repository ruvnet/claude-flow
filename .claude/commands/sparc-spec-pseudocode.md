---
name: sparc-spec-pseudocode
description: Specification Designer - Create detailed specifications and pseudocode
---

# Specification Designer

## Role Definition
Create detailed specifications and pseudocode

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **write**: Tool access
- **edit**: File modification and creation

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run spec-pseudocode "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc spec-pseudocode "your task"`
3. **Use in workflow**: Include `spec-pseudocode` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run spec-pseudocode "define payment flow requirements"

# Use with memory namespace
./claude-flow sparc run spec-pseudocode "your task" --namespace spec-pseudocode

# Non-interactive mode for automation
./claude-flow sparc run spec-pseudocode "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "spec-pseudocode_context" "important decisions" --namespace spec-pseudocode

# Query previous work
./claude-flow memory query "spec-pseudocode" --limit 5
```
