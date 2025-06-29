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
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
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
          this.logger.debug('Removed dead terminal from pool', { terminalId });
        }
      }

      // No available terminals, create new one if under limit
      if (this.terminals.size < this.maxSize) {
        try {
          await this.createPooledTerminal();
          // Don't recurse - continue the loop to check available queue again
          continue;
        } catch (error) {
          this.logger.error('Failed to create new terminal', error);
          retryCount++;
          if (retryCount >= maxRetries) {
            throw new TerminalError(`Failed to create terminal after ${maxRetries} attempts`);
          }
          await delay(1000 * retryCount); // Exponential backoff
          continue;
        }
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
          this.logger.debug('Terminal acquired after waiting', { 
            terminalId: available.terminal.id,
            waitTime: Date.now() - startTime
          });
          return available.terminal;
        }
      }

      // Timeout occurred, try to cleanup and retry
      retryCount++;
      if (retryCount < maxRetries) {
        this.logger.warn(`Terminal acquisition timeout, retrying (${retryCount}/${maxRetries})`);
        await this.performMaintenance();
        await delay(1000 * retryCount);
      }
    }

    throw new TerminalError('No terminal available in pool (timeout after retries)');
  }

  async release(terminal: Terminal): Promise<void> {
    const pooled = this.terminals.get(terminal.id);
    if (!pooled) {
      this.logger.warn('Attempted to release unknown terminal', { 
        terminalId: terminal.id,
      });
      return;
    }

    if (!pooled.inUse) {
      this.logger.warn('Attempted to release terminal that is not in use', { 
        terminalId: terminal.id,
      });
      return;
    }

    pooled.useCount++;
    pooled.inUse = false;
    pooled.lastUsed = new Date();

    try {
      // Check if terminal should be recycled
      if (pooled.useCount >= this.recycleAfter || !terminal.isAlive()) {
        this.logger.info('Recycling terminal', { 
          terminalId: terminal.id,
          useCount: pooled.useCount,
          reason: pooled.useCount >= this.recycleAfter ? 'useCount' : 'notAlive'
        });

        // Destroy old terminal
        this.terminals.delete(terminal.id);
        
        try {
          await this.adapter.destroyTerminal(terminal);
        } catch (error) {
          this.logger.error('Error destroying terminal during release', { 
            terminalId: terminal.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }

        // Create replacement if under minimum threshold
        const minSize = Math.min(2, this.maxSize);
        if (this.terminals.size < minSize) {
          try {
            await this.createPooledTerminal();
          } catch (error) {
            this.logger.error('Failed to create replacement terminal', { 
              error: error instanceof Error ? error.message : 'Unknown error',
              currentSize: this.terminals.size,
              minSize
            });
          }
        }
      } else {
        // Validate terminal is still healthy before returning to pool
        if (!terminal.isAlive()) {
          this.logger.warn('Terminal died after use, removing from pool', { 
            terminalId: terminal.id 
          });
          this.terminals.delete(terminal.id);
          return;
        }

        // Return to available queue
        this.availableQueue.push(terminal.id);
        
        this.logger.debug('Terminal returned to pool', { 
          terminalId: terminal.id,
          useCount: pooled.useCount,
          availableCount: this.availableQueue.length
        });
      }
    } catch (error) {
      this.logger.error('Error during terminal release', { 
        terminalId: terminal.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Ensure terminal is removed from pool if there was an error
      this.terminals.delete(terminal.id);
      const index = this.availableQueue.indexOf(terminal.id);
      if (index !== -1) {
        this.availableQueue.splice(index, 1);
      }
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

    try {
      // Remove dead terminals
      const deadTerminals: string[] = [];
      for (const [id, pooled] of this.terminals.entries()) {
        try {
          if (!pooled.terminal.isAlive()) {
            deadTerminals.push(id);
          }
        } catch (error) {
          this.logger.warn('Error checking terminal health, marking as dead', { 
            terminalId: id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          deadTerminals.push(id);
        }
      }

      // Clean up dead terminals
      for (const id of deadTerminals) {
        this.logger.warn('Removing dead terminal from pool', { terminalId: id });
        const pooled = this.terminals.get(id);
        this.terminals.delete(id);
        
        // Remove from available queue
        const index = this.availableQueue.indexOf(id);
        if (index !== -1) {
          this.availableQueue.splice(index, 1);
        }
        
        // Try to destroy the terminal
        if (pooled) {
          try {
            await this.adapter.destroyTerminal(pooled.terminal);
          } catch (error) {
            this.logger.error('Error destroying dead terminal', { 
              terminalId: id,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
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

        // Create terminals one by one to handle failures gracefully
        for (let i = 0; i < toCreate; i++) {
          try {
            await this.createPooledTerminal();
          } catch (error) {
            this.logger.error('Failed to create replacement terminal during maintenance', { 
              attempt: i + 1,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            // Continue trying to create other terminals
          }
        }
      }

      // Check for stale terminals that should be recycled
      const now = Date.now();
      const staleTimeout = 300000; // 5 minutes
      const staleTerminals: string[] = [];
      
      for (const [id, pooled] of this.terminals.entries()) {
        if (!pooled.inUse) {
          try {
            if (pooled.terminal.isAlive()) {
              const idleTime = now - pooled.lastUsed.getTime();
              if (idleTime > staleTimeout && pooled.useCount < this.recycleAfter) {
                staleTerminals.push(id);
              }
            }
          } catch (error) {
            this.logger.warn('Error checking terminal for staleness', { 
              terminalId: id,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      }
      
      // Mark stale terminals for recycling
      for (const id of staleTerminals) {
        const pooled = this.terminals.get(id);
        if (pooled) {
          const idleTime = now - pooled.lastUsed.getTime();
          this.logger.info('Marking stale terminal for recycling', { 
            terminalId: id, 
            idleTime,
          });
          
          // Mark for recycling by setting use count
          pooled.useCount = this.recycleAfter;
        }
      }

      // Log maintenance summary
      this.logger.debug('Terminal pool maintenance completed', {
        deadTerminalsRemoved: deadTerminals.length,
        staleTerminalsMarked: staleTerminals.length,
        currentSize: this.terminals.size,
        availableCount: this.availableQueue.length
      });

    } catch (error) {
      this.logger.error('Error during terminal pool maintenance', { 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
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