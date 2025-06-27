/**
 * Memory manager interface and implementation
 */

import { MemoryEntry, MemoryQuery, MemoryConfig } from '../utils/types.js';
import { IEventBus } from '../core/event-bus.js';
import { ILogger } from '../core/logger.js';
import { MemoryError } from '../utils/errors.js';
import { IMemoryBackend } from './backends/base.js';
import { SQLiteBackend } from './backends/sqlite.js';
import { MarkdownBackend } from './backends/markdown.js';
import { MemoryCache } from './cache.js';
import { MemoryIndexer } from './indexer.js';

export interface IMemoryManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  createBank(agentId: string): Promise<string>;
  closeBank(bankId: string): Promise<void>;
  store(entry: MemoryEntry): Promise<void>;
  remember(data: {
    namespace?: string;
    key: string;
    content: string;
    metadata?: Record<string, unknown>;
    agentId?: string;
    sessionId?: string;
    type?: 'observation' | 'insight' | 'decision' | 'artifact' | 'error';
    tags?: string[];
  }): Promise<void>;
  retrieve(id: string): Promise<MemoryEntry | undefined>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
  update(id: string, updates: Partial<MemoryEntry>): Promise<void>;
  delete(id: string): Promise<void>;
  getHealthStatus(): Promise<{ healthy: boolean; error?: string; metrics?: Record<string, number> }>;
  performMaintenance(): Promise<void>;
}

/**
 * Memory bank for agent-specific storage
 */
interface MemoryBank {
  id: string;
  agentId: string;
  createdAt: Date;
  lastAccessed: Date;
  entryCount: number;
}

/**
 * Memory manager implementation
 */
export class MemoryManager implements IMemoryManager {
  private backend: IMemoryBackend;
  private cache: MemoryCache;
  private indexer: MemoryIndexer;
  private banks = new Map<string, MemoryBank>();
  private initialized = false;
  private syncInterval?: NodeJS.Timeout;

