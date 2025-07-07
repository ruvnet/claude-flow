# Session Memory Storage

## Purpose
This directory stores session-based memory data, conversation history, and contextual information for development sessions using the Claude-Flow orchestration system.

## Structure
Sessions are organized by date and session ID for easy retrieval:

```
memory/sessions/
├── 2024-01-10/
│   ├── session_001/
│   │   ├── metadata.json        # Session metadata and configuration
│   │   ├── conversation.md      # Full conversation history
│   │   ├── decisions.md         # Key decisions and rationale
│   │   ├── artifacts/           # Generated files and outputs
│   │   └── coordination_state/  # Coordination system snapshots
│   └── ...
└── shared/
    ├── patterns.md              # Common session patterns
    └── templates/               # Session template files
```

## Usage Guidelines
1. **Session Isolation**: Each session gets its own directory
2. **Metadata Completeness**: Always fill out session metadata
3. **Conversation Logging**: Document all significant interactions
4. **Artifact Organization**: Structure generated files clearly
5. **State Preservation**: Snapshot coordination state regularly

## Last Updated
2025-07-07T13:52:23.502Z
