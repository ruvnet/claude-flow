# Benchmark Optimization Plan

## Overview

This document defines the **performance benchmarking and optimization strategy** for Claude-Flow v3. Agent #14 (Performance Engineer) leads this effort, with support from all other agents.

---

## Performance Targets

| Category | Current (v2.7.47) | Target (v3.0.0) | Improvement |
|----------|-------------------|-----------------|-------------|
| **CLI Startup** | ~2.5s | <500ms | 5x faster |
| **MCP Init** | ~1.8s | <400ms | 4.5x faster |
| **Agent Spawn** | ~800ms | <200ms | 4x faster |
| **Vector Search** | 150ms/query | <1ms/query | 150x faster |
| **Memory Write** | 50ms | <5ms | 10x faster |
| **Swarm Consensus** | ~500ms | <100ms | 5x faster |
| **Flash Attention** | N/A | 2.49x-7.47x | New feature |
| **Memory Usage** | 512MB | <256MB | 50% reduction |

---

## Benchmark Suite Architecture

```
benchmarks/
├── startup/
│   ├── cli-cold-start.bench.ts
│   ├── cli-warm-start.bench.ts
│   ├── mcp-server-init.bench.ts
│   └── agent-spawn.bench.ts
│
├── memory/
│   ├── vector-search.bench.ts
│   ├── hnsw-indexing.bench.ts
│   ├── memory-write.bench.ts
│   ├── cache-hit-rate.bench.ts
│   └── garbage-collection.bench.ts
│
├── swarm/
│   ├── agent-coordination.bench.ts
│   ├── task-decomposition.bench.ts
│   ├── consensus-latency.bench.ts
│   ├── message-throughput.bench.ts
│   └── topology-switching.bench.ts
│
├── attention/
│   ├── flash-attention.bench.ts
│   ├── multi-head-attention.bench.ts
│   ├── linear-attention.bench.ts
│   ├── hyperbolic-attention.bench.ts
│   └── moe-attention.bench.ts
│
├── learning/
│   ├── sona-adaptation.bench.ts
│   ├── pattern-matching.bench.ts
│   ├── model-update.bench.ts
│   └── rl-training-step.bench.ts
│
├── integration/
│   ├── agentic-flow-bridge.bench.ts
│   ├── mcp-tool-execution.bench.ts
│   └── hook-execution.bench.ts
│
└── regression/
    ├── baseline-v2.json
    ├── current.json
    └── compare.ts
```

---

## Benchmark Implementation

### Benchmark Framework

```typescript
// benchmarks/framework/benchmark.ts
import { performance } from 'perf_hooks';

interface BenchmarkResult {
  name: string;
  iterations: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  stdDev: number;
  opsPerSecond: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
}

export async function benchmark(
  name: string,
  fn: () => Promise<void> | void,
  options: {
    iterations?: number;
    warmup?: number;
    timeout?: number;
  } = {}
): Promise<BenchmarkResult> {
  const { iterations = 1000, warmup = 100, timeout = 30000 } = options;
  const results: number[] = [];

  // Warmup
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  // Force GC before measurement
  if (global.gc) global.gc();

  const memBefore = process.memoryUsage();

  // Measure
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    results.push(end - start);
  }

  const memAfter = process.memoryUsage();

  // Calculate statistics
  results.sort((a, b) => a - b);
  const sum = results.reduce((a, b) => a + b, 0);
  const mean = sum / results.length;
  const median = results[Math.floor(results.length / 2)];
  const p95 = results[Math.floor(results.length * 0.95)];
  const p99 = results[Math.floor(results.length * 0.99)];
  const min = results[0];
  const max = results[results.length - 1];
  const variance = results.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / results.length;
  const stdDev = Math.sqrt(variance);

  return {
    name,
    iterations,
    mean,
    median,
    p95,
    p99,
    min,
    max,
    stdDev,
    opsPerSecond: 1000 / mean,
    memoryUsage: {
      heapUsed: memAfter.heapUsed - memBefore.heapUsed,
      heapTotal: memAfter.heapTotal,
      external: memAfter.external
    }
  };
}
```

### Startup Benchmarks

