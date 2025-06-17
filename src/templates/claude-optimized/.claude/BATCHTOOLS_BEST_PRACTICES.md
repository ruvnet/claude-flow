# Batchtools Best Practices Guide

## Table of Contents
1. [Core Principles](#core-principles)
2. [Design Patterns](#design-patterns)
3. [Performance Best Practices](#performance-best-practices)
4. [Security Considerations](#security-considerations)
5. [Error Handling Strategies](#error-handling-strategies)
6. [Testing Best Practices](#testing-best-practices)
7. [Team Collaboration](#team-collaboration)
8. [Tool-Specific Guidelines](#tool-specific-guidelines)

---

## Core Principles

### When to Use Batch Operations vs Sequential

**Use Batch Operations When:**
- Processing multiple independent files or data items
- Operations have similar resource requirements
- Total processing time is a concern
- Operations can fail independently without affecting others

**Use Sequential Operations When:**
- Operations have dependencies between steps
- Resource constraints are tight
- Order of execution matters
- Debugging and monitoring individual steps is critical

**Decision Tree:**
```
Is the operation independent?
├── Yes → Are there multiple items to process?
│   ├── Yes → Are resources sufficient?
│   │   ├── Yes → USE BATCH
│   │   └── No → USE SEQUENTIAL WITH THROTTLING
│   └── No → USE SEQUENTIAL
└── No → USE SEQUENTIAL
```

### Balancing Parallelism with Resource Constraints

```javascript
// Good: Resource-aware batch processing
const OPTIMAL_BATCH_SIZE = Math.min(
  os.cpus().length * 2,  // CPU cores
  Math.floor(os.freemem() / (100 * 1024 * 1024)),  // Available memory
  10  // Hard limit
);

// Bad: Unbounded parallelism
const results = await Promise.all(
  files.map(file => processFile(file))  // Could overwhelm system
);
```

### Maintaining Code Readability

**Best Practices:**
1. Use descriptive variable names for batch operations
2. Group related batch operations together
3. Add comments explaining parallelism decisions
4. Use helper functions to abstract complexity

```javascript
// Good: Clear and readable
const batchedFileReads = await readFilesInBatches(
  filePaths,
  { batchSize: 5, retryCount: 3 }
);

// Bad: Unclear intent
const r = await Promise.all(fps.map(f => rf(f)));
```

### Error Handling Philosophy

**Principles:**
1. **Fail gracefully**: Don't let one failure crash everything
2. **Collect all errors**: Gather comprehensive error information
3. **Provide context**: Include which operation failed and why
4. **Enable recovery**: Design for partial retries

---

## Design Patterns

### Common Batchtools Patterns

#### 1. **Batch with Accumulator Pattern**
```javascript
async function batchProcess(items, processor, options = {}) {
  const { batchSize = 5 } = options;
  const results = [];
  const errors = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(item => processor(item))
    );
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        errors.push({
          item: batch[index],
          error: result.reason
        });
      }
    });
  }
  
  return { results, errors };
}
```

#### 2. **Pipeline Pattern**
```javascript
async function pipeline(items, stages, options = {}) {
  let current = items;
  
  for (const stage of stages) {
    const { results, errors } = await batchProcess(current, stage, options);
    
    if (errors.length > 0) {
      console.warn(`Stage ${stage.name} had ${errors.length} errors`);
    }
    
    current = results;
  }
  
  return current;
}
```

#### 3. **Circuit Breaker Pattern**
```javascript
class BatchCircuitBreaker {
  constructor(threshold = 0.5, resetTime = 60000) {
    this.threshold = threshold;
    this.resetTime = resetTime;
    this.failures = 0;
    this.successes = 0;
    this.state = 'closed';
    this.nextAttempt = Date.now();
  }
  
  async execute(batch, processor) {
    if (this.state === 'open' && Date.now() < this.nextAttempt) {
      throw new Error('Circuit breaker is open');
    }
    
    const results = await Promise.allSettled(
      batch.map(item => processor(item))
    );
    
    const failures = results.filter(r => r.status === 'rejected').length;
    const successes = results.filter(r => r.status === 'fulfilled').length;
    
    this.failures += failures;
    this.successes += successes;
    
    const failureRate = this.failures / (this.failures + this.successes);
    
    if (failureRate > this.threshold) {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.resetTime;
    }
    
    return results;
  }
}
```

### Anti-patterns to Avoid

#### 1. **Unbounded Parallelism**
```javascript
// Bad: Can overwhelm system
const results = await Promise.all(
  thousandsOfFiles.map(file => processLargeFile(file))
);

// Good: Controlled parallelism
const results = await batchProcess(thousandsOfFiles, processLargeFile, {
  batchSize: 10
});
```

#### 2. **Ignoring Partial Failures**
```javascript
// Bad: Loses error information
try {
  const results = await Promise.all(operations);
} catch (error) {
  console.log('Something failed');
}

// Good: Handles partial failures
const results = await Promise.allSettled(operations);
const succeeded = results.filter(r => r.status === 'fulfilled');
const failed = results.filter(r => r.status === 'rejected');
```

#### 3. **Resource Leaks in Batch Operations**
```javascript
// Bad: Doesn't clean up resources
async function processBatch(files) {
  const handles = await Promise.all(
    files.map(file => fs.open(file, 'r'))
  );
  // Process files...
  // Oops, forgot to close handles!
}

// Good: Ensures cleanup
async function processBatch(files) {
  const handles = [];
  try {
    for (const file of files) {
      handles.push(await fs.open(file, 'r'));
    }
    // Process files...
  } finally {
    await Promise.all(
      handles.map(handle => handle.close())
    );
  }
}
```

### Dependency Management in Parallel Workflows

#### Dependency Graph Execution
```javascript
class DependencyGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }
  
  addTask(id, task, dependencies = []) {
    this.nodes.set(id, task);
    this.edges.set(id, dependencies);
  }
  
  async execute() {
    const completed = new Set();
    const results = new Map();
    
    while (completed.size < this.nodes.size) {
      const ready = [];
      
      for (const [id, deps] of this.edges) {
        if (!completed.has(id) && deps.every(d => completed.has(d))) {
          ready.push(id);
        }
      }
      
      if (ready.length === 0) {
        throw new Error('Circular dependency detected');
      }
      
      const batchResults = await Promise.allSettled(
        ready.map(id => this.nodes.get(id)())
      );
      
      ready.forEach((id, index) => {
        completed.add(id);
        results.set(id, batchResults[index]);
      });
    }
    
    return results;
  }
}
```

### State Management in Concurrent Operations

#### Shared State Manager
```javascript
class ConcurrentStateManager {
  constructor() {
    this.state = new Map();
    this.locks = new Map();
  }
  
  async withLock(key, operation) {
    // Wait for existing lock
    while (this.locks.has(key)) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Acquire lock
    this.locks.set(key, true);
    
    try {
      return await operation(this.state);
    } finally {
      // Release lock
      this.locks.delete(key);
    }
  }
  
  async batchUpdate(updates) {
    const results = [];
    
    for (const { key, operation } of updates) {
      results.push(
        this.withLock(key, state => operation(state))
      );
    }
    
    return Promise.all(results);
  }
}
```

---

## Performance Best Practices

### Optimal Batch Sizes for Different Operations

| Operation Type | Recommended Batch Size | Rationale |
|----------------|------------------------|-----------|
| File Reads | 5-10 | I/O bound, prevents file descriptor exhaustion |
| File Writes | 3-5 | Ensures data integrity, prevents corruption |
| API Calls | 10-20 | Network bound, respects rate limits |
| CPU-intensive | CPU cores × 2 | Maximizes CPU utilization |
| Memory-intensive | Available RAM / Task RAM | Prevents OOM errors |

### Dynamic Batch Sizing
```javascript
class AdaptiveBatcher {
  constructor(initialSize = 5) {
    this.batchSize = initialSize;
    this.performanceHistory = [];
  }
  
  async processBatch(items, processor) {
    const startTime = Date.now();
    const batch = items.slice(0, this.batchSize);
    
    const results = await Promise.allSettled(
      batch.map(item => processor(item))
    );
    
    const duration = Date.now() - startTime;
    const throughput = batch.length / (duration / 1000);
    
    this.performanceHistory.push({ size: this.batchSize, throughput });
    this.adjustBatchSize();
    
    return results;
  }
  
  adjustBatchSize() {
    if (this.performanceHistory.length < 3) return;
    
    const recent = this.performanceHistory.slice(-3);
    const avgThroughput = recent.reduce((sum, r) => sum + r.throughput, 0) / 3;
    
    // Increase if performance is good
    if (avgThroughput > this.batchSize * 0.8) {
      this.batchSize = Math.min(this.batchSize + 2, 20);
    }
    // Decrease if performance is poor
    else if (avgThroughput < this.batchSize * 0.5) {
      this.batchSize = Math.max(this.batchSize - 2, 1);
    }
  }
}
```

### Resource Pooling and Management

#### Connection Pool Example
```javascript
class ResourcePool {
  constructor(factory, maxSize = 10) {
    this.factory = factory;
    this.maxSize = maxSize;
    this.available = [];
    this.inUse = new Set();
    this.waiting = [];
  }
  
  async acquire() {
    // Return available resource
    if (this.available.length > 0) {
      const resource = this.available.pop();
      this.inUse.add(resource);
      return resource;
    }
    
    // Create new resource if under limit
    if (this.inUse.size < this.maxSize) {
      const resource = await this.factory();
      this.inUse.add(resource);
      return resource;
    }
    
    // Wait for available resource
    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }
  
  release(resource) {
    this.inUse.delete(resource);
    
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      this.inUse.add(resource);
      resolve(resource);
    } else {
      this.available.push(resource);
    }
  }
  
  async withResource(operation) {
    const resource = await this.acquire();
    try {
      return await operation(resource);
    } finally {
      this.release(resource);
    }
  }
}
```

### Caching Strategies for Batch Operations

#### LRU Cache for Batch Results
```javascript
class BatchCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  
  getCacheKey(items) {
    return items.map(item => 
      typeof item === 'object' ? JSON.stringify(item) : item
    ).join('|');
  }
  
  async batchProcess(items, processor, options = {}) {
    const { useCache = true, ttl = 300000 } = options;
    const cacheKey = this.getCacheKey(items);
    
    // Check cache
    if (useCache && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < ttl) {
        return cached.results;
      }
    }
    
    // Process batch
    const results = await Promise.allSettled(
      items.map(item => processor(item))
    );
    
    // Update cache
    if (useCache) {
      this.cache.set(cacheKey, {
        results,
        timestamp: Date.now()
      });
      
      // Evict oldest if over limit
      if (this.cache.size > this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
    }
    
    return results;
  }
}
```

### Monitoring and Profiling Guidelines

#### Performance Monitor
```javascript
class BatchPerformanceMonitor {
  constructor() {
    this.metrics = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      totalDuration: 0,
      batchSizes: []
    };
  }
  
  async monitorBatch(batch, processor) {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;
    
    const results = await Promise.allSettled(
      batch.map(item => processor(item))
    );
    
    const duration = Date.now() - startTime;
    const memoryDelta = process.memoryUsage().heapUsed - startMemory;
    
    // Update metrics
    this.metrics.totalOperations += batch.length;
    this.metrics.successfulOperations += results.filter(r => r.status === 'fulfilled').length;
    this.metrics.failedOperations += results.filter(r => r.status === 'rejected').length;
    this.metrics.totalDuration += duration;
    this.metrics.batchSizes.push(batch.length);
    
    // Log if performance degrades
    const avgDuration = duration / batch.length;
    if (avgDuration > 1000) {
      console.warn(`Slow batch operation: ${avgDuration}ms per item`);
    }
    
    if (memoryDelta > 50 * 1024 * 1024) {
      console.warn(`High memory usage in batch: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB`);
    }
    
    return results;
  }
  
  getReport() {
    const avgBatchSize = this.metrics.batchSizes.reduce((a, b) => a + b, 0) / this.metrics.batchSizes.length;
    const successRate = this.metrics.successfulOperations / this.metrics.totalOperations;
    const avgDuration = this.metrics.totalDuration / this.metrics.totalOperations;
    
    return {
      totalOperations: this.metrics.totalOperations,
      successRate: `${(successRate * 100).toFixed(2)}%`,
      avgDuration: `${avgDuration.toFixed(2)}ms`,
      avgBatchSize: avgBatchSize.toFixed(2)
    };
  }
}
```

---

## Security Considerations

### Safe Parallel File Operations

#### File Locking for Concurrent Access
```javascript
class FileLockManager {
  constructor() {
    this.locks = new Map();
  }
  
  async withFileLock(filePath, operation, options = {}) {
    const { timeout = 30000, retryInterval = 100 } = options;
    const lockFile = `${filePath}.lock`;
    const startTime = Date.now();
    
    // Try to acquire lock
    while (this.locks.has(filePath)) {
      if (Date.now() - startTime > timeout) {
        throw new Error(`Timeout acquiring lock for ${filePath}`);
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
    
    // Set lock
    this.locks.set(filePath, {
      pid: process.pid,
      timestamp: Date.now()
    });
    
    try {
      // Write lock file
      await fs.writeFile(lockFile, JSON.stringify(this.locks.get(filePath)));
      
      // Execute operation
      return await operation();
    } finally {
      // Release lock
      this.locks.delete(filePath);
      try {
        await fs.unlink(lockFile);
      } catch (error) {
        // Lock file might already be removed
      }
    }
  }
  
  async batchFileOperation(files, operation) {
    return Promise.all(
      files.map(file => 
        this.withFileLock(file, () => operation(file))
      )
    );
  }
}
```

### Preventing Race Conditions

#### Atomic Operations Pattern
```javascript
class AtomicBatchOperations {
  async atomicWrite(filePath, content) {
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    
    try {
      // Write to temporary file
      await fs.writeFile(tempPath, content, { flag: 'wx' });
      
      // Atomic rename
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // Cleanup on failure
      try {
        await fs.unlink(tempPath);
      } catch {}
      throw error;
    }
  }
  
  async atomicBatchWrite(fileContents) {
    const tempFiles = [];
    
    try {
      // Write all temp files first
      for (const { path, content } of fileContents) {
        const tempPath = `${path}.tmp.${process.pid}.${Date.now()}`;
        tempFiles.push({ temp: tempPath, final: path });
        await fs.writeFile(tempPath, content, { flag: 'wx' });
      }
      
      // Atomic rename all
      await Promise.all(
        tempFiles.map(({ temp, final }) => fs.rename(temp, final))
      );
    } catch (error) {
      // Cleanup all temp files on failure
      await Promise.allSettled(
        tempFiles.map(({ temp }) => fs.unlink(temp))
      );
      throw error;
    }
  }
}
```

### Secure Credential Handling in Batch Operations

#### Credential Manager
```javascript
class SecureCredentialManager {
  constructor() {
    this.credentials = new Map();
    this.accessLog = [];
  }
  
  setCredential(key, value, options = {}) {
    const { expiresIn = 3600000 } = options; // 1 hour default
    
    this.credentials.set(key, {
      value,
      expiresAt: Date.now() + expiresIn,
      accessed: 0
    });
    
    // Schedule cleanup
    setTimeout(() => this.credentials.delete(key), expiresIn);
  }
  
  getCredential(key, requester) {
    const cred = this.credentials.get(key);
    
    if (!cred) {
      this.logAccess(key, requester, false);
      return null;
    }
    
    if (Date.now() > cred.expiresAt) {
      this.credentials.delete(key);
      this.logAccess(key, requester, false);
      return null;
    }
    
    cred.accessed++;
    this.logAccess(key, requester, true);
    return cred.value;
  }
  
  logAccess(key, requester, success) {
    this.accessLog.push({
      timestamp: new Date().toISOString(),
      key: key.substring(0, 4) + '****', // Partial key for security
      requester,
      success
    });
    
    // Rotate log if too large
    if (this.accessLog.length > 1000) {
      this.accessLog = this.accessLog.slice(-500);
    }
  }
  
  async batchOperationWithCredentials(operations, credentialKeys) {
    const requester = `batch-${Date.now()}`;
    
    // Validate all credentials exist
    const missingCreds = credentialKeys.filter(key => !this.getCredential(key, requester));
    if (missingCreds.length > 0) {
      throw new Error(`Missing credentials: ${missingCreds.join(', ')}`);
    }
    
    // Execute operations
    const results = await Promise.allSettled(
      operations.map((op, index) => {
        const creds = credentialKeys.reduce((acc, key) => {
          acc[key] = this.getCredential(key, requester);
          return acc;
        }, {});
        
        return op(creds);
      })
    );
    
    return results;
  }
}
```

### Audit Logging for Parallel Processes

#### Comprehensive Audit Logger
```javascript
class BatchAuditLogger {
  constructor(logPath) {
    this.logPath = logPath;
    this.buffer = [];
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }
  
  async logBatchOperation(operation, items, results) {
    const entry = {
      timestamp: new Date().toISOString(),
      operation: operation.name || 'anonymous',
      itemCount: items.length,
      duration: results.duration,
      success: results.success.length,
      failed: results.failed.length,
      user: process.env.USER || 'unknown',
      pid: process.pid,
      memory: process.memoryUsage(),
      errors: results.failed.map(f => ({
        item: f.item,
        error: f.error.message
      }))
    };
    
    this.buffer.push(entry);
    
    if (this.buffer.length >= 100) {
      await this.flush();
    }
  }
  
  async flush() {
    if (this.buffer.length === 0) return;
    
    const entries = this.buffer.splice(0, this.buffer.length);
    const logContent = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    
    await fs.appendFile(this.logPath, logContent);
  }
  
  async auditedBatchProcess(items, processor, metadata = {}) {
    const startTime = Date.now();
    const results = { success: [], failed: [] };
    
    const batchResults = await Promise.allSettled(
      items.map(item => processor(item))
    );
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.success.push({ item: items[index], result: result.value });
      } else {
        results.failed.push({ item: items[index], error: result.reason });
      }
    });
    
    results.duration = Date.now() - startTime;
    
    await this.logBatchOperation(processor, items, results);
    
    return results;
  }
  
  destroy() {
    clearInterval(this.flushInterval);
    this.flush();
  }
}
```

---

## Error Handling Strategies

### Graceful Degradation Patterns

#### Progressive Degradation
```javascript
class ProgressiveDegradation {
  constructor(strategies) {
    this.strategies = strategies; // Ordered from best to worst
  }
  
  async execute(item) {
    let lastError;
    
    for (const strategy of this.strategies) {
      try {
        return await strategy.execute(item);
      } catch (error) {
        lastError = error;
        console.warn(`Strategy ${strategy.name} failed, trying next...`);
      }
    }
    
    throw new Error(`All strategies failed. Last error: ${lastError.message}`);
  }
  
  async batchExecute(items) {
    return Promise.allSettled(
      items.map(item => this.execute(item))
    );
  }
}

// Example usage
const fileProcessor = new ProgressiveDegradation([
  {
    name: 'FastProcessor',
    execute: async (file) => {
      // Try fast in-memory processing
      const content = await fs.readFile(file);
      return processInMemory(content);
    }
  },
  {
    name: 'StreamProcessor',
    execute: async (file) => {
      // Fall back to streaming for large files
      return processStream(fs.createReadStream(file));
    }
  },
  {
    name: 'ChunkedProcessor',
    execute: async (file) => {
      // Last resort: process in small chunks
      return processInChunks(file, { chunkSize: 1024 });
    }
  }
]);
```

### Retry Mechanisms for Batch Operations

#### Exponential Backoff with Jitter
```javascript
class BatchRetryManager {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.maxDelay = options.maxDelay || 30000;
    this.jitter = options.jitter || 0.1;
  }
  
  calculateDelay(attempt) {
    const exponentialDelay = Math.min(
      this.baseDelay * Math.pow(2, attempt),
      this.maxDelay
    );
    
    const jitterRange = exponentialDelay * this.jitter;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    
    return exponentialDelay + jitter;
  }
  
  async retryOperation(operation, context = {}) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries) {
          const delay = this.calculateDelay(attempt);
          console.log(`Retry ${attempt + 1}/${this.maxRetries} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw new Error(`Failed after ${this.maxRetries} retries: ${lastError.message}`);
  }
  
  async batchRetry(items, processor) {
    const results = await Promise.allSettled(
      items.map(item => 
        this.retryOperation(() => processor(item), { item })
      )
    );
    
    return {
      successful: results.filter(r => r.status === 'fulfilled').map(r => r.value),
      failed: results.filter(r => r.status === 'rejected').map(r => r.reason)
    };
  }
}
```

### Partial Failure Recovery

#### Checkpoint and Resume Pattern
```javascript
class CheckpointBatchProcessor {
  constructor(checkpointPath) {
    this.checkpointPath = checkpointPath;
    this.processed = new Set();
  }
  
  async loadCheckpoint() {
    try {
      const data = await fs.readFile(this.checkpointPath, 'utf8');
      this.processed = new Set(JSON.parse(data));
    } catch (error) {
      // No checkpoint exists yet
      this.processed = new Set();
    }
  }
  
  async saveCheckpoint() {
    await fs.writeFile(
      this.checkpointPath,
      JSON.stringify([...this.processed])
    );
  }
  
  async processBatchWithCheckpoints(items, processor, options = {}) {
    const { batchSize = 10, saveInterval = 100 } = options;
    
    await this.loadCheckpoint();
    
    const remaining = items.filter(item => !this.processed.has(item.id));
    const results = { successful: [], failed: [] };
    let processedCount = 0;
    
    for (let i = 0; i < remaining.length; i += batchSize) {
      const batch = remaining.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(item => processor(item))
      );
      
      batchResults.forEach((result, index) => {
        const item = batch[index];
        
        if (result.status === 'fulfilled') {
          results.successful.push({ item, result: result.value });
          this.processed.add(item.id);
          processedCount++;
        } else {
          results.failed.push({ item, error: result.reason });
        }
      });
      
      // Save checkpoint periodically
      if (processedCount >= saveInterval) {
        await this.saveCheckpoint();
        processedCount = 0;
      }
    }
    
    // Final checkpoint save
    await this.saveCheckpoint();
    
    return results;
  }
  
  async retry() {
    // Load checkpoint and find failed items
    await this.loadCheckpoint();
    const allItems = await this.getAllItems();
    const failed = allItems.filter(item => !this.processed.has(item.id));
    
    return this.processBatchWithCheckpoints(failed, this.processor);
  }
}
```

### Transaction-like Behavior in Batch Operations

#### Two-Phase Commit Pattern
```javascript
class BatchTransaction {
  constructor() {
    this.operations = [];
    this.preparedOps = [];
  }
  
  add(operation, rollback) {
    this.operations.push({ operation, rollback });
  }
  
  async prepare() {
    this.preparedOps = [];
    
    for (const { operation, rollback } of this.operations) {
      try {
        const prepared = await operation.prepare();
        this.preparedOps.push({ 
          operation, 
          rollback, 
          prepared 
        });
      } catch (error) {
        // Rollback any prepared operations
        await this.rollback();
        throw new Error(`Prepare failed: ${error.message}`);
      }
    }
    
    return true;
  }
  
  async commit() {
    const results = [];
    let commitIndex = 0;
    
    try {
      for (const { operation, prepared } of this.preparedOps) {
        const result = await operation.commit(prepared);
        results.push(result);
        commitIndex++;
      }
      
      return results;
    } catch (error) {
      // Partial commit occurred, rollback committed operations
      await this.partialRollback(commitIndex);
      throw new Error(`Commit failed at operation ${commitIndex}: ${error.message}`);
    }
  }
  
  async rollback() {
    const rollbackResults = await Promise.allSettled(
      this.preparedOps.map(({ rollback, prepared }) => 
        rollback(prepared)
      )
    );
    
    const failed = rollbackResults.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      console.error(`${failed.length} rollback operations failed`);
    }
  }
  
  async partialRollback(fromIndex) {
    const toRollback = this.preparedOps.slice(0, fromIndex);
    await Promise.allSettled(
      toRollback.map(({ rollback, prepared }) => 
        rollback(prepared)
      )
    );
  }
  
  async execute() {
    try {
      await this.prepare();
      return await this.commit();
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }
}

// Example usage
const transaction = new BatchTransaction();

// Add file operations
files.forEach(file => {
  transaction.add(
    {
      prepare: async () => {
        const backup = await fs.readFile(file);
        return { file, backup };
      },
      commit: async ({ file }) => {
        await fs.writeFile(file, newContent);
      }
    },
    async ({ file, backup }) => {
      await fs.writeFile(file, backup);
    }
  );
});

await transaction.execute();
```

---

## Testing Best Practices

### Unit Testing Parallel Code

#### Testing Batch Operations
```javascript
describe('BatchProcessor', () => {
  let processor;
  
  beforeEach(() => {
    processor = new BatchProcessor();
  });
  
  it('should process all items successfully', async () => {
    const items = [1, 2, 3, 4, 5];
    const mockProcessor = jest.fn().mockResolvedValue('processed');
    
    const results = await processor.processBatch(items, mockProcessor);
    
    expect(mockProcessor).toHaveBeenCalledTimes(5);
    expect(results.successful).toHaveLength(5);
    expect(results.failed).toHaveLength(0);
  });
  
  it('should handle partial failures', async () => {
    const items = [1, 2, 3, 4, 5];
    const mockProcessor = jest.fn()
      .mockResolvedValueOnce('success')
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('success')
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('success');
    
    const results = await processor.processBatch(items, mockProcessor);
    
    expect(results.successful).toHaveLength(3);
    expect(results.failed).toHaveLength(2);
  });
  
  it('should respect batch size limits', async () => {
    const items = Array(100).fill(0).map((_, i) => i);
    const mockProcessor = jest.fn().mockResolvedValue('processed');
    const concurrentCalls = [];
    
    mockProcessor.mockImplementation(async (item) => {
      const currentCalls = mockProcessor.mock.calls.length;
      concurrentCalls.push(currentCalls);
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'processed';
    });
    
    await processor.processBatch(items, mockProcessor, { batchSize: 5 });
    
    // Check that no more than 5 operations run concurrently
    const maxConcurrent = Math.max(...concurrentCalls);
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });
});
```

#### Testing Race Conditions
```javascript
describe('Concurrent Operations', () => {
  it('should handle concurrent writes safely', async () => {
    const fileManager = new ConcurrentFileManager();
    const filePath = '/tmp/test-file.txt';
    
    // Simulate concurrent writes
    const writes = Array(10).fill(0).map((_, i) => 
      fileManager.atomicWrite(filePath, `content-${i}`)
    );
    
    await Promise.all(writes);
    
    // Verify file exists and has valid content
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toMatch(/content-\d/);
    
    // Verify no temp files left behind
    const tempFiles = await glob(`${filePath}.tmp.*`);
    expect(tempFiles).toHaveLength(0);
  });
  
  it('should prevent data corruption with locks', async () => {
    const lockManager = new FileLockManager();
    const counter = { value: 0 };
    
    // Concurrent increments
    const operations = Array(100).fill(0).map(() => 
      lockManager.withLock('counter', async () => {
        const current = counter.value;
        await new Promise(resolve => setTimeout(resolve, 1));
        counter.value = current + 1;
      })
    );
    
    await Promise.all(operations);
    
    expect(counter.value).toBe(100);
  });
});
```

### Integration Testing Strategies

#### End-to-End Batch Testing
```javascript
describe('Batch Processing Integration', () => {
  let testDir;
  let processor;
  
  beforeEach(async () => {
    testDir = await fs.mkdtemp('/tmp/batch-test-');
    processor = new IntegratedBatchProcessor();
  });
  
  afterEach(async () => {
    await fs.rm(testDir, { recursive: true });
  });
  
  it('should process file batch end-to-end', async () => {
    // Setup test files
    const files = await Promise.all(
      Array(20).fill(0).map(async (_, i) => {
        const path = `${testDir}/file-${i}.txt`;
        await fs.writeFile(path, `content ${i}`);
        return path;
      })
    );
    
    // Process batch
    const results = await processor.processFiles(files, {
      batchSize: 5,
      transform: content => content.toUpperCase()
    });
    
    // Verify results
    expect(results.successful).toHaveLength(20);
    
    // Verify files were transformed
    for (let i = 0; i < 20; i++) {
      const content = await fs.readFile(`${testDir}/file-${i}.txt`, 'utf8');
      expect(content).toBe(`CONTENT ${i}`);
    }
  });
  
  it('should recover from partial failures', async () => {
    const checkpointPath = `${testDir}/checkpoint.json`;
    const processor = new CheckpointBatchProcessor(checkpointPath);
    
    // Create files, some will fail
    const files = await Promise.all(
      Array(10).fill(0).map(async (_, i) => {
        const path = `${testDir}/file-${i}.txt`;
        // Make some files unreadable
        if (i % 3 === 0) {
          await fs.writeFile(path, 'content');
          await fs.chmod(path, 0o000);
        } else {
          await fs.writeFile(path, `content ${i}`);
        }
        return { id: `file-${i}`, path };
      })
    );
    
    // First run - will have failures
    const firstRun = await processor.processBatchWithCheckpoints(
      files,
      async (file) => {
        const content = await fs.readFile(file.path, 'utf8');
        return content.toUpperCase();
      }
    );
    
    expect(firstRun.failed.length).toBeGreaterThan(0);
    
    // Fix permissions
    for (let i = 0; i < 10; i += 3) {
      await fs.chmod(`${testDir}/file-${i}.txt`, 0o644);
    }
    
    // Retry - should only process failed items
    const retry = await processor.retry();
    expect(retry.successful.length).toBe(firstRun.failed.length);
  });
});
```

### Performance Testing Guidelines

#### Load Testing Batch Operations
```javascript
class BatchLoadTester {
  constructor() {
    this.metrics = [];
  }
  
  async runLoadTest(config) {
    const { 
      itemCount, 
      batchSizes, 
      processor, 
      warmupRuns = 3,
      testRuns = 10 
    } = config;
    
    const items = Array(itemCount).fill(0).map((_, i) => ({
      id: i,
      data: `test-data-${i}`
    }));
    
    const results = {};
    
    for (const batchSize of batchSizes) {
      console.log(`Testing batch size: ${batchSize}`);
      
      // Warmup runs
      for (let i = 0; i < warmupRuns; i++) {
        await this.runBatch(items, processor, batchSize);
      }
      
      // Test runs
      const runMetrics = [];
      for (let i = 0; i < testRuns; i++) {
        const metrics = await this.runBatch(items, processor, batchSize);
        runMetrics.push(metrics);
      }
      
      results[batchSize] = this.analyzeMetrics(runMetrics);
    }
    
    return results;
  }
  
  async runBatch(items, processor, batchSize) {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    
    const batchProcessor = new BatchProcessor({ batchSize });
    const results = await batchProcessor.processBatch(items, processor);
    
    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    
    return {
      duration: endTime - startTime,
      throughput: items.length / ((endTime - startTime) / 1000),
      memoryDelta: endMemory.heapUsed - startMemory.heapUsed,
      successRate: results.successful.length / items.length,
      batchSize
    };
  }
  
  analyzeMetrics(metrics) {
    const durations = metrics.map(m => m.duration);
    const throughputs = metrics.map(m => m.throughput);
    const memoryDeltas = metrics.map(m => m.memoryDelta);
    
    return {
      avgDuration: durations.reduce((a, b) => a + b) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      avgThroughput: throughputs.reduce((a, b) => a + b) / throughputs.length,
      avgMemoryDelta: memoryDeltas.reduce((a, b) => a + b) / memoryDeltas.length,
      successRate: metrics[0].successRate
    };
  }
}

// Example usage
const tester = new BatchLoadTester();
const results = await tester.runLoadTest({
  itemCount: 10000,
  batchSizes: [1, 5, 10, 20, 50, 100],
  processor: async (item) => {
    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 10));
    return item.data.toUpperCase();
  }
});

console.log('Optimal batch size:', 
  Object.entries(results)
    .sort(([,a], [,b]) => b.avgThroughput - a.avgThroughput)[0][0]
);
```

### Debugging Batch Operations

#### Batch Operation Debugger
```javascript
class BatchDebugger {
  constructor(options = {}) {
    this.enableBreakpoints = options.enableBreakpoints || false;
    this.logLevel = options.logLevel || 'info';
    this.traces = [];
  }
  
  async debugBatch(items, processor, options = {}) {
    const { batchSize = 5, breakOn = [] } = options;
    const results = { successful: [], failed: [] };
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchId = `batch-${i / batchSize}`;
      
      this.log('info', `Processing ${batchId} with ${batch.length} items`);
      
      // Check for breakpoint
      if (this.enableBreakpoints && breakOn.includes(batchId)) {
        await this.breakpoint(batchId, batch);
      }
      
      const batchResults = await this.processBatchWithTrace(
        batch, 
        processor, 
        batchId
      );
      
      // Collect results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.successful.push(result.value);
        } else {
          results.failed.push({
            item: batch[index],
            error: result.reason,
            trace: this.traces.find(t => t.itemId === batch[index].id)
          });
        }
      });
    }
    
    return results;
  }
  
  async processBatchWithTrace(batch, processor, batchId) {
    return Promise.allSettled(
      batch.map(async (item) => {
        const trace = {
          itemId: item.id,
          batchId,
          startTime: Date.now(),
          steps: []
        };
        
        try {
          const instrumentedProcessor = this.instrumentProcessor(processor, trace);
          const result = await instrumentedProcessor(item);
          
          trace.endTime = Date.now();
          trace.duration = trace.endTime - trace.startTime;
          trace.status = 'success';
          trace.result = result;
          
          this.traces.push(trace);
          return result;
        } catch (error) {
          trace.endTime = Date.now();
          trace.duration = trace.endTime - trace.startTime;
          trace.status = 'error';
          trace.error = {
            message: error.message,
            stack: error.stack
          };
          
          this.traces.push(trace);
          throw error;
        }
      })
    );
  }
  
  instrumentProcessor(processor, trace) {
    return new Proxy(processor, {
      apply: async (target, thisArg, args) => {
        trace.steps.push({
          type: 'function-call',
          timestamp: Date.now(),
          args: args.map(arg => this.sanitizeForLog(arg))
        });
        
        try {
          const result = await target.apply(thisArg, args);
          trace.steps.push({
            type: 'function-return',
            timestamp: Date.now(),
            result: this.sanitizeForLog(result)
          });
          return result;
        } catch (error) {
          trace.steps.push({
            type: 'function-error',
            timestamp: Date.now(),
            error: error.message
          });
          throw error;
        }
      }
    });
  }
  
  sanitizeForLog(value) {
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value).substring(0, 100) + '...';
    }
    return value;
  }
  
  async breakpoint(batchId, batch) {
    console.log(`\nBREAKPOINT: ${batchId}`);
    console.log('Batch items:', batch);
    console.log('Press any key to continue...');
    
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
  }
  
  log(level, message) {
    const levels = ['debug', 'info', 'warn', 'error'];
    if (levels.indexOf(level) >= levels.indexOf(this.logLevel)) {
      console.log(`[${level.toUpperCase()}] ${message}`);
    }
  }
  
  getTraceReport() {
    const report = {
      totalTraces: this.traces.length,
      successful: this.traces.filter(t => t.status === 'success').length,
      failed: this.traces.filter(t => t.status === 'error').length,
      avgDuration: this.traces.reduce((sum, t) => sum + t.duration, 0) / this.traces.length,
      slowestItems: this.traces
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 5)
        .map(t => ({
          itemId: t.itemId,
          duration: t.duration,
          stepCount: t.steps.length
        }))
    };
    
    return report;
  }
}
```

---

## Team Collaboration

### Code Review Guidelines for Batch Operations

#### Batch Operation Code Review Checklist

```markdown
## Batch Operation Review Checklist

