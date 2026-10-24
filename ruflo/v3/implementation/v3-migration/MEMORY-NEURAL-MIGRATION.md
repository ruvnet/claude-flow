# Memory & Neural System Migration Guide

> Migrating from V2 Memory/Neural to V3 Enhanced Systems

## Overview

V3 significantly enhances both memory and neural systems:
- **Memory**: +6 new features (20 total vs 14)
- **Neural**: +11 new features (14 total vs 3)

## Memory System Comparison

### V2 Memory Architecture
```
v2/src/memory/
├── backends/
│   ├── base.ts          # IMemoryBackend interface
│   ├── sqlite.ts        # SQLite backend
│   └── markdown.ts      # Markdown backend
├── manager.ts           # Memory Manager
├── advanced-memory-manager.ts
├── indexer.ts           # Search indexing
├── cache.ts             # LRU cache
├── swarm-memory.ts      # Multi-agent memory
└── distributed-memory.ts # CRDT sync
```

### V3 Memory Architecture
```
v3/@claude-flow/memory/
├── src/
│   ├── types.ts              # Type definitions
│   ├── index.ts              # UnifiedMemoryService
│   ├── sqlite-backend.ts     # SQLite (secured)
│   ├── sqljs-backend.ts      # WASM SQLite (NEW)
│   ├── agentdb-backend.ts    # AgentDB (NEW)
│   ├── hybrid-backend.ts     # SQLite+AgentDB (NEW)
│   ├── database-provider.ts  # Cross-platform (NEW)
│   ├── hnsw-index.ts         # HNSW vector index (NEW)
│   ├── cache-manager.ts      # Enhanced cache
│   ├── query-builder.ts      # Fluent queries (NEW)
│   ├── migration.ts          # Data migration (NEW)
│   ├── agentdb-adapter.ts    # AgentDB adapter
│   └── domain/               # DDD structure (NEW)
│       ├── entities/
│       ├── repositories/
│       └── services/
```

## Memory Feature Migration

### Implemented in V3 ✅

| V2 Feature | V3 Equivalent | Enhancement |
|------------|---------------|-------------|
| SQLite Backend | `sqlite-backend.ts` | SQL injection protection |
| Memory Manager | `UnifiedMemoryService` | DDD architecture |
| Indexer | `hnsw-index.ts` | 150x-12,500x faster |
| Cache | `cache-manager.ts` | TTL, importance-based eviction |
| Swarm Memory | `shareWith()/getSharedWith()` | Simplified API |

### New in V3 ✅

| Feature | File | Description |
|---------|------|-------------|
| **HNSW Index** | `hnsw-index.ts` | Approximate nearest neighbor search |
| **AgentDB Backend** | `agentdb-backend.ts` | Native vector database |
| **Hybrid Backend** | `hybrid-backend.ts` | SQLite + AgentDB combo |
| **SQL.js Backend** | `sqljs-backend.ts` | WASM for cross-platform |
| **Database Provider** | `database-provider.ts` | Auto-selects best backend |
| **Query Builder** | `query-builder.ts` | Fluent API for queries |
| **Quantization** | `hnsw-index.ts` | 4-32x memory reduction |
| **DDD Domain** | `domain/` | Clean architecture |

### Missing in V3 ❌

| V2 Feature | Priority | Migration Path |
|------------|----------|----------------|
| **Markdown Backend** | LOW | Optional human-readable export |
| **Distributed Memory** | MEDIUM | Add CRDT sync for multi-node |

## Memory Migration Code

### Backend Migration

```typescript
// V2: Initialize memory
import { MemoryManager } from 'claude-flow/memory';
const memory = new MemoryManager({
  backend: 'sqlite',
  path: './.claude-flow/memory.db'
});

// V3: Initialize memory
import { UnifiedMemoryService } from '@claude-flow/memory';
const memory = new UnifiedMemoryService({
  backend: 'hybrid',  // SQLite + AgentDB
  sqlite: {
    path: './.claude-flow/memory.db'
  },
  agentdb: {
    enableHNSW: true,
    dimensions: 384
  }
});
await memory.initialize();
```

### Store Migration

```typescript
// V2: Store entry
await memory.store({
  namespace: 'default',
  sessionId: 'session-1',
  agentId: 'agent-1',
  type: 'observation',
  content: 'User requested feature X',
  tags: ['feature', 'request'],
  metadata: { priority: 'high' }
});

// V3: Store entry (enhanced)
await memory.store({
  content: 'User requested feature X',
  type: 'episodic',
  category: 'observations',
  tags: ['feature', 'request'],
  metadata: {
    priority: 'high',
    sessionId: 'session-1',
    agentId: 'agent-1'
  },
  importance: 0.8,
  ttl: 86400000  // 24 hours
});
```

### Query Migration

