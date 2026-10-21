# AgentDB Integration Guide

## Overview

`AgentDBBackend` integrates with **agentdb@3.0.0-alpha.20**. Its optional native
search path uses the separately exported `HNSWIndex`, not
`AgentDB.getController('hnsw')` (which does not exist in that version).

The index is built lazily from this backend's in-memory entries. Store, update,
replacement and deletion invalidate it; the next unfiltered search rebuilds a
fresh index. This avoids the dependency's duplicate-ID and deletion-tombstone
semantics. Repeated read-only searches reuse the index. Write-heavy workloads
pay rebuild cost; no universal speedup is promised.

**Persistence boundary:** this adapter does not add disk persistence or hydrate
`AgentDBBackend` after a process restart. The pre-existing storage adapter uses
`database.run/get` rather than the dependency's `prepare(...).run/get/all`, and
startup does not load entries. A same-instance shutdown/reinitialize retains
its in-memory entries, but reopening the same database in a new instance does
not restore them. Do not use this change as evidence of durable memory.
See the [verification receipt](./AGENTDB-HNSW-4249-VERIFICATION.md).

## Features

### AgentDBBackend

The `AgentDBBackend` class provides:

- **HNSW Vector Search**: Optional approximate cosine nearest-neighbor search
- **Graceful Fallback**: Works without native dependencies (hnswlib-node)
- **Optional Dependency Handling**: Exact in-memory cosine search when native search is unavailable
- **Hybrid Integration**: Seamlessly works with `HybridBackend` for combined SQLite + AgentDB queries

### Search behavior

- Native HNSW is used in `auto`/`hnswlib` mode when the export and addon are available.
- `forceWasm: true` and explicit `vectorBackend: 'ruvector'` disable this adapter;
  the AgentDB controllers' vector backend is separate from these memory entries.
- Filtered searches, including semantic queries with TTL-bearing entries, are
  exact to avoid top-k underfill or expiry differences between backends. Filter keys are never
  interpolated into the dependency's SQL filter builder.
- Missing exports/addons, unsafe tuning, dimension mismatch and native failures
  fall back to exact cosine search. A failed native instance is retried only on
  reinitialization, not on every query.
- Entry objects and embedding/tag/reference arrays are detached on input and
  output. Use `store`/`update` to change indexed data; arbitrary nested metadata
  values are not deep-cloned. Query vectors are copied before asynchronous work.
- HNSW is approximate; equal-score ordering is not guaranteed. Scores and
  thresholds use this backend's cosine implementation.

## Installation

```bash
# Core package (required)
npm install agentdb@3.0.0-alpha.20

# Optional native dependencies for maximum performance
npm install hnswlib-node@^3.0.0 better-sqlite3@^12.9.0
```

## Usage

### Basic Setup

```typescript
import { AgentDBBackend } from '@claude-flow/memory';

const backend = new AgentDBBackend({
  dbPath: './data/memory.db',
  namespace: 'default',
  vectorDimension: 1536, // For OpenAI embeddings
  hnswM: 16,
  hnswEfConstruction: 200,
  hnswEfSearch: 100,
  embeddingGenerator: async (text) => {
    // Your embedding function
    return embeddings.embed(text);
  },
});

await backend.initialize();
```

### Hybrid Backend (Recommended)

Per ADR-009, the recommended approach is to use `HybridBackend`:

```typescript
import { HybridBackend } from '@claude-flow/memory';

const memory = new HybridBackend({
  // SQLite for structured queries
  sqlite: {
    dbPath: './data/memory-sqlite.db',
  },

  // AgentDB for vector search
  agentdb: {
    dbPath: './data/memory-agentdb.db',
    vectorDimension: 1536,
    hnswM: 16,
    hnswEfConstruction: 200,
  },

  embeddingGenerator: embedFn,
  dualWrite: true, // Write to both backends
});

await memory.initialize();

// Structured queries go to SQLite
const user = await memory.getByKey('users', 'john@example.com');

// Semantic queries use native HNSW when available, otherwise exact cosine
const similar = await memory.querySemantic({
  content: 'authentication patterns',
  k: 10,
  threshold: 0.7,
});

// Hybrid queries combine both
const results = await memory.queryHybrid({
  semantic: { content: 'security vulnerabilities', k: 20 },
  structured: { namespace: 'security', createdAfter: Date.now() - 86400000 },
  combineStrategy: 'intersection',
});
```

### Semantic Search

```typescript
// Store entries with embeddings
await backend.store({
  id: 'entry-1',
  key: 'auth-patterns',
  content: 'OAuth 2.0 implementation patterns for secure authentication',
  embedding: await embedFn('OAuth 2.0 implementation patterns...'),
  // ... other fields
});

// Semantic search by content
const results = await backend.query({
  type: 'semantic',
  content: 'user authentication best practices',
  limit: 10,
  threshold: 0.8,
});

// Or search with pre-computed embedding
const results = await backend.search(
  queryEmbedding,
  { k: 10, threshold: 0.7 }
);
```

### Query Routing

The `HybridBackend` automatically routes queries to the optimal backend:

```typescript
// Exact match → SQLite
await memory.query({ type: 'exact', namespace: 'users', key: 'john@example.com' });

// Prefix search → SQLite (indexed)
await memory.query({ type: 'prefix', keyPrefix: 'auth-' });

// Semantic search → AgentDB (HNSW)
await memory.query({ type: 'semantic', content: 'security patterns', limit: 10 });

// Hybrid → Both backends with intelligent merging
await memory.query({ type: 'hybrid', content: 'patterns', namespace: 'security' });
```

