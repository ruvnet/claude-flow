# @claude-flow/plugins

**Unified Plugin SDK for Claude Flow V3**

A comprehensive plugin development framework providing workers, hooks, providers, and security utilities for building Claude Flow extensions.

## Installation

```bash
npm install @claude-flow/plugins
```

## Quick Start

### Create a Plugin with the Builder

```typescript
import { PluginBuilder, HookEvent, HookPriority } from '@claude-flow/plugins';

const myPlugin = new PluginBuilder('my-awesome-plugin', '1.0.0')
  .withDescription('My awesome plugin for Claude Flow')
  .withAuthor('Your Name')
  .withMCPTools([
    {
      name: 'greet',
      description: 'Greet a user',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to greet' }
        },
        required: ['name']
      },
      handler: async (input) => ({
        content: [{ type: 'text', text: `Hello, ${input.name}!` }]
      })
    }
  ])
  .withHooks([
    {
      event: HookEvent.PostTaskComplete,
      priority: HookPriority.Normal,
      handler: async (ctx) => {
        console.log('Task completed:', ctx.data);
        return { success: true };
      }
    }
  ])
  .build();

// Register with the default registry
import { getDefaultRegistry } from '@claude-flow/plugins';
await getDefaultRegistry().register(myPlugin);
```

### Quick Plugin Creators

```typescript
import { createToolPlugin, createHooksPlugin, createWorkerPlugin } from '@claude-flow/plugins';

// Tool-only plugin
const toolPlugin = createToolPlugin('my-tools', '1.0.0', [
  { name: 'tool1', description: '...', inputSchema: {...}, handler: async () => {...} }
]);

// Hooks-only plugin
const hooksPlugin = createHooksPlugin('my-hooks', '1.0.0', [
  { event: HookEvent.PreTaskExecute, handler: async (ctx) => ({ success: true }) }
]);

// Worker plugin
const workerPlugin = createWorkerPlugin('my-workers', '1.0.0', [
  { type: 'coder', name: 'main-coder', capabilities: ['code-generation'] }
]);
```

## Features

### 🔧 MCP Tool Builder

```typescript
import { MCPToolBuilder } from '@claude-flow/plugins';

const tool = new MCPToolBuilder('calculate')
  .withDescription('Perform calculations')
  .addStringParam('expression', 'Math expression', { required: true })
  .addBooleanParam('verbose', 'Show steps', { default: false })
  .withHandler(async (input) => {
    const result = eval(input.expression); // Use a safe evaluator in production!
    return { content: [{ type: 'text', text: `Result: ${result}` }] };
  })
  .build();
```

### 🎣 Hook System

```typescript
import { HookBuilder, HookFactory, HookRegistry, HookEvent, HookPriority } from '@claude-flow/plugins';

// Create a custom hook with conditions
const hook = new HookBuilder(HookEvent.PreAgentSpawn)
  .withName('validate-agent')
  .withPriority(HookPriority.High)
  .when((ctx) => ctx.data?.type === 'coder')
  .transform((data) => ({ ...data, validated: true }))
  .handle(async (ctx) => {
    // Validation logic
    return { success: true, data: ctx.data, modified: true };
  })
  .build();

// Pre-built hook factories
const logger = HookFactory.createLogger(HookEvent.PostTaskComplete, console);
const rateLimiter = HookFactory.createRateLimiter(HookEvent.PreToolCall, { maxPerMinute: 100 });
const validator = HookFactory.createValidator(HookEvent.PreAgentSpawn, (data) => data.type !== undefined);
```

### 👷 Worker Pool

```typescript
import { WorkerPool, WorkerFactory } from '@claude-flow/plugins';

// Create a worker pool
const pool = new WorkerPool({
  minWorkers: 2,
  maxWorkers: 10,
  taskQueueSize: 100
});

// Spawn workers using factory
const coder = await pool.spawn(WorkerFactory.createCoder('main-coder'));
const reviewer = await pool.spawn(WorkerFactory.createReviewer('code-reviewer'));
const tester = await pool.spawn(WorkerFactory.createTester('test-runner'));

// Submit tasks
const result = await pool.submit({
  id: 'task-1',
  type: 'code-generation',
  input: { prompt: 'Write a function...' }
});

// Shutdown
await pool.shutdown();
```

### 🤖 LLM Provider Integration

```typescript
import { ProviderRegistry, ProviderFactory, BaseLLMProvider } from '@claude-flow/plugins';

const registry = new ProviderRegistry({
  fallbackChain: ['anthropic', 'openai'],
  costOptimization: true
});

// Register built-in providers
class ClaudeProvider extends BaseLLMProvider {
  constructor() {
    super(ProviderFactory.createClaude());
  }

  async complete(request) {
    // Implementation
  }
}

registry.register(new ClaudeProvider());

// Execute with automatic fallback
const response = await registry.execute({
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

### 🔗 Agentic Flow Integration

```typescript
import { AgenticFlowBridge, AgentDBBridge } from '@claude-flow/plugins';

// Swarm coordination
const agentic = new AgenticFlowBridge({ maxConcurrentAgents: 15 });
await agentic.initializeSwarm({ type: 'hierarchical', maxAgents: 15 });

const agent = await agentic.spawnAgent({
  type: 'coder',
  capabilities: ['typescript', 'react']
});

const result = await agentic.orchestrateTask({
  taskType: 'code-generation',
  input: { prompt: '...' },
  agentId: agent.id
});

// Vector storage with AgentDB
const agentdb = new AgentDBBridge({ dimensions: 1536, indexType: 'hnsw' });
await agentdb.initialize();

await agentdb.store('doc-1', embeddings, { type: 'document' });
const similar = await agentdb.search(queryVector, { limit: 10 });
```

### 🔒 Security Utilities

```typescript
import { Security, createRateLimiter, createResourceLimiter } from '@claude-flow/plugins';

