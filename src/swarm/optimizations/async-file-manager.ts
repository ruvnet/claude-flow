import { getErrorMessage } from '../../utils/error-handler.js';
/**
 * Async File Manager
 * Handles non-blocking file operations with queuing
 */

import { promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { join, dirname } from 'node:path';
import PQueue from 'p-queue';
import { Logger } from '../../core/logger.js';

export interface FileOperationResult {
  path: string;
  operation: 'read' | 'write' | 'delete' | 'mkdir';
  success: boolean;
  duration: number;
  size?: number;
  error?: Error;
}

export class AsyncFileManager {
  private writeQueue: PQueue;
  private readQueue: PQueue;
  private logger: Logger;
  private metrics = {
    operations: new Map<string, number>(),
    totalBytes: 0,
    errors: 0
  };
  
  constructor(
    private concurrency = {
      write: 10,
      read: 20
    }
  ) {
    this.writeQueue = new PQueue({ concurrency: this.concurrency.write });
    this.readQueue = new PQueue({ concurrency: this.concurrency.read });
    
    // Use test-safe logger configuration
    const loggerConfig = process.env.CLAUDE_FLOW_ENV === 'test' 
      ? { level: 'error' as const, format: 'json' as const, destination: 'console' as const }
      : { level: 'info' as const, format: 'json' as const, destination: 'console' as const };
    
    this.logger = new Logger(
      loggerConfig,
      { component: 'AsyncFileManager' }
    );
  }
  
  async writeFile(path: string, data: string | Buffer): Promise<FileOperationResult> {
    const start = Date.now();
    
    return await this.writeQueue.add(async (): Promise<FileOperationResult> => {
      try {
        // Ensure directory exists
        await this.ensureDirectory(dirname(path));
        
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
          operation: 'write' as const,
          success: true,
          duration,
          size
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Failed to write file', { path, error });
        
        return {
          path,
          operation: 'write' as const,
          success: false,
          duration: Date.now() - start,
          error: error as Error
        };
      }
    });
  }
  
  async readFile(path: string): Promise<FileOperationResult & { data?: string }> {
    const start = Date.now();
    
    return await this.readQueue.add(async (): Promise<FileOperationResult & { data?: string }> => {
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
    
    return this.writeQueue.add(async (): Promise<FileOperationResult> => {
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
    
    return this.writeQueue.add(async (): Promise<FileOperationResult> => {
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
    return {
      operations: Object.fromEntries(this.metrics.operations),
      totalBytes: this.metrics.totalBytes,
      errors: this.metrics.errors,
      writeQueueSize: this.writeQueue.size,
      readQueueSize: this.readQueue.size,
      writeQueuePending: this.writeQueue.pending,
      readQueuePending: this.readQueue.pending
    };
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
}