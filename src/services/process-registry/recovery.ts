/**
 * Process Registry Recovery Module
 * 
 * Handles backup, restore, validation, and repair of the registry database
 */

import { copyFile, mkdir, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { Logger } from '@/core/logger.js';
import { ProcessRegistryDatabase } from './database.js';
import { RegistryRecovery, RegistryValidationResult } from './types.js';

const logger = Logger.getInstance().child({ component: 'RegistryRecovery' });

export class ProcessRegistryRecovery implements RegistryRecovery {
  private database: ProcessRegistryDatabase;
  private backupDir: string;

  constructor(database: ProcessRegistryDatabase, backupDir: string = join(process.cwd(), '.claude-flow', 'backups')) {
    this.database = database;
    this.backupDir = backupDir;
  }

  async backup(): Promise<void> {
    try {
      // Ensure backup directory exists
      await mkdir(this.backupDir, { recursive: true });

      // Create backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = join(this.backupDir, `registry-backup-${timestamp}.db`);

      // Get the database path from the database instance
      // For now, we'll use a default path (this should be refactored)
      const sourcePath = join(process.cwd(), '.claude-flow', 'registry.db');

      // Copy database file
      await copyFile(sourcePath, backupPath);

      logger.info('Registry backup created', { backupPath });

      // Clean up old backups (keep last 10)
      await this.cleanupOldBackups();
    } catch (error) {
      logger.error('Failed to create backup', { error });
      throw error;
    }
  }

  async restore(backupPath: string): Promise<void> {
    try {
      // Verify backup file exists
      await stat(backupPath);

      // Shutdown current database
      await this.database.shutdown();

      // Get the database path
      const targetPath = join(process.cwd(), '.claude-flow', 'registry.db');

      // Create a backup of current database before restoring
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const currentBackup = join(this.backupDir, `registry-pre-restore-${timestamp}.db`);
      await copyFile(targetPath, currentBackup);

      // Restore from backup
      await copyFile(backupPath, targetPath);

      // Reinitialize database
      await this.database.initialize();

      logger.info('Registry restored from backup', { backupPath });
    } catch (error) {
      logger.error('Failed to restore from backup', { error, backupPath });
      throw error;
    }
  }

  async validate(): Promise<RegistryValidationResult> {
    const result: RegistryValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      processCount: 0,
      orphanedProcesses: []
    };

    try {
      // Check all registered processes
      const processes = await this.database.queryProcesses({});
      result.processCount = processes.length;

      for (const proc of processes) {
        // Validate process data integrity
        if (!proc.id || !proc.name || !proc.type || !proc.pid) {
          result.errors.push(`Process ${proc.id} missing required fields`);
          result.valid = false;
        }

        // Check for orphaned processes
        if (!this.isProcessRunning(proc.pid)) {
          if (proc.status === 'running' || proc.status === 'starting') {
            result.orphanedProcesses.push(proc.id);
            result.warnings.push(`Process ${proc.id} (${proc.name}) marked as ${proc.status} but not running`);
          }
        }

        // Validate parent-child relationships
        if (proc.parentId) {
          const parent = await this.database.getProcess(proc.parentId);
          if (!parent) {
            result.warnings.push(`Process ${proc.id} references non-existent parent ${proc.parentId}`);
          }
        }

        // Check health check data consistency
        const health = await this.database.getLatestHealthCheck(proc.id);
        if (health) {
          const timeSinceLastCheck = Date.now() - health.lastHeartbeat.getTime();
          const expectedInterval = proc.healthCheck.interval * 2; // Allow some slack

          if (proc.status === 'running' && timeSinceLastCheck > expectedInterval) {
            result.warnings.push(`Process ${proc.id} health check is stale (${Math.round(timeSinceLastCheck / 1000)}s old)`);
          }
        }
      }

      // Check for processes with inconsistent status
      const stoppedWithRunningPid = processes.filter(p => 
        (p.status === 'stopped' || p.status === 'failed') && this.isProcessRunning(p.pid)
      );
      
      for (const proc of stoppedWithRunningPid) {
        result.warnings.push(`Process ${proc.id} marked as ${proc.status} but PID ${proc.pid} is still running`);
      }

    } catch (error) {
      result.errors.push(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
      result.valid = false;
    }

    return result;
  }

  async repair(): Promise<void> {
    try {
      logger.info('Starting registry repair');

      // First, validate to identify issues
      const validation = await this.validate();

      // Fix orphaned processes
      for (const processId of validation.orphanedProcesses) {
        try {
          const proc = await this.database.getProcess(processId);
          if (proc) {
            await this.database.updateProcess(processId, { status: 'stopped' });
            await this.database.logEvent(processId, 'status_change', {
              from: proc.status,
              to: 'stopped',
              reason: 'repair - process not running'
            });
            logger.info('Fixed orphaned process', { processId, name: proc.name });
          }
        } catch (error) {
          logger.error('Failed to fix orphaned process', { processId, error });
        }
      }

      // Fix processes with invalid parent references
      const processes = await this.database.queryProcesses({});
      for (const proc of processes) {
        if (proc.parentId) {
          const parent = await this.database.getProcess(proc.parentId);
          if (!parent) {
            await this.database.updateProcess(proc.id, { parentId: undefined });
            logger.info('Removed invalid parent reference', { 
              processId: proc.id, 
              invalidParentId: proc.parentId 
            });
          }
        }
      }

      // Clean up stale health checks
      await this.database.cleanupOldHealthChecks(1); // Keep only last day
      await this.database.cleanupOldMetrics(7);
      await this.database.cleanupOldEvents(30);

      logger.info('Registry repair completed', {
        orphanedProcessesFixed: validation.orphanedProcesses.length,
        totalProcesses: validation.processCount
      });
    } catch (error) {
      logger.error('Registry repair failed', { error });
      throw error;
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async cleanupOldBackups(keepCount: number = 10): Promise<void> {
    try {
      const files = await readdir(this.backupDir);
      const backupFiles = files
        .filter(f => f.startsWith('registry-backup-') && f.endsWith('.db'))
        .sort()
        .reverse();

      if (backupFiles.length > keepCount) {
        const toDelete = backupFiles.slice(keepCount);
        for (const file of toDelete) {
          const filePath = join(this.backupDir, file);
          const { unlink } = await import('fs/promises');
          await unlink(filePath);
          logger.debug('Deleted old backup', { file });
        }
      }
    } catch (error) {
      logger.warn('Failed to cleanup old backups', { error });
    }
  }
}