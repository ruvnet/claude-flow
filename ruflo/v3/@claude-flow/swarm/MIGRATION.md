# SwarmHub → UnifiedSwarmCoordinator Migration Guide

Quick reference for migrating from `SwarmHub` to `UnifiedSwarmCoordinator`

## Why Migrate?

**ADR-003** establishes `UnifiedSwarmCoordinator` as the **single canonical coordination engine**. `SwarmHub` is now a thin compatibility layer maintained only for backward compatibility.

### Benefits of Migrating

- ✅ Direct access to full coordinator API
- ✅ Better performance (no facade overhead)
- ✅ Advanced features (domain routing, parallel execution)
- ✅ Future-proof (SwarmHub will be removed in v3.1.0+)
- ✅ Cleaner code

## Quick Migration

### Import Changes

```typescript
// OLD (deprecated)
import { createSwarmHub } from '@claude-flow/swarm';

// NEW (recommended)
import { createUnifiedSwarmCoordinator } from '@claude-flow/swarm';
```

### Initialization

```typescript
// OLD
const hub = createSwarmHub();
await hub.initialize();

// NEW
const coordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'hierarchical', maxAgents: 15 },
  consensus: { algorithm: 'raft', threshold: 0.66 },
});
await coordinator.initialize();
```

### Spawning Agents

```typescript
// OLD
await hub.spawnAllAgents();

// NEW (more powerful)
const agents = await coordinator.spawnFullHierarchy();
// Returns Map<number, {agentId, domain}>
```

### Task Management

```typescript
// OLD
const task = hub.submitTask({ name: 'Task', type: 'coding' });

// NEW (same API)
const taskId = await coordinator.submitTask({
  type: 'coding',
  name: 'Task',
  priority: 'normal',
  maxRetries: 3,
});
```

### Advanced Features (New)

```typescript
// Domain-based routing (not available in SwarmHub)
await coordinator.assignTaskToDomain(taskId, 'security');

// Parallel execution across domains
const results = await coordinator.executeParallel([
  { task: { type: 'coding', name: 'Core' }, domain: 'core' },
  { task: { type: 'testing', name: 'Tests' }, domain: 'security' },
  { task: { type: 'review', name: 'Review' }, domain: 'support' },
]);

// Get domain-specific status
const status = coordinator.getStatus();
status.domains.forEach(domain => {
  console.log(`${domain.name}: ${domain.availableAgents} available`);
});
```

### Shutdown

```typescript
// OLD
await hub.shutdown();

// NEW (same API)
await coordinator.shutdown();
```

## Complete Example

### Before (SwarmHub)

```typescript
import { createSwarmHub } from '@claude-flow/swarm';

async function runSwarm() {
  const hub = createSwarmHub();
  await hub.initialize();

  const agents = await hub.spawnAllAgents();
  console.log(`Spawned ${agents.size} agents`);

  const task = hub.submitTask({
    name: 'Security Review',
    type: 'review',
  });

  const nextTask = hub.assignNextTask('agent-2');
  if (nextTask) {
    hub.completeTask(nextTask.id, { success: true });
  }

  await hub.shutdown();
}
```

### After (UnifiedSwarmCoordinator)

```typescript
import { createUnifiedSwarmCoordinator } from '@claude-flow/swarm';

async function runSwarm() {
  const coordinator = createUnifiedSwarmCoordinator({
    topology: { type: 'hierarchical', maxAgents: 15 },
    consensus: { algorithm: 'raft', threshold: 0.66 },
  });

  await coordinator.initialize();

  // Spawn 15-agent hierarchy across 5 domains
  const agents = await coordinator.spawnFullHierarchy();
  console.log(`Spawned ${agents.size} agents across 5 domains`);

  // Submit task
  const taskId = await coordinator.submitTask({
    type: 'review',
    name: 'Security Review',
    priority: 'high',
    maxRetries: 3,
  });

  // Route to security domain
  await coordinator.assignTaskToDomain(taskId, 'security');

  // Get comprehensive status
  const status = coordinator.getStatus();
  console.log('Metrics:', status.metrics);
  console.log('Domain Status:', status.domains);

  await coordinator.shutdown();
}
```

## API Mapping

