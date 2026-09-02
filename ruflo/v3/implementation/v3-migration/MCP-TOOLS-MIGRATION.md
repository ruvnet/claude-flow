# MCP Tools Migration Guide

> Migrating from V2 MCP Tools (65) to V3 MCP Tools (22)

## Overview

V3 has streamlined the MCP tools from 65 to 22, with a focus on core operations and the new hooks-based learning system. Many V2 tools need migration.

## Tool Count Summary

| Category | V2 Tools | V3 Tools | Gap |
|----------|----------|----------|-----|
| Agent | 11 | 4 | -7 |
| Task | 8 | 0 | -8 |
| Memory | 6 | 3 | -3 |
| System | 7 | 0 | -7 |
| Config | 3 | 3 | 0 |
| Swarm | 8 | 3 | -5 |
| Workflow | 3 | 0 | -3 |
| Terminal | 3 | 0 | -3 |
| Resource | 2 | 0 | -2 |
| Message | 2 | 0 | -2 |
| Monitor | 2 | 0 | -2 |
| Neural | 3 | 0 | -3 |
| Benchmark | 2 | 0 | -2 |
| Query | 2 | 0 | -2 |
| **Hooks** | 0 | 9 | +9 |
| **Total** | 65 | 22 | -43 |

## Implemented Tools ✅

### Agent Tools (4)
```typescript
// v3/mcp/tools/agent-tools.ts
'agent/spawn'     // Spawn agent with type, config, priority
'agent/list'      // List agents with filtering
'agent/terminate' // Terminate agent
'agent/status'    // Get agent status
```

### Swarm Tools (3)
```typescript
// v3/mcp/tools/swarm-tools.ts
'swarm/init'      // Initialize swarm with topology
'swarm/status'    // Get swarm status
'swarm/scale'     // Scale swarm up/down (NEW)
```

### Memory Tools (3)
```typescript
// v3/mcp/tools/memory-tools.ts
'memory/store'    // Store memory entry
'memory/search'   // Semantic/keyword search
'memory/list'     // List with filtering
```

### Config Tools (3)
```typescript
// v3/mcp/tools/config-tools.ts
'config/load'     // Load configuration
'config/save'     // Save configuration
'config/validate' // Validate configuration
```

### Hooks Tools (9) - NEW
```typescript
// v3/mcp/tools/hooks-tools.ts
'hooks/pre-edit'     // Pre-edit context
'hooks/post-edit'    // Post-edit learning
'hooks/pre-command'  // Pre-command risk
'hooks/post-command' // Post-command learning
'hooks/route'        // Task routing
'hooks/explain'      // Routing explanation
'hooks/pretrain'     // Repository bootstrap
'hooks/metrics'      // Learning metrics
'hooks/list'         // List hooks
```

## Missing Tools ❌

### Task Management (8 missing) - HIGH PRIORITY

```typescript
// Need to add to v3/mcp/tools/task-tools.ts
export const taskTools = [
  {
    name: 'tasks/create',
    description: 'Create a new task for execution',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Task type' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'number', default: 5 },
        dependencies: { type: 'array', items: { type: 'string' } },
        assignToAgent: { type: 'string' },
        assignToAgentType: { type: 'string' },
        input: { type: 'object' },
        timeout: { type: 'number' }
      },
      required: ['type', 'description']
    }
  },
  {
    name: 'tasks/list',
    description: 'List tasks with optional filtering',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'queued', 'assigned', 'running', 'completed', 'failed', 'cancelled'] },
        agentId: { type: 'string' },
        type: { type: 'string' },
        limit: { type: 'number', default: 50 },
        offset: { type: 'number', default: 0 }
      }
    }
  },
  {
    name: 'tasks/status',
    description: 'Get detailed status of a specific task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'tasks/cancel',
    description: 'Cancel a pending or running task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'tasks/assign',
    description: 'Assign a task to a specific agent',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        agentId: { type: 'string' }
      },
      required: ['taskId', 'agentId']
    }
  },
  {
    name: 'task_orchestrate',
    description: 'Orchestrate task across the swarm',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        strategy: { type: 'string', enum: ['parallel', 'sequential', 'adaptive'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        maxAgents: { type: 'number', min: 1, max: 10 }
      },
      required: ['task']
    }
  },
  {
    name: 'task_status',
    description: 'Check progress of running tasks',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        detailed: { type: 'boolean', default: false }
      }
    }
  },
  {
    name: 'task_results',
    description: 'Retrieve results from completed tasks',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        format: { type: 'string', enum: ['summary', 'detailed', 'raw'] }
      },
      required: ['taskId']
    }
  }
];
```

