# Async Execution Optimization Guide

## Overview

Converting from synchronous to asynchronous execution is the single most impactful optimization, offering **50% performance improvement** with moderate implementation effort.

## Current Implementation Problems

### 1. Blocking API Calls
```typescript
// PROBLEM: Each API call blocks for 10-15 seconds
async executeTask(task: Task): Promise<Result> {
  console.log(`Starting task ${task.id}`);
  
  // BLOCKING: Single connection, no pooling
  const result = await this.claudeAPI.complete({
    prompt: task.prompt,
    model: task.model
  });
  
  // BLOCKING: Synchronous file write
  fs.writeFileSync(`results/${task.id}.json`, JSON.stringify(result));
  
  return result;
}
```

### 2. Sequential Processing
```typescript
// PROBLEM: Tasks processed one at a time
for (const task of tasks) {
  const result = await executeTask(task);  // Waits for each task
  results.push(result);
}
// Total time: n * averageTaskTime
```

### 3. No Connection Management
```typescript
// PROBLEM: Creating new connections for each request
class ClaudeAPI {
  async complete(params) {
    const connection = await this.createConnection();  // Expensive
    const result = await connection.send(params);
    await connection.close();  // Wasteful
    return result;
  }
}
```

## Optimization Implementation

### Phase 1: Connection Pooling

```typescript
import { Pool } from 'generic-pool';

class ClaudeConnectionPool {
  private pool: Pool<ClaudeConnection>;
  
  constructor(config: PoolConfig) {
    this.pool = createPool({
      create: async () => {
        const conn = new ClaudeConnection(config);
        await conn.initialize();
        return conn;
      },
      destroy: async (conn) => {
        await conn.close();
      },
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      evictionRunIntervalMillis: 10000
    });
  }
  
  async execute<T>(fn: (conn: ClaudeConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.acquire();
    try {
      return await fn(conn);
    } finally {
      await this.pool.release(conn);
    }
  }
  
  async drain() {
    await this.pool.drain();
    await this.pool.clear();
  }
}
```

### Phase 2: Async File Operations

```typescript
import { promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

class AsyncFileManager {
  private writeQueue = new PQueue({ concurrency: 10 });
  
  async writeResult(taskId: string, result: any): Promise<void> {
    // Non-blocking write with queuing
    return this.writeQueue.add(async () => {
      const path = `results/${taskId}.json`;
      const data = JSON.stringify(result, null, 2);
      
      // Use streaming for large results
      if (data.length > 1024 * 1024) { // > 1MB
        const stream = createWriteStream(path);
        await pipeline(
          Readable.from(data),
          stream
        );
      } else {
        // Async write for smaller files
        await fs.writeFile(path, data, 'utf8');
      }
    });
  }
  
  async ensureDirectories(): Promise<void> {
    const dirs = ['results', 'logs', 'cache'];
    await Promise.all(
      dirs.map(dir => fs.mkdir(dir, { recursive: true }))
    );
  }
}
```

### Phase 3: Concurrent Task Execution

```typescript
class ConcurrentExecutor {
  private connectionPool: ClaudeConnectionPool;
  private fileManager: AsyncFileManager;
  private concurrencyLimit = 10;
  
  async executeTasks(tasks: Task[]): Promise<Result[]> {
    // Use p-map for controlled concurrency
    const results = await pMap(
      tasks,
      async (task) => this.executeTask(task),
      { concurrency: this.concurrencyLimit }
    );
    
    return results;
  }
  
  private async executeTask(task: Task): Promise<Result> {
    // Parallel execution of API call and file prep
    const [result] = await Promise.all([
      this.callClaudeAPI(task),
      this.fileManager.ensureDirectories()
    ]);
    
    // Non-blocking result storage
    this.fileManager.writeResult(task.id, result)
      .catch(err => console.error(`Failed to write result: ${err}`));
    
    return result;
  }
  
  private async callClaudeAPI(task: Task): Promise<Result> {
    return this.connectionPool.execute(async (conn) => {
      const result = await conn.complete({
        prompt: task.prompt,
        model: task.model,
        temperature: task.temperature || 0.7,
        maxTokens: task.maxTokens || 1000
      });
      
      return {
        taskId: task.id,
        output: result.completion,
        usage: result.usage,
        timestamp: Date.now()
      };
    });
  }
}
```

### Phase 4: Request Batching

