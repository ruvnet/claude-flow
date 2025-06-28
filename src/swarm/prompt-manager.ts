import * as path from 'path';
import { EventEmitter } from 'events';
import { copyPromptsEnhanced } from './prompt-copier-enhanced.js';
import { copyPrompts, CopyOptions, CopyResult } from './prompt-copier.js';
import { 
  PromptConfigManager, 
  PromptPathResolver, 
  PromptValidator,
  formatDuration,
  formatFileSize
} from './prompt-utils.js';
import { Logger } from '../core/logger.js';

const logger = new Logger(
  { level: 'info', format: 'json', destination: 'console' },
  { component: 'PromptManager' }
);

export interface PromptManagerOptions {
  configPath?: string;
  basePath?: string;
  autoDiscovery?: boolean;
  defaultProfile?: string;
}

export interface SyncOptions {
  bidirectional?: boolean;
  deleteOrphaned?: boolean;
  compareHashes?: boolean;
  incrementalOnly?: boolean;
}

export interface ValidationReport {
  totalFiles: number;
  validFiles: number;
  invalidFiles: number;
  issues: Array<{
    file: string;
    issues: string[];
    metadata?: any;
  }>;
}

export class PromptManager extends EventEmitter {
  private configManager: PromptConfigManager;
  private pathResolver: PromptPathResolver;
  private options: Required<PromptManagerOptions>;

  constructor(options: PromptManagerOptions = {}) {
    super();
    
    this.options = {
      configPath: options.configPath || '.prompt-config.json',
      basePath: options.basePath || process.cwd(),
      autoDiscovery: options.autoDiscovery ?? true,
      defaultProfile: options.defaultProfile || 'sparc'
    };

    this.configManager = new PromptConfigManager(
      path.resolve(this.options.basePath, this.options.configPath)
    );
    this.pathResolver = new PromptPathResolver(this.options.basePath);
  }

  async initialize(): Promise<void> {
    logger.info('Initializing PromptManager...');
    
    // Load configuration
    await this.configManager.loadConfig();
    
    // Auto-discover prompt directories if enabled
    if (this.options.autoDiscovery) {
      const discovered = await this.pathResolver.discoverPromptDirectories();
      if (discovered.length > 0) {
        logger.info(`Auto-discovered ${discovered.length} prompt directories`);
        
        // Update config with discovered directories
        const config = this.configManager.getConfig();
        const uniqueDirs = Array.from(new Set([
          ...config.sourceDirectories,
          ...discovered.map(dir => path.relative(this.options.basePath, dir))
        ]));
        
        await this.configManager.saveConfig({
          sourceDirectories: uniqueDirs
        });
      }
    }
    
    this.emit('initialized');
  }

  async copyPrompts(options: Partial<CopyOptions> = {}): Promise<CopyResult> {
    const config = this.configManager.getConfig();
    const profile = this.options.defaultProfile;
    
    // Resolve paths
    const resolved = this.pathResolver.resolvePaths(
      config.sourceDirectories,
      config.destinationDirectory
    );

    if (resolved.sources.length === 0) {
      throw new Error('No valid source directories found');
    }

    // Build copy options
    const copyOptions: CopyOptions = {
      source: resolved.sources[0], // Use first available source
      destination: resolved.destination,
      ...this.configManager.getProfile(profile),
      ...options
    };

    logger.info('Starting prompt copy operation', {
      source: copyOptions.source,
      destination: copyOptions.destination,
      profile
    });

    this.emit('copyStart', copyOptions);

    try {
      const result = await (copyOptions.parallel ? 
        copyPromptsEnhanced(copyOptions) : 
        copyPrompts(copyOptions)
      );

      this.emit('copyComplete', result);
      return result;
    } catch (error) {
      this.emit('copyError', error);
      throw error;
    }
  }

  async copyFromMultipleSources(options: Partial<CopyOptions> = {}): Promise<CopyResult[]> {
    const config = this.configManager.getConfig();
    const resolved = this.pathResolver.resolvePaths(
      config.sourceDirectories,
      config.destinationDirectory
    );

    const results: CopyResult[] = [];
    
    for (const source of resolved.sources) {
      try {
        const copyOptions: CopyOptions = {
          source,
          destination: resolved.destination,
          ...this.configManager.getProfile(this.options.defaultProfile),
          ...options
        };

        logger.info(`Copying from source: ${source}`);
        const result = await copyPrompts(copyOptions);
        results.push(result);
        
        this.emit('sourceComplete', { source, result });
      } catch (error) {
        logger.error(`Failed to copy from ${source}:`, error);
        this.emit('sourceError', { source, error });
        
        // Add error result
        results.push({
          success: false,
          totalFiles: 0,
          copiedFiles: 0,
          failedFiles: 0,
          skippedFiles: 0,
          errors: [{ file: source, error: error instanceof Error ? error.message : String(error), phase: 'read' }],
          duration: 0
        });
      }
    }

    return results;
  }

