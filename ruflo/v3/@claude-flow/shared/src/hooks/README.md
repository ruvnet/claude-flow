# V3 Hooks System

Extensible hook points for tool execution, file operations, and lifecycle events. Integrates with the event bus for coordination and monitoring.

## Features

- **26 Hook Events**: Comprehensive lifecycle hooks for tools, files, commands, sessions, agents, tasks, memory, and errors
- **Priority-Based Execution**: Control execution order with 5 priority levels
- **Timeout Handling**: Configurable timeouts per hook with graceful degradation
- **Error Recovery**: Continue execution on errors or abort based on configuration
- **Context Modification**: Hooks can modify context for downstream hooks
- **Parallel & Sequential Execution**: Execute hooks in parallel or chain them sequentially
- **Event Bus Integration**: Emit coordination events to the event bus
- **Statistics Tracking**: Monitor hook performance and execution metrics

## Installation

```typescript
import {
  createHookRegistry,
  createHookExecutor,
  HookEvent,
  HookPriority
} from '@claude-flow/shared/hooks';
```

## Quick Start

### 1. Create Registry and Executor

```typescript
import { createHookRegistry, createHookExecutor } from '@claude-flow/shared/hooks';
import { createEventBus } from '@claude-flow/shared/core';

const registry = createHookRegistry();
const eventBus = createEventBus();
const executor = createHookExecutor(registry, eventBus);
```

### 2. Register a Hook

```typescript
const hookId = registry.register(
  HookEvent.PreToolUse,
  async (context) => {
    console.log(`About to use tool: ${context.tool?.name}`);

    // Validate tool parameters
    if (!context.tool?.parameters) {
      return {
        success: false,
        error: new Error('Missing tool parameters'),
        abort: true // Abort tool execution
      };
    }

    return { success: true };
  },
  HookPriority.High,
  {
    name: 'Tool Validation Hook',
    timeout: 5000
  }
);
```

### 3. Execute Hooks

```typescript
const result = await executor.execute(
  HookEvent.PreToolUse,
  {
    event: HookEvent.PreToolUse,
    timestamp: new Date(),
    tool: {
      name: 'Read',
      parameters: { path: '/path/to/file.ts' },
      category: 'file'
    }
  }
);

if (result.success) {
  console.log(`✓ All hooks passed (${result.hooksExecuted} executed)`);
} else {
  console.log(`✗ Hook execution failed: ${result.hooksFailed} failures`);
}
```

## Hook Events

### Tool Execution

```typescript
HookEvent.PreToolUse   // Before any tool is used
HookEvent.PostToolUse  // After tool execution completes
```

### File Operations

```typescript
HookEvent.PreRead      // Before reading a file
HookEvent.PostRead     // After reading a file
HookEvent.PreWrite     // Before writing a file
HookEvent.PostWrite    // After writing a file
HookEvent.PreEdit      // Before editing a file
HookEvent.PostEdit     // After editing a file
```

### Command Execution

```typescript
HookEvent.PreCommand   // Before executing bash command
HookEvent.PostCommand  // After command execution
```

### Session Lifecycle

```typescript
HookEvent.SessionStart   // When session starts
HookEvent.SessionEnd     // When session ends
HookEvent.SessionPause   // When session is paused
HookEvent.SessionResume  // When session resumes
```

### Agent Lifecycle

```typescript
HookEvent.PreAgentSpawn       // Before spawning agent
HookEvent.PostAgentSpawn      // After agent spawned
HookEvent.PreAgentTerminate   // Before terminating agent
HookEvent.PostAgentTerminate  // After agent terminated
```

### Task Lifecycle

```typescript
HookEvent.PreTaskExecute    // Before task execution
HookEvent.PostTaskExecute   // After task execution
HookEvent.PreTaskComplete   // Before marking task complete
HookEvent.PostTaskComplete  // After task completed
```

### Memory Operations

```typescript
HookEvent.PreMemoryStore      // Before storing memory
HookEvent.PostMemoryStore     // After storing memory
HookEvent.PreMemoryRetrieve   // Before retrieving memory
HookEvent.PostMemoryRetrieve  // After retrieving memory
```

### Error Handling

```typescript
HookEvent.OnError     // When error occurs
HookEvent.OnWarning   // When warning occurs
```

## Hook Priorities

Control execution order with priority levels:

```typescript
HookPriority.Critical = 1000    // Execute first
HookPriority.High     = 500
HookPriority.Normal   = 0       // Default
HookPriority.Low      = -500
HookPriority.Lowest   = -1000   // Execute last
```

