# TDD London School Implementation Plan

## Overview

This document defines the **London School TDD** (Mock-first, Outside-in) approach for Claude-Flow v3 implementation. All 15 agents follow this methodology, with Agent #13 (TDD Test Engineer) as the primary coordinator.

---

## London School vs Classical TDD

| Aspect | London School (Our Approach) | Classical (Detroit) |
|--------|------------------------------|---------------------|
| **Focus** | Behavior & interactions | State verification |
| **Mocking** | Mock all collaborators | Minimal mocking |
| **Direction** | Outside-in | Inside-out |
| **Granularity** | Fine-grained unit tests | Coarse-grained |
| **Coupling** | Tests coupled to design | Tests coupled to behavior |
| **Refactoring** | May break tests | Tests survive refactoring |

**Why London School for v3:**
- Forces clean interface design upfront
- Enables parallel development (mock dependencies)
- Catches integration issues early
- Aligns with swarm agent isolation

---

## Core Principles

### 1. Start with Acceptance Test
```typescript
// __tests__/acceptance/unified-coordinator.test.ts
describe('UnifiedSwarmCoordinator', () => {
  it('should coordinate 15 agents across mesh topology', async () => {
    // This test drives the entire feature
    const coordinator = new UnifiedSwarmCoordinator();
    const result = await coordinator.coordinateSwarm({
      agents: 15,
      topology: 'mesh',
      task: 'implement-security-fixes'
    });

    expect(result.completedTasks).toBe(15);
    expect(result.consensusAchieved).toBe(true);
  });
});
```

### 2. Mock All Collaborators
```typescript
// __tests__/unit/core/task-manager.test.ts
describe('TaskManager', () => {
  let taskManager: TaskManager;
  let mockEventBus: jest.Mocked<EventBus>;
  let mockAgentPool: jest.Mocked<AgentPool>;
  let mockMemory: jest.Mocked<IMemoryBackend>;

  beforeEach(() => {
    // Mock all dependencies
    mockEventBus = createMock<EventBus>();
    mockAgentPool = createMock<AgentPool>();
    mockMemory = createMock<IMemoryBackend>();

    taskManager = new TaskManager(mockEventBus, mockAgentPool, mockMemory);
  });

  it('should emit task_assigned event when assigning task', async () => {
    const task = createTestTask();

    await taskManager.assignTask(task, 'agent-1');

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'task_assigned',
      expect.objectContaining({ taskId: task.id, agentId: 'agent-1' })
    );
  });
});
```

### 3. One Assertion Per Test
```typescript
// CORRECT: Single assertion
it('should hash password with bcrypt', async () => {
  const result = await secureFoundation.hashPassword('test123');
  expect(result).toMatch(/^\$2[aby]\$\d+\$/);
});

// CORRECT: Multiple expects for same assertion
it('should generate secure token', () => {
  const token = secureFoundation.generateSecureToken(32);
  expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
  expect(token).toMatch(/^[a-f0-9]+$/);
});

// INCORRECT: Multiple unrelated assertions
it('should handle authentication', async () => {
  const hash = await auth.hashPassword('test');
  expect(hash).toBeDefined();           // Assertion 1
  const token = auth.generateToken();
  expect(token).toHaveLength(64);       // Assertion 2 - SEPARATE TEST!
  const valid = await auth.verify(token);
  expect(valid).toBe(true);             // Assertion 3 - SEPARATE TEST!
});
```

