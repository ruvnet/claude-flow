/**
 * Memory Module Exports
 * Memory management and caching functionality
 */

// Memory Manager
export {
  MemoryManager,
  type IMemoryManager
} from './manager.js';

// Advanced Memory Manager
export {
  AdvancedMemoryManager,
  type MemoryEntry,
  type MemoryIndex,
  type QueryOptions,
  type ExportOptions,
  type ImportOptions,
  type MemoryStatistics,
  type CleanupOptions,
  type RetentionPolicy
} from './advanced-memory-manager.js';

// Swarm Memory
export {
  SwarmMemoryManager,
  type SwarmMemoryEntry,
  type SwarmMemoryQuery,
  type SwarmKnowledgeBase,
  type SwarmMemoryConfig
} from './swarm-memory.js';

// Distributed Memory
export {
  DistributedMemorySystem,
  type DistributedMemoryConfig,
  type MemoryNode,
  type SyncOperation,
  type MemoryQuery as DistributedMemoryQuery,
  type MemoryStatistics as DistributedMemoryStatistics
} from './distributed-memory.js';

// Cache
export {
  MemoryCache
} from './cache.js';

// Indexer
export {
  MemoryIndexer
} from './indexer.js';

// Backends
export { type IMemoryBackend } from './backends/base.js';
export { SQLiteBackend } from './backends/sqlite.js';
export { MarkdownBackend } from './backends/markdown.js';

// Facades for external module access
export {
  MemoryFacade,
  type MemoryOperationOptions,
  type MemoryEntry
} from './facades/memory-facade.js';