/**
 * Memory Module Exports
 * Memory management and caching functionality
 */

// Memory Manager
export {
  MemoryManager,
  type IMemoryManager,
  type MemoryManagerOptions
} from './manager.js';

// Advanced Memory Manager
export {
  AdvancedMemoryManager,
  type AdvancedMemoryOptions,
  type MemoryStats
} from './advanced-memory-manager.js';

// Swarm Memory
export {
  SwarmMemoryManager,
  type SwarmMemoryOptions
} from './swarm-memory.js';

// Distributed Memory
export {
  DistributedMemory,
  type DistributedMemoryOptions,
  type NodeInfo
} from './distributed-memory.js';

// Cache
export {
  MemoryCache,
  type CacheOptions,
  type CacheEntry
} from './cache.js';

// Indexer
export {
  MemoryIndexer,
  type IndexerOptions,
  type IndexEntry
} from './indexer.js';

// Backends
export { BaseBackend, type BackendOptions } from './backends/base.js';
export { SqliteBackend } from './backends/sqlite.js';
export { MarkdownBackend } from './backends/markdown.js';

// Facades for external module access
export {
  MemoryFacade,
  type MemoryOperationOptions,
  type MemoryEntry
} from './facades/memory-facade.js';