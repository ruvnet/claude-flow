---
name: session-persist
description: Persist and restore agent sessions across conversations with state snapshots
argument-hint: "[--save|--restore|--list]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__session_save mcp__plugin_ruflo-core_ruflo__session_restore mcp__plugin_ruflo-core_ruflo__session_list mcp__plugin_ruflo-core_ruflo__session_info mcp__plugin_ruflo-core_ruflo__session_delete mcp__plugin_ruflo-core_ruflo__hooks_session-start mcp__plugin_ruflo-core_ruflo__hooks_session-end mcp__plugin_ruflo-core_ruflo__hooks_session-restore Bash
---

# Session Persistence

Save and restore complete agent sessions across conversations.

## When to use

When you need to pause work and resume later with full context, or when you want to checkpoint progress during long-running tasks.

## Steps

1. **Save session** — call `mcp__plugin_ruflo-core_ruflo__session_save` to snapshot current state
2. **List sessions** — call `mcp__plugin_ruflo-core_ruflo__session_list` to see all saved sessions
3. **Restore** — call `mcp__plugin_ruflo-core_ruflo__session_restore` to resume a previous session
4. **Info** — call `mcp__plugin_ruflo-core_ruflo__session_info` for session details and metadata
5. **Clean up** — call `mcp__plugin_ruflo-core_ruflo__session_delete` to remove old sessions

## Session hooks

- `hooks_session-start` — automatically restore context at conversation start
- `hooks_session-end` — automatically save state with metrics export
- `hooks_session-restore` — restore a specific session by ID

## What's persisted

- Agent state and configuration
- Memory entries and patterns
- Learning trajectories and metrics
- Task progress and todos
