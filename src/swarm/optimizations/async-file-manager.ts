/**
 * Async File Manager
 * Handles non-blocking file operations with queuing and batching
 */

import { promises as fs, createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, dirname } from 'node:path';
import PQueue from './simple-queue.js';
import { Logger } from '../../core/logger.js';
import { BatchProcessor } from '../../performance/batch-operations.js';
import { BoundedMap, MemoryPressureMonitor } from '../../performance/bounded-collections.js';

export interface FileOperationResult {
  path: string;
  operation: 'read' | 'write' | 'delete' | 'mkdir';
  success: boolean;
  duration: number;
  size?: number;
  error?: Error;
}

interface BatchWriteRequest {
  path: string;
  data: string | Buffer;
}

interface BatchReadRequest {
  path: string;
}

export class AsyncFileManager {
  private writeQueue: PQueue;
  private readQueue: PQueue;
  private logger: Logger;
  private directoryCache: BoundedMap<string, boolean>;
  private memoryMonitor: MemoryPressureMonitor;
  
  // Batch processors
  private writeBatcher!: BatchProcessor<BatchWriteRequest, FileOperationResult>;
  private readBatcher!: BatchProcessor<BatchReadRequest, FileOperationResult & { data?: string }>;
  private directoryBatcher!: BatchProcessor<string, FileOperationResult>;
  
  private metrics = {
    operations: new Map<string, number>(),
    totalBytes: 0,
    errors: 0,
    cacheHits: 0,
    cacheMisses: 0
  };
  
  constructor(
    private concurrency = {
      write: 10,
      read: 20
    },
    private options = {
      enableBatching: true,
      batchSizes: {
        write: 50,
        read: 100,
        directory: 25
      },
      batchTimeouts: {
        write: 100, // ms
        read: 50,   // ms
        directory: 200
      },
      cacheSize: 1000
    }
  ) {
    this.writeQueue = new PQueue({ 
      concurrency: this.concurrency.write,
      maxQueueSize: 5000
    });
    this.readQueue = new PQueue({ 
      concurrency: this.concurrency.read,
      maxQueueSize: 10000
    });
    
    this.logger = new Logger(
      { level: 'info', format: 'json', destination: 'console' },
      { component: 'AsyncFileManager' }
    );

    // Initialize directory cache
    this.directoryCache = new BoundedMap<string, boolean>({
      maxSize: options.cacheSize,
      evictionPolicy: 'lru'
    });

    // Initialize memory monitor
    this.memoryMonitor = new MemoryPressureMonitor({
      memoryThreshold: 150, // 150MB
      checkInterval: 60000  // 1 minute
    });

    // Register cleanup callbacks
    this.memoryMonitor.registerCleanup('directoryCache', () => {
      this.directoryCache.clear();
    });

    // Initialize batch processors if enabled
    if (options.enableBatching) {
      this.writeBatcher = new BatchProcessor(
        this.processBatchWrites.bind(this),
        {
          maxBatchSize: options.batchSizes.write,
          maxWaitTime: options.batchTimeouts.write,
          flushOnSize: true
        }
      );

      this.readBatcher = new BatchProcessor(
        this.processBatchReads.bind(this),
        {
          maxBatchSize: options.batchSizes.read,
          maxWaitTime: options.batchTimeouts.read,
          flushOnSize: true
        }
      );

      this.directoryBatcher = new BatchProcessor(
        this.processBatchDirectories.bind(this),
        {
          maxBatchSize: options.batchSizes.directory,
          maxWaitTime: options.batchTimeouts.directory,
          flushOnSize: false
        }
      );
    }
  }
  
