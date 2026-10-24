# Memory Coordination Example for Multi-Agent Swarms

## Problem: Agents Not Writing to Memory

Your example showed agents only reading memory but never writing, causing coordination failure:
```javascript
// ❌ WRONG - Only reading, never writing
memory_usage { action: "retrieve", key: "plugin-system/agent-1/" }
// Returns: { "found": false, "value": null }
```

## Solution: Mandatory Memory Write Protocol

### Complete Working Example: Plugin System with 5 Agents

```javascript
// ============================================
// AGENT 1: Core Plugin Foundation
// ============================================
Task("Core Plugin Foundation", `
You are Agent 1 - Core Plugin Foundation Architect.

🚨 MANDATORY MEMORY WRITES:

// 1. START - Write initial status
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/agent-1-core/status",
  namespace: "coordination",
  value: JSON.stringify({
    agent: "agent-1-core",
    status: "starting",
    timestamp: Date.now(),
    tasks: [
      "Create core plugin traits",
      "Implement plugin loading",
      "Build stable ABI definitions",
      "Create plugin metadata system"
    ],
    progress: 0
  })
}

// 2. After creating plugin traits - SHARE them
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/shared/plugin-traits",
  namespace: "coordination", 
  value: JSON.stringify({
    type: "interface",
    definition: \`
      use abi_stable::{StableAbi, std_types::RString};
      
      #[repr(C)]
      #[derive(StableAbi)]
      pub trait Plugin: Send + Sync {
          fn name(&self) -> RString;
          fn version(&self) -> RString;
          fn execute(&self) -> Result<(), RString>;
      }
    \`,
    usage: "impl Plugin for YourPlugin { ... }",
    created_by: "agent-1-core",
    timestamp: Date.now()
  })
}

// 3. Update progress
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/agent-1-core/progress",
  namespace: "coordination",
  value: JSON.stringify({
    completed: ["Core traits defined", "ABI stable interfaces"],
    current: "Implementing plugin loader",
    progress: 40,
    files_created: [
      "crates/core/src/plugins/core/traits.rs",
      "crates/core/src/plugins/core/loader.rs"
    ],
    interfaces: {
      "Plugin": "trait with name(), version(), execute()",
      "PluginLoader": "load_plugin(path) -> Result<Box<dyn Plugin>>"
    }
  })
}

// 4. Signal when ready for others
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/agent-1-core/complete",
  namespace: "coordination",
  value: JSON.stringify({
    status: "complete",
    deliverables: [
      "Core plugin traits with stable ABI",
      "Plugin loading mechanism",
      "Metadata system"
    ],
    integration_points: [
      "Use Plugin trait for all plugin types",
      "Call PluginLoader::load_plugin() to load"
    ]
  })
}
`, "system-architect");

// ============================================
// AGENT 2: WASM Security Runtime
// ============================================
Task("WASM Security Runtime", `
You are Agent 2 - WASM Security Specialist.

🚨 MANDATORY MEMORY WRITES:

// 1. Write initial status
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/agent-2-wasm/status",
  namespace: "coordination",
  value: JSON.stringify({
    agent: "agent-2-wasm",
    status: "starting",
    tasks: ["Setup wasmtime", "Create sandboxing", "Build permissions"],
    progress: 0
  })
}

// 2. CHECK for Agent 1's interfaces
const pluginTraits = mcp__claude-flow__memory_usage {
  action: "retrieve",
  key: "swarm/shared/plugin-traits",
  namespace: "coordination"
}

if (!pluginTraits.found) {
  // WRITE that we're waiting
  mcp__claude-flow__memory_usage {
    action: "store",
    key: "swarm/agent-2-wasm/waiting",
    namespace: "coordination",
    value: JSON.stringify({
      waiting_for: "plugin-traits",
      from_agent: "agent-1-core",
      since: Date.now(),
      implementing_stub: true
    })
  }
}

// 3. Share security policies for others
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/shared/security-policies",
  namespace: "coordination",
  value: JSON.stringify({
    type: "security-config",
    definition: {
      sandbox: "wasmtime with capability-based permissions",
      resource_limits: {
        memory: "100MB",
        cpu_time: "5s",
        file_access: "readonly to ./plugins"
      },
      capabilities: ["network:none", "filesystem:readonly", "process:none"]
    },
    created_by: "agent-2-wasm"
  })
}

// 4. Update progress
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/agent-2-wasm/progress",
  namespace: "coordination",
  value: JSON.stringify({
    completed: ["Wasmtime setup", "Sandbox configuration"],
    current: "Implementing permission system",
    progress: 60,
    files_created: ["crates/core/src/plugins/wasm/sandbox.rs"]
  })
}
`, "security-manager");

// ============================================
// AGENT 3: MCP Integration Bridges
// ============================================
Task("MCP Integration", `
You are Agent 3 - MCP Integration Specialist.

🚨 MANDATORY COORDINATION:

// 1. Initial status
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/agent-3-mcp/status",
  namespace: "coordination",
  value: JSON.stringify({
    agent: "agent-3-mcp",
    status: "starting",
    tasks: ["Create MCP bridges", "Claude-Flow integration"],
    progress: 0
  })
}

// 2. Check dependencies from BOTH Agent 1 and 2
const traits = mcp__claude-flow__memory_usage {
  action: "retrieve",
  key: "swarm/shared/plugin-traits",
  namespace: "coordination"
}

const security = mcp__claude-flow__memory_usage {
  action: "retrieve",
  key: "swarm/shared/security-policies",
  namespace: "coordination"
}

// 3. Share MCP bridge interfaces
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/shared/mcp-bridges",
  namespace: "coordination",
  value: JSON.stringify({
    type: "api",
    bridges: {
      "claude-flow": "McpBridge::claude_flow()",
      "ruv-swarm": "McpBridge::ruv_swarm()",
      "flow-nexus": "McpBridge::flow_nexus()"
    },
    created_by: "agent-3-mcp"
  })
}
`, "backend-dev");

// ============================================
// COORDINATION MONITORING
// ============================================
// Check overall swarm progress
mcp__claude-flow__memory_usage {
  action: "list",
  namespace: "coordination",
  pattern: "swarm/*/progress"
}

// Get all shared components
mcp__claude-flow__memory_usage {
  action: "list", 
  namespace: "coordination",
  pattern: "swarm/shared/*"
}

// Check for blocking issues
mcp__claude-flow__memory_usage {
  action: "list",
  namespace: "coordination", 
  pattern: "swarm/*/waiting"
}
```

## Key Patterns for Success

### 1. Consistent Namespace
```javascript
// ✅ ALWAYS use "coordination" namespace
namespace: "coordination"
```

### 2. Structured Keys
```javascript
// Individual agent data
"swarm/[agent-name]/status"
"swarm/[agent-name]/progress" 
"swarm/[agent-name]/waiting"
"swarm/[agent-name]/complete"

// Shared artifacts
"swarm/shared/[component-name]"
```

### 3. Write First, Then Read
```javascript
// ✅ Agent 1 WRITES interface
memory_usage { action: "store", key: "swarm/shared/interface", value: {...} }

// ✅ Agent 2 READS and uses it
memory_usage { action: "retrieve", key: "swarm/shared/interface" }
```

### 4. Progress Updates
```javascript
// Write progress percentage for monitoring
value: JSON.stringify({
  progress: 65,  // percentage
  completed: ["task1", "task2"],
  current: "working on task3"
})
```

### 5. Dependency Checking
```javascript
// Check if dependency exists
const dep = memory_usage { action: "retrieve", key: "swarm/shared/component" }
if (!dep.found) {
  // Write that you're waiting
  memory_usage { 
    action: "store", 
    key: "swarm/agent-X/waiting",
    value: JSON.stringify({ waiting_for: "component" })
  }
}
```

## Monitoring Commands

```bash
# View all agent statuses
npx claude-flow@alpha memory search "swarm/*/status" --namespace coordination

# Check progress
npx claude-flow@alpha memory search "swarm/*/progress" --namespace coordination  

# Find blocking issues
npx claude-flow@alpha memory search "swarm/*/waiting" --namespace coordination

# List shared components
npx claude-flow@alpha memory search "swarm/shared/*" --namespace coordination
```

## Common Pitfalls to Avoid

1. **❌ Only reading, never writing** - Agents MUST write their own data
2. **❌ Wrong namespace** - Always use "coordination"
3. **❌ Inconsistent key structure** - Follow swarm/[agent]/[type] pattern
4. **❌ No progress updates** - Update at least every 2-3 major steps
5. **❌ Missing shared artifacts** - Share ALL interfaces/APIs others need

## Result

With proper memory writes, agents can:
- Track each other's progress
- Share interfaces and APIs
- Wait for dependencies intelligently
- Coordinate complex multi-step tasks
- Provide visibility into swarm operations