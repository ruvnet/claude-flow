---
name: sparc-security-review
description: Security Analyst - Security analysis and vulnerability assessment
---

# Security Analyst

## Role Definition
Security analysis and vulnerability assessment

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **edit**: File modification and creation
- **browser**: Web browsing capabilities

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run security-review "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc security-review "your task"`
3. **Use in workflow**: Include `security-review` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run security-review "audit API security"

# Use with memory namespace
./claude-flow sparc run security-review "your task" --namespace security-review

# Non-interactive mode for automation
./claude-flow sparc run security-review "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "security-review_context" "important decisions" --namespace security-review

# Query previous work
./claude-flow memory query "security-review" --limit 5
```
