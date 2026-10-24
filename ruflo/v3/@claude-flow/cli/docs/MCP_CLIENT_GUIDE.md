# MCP Client Guide for CLI Commands

## Overview

The MCP Client (`mcp-client.ts`) provides a thin wrapper for CLI commands to call MCP tools, implementing **ADR-005: MCP-First API Design** where CLI acts as a thin wrapper around MCP tools.

## Architecture

```
┌─────────────────┐
│  CLI Command    │  ← User interaction & display only
└────────┬────────┘
         │ callMCPTool()
         ▼
┌─────────────────┐
│  MCP Client     │  ← Tool registry & routing
└────────┬────────┘
         │ tool.handler()
         ▼
┌─────────────────┐
│  MCP Tool       │  ← Business logic lives here
│  Handler        │
└─────────────────┘
```

## Quick Start

### 1. Import the MCP Client

```typescript
import { callMCPTool, MCPClientError } from '../mcp-client.js';
```

### 2. Call an MCP Tool

```typescript
try {
  const result = await callMCPTool('agent/spawn', {
    agentType: 'coder',
    priority: 'normal',
    config: { timeout: 300 }
  });

  // Handle success - display output
  output.printSuccess(`Agent ${result.agentId} spawned`);
  return { success: true, data: result };

} catch (error) {
  if (error instanceof MCPClientError) {
    output.printError(`Failed: ${error.message}`);
  }
  return { success: false, exitCode: 1 };
}
```

## Available MCP Tools

### Agent Tools

| Tool Name | Description | Input Parameters |
|-----------|-------------|------------------|
| `agent/spawn` | Spawn a new agent | `agentType`, `id?`, `config?`, `priority?`, `metadata?` |
| `agent/list` | List all agents | `status?`, `agentType?`, `limit?`, `offset?` |
| `agent/status` | Get agent status | `agentId`, `includeMetrics?`, `includeHistory?` |
| `agent/terminate` | Terminate an agent | `agentId`, `graceful?`, `reason?` |

### Swarm Tools

| Tool Name | Description | Input Parameters |
|-----------|-------------|------------------|
| `swarm/init` | Initialize swarm | `topology`, `maxAgents?`, `config?`, `metadata?` |
| `swarm/status` | Get swarm status | `includeAgents?`, `includeMetrics?`, `includeTopology?` |
| `swarm/scale` | Scale swarm | `targetAgents`, `scaleStrategy?`, `agentTypes?`, `reason?` |

### Memory Tools

| Tool Name | Description | Input Parameters |
|-----------|-------------|------------------|
| `memory/store` | Store memory | `content`, `type?`, `category?`, `tags?`, `importance?`, `ttl?` |
| `memory/search` | Search memories | `query`, `searchType?`, `type?`, `category?`, `tags?`, `limit?`, `minRelevance?` |
| `memory/list` | List memories | `type?`, `category?`, `tags?`, `sortBy?`, `sortOrder?`, `limit?`, `offset?` |

### Config Tools

| Tool Name | Description | Input Parameters |
|-----------|-------------|------------------|
| `config/load` | Load configuration | `path?`, `scope?`, `merge?`, `includeDefaults?` |
| `config/save` | Save configuration | `config`, `path?`, `scope?`, `merge?`, `createBackup?` |
| `config/validate` | Validate config | `config`, `strict?`, `fixIssues?` |

## MCP Client API

### Core Functions

#### `callMCPTool<T>(toolName, input, context?): Promise<T>`

Call an MCP tool by name and return typed result.