```typescript
// benchmarks/startup/cli-cold-start.bench.ts
import { benchmark } from '../framework/benchmark';
import { spawn } from 'child_process';

describe('CLI Startup Benchmarks', () => {
  it('should start CLI in under 500ms (cold)', async () => {
    const result = await benchmark(
      'CLI Cold Start',
      async () => {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('npx', ['claude-flow', '--version'], {
            env: { ...process.env, NODE_ENV: 'production' }
          });
          proc.on('close', (code) => code === 0 ? resolve() : reject());
        });
      },
      { iterations: 50, warmup: 5 }
    );

    console.log(`CLI Cold Start: ${result.mean.toFixed(2)}ms (p95: ${result.p95.toFixed(2)}ms)`);
    expect(result.p95).toBeLessThan(500);
  });

  it('should start CLI in under 200ms (warm)', async () => {
    // Pre-import modules
    await import('../../src/cli/main');

    const result = await benchmark(
      'CLI Warm Start',
      async () => {
        const { CLI } = await import('../../src/cli/cli-core');
        const cli = new CLI();
        await cli.initialize();
      },
      { iterations: 100, warmup: 10 }
    );

    console.log(`CLI Warm Start: ${result.mean.toFixed(2)}ms (p95: ${result.p95.toFixed(2)}ms)`);
    expect(result.p95).toBeLessThan(200);
  });
});

// benchmarks/startup/agent-spawn.bench.ts
describe('Agent Spawn Benchmarks', () => {
  let coordinator: UnifiedSwarmCoordinator;

  beforeAll(async () => {
    coordinator = await UnifiedSwarmCoordinator.create();
  });

  afterAll(async () => {
    await coordinator.shutdown();
  });

  it('should spawn agent in under 200ms', async () => {
    const result = await benchmark(
      'Agent Spawn',
      async () => {
        const agent = await coordinator.spawnAgent({
          type: 'coder',
          name: `agent-${Date.now()}`
        });
        await coordinator.terminateAgent(agent.id);
      },
      { iterations: 100, warmup: 10 }
    );

    console.log(`Agent Spawn: ${result.mean.toFixed(2)}ms (p95: ${result.p95.toFixed(2)}ms)`);
    expect(result.p95).toBeLessThan(200);
  });

  it('should spawn 15 agents concurrently in under 1s', async () => {
    const result = await benchmark(
      '15-Agent Concurrent Spawn',
      async () => {
        const agents = await Promise.all(
          Array.from({ length: 15 }, (_, i) =>
            coordinator.spawnAgent({ type: 'coder', name: `agent-${i}` })
          )
        );
        await Promise.all(agents.map(a => coordinator.terminateAgent(a.id)));
      },
      { iterations: 20, warmup: 3 }
    );

    console.log(`15-Agent Spawn: ${result.mean.toFixed(2)}ms (p95: ${result.p95.toFixed(2)}ms)`);
    expect(result.p95).toBeLessThan(1000);
  });
});
```

### Memory Benchmarks