### 4. Red-Green-Refactor Cycle
```
┌─────────────────────────────────────────────────────────────┐
│                    TDD CYCLE                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│    ┌─────────┐      ┌─────────┐      ┌───────────┐         │
│    │   RED   │ ───► │  GREEN  │ ───► │ REFACTOR  │         │
│    │  Write  │      │  Make   │      │  Improve  │         │
│    │ failing │      │   it    │      │   code    │         │
│    │  test   │      │  pass   │      │  quality  │         │
│    └─────────┘      └─────────┘      └─────────┘          │
│         │                                   │               │
│         └───────────────────────────────────┘               │
│                      (repeat)                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Test Categories by Module

### Security Module Tests (Agents #2-4)

```typescript
// __tests__/unit/security/password-hashing.test.ts
describe('PasswordHashing', () => {
  let hasher: PasswordHasher;
  let mockCrypto: jest.Mocked<CryptoService>;

  beforeEach(() => {
    mockCrypto = createMock<CryptoService>();
    hasher = new PasswordHasher(mockCrypto);
  });

  describe('hashPassword', () => {
    it('should use bcrypt with 12 rounds', async () => {
      const hash = await hasher.hash('password123');

      expect(hash).toMatch(/^\$2[aby]\$12\$/);
    });

    it('should generate unique hash for same password', async () => {
      const hash1 = await hasher.hash('password123');
      const hash2 = await hasher.hash('password123');

      expect(hash1).not.toBe(hash2);
    });

    it('should reject empty password', async () => {
      await expect(hasher.hash('')).rejects.toThrow('Password required');
    });
  });

  describe('verifyPassword', () => {
    it('should return true for matching password', async () => {
      const hash = await hasher.hash('password123');
      const result = await hasher.verify('password123', hash);

      expect(result).toBe(true);
    });

    it('should return false for non-matching password', async () => {
      const hash = await hasher.hash('password123');
      const result = await hasher.verify('wrongpassword', hash);

      expect(result).toBe(false);
    });
  });
});

// __tests__/unit/security/path-validation.test.ts
describe('PathValidator', () => {
  let validator: PathValidator;

  beforeEach(() => {
    validator = new PathValidator('/app/data');
  });

  it('should allow paths within base directory', () => {
    const result = validator.validate('subdir/file.txt');

    expect(result).toBe('/app/data/subdir/file.txt');
  });

  it('should reject path traversal attempts', () => {
    expect(() => validator.validate('../etc/passwd'))
      .toThrow('Path traversal detected');
  });

  it('should reject absolute paths outside base', () => {
    expect(() => validator.validate('/etc/passwd'))
      .toThrow('Path traversal detected');
  });
});

// __tests__/unit/security/command-execution.test.ts
describe('SafeExecutor', () => {
  let executor: SafeExecutor;
  let mockChildProcess: jest.Mocked<ChildProcess>;

  beforeEach(() => {
    mockChildProcess = createMock<ChildProcess>();
    executor = new SafeExecutor(mockChildProcess);
  });

  it('should use execFile without shell', async () => {
    await executor.exec('node', ['script.js']);

    expect(mockChildProcess.execFile).toHaveBeenCalledWith(
      'node',
      ['script.js'],
      expect.objectContaining({ shell: false })
    );
  });

  it('should reject commands with shell metacharacters', async () => {
    await expect(executor.exec('node', ['script.js; rm -rf /']))
      .rejects.toThrow('Invalid command argument');
  });
});
```

### Core Module Tests (Agents #5-6)

```typescript
// __tests__/unit/core/orchestrator/task-manager.test.ts
describe('TaskManager', () => {
  let taskManager: TaskManager;
  let mockEventBus: jest.Mocked<IEventBus>;
  let mockTaskQueue: jest.Mocked<ITaskQueue>;
  let mockLogger: jest.Mocked<ILogger>;

  beforeEach(() => {
    mockEventBus = createMock<IEventBus>();
    mockTaskQueue = createMock<ITaskQueue>();
    mockLogger = createMock<ILogger>();

    taskManager = new TaskManager({
      eventBus: mockEventBus,
      taskQueue: mockTaskQueue,
      logger: mockLogger
    });
  });

  describe('submitTask', () => {
    it('should add task to queue', async () => {
      const task = createTestTask();

      await taskManager.submitTask(task);

      expect(mockTaskQueue.enqueue).toHaveBeenCalledWith(task);
    });

    it('should emit task_submitted event', async () => {
      const task = createTestTask();

      await taskManager.submitTask(task);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'task_submitted',
        expect.objectContaining({ taskId: task.id })
      );
    });
  });

  describe('assignTask', () => {
    it('should update task status to in_progress', async () => {
      const task = createTestTask({ status: 'pending' });
      mockTaskQueue.get.mockResolvedValue(task);

      await taskManager.assignTask(task.id, 'agent-1');

      expect(mockTaskQueue.update).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({ status: 'in_progress', assignedTo: 'agent-1' })
      );
    });
  });
});