| SwarmHub Method | UnifiedSwarmCoordinator Method | Notes |
|----------------|-------------------------------|-------|
| `initialize()` | `initialize()` | Same API |
| `shutdown()` | `shutdown()` | Same API |
| `isInitialized()` | Check `getState().status` | Slightly different |
| `spawnAgent(id)` | `registerAgent(agent)` | Different API |
| `spawnAllAgents()` | `spawnFullHierarchy()` | Better return type |
| `spawnAgentsByDomain(d)` | `getAgentsByDomain(d)` + register | Different approach |
| `terminateAgent(id)` | `unregisterAgent(id)` | Same API |
| `submitTask(spec)` | `submitTask(task)` | Similar API |
| `assignNextTask(agentId)` | Use task orchestration | Different pattern |
| `completeTask(id, result)` | Handle via events | Different pattern |
| `getState()` | `getState()` | Same API |
| `getMetrics()` | `getMetrics()` | Same API |
| N/A | `assignTaskToDomain(id, domain)` | **New feature** |
| N/A | `executeParallel(tasks)` | **New feature** |
| N/A | `getStatus()` | **New feature** |

## Compatibility Layer (Temporary)

If you can't migrate immediately, use the compatibility layer:

```typescript
import { createSwarmHub } from '@claude-flow/swarm';

const hub = createSwarmHub();
await hub.initialize();

// Access the underlying coordinator for advanced features
const coordinator = hub.getCoordinator();

// Use coordinator directly for new features
await coordinator.executeParallel([
  { task: task1, domain: 'core' },
  { task: task2, domain: 'security' },
]);

// Continue using hub for legacy API
const agents = await hub.spawnAllAgents();
```

## New Features Only in UnifiedSwarmCoordinator

### 1. Domain-Based Routing

```typescript
// Route tasks to specific domains
await coordinator.assignTaskToDomain(securityTaskId, 'security');
await coordinator.assignTaskToDomain(coreTaskId, 'core');
await coordinator.assignTaskToDomain(integrationTaskId, 'integration');
```

### 2. Parallel Execution

```typescript
const results = await coordinator.executeParallel([
  { task: { type: 'coding', name: 'Impl Auth' }, domain: 'core' },
  { task: { type: 'testing', name: 'Security Tests' }, domain: 'security' },
  { task: { type: 'review', name: 'Code Review' }, domain: 'support' },
]);

// Check results
results.forEach(r => {
  console.log(`${r.domain}: ${r.success ? '✅' : '❌'} (${r.durationMs}ms)`);
});
```

### 3. Domain Status

```typescript
const status = coordinator.getStatus();

status.domains.forEach(domain => {
  console.log(`${domain.name}:`, {
    agentCount: domain.agentCount,
    available: domain.availableAgents,
    busy: domain.busyAgents,
    queued: domain.tasksQueued,
    completed: domain.tasksCompleted,
  });
});
```

### 4. Performance Reporting

```typescript
const report = coordinator.getPerformanceReport();

console.log({
  coordinationLatencyP50: report.coordinationLatencyP50,
  coordinationLatencyP99: report.coordinationLatencyP99,
  messagesPerSecond: report.messagesPerSecond,
  taskThroughput: report.taskThroughput,
  agentUtilization: report.agentUtilization,
  consensusSuccessRate: report.consensusSuccessRate,
});
```

### 5. Agent Domain Management

```typescript
// Register agent with automatic domain assignment
const { agentId, domain } = await coordinator.registerAgentWithDomain(
  agentData,
  2 // Agent number → determines domain
);

// Get all agents in a domain
const securityAgents = coordinator.getAgentsByDomain('security');
```

## TypeScript Types

### UnifiedSwarmCoordinator Config

```typescript
interface CoordinatorConfig {
  topology: {
    type: 'mesh' | 'hierarchical' | 'centralized' | 'hybrid';
    maxAgents: number;
    replicationFactor?: number;
    partitionStrategy?: 'hash' | 'range';
    failoverEnabled?: boolean;
    autoRebalance?: boolean;
  };
  consensus: {
    algorithm: 'raft' | 'byzantine' | 'gossip' | 'paxos';
    threshold: number;
    timeoutMs?: number;
    maxRounds?: number;
    requireQuorum?: boolean;
  };
  messageBus?: {
    maxQueueSize?: number;
    processingIntervalMs?: number;
    ackTimeoutMs?: number;
    retryAttempts?: number;
  };
  maxAgents?: number;
  maxTasks?: number;
  heartbeatIntervalMs?: number;
  healthCheckIntervalMs?: number;
  taskTimeoutMs?: number;
  autoScaling?: boolean;
  autoRecovery?: boolean;
}
```