```typescript
// benchmarks/memory/vector-search.bench.ts
import { benchmark } from '../framework/benchmark';
import { AgentDBAdapter } from '../../src/memory/agentdb-adapter';

describe('Vector Search Benchmarks', () => {
  let adapter: AgentDBAdapter;
  const VECTOR_DIM = 1536; // OpenAI embedding dimension
  const DATASET_SIZE = 100000;

  beforeAll(async () => {
    adapter = await AgentDBAdapter.create({
      indexType: 'hnsw',
      dimension: VECTOR_DIM
    });

    // Seed with test data
    console.log(`Seeding ${DATASET_SIZE} vectors...`);
    const vectors = Array.from({ length: DATASET_SIZE }, () => ({
      id: `vec-${Math.random().toString(36)}`,
      embedding: new Float32Array(VECTOR_DIM).map(() => Math.random()),
      content: 'Test content',
      metadata: { type: 'test' }
    }));

    await adapter.bulkInsert(vectors);
    console.log('Seeding complete');
  });

  afterAll(async () => {
    await adapter.close();
  });

  it('should search 100k vectors in under 1ms (HNSW)', async () => {
    const queryVector = new Float32Array(VECTOR_DIM).map(() => Math.random());

    const result = await benchmark(
      'HNSW Search (100k vectors)',
      async () => {
        await adapter.query({
          type: 'semantic',
          embedding: queryVector,
          limit: 10
        });
      },
      { iterations: 1000, warmup: 100 }
    );

    console.log(`HNSW Search: ${result.mean.toFixed(3)}ms (p95: ${result.p95.toFixed(3)}ms)`);
    console.log(`Throughput: ${result.opsPerSecond.toFixed(0)} queries/sec`);
    expect(result.p95).toBeLessThan(1);
  });

  it('should achieve 150x improvement over brute force', async () => {
    const queryVector = new Float32Array(VECTOR_DIM).map(() => Math.random());

    // Brute force baseline
    const bruteForce = await benchmark(
      'Brute Force Search',
      async () => {
        await adapter.query({
          type: 'semantic',
          embedding: queryVector,
          limit: 10,
          method: 'brute_force'
        });
      },
      { iterations: 100, warmup: 10 }
    );

    // HNSW
    const hnsw = await benchmark(
      'HNSW Search',
      async () => {
        await adapter.query({
          type: 'semantic',
          embedding: queryVector,
          limit: 10,
          method: 'hnsw'
        });
      },
      { iterations: 1000, warmup: 100 }
    );

    const improvement = bruteForce.mean / hnsw.mean;
    console.log(`Brute Force: ${bruteForce.mean.toFixed(2)}ms`);
    console.log(`HNSW: ${hnsw.mean.toFixed(3)}ms`);
    console.log(`Improvement: ${improvement.toFixed(0)}x`);

    expect(improvement).toBeGreaterThan(150);
  });
});

// benchmarks/memory/memory-write.bench.ts
describe('Memory Write Benchmarks', () => {
  let adapter: AgentDBAdapter;

  beforeAll(async () => {
    adapter = await AgentDBAdapter.create();
  });

  afterAll(async () => {
    await adapter.close();
  });

  it('should write memory entry in under 5ms', async () => {
    const result = await benchmark(
      'Memory Write',
      async () => {
        await adapter.store({
          id: `mem-${Date.now()}-${Math.random()}`,
          content: 'Test memory content',
          embedding: new Float32Array(1536).map(() => Math.random()),
          metadata: { type: 'test', timestamp: Date.now() }
        });
      },
      { iterations: 1000, warmup: 100 }
    );

    console.log(`Memory Write: ${result.mean.toFixed(3)}ms (p95: ${result.p95.toFixed(3)}ms)`);
    expect(result.p95).toBeLessThan(5);
  });

  it('should handle batch writes efficiently', async () => {
    const batchSize = 100;

    const result = await benchmark(
      `Batch Write (${batchSize} entries)`,
      async () => {
        const entries = Array.from({ length: batchSize }, (_, i) => ({
          id: `batch-${Date.now()}-${i}`,
          content: `Batch content ${i}`,
          embedding: new Float32Array(1536).map(() => Math.random()),
          metadata: { batch: true }
        }));
        await adapter.bulkInsert(entries);
      },
      { iterations: 100, warmup: 10 }
    );

    const perEntry = result.mean / batchSize;
    console.log(`Batch Write: ${result.mean.toFixed(2)}ms total`);
    console.log(`Per Entry: ${perEntry.toFixed(3)}ms`);
    expect(perEntry).toBeLessThan(1);
  });
});
```

### Attention Mechanism Benchmarks