```typescript
// V2: Query entries
const results = await memory.query({
  namespace: 'default',
  search: 'feature request',
  type: 'observation',
  limit: 10
});

// V3: Query entries (enhanced with semantic search)
const results = await memory.search({
  query: 'feature request',
  searchType: 'hybrid',  // semantic + keyword
  type: 'episodic',
  limit: 10,
  minRelevance: 0.7
});

// V3: Fluent query builder
import { QueryBuilder } from '@claude-flow/memory';
const results = await new QueryBuilder(memory)
  .semantic('feature request')
  .type('episodic')
  .tags(['feature'])
  .minRelevance(0.7)
  .limit(10)
  .execute();
```

### Vector Search (V3 Only)

```typescript
// V3: HNSW vector search
import { HNSWIndex } from '@claude-flow/memory';

const index = new HNSWIndex({
  dimensions: 384,
  maxElements: 100000,
  efConstruction: 200,
  M: 16
});

// Add vectors
await index.add(vectorId, embedding);

// Search
const results = await index.search(queryEmbedding, k: 10);
// Returns: [{ id, distance, similarity }]
```

### Data Migration Script

```typescript
// Migrate V2 data to V3
import { migrateMemoryData } from '@claude-flow/memory/migration';

await migrateMemoryData({
  source: {
    type: 'v2-sqlite',
    path: './.claude-flow/memory.db'
  },
  target: {
    type: 'v3-hybrid',
    sqlitePath: './.claude-flow/v3-memory.db',
    agentdbPath: './.claude-flow/v3-vectors'
  },
  options: {
    generateEmbeddings: true,
    preserveTimestamps: true,
    batchSize: 1000
  }
});
```

## Neural System Comparison

### V2 Neural Architecture
```
v2/src/
├── neural/
│   ├── NeuralDomainMapper.ts  # GNN domain mapping
│   └── integration.ts         # Hooks integration
├── services/agentic-flow-hooks/
│   └── neural-hooks.ts        # Training hooks
└── reasoningbank/
    └── reasoningbank-adapter.js  # Via agentic-flow
```

### V3 Neural Architecture
```
v3/@claude-flow/neural/
├── src/
│   ├── index.ts              # NeuralLearningSystem
│   ├── sona-manager.ts       # SONA modes
│   ├── sona-integration.ts   # @ruvector/sona
│   ├── reasoning-bank.ts     # Native ReasoningBank
│   ├── pattern-learner.ts    # Pattern extraction
│   ├── types.ts
│   ├── algorithms/           # RL algorithms
│   │   ├── ppo.ts
│   │   ├── dqn.ts
│   │   ├── a2c.ts
│   │   ├── decision-transformer.ts
│   │   ├── q-learning.ts
│   │   ├── sarsa.ts
│   │   └── curiosity.ts
│   ├── modes/                # Learning modes
│   │   ├── real-time.ts
│   │   ├── balanced.ts
│   │   ├── research.ts
│   │   ├── edge.ts
│   │   └── batch.ts
│   └── domain/               # DDD structure
│       ├── entities/
│       └── services/
```

## Neural Feature Migration

### V2 Features

| Feature | File | Status in V3 |
|---------|------|--------------|
| Neural Domain Mapper | `NeuralDomainMapper.ts` | ⚠️ Partial (pattern-learner) |
| Neural Hooks | `neural-hooks.ts` | ✅ `sona-manager.ts` |
| ReasoningBank Adapter | `reasoningbank-adapter.js` | ✅ Native `reasoning-bank.ts` |

### V3 New Features ✅

| Feature | File | Description |
|---------|------|-------------|
| **SONA Manager** | `sona-manager.ts` | 5 learning modes |
| **Learning Modes** | `modes/*.ts` | Real-time, Balanced, Research, Edge, Batch |
| **Native ReasoningBank** | `reasoning-bank.ts` | 4-step pipeline |
| **Pattern Learner** | `pattern-learner.ts` | Trajectory extraction |
| **PPO Algorithm** | `algorithms/ppo.ts` | Proximal Policy Optimization |
| **DQN Algorithm** | `algorithms/dqn.ts` | Deep Q-Network |
| **A2C Algorithm** | `algorithms/a2c.ts` | Advantage Actor-Critic |
| **Decision Transformer** | `algorithms/decision-transformer.ts` | Transformer RL |
| **Q-Learning** | `algorithms/q-learning.ts` | Classic Q-Learning |
| **SARSA** | `algorithms/sarsa.ts` | On-policy TD |
| **Curiosity Module** | `algorithms/curiosity.ts` | Intrinsic motivation |
| **LoRA Weights** | `sona-manager.ts` | Low-rank adaptation |
| **EWC** | `sona-manager.ts` | Elastic weight consolidation |

## Neural Migration Code

### Initialize Neural System

