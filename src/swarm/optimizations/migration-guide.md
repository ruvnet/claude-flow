# Swarm Optimization Migration Guide

## Overview

This guide helps you migrate the existing swarm system to use the new optimizations, achieving the targeted 2.5x performance improvement.

## Phase 1: Quick Wins (Week 1)

### 1. Replace Synchronous Execution

**Before:**
```typescript
// In SwarmExecutor
async executeTask(task: Task) {
  const result = await claudeAPI.call(task);  // Blocking
  await fs.writeFile(outputPath, result);     // Blocking
  return result;
}
```

**After:**
```typescript
// Import optimizations
import { OptimizedExecutor } from './optimizations/index.ts';

// Initialize once
const executor = new OptimizedExecutor({
  connectionPool: { min: 2, max: 10 },
  concurrency: 10,
  caching: { enabled: true, ttl: 3600000 },
  fileOperations: { outputDir: './outputs' }
});

// Use in SwarmExecutor
async executeTask(task: TaskDefinition, agentId: AgentId) {
  return await executor.executeTask(task, agentId);
}
```

### 2. Fix Memory Leaks

**Before:**
```typescript
// In SwarmCoordinator
private eventHistory: Event[] = [];  // Unbounded
private taskStates: Map<string, TaskState> = new Map();  // Never cleaned

handleEvent(event: Event) {
  this.eventHistory.push(event);  // Memory leak
}
```

**After:**
```typescript
import { CircularBuffer, TTLMap } from './optimizations/index.ts';

// In SwarmCoordinator
private eventHistory = new CircularBuffer<SwarmEvent>(1000);  // Max 1000 events
private taskStates = new TTLMap<string, TaskDefinition>({ 
  defaultTTL: 3600000,  // 1 hour TTL
  maxSize: 10000        // Max 10k tasks
});

handleEvent(event: SwarmEvent) {
  this.eventHistory.push(event);  // Automatic rotation
}

// For task cleanup
completeTask(taskId: string) {
  // Task will auto-expire from TTLMap after 1 hour
  const task = this.taskStates.get(taskId);
  if (task) {
    task.status = 'completed';
    // No need to manually delete - TTL handles it
  }
}
```

### 3. Update File Operations

**Before:**
```typescript
import { promises as fs } from 'fs';

async saveResult(path: string, data: any) {
  await fs.writeFile(path, JSON.stringify(data));
}
```

**After:**
```typescript
import { AsyncFileManager } from './optimizations/index.ts';

const fileManager = new AsyncFileManager();

async saveResult(path: string, data: any) {
  await fileManager.writeJSON(path, data);  // Non-blocking with queue
}
```

## Phase 2: Agent Selection Optimization

### Current O(n²) Selection
```typescript
// In SwarmCoordinator
private selectAgent(task: TaskDefinition): AgentState | null {
  for (const agent of this.agents.values()) {
    for (const capability of agent.capabilities) {
      if (task.requirements?.includes(capability)) {
        return agent;
      }
    }
  }
  return null;
}
```

