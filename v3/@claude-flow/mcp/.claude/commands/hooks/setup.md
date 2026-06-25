# Setting Up Claude Flow Hooks

## Two-Layer Model

Claude Flow's hook system operates at **two distinct layers** that work together but serve different
purposes. Understanding the distinction prevents misconfiguration.

### Layer 1 — Claude Code Matcher Hooks (`.claude/settings.json`)

These fire around **Claude Code's own tool calls** (file writes, edits, bash commands). Configured in
`.claude/settings.json` under `hooks.PreToolUse` / `hooks.PostToolUse`. Each entry specifies a regex
`matcher` for a Claude tool name (`Write`, `Edit`, `Bash`, `Task`, …) and runs a shell command.

**Key characteristic**: Claude Code evaluates these; if the command exits non-zero the tool call can be
blocked. The `${tool.params.*}` interpolation is performed by Claude Code's harness, not claude-flow.

### Layer 2 — claude-flow Internal Hooks (`npx claude-flow@v3alpha hooks <subcommand>`)

These are invoked **by the claude-flow CLI itself** to manage agent coordination, session state,
learning, and Agent Teams events. They are independent of Claude Code's tool lifecycle and operate
inside the swarm's own orchestration engine.

```bash
# Agent Teams hooks — fired by the swarm when a teammate finishes or a task completes
npx claude-flow@v3alpha hooks teammate-idle --auto-assign true
npx claude-flow@v3alpha hooks task-completed --task-id "my-task" --train-patterns true
```

---

## Quick Start

### 1. Initialize with Hooks
```bash
npx claude-flow@v3alpha init
```

This automatically creates:
- `.claude/settings.json` with hook configurations for both Layer 1 and Layer 2
- Hook command documentation in `.claude/commands/hooks/`
- Default hook handlers for common operations

### 2. The v3 `settings.json` emitted by `init`

`npx claude-flow@v3alpha init` writes a settings file that activates both layers together:

```json
{
  "env": {
    "CLAUDE_FLOW_HOOKS_ENABLED": "true"
  },
  "claudeFlow": {
    "agentTeams": {
      "hooks": {
        "teammateIdle": {
          "autoAssign": true,
          "notifyLead": true
        },
        "taskCompleted": {
          "trainPatterns": true,
          "exportLearnings": true
        }
      }
    }
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{
          "type": "command",
          "command": "npx claude-flow@v3alpha hooks pre-edit --file '${tool.params.file_path}'"
        }]
      },
      {
        "matcher": "^Bash$",
        "hooks": [{
          "type": "command",
          "command": "npx claude-flow@v3alpha hooks pre-command --command '${tool.params.command}'"
        }]
      },
      {
        "matcher": "^Task$",
        "hooks": [{
          "type": "command",
          "command": "npx claude-flow@v3alpha hooks pre-task --description '${tool.params.prompt}' --load-memory",
          "async": true
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{
          "type": "command",
          "command": "npx claude-flow@v3alpha hooks post-edit --file '${tool.params.file_path}' --train-patterns",
          "async": true
        }]
      },
      {
        "matcher": "^Bash$",
        "hooks": [{
          "type": "command",
          "command": "npx claude-flow@v3alpha hooks post-command --command '${tool.params.command}' --track-metrics",
          "async": true
        }]
      },
      {
        "matcher": "^Task$",
        "hooks": [{
          "type": "command",
          "command": "npx claude-flow@v3alpha hooks post-task --task-id '${result.task_id}' --store-decisions",
          "async": true
        }]
      }
    ]
  }
}
```

**Layer 1 keys** (`hooks.PreToolUse` / `hooks.PostToolUse`) are read by Claude Code.
**Layer 2 keys** (`env.CLAUDE_FLOW_HOOKS_ENABLED`, `claudeFlow.agentTeams.hooks`) are read by claude-flow.

### 3. Test Hook Functionality
```bash
# Test pre-edit hook
npx claude-flow@v3alpha hooks pre-edit --file test.js

# Test session summary
npx claude-flow@v3alpha hooks session-end --summary
```

### 4. Debugging Hooks
```bash
# Enable debug output
export CLAUDE_FLOW_DEBUG=true

# Test specific hook
npx claude-flow@v3alpha hooks pre-edit --file app.js --debug
```

---

## All `hooks` Subcommands

### Task Lifecycle

| Subcommand | Description |
|---|---|
| `pre-task` | Record task start, get agent suggestions, auto-spawn swarm |
| `post-task` | Record completion, analyze performance, store decisions |

### Tool Lifecycle (Layer 1 bridge)