### Domain Types

```typescript
type AgentDomain = 'queen' | 'security' | 'core' | 'integration' | 'support';

interface DomainStatus {
  name: AgentDomain;
  agentCount: number;
  availableAgents: number;
  busyAgents: number;
  tasksQueued: number;
  tasksCompleted: number;
}

interface ParallelExecutionResult {
  taskId: string;
  domain: AgentDomain;
  success: boolean;
  result?: unknown;
  error?: Error;
  durationMs: number;
}
```

## Common Pitfalls

### 1. Different Task Submission API

```typescript
// ❌ SwarmHub API (spec object)
hub.submitTask({ name: 'Task', type: 'coding' });

// ✅ UnifiedSwarmCoordinator API (full task definition)
coordinator.submitTask({
  type: 'coding',
  name: 'Task',
  priority: 'normal',
  maxRetries: 3,
});
```

### 2. Agent Registration

```typescript
// ❌ SwarmHub (simple ID)
hub.spawnAgent('agent-1');

// ✅ UnifiedSwarmCoordinator (full state)
coordinator.registerAgent({
  name: 'agent-1',
  type: 'worker',
  status: 'idle',
  capabilities: { /* ... */ },
  metrics: { /* ... */ },
  workload: 0,
  health: 1.0,
  // ...
});
```

### 3. Task Assignment

```typescript
// ❌ SwarmHub (pull model)
const task = hub.assignNextTask(agentId);

// ✅ UnifiedSwarmCoordinator (push model)
const taskId = await coordinator.submitTask(taskDef);
await coordinator.assignTaskToDomain(taskId, 'security');
```

## Testing

### Unit Tests

```typescript
import { createUnifiedSwarmCoordinator } from '@claude-flow/swarm';

describe('UnifiedSwarmCoordinator', () => {
  let coordinator;

  beforeEach(async () => {
    coordinator = createUnifiedSwarmCoordinator({
      topology: { type: 'hierarchical', maxAgents: 15 },
    });
    await coordinator.initialize();
  });

  afterEach(async () => {
    await coordinator.shutdown();
  });

  it('should spawn 15-agent hierarchy', async () => {
    const agents = await coordinator.spawnFullHierarchy();
    expect(agents.size).toBe(15);
  });

  it('should route tasks to domains', async () => {
    const taskId = await coordinator.submitTask({
      type: 'review',
      name: 'Security Audit',
      priority: 'high',
      maxRetries: 3,
    });

    const agentId = await coordinator.assignTaskToDomain(taskId, 'security');
    expect(agentId).toBeDefined();
  });
});
```

## Deprecation Timeline

| Version | SwarmHub Status | Action Required |
|---------|----------------|-----------------|
| v3.0.0-alpha | Deprecated with warnings | Start migrating |
| v3.0.0-beta | Legacy compatibility mode | Complete migration |
| v3.0.0 | Final deprecation notices | Migration recommended |
| v3.1.0+ | **REMOVED** | Must use UnifiedSwarmCoordinator |

## Getting Help

- **Documentation**: See `@claude-flow/swarm/README.md`
- **Examples**: See `/v3/examples/swarm-coordinator.ts`
- **Implementation**: See `/v3/docs/ADR-003-implementation-status.md`
- **Issues**: Report at GitHub

## Summary

### Do This ✅

```typescript
import { createUnifiedSwarmCoordinator } from '@claude-flow/swarm';

const coordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'hierarchical', maxAgents: 15 },
  consensus: { algorithm: 'raft', threshold: 0.66 },
});

await coordinator.initialize();
const agents = await coordinator.spawnFullHierarchy();
await coordinator.executeParallel(tasks);
```

### Not This ❌

```typescript
import { createSwarmHub } from '@claude-flow/swarm';

const hub = createSwarmHub();
await hub.initialize();
await hub.spawnAllAgents();
// Missing domain routing, parallel execution, etc.
```

---

**Questions?** The `UnifiedSwarmCoordinator` is the future. Migrate today! 🚀
