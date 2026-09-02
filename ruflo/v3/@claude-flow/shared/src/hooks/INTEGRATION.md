# V3 Hooks System - Integration Guide

This guide shows how to integrate the hooks system with V3's event bus, event store, and other core components.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Tool Manager │───▶│ Hook Executor│───▶│  Event Bus   │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                    │                    │          │
│         │                    │                    ▼          │
│         │                    │            ┌──────────────┐  │
│         │                    │            │ Event Store  │  │
│         │                    │            │  (ADR-007)   │  │
│         │                    │            └──────────────┘  │
│         │                    │                               │
│         │                    ▼                               │
│         │            ┌──────────────┐                        │
│         └───────────▶│Hook Registry │                        │
│                      └──────────────┘                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Integration with Event Bus

### Step 1: Initialize Core Components

```typescript
import { createEventBus } from '@claude-flow/shared/core';
import { createHookRegistry, createHookExecutor } from '@claude-flow/shared/hooks';
import { EventStore } from '@claude-flow/shared/events';

// Create core components
const eventBus = createEventBus();
const hookRegistry = createHookRegistry();
const hookExecutor = createHookExecutor(hookRegistry, eventBus);

// Optional: Event store for audit trail (ADR-007)
const eventStore = new EventStore({
  databasePath: './data/events.db',
  verbose: true,
});

await eventStore.initialize();
```

### Step 2: Subscribe to Hook Coordination Events

```typescript
// Listen for hook execution start
eventBus.on('hooks:pre-execute', async (event) => {
  console.log(`🎯 Executing ${event.payload.hookCount} hooks for ${event.payload.event}`);

  // Store event in event store (ADR-007)
  await eventStore.append({
    id: `evt-${Date.now()}`,
    type: 'hooks:pre-execute',
    aggregateId: 'hook-system',
    aggregateType: 'system',
    version: 1,
    timestamp: Date.now(),
    source: 'hook-executor',
    payload: event.payload,
  });
});

// Listen for hook execution completion
eventBus.on('hooks:post-execute', async (event) => {
  const { success, totalExecutionTime, hooksExecuted, hooksFailed } = event.payload;

  console.log(`✅ Hooks completed: ${hooksExecuted} executed, ${hooksFailed} failed (${totalExecutionTime}ms)`);

  // Store completion event
  await eventStore.append({
    id: `evt-${Date.now()}`,
    type: 'hooks:post-execute',
    aggregateId: 'hook-system',
    aggregateType: 'system',
    version: 1,
    timestamp: Date.now(),
    source: 'hook-executor',
    payload: event.payload,
  });
});

// Listen for hook errors
eventBus.on('hooks:error', async (event) => {
  console.error(`❌ Hook error:`, event.payload.error);

  // Store error event
  await eventStore.append({
    id: `evt-${Date.now()}`,
    type: 'hooks:error',
    aggregateId: 'hook-system',
    aggregateType: 'system',
    version: 1,
    timestamp: Date.now(),
    source: 'hook-executor',
    payload: {
      hookId: event.payload.hookId,
      error: event.payload.error.message,
      stack: event.payload.error.stack,
    },
  });
});
```

## Integration with Tool Execution

### Example: File Read with Hooks

```typescript
import { HookEvent, HookContext } from '@claude-flow/shared/hooks';
import { readFile } from 'fs/promises';

async function readFileWithHooks(filePath: string): Promise<string> {
  // Create pre-read context
  const preContext: HookContext = {
    event: HookEvent.PreRead,
    timestamp: new Date(),
    file: {
      path: filePath,
      operation: 'read',
    },
  };

  // Execute pre-read hooks
  const preResult = await hookExecutor.execute(HookEvent.PreRead, preContext);

  if (preResult.aborted) {
    throw new Error('File read aborted by hooks');
  }

  // Perform actual read
  const startTime = Date.now();
  let content: string;
  let success = true;
  let error: Error | undefined;

  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    success = false;
    error = err instanceof Error ? err : new Error(String(err));
    throw error;
  } finally {
    // Execute post-read hooks
    const postContext: HookContext = {
      event: HookEvent.PostRead,
      timestamp: new Date(),
      file: {
        path: filePath,
        operation: 'read',
        size: content?.length || 0,
      },
      metadata: {
        ...preResult.finalContext?.metadata,
        success,
        executionTime: Date.now() - startTime,
      },
      error: error ? {
        error,
        context: 'file-read',
        severity: 'error',
        recoverable: false,
      } : undefined,
    };

    await hookExecutor.execute(HookEvent.PostRead, postContext);
  }

  return content;
}
```

