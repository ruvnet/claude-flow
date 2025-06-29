/**
 * Registry Corruption Recovery
 * 
 * Advanced registry corruption detection and repair mechanisms
 * with automatic backups and integrity validation
 */

import { Logger } from '@/shared/logger.js';
import { ProcessRegistryDatabase } from './database.js';
import { ProcessInfo, RegistryValidationResult } from './types.js';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { EventEmitter } from 'events';

const logger = Logger.getInstance().child({ component: 'RegistryCorruptionRecovery' });

export interface CorruptionCheckResult {
  isCorrupted: boolean;
  corruptionType?: 'structural' | 'referential' | 'data' | 'checksum';
  affectedRecords: string[];
  repairStrategy?: string;
}

export class RegistryCorruptionRecovery extends EventEmitter {
  private database: ProcessRegistryDatabase;
  private backupDir: string;
  private checksumCache: Map<string, string> = new Map();
  
  constructor(database: ProcessRegistryDatabase) {
    super();
    this.database = database;
    this.backupDir = join(process.cwd(), '.claude-flow', 'corruption-backups');
  }

  async detectCorruption(): Promise<CorruptionCheckResult> {
    const result: CorruptionCheckResult = {
      isCorrupted: false,
      affectedRecords: []
    };

    try {
      // 1. Structural integrity check
      const structuralCheck = await this.checkStructuralIntegrity();
      if (!structuralCheck.valid) {
        result.isCorrupted = true;
        result.corruptionType = 'structural';
        result.affectedRecords.push(...structuralCheck.errors);
        return result;
      }

      // 2. Referential integrity check
      const referentialCheck = await this.checkReferentialIntegrity();
      if (!referentialCheck.valid) {
        result.isCorrupted = true;
        result.corruptionType = 'referential';
        result.affectedRecords.push(...referentialCheck.errors);
        return result;
      }

      // 3. Data integrity check
      const dataCheck = await this.checkDataIntegrity();
      if (!dataCheck.valid) {
        result.isCorrupted = true;
        result.corruptionType = 'data';
        result.affectedRecords.push(...dataCheck.errors);
        return result;
      }

      // 4. Checksum validation
      const checksumCheck = await this.validateChecksums();
      if (!checksumCheck.valid) {
        result.isCorrupted = true;
        result.corruptionType = 'checksum';
        result.affectedRecords.push(...checksumCheck.errors);
        return result;
      }

      return result;
    } catch (error) {
      logger.error('Registry corruption detected:', error);
      result.isCorrupted = true;
      result.corruptionType = 'structural';
      result.affectedRecords.push('general-corruption');
      return result;
    }
  }

  async repairRegistry(): Promise<void> {
    logger.info('Starting registry repair');
    
    // 1. Create backup of corrupted state
    await this.backupCorruptedState();
    
    // 2. Scan for running processes
    const runningProcesses = await this.scanRunningProcesses();
    
    // 3. Rebuild registry from running processes
    await this.rebuildRegistry(runningProcesses);
    
    // 4. Validate rebuilt registry
    if (!await this.validateRegistry()) {
      throw new Error('Registry repair failed validation');
    }
    
    // 5. Update checksums
    await this.updateChecksums();
    
    logger.info('Registry successfully repaired');
    this.emit('registry-repaired', { 
      processCount: runningProcesses.length,
      timestamp: new Date()
    });
  }

  private async checkStructuralIntegrity(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      // Check if database tables exist and are accessible
      const processes = await this.database.queryProcesses({});
      
      // Verify database schema
      // This would normally check actual table structure
      // For now, we just verify we can query
      if (!Array.isArray(processes)) {
        errors.push('Invalid process query result structure');
      }
    } catch (error) {
      errors.push(`Database structural error: ${error}`);
    }
    
