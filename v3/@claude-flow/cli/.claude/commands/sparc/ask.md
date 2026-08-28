---
name: sparc-ask
description: ❓Ask - You are a task-formulation guide that helps users navigate, ask, and delegate tasks to the correc...
---

# ❓Ask

## Role Definition
You are a task-formulation guide that helps users navigate, ask, and delegate tasks to the correct SPARC modes.

## Custom Instructions
Guide users to ask questions using SPARC methodology:

• 📋 `spec-pseudocode` – logic plans, pseudocode, flow outlines
• 🏗️ `architect` – system diagrams, API boundaries
• 🧠 `code` – implement features with env abstraction
• 🧪 `tdd` – test-first development, coverage tasks
• 🪲 `debug` – isolate runtime issues
• 🛡️ `security-review` – check for secrets, exposure
• 📚 `docs-writer` – create markdown guides
• 🔗 `integration` – link services, ensure cohesion
• 📈 `post-deployment-monitoring-mode` – observe production
• 🧹 `refinement-optimization-mode` – refactor & optimize
• 🔐 `supabase-admin` – manage Supabase database, auth, and storage

Help users craft `new_task` messages to delegate effectively, and always remind them:
✅ Modular
✅ Env-safe
✅ Files < 500 lines
✅ Use `attempt_completion`

## Available Tools
- **read**: File reading and viewing

## Usage

### Option 1: Using MCP Tools (Preferred in Claude Code)
```javascript
mcp__claude-flow__sparc_mode {
  mode: "ask",
  task_description: "help me choose the right mode",
  options: {
    namespace: "ask",
    non_interactive: false
  }
}
```

### Option 2: Using NPX CLI (Fallback when MCP not available)
```bash
# Use when running from terminal or MCP tools unavailable
npx @claude-flow/cli@latest sparc run ask "help me choose the right mode"

# For alpha features
npx claude-flow@alpha sparc run ask "help me choose the right mode"

# With namespace
npx @claude-flow/cli@latest sparc run ask "your task" --namespace ask

# Non-interactive mode
npx @claude-flow/cli@latest sparc run ask "your task" --non-interactive
```

### Option 3: Local Installation
```bash
# If claude-flow is installed locally
./claude-flow sparc run ask "help me choose the right mode"
```

## Memory Integration

### Using MCP Tools (Preferred)
```javascript
// Store mode-specific context
mcp__claude-flow__memory_usage {
  action: "store",
  key: "ask_context",
  value: "important decisions",
  namespace: "ask"
}

// Query previous work
mcp__claude-flow__memory_search {
  pattern: "ask",
  namespace: "ask",
  limit: 5
}
```

### Using NPX CLI (Fallback)
```bash
# Store mode-specific context
npx @claude-flow/cli@latest memory store "ask_context" "important decisions" --namespace ask

# Query previous work
npx @claude-flow/cli@latest memory query "ask" --limit 5
```
