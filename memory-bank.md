# Memory Bank Configuration

## Overview
The Claude-Flow memory system provides persistent storage and intelligent retrieval of information across agent sessions. It uses a hybrid approach combining SQL databases with semantic search capabilities.

## Storage Backends
- **Primary**: JSON database (`./memory/claude-flow-data.json`)
- **Sessions**: File-based storage in `./memory/sessions/`
- **Cache**: In-memory cache for frequently accessed data

## Memory Organization
- **Namespaces**: Logical groupings of related information
- **Sessions**: Time-bound conversation contexts
- **Indexing**: Automatic content indexing for fast retrieval
- **Replication**: Optional distributed storage support

## Commands
- `npx claude-flow memory query <search>`: Search stored information
- `npx claude-flow memory stats`: Show memory usage statistics
- `npx claude-flow memory export <file>`: Export memory to file
- `npx claude-flow memory import <file>`: Import memory from file

## Configuration
Memory settings are configured in `claude-flow.config.json`:
```json
{
  "memory": {
    "backend": "json",
    "path": "./memory/claude-flow-data.json",
    "cacheSize": 1000,
    "indexing": true,
    "namespaces": ["default", "agents", "tasks", "sessions"],
    "retentionPolicy": {
      "sessions": "30d",
      "tasks": "90d",
      "agents": "permanent"
    }
  }
}
```

## Best Practices
- Use descriptive namespaces for different data types
- Regular memory exports for backup purposes
- Monitor memory usage with stats command
- Clean up old sessions periodically

## Memory Types
- **Episodic**: Conversation and interaction history
- **Semantic**: Factual knowledge and relationships
- **Procedural**: Task patterns and workflows
- **Meta**: System configuration and preferences

## Integration Notes
- Memory is automatically synchronized across agents
- Search supports both exact match and semantic similarity
- Memory contents are private to your local instance
- No data is sent to external services without explicit commands
