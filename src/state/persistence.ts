/**
 * State Persistence Manager
 * Handles saving and loading state to various backends
 */

import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { Logger } from '../core/logger.js';
import type {
  UnifiedSystemState,
  StateSnapshot,
  PersistenceBackend,
  StatePersistenceConfig
} from './types.js';

/**
 * File system persistence backend
 */
export class FileSystemPersistenceBackend implements PersistenceBackend {
  name = 'filesystem';
  private logger: Logger;
  private filePath: string;
  private snapshotDir: string;

  constructor(filePath: string = './.claude-flow/state.json') {
    this.filePath = filePath;
    this.snapshotDir = join(dirname(filePath), 'snapshots');
    this.logger = new Logger({
      level: 'info',
      format: 'json',
      destination: 'console'
    }, { component: 'FileSystemPersistenceBackend' });
  }

  async save(state: UnifiedSystemState): Promise<void> {
    try {
      await this.ensureDirectoryExists(dirname(this.filePath));
      
      // Convert Maps and Sets to serializable format
      const serializable = this.prepareForSerialization(state);
      const json = JSON.stringify(serializable, null, 2);
      
      await fs.writeFile(this.filePath, json, 'utf8');
      this.logger.debug('State saved to filesystem', { 
        filePath: this.filePath,
        size: json.length
      });
    } catch (error) {
      this.logger.error('Failed to save state to filesystem', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        filePath: this.filePath
      });
      throw error;
    }
  }

  async load(): Promise<UnifiedSystemState | null> {
    try {
      const json = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(json);
      
      // Convert serialized data back to Maps and Sets
      const state = this.prepareFromSerialization(data);
      
      this.logger.debug('State loaded from filesystem', { 
        filePath: this.filePath,
        size: json.length
      });
      
      return state;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        this.logger.info('State file not found', { filePath: this.filePath });
        return null;
      }
      
      this.logger.error('Failed to load state from filesystem', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        filePath: this.filePath
      });
      throw error;
    }
  }

  async saveSnapshot(snapshot: StateSnapshot): Promise<void> {
    try {
      await this.ensureDirectoryExists(this.snapshotDir);
      
      const snapshotPath = join(this.snapshotDir, `${snapshot.id}.json`);
      const serializable = this.prepareForSerialization(snapshot);
      const json = JSON.stringify(serializable, null, 2);
      
      await fs.writeFile(snapshotPath, json, 'utf8');
      this.logger.debug('Snapshot saved to filesystem', { 
        snapshotId: snapshot.id,
        filePath: snapshotPath,
        size: json.length
      });
    } catch (error) {
      this.logger.error('Failed to save snapshot to filesystem', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        snapshotId: snapshot.id
      });
      throw error;
    }
  }

  async loadSnapshot(id: string): Promise<StateSnapshot | null> {
    try {
      const snapshotPath = join(this.snapshotDir, `${id}.json`);
      const json = await fs.readFile(snapshotPath, 'utf8');
      const data = JSON.parse(json);
      
      const snapshot = this.prepareFromSerialization(data);
      
      this.logger.debug('Snapshot loaded from filesystem', { 
        snapshotId: id,
        filePath: snapshotPath
      });
      
      return snapshot;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        this.logger.info('Snapshot file not found', { snapshotId: id });
        return null;
      }
      
      this.logger.error('Failed to load snapshot from filesystem', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        snapshotId: id
      });
      throw error;
    }
  }

  async listSnapshots(): Promise<StateSnapshot[]> {
    try {
      const files = await fs.readdir(this.snapshotDir);
      const snapshots: StateSnapshot[] = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = file.replace('.json', '');
          const snapshot = await this.loadSnapshot(id);
          if (snapshot) {
            snapshots.push(snapshot);
          }
        }
      }
      
      // Sort by timestamp (newest first)
      snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      this.logger.debug('Listed snapshots from filesystem', { 
        count: snapshots.length 
      });
      
      return snapshots;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      
      this.logger.error('Failed to list snapshots from filesystem', { 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async deleteSnapshot(id: string): Promise<void> {
    try {
      const snapshotPath = join(this.snapshotDir, `${id}.json`);
      await fs.unlink(snapshotPath);
      
      this.logger.debug('Snapshot deleted from filesystem', { 
        snapshotId: id,
        filePath: snapshotPath
      });
    } catch (error) {
      this.logger.error('Failed to delete snapshot from filesystem', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        snapshotId: id
      });
      throw error;
    }
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      // Ignore error if directory already exists
      if (error instanceof Error && 'code' in error && error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private prepareForSerialization(obj: any): any {
    if (obj instanceof Date) {
      return { __type: 'Date', value: obj.toISOString() };
    }
    
    if (obj instanceof Map) {
      return {
        __type: 'Map',
        value: Array.from(obj.entries()).map(([k, v]) => [k, this.prepareForSerialization(v)])
      };
    }
    
    if (obj instanceof Set) {
      return {
        __type: 'Set',
        value: Array.from(obj).map(v => this.prepareForSerialization(v))
      };
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.prepareForSerialization(item));
    }
    
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.prepareForSerialization(value);
      }
      return result;
    }
    
    return obj;
  }

  private prepareFromSerialization(obj: any): any {
    if (obj && typeof obj === 'object' && obj.__type) {
      switch (obj.__type) {
        case 'Date':
          return new Date(obj.value);
        case 'Map':
          return new Map(obj.value.map(([k, v]: [any, any]) => [k, this.prepareFromSerialization(v)]));
        case 'Set':
          return new Set(obj.value.map((v: any) => this.prepareFromSerialization(v)));
      }
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.prepareFromSerialization(item));
    }
    
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.prepareFromSerialization(value);
      }
      return result;
    }
    
    return obj;
  }
}

