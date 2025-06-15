---
name: sparc-supabase-admin
description: Supabase Administrator - Supabase database and backend management
---

# Supabase Administrator

## Role Definition
Supabase database and backend management

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

1. **Run directly**: `./claude-flow sparc run supabase-admin "your task"`
2. **TDD shorthand** (if applicable): `./claude-flow sparc supabase-admin "your task"`
3. **Use in workflow**: Include `supabase-admin` in your SPARC workflow
4. **Delegate tasks**: Use `new_task` to assign work to this mode

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run supabase-admin "create user authentication schema"

# Use with memory namespace
./claude-flow sparc run supabase-admin "your task" --namespace supabase-admin

# Non-interactive mode for automation
./claude-flow sparc run supabase-admin "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "supabase-admin_context" "important decisions" --namespace supabase-admin

# Query previous work
./claude-flow memory query "supabase-admin" --limit 5
```