## Configuration Options

### AgentDBBackendConfig

```typescript
interface AgentDBBackendConfig {
  /** Database path (default: ':memory:') */
  dbPath?: string;

  /** Namespace for memory organization */
  namespace?: string;

  /** Force WASM backend (skip native hnswlib) */
  forceWasm?: boolean;

  /** Vector backend: 'auto', 'ruvector', 'hnswlib' */
  vectorBackend?: 'auto' | 'ruvector' | 'hnswlib';

  /** Vector dimensions (default: 1536) */
  vectorDimension?: number;

  /** HNSW M parameter (connections per layer, default: 16) */
  hnswM?: number;

  /** HNSW efConstruction (build quality, default: 200) */
  hnswEfConstruction?: number;

  /** HNSW efSearch (search quality, default: 100) */
  hnswEfSearch?: number;

  /** Enable caching */
  cacheEnabled?: boolean;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /** Maximum entries */
  maxEntries?: number;
}
```

### HNSW Tuning

- **M (16-64)**: Higher = better recall, more memory
  - 16: Fast, less memory (recommended for most cases)
  - 32: Balanced
  - 64: High recall, more memory

- **efConstruction (100-400)**: Build time vs. quality
  - 100: Fast build, lower quality
  - 200: Balanced (recommended)
  - 400: Slow build, high quality

- **efSearch (50-200)**: Search time vs. recall
  - 50: Fast search, lower recall
  - 100: Balanced (recommended)
  - 200: Slower search, high recall

## Graceful Degradation

The backend handles missing dependencies gracefully. `isAvailable()` reports
AgentDB initialization, **not** whether a native memory index exists.

```typescript
const backend = new AgentDBBackend();
await backend.initialize();
// hnswStats is present only for a current, successfully built native index.
const stats = await backend.getStats();
console.log(stats.hnswStats ? 'Native HNSW index built' : 'Exact cosine fallback available');
```

## Performance and supported metrics

Use `node benchmarks/agentdb-hnsw.mjs` after building the package for a bounded,
seeded end-to-end comparison. The [verification receipt](./AGENTDB-HNSW-4249-VERIFICATION.md)
reports both warm search latency and first-search build cost, alongside recall.
Historical 150x–12,500x figures are not evidence for this backend.

This adapter uses cosine only. It does not implement quantization or additional
distance metrics; the separate local `HNSWIndex` API is a different component.

### Health Monitoring

```typescript
const health = await backend.healthCheck();

console.log(health.status); // 'healthy' | 'degraded' | 'unhealthy'
console.log(health.components.index); // HNSW index health

if (health.status === 'degraded') {
  console.log('Issues:', health.issues);
  console.log('Recommendations:', health.recommendations);
}
```

### Statistics

```typescript
const stats = await backend.getStats();

console.log('Total entries:', stats.totalEntries);
console.log('Avg query time:', stats.avgQueryTime, 'ms');
console.log('Avg search time:', stats.avgSearchTime, 'ms');

if (stats.hnswStats) {
  console.log('HNSW vectors:', stats.hnswStats.vectorCount);
  console.log('HNSW build time:', stats.hnswStats.buildTime, 'ms');
}
```

## Migration from Legacy Systems

The memory module includes migration support for legacy systems:

```typescript
import { MemoryMigrator } from '@claude-flow/memory';

const migrator = new MemoryMigrator(
  backend,
  {
    source: 'memory-manager',
    sourcePath: './old-memory.json',
    batchSize: 1000,
  },
  embeddingGenerator
);

const result = await migrator.migrate();

console.log('Migrated:', result.totalMigrated);
console.log('Failed:', result.totalFailed);
```

## Troubleshooting

### AgentDB not available

```
AgentDB not available. Install agentdb@3.0.0-alpha.20 for vector search support.
```

**Solution**: Install agentdb:
```bash
npm install agentdb@3.0.0-alpha.20
```

### Native bindings failed

```
Native HNSW index is not built; exact cosine fallback is available
```

**Solution**: This is normal. This memory search path falls back to exact in-memory cosine search. For maximum performance, install build tools:

```bash
# Ubuntu/Debian
sudo apt-get install build-essential python3

# macOS
xcode-select --install

# Then reinstall
npm install hnswlib-node@^3.0.0
```

### Force WASM backend

```typescript
const backend = new AgentDBBackend({
  forceWasm: true, // Disable this native memory-search adapter
});
```

## Testing

```bash
# Run focused tests; require the real native addon rather than silently skipping
RUFLO_REQUIRE_NATIVE_HNSW=1 AGENTDB_DISABLE_TRANSFORMERS=1 npm test -- agentdb-backend.test.ts agentdb-backend-hnsw.test.ts agentdb-backend-optional.test.ts

# Run all memory tests
npm test

# Run benchmarks
npm run bench
```

## Architecture Decision Records

This integration implements:

- **ADR-006**: Unified Memory Service with AgentDB
- **ADR-009**: Hybrid Memory Backend (SQLite + AgentDB) as default

## Related Documentation

- [AgentDB GitHub](https://github.com/ruvnet/agentic-flow/tree/main/packages/agentdb)
- [HNSW Algorithm Paper](https://arxiv.org/abs/1603.09320)
- [V3 Memory Architecture](./README.md)
- [HybridBackend Documentation](./docs/hybrid-backend.md)

## License

MIT
