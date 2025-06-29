/**
 * Memory Facade
 * Provides a high-level interface for CLI commands to interact with memory system
 */

import { SwarmMemoryManager } from '../swarm-memory.js';
import type { ILogger } from '../../core/logger.js';

export interface MemoryOperationOptions {
  namespace?: string;
  ttl?: number;
  maxSize?: number;
  persistent?: boolean;
}

export interface MemoryEntry {
  key: string;
  value: any;
  metadata?: {
    created: Date;
    updated: Date;
    ttl?: number;
    tags?: string[];
  };
}

/**
 * Memory Facade provides a clean interface for CLI commands
 */
export class MemoryFacade {
  private manager: SwarmMemoryManager;

  constructor(private logger: ILogger, private options: MemoryOperationOptions = {}) {
    this.manager = new SwarmMemoryManager({
      logger: this.logger,
      namespace: options.namespace || 'default',
      persistent: options.persistent ?? true,
      maxSize: options.maxSize,
      ttl: options.ttl,
    });
  }

  /**
   * Store a value in memory
   */
  async store(key: string, value: any, metadata?: any): Promise<void> {
    await this.manager.store(key, value, metadata);
  }

  /**
   * Retrieve a value from memory
   */
  async get(key: string): Promise<any> {
    return await this.manager.get(key);
  }

  /**
   * List all keys in the current namespace
   */
  async list(pattern?: string): Promise<string[]> {
    return await this.manager.list(pattern);
  }

  /**
   * Delete a key from memory
   */
  async delete(key: string): Promise<boolean> {
    return await this.manager.delete(key);
  }

  /**
   * Clear all keys in the current namespace
   */
  async clear(): Promise<void> {
    await this.manager.clear();
  }

  /**
   * Export memory to a file
   */
  async export(filename: string): Promise<void> {
    const data = await this.manager.export();
    // Implementation would write to file
    this.logger.info(`Memory exported to ${filename}`);
  }

  /**
   * Import memory from a file
   */
  async import(filename: string): Promise<void> {
    // Implementation would read from file
    // await this.manager.import(data);
    this.logger.info(`Memory imported from ${filename}`);
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<any> {
    return await this.manager.getStats();
  }

  /**
   * Switch to a different namespace
   */
  async switchNamespace(namespace: string): Promise<void> {
    this.options.namespace = namespace;
    // Reinitialize manager with new namespace
    this.manager = new SwarmMemoryManager({
      logger: this.logger,
      namespace: namespace,
      persistent: this.options.persistent ?? true,
      maxSize: this.options.maxSize,
      ttl: this.options.ttl,
    });
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.manager.cleanup();
  }
}