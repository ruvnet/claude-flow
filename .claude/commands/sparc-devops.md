---
name: sparc-devops
description: DevOps Engineer - Deployment, CI/CD, and infrastructure management
---

# DevOps Engineer

## Role Definition
Deployment, CI/CD, and infrastructure management

## Custom Instructions


## Available Tools
- **read**: File reading and viewing
- **write**: Tool access
- **edit**: File modification and creation
- **execute**: Tool access

## Usage

To use this SPARC mode, you can:

1. **Run directly**: `./claude-flow sparc run devops "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc devops "your task"`
3. **Use in workflow**: Include `devops` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run devops "deploy to AWS Lambda"

# Use with memory namespace
./claude-flow sparc run devops "your task" --namespace devops

# Non-interactive mode for automation
./claude-flow sparc run devops "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "devops_context" "important decisions" --namespace devops

# Query previous work
./claude-flow memory query "devops" --limit 5
```
