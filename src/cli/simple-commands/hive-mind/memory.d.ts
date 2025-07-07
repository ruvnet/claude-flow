/**
 * Type declarations for memory.js
 */

export interface MemoryEntry {
  id: string;
  type: string;
  content: any;
  priority: number;
  timestamp: number;
  ttl?: number;
  tags?: string[];
}

export interface MemoryStats {
  totalEntries: number;
  memoryUsage: number;
  cacheHitRate: number;
}

export declare class CollectiveMemory {
  constructor(options?: any);
  store(type: string, content: any, tags?: string[]): Promise<string>;
  retrieve(id: string): Promise<MemoryEntry | null>;
  search(query: any): Promise<MemoryEntry[]>;
  getStats(): MemoryStats;
  optimize(): Promise<void>;
  compress(): Promise<void>;
  cleanup(): Promise<void>;
}

export declare class MemoryOptimizer {
  constructor(memory: CollectiveMemory);
  optimize(): Promise<void>;
  analyzePerformance(): Promise<any>;
  suggestOptimizations(): Promise<any[]>;
}