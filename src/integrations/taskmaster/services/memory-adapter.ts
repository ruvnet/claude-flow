/**
 * Memory Adapter for TaskMaster Services
 * Provides a consistent interface for memory operations
 */

import { SimpleMemoryManager } from '../../../cli/commands/memory.ts';

export class MemoryService {
  private memory: SimpleMemoryManager;
  
  constructor() {
    this.memory = new SimpleMemoryManager();
  }
  
  async get(key: string, namespace: string = 'default'): Promise<any> {
    const result = await this.memory.retrieve(key, namespace);
    return result ? JSON.parse(result) : null;
  }
  
  async set(key: string, value: any, namespace: string = 'default'): Promise<void> {
    await this.memory.store(key, JSON.stringify(value), namespace);
  }
  
  async delete(key: string, namespace: string = 'default'): Promise<boolean> {
    // SimpleMemoryManager doesn't have delete, so we'll set to null
    await this.memory.store(key, 'null', namespace);
    return true;
  }
  
  async list(namespace: string = 'default', prefix?: string): Promise<string[]> {
    const entries = await this.memory.query(prefix || '', namespace);
    return entries.map(e => e.key);
  }
  
  async clear(namespace: string = 'default'): Promise<void> {
    // Get all entries and delete them
    const entries = await this.memory.query('', namespace);
    for (const entry of entries) {
      await this.delete(entry.key, namespace);
    }
  }
}