# Agent Memory Storage

## Purpose
This directory stores agent-specific memory data, configurations, and persistent state information for individual Claude agents in the orchestration system.

## Structure
Each agent gets its own subdirectory for isolated memory storage:

```
memory/agents/
├── agent_001/
│   ├── state.json           # Agent state and configuration
│   ├── knowledge.md         # Agent-specific knowledge base
│   ├── tasks.json          # Completed and active tasks
│   └── calibration.json    # Agent-specific calibrations
├── agent_002/
│   └── ...
└── shared/
    ├── common_knowledge.md  # Shared knowledge across agents
    └── global_config.json  # Global agent configurations
```

## Usage Guidelines
1. **Agent Isolation**: Each agent should only read/write to its own directory
2. **Shared Resources**: Use the `shared/` directory for cross-agent information
3. **State Persistence**: Update state.json whenever agent status changes
4. **Knowledge Sharing**: Document discoveries in knowledge.md files
5. **Cleanup**: Remove directories for terminated agents periodically

## Last Updated
2025-07-07T12:31:31.622Z
