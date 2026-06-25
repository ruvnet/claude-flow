# Self-Healing Workflows

## Purpose
Automatically detect and recover from errors without interrupting your flow.

## Self-Healing Features

### 1. Error Detection
Monitors for:
- Failed commands
- Syntax errors
- Missing dependencies
- Broken tests

### 2. Automatic Recovery

**Missing Dependencies:**
```
Error: Cannot find module 'express'
→ Automatically runs: npm install express
→ Retries original command
```

**Syntax Errors:**
```
Error: Unexpected token
→ Analyzes error location
→ Suggests fix through analyzer agent
→ Applies fix with confirmation
```

**Test Failures:**
```
Test failed: "user authentication"
→ Spawns debugger agent
→ Analyzes failure cause
→ Implements fix
→ Re-runs tests
```

### 3. Learning from Failures
Each recovery improves future prevention:
- Patterns saved to knowledge base
- Similar errors prevented proactively
- Recovery strategies optimized

**Pattern Storage:**
```javascript
// Store error patterns
mcp__claude-flow__memory_usage({
  "action": "store",
  "key": "error-pattern-" + Date.now(),
  "value": JSON.stringify(errorData),
  "namespace": "error-patterns",
  "ttl": 2592000 // 30 days
})

// Analyze patterns
mcp__claude-flow__neural_patterns({
  "action": "analyze",
  "operation": "error-recovery",
  "outcome": "success"
})
```

## Self-Healing Integration

### MCP Tool Coordination
```javascript
// Initialize self-healing swarm
mcp__claude-flow__swarm_init({
  "topology": "star",
  "maxAgents": 4,
  "strategy": "adaptive"
})

// Spawn recovery agents
mcp__claude-flow__agent_spawn({
  "type": "monitor",
  "name": "Error Monitor",
  "capabilities": ["error-detection", "recovery"]
})

// Orchestrate recovery
mcp__claude-flow__task_orchestrate({
  "task": "recover from error",
  "strategy": "sequential",
  "priority": "critical"
})
```

### Fallback Hook Configuration
```json
{
  "PostToolUse": [{
    "matcher": "^Bash$",
    "command": "npx claude-flow@v3alpha hooks post-bash --exit-code '${tool.result.exitCode}' --auto-recover"
  }]
}
```

## Benefits
- 🛡️ Resilient workflows
- 🔄 Automatic recovery
- 📚 Learns from errors
- ⏱️ Saves debugging time