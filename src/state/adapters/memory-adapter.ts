/**
 * Memory State Adapter
 * Bridges MemoryManager to the unified state management system
 */

import { UnifiedStateManager } from '../state-manager.js';
import type { 
  MemoryState,
  MemoryBank,
  MemoryIndex,
  MemoryCacheState,
  StateChangeCallback, 
  Unsubscribe 
} from '../types.js';
import { Logger } from '../../core/logger.js';

export interface MemoryStateAdapterConfig {
  managerId: string;
  namespace?: string;
}

export interface MemoryEntry {
  id: string;
  agentId: string;
  bankId: string;
  key: string;
  value: any;
  type: 'string' | 'object' | 'array' | 'number' | 'boolean';
  size: number;
  tags: string[];
  namespace: string;
  priority: number;
  ttl?: number;
  createdAt: Date;
  updatedAt: Date;
  accessedAt: Date;
  accessCount: number;
  metadata: Record<string, unknown>;
}

export class MemoryStateAdapter {
  private logger: Logger;
  private stateManager: UnifiedStateManager;
  private config: MemoryStateAdapterConfig;
  private subscriptions: Unsubscribe[] = [];

  constructor(stateManager: UnifiedStateManager, config: MemoryStateAdapterConfig) {
    this.stateManager = stateManager;
    this.config = config;
    this.logger = new Logger({
      level: 'info',
      format: 'json',
      destination: 'console'
    }, { component: 'MemoryStateAdapter' });

    this.logger.info('Memory state adapter initialized', { managerId: config.managerId });
  }

  // ===== Memory Entry Management =====

  /**
   * Get a memory entry by ID
   */
  public getEntry(entryId: string): MemoryEntry | undefined {
    const state = this.stateManager.getState();
    return state.memory.entries.get(entryId) as MemoryEntry | undefined;
  }

  /**
   * Get memory entry by key
   */
  public getEntryByKey(key: string, namespace?: string): MemoryEntry | undefined {
    const entries = this.getAllEntries();
    return entries.find(entry => 
      entry.key === key && 
      (!namespace || entry.namespace === namespace)
    );
  }

  /**
   * Get all memory entries
   */
  public getAllEntries(): MemoryEntry[] {
    const state = this.stateManager.getState();
    return Array.from(state.memory.entries.values()) as MemoryEntry[];
  }

  /**
   * Get entries by agent
   */
  public getEntriesByAgent(agentId: string): MemoryEntry[] {
    return this.getAllEntries().filter(entry => entry.agentId === agentId);
  }

  /**
   * Get entries by namespace
   */
  public getEntriesByNamespace(namespace: string): MemoryEntry[] {
    return this.getAllEntries().filter(entry => entry.namespace === namespace);
  }

  /**
   * Get entries by tag
   */
  public getEntriesByTag(tag: string): MemoryEntry[] {
    return this.getAllEntries().filter(entry => entry.tags.includes(tag));
  }

  /**
   * Add a new memory entry
   */
  public addEntry(entry: MemoryEntry): void {
    this.stateManager.dispatch({
      type: 'memory/addEntry',
      payload: entry,
      metadata: {
        timestamp: new Date(),
        source: `MemoryManager:${this.config.managerId}`,
        reason: 'Memory entry created'
      }
    });

    this.logger.debug('Memory entry added to state', { 
      entryId: entry.id, 
      key: entry.key,
      namespace: entry.namespace,
      size: entry.size
    });
  }

  /**
   * Update an existing memory entry
   */
  public updateEntry(entryId: string, updates: Partial<MemoryEntry>): void {
    this.stateManager.dispatch({
      type: 'memory/updateEntry',
      payload: {
        id: entryId,
        updates: {
          ...updates,
          updatedAt: new Date()
        }
      },
      metadata: {
        timestamp: new Date(),
        source: `MemoryManager:${this.config.managerId}`,
        reason: 'Memory entry updated'
      }
    });

    this.logger.debug('Memory entry updated in state', { entryId, updates });
  }

  /**
   * Remove a memory entry
   */
  public removeEntry(entryId: string): void {
    this.stateManager.dispatch({
      type: 'memory/removeEntry',
      payload: { id: entryId },
      metadata: {
        timestamp: new Date(),
        source: `MemoryManager:${this.config.managerId}`,
        reason: 'Memory entry removed'
      }
    });

    this.logger.debug('Memory entry removed from state', { entryId });
  }

  /**
   * Update entry access stats
   */
  public recordEntryAccess(entryId: string): void {
    const entry = this.getEntry(entryId);
    if (entry) {
      this.updateEntry(entryId, {
        accessedAt: new Date(),
        accessCount: entry.accessCount + 1
      });
    }
  }

  /**
   * Set entry value
   */
  public setEntryValue(entryId: string, value: any): void {
    const size = JSON.stringify(value).length;
    this.updateEntry(entryId, {
      value,
      size,
      updatedAt: new Date()
    });
  }

  // ===== Memory Bank Management =====

  /**
   * Get a memory bank by ID
   */
  public getBank(bankId: string): MemoryBank | undefined {
    const state = this.stateManager.getState();
    return state.memory.banks.get(bankId);
  }