### Architecture & Design
- [ ] Is batch processing the right approach for this use case?
- [ ] Are batch sizes appropriately configured?
- [ ] Is there proper resource management (memory, file handles, connections)?
- [ ] Are dependencies between operations properly handled?

### Error Handling
- [ ] Are all Promise.all replaced with Promise.allSettled where appropriate?
- [ ] Is there proper error aggregation and reporting?
- [ ] Can the operation recover from partial failures?
- [ ] Are errors properly typed and descriptive?

### Performance
- [ ] Has the batch size been tested for optimal performance?
- [ ] Is there proper backpressure handling?
- [ ] Are resources pooled appropriately?
- [ ] Has memory usage been profiled?

### Security
- [ ] Are file operations atomic where necessary?
- [ ] Is there proper access control for parallel operations?
- [ ] Are credentials handled securely in batch contexts?
- [ ] Is there audit logging for sensitive operations?

### Testing
- [ ] Are there unit tests for both success and failure cases?
- [ ] Has concurrent operation been tested?
- [ ] Are there integration tests for the full workflow?
- [ ] Has performance been benchmarked?

### Documentation
- [ ] Is the batch operation's purpose clearly documented?
- [ ] Are configuration options explained?
- [ ] Are error scenarios documented?
- [ ] Is there a runbook for operations?
```

### Documentation Standards

#### Batch Operation Documentation Template

```javascript
/**
 * Processes multiple files in parallel batches with automatic retry and checkpointing.
 * 
 * @description
 * This function handles large-scale file processing with the following features:
 * - Automatic batching to prevent resource exhaustion
 * - Checkpoint/resume capability for long-running operations
 * - Exponential backoff retry for transient failures
 * - Comprehensive error reporting and audit logging
 * 
 * @param {Array<FileItem>} files - Array of file items to process
 * @param {ProcessorFunction} processor - Function to process each file
 * @param {BatchOptions} options - Configuration options
 * 
 * @param {number} [options.batchSize=10] - Number of files to process concurrently
 * @param {number} [options.maxRetries=3] - Maximum retry attempts per file
 * @param {string} [options.checkpointPath] - Path to store checkpoint data
 * @param {boolean} [options.continueOnError=true] - Whether to continue processing on errors
 * 
 * @returns {Promise<BatchResult>} Results including successful and failed operations
 * 
 * @example
 * const results = await batchProcessFiles(files, compressFile, {
 *   batchSize: 5,
 *   maxRetries: 3,
 *   checkpointPath: './checkpoint.json'
 * });
 * 
 * @throws {BatchProcessError} When all retries are exhausted
 * @throws {CheckpointError} When checkpoint operations fail
 * 
 * @performance
 * - Memory: O(batchSize) - Only holds active batch in memory
 * - Time: O(n/batchSize) - Processes in parallel batches
 * - Optimal batch size: 2 * CPU cores for CPU-bound, 10-20 for I/O-bound
 * 
 * @since 2.0.0
 */