**Parameters:**
- `toolName`: MCP tool name (e.g., `'agent/spawn'`)
- `input`: Tool input parameters (validated by tool's schema)
- `context?`: Optional context object

**Returns:** Promise resolving to tool result

**Throws:** `MCPClientError` if tool not found or execution fails

**Example:**
```typescript
const result = await callMCPTool<{ agentId: string }>('agent/spawn', {
  agentType: 'coder',
  priority: 'normal'
});
console.log(`Spawned agent: ${result.agentId}`);
```

#### `getToolMetadata(toolName): ToolMetadata | undefined`

Get tool metadata without executing it.

**Example:**
```typescript
const metadata = getToolMetadata('agent/spawn');
if (metadata) {
  console.log(`Description: ${metadata.description}`);
  console.log(`Category: ${metadata.category}`);
  console.log(`Schema:`, metadata.inputSchema);
}
```

#### `listMCPTools(category?): ToolMetadata[]`

List all available MCP tools, optionally filtered by category.

**Example:**
```typescript
// List all tools
const allTools = listMCPTools();

// List only agent tools
const agentTools = listMCPTools('agent');
```

#### `hasTool(toolName): boolean`

Check if an MCP tool exists.

**Example:**
```typescript
if (hasTool('agent/spawn')) {
  console.log('Agent spawn tool is available');
}
```

#### `validateToolInput(toolName, input): { valid: boolean; errors?: string[] }`

Validate input against tool schema before calling.

**Example:**
```typescript
const validation = validateToolInput('agent/spawn', {
  agentType: 'coder'
  // missing required field
});

if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}
```

#### `getToolCategories(): string[]`

Get all unique tool categories.

**Example:**
```typescript
const categories = getToolCategories();
console.log('Available categories:', categories);
// Output: ['agent', 'swarm', 'memory', 'config']
```

### Error Handling

#### `MCPClientError`

Custom error class for MCP tool failures.

**Properties:**
- `message`: Error message
- `toolName`: Name of the tool that failed
- `cause?`: Original error if available

**Example:**
```typescript
try {
  await callMCPTool('agent/spawn', { ... });
} catch (error) {
  if (error instanceof MCPClientError) {
    console.error(`Tool '${error.toolName}' failed: ${error.message}`);
    if (error.cause) {
      console.error('Caused by:', error.cause);
    }
  }
}
```

## CLI Command Pattern

### Standard Pattern

All CLI commands should follow this pattern:

```typescript
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { select, confirm, input } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';

const myCommand: Command = {
  name: 'my-command',
  description: 'Command description',
  options: [ /* command options */ ],

  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // STEP 1: Gather input (interactive prompts if needed)
    let param = ctx.flags.param as string;
    if (!param && ctx.interactive) {
      param = await input({
        message: 'Enter parameter:',
        validate: (v) => v.length > 0 || 'Required'
      });
    }

    // STEP 2: Validate required inputs
    if (!param) {
      output.printError('Parameter is required');
      return { success: false, exitCode: 1 };
    }

    // STEP 3: Call MCP tool (business logic)
    try {
      const result = await callMCPTool<ResultType>('tool/name', {
        param,
        // ... other inputs
      });

      // STEP 4: Format and display output
      if (ctx.flags.format === 'json') {
        output.printJson(result);
      } else {
        output.printTable({
          columns: [ /* ... */ ],
          data: [ /* format result for display */ ]
        });
      }

      output.printSuccess('Operation successful');
      return { success: true, data: result };

    } catch (error) {
      // STEP 5: Handle errors
      if (error instanceof MCPClientError) {
        output.printError(`Failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
```

### Key Principles

1. **CLI is thin**: Only handles UI/UX, no business logic
2. **MCP tool has logic**: All business logic in MCP tool handlers
3. **Type safety**: Use TypeScript generics for tool results
4. **Error handling**: Always catch and handle MCPClientError
5. **Display formatting**: CLI adds visual enhancements only

### What Belongs in CLI vs MCP Tool

#### CLI Command Responsibilities (Display Layer)

✅ Interactive prompts (select, confirm, input)
✅ Flag/argument parsing
✅ Input validation (basic checks)
✅ Output formatting (tables, boxes, colors)
✅ Progress indicators
✅ Success/error messages
✅ JSON output formatting

#### MCP Tool Responsibilities (Business Logic)

✅ Data validation (schema validation)
✅ Business rules enforcement
✅ Resource management (agents, swarms, memory)
✅ State changes
✅ Database operations
✅ External API calls
✅ Calculations and transformations

## Examples

### Example 1: Simple Tool Call

```typescript
// Spawn an agent
const spawnCommand: Command = {
  name: 'spawn',
  action: async (ctx: CommandContext) => {
    const agentType = ctx.flags.type as string;

    try {
      const result = await callMCPTool('agent/spawn', {
        agentType,
        priority: 'normal'
      });

      output.printSuccess(`Spawned agent: ${result.agentId}`);
      return { success: true, data: result };

    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(error.message);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
```

### Example 2: Tool Call with Filtering

```typescript
// List agents with filters
const listCommand: Command = {
  name: 'list',
  action: async (ctx: CommandContext) => {
    try {
      const result = await callMCPTool<{
        agents: Agent[];
        total: number;
      }>('agent/list', {
        status: ctx.flags.status || 'all',
        agentType: ctx.flags.type,
        limit: 100
      });

      // Display results
      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 20 },
          { key: 'type', header: 'Type', width: 15 },
          { key: 'status', header: 'Status', width: 10 }
        ],
        data: result.agents
      });

      output.printInfo(`Total: ${result.total} agents`);
      return { success: true, data: result };

    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(error.message);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
```

### Example 3: Interactive Input with Tool Call

```typescript
// Store memory with interactive input
const storeCommand: Command = {
  name: 'store',
  action: async (ctx: CommandContext) => {
    // Get input interactively if not provided
    let content = ctx.flags.content as string;
    if (!content && ctx.interactive) {
      content = await input({
        message: 'Enter content to store:',
        validate: (v) => v.length > 0 || 'Content required'
      });
    }

    if (!content) {
      output.printError('Content is required');
      return { success: false, exitCode: 1 };
    }

    // Select memory type interactively
    let type = ctx.flags.type as string;
    if (!type && ctx.interactive) {
      type = await select({
        message: 'Select memory type:',
        options: [
          { value: 'episodic', label: 'Episodic' },
          { value: 'semantic', label: 'Semantic' },
          { value: 'procedural', label: 'Procedural' }
        ]
      });
    }

    try {
      const result = await callMCPTool('memory/store', {
        content,
        type: type || 'episodic',
        tags: ctx.flags.tags?.split(',') || [],
        importance: ctx.flags.importance
      });

      output.printSuccess(`Stored memory: ${result.id}`);
      return { success: true, data: result };

    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(error.message);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
```

## Testing

### Unit Testing MCP Client

```typescript
import { callMCPTool, MCPClientError, hasTool } from '../mcp-client.js';

describe('MCP Client', () => {
  it('should call agent/spawn tool', async () => {
    const result = await callMCPTool('agent/spawn', {
      agentType: 'coder'
    });

    expect(result).toHaveProperty('agentId');
    expect(result).toHaveProperty('agentType', 'coder');
  });

  it('should throw MCPClientError for unknown tool', async () => {
    await expect(
      callMCPTool('unknown/tool', {})
    ).rejects.toThrow(MCPClientError);
  });

  it('should check if tool exists', () => {
    expect(hasTool('agent/spawn')).toBe(true);
    expect(hasTool('unknown/tool')).toBe(false);
  });
});
```

### Integration Testing CLI Commands

```typescript
import { execute } from '../cli.js';

describe('Agent spawn command', () => {
  it('should spawn agent via MCP tool', async () => {
    const result = await execute(['agent', 'spawn', '--type', 'coder']);

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('agentId');
  });
});
```

## Best Practices

### 1. Type Safety

Always provide type parameters to `callMCPTool`:

```typescript
// ✅ Good: Type-safe
const result = await callMCPTool<{ agentId: string }>('agent/spawn', { ... });
console.log(result.agentId); // TypeScript knows this exists

// ❌ Bad: No type safety
const result = await callMCPTool('agent/spawn', { ... });
console.log(result.agentId); // No type checking
```

### 2. Error Handling

Always handle `MCPClientError`:

```typescript
// ✅ Good: Specific error handling
try {
  const result = await callMCPTool(...);
} catch (error) {
  if (error instanceof MCPClientError) {
    output.printError(`Tool failed: ${error.message}`);
  } else {
    output.printError(`Unexpected error: ${String(error)}`);
  }
  return { success: false, exitCode: 1 };
}

// ❌ Bad: Generic error handling
try {
  const result = await callMCPTool(...);
} catch (error) {
  console.error(error); // User sees raw error
}
```

### 3. Input Validation

Validate inputs before calling tools:

```typescript
// ✅ Good: Validate first
if (!agentId) {
  output.printError('Agent ID is required');
  return { success: false, exitCode: 1 };
}

const result = await callMCPTool('agent/status', { agentId });

// ❌ Bad: Let tool fail
const result = await callMCPTool('agent/status', { agentId }); // Might be undefined
```

### 4. Output Formatting

Keep display logic in CLI, not in tool results:

```typescript
// ✅ Good: CLI formats output
const result = await callMCPTool('agent/list', { ... });
const displayData = result.agents.map(agent => ({
  id: agent.id,
  type: agent.agentType,
  created: new Date(agent.createdAt).toLocaleString() // Format in CLI
}));
output.printTable({ data: displayData });

// ❌ Bad: Expect pre-formatted data from tool
const result = await callMCPTool('agent/list', { ... });
output.printTable({ data: result.formattedAgents }); // Tool shouldn't format
```

### 5. Progressive Enhancement

Use feature detection for optional capabilities:

```typescript
// Check if tool supports feature
const metadata = getToolMetadata('agent/status');
const supportsMetrics = metadata?.inputSchema.properties?.includeMetrics;

const result = await callMCPTool('agent/status', {
  agentId,
  includeMetrics: supportsMetrics ? true : undefined
});
```

## Troubleshooting

### Tool Not Found

**Problem:** `MCPClientError: MCP tool not found: xyz/abc`

**Solutions:**
1. Check tool name spelling
2. Verify tool is registered in `mcp-client.ts`
3. Import tool from correct tools file

### Type Errors

**Problem:** TypeScript errors when calling `callMCPTool`

**Solutions:**
1. Provide correct type parameter: `callMCPTool<ResultType>(...)`
2. Match input schema from tool definition
3. Check tool's TypeScript interfaces

### Validation Errors

**Problem:** Tool execution fails with validation error

**Solutions:**
1. Use `validateToolInput()` before calling
2. Check tool's input schema requirements
3. Provide all required parameters

## Contributing

When adding new CLI commands:

1. Import `callMCPTool` and `MCPClientError`
2. Follow the standard CLI command pattern
3. Keep business logic in MCP tools
4. Add error handling for `MCPClientError`
5. Format output in CLI, not in tool
6. Add TypeScript types for tool results
7. Update this guide with new examples

## Related Documentation

- [REFACTORING_SUMMARY.md](./REFACTORING_SUMMARY.md) - Overview of refactoring
- [ADR-005: MCP-First API Design](/workspaces/claude-flow/docs/adr/ADR-005-mcp-first-api.md) - Architecture decision
- [MCP Tool Implementations](/workspaces/claude-flow/v3/mcp/tools/) - Tool source code

## Summary

The MCP Client provides a clean, type-safe way for CLI commands to call MCP tools while maintaining proper separation of concerns:

- **CLI**: User interaction & display
- **MCP Client**: Tool routing & error handling
- **MCP Tools**: Business logic & data management

This architecture ensures maintainability, testability, and consistency across all interfaces to the claude-flow system.