// Input validation
const name = Security.validateString(input, { minLength: 1, maxLength: 100 });
const count = Security.validateNumber(input, { min: 0, max: 1000, integer: true });
const path = Security.validatePath(input, { allowedExtensions: ['.ts', '.js'] });

// Safe path creation (prevents traversal attacks)
const safePath = Security.safePath('/project', 'src', userInput);

// Safe JSON parsing (prevents prototype pollution)
const data = Security.safeJsonParse<Config>(jsonString);

// Command validation
const cmd = Security.validateCommand('npm install', { allowedCommands: new Set(['npm', 'npx']) });

// Rate limiting
const limiter = createRateLimiter({ maxTokens: 100, refillRate: 10, refillInterval: 1000 });
if (limiter.tryAcquire()) {
  // Proceed
}

// Resource limiting
const resourceLimiter = createResourceLimiter({ maxMemoryMB: 512, maxExecutionTime: 30000 });
const result = await resourceLimiter.enforce(async () => {
  // Heavy computation
});
```

## API Reference

### Core Exports

| Export | Description |
|--------|-------------|
| `PluginBuilder` | Fluent builder for creating plugins |
| `BasePlugin` | Abstract base class for plugins |
| `PluginRegistry` | Plugin lifecycle management |
| `getDefaultRegistry()` | Get the default plugin registry |

### SDK Builders

| Export | Description |
|--------|-------------|
| `MCPToolBuilder` | Build MCP tools with parameters |
| `HookBuilder` | Build hooks with conditions and transformers |
| `WorkerBuilder` | Build worker definitions |

### Quick Creators

| Export | Description |
|--------|-------------|
| `createToolPlugin()` | Create a tool-only plugin |
| `createHooksPlugin()` | Create a hooks-only plugin |
| `createWorkerPlugin()` | Create a worker plugin |
| `createProviderPlugin()` | Create a provider plugin |

### Hook System

| Export | Description |
|--------|-------------|
| `HookRegistry` | Central hook management |
| `HookExecutor` | Execute hooks with patterns |
| `HookFactory` | Pre-built hook creators |
| `HookEvent` | All hook event types |
| `HookPriority` | Hook priority levels |

### Workers

| Export | Description |
|--------|-------------|
| `WorkerPool` | Managed worker pool |
| `WorkerInstance` | Individual worker |
| `WorkerFactory` | Worker definition factory |

### Providers

| Export | Description |
|--------|-------------|
| `ProviderRegistry` | LLM provider management |
| `BaseLLMProvider` | Base provider implementation |
| `ProviderFactory` | Provider definition factory |

### Integrations

| Export | Description |
|--------|-------------|
| `AgenticFlowBridge` | agentic-flow@alpha integration |
| `AgentDBBridge` | AgentDB vector storage |

### Security

| Export | Description |
|--------|-------------|
| `Security` | All security utilities |
| `validateString/Number/Boolean/Array/Enum` | Input validators |
| `safePath/safePathAsync` | Path security |
| `safeJsonParse/safeJsonStringify` | JSON security |
| `createRateLimiter` | Rate limiting |
| `createResourceLimiter` | Resource limiting |

## Hook Events

```typescript
enum HookEvent {
  // Session lifecycle
  SessionStart = 'session:start',
  SessionEnd = 'session:end',

  // Agent lifecycle
  PreAgentSpawn = 'agent:pre-spawn',
  PostAgentSpawn = 'agent:post-spawn',
  PreAgentTerminate = 'agent:pre-terminate',
  PostAgentTerminate = 'agent:post-terminate',

  // Task lifecycle
  PreTaskExecute = 'task:pre-execute',
  PostTaskComplete = 'task:post-complete',
  TaskError = 'task:error',

  // Tool lifecycle
  PreToolCall = 'tool:pre-call',
  PostToolCall = 'tool:post-call',

  // Memory operations
  PreMemoryStore = 'memory:pre-store',
  PostMemoryStore = 'memory:post-store',
  PreMemoryRetrieve = 'memory:pre-retrieve',
  PostMemoryRetrieve = 'memory:post-retrieve',

  // Swarm coordination
  SwarmInitialized = 'swarm:initialized',
  SwarmShutdown = 'swarm:shutdown',
  ConsensusReached = 'swarm:consensus-reached',

  // File operations
  PreFileRead = 'file:pre-read',
  PostFileRead = 'file:post-read',
  PreFileWrite = 'file:pre-write',
  PostFileWrite = 'file:post-write',

  // Commands
  PreCommand = 'command:pre-execute',
  PostCommand = 'command:post-execute',

  // Learning
  PatternLearned = 'learning:pattern-learned',
  PatternApplied = 'learning:pattern-applied',
}
```

## Hook Priorities

```typescript
enum HookPriority {
  Critical = 1000,  // Run first, can abort
  High = 750,       // Important hooks
  Normal = 500,     // Default priority
  Low = 250,        // Less important
  Deferred = 0,     // Run last
}
```

## Worker Types

- `coder` - Code implementation
- `reviewer` - Code review
- `tester` - Test generation/execution
- `researcher` - Information gathering
- `planner` - Task planning
- `coordinator` - Multi-agent coordination
- `security` - Security analysis
- `performance` - Performance optimization
- `specialized` - Custom capabilities
- `long-running` - Background tasks

## Performance

| Metric | Target | Actual |
|--------|--------|--------|
| Plugin load time | < 50ms | ~20ms |
| Hook execution | < 1ms | ~0.5ms |
| Worker spawn | < 100ms | ~50ms |
| Vector search (10K) | < 10ms | ~5ms |

## Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

## License

MIT
