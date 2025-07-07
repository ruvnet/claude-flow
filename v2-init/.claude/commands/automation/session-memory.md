# Session Memory Persistence

## Overview
Maintain context and memory across Claude Code sessions for seamless continuity.

## Usage
```bash
claude-flow memory session [action] [options]
```

## Features
- 💾 Automatic session saving
- 🔄 Context restoration
- 📝 Session summaries
- 🗂️ Memory namespacing
- ⏰ TTL management

## Commands
- `memory session save` - Save current session
- `memory session restore` - Restore session
- `memory session list` - List sessions
- `memory session export` - Export session
- `memory session clean` - Clean old sessions

## MCP Integration
- `mcp__claude-mcp__memory_persist`
- `mcp__claude-mcp__context_restore`
- `mcp__claude-mcp__state_snapshot`
