# V3 MCP Tools - ADR-005: MCP-First API Design

This directory contains the MCP-first tool implementations following **ADR-005: MCP-First API Design**. CLI commands should call these MCP tools rather than directly implementing functionality.

## Overview

The MCP-first architecture ensures that:
- **CLI commands are thin wrappers** around MCP tool calls
- **Tools are reusable** across different interfaces (CLI, web, API)
- **Business logic is centralized** in MCP tool handlers
- **Consistent interfaces** using JSON Schema validation
- **Performance optimized** with proper caching and timeout handling

## Tool Categories

### 1. Agent Tools (`agent-tools.ts`)

MCP tools for agent lifecycle operations:

| Tool | Description | Category |
|------|-------------|----------|
| `agent/spawn` | Spawn a new agent with specified type and configuration | agent |
| `agent/list` | List all agents with optional filtering and pagination | agent |
| `agent/terminate` | Terminate a running agent gracefully or forcefully | agent |
| `agent/status` | Get detailed status information for a specific agent | agent |

**Example Usage:**
```typescript
import { spawnAgentTool } from './mcp/tools/agent-tools.js';

// Spawn a new coder agent
const result = await spawnAgentTool.handler({
  agentType: 'coder',
  config: { maxConcurrentTasks: 5 },
  priority: 'high',
});

console.log(`Agent spawned: ${result.agentId}`);
```

### 2. Swarm Tools (`swarm-tools.ts`)

MCP tools for swarm coordination operations:

| Tool | Description | Category |
|------|-------------|----------|
| `swarm/init` | Initialize swarm coordination with specified topology | swarm |
| `swarm/status` | Get current swarm status including agents, metrics, topology | swarm |
| `swarm/scale` | Scale swarm up or down to target number of agents | swarm |

**Example Usage:**
```typescript
import { initSwarmTool } from './mcp/tools/swarm-tools.js';

// Initialize hierarchical-mesh swarm
const result = await initSwarmTool.handler({
  topology: 'hierarchical-mesh',
  maxAgents: 15,
  config: {
    communicationProtocol: 'message-bus',
    consensusMechanism: 'majority',
  },
});

console.log(`Swarm initialized: ${result.swarmId}`);
```

### 3. Memory Tools (`memory-tools.ts`)

MCP tools for memory operations (AgentDB integration):

| Tool | Description | Category |
|------|-------------|----------|
| `memory/store` | Store a memory entry with specified type and metadata | memory |
| `memory/search` | Search memories using semantic and keyword search | memory |
| `memory/list` | List memory entries with filtering, sorting, pagination | memory |

**Example Usage:**
```typescript
import { searchMemoryTool } from './mcp/tools/memory-tools.js';

// Search memories semantically
const result = await searchMemoryTool.handler({
  query: 'authentication implementation',
  searchType: 'hybrid',
  type: 'semantic',
  limit: 10,
  minRelevance: 0.8,
});

console.log(`Found ${result.total} relevant memories`);
```

### 4. Config Tools (`config-tools.ts`)

MCP tools for configuration management:

| Tool | Description | Category |
|------|-------------|----------|
| `config/load` | Load configuration from file with optional merging | config |
| `config/save` | Save configuration to file with optional backup | config |
| `config/validate` | Validate configuration with optional auto-fix | config |

**Example Usage:**
```typescript
import { validateConfigTool } from './mcp/tools/config-tools.js';

// Validate configuration
const result = await validateConfigTool.handler({
  config: myConfig,
  strict: true,
  fixIssues: true,
});

if (!result.valid) {
  console.error(`Validation issues: ${result.issues.length}`);
  if (result.fixed) {
    console.log('Using fixed configuration');
  }
}
```

## Central Exports (`index.ts`)

The `index.ts` file provides convenient functions for working with tools:

### `getAllTools()`

Get all MCP tools for registration:

```typescript
import { getAllTools } from './mcp/tools/index.js';

const tools = getAllTools();
server.registerTools(tools);
```

### `getToolsByCategory(category)`

Get tools by category:

```typescript
import { getToolsByCategory } from './mcp/tools/index.js';

const agentTools = getToolsByCategory('agent');
const memoryTools = getToolsByCategory('memory');
```

### `getToolByName(name)`

Get a specific tool:

```typescript
import { getToolByName } from './mcp/tools/index.js';

const spawnTool = getToolByName('agent/spawn');
if (spawnTool) {
  await spawnTool.handler({ agentType: 'coder' });
}
```

### `getToolsByTag(tag)`

Get tools by tag:

```typescript
import { getToolsByTag } from './mcp/tools/index.js';

const lifecycleTools = getToolsByTag('lifecycle');
const agentdbTools = getToolsByTag('agentdb');
```

### `getToolStats()`

Get tool statistics:

```typescript
import { getToolStats } from './mcp/tools/index.js';

const stats = getToolStats();
console.log(`Total tools: ${stats.total}`);
console.log(`Categories: ${stats.categories.join(', ')}`);
console.log(`Cacheable tools: ${stats.cacheable}`);
```

### `validateToolRegistration()`

Validate all tools:

```typescript
import { validateToolRegistration } from './mcp/tools/index.js';

const validation = validateToolRegistration();
if (!validation.valid) {
  console.error('Tool validation failed:', validation.issues);
}
```

## CLI Integration Pattern

CLI commands should follow this pattern:

```typescript
// ❌ BAD: Direct implementation in CLI
async function cliSpawnAgent(args: SpawnArgs) {
  // Direct business logic here
  const agent = new Agent(args.type);
  await agent.initialize();
  return agent;
}

// ✅ GOOD: Call MCP tool
async function cliSpawnAgent(args: SpawnArgs) {
  const { spawnAgentTool } = await import('./mcp/tools/agent-tools.js');

  const result = await spawnAgentTool.handler({
    agentType: args.type,
    config: args.config,
    priority: args.priority,
  });

  return result;
}
```

## Tool Implementation Guidelines

### 1. Input Validation

All tools use **Zod schemas** for input validation:

```typescript
const spawnAgentSchema = z.object({
  agentType: z.string().describe('Type of agent to spawn'),
  id: z.string().optional().describe('Optional agent ID'),
  config: z.record(z.unknown()).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
});
```

### 2. Handler Implementation

Handlers should:
- Accept validated input and optional context
- Return properly typed results
- Include TODO comments for future service integration
- Provide stub implementations for development

```typescript
async function handleSpawnAgent(
  input: z.infer<typeof spawnAgentSchema>,
  context?: ToolContext
): Promise<SpawnAgentResult> {
  // TODO: Integrate with actual agent manager when available
  // const agentManager = context?.agentManager as AgentManager;

  // Stub implementation
  const result: SpawnAgentResult = {
    agentId: generateId(),
    agentType: input.agentType,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  return result;
}
```

### 3. Tool Definition

Tool definitions include:
- Name (using `/` separator for namespacing)
- Description
- Input schema (JSON Schema format)
- Handler function
- Category, tags, version
- Caching configuration (optional)

```typescript
export const spawnAgentTool: MCPTool = {
  name: 'agent/spawn',
  description: 'Spawn a new agent with specified type and configuration',
  inputSchema: {
    type: 'object',
    properties: { /* ... */ },
    required: ['agentType'],
  },
  handler: async (input, context) => {
    const validated = spawnAgentSchema.parse(input);
    return handleSpawnAgent(validated, context);
  },
  category: 'agent',
  tags: ['agent', 'lifecycle', 'spawn'],
  version: '1.0.0',
};
```

## Performance Optimization

### Caching

Tools that query data should enable caching:

```typescript
export const listAgentsTool: MCPTool = {
  // ...
  cacheable: true,
  cacheTTL: 2000, // 2 seconds
};
```

### Timeouts

Tools with long-running operations should specify timeouts:

```typescript
export const scaleSwarmTool: MCPTool = {
  // ...
  timeout: 30000, // 30 seconds
};
```

## Testing

Tools should be tested with:

```typescript
import { describe, it, expect } from 'vitest';
import { spawnAgentTool } from './agent-tools.js';

describe('agent/spawn', () => {
  it('should spawn agent with valid input', async () => {
    const result = await spawnAgentTool.handler({
      agentType: 'coder',
    });

    expect(result.agentId).toBeDefined();
    expect(result.agentType).toBe('coder');
    expect(result.status).toBe('active');
  });

  it('should reject invalid input', async () => {
    await expect(
      spawnAgentTool.handler({ agentType: '' })
    ).rejects.toThrow();
  });
});
```

## Future Integration Points

Each tool includes TODO comments marking where actual service integration should occur:

```typescript
// TODO: Call actual agent manager
// const agentManager = context?.agentManager as AgentManager;
// if (agentManager) {
//   await agentManager.spawnAgent({ ... });
// }
```

When implementing actual services:

1. Remove stub implementation
2. Call the real service through context
3. Handle errors appropriately
4. Update tests to use real services
5. Update performance targets

## Architecture Compliance

This implementation follows:

- **ADR-005**: MCP-First API Design
- **ADR-006**: Unified Memory Service (memory tools integrate with AgentDB)
- **ADR-002**: Domain-Driven Design (tools organized by domain)
- **ADR-007**: Event Sourcing (tool calls can be tracked)

## Tool Statistics

Current implementation includes:

- **13 MCP tools** total
- **4 categories**: agent, swarm, memory, config
- **10 cacheable tools** for performance
- **0 deprecated tools**
- **All tools** with Zod validation
- **All tools** with stub implementations ready for integration

## Next Steps

1. Implement actual service integrations (AgentManager, SwarmCoordinator, MemoryService)
2. Add comprehensive unit tests for all tools
3. Add integration tests with real services
4. Implement CLI commands that call these tools
5. Add performance benchmarks
6. Add monitoring and metrics collection
7. Document all tool schemas in OpenAPI format

## Related Files

- `/workspaces/claude-flow/v3/mcp/types.ts` - MCP type definitions
- `/workspaces/claude-flow/v3/mcp/server.ts` - MCP server implementation
- `/workspaces/claude-flow/v3/mcp/tool-registry.ts` - Tool registration system
- `/workspaces/claude-flow/CLAUDE.md` - Project documentation
