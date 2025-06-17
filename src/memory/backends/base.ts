/**
 * Base interface for memory backends
 */

import { MemoryEntry, MemoryQuery } from '../../utils/types.js';

export interface IMemoryBackend {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  store(entry: MemoryEntry): Promise<void>;
  retrieve(id: string): Promise<MemoryEntry | undefined>;
  update(id: string, entry: MemoryEntry): Promise<void>;
  delete(id: string): Promise<void>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
  getAllEntries(): Promise<MemoryEntry[]>;
  getHealthStatus(): Promise<{ 
    healthy: boolean; 
    error?: string; 
    metrics?: Record<string, number>;
  }>;
  performMaintenance?(): Promise<void>;
}