/**
 * Memory persistence backend (for testing)
 */
export class MemoryPersistenceBackend implements PersistenceBackend {
  name = 'memory';
  private logger: Logger;
  private state: UnifiedSystemState | null = null;
  private snapshots: Map<string, StateSnapshot> = new Map();

  constructor() {
    this.logger = new Logger({
      level: 'info',
      format: 'json',
      destination: 'console'
    }, { component: 'MemoryPersistenceBackend' });
  }

  async save(state: UnifiedSystemState): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state)); // Deep clone
    this.logger.debug('State saved to memory');
  }

  async load(): Promise<UnifiedSystemState | null> {
    if (this.state) {
      this.logger.debug('State loaded from memory');
      return JSON.parse(JSON.stringify(this.state)); // Deep clone
    }
    return null;
  }

  async saveSnapshot(snapshot: StateSnapshot): Promise<void> {
    this.snapshots.set(snapshot.id, JSON.parse(JSON.stringify(snapshot))); // Deep clone
    this.logger.debug('Snapshot saved to memory', { snapshotId: snapshot.id });
  }

  async loadSnapshot(id: string): Promise<StateSnapshot | null> {
    const snapshot = this.snapshots.get(id);
    if (snapshot) {
      this.logger.debug('Snapshot loaded from memory', { snapshotId: id });
      return JSON.parse(JSON.stringify(snapshot)); // Deep clone
    }
    return null;
  }

  async listSnapshots(): Promise<StateSnapshot[]> {
    const snapshots = Array.from(this.snapshots.values());
    snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    this.logger.debug('Listed snapshots from memory', { count: snapshots.length });
    return snapshots.map(s => JSON.parse(JSON.stringify(s))); // Deep clone
  }

  async deleteSnapshot(id: string): Promise<void> {
    this.snapshots.delete(id);
    this.logger.debug('Snapshot deleted from memory', { snapshotId: id });
  }
}

/**
 * State Persistence Manager
 */
export class StatePersistenceManager {
  private logger: Logger;
  private backends: Map<string, PersistenceBackend> = new Map();
  private config: StatePersistenceConfig;
  private autoSaveInterval?: NodeJS.Timeout;

  constructor(config: StatePersistenceConfig) {
    this.config = config;
    this.logger = new Logger({
      level: 'info',
      format: 'json',
      destination: 'console'
    }, { component: 'StatePersistenceManager' });

    // Register backends
    config.backends.forEach(backend => {
      this.backends.set(backend.name, backend);
    });

    this.logger.info('State persistence manager initialized', {
      backends: Array.from(this.backends.keys()),
      primaryBackend: config.primaryBackend
    });
  }

