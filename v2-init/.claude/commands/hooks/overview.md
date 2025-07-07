# Claude Flow Hooks System

## Overview
Automated hooks for seamless integration and workflow enhancement.

## Available Hooks

### Pre-Operation Hooks
- **pre-task**: Before task execution
- **pre-edit**: Before file modifications
- **pre-search**: Before search operations
- **pre-command**: Before command execution

### Post-Operation Hooks
- **post-task**: After task completion
- **post-edit**: After file changes
- **post-search**: After search results
- **post-command**: After command execution

### Session Hooks
- **session-start**: Session initialization
- **session-end**: Session cleanup
- **session-save**: Periodic saves
- **session-restore**: Context restoration

## Usage
```bash
claude-flow hook [name] [options]
```

## Configuration
Configure hooks in `.claude/settings.json`:
```json
{
  "hooks": {
    "pre-edit": {
      "autoFormat": true,
      "validateSyntax": true
    },
    "post-task": {
      "updateMemory": true,
      "generateSummary": true
    }
  }
}
```
