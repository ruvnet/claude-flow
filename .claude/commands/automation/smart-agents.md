# Smart Agent Auto-Spawning

## Purpose
Automatically spawn the right agents at the right time without manual intervention.

## Auto-Spawning Triggers

### 1. File Type Detection
When editing files, agents auto-spawn:
- **JavaScript/TypeScript**: Coder agent
- **Markdown**: Researcher agent
- **JSON/YAML**: Analyst agent
- **Multiple files**: Coordinator agent

### 2. Task Complexity
```
Simple task: "Fix typo"
→ Single coordinator agent

Complex task: "Implement OAuth with Google"
→ Architect + Coder + Tester + Researcher
```

### 3. Dynamic Scaling
The system monitors workload and spawns additional agents when:
- Task queue grows
- Complexity increases
- Parallel opportunities exist

**Status Monitoring:**
```javascript
// Check swarm health
mcp__claude-flow__swarm_status({
  "swarmId": "current"
})

// Monitor agent performance
mcp__claude-flow__agent_metrics({
  "agentId": "agent-123"
})
```

## Configuration

### MCP Tool Integration
Uses Claude Flow MCP tools for agent coordination:
```javascript
// Initialize swarm with appropriate topology
mcp__claude-flow__swarm_init({
  "topology": "mesh",
  "maxAgents": 8,
  "strategy": "auto"
})

// Spawn agents based on file type
mcp__claude-flow__agent_spawn({
  "type": "coder",
  "name": "JavaScript Handler",
  "capabilities": ["javascript", "typescript"]
})
```

### Fallback Configuration
If MCP tools are unavailable:
```bash
npx claude-flow@v3alpha hooks pre-task --auto-spawn-agents
```

## Benefits
- 🤖 Zero manual agent management
- 🎯 Perfect agent selection
- 📈 Dynamic scaling
- 💾 Resource efficiency