  /**
   * Get all memory banks
   */
  public getAllBanks(): MemoryBank[] {
    const state = this.stateManager.getState();
    return Array.from(state.memory.banks.values());
  }

  /**
   * Get banks by agent
   */
  public getBanksByAgent(agentId: string): MemoryBank[] {
    return this.getAllBanks().filter(bank => bank.agentId === agentId);
  }

  /**
   * Add a new memory bank
   */
  public addBank(bank: MemoryBank): void {
    this.stateManager.dispatch({
      type: 'memory/addBank',
      payload: bank,
      metadata: {
        timestamp: new Date(),
        source: `MemoryManager:${this.config.managerId}`,
        reason: 'Memory bank created'
      }
    });

    this.logger.debug('Memory bank added to state', { 
      bankId: bank.id, 
      agentId: bank.agentId 
    });
  }

  /**
   * Update memory bank
   */
  public updateBank(bankId: string, updates: Partial<MemoryBank>): void {
    this.stateManager.dispatch({
      type: 'memory/updateBank',
      payload: {
        id: bankId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `MemoryManager:${this.config.managerId}`,
        reason: 'Memory bank updated'
      }
    });

    this.logger.debug('Memory bank updated in state', { bankId, updates });
  }

  /**
   * Remove memory bank
   */
  public removeBank(bankId: string): void {
    this.stateManager.dispatch({
      type: 'memory/removeBank',
      payload: { id: bankId },
      metadata: {
        timestamp: new Date(),
        source: `MemoryManager:${this.config.managerId}`,
        reason: 'Memory bank removed'
      }
    });

    this.logger.debug('Memory bank removed from state', { bankId });
  }

  /**
   * Update bank statistics
   */
  public updateBankStats(bankId: string, entryCount: number, sizeBytes: number): void {
    this.updateBank(bankId, {
      entryCount,
      sizeBytes,
      lastAccessed: new Date()
    });
  }

  // ===== Memory Index Management =====

  /**
   * Get a memory index by ID
   */
  public getIndex(indexId: string): MemoryIndex | undefined {
    const state = this.stateManager.getState();
    return state.memory.indexes.get(indexId);
  }

  /**
   * Get all memory indexes
   */
  public getAllIndexes(): MemoryIndex[] {
    const state = this.stateManager.getState();
    return Array.from(state.memory.indexes.values());
  }

  /**
   * Get indexes by type
   */
  public getIndexesByType(type: MemoryIndex['type']): MemoryIndex[] {
    return this.getAllIndexes().filter(index => index.type === type);
  }

  /**
   * Add a new memory index
   */
  public addIndex(index: MemoryIndex): void {
    this.stateManager.dispatch({
      type: 'memory/addIndex',
      payload: index,
      metadata: {
        timestamp: new Date(),
        source: `MemoryManager:${this.config.managerId}`,
        reason: 'Memory index created'
      }
    });

    this.logger.debug('Memory index added to state', { 
      indexId: index.id, 
      type: index.type,
      entriesCount: index.entries.size
    });
  }

  /**
   * Update memory index
   */
  public updateIndex(indexId: string, updates: Partial<MemoryIndex>): void {
    this.stateManager.dispatch({
      type: 'memory/updateIndex',
      payload: {
        id: indexId,
        updates: {
          ...updates,
          lastUpdated: new Date()
        }
      },
      metadata: {
        timestamp: new Date(),
        source: `MemoryManager:${this.config.managerId}`,
        reason: 'Memory index updated'
      }
    });

    this.logger.debug('Memory index updated in state', { indexId, updates });
  }

  /**
   * Add entry to index
   */
  public addEntryToIndex(indexId: string, entryId: string): void {
    const index = this.getIndex(indexId);
    if (index) {
      const newEntries = new Set(index.entries);
      newEntries.add(entryId);
      this.updateIndex(indexId, { entries: newEntries });
    }
  }

  /**
   * Remove entry from index
   */
  public removeEntryFromIndex(indexId: string, entryId: string): void {
    const index = this.getIndex(indexId);
    if (index) {
      const newEntries = new Set(index.entries);
      newEntries.delete(entryId);
      this.updateIndex(indexId, { entries: newEntries });
    }
  }

  // ===== Memory Cache Management =====

  /**
   * Get cache state
   */
  public getCacheState(): MemoryCacheState {
    const state = this.stateManager.getState();
    return state.memory.cache;
  }

  /**
   * Update cache statistics
   */
  public updateCacheStats(updates: Partial<MemoryCacheState>): void {
    this.stateManager.dispatch({
      type: 'memory/updateCache',
      payload: updates,
      metadata: {
        timestamp: new Date(),
        source: `MemoryManager:${this.config.managerId}`,
        reason: 'Memory cache stats updated'
      }
    });

    this.logger.debug('Memory cache stats updated', { updates });
  }

  /**
   * Record cache hit
   */
  public recordCacheHit(): void {
    const cache = this.getCacheState();
    const totalAccesses = cache.hitRate * 100; // Assuming hit rate is percentage
    const newHitRate = ((cache.hitRate * totalAccesses) + 1) / (totalAccesses + 1);
    
    this.updateCacheStats({
      hitRate: newHitRate
    });
  }