  constructor(
    private config: MemoryConfig,
    private eventBus: IEventBus,
    private logger: ILogger,
  ) {
    // Initialize backend based on configuration
    this.backend = this.createBackend();
    
    // Initialize cache
    this.cache = new MemoryCache(
      this.config.cacheSizeMB * 1024 * 1024, // Convert MB to bytes
      this.logger,
    );

    // Initialize indexer
    this.indexer = new MemoryIndexer(this.logger);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing memory manager...');

    try {
      // Initialize backend
      await this.backend.initialize();

      // Initialize indexer with existing entries
      const allEntries = await this.backend.getAllEntries();
      await this.indexer.buildIndex(allEntries);

      // Start sync interval
      this.startSyncInterval();

      this.initialized = true;
      this.logger.info('Memory manager initialized');
    } catch (error) {
      this.logger.error('Failed to initialize memory manager', error);
      throw new MemoryError('Memory manager initialization failed', { error });
    }
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.info('Shutting down memory manager...');

    try {
      // Stop sync interval
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
      }

      // Flush cache
      await this.flushCache();

      // Close all banks
      const bankIds = Array.from(this.banks.keys());
      await Promise.all(bankIds.map(id => this.closeBank(id)));

      // Shutdown backend
      await this.backend.shutdown();

      this.initialized = false;
      this.logger.info('Memory manager shutdown complete');
    } catch (error) {
      this.logger.error('Error during memory manager shutdown', error);
      throw error;
    }
  }

  async createBank(agentId: string): Promise<string> {
    if (!this.initialized) {
      throw new MemoryError('Memory manager not initialized');
    }

    const bank: MemoryBank = {
      id: `bank_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agentId,
      createdAt: new Date(),
      lastAccessed: new Date(),
      entryCount: 0,
    };

    this.banks.set(bank.id, bank);
    
    this.logger.info('Memory bank created', { bankId: bank.id, agentId });
    
    return bank.id;
  }

  async closeBank(bankId: string): Promise<void> {
    const bank = this.banks.get(bankId);
    if (!bank) {
      throw new MemoryError(`Memory bank not found: ${bankId}`);
    }

    // Flush any cached entries for this bank
    const bankEntries = this.cache.getByPrefix(`${bank.agentId}:`);
    for (const entry of bankEntries) {
      await this.backend.store(entry);
    }

    this.banks.delete(bankId);
    
    this.logger.info('Memory bank closed', { bankId });
  }

  async store(entry: MemoryEntry): Promise<void> {
    if (!this.initialized) {
      throw new MemoryError('Memory manager not initialized');
    }

    this.logger.debug('Storing memory entry', { 
      id: entry.id,
      type: entry.type,
      agentId: entry.agentId,
    });

    try {
      // Add to cache
      this.cache.set(entry.id, entry);

      // Add to index
      this.indexer.addEntry(entry);

      // Store in backend (async, don't wait)
      this.backend.store(entry).catch(error => {
        this.logger.error('Failed to store entry in backend', { 
          id: entry.id,
          error,
        });
      });

      // Update bank stats
      const bank = Array.from(this.banks.values()).find(b => b.agentId === entry.agentId);
      if (bank) {
        bank.entryCount++;
        bank.lastAccessed = new Date();
      }

      // Emit event
      this.eventBus.emit('memory:created', { entry });
    } catch (error) {
      this.logger.error('Failed to store memory entry', error);
      throw new MemoryError('Failed to store memory entry', { error });
    }
  }

  async remember(data: {
    namespace?: string;
    key: string;
    content: string;
    metadata?: Record<string, unknown>;
    agentId?: string;
    sessionId?: string;
    type?: 'observation' | 'insight' | 'decision' | 'artifact' | 'error';
    tags?: string[];
  }): Promise<void> {
    // Create a proper MemoryEntry from the simplified data
    const entry: MemoryEntry = {
      id: data.key,
      agentId: data.agentId || 'system',
      sessionId: data.sessionId || 'default',
      type: data.type || 'artifact',
      content: data.content,
      context: {
        namespace: data.namespace || 'default',
        ...data.metadata
      },
      timestamp: new Date(),
      tags: data.tags || [],
      version: 1,
      metadata: data.metadata
    };

    await this.store(entry);
  }

  async retrieve(id: string): Promise<MemoryEntry | undefined> {
    if (!this.initialized) {
      throw new MemoryError('Memory manager not initialized');
    }

    // Check cache first
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }

    // Retrieve from backend
    const entry = await this.backend.retrieve(id);
    if (entry) {
      // Add to cache
      this.cache.set(id, entry);
    }

    return entry;
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (!this.initialized) {
      throw new MemoryError('Memory manager not initialized');
    }

    this.logger.debug('Querying memory', query);

    try {
      // Use index for fast querying
      let results = this.indexer.search(query);

      // Apply additional filters if needed
      if (query.search) {
        results = results.filter(entry => 
          entry.content.toLowerCase().includes(query.search!.toLowerCase()) ||
          entry.tags.some(tag => tag.toLowerCase().includes(query.search!.toLowerCase())),
        );
      }

      // Apply time range filter
      if (query.startTime || query.endTime) {
        results = results.filter(entry => {
          const timestamp = entry.timestamp.getTime();
          if (query.startTime && timestamp < query.startTime.getTime()) {
            return false;
          }
          if (query.endTime && timestamp > query.endTime.getTime()) {
            return false;
          }
          return true;
        });
      }

      // Apply pagination
      const start = query.offset || 0;
      const limit = query.limit || 100;
      results = results.slice(start, start + limit);

      return results;
    } catch (error) {
      this.logger.error('Failed to query memory', error);
      throw new MemoryError('Failed to query memory', { error });
    }
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    if (!this.initialized) {
      throw new MemoryError('Memory manager not initialized');
    }

    const existing = await this.retrieve(id);
    if (!existing) {
      throw new MemoryError(`Memory entry not found: ${id}`);
    }

    // Create updated entry
    const updated: MemoryEntry = {
      ...existing,
      ...updates,
      id: existing.id, // Ensure ID doesn't change
      version: existing.version + 1,
      timestamp: new Date(),
    };

    // Update in cache
    this.cache.set(id, updated);

    // Update in index
    this.indexer.updateEntry(updated);

    // Update in backend
    await this.backend.update(id, updated);

    // Emit event
    this.eventBus.emit('memory:updated', { 
      entry: updated,
      previousVersion: existing.version,
    });
  }

  async delete(id: string): Promise<void> {
    if (!this.initialized) {
      throw new MemoryError('Memory manager not initialized');
    }

    // Remove from cache
    this.cache.delete(id);

    // Remove from index
    this.indexer.removeEntry(id);

    // Delete from backend
    await this.backend.delete(id);

    // Emit event
    this.eventBus.emit('memory:deleted', { entryId: id });
  }

  async getHealthStatus(): Promise<{ 
    healthy: boolean; 
    error?: string; 
    metrics?: Record<string, number>;
  }> {
    try {
      const backendHealth = await this.backend.getHealthStatus();
      const cacheMetrics = this.cache.getMetrics();
      const indexMetrics = this.indexer.getMetrics();

      const metrics = {
        totalEntries: indexMetrics.totalEntries,
        cacheSize: cacheMetrics.size,
        cacheHitRate: cacheMetrics.hitRate,
        activeBanks: this.banks.size,
        ...backendHealth.metrics,
      };

      return {
        healthy: backendHealth.healthy,
        metrics,
        ...(backendHealth.error && { error: backendHealth.error }),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async performMaintenance(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.debug('Performing memory manager maintenance');

    try {
      // Clean up old entries based on retention policy
      if (this.config.retentionDays > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
        
        const oldEntries = await this.query({
          endTime: cutoffDate,
        });

        for (const entry of oldEntries) {
          await this.delete(entry.id);
        }
        
        this.logger.info(`Cleaned up ${oldEntries.length} old memory entries`);
      }

      // Perform cache maintenance
      this.cache.performMaintenance();

      // Perform backend maintenance
      if (this.backend.performMaintenance) {
        await this.backend.performMaintenance();
      }

      // Update bank statistics
      for (const bank of this.banks.values()) {
        const entries = await this.query({ agentId: bank.agentId });
        bank.entryCount = entries.length;
        bank.lastAccessed = new Date();
      }

      this.logger.debug('Memory manager maintenance completed');
    } catch (error) {
      this.logger.error('Error during memory manager maintenance', error);
    }
  }

  private createBackend(): IMemoryBackend {
    switch (this.config.backend) {
      case 'sqlite':
        return new SQLiteBackend(
          this.config.sqlitePath || './claude-flow.db',
          this.logger,
        );
      case 'markdown':
        return new MarkdownBackend(
          this.config.markdownDir || './memory',
          this.logger,
        );
      case 'hybrid':
        // Use SQLite for structured data and Markdown for human-readable backup
        return new HybridBackend(
          new SQLiteBackend(
            this.config.sqlitePath || './claude-flow.db',
            this.logger,
          ),
          new MarkdownBackend(
            this.config.markdownDir || './memory',
            this.logger,
          ),
          this.logger,
        );
      default:
        throw new MemoryError(`Unknown memory backend: ${this.config.backend}`);
    }
  }

  private startSyncInterval(): void {
    this.syncInterval = setInterval(async () => {
      try {
        await this.syncCache();
      } catch (error) {
        this.logger.error('Cache sync error', error);
      }
    }, this.config.syncInterval);
  }

  private async syncCache(): Promise<void> {
    const dirtyEntries = this.cache.getDirtyEntries();
    
    if (dirtyEntries.length === 0) {
      return;
    }

    this.logger.debug('Syncing cache to backend', { count: dirtyEntries.length });

    const promises = dirtyEntries.map(entry => 
      this.backend.store(entry).catch(error => {
        this.logger.error('Failed to sync entry', { id: entry.id, error });
      }),
    );

    await Promise.all(promises);
    this.cache.markClean(dirtyEntries.map(e => e.id));

    // Emit sync event
    this.eventBus.emit('memory:synced', { entries: dirtyEntries });
  }

  private async flushCache(): Promise<void> {
    const allEntries = this.cache.getAllEntries();
    
    if (allEntries.length === 0) {
      return;
    }

    this.logger.info('Flushing cache to backend', { count: allEntries.length });

    const promises = allEntries.map(entry => 
      this.backend.store(entry).catch(error => {
        this.logger.error('Failed to flush entry', { id: entry.id, error });
      }),
    );

    await Promise.all(promises);
  }
}

/**
 * Hybrid backend that uses both SQLite and Markdown
 */
class HybridBackend implements IMemoryBackend {
  constructor(
    private primary: IMemoryBackend,
    private secondary: IMemoryBackend,
    private logger: ILogger,
  ) {}

  async initialize(): Promise<void> {
    await Promise.all([
      this.primary.initialize(),
      this.secondary.initialize(),
    ]);
  }

  async shutdown(): Promise<void> {
    await Promise.all([
      this.primary.shutdown(),
      this.secondary.shutdown(),
    ]);
  }

  async store(entry: MemoryEntry): Promise<void> {
    // Store in both backends
    await Promise.all([
      this.primary.store(entry),
      this.secondary.store(entry).catch(error => {
        this.logger.warn('Failed to store in secondary backend', { error });
      }),
    ]);
  }

  async retrieve(id: string): Promise<MemoryEntry | undefined> {
    // Try primary first
    const entry = await this.primary.retrieve(id);
    if (entry) {
      return entry;
    }

    // Fall back to secondary
    return await this.secondary.retrieve(id);
  }

  async update(id: string, entry: MemoryEntry): Promise<void> {
    await Promise.all([
      this.primary.update(id, entry),
      this.secondary.update(id, entry).catch(error => {
        this.logger.warn('Failed to update in secondary backend', { error });
      }),
    ]);
  }

  async delete(id: string): Promise<void> {
    await Promise.all([
      this.primary.delete(id),
      this.secondary.delete(id).catch(error => {
        this.logger.warn('Failed to delete from secondary backend', { error });
      }),
    ]);
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    // Use primary for querying (faster)
    return await this.primary.query(query);
  }

  async getAllEntries(): Promise<MemoryEntry[]> {
    return await this.primary.getAllEntries();
  }

  async getHealthStatus(): Promise<{ 
    healthy: boolean; 
    error?: string; 
    metrics?: Record<string, number>;
  }> {
    const [primaryHealth, secondaryHealth] = await Promise.all([
      this.primary.getHealthStatus(),
      this.secondary.getHealthStatus(),
    ]);

    const error = primaryHealth.error || secondaryHealth.error;
    return {
      healthy: primaryHealth.healthy && secondaryHealth.healthy,
      ...(error && { error }),
      metrics: {
        ...primaryHealth.metrics,
        ...secondaryHealth.metrics,
      },
    };
  }
}