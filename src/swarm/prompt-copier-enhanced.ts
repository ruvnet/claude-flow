import * as fs from 'fs/promises';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { PromptCopier, CopyOptions, CopyResult, FileInfo } from './prompt-copier';
import { logger } from '../logger';

interface WorkerPool {
  workers: Worker[];
  busy: Set<number>;
  queue: Array<() => void>;
}

export class EnhancedPromptCopier extends PromptCopier {
  private workerPool?: WorkerPool;
  private workerResults: Map<string, any> = new Map();

  constructor(options: CopyOptions) {
    super(options);
  }

  protected async copyFilesParallel(): Promise<void> {
    const workerCount = Math.min(this.options.maxWorkers, this.fileQueue.length);
    
    // Initialize worker pool
    this.workerPool = await this.initializeWorkerPool(workerCount);
    
    try {
      // Process files using worker pool
      await this.processWithWorkerPool();
    } finally {
      // Cleanup workers
      await this.terminateWorkers();
    }
  }

  private async initializeWorkerPool(workerCount: number): Promise<WorkerPool> {
    const workers: Worker[] = [];
    const pool: WorkerPool = {
      workers,
      busy: new Set(),
      queue: []
    };
    
    // Create workers
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(
        path.join(__dirname, 'workers', 'copy-worker.js'),
        {
          workerData: { workerId: i }
        }
      );
      
      // Setup worker message handler
      worker.on('message', (result) => {
        this.handleWorkerResult(result, i, pool);
      });
      
      worker.on('error', (error) => {
        logger.error(`Worker ${i} error:`, error);
        this.errors.push({
          file: 'worker',
          error: error.message,
          phase: 'write'
        });
      });
      
      workers.push(worker);
    }
    
    return pool;
  }

  private async processWithWorkerPool(): Promise<void> {
    const chunkSize = Math.max(1, Math.floor(this.fileQueue.length / this.workerPool!.workers.length / 2));
    const chunks: FileInfo[][] = [];
    
    // Create chunks for better distribution
    for (let i = 0; i < this.fileQueue.length; i += chunkSize) {
      chunks.push(this.fileQueue.slice(i, i + chunkSize));
    }
    
    // Process chunks
    const promises: Promise<void>[] = [];
    
    for (const chunk of chunks) {
      promises.push(this.processChunkWithWorker(chunk));
    }
    
    await Promise.all(promises);
  }

  private async processChunkWithWorker(chunk: FileInfo[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const pool = this.workerPool!;
      
      const tryAssignWork = () => {
        // Find available worker
        const availableWorkerIndex = pool.workers.findIndex((_, index) => !pool.busy.has(index));
        
        if (availableWorkerIndex === -1) {
          // No workers available, queue the work
          pool.queue.push(tryAssignWork);
          return;
        }
        
        // Mark worker as busy
        pool.busy.add(availableWorkerIndex);
        
        // Prepare worker data
        const workerData = {
          files: chunk.map(file => ({
            sourcePath: file.path,
            destPath: path.join(this.options.destination, file.relativePath),
            permissions: this.options.preservePermissions ? file.permissions : undefined,
            verify: this.options.verify
          })),
          workerId: availableWorkerIndex
        };
        
        let remainingFiles = chunk.length;
        const chunkResults: any[] = [];
        
        // Setup temporary message handler for this chunk
        const messageHandler = (result: any) => {
          chunkResults.push(result);
          remainingFiles--;
          
          if (remainingFiles === 0) {
            // Chunk complete
            pool.workers[availableWorkerIndex].off('message', messageHandler);
            pool.busy.delete(availableWorkerIndex);
            
            // Process next queued work
            if (pool.queue.length > 0) {
              const nextWork = pool.queue.shift()!;
              nextWork();
            }
            
            // Process results
            this.processChunkResults(chunk, chunkResults);
            resolve();
          }
        };
        
        pool.workers[availableWorkerIndex].on('message', messageHandler);
        pool.workers[availableWorkerIndex].postMessage(workerData);
      };
      
      tryAssignWork();
    });
  }

  private processChunkResults(chunk: FileInfo[], results: any[]): void {
    for (const result of results) {
      if (result.success) {
        this.copiedFiles.add(result.file);
        if (result.hash) {
          this.workerResults.set(result.file, { hash: result.hash });
        }
      } else {
        this.errors.push({
          file: result.file,
          error: result.error,
          phase: 'write'
        });
      }
    }
    
    this.reportProgress(this.copiedFiles.size);
  }

  private handleWorkerResult(result: any, workerId: number, pool: WorkerPool): void {
    // This is a fallback handler, actual handling happens in processChunkWithWorker
    logger.debug(`Worker ${workerId} result:`, result);
  }

  private async terminateWorkers(): Promise<void> {
    if (!this.workerPool) return;
    
    const terminationPromises = this.workerPool.workers.map(worker => 
      worker.terminate()
    );
    
    await Promise.all(terminationPromises);
    this.workerPool = undefined;
  }

  // Override verification to use worker results
  protected async verifyFiles(): Promise<void> {
    logger.info('Verifying copied files...');
    
    for (const file of this.fileQueue) {
      if (!this.copiedFiles.has(file.path)) continue;
      
      try {
        const destPath = path.join(this.options.destination, file.relativePath);
        
        // Verify file exists
        if (!await this.fileExists(destPath)) {
          throw new Error('Destination file not found');
        }
        
        // Verify size
        const destStats = await fs.stat(destPath);
        const sourceStats = await fs.stat(file.path);
        
        if (destStats.size !== sourceStats.size) {
          throw new Error(`Size mismatch: ${destStats.size} != ${sourceStats.size}`);
        }
        
        // Use hash from worker if available
        const workerResult = this.workerResults.get(file.path);
        if (workerResult?.hash) {
          const sourceHash = await this.calculateFileHash(file.path);
          if (sourceHash !== workerResult.hash) {
            throw new Error(`Hash mismatch: ${sourceHash} != ${workerResult.hash}`);
          }
        }
        
      } catch (error) {
        this.errors.push({
          file: file.path,
          error: error.message,
          phase: 'verify'
        });
      }
    }
  }
}

// Export enhanced copy function
export async function copyPromptsEnhanced(options: CopyOptions): Promise<CopyResult> {
  const copier = new EnhancedPromptCopier(options);
  return copier.copy();
}