### Optimized O(1) Selection
```typescript
// Add to SwarmCoordinator
private agentCapabilityIndex = new Map<string, Set<string>>();  // capability -> agent IDs
private agentSelectionCache = new TTLMap<string, string>({ maxSize: 1000 });

// Build index when agents are added
private indexAgent(agent: AgentState) {
  for (const capability of agent.capabilities) {
    if (!this.agentCapabilityIndex.has(capability)) {
      this.agentCapabilityIndex.set(capability, new Set());
    }
    this.agentCapabilityIndex.get(capability)!.add(agent.id.id);
  }
}

// Optimized selection
private selectAgent(task: TaskDefinition): AgentState | null {
  const cacheKey = `${task.type}-${task.requirements?.join(',')}`;
  
  // Check cache
  const cachedAgentId = this.agentSelectionCache.get(cacheKey);
  if (cachedAgentId) {
    const agent = this.agents.get(cachedAgentId);
    if (agent?.status === 'idle') return agent;
  }
  
  // Find eligible agents using index
  if (!task.requirements?.length) return null;
  
  const eligibleAgentIds = new Set<string>();
  for (const requirement of task.requirements) {
    const agentsWithCapability = this.agentCapabilityIndex.get(requirement);
    if (!agentsWithCapability) return null;
    
    if (eligibleAgentIds.size === 0) {
      agentsWithCapability.forEach(id => eligibleAgentIds.add(id));
    } else {
      // Keep only agents that have all requirements
      for (const id of eligibleAgentIds) {
        if (!agentsWithCapability.has(id)) {
          eligibleAgentIds.delete(id);
        }
      }
    }
  }
  
  // Select best available agent
  for (const agentId of eligibleAgentIds) {
    const agent = this.agents.get(agentId);
    if (agent?.status === 'idle') {
      this.agentSelectionCache.set(cacheKey, agentId);
      return agent;
    }
  }
  
  return null;
}
```

## Integration Points

### 1. Update SwarmCoordinator Constructor
```typescript
constructor(config: Partial<SwarmConfig> = {}) {
  super();
  
  // ... existing initialization ...
  
  // Initialize optimizations
  this.initializeOptimizations();
}

private initializeOptimizations() {
  // Create optimized executor
  this.optimizedExecutor = new OptimizedExecutor({
    connectionPool: { 
      min: this.config.performance?.minConnections || 2,
      max: this.config.performance?.maxConnections || 10
    },
    concurrency: this.config.performance?.maxConcurrentTasks || 10,
    caching: {
      enabled: this.config.performance?.enableCaching ?? true,
      ttl: this.config.performance?.cacheTTL || 3600000
    }
  });
  
  // Set up memory management
  this.events = new CircularBuffer(1000);
  this.tasks = new TTLMap({ defaultTTL: 3600000, maxSize: 10000 });
}
```

### 2. Update Task Execution
```typescript
async executeTask(taskId: string): Promise<void> {
  const task = this.tasks.get(taskId);
  if (!task || !task.assignedTo) return;
  
  const agent = this.agents.get(task.assignedTo.id);
  if (!agent) return;
  
  try {
    // Use optimized executor
    const result = await this.optimizedExecutor.executeTask(task, agent.id);
    
    // Update task with result
    task.result = result;
    task.status = 'completed';
    
    // Emit completion event
    this.emitSwarmEvent({
      type: 'task.completed',
      data: { task, result }
    });
  } catch (error) {
    // Handle error...
  }
}
```

## Performance Monitoring

Add metrics collection:

```typescript
// In SwarmCoordinator
getPerformanceMetrics() {
  return {
    executor: this.optimizedExecutor.getMetrics(),
    connectionPool: this.optimizedExecutor.getConnectionPoolStats(),
    fileManager: this.optimizedExecutor.getFileManagerMetrics(),
    cache: this.optimizedExecutor.getCacheStats(),
    memory: {
      eventBufferSize: this.eventHistory.getSize(),
      taskMapSize: this.tasks.size,
      agentCount: this.agents.size
    }
  };
}
```

## Testing the Migration

1. **Unit Tests**: Update existing tests to work with async operations
2. **Integration Tests**: Test the full optimized flow
3. **Performance Tests**: Measure improvements
4. **Memory Tests**: Verify bounded memory usage

## Rollback Plan

If issues occur, you can disable optimizations with feature flags:

```typescript
const USE_OPTIMIZATIONS = process.env.SWARM_USE_OPTIMIZATIONS !== 'false';

if (USE_OPTIMIZATIONS) {
  this.executor = new OptimizedExecutor(config);
} else {
  this.executor = new LegacyExecutor(config);
}
```

## Next Steps

After Phase 1 implementation:
1. Monitor metrics for 24-48 hours
2. Verify 50% performance improvement
3. Check memory usage is bounded
4. Proceed to Phase 2 (Event-driven architecture)