  /**
   * Save state to all backends
   */
  async save(state: UnifiedSystemState): Promise<void> {
    const errors: Error[] = [];

    for (const backend of this.backends.values()) {
      try {
        await backend.save(state);
      } catch (error) {
        this.logger.error('Backend save failed', {
          backend: backend.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        errors.push(error instanceof Error ? error : new Error('Unknown error'));
      }
    }

    if (errors.length === this.backends.size) {
      throw new Error(`All backends failed to save state: ${errors.map(e => e.message).join(', ')}`);
    }

    this.logger.debug('State saved to persistence backends', {
      successCount: this.backends.size - errors.length,
      errorCount: errors.length
    });
  }

  /**
   * Load state from primary backend
   */
  async load(): Promise<UnifiedSystemState | null> {
    const primaryBackend = this.backends.get(this.config.primaryBackend);
    if (!primaryBackend) {
      throw new Error(`Primary backend '${this.config.primaryBackend}' not found`);
    }

    try {
      const state = await primaryBackend.load();
      if (state) {
        this.logger.info('State loaded from primary backend', {
          backend: this.config.primaryBackend
        });
        return state;
      }
    } catch (error) {
      this.logger.error('Primary backend load failed', {
        backend: this.config.primaryBackend,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Try fallback backends
    for (const [name, backend] of this.backends) {
      if (name === this.config.primaryBackend) continue;

      try {
        const state = await backend.load();
        if (state) {
          this.logger.warn('State loaded from fallback backend', {
            backend: name
          });
          return state;
        }
      } catch (error) {
        this.logger.error('Fallback backend load failed', {
          backend: name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    this.logger.info('No state found in any backend');
    return null;
  }

  /**
   * Save snapshot to all backends
   */
  async saveSnapshot(snapshot: StateSnapshot): Promise<void> {
    const errors: Error[] = [];

    for (const backend of this.backends.values()) {
      try {
        await backend.saveSnapshot(snapshot);
      } catch (error) {
        this.logger.error('Backend snapshot save failed', {
          backend: backend.name,
          snapshotId: snapshot.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        errors.push(error instanceof Error ? error : new Error('Unknown error'));
      }
    }

    if (errors.length === this.backends.size) {
      throw new Error(`All backends failed to save snapshot: ${errors.map(e => e.message).join(', ')}`);
    }

    this.logger.debug('Snapshot saved to persistence backends', {
      snapshotId: snapshot.id,
      successCount: this.backends.size - errors.length,
      errorCount: errors.length
    });
  }

  /**
   * Load snapshot from primary backend
   */
  async loadSnapshot(id: string): Promise<StateSnapshot | null> {
    const primaryBackend = this.backends.get(this.config.primaryBackend);
    if (!primaryBackend) {
      throw new Error(`Primary backend '${this.config.primaryBackend}' not found`);
    }

    try {
      const snapshot = await primaryBackend.loadSnapshot(id);
      if (snapshot) {
        this.logger.debug('Snapshot loaded from primary backend', {
          backend: this.config.primaryBackend,
          snapshotId: id
        });
        return snapshot;
      }
    } catch (error) {
      this.logger.error('Primary backend snapshot load failed', {
        backend: this.config.primaryBackend,
        snapshotId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Try fallback backends
    for (const [name, backend] of this.backends) {
      if (name === this.config.primaryBackend) continue;

      try {
        const snapshot = await backend.loadSnapshot(id);
        if (snapshot) {
          this.logger.warn('Snapshot loaded from fallback backend', {
            backend: name,
            snapshotId: id
          });
          return snapshot;
        }
      } catch (error) {
        this.logger.error('Fallback backend snapshot load failed', {
          backend: name,
          snapshotId: id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    this.logger.info('Snapshot not found in any backend', { snapshotId: id });
    return null;
  }

  /**
   * List snapshots from primary backend
   */
  async listSnapshots(): Promise<StateSnapshot[]> {
    const primaryBackend = this.backends.get(this.config.primaryBackend);
    if (!primaryBackend) {
      throw new Error(`Primary backend '${this.config.primaryBackend}' not found`);
    }

    try {
      const snapshots = await primaryBackend.listSnapshots();
      
      // Limit to maxSnapshots
      const limited = snapshots.slice(0, this.config.maxSnapshots);
      
      this.logger.debug('Snapshots listed from primary backend', {
        backend: this.config.primaryBackend,
        count: limited.length
      });
      
      return limited;
    } catch (error) {
      this.logger.error('Primary backend snapshot list failed', {
        backend: this.config.primaryBackend,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Delete snapshot from all backends
   */
  async deleteSnapshot(id: string): Promise<void> {
    const errors: Error[] = [];

    for (const backend of this.backends.values()) {
      try {
        await backend.deleteSnapshot(id);
      } catch (error) {
        this.logger.error('Backend snapshot delete failed', {
          backend: backend.name,
          snapshotId: id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        errors.push(error instanceof Error ? error : new Error('Unknown error'));
      }
    }

    this.logger.debug('Snapshot deleted from persistence backends', {
      snapshotId: id,
      successCount: this.backends.size - errors.length,
      errorCount: errors.length
    });
  }

  /**
   * Start automatic state saving
   */
  startAutoSave(getState: () => UnifiedSystemState): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(async () => {
      try {
        const state = getState();
        await this.save(state);
        this.logger.debug('Auto-save completed');
      } catch (error) {
        this.logger.error('Auto-save failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.config.snapshotInterval);

    this.logger.info('Auto-save started', {
      interval: this.config.snapshotInterval
    });
  }

  /**
   * Stop automatic state saving
   */
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = undefined;
      this.logger.info('Auto-save stopped');
    }
  }

  /**
   * Cleanup old snapshots
   */
  async cleanupSnapshots(): Promise<void> {
    try {
      const snapshots = await this.listSnapshots();
      
      if (snapshots.length > this.config.maxSnapshots) {
        const toDelete = snapshots.slice(this.config.maxSnapshots);
        
        for (const snapshot of toDelete) {
          await this.deleteSnapshot(snapshot.id);
        }
        
        this.logger.info('Snapshot cleanup completed', {
          deleted: toDelete.length,
          remaining: this.config.maxSnapshots
        });
      }
    } catch (error) {
      this.logger.error('Snapshot cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Dispose of the persistence manager
   */
  dispose(): void {
    this.stopAutoSave();
    this.logger.info('State persistence manager disposed');
  }
}