### Example: Command Execution with Hooks

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import { HookEvent, HookContext } from '@claude-flow/shared/hooks';

const execAsync = promisify(exec);

async function executeCommandWithHooks(
  command: string,
  options: { cwd?: string; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  // Pre-command hooks
  const preContext: HookContext = {
    event: HookEvent.PreCommand,
    timestamp: new Date(),
    command: {
      command,
      cwd: options.cwd,
      timeout: options.timeout,
      isDestructive: /rm|del|format|dd/.test(command),
    },
  };

  const preResult = await hookExecutor.execute(HookEvent.PreCommand, preContext);

  if (preResult.aborted) {
    throw new Error(`Command execution blocked by security hooks: ${command}`);
  }

  // Execute command
  const startTime = Date.now();
  let result: { stdout: string; stderr: string };
  let success = true;
  let error: Error | undefined;

  try {
    result = await execAsync(command, options);
  } catch (err) {
    success = false;
    error = err instanceof Error ? err : new Error(String(err));
    throw error;
  } finally {
    // Post-command hooks
    const postContext: HookContext = {
      event: HookEvent.PostCommand,
      timestamp: new Date(),
      command: {
        command,
        cwd: options.cwd,
        timeout: options.timeout,
      },
      metadata: {
        ...preResult.finalContext?.metadata,
        success,
        executionTime: Date.now() - startTime,
      },
      error: error ? {
        error,
        context: 'command-execution',
        severity: 'error',
        recoverable: false,
      } : undefined,
    };

    await hookExecutor.execute(HookEvent.PostCommand, postContext);
  }

  return result;
}
```

## Integration with Agent Lifecycle

```typescript
import { HookEvent, HookContext } from '@claude-flow/shared/hooks';

class AgentManager {
  async spawnAgent(type: string, config: Record<string, unknown>) {
    const agentId = `agent-${Date.now()}`;

    // Pre-spawn hooks
    const preContext: HookContext = {
      event: HookEvent.PreAgentSpawn,
      timestamp: new Date(),
      agent: {
        id: agentId,
        type,
        config,
      },
    };

    const preResult = await hookExecutor.execute(HookEvent.PreAgentSpawn, preContext);

    if (preResult.aborted) {
      throw new Error(`Agent spawn aborted: ${type}`);
    }

    // Spawn agent
    const agent = await this.createAgent(agentId, type, config);

    // Post-spawn hooks
    const postContext: HookContext = {
      event: HookEvent.PostAgentSpawn,
      timestamp: new Date(),
      agent: {
        id: agentId,
        type,
        config,
      },
      metadata: {
        ...preResult.finalContext?.metadata,
        success: true,
      },
    };

    await hookExecutor.execute(HookEvent.PostAgentSpawn, postContext);

    return agent;
  }

  async terminateAgent(agentId: string) {
    // Pre-terminate hooks
    const preContext: HookContext = {
      event: HookEvent.PreAgentTerminate,
      timestamp: new Date(),
      agent: { id: agentId, type: 'unknown' },
    };

    await hookExecutor.execute(HookEvent.PreAgentTerminate, preContext);

    // Terminate agent
    await this.destroyAgent(agentId);

    // Post-terminate hooks
    const postContext: HookContext = {
      event: HookEvent.PostAgentTerminate,
      timestamp: new Date(),
      agent: { id: agentId, type: 'unknown' },
      metadata: { success: true },
    };

    await hookExecutor.execute(HookEvent.PostAgentTerminate, postContext);
  }

  private async createAgent(id: string, type: string, config: Record<string, unknown>) {
    // Implementation
    return { id, type, config };
  }

  private async destroyAgent(id: string) {
    // Implementation
  }
}
```

## Integration with Session Management

```typescript
import { HookEvent, HookContext } from '@claude-flow/shared/hooks';

class SessionManager {
  async startSession(userId?: string) {
    const sessionId = `session-${Date.now()}`;

    const context: HookContext = {
      event: HookEvent.SessionStart,
      timestamp: new Date(),
      session: {
        id: sessionId,
        startTime: new Date(),
        userId,
      },
    };

    const result = await hookExecutor.execute(HookEvent.SessionStart, context);

    // Emit system event
    eventBus.emit('session:created', {
      sessionId,
      userId,
      timestamp: Date.now(),
    });

    return { sessionId, context: result.finalContext };
  }

  async endSession(sessionId: string) {
    const context: HookContext = {
      event: HookEvent.SessionEnd,
      timestamp: new Date(),
      session: {
        id: sessionId,
        startTime: new Date(), // Would be loaded from state
        endTime: new Date(),
      },
    };

    await hookExecutor.execute(HookEvent.SessionEnd, context);

    // Emit system event
    eventBus.emit('session:terminated', {
      sessionId,
      timestamp: Date.now(),
    });
  }
}
```

## Plugin System Integration

Hooks can be registered via plugins (ADR-004):

```typescript
// v3/plugins/security-hooks/index.ts
import { Plugin } from '@claude-flow/shared';
import { HookEvent, HookPriority } from '@claude-flow/shared/hooks';

export default {
  name: 'security-hooks',
  version: '1.0.0',

  async initialize({ hookRegistry }) {
    // Register security hooks
    hookRegistry.register(
      HookEvent.PreCommand,
      async (context) => {
        // Security validation
        return { success: true };
      },
      HookPriority.Critical,
      { name: 'Security: Command Validation' }
    );

    hookRegistry.register(
      HookEvent.PreWrite,
      async (context) => {
        // File write validation
        return { success: true };
      },
      HookPriority.Critical,
      { name: 'Security: File Write Validation' }
    );
  },

  async shutdown({ hookRegistry }) {
    // Cleanup hooks
    hookRegistry.unregisterAll();
  },
} as Plugin;
```

## MCP Integration

Expose hooks via MCP tools:

```typescript
// v3/@claude-flow/shared/src/mcp/tools/hooks.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const registerHookTool: Tool = {
  name: 'hooks_register',
  description: 'Register a new hook for event interception',
  inputSchema: {
    type: 'object',
    properties: {
      event: {
        type: 'string',
        enum: Object.values(HookEvent),
        description: 'Hook event type',
      },
      priority: {
        type: 'string',
        enum: ['critical', 'high', 'normal', 'low', 'lowest'],
        description: 'Hook priority',
      },
      name: {
        type: 'string',
        description: 'Hook name',
      },
    },
    required: ['event'],
  },
};