async function batchProcessFiles(files, processor, options = {}) {
  // Implementation
}
```

### Version Control Best Practices

#### Commit Message Format for Batch Operations

```
<type>(<scope>): <subject>

<body>

<footer>

Types:
- feat: New batch operation feature
- fix: Bug fix in batch processing
- perf: Performance improvement
- refactor: Code restructuring
- test: Test additions/modifications
- docs: Documentation updates

Example:
feat(batch): Add adaptive batch sizing for file operations

- Implement dynamic batch size adjustment based on performance metrics
- Add memory pressure detection to prevent OOM errors
- Include circuit breaker for failing operations
- Batch size now adjusts between 1-20 based on throughput

Performance impact:
- 40% improvement in large file batch processing
- Reduced memory usage by 60% under load
- Better handling of mixed file sizes

Closes #123
```

### Knowledge Sharing Strategies

#### Batch Operations Runbook Template

```markdown
# Batch Operation Runbook: [Operation Name]

## Overview
Brief description of what this batch operation does and when to use it.

## Prerequisites
- Required permissions
- System requirements
- Dependencies

## Configuration
```yaml
batchSize: 10          # Optimal for standard workload
maxRetries: 3          # Handles transient failures
timeout: 300000        # 5 minutes per batch
checkpointEnabled: true
```

