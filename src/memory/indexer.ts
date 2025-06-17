/**
 * Memory indexer for fast querying
 */

import { MemoryEntry, MemoryQuery } from '../utils/types.js';
import { ILogger } from '../core/logger.js';

interface Index<T> {
  get(key: T): Set<string>;
  add(key: T, entryId: string): void;
  remove(key: T, entryId: string): void;
  clear(): void;
}

/**
 * Simple index implementation
 */
class SimpleIndex<T> implements Index<T> {
  private index = new Map<T, Set<string>>();

  get(key: T): Set<string> {
    return this.index.get(key) || new Set();
  }

  add(key: T, entryId: string): void {
    if (!this.index.has(key)) {
      this.index.set(key, new Set());
    }
    this.index.get(key)!.add(entryId);
  }

  remove(key: T, entryId: string): void {
    const set = this.index.get(key);
    if (set) {
      set.delete(entryId);
      if (set.size === 0) {
        this.index.delete(key);
      }
    }
  }

  clear(): void {
    this.index.clear();
  }

  keys(): T[] {
    return Array.from(this.index.keys());
  }
}

/**
 * Memory indexer for efficient querying
 */
export class MemoryIndexer {
  private entries = new Map<string, MemoryEntry>();
  private agentIndex = new SimpleIndex<string>();
  private sessionIndex = new SimpleIndex<string>();
  private typeIndex = new SimpleIndex<string>();
  private tagIndex = new SimpleIndex<string>();
  private timeIndex = new Map<string, number>(); // id -> timestamp

  constructor(private logger: ILogger) {}

  /**
   * Builds index from a list of entries
   */
  async buildIndex(entries: MemoryEntry[]): Promise<void> {
    this.logger.info('Building memory index', { entries: entries.length });

    this.clear();

    for (const entry of entries) {
      this.addEntry(entry);
    }

    this.logger.info('Memory index built', { 
      totalEntries: this.entries.size,
      agents: this.agentIndex.keys().length,
      sessions: this.sessionIndex.keys().length,
      types: this.typeIndex.keys().length,
      tags: this.tagIndex.keys().length,
    });
  }

  /**
   * Adds an entry to the index
   */
  addEntry(entry: MemoryEntry): void {
    // Store entry
    this.entries.set(entry.id, entry);

    // Update indexes
    this.agentIndex.add(entry.agentId, entry.id);
    this.sessionIndex.add(entry.sessionId, entry.id);
    this.typeIndex.add(entry.type, entry.id);
    
    for (const tag of entry.tags) {
      this.tagIndex.add(tag, entry.id);
    }

    this.timeIndex.set(entry.id, entry.timestamp.getTime());
  }

  /**
   * Updates an entry in the index
   */
  updateEntry(entry: MemoryEntry): void {
    const existing = this.entries.get(entry.id);
    if (existing) {
      this.removeEntry(entry.id);
    }
    this.addEntry(entry);
  }

  /**
   * Removes an entry from the index
   */
  removeEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }

    // Remove from indexes
    this.agentIndex.remove(entry.agentId, id);
    this.sessionIndex.remove(entry.sessionId, id);
    this.typeIndex.remove(entry.type, id);
    
    for (const tag of entry.tags) {
      this.tagIndex.remove(tag, id);
    }

    this.timeIndex.delete(id);
    this.entries.delete(id);
  }

  /**
   * Searches entries using the index
   */
  search(query: MemoryQuery): MemoryEntry[] {
    let resultIds: Set<string> | undefined;

    // Apply index-based filters
    if (query.agentId) {
      resultIds = this.intersectSets(resultIds, this.agentIndex.get(query.agentId));
    }

    if (query.sessionId) {
      resultIds = this.intersectSets(resultIds, this.sessionIndex.get(query.sessionId));
    }

    if (query.type) {
      resultIds = this.intersectSets(resultIds, this.typeIndex.get(query.type));
    }

    if (query.tags && query.tags.length > 0) {
      const tagSets = query.tags.map(tag => this.tagIndex.get(tag));
      const unionSet = this.unionSets(...tagSets);
      resultIds = this.intersectSets(resultIds, unionSet);
    }

    // If no filters applied, get all entries
    if (!resultIds) {
      resultIds = new Set(this.entries.keys());
    }

    // Convert IDs to entries
    const results: MemoryEntry[] = [];
    for (const id of resultIds) {
      const entry = this.entries.get(id);
      if (entry) {
        results.push(entry);
      }
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return results;
  }

  /**
   * Gets index metrics
   */
  getMetrics(): {
    totalEntries: number;
    indexSizes: Record<string, number>;
  } {
    return {
      totalEntries: this.entries.size,
      indexSizes: {
        agents: this.agentIndex.keys().length,
        sessions: this.sessionIndex.keys().length,
        types: this.typeIndex.keys().length,
        tags: this.tagIndex.keys().length,
      },
    };
  }

  /**
   * Clears all indexes
   */
  clear(): void {
    this.entries.clear();
    this.agentIndex.clear();
    this.sessionIndex.clear();
    this.typeIndex.clear();
    this.tagIndex.clear();
    this.timeIndex.clear();
  }

  private intersectSets(
    set1: Set<string> | undefined,
    set2: Set<string>,
  ): Set<string> {
    if (!set1) {
      return new Set(set2);
    }

    const result = new Set<string>();
    for (const item of set1) {
      if (set2.has(item)) {
        result.add(item);
      }
    }
    return result;
  }

  private unionSets(...sets: Set<string>[]): Set<string> {
    const result = new Set<string>();
    for (const set of sets) {
      for (const item of set) {
        result.add(item);
      }
    }
    return result;
  }
}