#!/usr/bin/env node
/**
 * Progressive Runtime Migration Executor
 * 
 * Migrates files from Deno runtime to Node.js runtime in controlled batches
 * with full rollback capability and validation testing.
 * 
 * Phase 2 Runtime Migration - Issues #72, #79
 */

import { promises as fs } from 'fs';
import { join, resolve, extname } from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';

interface MigrationBatch {
  name: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  files: string[];
  description: string;
  dependencies?: string[];
  estimatedDuration: string;
}

interface MigrationResult {
  file: string;
  success: boolean;
  originalHash: string;
  migratedHash: string;
  errors: string[];
  warnings: string[];
  changes: Change[];
}

interface Change {
  line: number;
  from: string;
  to: string;
  type: 'api-replacement' | 'import-update' | 'error-handling';
}

class RuntimeMigrationExecutor {
  private readonly projectRoot: string;
  private readonly backupDir: string;
  private readonly logFile: string;
  private migrationResults: Map<string, MigrationResult> = new Map();
  
  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    this.backupDir = join(this.projectRoot, 'phase2', 'runtime', 'backup');
    this.logFile = join(this.projectRoot, 'phase2', 'runtime', 'migration.log');
  }
  
  /**
   * Migration batches in priority order
   */
  private readonly migrationBatches: MigrationBatch[] = [
    {
      name: 'Batch 1: Critical Core Files',
      priority: 'CRITICAL',
      description: 'Core swarm coordination and initialization system',
      estimatedDuration: '3-5 days',
      files: [
        'src/swarm/coordinator.ts',
        'src/cli/simple-commands/init/index.js',
        'src/cli/simple-commands/init/rollback/backup-manager.js',
        'src/cli/simple-commands/init/rollback/rollback-executor.js'
      ]
    },
    {
      name: 'Batch 2: Command Layer',
      priority: 'HIGH',
      description: 'Main CLI commands and swarm management',
      estimatedDuration: '2-3 days',
      dependencies: ['Batch 1: Critical Core Files'],
      files: [
        'src/cli/commands/swarm.ts',
        'src/cli/commands/swarm-new.ts',
        'src/cli/commands/start/start-command.ts'
      ]
    },
    {
      name: 'Batch 3: Supporting Files',
      priority: 'MEDIUM',
      description: 'Supporting functionality and utilities',
      estimatedDuration: '2-3 days',
      dependencies: ['Batch 2: Command Layer'],
      files: [
        'src/cli/simple-commands/init/rollback/recovery-manager.js',
        'src/cli/simple-commands/swarm.js',
        'src/cli/simple-commands/swarm-executor.js'
      ]
    }
  ];
  
  /**
   * Deno API to Node.js API mappings
   */
  private readonly apiMappings: Record<string, string> = {
    'Deno.writeTextFile': 'DenoCompat.writeTextFile',
    'Deno.readTextFile': 'DenoCompat.readTextFile',
    'Deno.stat': 'DenoCompat.stat',
    'Deno.mkdir': 'DenoCompat.mkdir',
    'Deno.remove': 'DenoCompat.remove',
    'Deno.readDir': 'DenoCompat.readDir',
    'Deno.env': 'DenoCompat.env',
    'Deno.exit': 'DenoCompat.exit',
    'Deno.Command': 'DenoCompat.Command',
    'Deno.cwd': 'DenoCompat.cwd',
    'Deno.chdir': 'DenoCompat.chdir',
    'Deno.args': 'DenoCompat.args',
    'Deno.stdin': 'DenoCompat.stdin',
    'Deno.stdout': 'DenoCompat.stdout',
    'Deno.addSignalListener': 'DenoCompat.addSignalListener',
    'Deno.memoryUsage': 'DenoCompat.memoryUsage',
    'Deno.build': 'DenoCompat.build',
    'Deno.pid': 'DenoCompat.pid',
    'Deno.kill': 'DenoCompat.kill',
    'Deno.errors': 'DenoCompat.errors'
  };
  
  /**
   * Execute migration for a specific batch
   */
  async executeBatch(batchName: string, dryRun: boolean = false): Promise<boolean> {
    const batch = this.migrationBatches.find(b => b.name === batchName);
    if (!batch) {
      throw new Error(`Batch not found: ${batchName}`);
    }
    
    this.log(`Starting migration: ${batch.name}`);
    this.log(`Priority: ${batch.priority}`);
    this.log(`Files to migrate: ${batch.files.length}`);
    this.log(`Estimated duration: ${batch.estimatedDuration}`);
    
    // Check dependencies
    if (batch.dependencies) {
      for (const dep of batch.dependencies) {
        if (!await this.isBatchCompleted(dep)) {
          throw new Error(`Dependency not completed: ${dep}`);
        }
      }
    }
    
    // Create backup before migration
    if (!dryRun) {
      await this.createBatchBackup(batch);
    }
    
    const results: MigrationResult[] = [];
    
    for (const file of batch.files) {
      try {
        const result = await this.migrateFile(file, dryRun);
        results.push(result);
        this.migrationResults.set(file, result);
        
        if (result.success) {
          this.log(`✅ Successfully migrated: ${file}`);
        } else {
          this.log(`❌ Failed to migrate: ${file}`);
          this.log(`Errors: ${result.errors.join(', ')}`);
        }
      } catch (error) {
        this.log(`💥 Exception migrating ${file}: ${error}`);
        results.push({
          file,
          success: false,
          originalHash: '',
          migratedHash: '',
          errors: [(error as Error).message],
          warnings: [],
          changes: []
        });
      }
    }
    
    // Validate batch completion
    const successCount = results.filter(r => r.success).length;
    const batchSuccess = successCount === batch.files.length;
    
    if (batchSuccess) {
      this.log(`🎉 Batch completed successfully: ${batch.name}`);
      if (!dryRun) {
        await this.markBatchCompleted(batch.name);
        await this.runBatchTests(batch);
      }
    } else {
      this.log(`⚠️ Batch partially failed: ${successCount}/${batch.files.length} files migrated`);
      if (!dryRun) {
        await this.rollbackBatch(batch);
      }
    }
    
    return batchSuccess;
  }
  
  /**
   * Migrate a single file from Deno to Node.js
   */
  async migrateFile(filePath: string, dryRun: boolean = false): Promise<MigrationResult> {
    const fullPath = join(this.projectRoot, filePath);
    
    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch {
      return {
        file: filePath,
        success: false,
        originalHash: '',
        migratedHash: '',
        errors: ['File not found'],
        warnings: [],
        changes: []
      };
    }
    
    // Read original content
    const originalContent = await fs.readFile(fullPath, 'utf8');
    const originalHash = this.generateHash(originalContent);
    
    // Perform migration
    const { migratedContent, changes, errors, warnings } = await this.processFileContent(
      originalContent,
      filePath
    );
    
    const migratedHash = this.generateHash(migratedContent);
    
    // Write migrated content (if not dry run)
    if (!dryRun && errors.length === 0) {
      await fs.writeFile(fullPath, migratedContent, 'utf8');
    }
    
    return {
      file: filePath,
      success: errors.length === 0,
      originalHash,
      migratedHash,
      errors,
      warnings,
      changes
    };
  }
  
  /**
   * Process file content and perform Deno to Node.js migration
   */
  private async processFileContent(
    content: string,
    filePath: string
  ): Promise<{
    migratedContent: string;
    changes: Change[];
    errors: string[];
    warnings: string[];
  }> {
    const lines = content.split('\n');
    const changes: Change[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    let migratedContent = content;
    
    // Add compatibility layer import at the top (for TypeScript files)
    if (filePath.endsWith('.ts') && content.includes('Deno.')) {
      const compatImport = "import { DenoCompat } from '../../phase2/runtime/deno-compatibility-layer.js';";
      
      // Find the best place to insert the import
      const importRegex = /^import\s+.*from\s+['"]/;
      let insertLine = 0;
      
      for (let i = 0; i < lines.length; i++) {
        if (importRegex.test(lines[i])) {
          insertLine = i + 1;
        } else if (lines[i].trim() === '' && insertLine > 0) {
          break;
        }
      }
      
      // Insert compatibility import
      lines.splice(insertLine, 0, compatImport);
      changes.push({
        line: insertLine + 1,
        from: '',
        to: compatImport,
        type: 'import-update'
      });
    }
    
    // Replace Deno API calls
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let modifiedLine = line;
      
      for (const [denoApi, nodeApi] of Object.entries(this.apiMappings)) {
        if (line.includes(denoApi)) {
          modifiedLine = modifiedLine.replace(new RegExp(denoApi, 'g'), nodeApi);
          changes.push({
            line: i + 1,
            from: denoApi,
            to: nodeApi,
            type: 'api-replacement'
          });
        }
      }
      
      // Check for problematic patterns
      if (line.includes('deno.land') || line.includes('@std/') || line.includes('@cliffy/')) {
        warnings.push(`Line ${i + 1}: Deno-specific import detected: ${line.trim()}`);
      }
      
      lines[i] = modifiedLine;
    }
    
    migratedContent = lines.join('\n');
    
    return {
      migratedContent,
      changes,
      errors,
      warnings
    };
  }
  
  /**
   * Create backup for batch files
   */
  private async createBatchBackup(batch: MigrationBatch): Promise<void> {
    const batchBackupDir = join(this.backupDir, this.sanitizeBatchName(batch.name));
    await fs.mkdir(batchBackupDir, { recursive: true });
    
    for (const file of batch.files) {
      const sourcePath = join(this.projectRoot, file);
      const backupPath = join(batchBackupDir, file.replace(/\//g, '_'));
      
      try {
        await fs.copyFile(sourcePath, backupPath);
        this.log(`📋 Backed up: ${file}`);
      } catch (error) {
        this.log(`⚠️ Failed to backup ${file}: ${error}`);
      }
    }
  }
  
  /**
   * Rollback batch to original state
   */
  private async rollbackBatch(batch: MigrationBatch): Promise<void> {
    this.log(`🔄 Rolling back batch: ${batch.name}`);
    
    const batchBackupDir = join(this.backupDir, this.sanitizeBatchName(batch.name));
    
    for (const file of batch.files) {
      const backupPath = join(batchBackupDir, file.replace(/\//g, '_'));
      const sourcePath = join(this.projectRoot, file);
      
      try {
        await fs.copyFile(backupPath, sourcePath);
        this.log(`↩️ Restored: ${file}`);
      } catch (error) {
        this.log(`❌ Failed to restore ${file}: ${error}`);
      }
    }
  }
  
  /**
   * Run tests for migrated batch
   */
  private async runBatchTests(batch: MigrationBatch): Promise<boolean> {
    this.log(`🧪 Running tests for batch: ${batch.name}`);
    
    return new Promise((resolve) => {
      const testProcess = spawn('npm', ['run', 'test'], {
        cwd: this.projectRoot,
        stdio: 'inherit'
      });
      
      testProcess.on('close', (code) => {
        const success = code === 0;
        this.log(success ? '✅ Tests passed' : '❌ Tests failed');
        resolve(success);
      });
      
      testProcess.on('error', (error) => {
        this.log(`💥 Test execution failed: ${error}`);
        resolve(false);
      });
    });
  }
  
  /**
   * Check if batch is completed
   */
  private async isBatchCompleted(batchName: string): Promise<boolean> {
    const statusFile = join(this.projectRoot, 'phase2', 'runtime', 'migration-status.json');
    
    try {
      const status = JSON.parse(await fs.readFile(statusFile, 'utf8'));
      return status.completedBatches?.includes(batchName) || false;
    } catch {
      return false;
    }
  }
  
  /**
   * Mark batch as completed
   */
  private async markBatchCompleted(batchName: string): Promise<void> {
    const statusFile = join(this.projectRoot, 'phase2', 'runtime', 'migration-status.json');
    
    let status = { completedBatches: [] };
    try {
      status = JSON.parse(await fs.readFile(statusFile, 'utf8'));
    } catch {
      // File doesn't exist, use default
    }
    
    if (!status.completedBatches.includes(batchName)) {
      status.completedBatches.push(batchName);
      await fs.writeFile(statusFile, JSON.stringify(status, null, 2));
    }
  }
  
  /**
   * Generate hash for content comparison
   */
  private generateHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }
  
  /**
   * Sanitize batch name for file system
   */
  private sanitizeBatchName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  }
  
  /**
   * Log message with timestamp
   */
  private async log(message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    
    console.log(message);
    
    try {
      await fs.mkdir(join(this.logFile, '..'), { recursive: true });
      await fs.appendFile(this.logFile, logEntry);
    } catch {
      // Log to console if file logging fails
    }
  }
  
  /**
   * Generate migration report
   */
  async generateReport(): Promise<string> {
    const report = {
      timestamp: new Date().toISOString(),
      totalFiles: this.migrationResults.size,
      successfulMigrations: Array.from(this.migrationResults.values()).filter(r => r.success).length,
      failedMigrations: Array.from(this.migrationResults.values()).filter(r => !r.success).length,
      totalChanges: Array.from(this.migrationResults.values()).reduce((sum, r) => sum + r.changes.length, 0),
      results: Array.from(this.migrationResults.entries()).map(([file, result]) => ({
        file,
        success: result.success,
        changesCount: result.changes.length,
        errorsCount: result.errors.length,
        warningsCount: result.warnings.length
      }))
    };
    
    const reportPath = join(this.projectRoot, 'phase2', 'runtime', 'migration-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    return reportPath;
  }
}

// CLI Interface
if (require.main === module) {
  const [,, command, ...args] = process.argv;
  const executor = new RuntimeMigrationExecutor(process.cwd());
  
  async function main() {
    try {
      switch (command) {
        case 'migrate':
          const [batchName] = args;
          const dryRun = args.includes('--dry-run');
          await executor.executeBatch(batchName, dryRun);
          break;
          
        case 'report':
          const reportPath = await executor.generateReport();
          console.log(`Migration report generated: ${reportPath}`);
          break;
          
        default:
          console.log('Usage:');
          console.log('  node migration-executor.js migrate "Batch 1: Critical Core Files" [--dry-run]');
          console.log('  node migration-executor.js report');
      }
    } catch (error) {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  }
  
  main();
}

export { RuntimeMigrationExecutor, type MigrationBatch, type MigrationResult };