## Normal Operation

### Starting the Process
```bash
npm run batch:process -- --config=production.json
```

### Monitoring
- Check logs at: `/var/log/batch-processor/`
- Metrics dashboard: `http://metrics.internal/batch-ops`
- Key metrics to watch:
  - Throughput (items/second)
  - Error rate (should be < 1%)
  - Memory usage (should be < 80%)

## Troubleshooting

### Common Issues

#### High Error Rate
1. Check recent changes to data format
2. Verify external service availability
3. Review error logs for patterns

#### Performance Degradation
1. Check batch size configuration
2. Monitor resource utilization
3. Look for lock contention

#### Memory Issues
1. Reduce batch size
2. Enable streaming mode
3. Check for memory leaks

### Recovery Procedures

#### From Checkpoint
```bash
npm run batch:resume -- --checkpoint=./checkpoint.json
```

#### Manual Retry
```bash
npm run batch:retry -- --failed-items=./failed.json
```

## Escalation
- Primary: @batch-ops-team
- Secondary: @platform-team
- Emergency: PagerDuty rotation
```

---

## Tool-Specific Guidelines

### File Operations (Read, Write, Edit)

#### Batch Read Operations
```javascript
// Best Practice: Controlled parallel reads with resource limits
async function batchReadFiles(filePaths, options = {}) {
  const { batchSize = 5, encoding = 'utf8' } = options;
  const fileHandles = new Map();
  
  try {
    const results = [];
    
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (filePath) => {
          const handle = await fs.open(filePath, 'r');
          fileHandles.set(filePath, handle);
          
          const content = await handle.readFile({ encoding });
          
          handle.close();
          fileHandles.delete(filePath);
          
          return { filePath, content };
        })
      );
      
      results.push(...batchResults);
    }
    
    return results;
  } finally {
    // Ensure all handles are closed
    for (const handle of fileHandles.values()) {
      await handle.close().catch(() => {});
    }
  }
}
```

#### Batch Write Operations
```javascript
// Best Practice: Atomic writes with rollback capability
async function batchWriteFiles(fileWrites, options = {}) {
  const { batchSize = 3, atomic = true } = options;
  const tempFiles = [];
  
  try {
    // Write to temp files first
    for (let i = 0; i < fileWrites.length; i += batchSize) {
      const batch = fileWrites.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async ({ path, content }) => {
          const tempPath = `${path}.tmp.${Date.now()}`;
          tempFiles.push({ temp: tempPath, final: path });
          
          await fs.writeFile(tempPath, content, { flag: 'wx' });
        })
      );
    }
    
    // Atomic rename all at once
    if (atomic) {
      await Promise.all(
        tempFiles.map(({ temp, final }) => fs.rename(temp, final))
      );
    }
    
    return { success: true, count: fileWrites.length };
  } catch (error) {
    // Cleanup temp files on error
    await Promise.allSettled(
      tempFiles.map(({ temp }) => fs.unlink(temp))
    );
    throw error;
  }
}
```

### Search Operations (Grep, Glob)

#### Batch Grep Operations
```javascript
// Best Practice: Parallel search with result streaming
async function batchGrep(pattern, directories, options = {}) {
  const { 
    batchSize = 10, 
    filePattern = '*', 
    maxResults = 1000 
  } = options;
  
  const results = [];
  let resultCount = 0;
  
  for (let i = 0; i < directories.length; i += batchSize) {
    const batch = directories.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (dir) => {
      const files = await glob(`${dir}/**/${filePattern}`);
      const dirResults = [];
      
      for (const file of files) {
        if (resultCount >= maxResults) break;
        
        const matches = await grepFile(file, pattern);
        if (matches.length > 0) {
          dirResults.push({ file, matches });
          resultCount += matches.length;
        }
      }
      
      return dirResults;
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        results.push(...result.value);
      }
    });
    
    if (resultCount >= maxResults) break;
  }
  
  return results;
}
```

### Task Management

#### Batch Task Execution
```javascript
// Best Practice: Priority-based task queue with concurrency control
class BatchTaskManager {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 5;
    this.queue = [];
    this.active = new Set();
    this.completed = new Map();
  }
  
  addTask(task, priority = 0) {
    this.queue.push({ task, priority, id: Date.now() });
    this.queue.sort((a, b) => b.priority - a.priority);
    this.processQueue();
  }
  
  async processQueue() {
    while (this.queue.length > 0 && this.active.size < this.concurrency) {
      const { task, id } = this.queue.shift();
      
      this.active.add(id);
      
      this.executeTask(task, id)
        .then(result => {
          this.completed.set(id, { status: 'success', result });
        })
        .catch(error => {
          this.completed.set(id, { status: 'error', error });
        })
        .finally(() => {
          this.active.delete(id);
          this.processQueue();
        });
    }
  }
  
  async executeTask(task, id) {
    const startTime = Date.now();
    
    try {
      const result = await task();
      const duration = Date.now() - startTime;
      
      console.log(`Task ${id} completed in ${duration}ms`);
      
      return result;
    } catch (error) {
      console.error(`Task ${id} failed:`, error.message);
      throw error;
    }
  }
  
  async waitForAll() {
    while (this.active.size > 0 || this.queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return this.completed;
  }
}
```

### Memory Operations

#### Batch Memory Operations
```javascript
// Best Practice: Memory-aware batch processing with garbage collection
class MemoryAwareBatchProcessor {
  constructor(options = {}) {
    this.memoryThreshold = options.memoryThreshold || 0.8; // 80% of available memory
    this.gcThreshold = options.gcThreshold || 100 * 1024 * 1024; // 100MB
  }
  