export const listHooksTool: Tool = {
  name: 'hooks_list',
  description: 'List all registered hooks',
  inputSchema: {
    type: 'object',
    properties: {
      event: {
        type: 'string',
        enum: Object.values(HookEvent),
        description: 'Filter by event type (optional)',
      },
    },
  },
};

export const getHookStatsTool: Tool = {
  name: 'hooks_stats',
  description: 'Get hook execution statistics',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};
```

## Event Sourcing Integration (ADR-007)

Store all hook executions for audit trail:

```typescript
import { EventStore } from '@claude-flow/shared/events';

// Create event store
const eventStore = new EventStore({
  databasePath: './data/hook-events.db',
});

await eventStore.initialize();

// Subscribe to all hook events
eventBus.on('hooks:pre-execute', async (event) => {
  await eventStore.append({
    id: `evt-${Date.now()}`,
    type: 'hooks:pre-execute',
    aggregateId: 'hook-system',
    aggregateType: 'system',
    version: 1,
    timestamp: Date.now(),
    source: 'hook-executor',
    payload: event.payload,
  });
});

// Query hook history
const hookEvents = await eventStore.getEventsByType('hooks:pre-execute');
console.log(`Total hook executions: ${hookEvents.length}`);

// Replay hook events
for await (const event of eventStore.replay()) {
  if (event.type.startsWith('hooks:')) {
    console.log(`Replaying hook event: ${event.type} at ${event.timestamp}`);
  }
}
```

## Complete Example: Tool Manager with Hooks

```typescript
import {
  createEventBus,
  createHookRegistry,
  createHookExecutor,
  HookEvent,
  HookPriority,
  HookContext,
} from '@claude-flow/shared';