// __tests__/unit/core/orchestrator/lifecycle-manager.test.ts
describe('LifecycleManager', () => {
  let lifecycleManager: LifecycleManager;
  let mockAgentRegistry: jest.Mocked<IAgentRegistry>;
  let mockHealthMonitor: jest.Mocked<IHealthMonitor>;

  beforeEach(() => {
    mockAgentRegistry = createMock<IAgentRegistry>();
    mockHealthMonitor = createMock<IHealthMonitor>();

    lifecycleManager = new LifecycleManager({
      agentRegistry: mockAgentRegistry,
      healthMonitor: mockHealthMonitor
    });
  });

  describe('spawnAgent', () => {
    it('should register agent in registry', async () => {
      const config = { type: 'coder', name: 'agent-1' };

      await lifecycleManager.spawnAgent(config);

      expect(mockAgentRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'agent-1' })
      );
    });

    it('should start health monitoring for agent', async () => {
      const config = { type: 'coder', name: 'agent-1' };

      const agent = await lifecycleManager.spawnAgent(config);

      expect(mockHealthMonitor.startMonitoring).toHaveBeenCalledWith(agent.id);
    });
  });

  describe('terminateAgent', () => {
    it('should gracefully shutdown agent', async () => {
      const agentId = 'agent-1';
      const mockAgent = createMockAgent({ id: agentId });
      mockAgentRegistry.get.mockResolvedValue(mockAgent);

      await lifecycleManager.terminateAgent(agentId);

      expect(mockAgent.shutdown).toHaveBeenCalled();
      expect(mockAgentRegistry.unregister).toHaveBeenCalledWith(agentId);
    });
  });
});
```

### Memory Module Tests (Agent #7)

```typescript
// __tests__/unit/memory/agentdb-adapter.test.ts
describe('AgentDBAdapter', () => {
  let adapter: AgentDBAdapter;
  let mockAgentDB: jest.Mocked<AgentDB>;

  beforeEach(() => {
    mockAgentDB = createMock<AgentDB>();
    adapter = new AgentDBAdapter(mockAgentDB);
  });

  describe('store', () => {
    it('should convert MemoryEntry to AgentDB format', async () => {
      const entry: MemoryEntry = {
        id: 'mem-1',
        content: 'Test content',
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        metadata: { type: 'note' }
      };

      await adapter.store(entry);

      expect(mockAgentDB.insert).toHaveBeenCalledWith({
        id: 'mem-1',
        vector: expect.any(Float32Array),
        data: { content: 'Test content', metadata: { type: 'note' } }
      });
    });
  });

  describe('query', () => {
    it('should use HNSW search for vector queries', async () => {
      const query: MemoryQuery = {
        type: 'semantic',
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        limit: 5
      };

      await adapter.query(query);

      expect(mockAgentDB.search).toHaveBeenCalledWith(
        query.embedding,
        expect.objectContaining({ k: 5, method: 'hnsw' })
      );
    });
  });
});
```

### Swarm Module Tests (Agent #8)

```typescript
// __tests__/unit/swarm/unified-coordinator.test.ts
describe('UnifiedSwarmCoordinator', () => {
  let coordinator: UnifiedSwarmCoordinator;
  let mockAgentPool: jest.Mocked<IAgentPool>;
  let mockConsensus: jest.Mocked<IConsensusEngine>;
  let mockMessageBus: jest.Mocked<IMessageBus>;

  beforeEach(() => {
    mockAgentPool = createMock<IAgentPool>();
    mockConsensus = createMock<IConsensusEngine>();
    mockMessageBus = createMock<IMessageBus>();

    coordinator = new UnifiedSwarmCoordinator({
      agentPool: mockAgentPool,
      consensus: mockConsensus,
      messageBus: mockMessageBus
    });
  });

  describe('coordinateSwarm', () => {
    it('should decompose task across available agents', async () => {
      mockAgentPool.getAvailable.mockResolvedValue(['agent-1', 'agent-2', 'agent-3']);

      await coordinator.coordinateSwarm({
        task: 'implement-feature',
        topology: 'mesh'
      });

      expect(mockMessageBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'task_assignment' })
      );
    });

    it('should achieve consensus before finalizing', async () => {
      mockConsensus.propose.mockResolvedValue({ accepted: true });

      const result = await coordinator.coordinateSwarm({
        task: 'implement-feature',
        topology: 'mesh'
      });

      expect(mockConsensus.propose).toHaveBeenCalled();
      expect(result.consensusAchieved).toBe(true);
    });
  });

  describe('topology switching', () => {
    it('should switch from mesh to hierarchical dynamically', async () => {
      coordinator.setTopology('mesh');

      await coordinator.switchTopology('hierarchical');

      expect(coordinator.currentTopology).toBe('hierarchical');
      expect(mockMessageBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'topology_change' })
      );
    });
  });
});
```

### Integration Tests

```typescript
// __tests__/integration/security-flow.test.ts
describe('Security Integration', () => {
  let app: Application;

  beforeAll(async () => {
    app = await createTestApplication();
  });

  afterAll(async () => {
    await app.shutdown();
  });

  it('should reject login with weak password', async () => {
    const response = await app.request('/auth/login', {
      method: 'POST',
      body: { email: 'test@example.com', password: '123' }
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Password too weak');
  });

  it('should hash passwords securely on registration', async () => {
    const response = await app.request('/auth/register', {
      method: 'POST',
      body: { email: 'test@example.com', password: 'SecurePass123!' }
    });

    expect(response.status).toBe(201);

    // Verify password is hashed with bcrypt
    const user = await app.db.users.findByEmail('test@example.com');
    expect(user.password).toMatch(/^\$2[aby]\$12\$/);
  });
});

// __tests__/integration/swarm-coordination.test.ts
describe('Swarm Coordination Integration', () => {
  let swarm: SwarmInstance;

  beforeAll(async () => {
    swarm = await SwarmInstance.create({
      maxAgents: 5,
      topology: 'mesh'
    });
  });

  afterAll(async () => {
    await swarm.shutdown();
  });

  it('should coordinate task execution across agents', async () => {
    const task = {
      id: 'task-1',
      description: 'Test task',
      subtasks: ['sub-1', 'sub-2', 'sub-3']
    };

    const result = await swarm.executeTask(task);

    expect(result.completedSubtasks).toBe(3);
    expect(result.executionTime).toBeLessThan(5000);
  });

  it('should handle agent failure gracefully', async () => {
    // Simulate agent failure
    await swarm.simulateFailure('agent-2');

    const task = { id: 'task-2', description: 'Recovery test' };
    const result = await swarm.executeTask(task);

    expect(result.success).toBe(true);
    expect(result.failedAgents).toContain('agent-2');
    expect(result.recoveredBy).toBeDefined();
  });
});
```

---

## Test File Structure

```
__tests__/
├── unit/
│   ├── security/
│   │   ├── password-hashing.test.ts
│   │   ├── token-generation.test.ts
│   │   ├── path-validation.test.ts
│   │   ├── command-execution.test.ts
│   │   └── input-validation.test.ts
│   │
│   ├── core/
│   │   ├── orchestrator/
│   │   │   ├── task-manager.test.ts
│   │   │   ├── session-manager.test.ts
│   │   │   ├── health-monitor.test.ts
│   │   │   └── lifecycle-manager.test.ts
│   │   ├── event-bus.test.ts
│   │   └── config-validator.test.ts
│   │
│   ├── memory/
│   │   ├── agentdb-adapter.test.ts
│   │   ├── cache-manager.test.ts
│   │   └── query-builder.test.ts
│   │
│   ├── swarm/
│   │   ├── unified-coordinator.test.ts
│   │   ├── consensus-engine.test.ts
│   │   ├── topology-manager.test.ts
│   │   └── message-bus.test.ts
│   │
│   ├── mcp/
│   │   ├── server.test.ts
│   │   ├── transport.test.ts
│   │   └── tool-registry.test.ts
│   │
│   ├── integration-layer/
│   │   ├── agentic-flow-bridge.test.ts
│   │   ├── sona-adapter.test.ts
│   │   └── attention-coordinator.test.ts
│   │
│   ├── cli/
│   │   ├── command-parser.test.ts
│   │   ├── interactive-prompts.test.ts
│   │   └── output-formatter.test.ts
│   │
│   └── neural/
│       ├── sona-learning.test.ts
│       ├── pattern-matcher.test.ts
│       └── reasoning-bank.test.ts
│
├── integration/
│   ├── security-flow.test.ts
│   ├── swarm-coordination.test.ts
│   ├── memory-persistence.test.ts
│   ├── mcp-communication.test.ts
│   └── agentic-flow-integration.test.ts
│
├── e2e/
│   ├── cli-commands.test.ts
│   ├── swarm-execution.test.ts
│   └── full-workflow.test.ts
│
├── acceptance/
│   ├── unified-coordinator.test.ts
│   ├── security-compliance.test.ts
│   └── performance-targets.test.ts
│
├── performance/
│   ├── startup-time.bench.ts
│   ├── memory-operations.bench.ts
│   ├── swarm-latency.bench.ts
│   └── attention-mechanisms.bench.ts
│
├── fixtures/
│   ├── agents.ts
│   ├── tasks.ts
│   ├── memory-entries.ts
│   └── configurations.ts
│
├── mocks/
│   ├── event-bus.mock.ts
│   ├── agent-pool.mock.ts
│   ├── memory-backend.mock.ts
│   ├── consensus-engine.mock.ts
│   └── agentic-flow.mock.ts
│
└── helpers/
    ├── create-mock.ts
    ├── test-application.ts
    ├── swarm-instance.ts
    └── assertions.ts
```

---

## Coverage Targets

| Category | Target | Measurement |
|----------|--------|-------------|
| Unit Tests | 90% | Line coverage |
| Integration Tests | 80% | Feature coverage |
| E2E Tests | 70% | User flow coverage |
| Security Tests | 95% | Vulnerability coverage |
| Performance Tests | All critical paths | Benchmark suite |

---

## Agent TDD Workflow

Each agent follows this workflow:

```
1. Receive task from Queen Coordinator
        ↓
2. Write failing acceptance test
        ↓
3. Write failing unit test (mock collaborators)
        ↓
4. Implement minimum code to pass test
        ↓
5. Refactor while tests pass
        ↓
6. Repeat 3-5 until acceptance test passes
        ↓
7. Report completion to Queen Coordinator
        ↓
8. Update GitHub issue with test coverage
```

---

## Mock Factory Pattern

```typescript
// __tests__/helpers/create-mock.ts
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';

export function createMock<T>(): jest.Mocked<T> {
  return mockDeep<T>();
}

// Usage
const mockEventBus = createMock<IEventBus>();
mockEventBus.emit.mockResolvedValue(undefined);
mockEventBus.on.mockImplementation((event, handler) => {
  // Store handler for testing
  return () => {}; // Unsubscribe function
});
```

---

## Related Documents

- [SWARM-OVERVIEW.md](./SWARM-OVERVIEW.md) - 15-agent swarm plan
- [AGENT-SPECIFICATIONS.md](./AGENT-SPECIFICATIONS.md) - Agent details
- [BENCHMARK-OPTIMIZATION.md](./BENCHMARK-OPTIMIZATION.md) - Performance testing
