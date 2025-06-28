import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { Logger } from '../core/logger.js';

const logger = new Logger(
  { level: 'info', format: 'json', destination: 'console' },
  { component: 'PromptCopier' }
);

export interface CopyOptions {
  source: string;
  destination: string;
  backup?: boolean;
  overwrite?: boolean;
  verify?: boolean;
  preservePermissions?: boolean;
  excludePatterns?: string[];
  includePatterns?: string[];
  parallel?: boolean;
  maxWorkers?: number;
  dryRun?: boolean;
  conflictResolution?: 'skip' | 'overwrite' | 'backup' | 'merge';
  progressCallback?: (progress: CopyProgress) => void;
}

export interface CopyProgress {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  currentFile?: string;
  percentage: number;
}

export interface CopyResult {
  success: boolean;
  totalFiles: number;
  copiedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  backupLocation?: string;
  errors: CopyError[];
  duration: number;
}

export interface CopyError {
  file: string;
  error: string;
  phase: 'read' | 'write' | 'verify' | 'backup';
}

export interface FileInfo {
  path: string;
  relativePath: string;
  size: number;
  hash?: string;
  permissions?: number;
}

export class PromptCopier extends EventEmitter {
  protected options: Required<CopyOptions>;
  protected fileQueue: FileInfo[] = [];
  protected copiedFiles: Set<string> = new Set();
  protected errors: CopyError[] = [];
  private backupMap: Map<string, string> = new Map();
  private rollbackStack: Array<() => Promise<void>> = [];

  constructor(options: CopyOptions) {
    super();
    this.options = {
      ...options,
      backup: options.backup ?? true,
      overwrite: options.overwrite ?? false,
      verify: options.verify ?? true,
      preservePermissions: options.preservePermissions ?? true,
      excludePatterns: options.excludePatterns ?? [],
      includePatterns: options.includePatterns ?? ['*.md', '*.txt', '*.prompt', '*.prompts'],
      parallel: options.parallel ?? true,
      maxWorkers: options.maxWorkers ?? 4,
      dryRun: options.dryRun ?? false,
      conflictResolution: options.conflictResolution ?? 'backup',
      progressCallback: options.progressCallback ?? (() => {})
    };
  }

  async copy(): Promise<CopyResult> {
    const startTime = Date.now();
    
    try {
      // Phase 1: Discovery
      logger.info('Starting prompt discovery phase...');
      await this.discoverFiles();
      
      if (this.fileQueue.length === 0) {
        return {
          success: true,
          totalFiles: 0,
          copiedFiles: 0,
          failedFiles: 0,
          skippedFiles: 0,
          duration: Date.now() - startTime
        };
      }

      // Phase 2: Pre-flight checks
      if (!this.options.dryRun) {
        await this.ensureDestinationDirectories();
      }

      // Phase 3: Copy files
      logger.info(`Copying ${this.fileQueue.length} files...`);
      if (this.options.parallel) {
        await this.copyFilesParallel();
      } else {
        await this.copyFilesSequential();
      }

      // Phase 4: Verification
      if (this.options.verify && !this.options.dryRun) {
        await this.verifyFiles();
      }

      const duration = Date.now() - startTime;
      const result: CopyResult = {
        success: this.errors.length === 0,
        totalFiles: this.fileQueue.length,
        copiedFiles: this.copiedFiles.size,
        failedFiles: this.errors.length,
        skippedFiles: this.fileQueue.length - this.copiedFiles.size - this.errors.length,
        errors: this.errors,
        duration
      };

      if (this.backupMap.size > 0) {
        result.backupLocation = await this.createBackupManifest();
      }

      logger.info(`Copy completed in ${duration}ms`, result);
      return result;

    } catch (error) {
      logger.error('Copy operation failed', error);
      
      if (!this.options.dryRun) {
        await this.rollback();
      }
      
      throw error;
    }
  }