    return { valid: errors.length === 0, errors };
  }

  private async checkReferentialIntegrity(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      const processes = await this.database.queryProcesses({});
      const processIds = new Set(processes.map(p => p.id));
      
      // Check parent-child relationships
      for (const process of processes) {
        if (process.parentId && !processIds.has(process.parentId)) {
          errors.push(`Process ${process.id} references non-existent parent ${process.parentId}`);
        }
      }
      
      // Check for circular dependencies
      const visited = new Set<string>();
      const recursionStack = new Set<string>();
      
      for (const process of processes) {
        if (!visited.has(process.id)) {
          if (this.hasCycle(process.id, processes, visited, recursionStack)) {
            errors.push(`Circular dependency detected involving process ${process.id}`);
          }
        }
      }
    } catch (error) {
      errors.push(`Referential integrity check failed: ${error}`);
    }
    
    return { valid: errors.length === 0, errors };
  }

  private async checkDataIntegrity(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      const processes = await this.database.queryProcesses({});
      
      for (const process of processes) {
        // Validate required fields
        if (!process.id || !process.name || !process.type || !process.pid) {
          errors.push(`Process ${process.id || 'unknown'} missing required fields`);
        }
        
        // Validate data types and ranges
        if (process.pid && (process.pid < 0 || process.pid > 4194304)) {
          errors.push(`Process ${process.id} has invalid PID: ${process.pid}`);
        }
        
        // Validate status
        const validStatuses = ['starting', 'running', 'stopping', 'stopped', 'failed', 'unresponsive'];
        if (!validStatuses.includes(process.status)) {
          errors.push(`Process ${process.id} has invalid status: ${process.status}`);
        }
        
        // Validate timestamps
        if (process.startTime && !(process.startTime instanceof Date)) {
          errors.push(`Process ${process.id} has invalid startTime`);
        }
      }
    } catch (error) {
      errors.push(`Data integrity check failed: ${error}`);
    }
    
    return { valid: errors.length === 0, errors };
  }

  private async validateChecksums(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      const processes = await this.database.queryProcesses({});
      
      for (const process of processes) {
        const calculatedChecksum = this.calculateProcessChecksum(process);
        const storedChecksum = this.checksumCache.get(process.id);
        
        if (storedChecksum && storedChecksum !== calculatedChecksum) {
          errors.push(`Checksum mismatch for process ${process.id}`);
        }
      }
    } catch (error) {
      errors.push(`Checksum validation failed: ${error}`);
    }
    
    return { valid: errors.length === 0, errors };
  }

  private async backupCorruptedState(): Promise<void> {
    await mkdir(this.backupDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(this.backupDir, `corrupted-state-${timestamp}.json`);
    
    try {
      const processes = await this.database.queryProcesses({});
      const state = {
        timestamp: new Date(),
        processCount: processes.length,
        processes,
        corruptionDetected: true
      };
      
      await writeFile(backupPath, JSON.stringify(state, null, 2));
      logger.info('Corrupted state backed up', { backupPath });
    } catch (error) {
      logger.error('Failed to backup corrupted state', { error });
    }
  }

  private async scanRunningProcesses(): Promise<ProcessInfo[]> {
    const runningProcesses: ProcessInfo[] = [];
    
    try {
      // Get all processes from database
      const registeredProcesses = await this.database.queryProcesses({});
      
      // Check each process to see if it's actually running
      for (const process of registeredProcesses) {
        if (this.isProcessRunning(process.pid)) {
          // Update process status to reflect actual state
          process.status = 'running';
          runningProcesses.push(process);
        }
      }
      
      logger.info(`Found ${runningProcesses.length} running processes`);
    } catch (error) {
      logger.error('Failed to scan running processes', { error });
    }
    
    return runningProcesses;
  }

  private async rebuildRegistry(runningProcesses: ProcessInfo[]): Promise<void> {
    logger.info('Rebuilding registry from running processes');
    
    try {
      // Clear existing registry
      await this.database.shutdown();
      await this.database.initialize();
      
      // Re-register all running processes
      for (const process of runningProcesses) {
        await this.database.register(process);
        logger.debug(`Re-registered process ${process.id} (${process.name})`);
      }
      
      logger.info(`Registry rebuilt with ${runningProcesses.length} processes`);
    } catch (error) {
      logger.error('Failed to rebuild registry', { error });
      throw error;
    }
  }

  private async validateRegistry(): Promise<boolean> {
    const validation = await this.detectCorruption();
    return !validation.isCorrupted;
  }

  private async updateChecksums(): Promise<void> {
    const processes = await this.database.queryProcesses({});
    
    this.checksumCache.clear();
    for (const process of processes) {
      const checksum = this.calculateProcessChecksum(process);
      this.checksumCache.set(process.id, checksum);
    }
    
    logger.info(`Updated checksums for ${processes.length} processes`);
  }

  private calculateProcessChecksum(process: ProcessInfo): string {
    const data = JSON.stringify({
      id: process.id,
      name: process.name,
      type: process.type,
      pid: process.pid,
      parentId: process.parentId,
      status: process.status
    });
    
    return createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private hasCycle(
    processId: string,
    processes: ProcessInfo[],
    visited: Set<string>,
    recursionStack: Set<string>
  ): boolean {
    visited.add(processId);
    recursionStack.add(processId);
    
    const process = processes.find(p => p.id === processId);
    if (process?.parentId) {
      if (!visited.has(process.parentId)) {
        if (this.hasCycle(process.parentId, processes, visited, recursionStack)) {
          return true;
        }
      } else if (recursionStack.has(process.parentId)) {
        return true;
      }
    }
    
    recursionStack.delete(processId);
    return false;
  }

  async performIntegrityCheck(): Promise<RegistryValidationResult> {
    const result: RegistryValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      processCount: 0,
      orphanedProcesses: []
    };

    const corruption = await this.detectCorruption();
    
    if (corruption.isCorrupted) {
      result.valid = false;
      result.errors.push(`Corruption detected: ${corruption.corruptionType}`);
      result.errors.push(...corruption.affectedRecords);
    }

    const processes = await this.database.queryProcesses({});
    result.processCount = processes.length;

    return result;
  }
}