  async processBatch(items, processor) {
    const results = [];
    let processedCount = 0;
    let lastGC = Date.now();
    
    for (const item of items) {
      // Check memory before processing
      const memUsage = process.memoryUsage();
      const memPercent = memUsage.heapUsed / memUsage.heapTotal;
      
      if (memPercent > this.memoryThreshold) {
        console.warn('Memory threshold reached, triggering GC');
        if (global.gc) {
          global.gc();
        }
        
        // Wait for memory to be freed
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Process item
      try {
        const result = await processor(item);
        results.push({ status: 'success', result });
      } catch (error) {
        results.push({ status: 'error', error });
      }
      
      processedCount++;
      
      // Periodic garbage collection
      if (Date.now() - lastGC > 30000) { // Every 30 seconds
        if (global.gc && memUsage.heapUsed > this.gcThreshold) {
          global.gc();
          lastGC = Date.now();
        }
      }
      
      // Yield to event loop periodically
      if (processedCount % 100 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    
    return results;
  }
}
```

## Practical Checklists

### Pre-Implementation Checklist
- [ ] Determine if batch processing is appropriate
- [ ] Estimate resource requirements
- [ ] Design error handling strategy
- [ ] Plan monitoring and logging
- [ ] Consider security implications
- [ ] Define success metrics

### Implementation Checklist
- [ ] Use Promise.allSettled for partial failure handling
- [ ] Implement proper resource cleanup
- [ ] Add comprehensive logging
- [ ] Include performance metrics
- [ ] Write unit and integration tests
- [ ] Document configuration options

### Deployment Checklist
- [ ] Load test with realistic data
- [ ] Configure monitoring alerts
- [ ] Create runbook documentation
- [ ] Set up error tracking
- [ ] Plan rollback strategy
- [ ] Train operations team

### Post-Deployment Checklist
- [ ] Monitor performance metrics
- [ ] Review error rates
- [ ] Gather user feedback
- [ ] Update documentation
- [ ] Plan optimizations
- [ ] Share learnings with team

---

## Conclusion

Batch operations are powerful tools for handling large-scale data processing, but they require careful design and implementation. By following these best practices, you can build robust, performant, and maintainable batch processing systems that scale with your needs.

Remember:
- Start simple and iterate
- Measure everything
- Plan for failure
- Document thoroughly
- Share knowledge with your team

For questions or contributions to this guide, please contact the platform team or submit a pull request to the documentation repository.