  private async discoverFiles(): Promise<void> {
    const sourceStats = await fs.stat(this.options.source);
    
    if (!sourceStats.isDirectory()) {
      throw new Error(`Source path ${this.options.source} is not a directory`);
    }

    await this.scanDirectory(this.options.source, '');
    
    // Sort by size for better parallel distribution
    this.fileQueue.sort((a, b) => b.size - a.size);
  }

  private async scanDirectory(dirPath: string, relativePath: string): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.join(relativePath, entry.name);
      
      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, relPath);
      } else if (entry.isFile() && this.shouldIncludeFile(relPath)) {
        const stats = await fs.stat(fullPath);
        this.fileQueue.push({
          path: fullPath,
          relativePath: relPath,
          size: stats.size,
          permissions: stats.mode
        });
      }
    }
  }

  private shouldIncludeFile(filePath: string): boolean {
    // Check exclude patterns first
    for (const pattern of this.options.excludePatterns) {
      if (this.matchPattern(filePath, pattern)) {
        return false;
      }
    }
    
    // Check include patterns
    if (this.options.includePatterns.length === 0) {
      return true;
    }
    
    for (const pattern of this.options.includePatterns) {
      if (this.matchPattern(filePath, pattern)) {
        return true;
      }
    }
    
    return false;
  }

  private matchPattern(filePath: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    return new RegExp(regex).test(filePath);
  }

  private async ensureDestinationDirectories(): Promise<void> {
    const directories = new Set<string>();
    
    for (const file of this.fileQueue) {
      const destDir = path.dirname(path.join(this.options.destination, file.relativePath));
      directories.add(destDir);
    }
    
    // Create directories in order (parent first)
    const sortedDirs = Array.from(directories).sort((a, b) => a.length - b.length);
    
    for (const dir of sortedDirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private async copyFilesSequential(): Promise<void> {
    let completed = 0;
    
    for (const file of this.fileQueue) {
      try {
        await this.copyFile(file);
        completed++;
        this.reportProgress(completed);
      } catch (error) {
        this.errors.push({
          file: file.path,
          error: error instanceof Error ? error.message : String(error),
          phase: 'write'
        });
      }
    }
  }

  private async copyFilesParallel(): Promise<void> {
    const workerCount = Math.min(this.options.maxWorkers, this.fileQueue.length);
    const chunkSize = Math.ceil(this.fileQueue.length / workerCount);
    const workers: Promise<void>[] = [];
    
    for (let i = 0; i < workerCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, this.fileQueue.length);
      const chunk = this.fileQueue.slice(start, end);
      
      if (chunk.length > 0) {
        workers.push(this.processChunk(chunk, i));
      }
    }
    
    await Promise.all(workers);
  }

  private async processChunk(files: FileInfo[], workerId: number): Promise<void> {
    for (const file of files) {
      try {
        await this.copyFile(file);
        this.copiedFiles.add(file.path);
        this.reportProgress(this.copiedFiles.size);
      } catch (error) {
        this.errors.push({
          file: file.path,
          error: error instanceof Error ? error.message : String(error),
          phase: 'write'
        });
      }
    }
  }

  private async copyFile(file: FileInfo): Promise<void> {
    const destPath = path.join(this.options.destination, file.relativePath);
    
    if (this.options.dryRun) {
      logger.info(`[DRY RUN] Would copy ${file.path} to ${destPath}`);
      return;
    }

    // Check for conflicts
    const destExists = await this.fileExists(destPath);
    
    if (destExists) {
      switch (this.options.conflictResolution) {
        case 'skip':
          logger.info(`Skipping existing file: ${destPath}`);
          return;
          
        case 'backup':
          await this.backupFile(destPath);
          break;
          
        case 'merge':
          await this.mergeFiles(file.path, destPath);
          return;
          
        case 'overwrite':
          // Continue with copy
          break;
      }
    }

    // Calculate source hash if verification is enabled
    if (this.options.verify) {
      file.hash = await this.calculateFileHash(file.path);
    }

    // Copy the file
    await fs.copyFile(file.path, destPath);
    
    // Preserve permissions if requested
    if (this.options.preservePermissions && file.permissions) {
      await fs.chmod(destPath, file.permissions);
    }

    // Add to rollback stack
    this.rollbackStack.push(async () => {
      if (destExists && this.backupMap.has(destPath)) {
        // Restore from backup
        const backupPath = this.backupMap.get(destPath)!;
        await fs.copyFile(backupPath, destPath);
      } else {
        // Remove the copied file
        await fs.unlink(destPath);
      }
    });

    this.copiedFiles.add(file.path);
  }

  private async backupFile(filePath: string): Promise<void> {
    const backupDir = path.join(this.options.destination, '.prompt-backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${path.basename(filePath)}.${timestamp}.bak`;
    const backupPath = path.join(backupDir, backupName);
    
    await fs.copyFile(filePath, backupPath);
    this.backupMap.set(filePath, backupPath);
  }

  private async mergeFiles(sourcePath: string, destPath: string): Promise<void> {
    // Simple merge strategy: append source to destination with separator
    const sourceContent = await fs.readFile(sourcePath, 'utf-8');
    const destContent = await fs.readFile(destPath, 'utf-8');
    
    const separator = '\n\n--- MERGED CONTENT ---\n\n';
    const mergedContent = destContent + separator + sourceContent;
    
    await this.backupFile(destPath);
    await fs.writeFile(destPath, mergedContent, 'utf-8');
  }

  private async verifyFiles(): Promise<void> {
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
        
        // Verify hash if available
        if (file.hash) {
          const destHash = await this.calculateFileHash(destPath);
          if (destHash !== file.hash) {
            throw new Error(`Hash mismatch: ${destHash} != ${file.hash}`);
          }
        }
        
      } catch (error) {
        this.errors.push({
          file: file.path,
          error: error instanceof Error ? error.message : String(error),
          phase: 'verify'
        });
      }
    }
  }

  protected async calculateFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async createBackupManifest(): Promise<string> {
    const manifestPath = path.join(
      this.options.destination,
      '.prompt-backups',
      `manifest-${Date.now()}.json`
    );
    
    const manifest = {
      timestamp: new Date().toISOString(),
      source: this.options.source,
      destination: this.options.destination,
      backups: Array.from(this.backupMap.entries()).map(([original, backup]) => ({
        original,
        backup
      }))
    };
    
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return manifestPath;
  }

  private async rollback(): Promise<void> {
    logger.warn('Rolling back changes...');
    
    // Execute rollback operations in reverse order
    for (let i = this.rollbackStack.length - 1; i >= 0; i--) {
      try {
        await this.rollbackStack[i]();
      } catch (error) {
        logger.error(`Rollback operation ${i} failed:`, error);
      }
    }
    
    // Clean up backup directory if empty
    try {
      const backupDir = path.join(this.options.destination, '.prompt-backups');
      const entries = await fs.readdir(backupDir);
      if (entries.length === 0) {
        await fs.rmdir(backupDir);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  protected reportProgress(completed: number): void {
    const progress: CopyProgress = {
      total: this.fileQueue.length,
      completed,
      failed: this.errors.length,
      skipped: this.fileQueue.length - completed - this.errors.length,
      percentage: Math.round((completed / this.fileQueue.length) * 100)
    };
    
    this.emit('progress', progress);
    this.options.progressCallback(progress);
  }

  // Utility method to restore from backup
  async restoreFromBackup(manifestPath: string): Promise<void> {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    
    for (const { original, backup } of manifest.backups) {
      try {
        await fs.copyFile(backup, original);
        logger.info(`Restored ${original} from ${backup}`);
      } catch (error) {
        logger.error(`Failed to restore ${original}:`, error);
      }
    }
  }
}

// Export convenience function
export async function copyPrompts(options: CopyOptions): Promise<CopyResult> {
  const copier = new PromptCopier(options);
  return copier.copy();
}