### System Tools (7 missing) - MEDIUM PRIORITY

```typescript
// Need to add to v3/mcp/tools/system-tools.ts
export const systemTools = [
  {
    name: 'system/status',
    description: 'Get comprehensive system status',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'system/metrics',
    description: 'Get system performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        timeRange: { type: 'string', enum: ['1h', '6h', '24h', '7d'], default: '1h' }
      }
    }
  },
  {
    name: 'system/health',
    description: 'Perform comprehensive health check',
    inputSchema: {
      type: 'object',
      properties: {
        deep: { type: 'boolean', default: false }
      }
    }
  },
  {
    name: 'system/info',
    description: 'Get system information',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'tools/list',
    description: 'List all available tools',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'tools/schema',
    description: 'Get schema for a specific tool',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' }
      },
      required: ['name']
    }
  }
];
```

### Swarm Tools (5 missing)

```typescript
// Need to add to v3/mcp/tools/swarm-tools.ts
const missingSwarmTools = [
  {
    name: 'swarm/create-objective',
    description: 'Create a new swarm objective',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        tasks: { type: 'array' },
        strategy: { type: 'string', enum: ['parallel', 'sequential', 'adaptive'] },
        timeout: { type: 'number' }
      },
      required: ['title', 'description', 'tasks']
    }
  },
  {
    name: 'swarm/execute-objective',
    description: 'Execute a swarm objective',
    inputSchema: {
      type: 'object',
      properties: {
        objectiveId: { type: 'string' }
      },
      required: ['objectiveId']
    }
  },
  {
    name: 'swarm/emergency-stop',
    description: 'Emergency stop all swarm operations',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        force: { type: 'boolean', default: false }
      },
      required: ['reason']
    }
  },
  {
    name: 'swarm/monitor',
    description: 'Monitor swarm activity in real-time',
    inputSchema: {
      type: 'object',
      properties: {
        duration: { type: 'number', default: 10 },
        interval: { type: 'number', default: 1 }
      }
    }
  },
  {
    name: 'agents/spawn_parallel',
    description: 'Spawn multiple agents in parallel (10-20x faster)',
    inputSchema: {
      type: 'object',
      properties: {
        agents: { type: 'array' },
        maxConcurrency: { type: 'number', default: 5 },
        batchSize: { type: 'number', default: 3 }
      },
      required: ['agents']
    }
  }
];
```

### Memory Tools (3 missing)

```typescript
// Need to add to v3/mcp/tools/memory-tools.ts
const missingMemoryTools = [
  {
    name: 'memory/delete',
    description: 'Delete a memory entry',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: { type: 'string' }
      },
      required: ['entryId']
    }
  },
  {
    name: 'memory/export',
    description: 'Export memory entries to file',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'csv', 'markdown'], default: 'json' },
        agentId: { type: 'string' },
        sessionId: { type: 'string' },
        startTime: { type: 'string', format: 'date-time' },
        endTime: { type: 'string', format: 'date-time' }
      }
    }
  },
  {
    name: 'memory/import',
    description: 'Import memory entries from file',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
        mergeStrategy: { type: 'string', enum: ['skip', 'overwrite', 'version'], default: 'skip' }
      },
      required: ['filePath']
    }
  }
];
```

### Workflow Tools (3 missing)

```typescript
// Need to create v3/mcp/tools/workflow-tools.ts
export const workflowTools = [
  {
    name: 'workflow/execute',
    description: 'Execute a workflow from file or definition',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        workflow: { type: 'object' },
        parameters: { type: 'object' }
      }
    }
  },
  {
    name: 'workflow/create',
    description: 'Create a new workflow definition',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        tasks: { type: 'array' },
        savePath: { type: 'string' }
      },
      required: ['name', 'tasks']
    }
  },
  {
    name: 'workflow/list',
    description: 'List available workflows',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string' }
      }
    }
  }
];
```

### Terminal Tools (3 missing)