| Subcommand | Description |
|---|---|
| `pre-edit` | Validate and assign agents before file modifications |
| `post-edit` | Auto-format, validate, and train neural patterns after edits |
| `pre-command` | Assess safety and resource requirements before bash commands |
| `post-command` | Log execution and update performance metrics |
| `pre-bash` | Alias for `pre-command` (v2 compat) |
| `post-bash` | Alias for `post-command` (v2 compat) |

### Session Management

| Subcommand | Description |
|---|---|
| `session-start` | Initialize new session with context restoration |
| `session-end` | Persist state, export metrics, generate summary |
| `session-restore` | Reload a previous session state |

### Intelligence & Routing

| Subcommand | Description |
|---|---|
| `route` | Route task to optimal agent via HNSW |
| `route-task` | Alias for `route` (v2 compat) |
| `explain` | Explain routing decision in detail |
| `pretrain` | Bootstrap SONA/MoE intelligence from repo patterns |
| `build-agents` | Generate optimized agent configurations |
| `metrics` | View learning metrics dashboard |
| `model-route` | 3-tier model routing recommendation (Agent Booster → Haiku → Sonnet/Opus) |
| `model-stats` | Model usage and cost statistics |
| `model-outcome` | Record model outcome to improve future routing |

### Agent Teams (Layer 2 — comms coordination)

| Subcommand | Description |
|---|---|
| `teammate-idle` | Auto-assign pending tasks when a teammate finishes its turn |
| `task-completed` | Train patterns and notify lead on task completion |

### Pattern Transfer & Registry

| Subcommand | Description |
|---|---|
| `transfer` | Transfer patterns via IPFS registry |
| `list` | List all registered hooks and their status |
| `init` | Re-initialize hooks system configuration |
| `notify` | Send notification with swarm status |

### Intelligence Sub-system (RuVector)

| Subcommand | Description |
|---|---|
| `intelligence` | Entry point for RuVector intelligence operations |
| `intelligence trajectory-start` | Begin a new learning trajectory |
| `intelligence trajectory-step` | Record a reasoning step in an active trajectory |
| `intelligence trajectory-end` | Finalize and score a completed trajectory |
| `intelligence pattern-store` | Persist a learned coordination pattern |
| `intelligence pattern-search` | Search stored patterns via HNSW (150x–12,500x faster) |
| `intelligence stats` | View intelligence system statistics and EWC++ health |
| `intelligence attention` | Configure attention weights for MoE routing |
| `intelligence-reset` | Reset RuVector intelligence state to baseline |

### Coverage-Aware Routing

| Subcommand | Description |
|---|---|
| `coverage-route` | Route task to address highest-priority coverage gaps |
| `coverage-suggest` | Suggest test coverage improvements for a path |
| `coverage-gaps` | List current coverage gaps with priorities |

### Background Workers

| Subcommand | Description |
|---|---|
| `worker list` | List all 12 background workers and their status |
| `worker dispatch` | Dispatch a specific worker by trigger name |
| `worker status` | Show worker queue depth and health |
| `worker detect` | Auto-detect which workers should run for current state |
| `worker cancel` | Cancel a running background worker |

### Utilities

| Subcommand | Description |
|---|---|
| `progress` | Check V3 implementation progress |
| `statusline` | Generate dynamic statusline for Claude Code HUD |

---

## Hook Response Format

Layer 1 hooks (Claude Code matcher) return JSON read by the harness:

```json
{
  "continue": false,
  "reason": "Protected file — manual review required",
  "metadata": {
    "file": ".env.production",
    "protection_level": "high"
  }
}
```

- `continue: false` **blocks** the tool call
- `continue: true` (or no JSON output) allows it to proceed

---

## Common Patterns

### Protected File Detection (Layer 1)
```json
{
  "matcher": "^(Write|Edit)$",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow@v3alpha hooks pre-edit --file '${tool.params.file_path}' --check-conflicts"
  }]
}
```

### Auto-Train on Every Save (Layer 1)
```json
{
  "matcher": "^(Write|Edit|MultiEdit)$",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow@v3alpha hooks post-edit --file '${tool.params.file_path}' --train-patterns --auto-format",
    "async": true
  }]
}
```

### Automatic Testing on Write (Layer 1)
```json
{
  "matcher": "^Write$",
  "hooks": [{
    "type": "command",
    "command": "test -f '${tool.params.file_path%.js}.test.js' && npm test '${tool.params.file_path%.js}.test.js'"
  }]
}
```

### Agent Teams Auto-Assign (Layer 2)
```bash
npx claude-flow@v3alpha hooks teammate-idle --auto-assign true
```

## Performance Tips
- Keep Layer 1 hooks lightweight (< 100ms) — use `"async": true` for heavy operations
- Use caching for repeated lookups
- Batch related operations in a single hook command
- Run non-critical hooks with `"continueOnError": true`