  async writeFile(path: string, data: string | Buffer): Promise<FileOperationResult> {
    const start = Date.now();
    
    return this.writeQueue.add(async () => {
      try {
        // Ensure directory exists (with caching)
        await this.ensureDirectoryBatched(dirname(path));
        
        // Use streaming for large files
        if (data.length > 1024 * 1024) { // > 1MB
          await this.streamWrite(path, data);
        } else {
          await fs.writeFile(path, data, 'utf8');
        }
        
        const duration = Date.now() - start;
        const size = Buffer.byteLength(data);
        
        this.trackOperation('write', size);
        
        return {
          path,
          operation: 'write',
          success: true,
          duration,
          size
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Failed to write file', { path, error });
        
        return {
          path,
          operation: 'write',
          success: false,
          duration: Date.now() - start,
          error: error as Error
        };
      }
    });
  }
  
  async readFile(path: string): Promise<FileOperationResult & { data?: string }> {
    const start = Date.now();
    
    return this.readQueue.add(async () => {
      try {
        const data = await fs.readFile(path, 'utf8');
        const duration = Date.now() - start;
        const size = Buffer.byteLength(data);
        
        this.trackOperation('read', size);
        
        return {
          path,
          operation: 'read' as const,
          success: true,
          duration,
          size,
          data
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Failed to read file', { path, error });
        
        return {
          path,
          operation: 'read' as const,
          success: false,
          duration: Date.now() - start,
          error: error as Error
        };
      }
    });
  }
  
  async writeJSON(path: string, data: any, pretty = true): Promise<FileOperationResult> {
    const jsonString = pretty 
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    
    return this.writeFile(path, jsonString);
  }
  
  async readJSON(path: string): Promise<FileOperationResult & { data?: any }> {
    const result = await this.readFile(path);
    
    if (result.success && result.data) {
      try {
        const parsed = JSON.parse(result.data);
        return { ...result, data: parsed };
      } catch (error) {
        return {
          ...result,
          success: false,
          error: new Error('Invalid JSON format')
        };
      }
    }
    
    return result;
  }
  
  async deleteFile(path: string): Promise<FileOperationResult> {
    const start = Date.now();
    
    return this.writeQueue.add(async () => {
      try {
        await fs.unlink(path);
        
        this.trackOperation('delete', 0);
        
        return {
          path,
          operation: 'delete',
          success: true,
          duration: Date.now() - start
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Failed to delete file', { path, error });
        
        return {
          path,
          operation: 'delete',
          success: false,
          duration: Date.now() - start,
          error: error as Error
        };
      }
    });
  }
  
  async ensureDirectory(path: string): Promise<FileOperationResult> {
    const start = Date.now();
    
    try {
      await fs.mkdir(path, { recursive: true });
      
      this.trackOperation('mkdir', 0);
      
      return {
        path,
        operation: 'mkdir',
        success: true,
        duration: Date.now() - start
      };
    } catch (error) {
      this.metrics.errors++;
      this.logger.error('Failed to create directory', { path, error });
      
      return {
        path,
        operation: 'mkdir',
        success: false,
        duration: Date.now() - start,
        error: error as Error
      };
    }
  }
  
  async ensureDirectories(paths: string[]): Promise<FileOperationResult[]> {
    return Promise.all(paths.map(path => this.ensureDirectory(path)));
  }
  
  private async streamWrite(path: string, data: string | Buffer): Promise<void> {
    const stream = createWriteStream(path);
    await pipeline(
      Readable.from(data),
      stream
    );
  }
  
  async streamRead(path: string): Promise<NodeJS.ReadableStream> {
    return createReadStream(path);
  }
  
  async copyFile(source: string, destination: string): Promise<FileOperationResult> {
    const start = Date.now();
    
    return this.writeQueue.add(async () => {
      try {
        await this.ensureDirectory(dirname(destination));
        await fs.copyFile(source, destination);
        
        const stats = await fs.stat(destination);
        this.trackOperation('write', stats.size);
        
        return {
          path: destination,
          operation: 'write',
          success: true,
          duration: Date.now() - start,
          size: stats.size
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Failed to copy file', { source, destination, error });
        
        return {
          path: destination,
          operation: 'write',
          success: false,
          duration: Date.now() - start,
          error: error as Error
        };
      }
    });
  }
  
  async moveFile(source: string, destination: string): Promise<FileOperationResult> {
    const copyResult = await this.copyFile(source, destination);
    if (copyResult.success) {
      await this.deleteFile(source);
    }
    return copyResult;
  }
  
  private trackOperation(type: string, bytes: number): void {
    const count = this.metrics.operations.get(type) || 0;
    this.metrics.operations.set(type, count + 1);
    this.metrics.totalBytes += bytes;
  }
  
  getMetrics() {
    const baseMetrics = {
      operations: Object.fromEntries(this.metrics.operations),
      totalBytes: this.metrics.totalBytes,
      errors: this.metrics.errors,
      cacheHits: this.metrics.cacheHits,
      cacheMisses: this.metrics.cacheMisses,
      cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) || 0,
      writeQueueSize: this.writeQueue.size,
      readQueueSize: this.readQueue.size,
      writeQueuePending: this.writeQueue.pending,
      readQueuePending: this.readQueue.pending,
      directoryCache: this.directoryCache.getStats(),
      memoryStats: this.memoryMonitor.getMemoryStats()
    };

    // Add batch processor stats if enabled
    if (this.options.enableBatching) {
      return {
        ...baseMetrics,
        writeBatcher: this.writeBatcher?.getStats(),
        readBatcher: this.readBatcher?.getStats(),
        directoryBatcher: this.directoryBatcher?.getStats()
      };
    }

    return baseMetrics;
  }
  
  async waitForPendingOperations(): Promise<void> {
    await Promise.all([
      this.writeQueue.onIdle(),
      this.readQueue.onIdle()
    ]);
  }
  
  clearQueues(): void {
    this.writeQueue.clear();
    this.readQueue.clear();
  }

  // Batch processing methods
  private async processBatchWrites(requests: BatchWriteRequest[]): Promise<FileOperationResult[]> {
    const results: FileOperationResult[] = [];
    
    // Group by directory to batch directory creation
    const directoriesNeeded = new Set<string>();
    for (const req of requests) {
      directoriesNeeded.add(dirname(req.path));
    }

    // Ensure all directories exist first
    await Promise.all(Array.from(directoriesNeeded).map(dir => 
      this.ensureDirectoryBatched(dir)
    ));

    // Process writes in parallel but limited batches
    const writePromises = requests.map(async (req) => {
      const start = Date.now();
      try {
        if (req.data.length > 1024 * 1024) { // > 1MB
          await this.streamWrite(req.path, req.data);
        } else {
          await fs.writeFile(req.path, req.data, 'utf8');
        }

        const duration = Date.now() - start;
        const size = Buffer.byteLength(req.data);
        this.trackOperation('write', size);

        return {
          path: req.path,
          operation: 'write' as const,
          success: true,
          duration,
          size
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Batch write failed', { path: req.path, error });
        
        return {
          path: req.path,
          operation: 'write' as const,
          success: false,
          duration: Date.now() - start,
          error: error as Error
        };
      }
    });

    return Promise.all(writePromises);
  }

  private async processBatchReads(requests: BatchReadRequest[]): Promise<(FileOperationResult & { data?: string })[]> {
    const readPromises = requests.map(async (req) => {
      const start = Date.now();
      try {
        const data = await fs.readFile(req.path, 'utf8');
        const duration = Date.now() - start;
        const size = Buffer.byteLength(data);
        
        this.trackOperation('read', size);

        return {
          path: req.path,
          operation: 'read' as const,
          success: true,
          duration,
          size,
          data
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Batch read failed', { path: req.path, error });
        
        return {
          path: req.path,
          operation: 'read' as const,
          success: false,
          duration: Date.now() - start,
          error: error as Error
        };
      }
    });

    return Promise.all(readPromises);
  }

  private async processBatchDirectories(paths: string[]): Promise<FileOperationResult[]> {
    // Remove duplicates and sort by depth (create parent directories first)
    const uniquePaths = Array.from(new Set(paths))
      .sort((a, b) => a.split('/').length - b.split('/').length);

    const results: FileOperationResult[] = [];
    
    for (const path of uniquePaths) {
      const start = Date.now();
      try {
        await fs.mkdir(path, { recursive: true });
        this.directoryCache.set(path, true);
        this.trackOperation('mkdir', 0);

        results.push({
          path,
          operation: 'mkdir',
          success: true,
          duration: Date.now() - start
        });
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Batch directory creation failed', { path, error });
        
        results.push({
          path,
          operation: 'mkdir',
          success: false,
          duration: Date.now() - start,
          error: error as Error
        });
      }
    }

    return results;
  }

  private async ensureDirectoryBatched(path: string): Promise<void> {
    // Check cache first
    if (this.directoryCache.has(path)) {
      this.metrics.cacheHits++;
      return;
    }

    this.metrics.cacheMisses++;
    
    if (this.options.enableBatching && this.directoryBatcher) {
      await this.directoryBatcher.add(path);
    } else {
      await this.ensureDirectory(path);
    }
  }

  // Enhanced batched operations
  async writeFilesBatch(files: Array<{ path: string; data: string | Buffer }>): Promise<FileOperationResult[]> {
    if (this.options.enableBatching && this.writeBatcher) {
      const promises = files.map(file => 
        this.writeBatcher.add({ path: file.path, data: file.data })
      );
      return Promise.all(promises);
    } else {
      // Fallback to individual operations
      return Promise.all(files.map(file => this.writeFile(file.path, file.data)));
    }
  }

  async readFilesBatch(paths: string[]): Promise<(FileOperationResult & { data?: string })[]> {
    if (this.options.enableBatching && this.readBatcher) {
      const promises = paths.map(path => 
        this.readBatcher.add({ path })
      );
      return Promise.all(promises);
    } else {
      // Fallback to individual operations
      return Promise.all(paths.map(path => this.readFile(path)));
    }
  }
}