  /**
   * Record cache miss
   */
  public recordCacheMiss(): void {
    const cache = this.getCacheState();
    const totalAccesses = cache.hitRate * 100;
    const newHitRate = (cache.hitRate * totalAccesses) / (totalAccesses + 1);
    
    this.updateCacheStats({
      hitRate: newHitRate
    });
  }

  // ===== Search and Query =====

  /**
   * Search entries by text
   */
  public searchEntries(query: string, namespace?: string): MemoryEntry[] {
    const entries = namespace 
      ? this.getEntriesByNamespace(namespace)
      : this.getAllEntries();

    const lowerQuery = query.toLowerCase();
    
    return entries.filter(entry => {
      const keyMatch = entry.key.toLowerCase().includes(lowerQuery);
      const valueMatch = typeof entry.value === 'string' && 
        entry.value.toLowerCase().includes(lowerQuery);
      const tagMatch = entry.tags.some(tag => 
        tag.toLowerCase().includes(lowerQuery)
      );
      
      return keyMatch || valueMatch || tagMatch;
    });
  }

  /**
   * Get entries by pattern
   */
  public getEntriesByPattern(pattern: RegExp, namespace?: string): MemoryEntry[] {
    const entries = namespace 
      ? this.getEntriesByNamespace(namespace)
      : this.getAllEntries();

    return entries.filter(entry => 
      pattern.test(entry.key) || 
      (typeof entry.value === 'string' && pattern.test(entry.value))
    );
  }

  /**
   * Get most accessed entries
   */
  public getMostAccessedEntries(limit: number = 10): MemoryEntry[] {
    return this.getAllEntries()
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit);
  }

  /**
   * Get recently updated entries
   */
  public getRecentlyUpdatedEntries(limit: number = 10): MemoryEntry[] {
    return this.getAllEntries()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }

  // ===== State Subscription =====

  /**
   * Subscribe to memory changes
   */
  public onMemoryChanged(callback: StateChangeCallback): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('memory', (change) => {
      if (change.action.type.startsWith('memory/')) {
        callback(change);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Subscribe to entry changes
   */
  public onEntryChanged(callback: StateChangeCallback): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('memory', (change) => {
      if (change.action.type.startsWith('memory/') && 
          change.action.type.includes('Entry')) {
        callback(change);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Subscribe to specific entry changes
   */
  public onSpecificEntryChanged(entryId: string, callback: StateChangeCallback): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('memory', (change) => {
      if (change.action.type.startsWith('memory/') && 
          change.action.payload?.id === entryId) {
        callback(change);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  // ===== Statistics and Analytics =====

  /**
   * Get memory statistics
   */
  public getMemoryStats(): {
    totalEntries: number;
    totalSize: number;
    bankCount: number;
    indexCount: number;
    entriesByNamespace: Record<string, number>;
    entriesByAgent: Record<string, number>;
    entriesByType: Record<string, number>;
    averageEntrySize: number;
    cacheStats: MemoryCacheState;
  } {
    const entries = this.getAllEntries();
    const banks = this.getAllBanks();
    const indexes = this.getAllIndexes();
    
    const entriesByNamespace: Record<string, number> = {};
    const entriesByAgent: Record<string, number> = {};
    const entriesByType: Record<string, number> = {};
    let totalSize = 0;

    entries.forEach(entry => {
      entriesByNamespace[entry.namespace] = (entriesByNamespace[entry.namespace] || 0) + 1;
      entriesByAgent[entry.agentId] = (entriesByAgent[entry.agentId] || 0) + 1;
      entriesByType[entry.type] = (entriesByType[entry.type] || 0) + 1;
      totalSize += entry.size;
    });

    return {
      totalEntries: entries.length,
      totalSize,
      bankCount: banks.length,
      indexCount: indexes.length,
      entriesByNamespace,
      entriesByAgent,
      entriesByType,
      averageEntrySize: entries.length > 0 ? totalSize / entries.length : 0,
      cacheStats: this.getCacheState()
    };
  }

  /**
   * Get memory usage by agent
   */
  public getMemoryUsageByAgent(): Record<string, { entries: number; size: number; banks: number }> {
    const entries = this.getAllEntries();
    const banks = this.getAllBanks();
    const usage: Record<string, { entries: number; size: number; banks: number }> = {};

    entries.forEach(entry => {
      if (!usage[entry.agentId]) {
        usage[entry.agentId] = { entries: 0, size: 0, banks: 0 };
      }
      usage[entry.agentId].entries++;
      usage[entry.agentId].size += entry.size;
    });

    banks.forEach(bank => {
      if (!usage[bank.agentId]) {
        usage[bank.agentId] = { entries: 0, size: 0, banks: 0 };
      }
      usage[bank.agentId].banks++;
    });

    return usage;
  }

  /**
   * Cleanup subscriptions
   */
  public dispose(): void {
    this.subscriptions.forEach(unsubscribe => unsubscribe());
    this.subscriptions = [];
    this.logger.info('Memory state adapter disposed', { managerId: this.config.managerId });
  }
}