## Advanced Usage

### Context Modification

Hooks can modify context for downstream hooks:

```typescript
registry.register(
  HookEvent.PreCommand,
  async (context) => {
    // Add risk assessment to context
    const isDestructive = context.command?.command.includes('rm -rf');

    return {
      success: true,
      data: {
        metadata: {
          ...context.metadata,
          riskLevel: isDestructive ? 'high' : 'low'
        }
      }
    };
  },
  HookPriority.High
);

// Later hook can access the risk level
registry.register(
  HookEvent.PreCommand,
  async (context) => {
    if (context.metadata?.riskLevel === 'high') {
      console.warn('⚠️  High-risk command detected!');
    }
    return { success: true };
  },
  HookPriority.Normal
);
```

### Abort Operations

Hooks can abort the operation:

```typescript
registry.register(
  HookEvent.PreCommand,
  async (context) => {
    const isDangerous = context.command?.command.includes('format c:');

    if (isDangerous) {
      return {
        success: false,
        abort: true, // Prevent command execution
        error: new Error('Dangerous command blocked by security hook')
      };
    }

    return { success: true };
  },
  HookPriority.Critical
);
```

### Timeout Handling

Configure timeouts per hook:

```typescript
registry.register(
  HookEvent.PreToolUse,
  async (context) => {
    // Expensive operation
    await analyzeCodeComplexity(context.tool?.parameters);
    return { success: true };
  },
  HookPriority.Normal,
  {
    timeout: 3000 // 3 second timeout
  }
);
```

### Parallel Execution

Execute hooks for multiple events in parallel:

```typescript
const results = await executor.executeParallel(
  [HookEvent.PreRead, HookEvent.PreWrite, HookEvent.PreEdit],
  [
    { event: HookEvent.PreRead, timestamp: new Date(), file: { path: 'a.ts', operation: 'read' } },
    { event: HookEvent.PreWrite, timestamp: new Date(), file: { path: 'b.ts', operation: 'write' } },
    { event: HookEvent.PreEdit, timestamp: new Date(), file: { path: 'c.ts', operation: 'edit' } }
  ],
  { maxParallel: 3 }
);
```

### Sequential Execution with Context Chaining

Execute hooks sequentially, passing context modifications:

```typescript
const result = await executor.executeSequential(
  [
    HookEvent.PreTaskExecute,
    HookEvent.PostTaskExecute,
    HookEvent.PreTaskComplete,
    HookEvent.PostTaskComplete
  ],
  {
    event: HookEvent.PreTaskExecute,
    timestamp: new Date(),
    task: { id: 'task-1', description: 'Process data' }
  }
);

// result.finalContext contains all modifications from all hooks
```

## Hook Statistics

Track hook performance:

```typescript
const stats = registry.getStats();

console.log(`Total hooks: ${stats.totalHooks}`);
console.log(`Total executions: ${stats.totalExecutions}`);
console.log(`Total failures: ${stats.totalFailures}`);
console.log(`Average execution time: ${stats.avgExecutionTime}ms`);

// Hooks by event type
for (const [event, count] of Object.entries(stats.byEvent)) {
  console.log(`${event}: ${count} hooks`);
}
```

## Integration with Event Bus

The executor emits coordination events to the event bus:

```typescript
eventBus.on('hooks:pre-execute', (event) => {
  console.log(`Executing ${event.payload.hookCount} hooks for ${event.payload.event}`);
});

eventBus.on('hooks:post-execute', (event) => {
  console.log(`Completed in ${event.payload.totalExecutionTime}ms`);
});

eventBus.on('hooks:error', (event) => {
  console.error(`Hook ${event.payload.hookId} failed:`, event.payload.error);
});
```

## Best Practices

### 1. Use Appropriate Priorities

- `Critical`: Security checks, validation that must happen first
- `High`: Important preprocessing (risk assessment, logging)
- `Normal`: Standard business logic
- `Low`: Optional enhancements, metrics
- `Lowest`: Cleanup, final logging

### 2. Handle Errors Gracefully

```typescript
registry.register(
  HookEvent.PreToolUse,
  async (context) => {
    try {
      await performValidation(context);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        continueChain: true // Allow other hooks to run
      };
    }
  }
);
```

### 3. Keep Hooks Fast

Hooks should be fast (<100ms). For expensive operations:

```typescript
registry.register(
  HookEvent.PostToolUse,
  async (context) => {
    // Queue expensive work for background processing
    backgroundQueue.add({
      type: 'analyze-tool-usage',
      context
    });

    return { success: true };
  },
  HookPriority.Low
);
```

### 4. Use Descriptive Names

```typescript
registry.register(
  HookEvent.PreCommand,
  handler,
  HookPriority.Critical,
  {
    name: 'Security: Prevent Destructive Commands',
    metadata: {
      purpose: 'Block dangerous shell commands',
      blockedPatterns: ['rm -rf /', 'format c:']
    }
  }
);
```

## Example: Pre-Edit Hook for Learning

```typescript
import { HookEvent, HookPriority } from '@claude-flow/shared/hooks';

// Register pre-edit hook for context retrieval
registry.register(
  HookEvent.PreEdit,
  async (context) => {
    const filePath = context.file?.path;

    if (!filePath) {
      return { success: true };
    }

    // Get similar past edits from ReasoningBank
    const similarEdits = await reasoningBank.searchPatterns({
      task: `Edit file: ${filePath}`,
      k: 5,
      minReward: 0.85
    });

    console.log(`📚 Found ${similarEdits.length} similar past edits`);

    return {
      success: true,
      data: {
        metadata: {
          ...context.metadata,
          learningContext: similarEdits,
          editCount: similarEdits.length
        }
      }
    };
  },
  HookPriority.High,
  {
    name: 'Learning: Pre-Edit Context Retrieval',
    timeout: 2000
  }
);

// Register post-edit hook for learning storage
registry.register(
  HookEvent.PostEdit,
  async (context) => {
    const success = context.metadata?.success ?? true;
    const filePath = context.file?.path;

    if (!filePath) {
      return { success: true };
    }

    // Store edit pattern for future learning
    await reasoningBank.storePattern({
      sessionId: context.session?.id || 'unknown',
      task: `Edit file: ${filePath}`,
      input: context.file?.previousContent || '',
      output: context.file?.content || '',
      reward: success ? 0.9 : 0.3,
      success,
      tokensUsed: estimateTokens(context.file?.content),
      latencyMs: context.metadata?.executionTime || 0
    });

    return { success: true };
  },
  HookPriority.Normal,
  {
    name: 'Learning: Post-Edit Pattern Storage',
    timeout: 1000
  }
);
```

## API Reference

### HookRegistry

- `register(event, handler, priority, options)` - Register a hook
- `unregister(hookId)` - Unregister a hook
- `unregisterAll(event?)` - Unregister all hooks for an event
- `getHandlers(event, includeDisabled)` - Get handlers for an event
- `getHook(hookId)` - Get hook by ID
- `enable(hookId)` - Enable a hook
- `disable(hookId)` - Disable a hook
- `listHooks(filter)` - List all hooks with optional filter
- `getEventTypes()` - Get all event types with hooks
- `count(event?)` - Get hook count
- `getStats()` - Get execution statistics
- `resetStats()` - Reset statistics
- `has(hookId)` - Check if hook exists
- `clear()` - Clear all hooks

### HookExecutor

- `execute(event, context, options)` - Execute hooks for an event
- `executeWithTimeout(event, context, timeout)` - Execute with timeout
- `executeParallel(events, contexts, options)` - Execute multiple events in parallel
- `executeSequential(events, initialContext, options)` - Execute sequentially with context chaining
- `setEventBus(eventBus)` - Set event bus for coordination
- `getRegistry()` - Get hook registry

## Testing

Run the test suite:

```bash
cd /workspaces/claude-flow/v3/@claude-flow/shared
npm test -- hooks.test.ts
```

All 23 tests pass:
- 11 registry tests
- 12 executor tests

## File Structure

```
v3/@claude-flow/shared/src/hooks/
├── types.ts           # Type definitions (~150 lines)
├── registry.ts        # Hook registry (~200 lines)
├── executor.ts        # Hook executor (~250 lines)
├── index.ts           # Main exports
├── hooks.test.ts      # Test suite (~20 tests)
└── README.md          # This file
```

## Integration Points

- **Event Bus**: Emits coordination events (`hooks:pre-execute`, `hooks:post-execute`, `hooks:error`)
- **Event Store**: Can log hook executions for audit trail (ADR-007)
- **ReasoningBank**: Hooks can integrate with learning system for context retrieval and pattern storage
- **Security**: Critical hooks can enforce security policies (CVE-1, CVE-2, CVE-3)

## License

Part of Claude-Flow V3 - See main LICENSE file
