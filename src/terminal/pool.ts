/**
 * Terminal pool management
 */

import { Terminal, ITerminalAdapter } from './adapters/base.js';
import { ILogger } from '../core/logger.js';
import { TerminalError } from '../utils/errors.js';
import { delay } from '../utils/helpers.js';

interface PooledTerminal {
  terminal: Terminal;
  useCount: number;
  lastUsed: Date;
  inUse: boolean;
}

/**
 * Terminal pool for efficient resource management
 */
export class TerminalPool {
  private terminals = new Map<string, PooledTerminal>();
  private availableQueue: string[] = [];
  private initializationPromise?: Promise<void>;

  constructor(
    private maxSize: number,
    private recycleAfter: number,
    private adapter: ITerminalAdapter,
    private logger: ILogger,
  ) {}

  async initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.doInitialize();
    return this.initializationPromise;
  }

  private async doInitialize(): Promise<void> {
    this.logger.info('Initializing terminal pool', { 
      maxSize: this.maxSize,
      recycleAfter: this.recycleAfter,
    });

    // Pre-create some terminals
    const preCreateCount = Math.min(2, this.maxSize);
    const promises: Promise<void>[] = [];

    for (let i = 0; i < preCreateCount; i++) {
      promises.push(this.createPooledTerminal());
    }

    await Promise.all(promises);
    
    this.logger.info('Terminal pool initialized', { 
      created: preCreateCount,
    });
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down terminal pool');

    // Destroy all terminals
    const terminals = Array.from(this.terminals.values());
    await Promise.all(
      terminals.map(({ terminal }) => this.adapter.destroyTerminal(terminal)),
    );

    this.terminals.clear();
    this.availableQueue = [];
  }

  async acquire(): Promise<Terminal> {
    // Try to get an available terminal
    while (this.availableQueue.length > 0) {
      const terminalId = this.availableQueue.shift()!;
      const pooled = this.terminals.get(terminalId);

      if (pooled && pooled.terminal.isAlive()) {
        pooled.inUse = true;
        pooled.lastUsed = new Date();
        
        this.logger.debug('Terminal acquired from pool', { 
          terminalId,
          useCount: pooled.useCount,
        });

        return pooled.terminal;
      }

      // Terminal is dead, remove it
      if (pooled) {
        this.terminals.delete(terminalId);
      }
    }

    // No available terminals, create new one if under limit
    if (this.terminals.size < this.maxSize) {
      await this.createPooledTerminal();
      return this.acquire(); // Recursive call to get the newly created terminal
    }

    // Pool is full, wait for a terminal to become available
    this.logger.info('Terminal pool full, waiting for available terminal');
    
    const startTime = Date.now();
    const timeout = 30000; // 30 seconds

    while (Date.now() - startTime < timeout) {
      await delay(100);

      // Check if any terminal became available
      const available = Array.from(this.terminals.values()).find(
        (pooled) => !pooled.inUse && pooled.terminal.isAlive(),
      );

      if (available) {
        available.inUse = true;
        available.lastUsed = new Date();
        return available.terminal;
      }
    }

    throw new TerminalError('No terminal available in pool (timeout)');
  }

  async release(terminal: Terminal): Promise<void> {
    const pooled = this.terminals.get(terminal.id);
    if (!pooled) {
      this.logger.warn('Attempted to release unknown terminal', { 
        terminalId: terminal.id,
      });
      return;
    }

    pooled.useCount++;
    pooled.inUse = false;

    // Check if terminal should be recycled
    if (pooled.useCount >= this.recycleAfter || !terminal.isAlive()) {
      this.logger.info('Recycling terminal', { 
        terminalId: terminal.id,
        useCount: pooled.useCount,
      });

      // Destroy old terminal
      this.terminals.delete(terminal.id);
      await this.adapter.destroyTerminal(terminal);

      // Create replacement if under limit
      if (this.terminals.size < this.maxSize) {
        await this.createPooledTerminal();
      }
    } else {
      // Return to available queue
      this.availableQueue.push(terminal.id);
      
      this.logger.debug('Terminal returned to pool', { 
        terminalId: terminal.id,
        useCount: pooled.useCount,
      });
    }
  }

  async getHealthStatus(): Promise<{
    healthy: boolean;
    size: number;
    available: number;
    recycled: number;
  }> {
    const aliveTerminals = Array.from(this.terminals.values()).filter(
      (pooled) => pooled.terminal.isAlive(),
    );

    const available = aliveTerminals.filter((pooled) => !pooled.inUse).length;
    const recycled = Array.from(this.terminals.values()).filter(
      (pooled) => pooled.useCount >= this.recycleAfter,
    ).length;

    return {
      healthy: aliveTerminals.length > 0,
      size: this.terminals.size,
      available,
      recycled,
    };
  }

  async performMaintenance(): Promise<void> {
    this.logger.debug('Performing terminal pool maintenance');

    // Remove dead terminals
    const deadTerminals: string[] = [];
    for (const [id, pooled] of this.terminals.entries()) {
      if (!pooled.terminal.isAlive()) {
        deadTerminals.push(id);
      }
    }

    // Clean up dead terminals
    for (const id of deadTerminals) {
      this.logger.warn('Removing dead terminal from pool', { terminalId: id });
      this.terminals.delete(id);
      const index = this.availableQueue.indexOf(id);
      if (index !== -1) {
        this.availableQueue.splice(index, 1);
      }
    }

    // Ensure minimum pool size
    const currentSize = this.terminals.size;
    const minSize = Math.min(2, this.maxSize);
    
    if (currentSize < minSize) {
      const toCreate = minSize - currentSize;
      this.logger.info('Replenishing terminal pool', { 
        currentSize, 
        minSize, 
        creating: toCreate,
      });

      const promises: Promise<void>[] = [];
      for (let i = 0; i < toCreate; i++) {
        promises.push(this.createPooledTerminal());
      }
      
      await Promise.all(promises);
    }

    // Check for stale terminals that should be recycled
    const now = Date.now();
    const staleTimeout = 300000; // 5 minutes
    
    for (const [id, pooled] of this.terminals.entries()) {
      if (!pooled.inUse && pooled.terminal.isAlive()) {
        const idleTime = now - pooled.lastUsed.getTime();
        if (idleTime > staleTimeout) {
          this.logger.info('Recycling stale terminal', { 
            terminalId: id, 
            idleTime,
          });
          
          // Mark for recycling
          pooled.useCount = this.recycleAfter;
        }
      }
    }
  }

  private async createPooledTerminal(): Promise<void> {
    try {
      const terminal = await this.adapter.createTerminal();
      
      const pooled: PooledTerminal = {
        terminal,
        useCount: 0,
        lastUsed: new Date(),
        inUse: false,
      };

      this.terminals.set(terminal.id, pooled);
      this.availableQueue.push(terminal.id);

      this.logger.debug('Created pooled terminal', { terminalId: terminal.id });
    } catch (error) {
      this.logger.error('Failed to create pooled terminal', error);
      throw error;
    }
  }
}