#!/usr/bin/env node

/**
 * NPX Cache Manager
 * 
 * Provides a locking mechanism for NPX commands to prevent concurrent cache conflicts
 * when multiple claude-flow instances are running simultaneously.
 * 
 * This solves the ENOTEMPTY error that occurs when multiple NPX processes try to
 * access the same cache directory at the same time.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lock file configuration
const LOCK_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.claude-flow', 'locks');
const NPX_LOCK_FILE = path.join(LOCK_DIR, 'npx.lock');
const LOCK_TIMEOUT = 30000; // 30 seconds timeout
const RETRY_INTERVAL = 100; // 100ms between retries
const MAX_RETRIES = 300; // Max 30 seconds of retrying

class NpxCacheManager {
  constructor() {
    this.lockId = crypto.randomBytes(16).toString('hex');
    this.isLocked = false;
  }

  /**
   * Ensures the lock directory exists
   */
  async ensureLockDir() {
    try {
      await fs.mkdir(LOCK_DIR, { recursive: true });
    } catch (error) {
      // Directory might already exist, that's fine
    }
  }

  /**
   * Acquires an exclusive lock for NPX operations
   * @param {number} retries - Number of retries attempted
   * @returns {Promise<boolean>} - True if lock acquired, false otherwise
   */
  async acquireLock(retries = 0) {
    await this.ensureLockDir();

    try {
      // Check if lock exists and if it's expired
      const lockExists = await this.checkLockExists();
      if (lockExists) {
        const lockData = await this.readLock();
        if (lockData && this.isLockExpired(lockData.timestamp)) {
          // Lock is expired, remove it
          await this.releaseLock(true);
        } else if (retries < MAX_RETRIES) {
          // Lock is held by another process, retry
          await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
          return this.acquireLock(retries + 1);
        } else {
          // Max retries reached
          console.error('Failed to acquire NPX lock after maximum retries');
          return false;
        }
      }

      // Try to create the lock
      const lockData = {
        id: this.lockId,
        pid: process.pid,
        timestamp: Date.now(),
        command: process.argv.join(' ')
      };

      await fs.writeFile(NPX_LOCK_FILE, JSON.stringify(lockData, null, 2), { flag: 'wx' });
      this.isLocked = true;
      
      // Set up cleanup on process exit
      this.setupCleanup();
      
      return true;
    } catch (error) {
      if (error.code === 'EEXIST' && retries < MAX_RETRIES) {
        // Lock file already exists, retry
        await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
        return this.acquireLock(retries + 1);
      }
      
      console.error('Error acquiring NPX lock:', error.message);
      return false;
    }
  }

  /**
   * Releases the NPX lock
   * @param {boolean} force - Force release even if not owned by this process
   */
  async releaseLock(force = false) {
    try {
      if (!force && !this.isLocked) {
        return;
      }

      if (!force) {
        // Verify we own the lock
        const lockData = await this.readLock();
        if (!lockData || lockData.id !== this.lockId) {
          console.warn('Attempted to release lock not owned by this process');
          return;
        }
      }

      await fs.unlink(NPX_LOCK_FILE);
      this.isLocked = false;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error releasing NPX lock:', error.message);
      }
    }
  }

  /**
   * Checks if a lock file exists
   */
  async checkLockExists() {
    try {
      await fs.access(NPX_LOCK_FILE);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads lock file data
   */
  async readLock() {
    try {
      const data = await fs.readFile(NPX_LOCK_FILE, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Checks if a lock is expired
   */
  isLockExpired(timestamp) {
    return Date.now() - timestamp > LOCK_TIMEOUT;
  }

  /**
   * Sets up cleanup handlers
   */
  setupCleanup() {
    const cleanup = async () => {
      await this.releaseLock();
      process.exit();
    };

    process.on('exit', () => this.releaseLock());
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', async (error) => {
      console.error('Uncaught exception:', error);
      await this.releaseLock();
      process.exit(1);
    });
  }

  /**
   * Executes a function with NPX lock protection
   * @param {Function} fn - Function to execute
   * @returns {Promise<any>} - Result of the function
   */
  async withLock(fn) {
    const acquired = await this.acquireLock();
    if (!acquired) {
      throw new Error('Failed to acquire NPX lock');
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Gets current lock status
   */
  async getLockStatus() {
    const exists = await this.checkLockExists();
    if (!exists) {
      return { locked: false };
    }

    const lockData = await this.readLock();
    if (!lockData) {
      return { locked: false };
    }

    return {
      locked: true,
      expired: this.isLockExpired(lockData.timestamp),
      pid: lockData.pid,
      command: lockData.command,
      age: Date.now() - lockData.timestamp
    };
  }
}

// Export singleton instance
export const npxCacheManager = new NpxCacheManager();

// Also export the class for testing
export { NpxCacheManager };