```typescript
// V2: Neural integration
import { NeuralDomainMapper } from 'claude-flow/neural';
import { registerNeuralHooks } from 'claude-flow/neural/integration';

const mapper = new NeuralDomainMapper();
registerNeuralHooks(mapper);

// V3: Neural learning system
import { NeuralLearningSystem } from '@claude-flow/neural';

const neural = new NeuralLearningSystem({
  mode: 'balanced',  // real-time | balanced | research | edge | batch
  reasoningBank: {
    maxPatterns: 10000,
    retrievalK: 5
  },
  sona: {
    enableLoRA: true,
    enableEWC: true
  }
});
await neural.initialize();
```

### Pattern Learning

```typescript
// V2: Train patterns
await mapper.train(domainGraph, {
  optimizer: 'adam',
  learningRate: 0.001,
  epochs: 100
});

// V3: Learn from trajectories
const trajectory = neural.startTrajectory('implement-feature');
trajectory.addStep({
  action: 'analyze',
  context: { files: ['src/app.ts'] },
  result: { success: true }
});
trajectory.addStep({
  action: 'implement',
  context: { changes: 5 },
  result: { success: true }
});
await trajectory.complete({ quality: 0.9 });

// Patterns automatically extracted and stored
```

### ReasoningBank

```typescript
// V2: Via agentic-flow adapter
import { ReasoningBankAdapter } from 'claude-flow/reasoningbank';
const rb = new ReasoningBankAdapter();
await rb.store(memory);
const patterns = await rb.retrieve(query);

// V3: Native implementation
import { ReasoningBank } from '@claude-flow/neural';

const rb = new ReasoningBank({
  memory: agentDbBackend,  // Uses AgentDB for 150x faster search
  maxPatterns: 10000
});

// Store trajectory
await rb.store(trajectory);

// 4-step pipeline
const patterns = await rb.retrieve(query, { k: 5 });  // RETRIEVE
const judged = await rb.judge(trajectory);            // JUDGE
const distilled = await rb.distill(trajectories);     // DISTILL
await rb.consolidate();                               // CONSOLIDATE
```

### SONA Learning Modes

```typescript
// V3 only: Configure learning modes
import { SONAManager, LearningMode } from '@claude-flow/neural';

const sona = new SONAManager();

// Real-time mode: 2200 ops/sec, micro-LoRA
sona.setMode(LearningMode.REAL_TIME);

// Balanced mode: +25% quality, standard LoRA
sona.setMode(LearningMode.BALANCED);

// Research mode: +55% quality, full fine-tuning
sona.setMode(LearningMode.RESEARCH);

// Edge mode: <5MB, aggressive quantization
sona.setMode(LearningMode.EDGE);

// Batch mode: High throughput, async processing
sona.setMode(LearningMode.BATCH);
```

### RL Algorithms

```typescript
// V3 only: Use RL algorithms
import { createPPO, createDQN, createA2C } from '@claude-flow/neural/algorithms';

// PPO for continuous action spaces
const ppo = createPPO({
  actor: { hiddenLayers: [64, 64] },
  critic: { hiddenLayers: [64, 64] },
  clipRatio: 0.2,
  gamma: 0.99
});

// DQN for discrete actions
const dqn = createDQN({
  hiddenLayers: [64, 64],
  epsilon: 0.1,
  targetUpdateFreq: 100
});

// A2C for parallel environments
const a2c = createA2C({
  numWorkers: 4,
  entropyCoeff: 0.01
});
```

### Continual Learning

```typescript
// V3 only: LoRA and EWC
import { SONAManager } from '@claude-flow/neural';

const sona = new SONAManager({
  enableLoRA: true,
  loraConfig: {
    rank: 8,
    alpha: 16,
    dropout: 0.1
  },
  enableEWC: true,
  ewcConfig: {
    lambda: 1000,
    decay: 0.99
  }
});

// LoRA adapts quickly, EWC prevents forgetting
await sona.train(newTask);
```

## Performance Comparison

| Operation | V2 | V3 | Improvement |
|-----------|----|----|-------------|
| Vector Search | Brute-force O(n) | HNSW O(log n) | 150x-12,500x |
| Memory Store | SQLite only | Hybrid | Optimized routing |
| Pattern Retrieval | Via adapter | Native | ~10x faster |
| Learning Adaptation | Manual | SONA | <0.05ms |
| Memory Usage | Full vectors | Quantized | 4-32x reduction |

## Migration Checklist

### Memory Migration
- [ ] Update imports to `@claude-flow/memory`
- [ ] Configure hybrid backend
- [ ] Run data migration script
- [ ] Generate embeddings for existing entries
- [ ] Update query code to use semantic search
- [ ] Test HNSW index performance

### Neural Migration
- [ ] Update imports to `@claude-flow/neural`
- [ ] Initialize NeuralLearningSystem
- [ ] Configure SONA mode
- [ ] Migrate training code to trajectories
- [ ] Update pattern retrieval to ReasoningBank
- [ ] Enable LoRA/EWC if needed
