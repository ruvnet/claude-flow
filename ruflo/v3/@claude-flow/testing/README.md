# @claude-flow/testing

[![npm version](https://img.shields.io/npm/v/@claude-flow/testing.svg)](https://www.npmjs.com/package/@claude-flow/testing)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/testing.svg)](https://www.npmjs.com/package/@claude-flow/testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![TDD](https://img.shields.io/badge/TDD-London%20School-purple.svg)](https://github.com/ruvnet/claude-flow)
[![ADR-008](https://img.shields.io/badge/ADR--008-Vitest-green.svg)](https://vitest.dev/)

> Comprehensive testing framework for V3 Claude-Flow modules. Implements London School TDD patterns with behavior verification, shared fixtures, and mock services.

Based on ADR-008 (Vitest over Jest).

## Installation

```bash
npm install @claude-flow/testing vitest --save-dev
```

## Quick Start

```typescript
import {
  setupV3Tests,
  createMockApplication,
  agentConfigs,
  swarmConfigs,
  waitFor,
} from '@claude-flow/testing';

// Configure test environment
setupV3Tests();

describe('MyModule', () => {
  const app = createMockApplication();

  beforeEach(() => {
    // Mocks are automatically reset
  });

  it('should spawn an agent', async () => {
    const result = await app.agentLifecycle.spawn(agentConfigs.queenCoordinator);

    expect(result.success).toBe(true);
    expect(result.agent.type).toBe('queen-coordinator');
  });
});
```

## Directory Structure

```
src/
├── fixtures/           # Pre-defined test data
│   ├── agent-fixtures.ts    # Mock agents, configs
│   ├── memory-fixtures.ts   # Memory entries, backends
│   ├── swarm-fixtures.ts    # Swarm configs, topologies
│   └── mcp-fixtures.ts      # MCP tools, contexts
├── helpers/            # Test utilities
│   ├── test-utils.ts        # waitFor, retry, timeout
│   ├── mock-factory.ts      # Factory functions for mocks
│   ├── assertion-helpers.ts # Custom Vitest matchers
│   └── setup-teardown.ts    # Global setup/teardown
├── mocks/              # Mock service implementations
│   ├── mock-services.ts     # AgentDB, SwarmCoordinator, etc.
│   └── mock-mcp-client.ts   # MCP client for CLI testing
├── setup.ts            # Global test configuration
└── index.ts            # Main exports
```

## Fixtures

### Agent Fixtures

```typescript
import {
  agentConfigs,
  agentInstances,
  createAgentConfig,
  createAgentInstance,
  createV3SwarmAgentConfigs,
  createMockAgent,
  createMockV3Swarm,
} from '@claude-flow/testing';

// Pre-defined configs
const queen = agentConfigs.queenCoordinator;
const coder = agentConfigs.coder;

// Create with overrides
const customAgent = createAgentConfig('coder', {
  name: 'Custom Coder',
  priority: 90,
});

// Full V3 15-agent swarm
const swarmConfigs = createV3SwarmAgentConfigs();

// Mock agents with vitest mocks
const mockAgent = createMockAgent('security-architect');
mockAgent.execute.mockResolvedValue({ success: true });
```

### Memory Fixtures

```typescript
import {
  memoryEntries,
  searchResults,
  learnedPatterns,
  hnswConfigs,
  memoryBackendConfigs,
  createMemoryEntry,
  createVectorQuery,
  generateMockEmbedding,
  createMemoryBatch,
} from '@claude-flow/testing';

// Pre-defined entries
const pattern = memoryEntries.agentPattern;
const securityRule = memoryEntries.securityRule;

// Create with overrides
const entry = createMemoryEntry('agentPattern', {
  key: 'custom:pattern:001',
});

// Generate embeddings
const embedding = generateMockEmbedding(384, 'my-seed');

// Create batch for performance testing
const batch = createMemoryBatch(10000, 'semantic');
```

### Swarm Fixtures

```typescript
import {
  swarmConfigs,
  swarmStates,
  swarmTasks,
  swarmMessages,
  coordinationResults,
  createSwarmConfig,
  createSwarmTask,
  createSwarmMessage,
  createConsensusRequest,
  createMockSwarmCoordinator,
} from '@claude-flow/testing';

// Pre-defined configs
const v3Config = swarmConfigs.v3Default;
const minimalConfig = swarmConfigs.minimal;

// Create with overrides
const customConfig = createSwarmConfig('v3Default', {
  maxAgents: 20,
  coordination: {
    consensusProtocol: 'pbft',
    heartbeatInterval: 500,
    electionTimeout: 3000,
  },
});

// Mock coordinator
const coordinator = createMockSwarmCoordinator();
await coordinator.initialize(v3Config);
```

### MCP Fixtures

```typescript
import {
  mcpTools,
  mcpResources,
  mcpPrompts,
  mcpServerConfigs,
  mcpToolResults,
  mcpErrors,
  createMCPTool,
  createMCPRequest,
  createMCPResponse,
  createMockMCPClient,
} from '@claude-flow/testing';

// Pre-defined tools
const swarmInit = mcpTools.swarmInit;
const agentSpawn = mcpTools.agentSpawn;

// Mock client
const client = createMockMCPClient();
await client.connect();
const result = await client.callTool('swarm_init', { topology: 'mesh' });
```

## Test Utilities

### Async Utilities

```typescript
import {
  waitFor,
  waitUntilChanged,
  retry,
  withTimeout,
  sleep,
  parallelLimit,
} from '@claude-flow/testing';

// Wait for condition
await waitFor(() => element.isVisible(), { timeout: 5000 });

// Wait for value to change
await waitUntilChanged(() => counter.value, { from: 0 });

// Retry with exponential backoff
const result = await retry(
  async () => await fetchData(),
  { maxAttempts: 3, backoff: 100 }
);

// Timeout wrapper
await withTimeout(async () => await longOp(), 5000);

// Parallel with concurrency limit
const results = await parallelLimit(
  items.map(item => () => processItem(item)),
  5 // max 5 concurrent
);
```

### Time Control

```typescript
import { createMockClock, measureTime } from '@claude-flow/testing';

// Mock clock for time-dependent tests
const clock = createMockClock();
clock.install();
clock.tick(1000); // Advance by 1 second
clock.uninstall();

// Measure execution time
const { result, duration } = await measureTime(async () => {
  return await expensiveOperation();
});
```

### Event Emitter

```typescript
import { createTestEmitter } from '@claude-flow/testing';

const emitter = createTestEmitter<{ message: string; count: number }>();

const handler = vi.fn();
emitter.on('message', handler);
emitter.emit('message', 'hello');

expect(handler).toHaveBeenCalledWith('hello');
```

## Mock Factory

### Application Mocks

```typescript
import {
  createMockApplication,
  createMockEventBus,
  createMockTaskManager,
  createMockAgentLifecycle,
  createMockMemoryService,
  createMockSecurityService,
  createMockSwarmCoordinator,
  createMockLogger,
} from '@claude-flow/testing';

// Full application with all mocks
const app = createMockApplication();

// Individual service mocks
const eventBus = createMockEventBus();
const taskManager = createMockTaskManager();
const security = createMockSecurityService();

// Use in tests
await app.taskManager.create({ name: 'Test', type: 'coding', payload: {} });
expect(app.taskManager.create).toHaveBeenCalled();

// Access tracked state
expect(app.eventBus.publishedEvents).toHaveLength(1);
expect(app.taskManager.tasks.size).toBe(1);
```

## Mock Services

### MockAgentDB

```typescript
import { MockAgentDB } from '@claude-flow/testing';

const db = new MockAgentDB();

// Insert vectors
await db.insert('vec-1', embedding, { type: 'pattern' });

// Search
const results = await db.search(queryEmbedding, 10, 0.7);

// Verify calls
expect(db.insert).toHaveBeenCalledWith('vec-1', expect.any(Array), expect.any(Object));
```

### MockSwarmCoordinator

```typescript
import { MockSwarmCoordinator } from '@claude-flow/testing';

const coordinator = new MockSwarmCoordinator();

await coordinator.initialize({ topology: 'hierarchical-mesh' });
await coordinator.addAgent({ type: 'coder', name: 'Coder-1' });
const result = await coordinator.coordinate({ id: 'task-1', type: 'coding', payload: {} });

expect(coordinator.getState().agentCount).toBe(1);
expect(result.success).toBe(true);
```

### MockMCPClient

```typescript
import { MockMCPClient, createStandardMockMCPClient } from '@claude-flow/testing';

// Standard client with common tools
const client = createStandardMockMCPClient();
await client.connect();

// Custom tool handlers
client.setToolHandler('swarm_init', async (params) => ({
  content: [{ type: 'text', text: JSON.stringify({ swarmId: 'test' }) }],
}));

const result = await client.callTool('swarm_init', { topology: 'mesh' });

// Verify request history
expect(client.getRequestHistory()).toHaveLength(1);
expect(client.getLastRequest()?.method).toBe('tools/call');
```

## Assertions

### Standard Assertions

```typescript
import {
  assertEventPublished,
  assertEventOrder,
  assertMocksCalledInOrder,
  assertV3PerformanceTargets,
  assertValidStateTransition,
  assertNoSensitiveData,
} from '@claude-flow/testing';

// Event assertions
assertEventPublished(mockEventBus, 'UserCreated', { userId: '123' });
assertEventOrder(mockEventBus.publish, ['UserCreated', 'EmailSent']);

// Mock order
assertMocksCalledInOrder([mockValidate, mockSave, mockNotify]);

// Performance targets
assertV3PerformanceTargets({
  searchSpeedup: 160,
  flashAttentionSpeedup: 3.5,
  memoryReduction: 0.55,
});

// State transitions
assertValidStateTransition('pending', 'running', {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed'],
});

// Security
assertNoSensitiveData(mockLogger.logs, ['password', 'token', 'secret']);
```

### Custom Vitest Matchers

```typescript
import { registerCustomMatchers } from '@claude-flow/testing';

// Register in setup
registerCustomMatchers();

// Use in tests
expect(mockFn).toHaveBeenCalledWithPattern({ userId: expect.any(String) });
expect(event).toHaveEventType('UserCreated');
expect(metrics).toMeetV3PerformanceTargets();
```

## Setup & Teardown

### Global Test Setup

```typescript
import { setupV3Tests, configureTestEnvironment } from '@claude-flow/testing';

// Simple setup
setupV3Tests();

// Custom configuration
configureTestEnvironment({
  resetMocks: true,
  fakeTimers: true,
  suppressConsole: ['log', 'warn'],
  env: {
    NODE_ENV: 'test',
    DEBUG: 'false',
  },
});
```

### Test Context

```typescript
import { createSetupContext, createTestScope } from '@claude-flow/testing';

// Setup context with cleanup
const ctx = createSetupContext();
ctx.addCleanup(() => server.close());
ctx.registerResource(database);
// ... run tests
await ctx.runCleanup();

// Isolated test scope
const scope = createTestScope();
scope.addMock(mockService);
await scope.run(async () => {
  // test code - mocks auto-cleared after
});
```

### Performance Testing

```typescript
import { createPerformanceTestHelper } from '@claude-flow/testing';

const perf = createPerformanceTestHelper();

perf.startMeasurement('search');
await search(query);
const duration = perf.endMeasurement('search');

// Get statistics
const stats = perf.getStats('search');
console.log(`Avg: ${stats.avg}ms, P95: ${stats.p95}ms`);
```

## Performance Targets

The testing framework includes assertions for V3 performance targets:

| Metric | Target |
|--------|--------|
| Search Speedup | 150x - 12,500x |
| Flash Attention Speedup | 2.49x - 7.47x |
| Memory Reduction | >= 50% |
| Startup Time | < 500ms |
| Response Time | < 100ms |

```typescript
import { assertV3PerformanceTargets, TEST_CONFIG } from '@claude-flow/testing';

// Assert targets
assertV3PerformanceTargets({
  searchSpeedup: 160,
  flashAttentionSpeedup: 3.5,
  memoryReduction: 0.55,
  startupTimeMs: 450,
  responseTimeMs: 80,
});

// Access constants
console.log(TEST_CONFIG.FLASH_ATTENTION_SPEEDUP_MIN); // 2.49
console.log(TEST_CONFIG.AGENTDB_SEARCH_IMPROVEMENT_MAX); // 12500
```

## Best Practices

### 1. Use London School TDD

```typescript
// Arrange mocks before acting
const mockRepo = createMock<UserRepository>();
mockRepo.findById.mockResolvedValue(user);

// Act
await service.processUser('123');

// Assert behavior (not implementation)
expect(mockRepo.findById).toHaveBeenCalledWith('123');
expect(mockNotifier.notify).toHaveBeenCalledBefore(mockRepo.save);
```

### 2. Use Fixtures Over Inline Data

```typescript
// Good - use fixtures
const agent = agentConfigs.queenCoordinator;
const task = createSwarmTask('securityScan');

// Avoid - inline data
const agent = { type: 'queen-coordinator', name: 'Test', capabilities: [] };
```

### 3. Isolate Tests

```typescript
// Use fresh mocks per test
beforeEach(() => {
  vi.clearAllMocks();
});

// Or use test scope
const scope = createTestScope();
await scope.run(async () => {
  // isolated test
});
```

### 4. Test Behavior, Not Implementation

```typescript
// Good - behavior verification
expect(mockEventBus.publish).toHaveBeenCalledWith(
  expect.objectContaining({ type: 'UserCreated' })
);

// Avoid - implementation details
expect(service._internalQueue.length).toBe(1);
```

## License

MIT