```typescript
// Need to create v3/mcp/tools/terminal-tools.ts
export const terminalTools = [
  {
    name: 'terminal/execute',
    description: 'Execute command in terminal session',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        args: { type: 'array' },
        cwd: { type: 'string' },
        env: { type: 'object' },
        timeout: { type: 'number', default: 30000 },
        terminalId: { type: 'string' }
      },
      required: ['command']
    }
  },
  {
    name: 'terminal/list',
    description: 'List all terminal sessions',
    inputSchema: {
      type: 'object',
      properties: {
        includeIdle: { type: 'boolean', default: true }
      }
    }
  },
  {
    name: 'terminal/create',
    description: 'Create new terminal session',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        env: { type: 'object' },
        shell: { type: 'string' }
      }
    }
  }
];
```

### Query Control (2 missing)

```typescript
// Need to create v3/mcp/tools/query-tools.ts
export const queryTools = [
  {
    name: 'query/control',
    description: 'Control running queries',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['pause', 'resume', 'terminate', 'change_model'] },
        queryId: { type: 'string' },
        model: { type: 'string' }
      },
      required: ['action', 'queryId']
    }
  },
  {
    name: 'query/list',
    description: 'List active queries',
    inputSchema: {
      type: 'object',
      properties: {
        includeHistory: { type: 'boolean', default: false }
      }
    }
  }
];
```

### Resource & Message (4 missing)

```typescript
// Need to create v3/mcp/tools/resource-tools.ts
export const resourceTools = [
  {
    name: 'resource/register',
    description: 'Register a new resource',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['compute', 'storage', 'network', 'memory', 'gpu', 'custom'] },
        name: { type: 'string' },
        capacity: { type: 'object' },
        metadata: { type: 'object' }
      },
      required: ['type', 'name', 'capacity']
    }
  },
  {
    name: 'resource/get-statistics',
    description: 'Get resource statistics',
    inputSchema: { type: 'object', properties: {} }
  }
];

// Need to create v3/mcp/tools/message-tools.ts
export const messageTools = [
  {
    name: 'message/send',
    description: 'Send message through bus',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        content: { type: 'object' },
        sender: { type: 'string' },
        receivers: { type: 'array' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
        channel: { type: 'string' }
      },
      required: ['type', 'content', 'sender', 'receivers']
    }
  },
  {
    name: 'message/get-metrics',
    description: 'Get message bus metrics',
    inputSchema: { type: 'object', properties: {} }
  }
];
```

### Monitor Tools (2 missing)

```typescript
// Need to add to v3/mcp/tools/monitor-tools.ts
export const monitorTools = [
  {
    name: 'monitor/get-metrics',
    description: 'Get system monitoring metrics',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['system', 'swarm', 'agents', 'all'], default: 'all' }
      }
    }
  },
  {
    name: 'monitor/get-alerts',
    description: 'Get active alerts',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['info', 'warning', 'critical', 'all'], default: 'all' },
        limit: { type: 'number', default: 50 }
      }
    }
  }
];
```

### Neural Tools (3 missing)

```typescript
// Need to add to v3/mcp/tools/neural-tools.ts
export const neuralTools = [
  {
    name: 'neural/status',
    description: 'Get neural agent status',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' }
      }
    }
  },
  {
    name: 'neural/train',
    description: 'Train neural agents',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        iterations: { type: 'number', min: 1, max: 100, default: 10 }
      }
    }
  },
  {
    name: 'neural/patterns',
    description: 'Get cognitive patterns',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', enum: ['all', 'convergent', 'divergent', 'lateral', 'systems', 'critical', 'abstract'], default: 'all' }
      }
    }
  }
];
```

## Implementation Plan

### Phase 1: Core Tools (Week 1-2)
1. Task management tools (8 tools)
2. System status tools (4 tools)
3. Emergency stop tool

### Phase 2: Operational Tools (Week 3-4)
1. Workflow tools (3 tools)
2. Terminal tools (3 tools)
3. Memory import/export (2 tools)

### Phase 3: Advanced Tools (Week 5-6)
1. Query control (2 tools)
2. Resource management (2 tools)
3. Message bus (2 tools)
4. Monitor/alerts (2 tools)
5. Neural tools (3 tools)

### Phase 4: Optimization (Week 7-8)
1. Parallel agent spawn
2. Swarm monitoring
3. Benchmark tools