  async validatePrompts(sourcePath?: string): Promise<ValidationReport> {
    const config = this.configManager.getConfig();
    const sources = sourcePath ? [sourcePath] : config.sourceDirectories;
    
    const resolved = this.pathResolver.resolvePaths(
      sources,
      config.destinationDirectory
    );

    let totalFiles = 0;
    let validFiles = 0;
    let invalidFiles = 0;
    const issues: ValidationReport['issues'] = [];

    for (const source of resolved.sources) {
      await this.validateDirectory(source, issues);
    }

    totalFiles = issues.length;
    validFiles = issues.filter(issue => issue.issues.length === 0).length;
    invalidFiles = totalFiles - validFiles;

    const report: ValidationReport = {
      totalFiles,
      validFiles,
      invalidFiles,
      issues: issues.filter(issue => issue.issues.length > 0) // Only include files with issues
    };

    this.emit('validationComplete', report);
    return report;
  }

  private async validateDirectory(dirPath: string, issues: ValidationReport['issues']): Promise<void> {
    const fs = require('fs').promises;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isFile() && this.isPromptFile(entry.name)) {
          const result = await PromptValidator.validatePromptFile(fullPath);
          
          issues.push({
            file: fullPath,
            issues: result.issues,
            metadata: result.metadata
          });
        } else if (entry.isDirectory()) {
          await this.validateDirectory(fullPath, issues);
        }
      }
    } catch (error) {
      logger.error(`Failed to validate directory ${dirPath}:`, error);
    }
  }

  private isPromptFile(fileName: string): boolean {
    const config = this.configManager.getConfig();
    const patterns = config.defaultOptions.includePatterns;
    
    return patterns.some(pattern => {
      const regex = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
      return new RegExp(regex).test(fileName);
    });
  }

  async syncPrompts(options: SyncOptions = {}): Promise<{
    forward: CopyResult;
    backward?: CopyResult;
  }> {
    const config = this.configManager.getConfig();
    const resolved = this.pathResolver.resolvePaths(
      config.sourceDirectories,
      config.destinationDirectory
    );

    const syncOptions: SyncOptions = {
      bidirectional: false,
      deleteOrphaned: false,
      compareHashes: true,
      incrementalOnly: true,
      ...options
    };

    // Forward sync (source to destination)
    const forwardResult = await this.performIncrementalSync(
      resolved.sources[0],
      resolved.destination,
      syncOptions
    );

    let backwardResult: CopyResult | undefined;

    // Backward sync if bidirectional
    if (syncOptions.bidirectional) {
      backwardResult = await this.performIncrementalSync(
        resolved.destination,
        resolved.sources[0],
        syncOptions
      );
    }

    return {
      forward: forwardResult,
      backward: backwardResult
    };
  }

  private async performIncrementalSync(
    source: string,
    destination: string,
    options: SyncOptions
  ): Promise<CopyResult> {
    // This would implement incremental sync logic
    // For now, we'll use the regular copy with overwrite
    return copyPrompts({
      source,
      destination,
      conflictResolution: 'overwrite',
      verify: options.compareHashes
    });
  }

  async generateReport(): Promise<{
    configuration: any;
    sources: Array<{
      path: string;
      exists: boolean;
      fileCount?: number;
      totalSize?: number;
    }>;
    validation?: ValidationReport;
    lastOperation?: {
      type: string;
      timestamp: Date;
      result: any;
    };
  }> {
    const config = this.configManager.getConfig();
    const resolved = this.pathResolver.resolvePaths(
      config.sourceDirectories,
      config.destinationDirectory
    );

    // Analyze sources
    const sources = await Promise.all(
      resolved.sources.map(async (sourcePath) => {
        try {
          const fs = require('fs').promises;
          const stats = await fs.stat(sourcePath);
          
          if (!stats.isDirectory()) {
            return { path: sourcePath, exists: false };
          }

          // Count files and calculate total size
          let fileCount = 0;
          let totalSize = 0;

          const scanDir = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              
              if (entry.isFile() && this.isPromptFile(entry.name)) {
                const fileStats = await fs.stat(fullPath);
                fileCount++;
                totalSize += fileStats.size;
              } else if (entry.isDirectory()) {
                await scanDir(fullPath);
              }
            }
          };

          await scanDir(sourcePath);

          return {
            path: sourcePath,
            exists: true,
            fileCount,
            totalSize
          };
        } catch {
          return { path: sourcePath, exists: false };
        }
      })
    );

    return {
      configuration: config,
      sources
    };
  }

  // Utility methods
  getConfig() {
    return this.configManager.getConfig();
  }

  async updateConfig(updates: any): Promise<void> {
    await this.configManager.saveConfig(updates);
  }

  getProfiles(): string[] {
    return this.configManager.listProfiles();
  }

  getProfile(name: string) {
    return this.configManager.getProfile(name);
  }

  async discoverPromptDirectories(): Promise<string[]> {
    return this.pathResolver.discoverPromptDirectories();
  }
}

// Export factory function
export function createPromptManager(options?: PromptManagerOptions): PromptManager {
  return new PromptManager(options);
}

// Export singleton instance
let defaultManager: PromptManager | null = null;

export function getDefaultPromptManager(): PromptManager {
  if (!defaultManager) {
    defaultManager = new PromptManager();
  }
  return defaultManager;
}