# @claude-flow/embeddings

[![npm version](https://img.shields.io/npm/v/@claude-flow/embeddings.svg)](https://www.npmjs.com/package/@claude-flow/embeddings)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/embeddings.svg)](https://www.npmjs.com/package/@claude-flow/embeddings)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Performance](https://img.shields.io/badge/Performance-<5ms-brightgreen.svg)](https://github.com/ruvnet/claude-flow)

> High-performance embedding generation module for Claude Flow V3 - multi-provider support with persistent caching, document chunking, normalization, hyperbolic embeddings, and neural substrate integration.

## Features

### Core Embedding
- **Multiple Providers** - Agentic-Flow (ONNX), OpenAI, Transformers.js, and Mock
- **Auto-Install** - Automatically installs agentic-flow when using `provider: 'auto'`
- **Smart Fallback** - Graceful fallback chain: agentic-flow → transformers → mock
- **LRU + Disk Caching** - In-memory LRU + SQLite persistent cache with TTL
- **Batch Processing** - Efficient batch embedding with partial cache hits
- **Similarity Functions** - Cosine, Euclidean, and dot product metrics
- **75x Faster** - Agentic-flow ONNX is 75x faster than Transformers.js

### Advanced Features (New in v3.0.0-alpha.11)
- **Document Chunking** - Character, sentence, paragraph, and token-based chunking with overlap
- **Multiple Normalization** - L2, L1, min-max, and z-score normalization
- **Hyperbolic Embeddings** - Poincaré ball model for hierarchical representations
- **Neural Substrate** - Semantic drift detection, memory physics, swarm coordination
- **Persistent Cache** - SQLite-backed disk cache with LRU eviction and TTL

## Installation

```bash
npm install @claude-flow/embeddings
```

## Quick Start

```typescript
import { createEmbeddingService, cosineSimilarity } from '@claude-flow/embeddings';

// Create embedding service
const service = createEmbeddingService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small',
  dimensions: 1536,
});

// Generate embedding
const result = await service.embed('Hello, world!');
console.log(`Embedding dimension: ${result.embedding.length}`);
console.log(`Latency: ${result.latencyMs}ms`);

// Batch embed
const batchResult = await service.embedBatch([
  'First document',
  'Second document',
  'Third document',
]);
console.log(`Processed ${batchResult.embeddings.length} embeddings`);
console.log(`Cache hits: ${batchResult.cacheStats?.hits}`);

// Calculate similarity
const similarity = cosineSimilarity(
  batchResult.embeddings[0],
  batchResult.embeddings[1]
);
console.log(`Similarity: ${similarity.toFixed(4)}`);
```

## CLI Usage

```bash
# Generate embedding from CLI
claude-flow embeddings embed "Your text here"

# Batch embed from file
claude-flow embeddings batch documents.txt -o embeddings.json

# Similarity search
claude-flow embeddings search "query" --index ./vectors

# Initialize agentic-flow model
claude-flow embeddings init --provider agentic-flow
```

## API Reference

### Factory Functions

```typescript
import {
  createEmbeddingService,
  createEmbeddingServiceAsync,
  getEmbedding
} from '@claude-flow/embeddings';

// Sync: Create with known provider
const service = createEmbeddingService({
  provider: 'openai',
  apiKey: 'your-api-key',
  model: 'text-embedding-3-small',
});

// Async: Auto-select best provider with fallback
const autoService = await createEmbeddingServiceAsync({
  provider: 'auto',       // agentic-flow → transformers → mock
  autoInstall: true,      // Install agentic-flow if missing
  fallback: 'transformers', // Custom fallback
});

// Quick one-off embedding
const embedding = await getEmbedding('Hello world', {
  provider: 'mock',
  dimensions: 384,
});
```

### OpenAI Provider

```typescript
import { OpenAIEmbeddingService } from '@claude-flow/embeddings';

const service = new OpenAIEmbeddingService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small',  // or 'text-embedding-3-large'
  dimensions: 1536,                  // Adjustable for v3 models
  baseURL: 'https://api.openai.com/v1/embeddings',
  timeout: 30000,
  maxRetries: 3,
  cacheSize: 1000,
});

const result = await service.embed('Your text here');
console.log('Tokens used:', result.usage?.totalTokens);
```

### Agentic-Flow Provider (Fastest)

```typescript
import { AgenticFlowEmbeddingService } from '@claude-flow/embeddings';

const service = new AgenticFlowEmbeddingService({
  provider: 'agentic-flow',
  modelId: 'default',     // Uses optimized ONNX model
  cacheSize: 256,
});

// 75x faster than Transformers.js (3ms vs 233ms)
const result = await service.embed('Your text here');
console.log(`ONNX embedding in ${result.latencyMs}ms`);
```

### Transformers.js Provider (Local)

```typescript
import { TransformersEmbeddingService } from '@claude-flow/embeddings';

const service = new TransformersEmbeddingService({
  provider: 'transformers',
  model: 'Xenova/all-MiniLM-L6-v2',  // Any HuggingFace model
  cacheSize: 1000,
});

// First call downloads the model
const result = await service.embed('Your text here');
console.log(`Local embedding generated in ${result.latencyMs}ms`);
```

### Mock Provider (Testing)

```typescript
import { MockEmbeddingService } from '@claude-flow/embeddings';

const service = new MockEmbeddingService({
  provider: 'mock',
  dimensions: 384,
  simulatedLatency: 10,  // Optional delay
  cacheSize: 100,
});

// Deterministic embeddings based on text hash
const result = await service.embed('Your text here');
```

### Batch Processing

```typescript
const result = await service.embedBatch([
  'Document 1: Introduction to machine learning',
  'Document 2: Deep learning fundamentals',
  'Document 3: Natural language processing',
  'Document 4: Computer vision basics',
]);

console.log('Batch Results:', {
  count: result.embeddings.length,
  totalLatency: `${result.totalLatencyMs}ms`,
  avgLatency: `${result.avgLatencyMs}ms`,
  cacheHits: result.cacheStats?.hits,
  cacheMisses: result.cacheStats?.misses,
  tokensUsed: result.usage?.totalTokens,
});
```

### Similarity Functions

```typescript
import {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  computeSimilarity,
} from '@claude-flow/embeddings';

// Cosine similarity (most common for embeddings)
const cosine = cosineSimilarity(embedding1, embedding2);
// Returns: 0.0 to 1.0 (higher = more similar)

// Euclidean distance
const distance = euclideanDistance(embedding1, embedding2);
// Returns: 0.0 to infinity (lower = more similar)

// Dot product
const dot = dotProduct(embedding1, embedding2);
// Returns: unbounded (higher = more similar for normalized vectors)

// Generic similarity with metric selection
const result = computeSimilarity(embedding1, embedding2, 'cosine');
// Returns: { score: 0.95, metric: 'cosine' }
```

### Cache Management

```typescript
// Get cache statistics
const stats = service.getCacheStats();
console.log('Cache Stats:', {
  size: stats.size,
  maxSize: stats.maxSize,
  hitRate: `${(stats.hitRate * 100).toFixed(1)}%`,
});

// Clear cache
service.clearCache();

// Shutdown service
await service.shutdown();
```

### Event System

```typescript
// Subscribe to embedding events
service.addEventListener((event) => {
  switch (event.type) {
    case 'embed_start':
      console.log(`Starting: ${event.text.substring(0, 50)}...`);
      break;
    case 'embed_complete':
      console.log(`Completed in ${event.latencyMs}ms`);
      break;
    case 'embed_error':
      console.error(`Error: ${event.error}`);
      break;
    case 'cache_hit':
      console.log('Cache hit!');
      break;
    case 'batch_start':
      console.log(`Batch of ${event.count} started`);
      break;
    case 'batch_complete':
      console.log(`Batch completed in ${event.latencyMs}ms`);
      break;
    case 'cache_eviction':
      console.log(`Cache evicted ${event.size} entries`);
      break;
  }
});

// Remove listener
service.removeEventListener(listener);
```

## Provider Comparison

| Provider | Latency | Quality | Cost | Offline |
|----------|---------|---------|------|---------|
| **Agentic-Flow** | ~3ms | Good | Free | Yes |
| **OpenAI** | ~50-100ms | Excellent | $0.02-0.13/1M tokens | No |
| **Transformers.js** | ~230ms | Good | Free | Yes |
| **Mock** | <1ms | N/A | Free | Yes |

### Agentic-Flow (Recommended)

| Model | Dimensions | Speed | Best For |
|-------|------------|-------|----------|
| `default` | 384 | 3ms | General purpose, fastest |

### OpenAI Models

| Model | Dimensions | Max Tokens | Best For |
|-------|------------|------------|----------|
| `text-embedding-3-small` | 1536 | 8191 | General purpose, cost-effective |
| `text-embedding-3-large` | 3072 | 8191 | Highest quality |
| `text-embedding-ada-002` | 1536 | 8191 | Legacy support |

### Transformers.js Models

| Model | Dimensions | Size | Best For |
|-------|------------|------|----------|
| `Xenova/all-MiniLM-L6-v2` | 384 | 23MB | Fast, general purpose |
| `Xenova/all-mpnet-base-v2` | 768 | 110MB | Higher quality |
| `Xenova/bge-small-en-v1.5` | 384 | 33MB | Retrieval optimized |

## TypeScript Types

```typescript
import type {
  // Provider types
  EmbeddingProvider,
  EmbeddingConfig,
  OpenAIEmbeddingConfig,
  TransformersEmbeddingConfig,
  AgenticFlowEmbeddingConfig,
  MockEmbeddingConfig,
  AutoEmbeddingConfig,

  // Result types
  EmbeddingResult,
  BatchEmbeddingResult,

  // Service interface
  IEmbeddingService,

  // Event types
  EmbeddingEvent,
  EmbeddingEventListener,

  // Similarity types
  SimilarityMetric,
  SimilarityResult,
} from '@claude-flow/embeddings';
```

## Environment Variables

```bash
# OpenAI configuration
OPENAI_API_KEY=sk-...

# Optional: Custom base URL (for Azure OpenAI, etc.)
OPENAI_BASE_URL=https://your-endpoint.openai.azure.com/
```

## Error Handling

```typescript
try {
  const result = await service.embed('Your text');
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('API error')) {
      // Handle API errors (rate limits, auth, etc.)
    } else if (error.message.includes('Failed to initialize')) {
      // Handle model loading errors (Transformers.js)
    }
  }
}
```

## Integration with Memory Module

```typescript
import { createEmbeddingService } from '@claude-flow/embeddings';
import { HNSWIndex } from '@claude-flow/memory';

// Create embedding service
const embeddings = createEmbeddingService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small',
});

// Create HNSW index
const index = new HNSWIndex({
  dimensions: 1536,
  metric: 'cosine',
});

// Index documents
const documents = ['Doc 1 content', 'Doc 2 content', 'Doc 3 content'];
const { embeddings: vectors } = await embeddings.embedBatch(documents);

vectors.forEach((vector, i) => {
  index.addPoint(`doc-${i}`, new Float32Array(vector));
});

// Search
const queryResult = await embeddings.embed('Search query');
const results = await index.search(new Float32Array(queryResult.embedding), 5);
```

## Document Chunking

Split long documents into overlapping chunks for embedding:

```typescript
import { chunkText, estimateTokens, reconstructFromChunks } from '@claude-flow/embeddings';

// Chunk by sentence (default)
const result = chunkText(longDocument, {
  maxChunkSize: 512,
  overlap: 50,
  strategy: 'sentence',  // 'character' | 'sentence' | 'paragraph' | 'token'
  minChunkSize: 100,
});

console.log('Chunks:', result.totalChunks);
result.chunks.forEach((chunk, i) => {
  console.log(`Chunk ${i}: ${chunk.length} chars, ~${chunk.tokenCount} tokens`);
});

// Estimate tokens
const tokens = estimateTokens('Hello world');  // ~3 tokens

// Reconstruct (approximate)
const reconstructed = reconstructFromChunks(result.chunks);
```

## Normalization

Normalize embeddings for consistent similarity computation:

```typescript
import {
  l2Normalize,    // Unit vector (Euclidean norm = 1)
  l1Normalize,    // Manhattan norm = 1
  minMaxNormalize, // Values in [0, 1]
  zScoreNormalize, // Mean 0, std 1
  normalize,       // Generic with type option
  l2Norm,
  isNormalized,
} from '@claude-flow/embeddings';

const embedding = new Float32Array([3, 4, 0]);

// L2 normalize (most common for cosine similarity)
const l2 = l2Normalize(embedding);  // [0.6, 0.8, 0]
console.log('L2 norm:', l2Norm(l2));  // 1.0

// Check if already normalized
console.log(isNormalized(l2));  // true
console.log(isNormalized(embedding));  // false

// Generic normalize with type
const normalized = normalize(embedding, { type: 'l2' });
```

## Hyperbolic Embeddings (Poincaré Ball)

Transform embeddings to hyperbolic space for better hierarchical representation:

```typescript
import {
  euclideanToPoincare,
  poincareToEuclidean,
  hyperbolicDistance,
  mobiusAdd,
  isInPoincareBall,
  batchEuclideanToPoincare,
  hyperbolicCentroid,
} from '@claude-flow/embeddings';

// Convert Euclidean embedding to Poincaré ball
const euclidean = new Float32Array([0.5, 0.3, 0.2]);
const poincare = euclideanToPoincare(euclidean);

// Check if point is in the ball
console.log(isInPoincareBall(poincare));  // true

// Round-trip conversion
const back = poincareToEuclidean(poincare);

// Hyperbolic distance (geodesic in Poincaré ball)
const a = euclideanToPoincare(new Float32Array([0.1, 0.2, 0.1]));
const b = euclideanToPoincare(new Float32Array([0.3, 0.1, 0.2]));
const dist = hyperbolicDistance(a, b);

// Möbius addition (hyperbolic "plus")
const sum = mobiusAdd(a, b);

// Batch conversion
const embeddings = [vec1, vec2, vec3];
const hyperbolic = batchEuclideanToPoincare(embeddings);

// Hyperbolic centroid (Fréchet mean)
const centroid = hyperbolicCentroid(hyperbolic);
```

### Why Hyperbolic?

Hyperbolic space has natural properties for representing hierarchical data:
- **Exponential growth** - Tree-like structures fit naturally
- **Better hierarchy** - Parent-child relationships preserved
- **Lower distortion** - Taxonomies represented with less error

## Neural Substrate Integration

Access agentic-flow's neural features for advanced embedding operations:

```typescript
import {
  NeuralEmbeddingService,
  createNeuralService,
  isNeuralAvailable,
  listEmbeddingModels,
  downloadEmbeddingModel,
} from '@claude-flow/embeddings';

// Check if neural features are available
const available = await isNeuralAvailable();

// Create neural service
const neural = createNeuralService({ dimension: 384 });
await neural.init();

if (neural.isAvailable()) {
  // Semantic drift detection
  await neural.setDriftBaseline('Initial context about the topic');
  const drift = await neural.detectDrift('New input to check for drift');
  console.log('Drift:', drift?.trend);  // 'stable' | 'drifting' | 'accelerating'

  // Memory with interference detection
  const stored = await neural.storeMemory('mem-1', 'Important information');
  console.log('Interference:', stored?.interference);

  // Recall by similarity
  const memories = await neural.recallMemories('query', 5);

  // Swarm coordination
  await neural.addSwarmAgent('agent-1', 'researcher');
  const coordination = await neural.coordinateSwarm('Analyze this task');

  // Coherence checking
  await neural.calibrateCoherence(['good output 1', 'good output 2']);
  const coherence = await neural.checkCoherence('Output to check');

  // Health status
  const health = neural.health();
  console.log('Memory count:', health?.memoryCount);
}

// List available ONNX models
const models = await listEmbeddingModels();
console.log(models);
// [{ id: 'all-MiniLM-L6-v2', dimension: 384, size: '23MB', ... }]

// Download model
const path = await downloadEmbeddingModel('all-MiniLM-L6-v2', '.models');
```

## Persistent Disk Cache

SQLite-backed persistent cache for embeddings:

```typescript
import { PersistentEmbeddingCache, isPersistentCacheAvailable } from '@claude-flow/embeddings';

// Check if SQLite is available
const hasSQLite = await isPersistentCacheAvailable();

// Create persistent cache
const cache = new PersistentEmbeddingCache({
  dbPath: './embeddings.db',  // SQLite database path
  maxSize: 10000,             // Max entries before LRU eviction
  ttlMs: 7 * 24 * 60 * 60 * 1000,  // 7 day TTL
});

// Initialize
await cache.init();

// Store embedding
await cache.set('my text', new Float32Array([0.1, 0.2, 0.3]));

// Retrieve
const embedding = await cache.get('my text');

// Get stats
const stats = await cache.getStats();
console.log('Cache stats:', {
  size: stats.totalEntries,
  hitRate: stats.hitRate,
  avgLatency: stats.avgLatencyMs,
});

// Close when done
await cache.close();
```

### Enable in Embedding Service

```typescript
const service = createEmbeddingService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  persistentCache: {
    enabled: true,
    dbPath: './cache/embeddings.db',
    maxSize: 50000,
    ttlMs: 30 * 24 * 60 * 60 * 1000,  // 30 days
  },
  normalization: 'l2',  // Auto-normalize embeddings
});
```

## CLI Commands (New)

```bash
# Document chunking
claude-flow embeddings chunk document.txt --strategy sentence --max-size 512

# Normalize embedding file
claude-flow embeddings normalize embeddings.json --type l2 -o normalized.json

# Convert to hyperbolic
claude-flow embeddings hyperbolic embeddings.json -o poincare.json

# Neural operations
claude-flow embeddings neural drift --baseline "context" --input "check this"
claude-flow embeddings neural store --id mem-1 --content "data"
claude-flow embeddings neural recall "query" --top-k 5

# List/download models
claude-flow embeddings models list
claude-flow embeddings models download all-MiniLM-L6-v2

# Cache management
claude-flow embeddings cache stats
claude-flow embeddings cache clear --older-than 7d
```

## Related Packages

- [@claude-flow/memory](../memory) - HNSW indexing and vector storage
- [@claude-flow/providers](../providers) - Multi-LLM provider system
- [@claude-flow/neural](../neural) - SONA learning integration

## License

MIT