```typescript
// benchmarks/attention/flash-attention.bench.ts
import { benchmark } from '../framework/benchmark';
import { AttentionCoordinator } from 'agentic-flow/core';

describe('Flash Attention Benchmarks', () => {
  let coordinator: AttentionCoordinator;

  beforeAll(async () => {
    coordinator = new AttentionCoordinator({
      type: 'flash',
      memoryEfficient: true
    });
    await coordinator.initialize();
  });

  afterAll(async () => {
    await coordinator.shutdown();
  });

  const SEQUENCE_LENGTHS = [512, 1024, 2048, 4096, 8192];

  for (const seqLen of SEQUENCE_LENGTHS) {
    it(`should process ${seqLen} tokens with Flash Attention`, async () => {
      const input = new Float32Array(seqLen * 768).map(() => Math.random());

      const result = await benchmark(
        `Flash Attention (seq=${seqLen})`,
        async () => {
          await coordinator.forward(input, { sequenceLength: seqLen });
        },
        { iterations: 100, warmup: 10 }
      );

      console.log(`Flash Attention (${seqLen} tokens): ${result.mean.toFixed(2)}ms`);
    });
  }

  it('should achieve 2.49x-7.47x speedup over standard attention', async () => {
    const seqLen = 2048;
    const input = new Float32Array(seqLen * 768).map(() => Math.random());

    // Standard attention baseline
    const standardCoord = new AttentionCoordinator({ type: 'multi-head' });
    await standardCoord.initialize();

    const standard = await benchmark(
      'Standard Attention',
      async () => {
        await standardCoord.forward(input, { sequenceLength: seqLen });
      },
      { iterations: 50, warmup: 5 }
    );

    // Flash attention
    const flash = await benchmark(
      'Flash Attention',
      async () => {
        await coordinator.forward(input, { sequenceLength: seqLen });
      },
      { iterations: 100, warmup: 10 }
    );

    await standardCoord.shutdown();

    const speedup = standard.mean / flash.mean;
    console.log(`Standard: ${standard.mean.toFixed(2)}ms`);
    console.log(`Flash: ${flash.mean.toFixed(2)}ms`);
    console.log(`Speedup: ${speedup.toFixed(2)}x`);

    expect(speedup).toBeGreaterThanOrEqual(2.49);
  });

  it('should reduce memory usage by 50-75%', async () => {
    const seqLen = 4096;
    const input = new Float32Array(seqLen * 768).map(() => Math.random());

    // Measure standard attention memory
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;

    const standardCoord = new AttentionCoordinator({ type: 'multi-head' });
    await standardCoord.initialize();
    await standardCoord.forward(input, { sequenceLength: seqLen });

    const standardMem = process.memoryUsage().heapUsed - memBefore;
    await standardCoord.shutdown();

    // Measure flash attention memory
    if (global.gc) global.gc();
    const memBefore2 = process.memoryUsage().heapUsed;

    await coordinator.forward(input, { sequenceLength: seqLen });

    const flashMem = process.memoryUsage().heapUsed - memBefore2;

    const reduction = (1 - flashMem / standardMem) * 100;
    console.log(`Standard Memory: ${(standardMem / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Flash Memory: ${(flashMem / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Reduction: ${reduction.toFixed(1)}%`);

    expect(reduction).toBeGreaterThanOrEqual(50);
  });
});
```

### Swarm Benchmarks

```typescript
// benchmarks/swarm/agent-coordination.bench.ts
describe('Swarm Coordination Benchmarks', () => {
  let coordinator: UnifiedSwarmCoordinator;

  beforeAll(async () => {
    coordinator = await UnifiedSwarmCoordinator.create({
      maxAgents: 15,
      topology: 'mesh'
    });

    // Spawn 15 agents
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        coordinator.spawnAgent({ type: 'worker', name: `agent-${i}` })
      )
    );
  });

  afterAll(async () => {
    await coordinator.shutdown();
  });

  it('should coordinate 15 agents in under 100ms', async () => {
    const result = await benchmark(
      '15-Agent Coordination',
      async () => {
        await coordinator.broadcastTask({
          type: 'ping',
          requireAck: true
        });
      },
      { iterations: 100, warmup: 10 }
    );

    console.log(`15-Agent Coordination: ${result.mean.toFixed(2)}ms (p95: ${result.p95.toFixed(2)}ms)`);
    expect(result.p95).toBeLessThan(100);
  });

  it('should achieve consensus in under 100ms', async () => {
    const result = await benchmark(
      'Consensus Achievement',
      async () => {
        await coordinator.proposeConsensus({
          proposal: 'test-proposal',
          algorithm: 'raft'
        });
      },
      { iterations: 50, warmup: 5 }
    );

    console.log(`Consensus: ${result.mean.toFixed(2)}ms (p95: ${result.p95.toFixed(2)}ms)`);
    expect(result.p95).toBeLessThan(100);
  });

  it('should handle 1000 messages/second', async () => {
    const messageCount = 1000;
    const startTime = performance.now();

    await Promise.all(
      Array.from({ length: messageCount }, (_, i) =>
        coordinator.sendMessage({
          to: `agent-${i % 15}`,
          type: 'test',
          payload: { index: i }
        })
      )
    );

    const duration = performance.now() - startTime;
    const throughput = (messageCount / duration) * 1000;

    console.log(`Message Throughput: ${throughput.toFixed(0)} messages/sec`);
    expect(throughput).toBeGreaterThanOrEqual(1000);
  });
});
```

---

## Optimization Strategies

### 1. Lazy Loading

```typescript
// Before: Eager loading (slow startup)
import { SONA } from 'agentic-flow/sona';
import { AgentDB } from 'agentic-flow/agentdb';
import { Attention } from 'agentic-flow/attention';

// After: Lazy loading (fast startup)
let sona: SONA | undefined;
let agentdb: AgentDB | undefined;
let attention: Attention | undefined;

export async function getSONA(): Promise<SONA> {
  if (!sona) {
    const { SONA } = await import('agentic-flow/sona');
    sona = new SONA();
    await sona.initialize();
  }
  return sona;
}
```

### 2. Connection Pooling

```typescript
// MCP connection pool
class MCPConnectionPool {
  private connections: Map<string, MCPConnection> = new Map();
  private maxConnections = 10;

  async getConnection(endpoint: string): Promise<MCPConnection> {
    if (this.connections.has(endpoint)) {
      return this.connections.get(endpoint)!;
    }

    if (this.connections.size >= this.maxConnections) {
      // Evict oldest connection
      const oldest = this.connections.keys().next().value;
      await this.connections.get(oldest)?.close();
      this.connections.delete(oldest);
    }

    const conn = await MCPConnection.create(endpoint);
    this.connections.set(endpoint, conn);
    return conn;
  }
}
```

### 3. Memory Optimization

```typescript
// Use typed arrays for vectors
const embedding = new Float32Array(1536); // 6KB vs 12KB for number[]

// Use object pooling for frequent allocations
class TaskPool {
  private pool: Task[] = [];

  acquire(): Task {
    return this.pool.pop() || new Task();
  }

  release(task: Task): void {
    task.reset();
    this.pool.push(task);
  }
}

// Use WeakMap for caches that should be garbage collected
const embedCache = new WeakMap<object, Float32Array>();
```

### 4. Parallel Processing

```typescript
// Process agents in parallel with concurrency limit
import pLimit from 'p-limit';

const limit = pLimit(4); // Max 4 concurrent operations

const results = await Promise.all(
  agents.map(agent =>
    limit(() => processAgent(agent))
  )
);
```

---

## CI/CD Integration

```yaml
# .github/workflows/benchmarks.yml
name: Performance Benchmarks

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run benchmarks
        run: npm run benchmark -- --json > benchmark-results.json

      - name: Compare with baseline
        run: |
          node benchmarks/regression/compare.ts \
            --baseline benchmarks/regression/baseline-v2.json \
            --current benchmark-results.json \
            --threshold 10

      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: benchmark-results
          path: benchmark-results.json

      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const results = require('./benchmark-results.json');
            const comment = formatBenchmarkComment(results);
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
```

---

## Regression Detection

```typescript
// benchmarks/regression/compare.ts
interface ComparisonResult {
  name: string;
  baseline: number;
  current: number;
  delta: number;
  deltaPercent: number;
  status: 'improved' | 'regressed' | 'stable';
}

function compareResults(
  baseline: BenchmarkResult[],
  current: BenchmarkResult[],
  threshold: number = 10
): ComparisonResult[] {
  const results: ComparisonResult[] = [];

  for (const curr of current) {
    const base = baseline.find(b => b.name === curr.name);
    if (!base) continue;

    const delta = curr.mean - base.mean;
    const deltaPercent = (delta / base.mean) * 100;

    let status: 'improved' | 'regressed' | 'stable';
    if (deltaPercent < -threshold) status = 'improved';
    else if (deltaPercent > threshold) status = 'regressed';
    else status = 'stable';

    results.push({
      name: curr.name,
      baseline: base.mean,
      current: curr.mean,
      delta,
      deltaPercent,
      status
    });
  }

  return results;
}
```

---

## Related Documents

- [SWARM-OVERVIEW.md](./SWARM-OVERVIEW.md) - 15-agent swarm plan
- [AGENT-SPECIFICATIONS.md](./AGENT-SPECIFICATIONS.md) - Agent details (Agent #14)
- [TDD-LONDON-SCHOOL-PLAN.md](./TDD-LONDON-SCHOOL-PLAN.md) - Test plan
- [DEPLOYMENT-PLAN.md](./DEPLOYMENT-PLAN.md) - Release strategy