class V3ToolManager {
  private eventBus = createEventBus();
  private hookRegistry = createHookRegistry();
  private hookExecutor = createHookExecutor(this.hookRegistry, this.eventBus);

  constructor() {
    this.setupHooks();
  }

  private setupHooks() {
    // Security hooks
    this.hookRegistry.register(
      HookEvent.PreToolUse,
      async (context) => {
        console.log(`Security check: ${context.tool?.name}`);
        return { success: true };
      },
      HookPriority.Critical
    );

    // Performance tracking
    this.hookRegistry.register(
      HookEvent.PreToolUse,
      async (context) => {
        return {
          success: true,
          data: {
            metadata: {
              ...context.metadata,
              startTime: Date.now(),
            },
          },
        };
      },
      HookPriority.High
    );

    this.hookRegistry.register(
      HookEvent.PostToolUse,
      async (context) => {
        const startTime = context.metadata?.startTime as number;
        if (startTime) {
          const duration = Date.now() - startTime;
          console.log(`Tool ${context.tool?.name} took ${duration}ms`);
        }
        return { success: true };
      },
      HookPriority.Normal
    );
  }

  async executeTool(name: string, parameters: Record<string, unknown>) {
    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
      tool: { name, parameters },
    };

    // Execute pre-hooks
    const preResult = await this.hookExecutor.execute(HookEvent.PreToolUse, context);

    if (preResult.aborted) {
      throw new Error(`Tool execution blocked: ${name}`);
    }

    // Execute tool (simulated)
    const toolResult = await this.performToolExecution(name, parameters);

    // Execute post-hooks
    await this.hookExecutor.execute(HookEvent.PostToolUse, {
      ...context,
      event: HookEvent.PostToolUse,
      metadata: {
        ...preResult.finalContext?.metadata,
        success: true,
      },
    });

    return toolResult;
  }

  private async performToolExecution(name: string, parameters: Record<string, unknown>) {
    // Tool execution implementation
    return { result: 'success' };
  }

  getStats() {
    return this.hookRegistry.getStats();
  }
}

// Usage
const toolManager = new V3ToolManager();
await toolManager.executeTool('Read', { path: 'file.ts' });
const stats = toolManager.getStats();
console.log('Hook statistics:', stats);
```

## Best Practices

1. **Always use event bus**: Connect hookExecutor to eventBus for coordination
2. **Store critical events**: Use EventStore for audit trail (ADR-007)
3. **Handle errors gracefully**: Set `continueOnError` based on severity
4. **Use appropriate priorities**: Security hooks = Critical, monitoring = Low
5. **Clean up resources**: Unregister hooks in plugin shutdown
6. **Monitor performance**: Use hook statistics to identify bottlenecks
7. **Test hooks thoroughly**: Use the provided test suite as a template

## Next Steps

- See `hooks.test.ts` for comprehensive examples
- See `example-usage.ts` for practical use cases
- See `README.md` for API documentation
- Implement hooks in your domain modules (security, memory, swarm)