```typescript
class BatchedExecutor {
  private batchQueue: Task[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private batchSize = 5;
  private batchDelay = 100; // ms
  
  async addTask(task: Task): Promise<Result> {
    return new Promise((resolve, reject) => {
      this.batchQueue.push({ task, resolve, reject });
      
      if (this.batchQueue.length >= this.batchSize) {
        this.processBatch();
      } else if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.processBatch(), this.batchDelay);
      }
    });
  }
  
  private async processBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    const batch = this.batchQueue.splice(0, this.batchSize);
    if (batch.length === 0) return;
    
    try {
      // Process batch in parallel
      const results = await Promise.all(
        batch.map(({ task }) => this.executeTask(task))
      );
      
      // Resolve all promises
      batch.forEach(({ resolve }, index) => {
        resolve(results[index]);
      });
    } catch (error) {
      // Reject all promises in batch
      batch.forEach(({ reject }) => reject(error));
    }
  }
}
```

### Phase 5: Stream Processing

```typescript
class StreamingExecutor {
  async executeStream(
    taskStream: ReadableStream<Task>
  ): AsyncIterableIterator<Result> {
    const reader = taskStream.getReader();
    const executor = new ConcurrentExecutor();
    
    async function* processStream() {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          // Process task and yield result immediately
          const result = await executor.executeTask(value);
          yield result;
        }
      } finally {
        reader.releaseLock();
      }
    }
    
    return processStream();
  }
}
```

## Performance Monitoring

```typescript
class PerformanceMonitor {
  private metrics = {
    apiCallDuration: new Histogram(),
    fileWriteDuration: new Histogram(),
    taskExecutionTime: new Histogram(),
    concurrentTasks: new Gauge(),
    connectionPoolSize: new Gauge(),
    queueLength: new Gauge()
  };
  
  async trackExecution<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    this.metrics.concurrentTasks.inc();
    
    try {
      const result = await fn();
      const duration = performance.now() - start;
      
      this.metrics[`${name}Duration`]?.observe(duration);
      this.metrics.taskExecutionTime.observe(duration);
      
      return result;
    } finally {
      this.metrics.concurrentTasks.dec();
    }
  }
  
  getMetrics() {
    return {
      avgApiCallTime: this.metrics.apiCallDuration.mean(),
      avgFileWriteTime: this.metrics.fileWriteDuration.mean(),
      avgTaskTime: this.metrics.taskExecutionTime.mean(),
      concurrentTasks: this.metrics.concurrentTasks.value(),
      connectionPoolSize: this.metrics.connectionPoolSize.value()
    };
  }
}
```

## Implementation Checklist

### Week 1: Foundation
- [ ] Implement connection pooling
- [ ] Convert file operations to async
- [ ] Add basic performance monitoring
- [ ] Test connection pool under load

### Week 2: Concurrency
- [ ] Implement concurrent task executor
- [ ] Add request batching
- [ ] Configure optimal concurrency limits
- [ ] Load test concurrent execution

### Week 3: Advanced Features
- [ ] Implement streaming support
- [ ] Add circuit breaker for API calls
- [ ] Implement retry logic with backoff
- [ ] Add request deduplication

## Configuration Recommendations

```typescript
const optimizedConfig = {
  connectionPool: {
    min: 2,
    max: 10,
    acquireTimeout: 30000,
    idleTimeout: 30000
  },
  execution: {
    concurrencyLimit: 10,
    batchSize: 5,
    batchDelay: 100
  },
  retry: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
  },
  monitoring: {
    metricsInterval: 60000,
    slowTaskThreshold: 20000
  }
};
```

## Expected Performance Gains

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Task Execution Time | 10-15s | 5-7s | 50% |
| Throughput (tasks/min) | 4-6 | 10-12 | 100% |
| CPU Utilization | 15% | 60% | 300% |
| Memory Efficiency | Linear growth | Stable | 100% |
| API Connection Reuse | 0% | 95% | ∞ |

## Testing Strategy

```typescript
describe('Async Execution Performance', () => {
  it('should handle 100 concurrent tasks', async () => {
    const tasks = generateTasks(100);
    const executor = new ConcurrentExecutor();
    
    const start = Date.now();
    const results = await executor.executeTasks(tasks);
    const duration = Date.now() - start;
    
    expect(results).toHaveLength(100);
    expect(duration).toBeLessThan(30000); // 30s for 100 tasks
  });
  
  it('should maintain connection pool health', async () => {
    const pool = new ClaudeConnectionPool(config);
    const metrics = [];
    
    // Simulate load
    for (let i = 0; i < 1000; i++) {
      await pool.execute(async (conn) => {
        metrics.push(pool.getMetrics());
        await conn.complete({ prompt: 'test' });
      });
    }
    
    // Verify pool stability
    const avgConnections = average(metrics.map(m => m.size));
    expect(avgConnections).toBeGreaterThan(2);
    expect(avgConnections).toBeLessThan(10);
  });
});
```

## Rollout Plan

1. **Deploy connection pooling** (Day 1)
2. **Enable async file operations** (Day 2)
3. **Roll out concurrent execution** (Day 3-4)
4. **Monitor and tune** (Day 5)
5. **Enable batching** (Week 2)
6. **Full production rollout** (Week 2)