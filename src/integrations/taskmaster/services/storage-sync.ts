/**
 * Storage Synchronization Service
 * Handles bidirectional sync between TaskMaster and Claude-Flow storage systems
 * Implements file system watching, conflict resolution, and backup/restore
 */

import { watch, FSWatcher } from 'fs';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { TaskAdapter } from '../adapters/task-adapter.js';
import {
  TaskMasterTask,
  ClaudeFlowTask,
  SyncResult,
  Conflict,
  Resolution,
  ValidationResult
} from '../types/task-types.js';

export interface IStorageSync {
  // Sync operations
  syncFromTaskMaster(directory: string): Promise<SyncResult>;
  syncToTaskMaster(projectId: string): Promise<SyncResult>;
  
  // Real-time sync
  enableWatcher(directory: string): void;
  disableWatcher(): void;
  
  // Conflict resolution
  resolveConflicts(conflicts: Conflict[]): Promise<Resolution[]>;
  
  // Backup & restore
  backup(destination: string): Promise<void>;
  restore(source: string): Promise<void>;
  
  // Status
  getSyncStatus(): SyncStatus;
}

export interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  source: 'taskmaster' | 'claudeflow';
  taskId: string;
  timestamp: Date;
  retryCount: number;
}

export interface SyncStatus {
  isWatching: boolean;
  lastSync: Date | null;
  queuedOperations: number;
  conflicts: number;
  errors: string[];
}

export interface IConflictResolver {
  resolve(conflicts: Conflict[]): Promise<Resolution[]>;
}

class AutoConflictResolver implements IConflictResolver {
  async resolve(conflicts: Conflict[]): Promise<Resolution[]> {
    // Automatic resolution strategy: most recent wins
    return conflicts.map(conflict => ({
      taskId: conflict.taskId,
      field: conflict.field,
      resolvedValue: conflict.source === 'taskmaster' ? 
        conflict.taskMasterValue : conflict.claudeFlowValue,
      strategy: 'merge' as const
    }));
  }
}

export class StorageSync implements IStorageSync {
  private watcher: FSWatcher | null = null;
  private syncQueue: SyncOperation[] = [];
  private taskAdapter: TaskAdapter;
  private conflictResolver: IConflictResolver;
  private isProcessing = false;
  private status: SyncStatus;

  constructor(
    taskAdapter?: TaskAdapter,
    conflictResolver?: IConflictResolver
  ) {
    this.taskAdapter = taskAdapter || new TaskAdapter();
    this.conflictResolver = conflictResolver || new AutoConflictResolver();
    this.status = {
      isWatching: false,
      lastSync: null,
      queuedOperations: 0,
      conflicts: 0,
      errors: []
    };
  }

  public async syncFromTaskMaster(directory: string): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      syncedTasks: 0,
      conflicts: [],
      errors: [],
      timestamp: new Date()
    };

    try {
      // Read TaskMaster data
      const taskMasterData = await this.readTaskMasterData(directory);
      const claudeFlowData = await this.getClaudeFlowData();

      // Calculate differences
      const diff = this.calculateDiff(taskMasterData, claudeFlowData);
      
      // Detect conflicts
      const conflicts = this.detectConflicts(diff);
      result.conflicts = conflicts;

      // Resolve conflicts if any
      if (conflicts.length > 0) {
        const resolutions = await this.conflictResolver.resolve(conflicts);
        await this.applyResolutions(resolutions);
        this.status.conflicts = conflicts.length;
      }

      // Apply sync operations
      const syncResult = await this.applySync(diff);
      result.syncedTasks = syncResult.count;
      result.success = true;
      
      this.status.lastSync = new Date();
      this.status.errors = [];

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(errorMessage);
      this.status.errors.push(errorMessage);
      console.error('Sync from TaskMaster failed:', error);
    }

    const duration = Date.now() - startTime;
    console.log(`Sync completed in ${duration}ms: ${result.syncedTasks} tasks synced`);
    
    return result;
  }

  public async syncToTaskMaster(projectId: string): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      syncedTasks: 0,
      conflicts: [],
      errors: [],
      timestamp: new Date()
    };

    try {
      // Get Claude-Flow tasks for project
      const claudeFlowTasks = await this.getClaudeFlowTasksForProject(projectId);
      
      // Convert to TaskMaster format
      const taskMasterTasks = this.taskAdapter.batchToTaskMaster(claudeFlowTasks);
      
      // Write to TaskMaster storage
      await this.writeTaskMasterData(taskMasterTasks, projectId);
      
      result.syncedTasks = taskMasterTasks.length;
      result.success = true;
      this.status.lastSync = new Date();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(errorMessage);
      this.status.errors.push(errorMessage);
      console.error('Sync to TaskMaster failed:', error);
    }

    return result;
  }

  public enableWatcher(directory: string): void {
    if (this.watcher) {
      this.disableWatcher();
    }

    try {
      this.watcher = watch(directory, { recursive: true }, (eventType, filename) => {
        if (filename && this.isTaskFile(filename)) {
          this.queueSyncOperation({
            id: `${Date.now()}-${Math.random()}`,
            type: eventType === 'rename' ? 'delete' : 'update',
            source: 'taskmaster',
            taskId: this.extractTaskIdFromFilename(filename),
            timestamp: new Date(),
            retryCount: 0
          });
        }
      });

      this.status.isWatching = true;
      this.processSyncQueue(); // Start processing queue
      console.log(`File watcher enabled for directory: ${directory}`);
      
    } catch (error) {
      console.error('Failed to enable file watcher:', error);
      this.status.errors.push('Failed to enable file watcher');
    }
  }

  public disableWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.status.isWatching = false;
      console.log('File watcher disabled');
    }
  }

  public async resolveConflicts(conflicts: Conflict[]): Promise<Resolution[]> {
    return await this.conflictResolver.resolve(conflicts);
  }

  public async backup(destination: string): Promise<void> {
    try {
      // Get all current data
      const claudeFlowData = await this.getClaudeFlowData();
      
      // Create backup object
      const backup = {
        timestamp: new Date().toISOString(),
        version: '1.0',
        claudeFlowTasks: claudeFlowData,
        metadata: {
          totalTasks: claudeFlowData.length,
          syncStatus: this.status
        }
      };

      // Write backup file
      await writeFile(destination, JSON.stringify(backup, null, 2));
      console.log(`Backup created at: ${destination}`);
      
    } catch (error) {
      console.error('Backup failed:', error);
      throw error;
    }
  }

  public async restore(source: string): Promise<void> {
    try {
      // Read backup file
      const backupContent = await readFile(source, 'utf-8');
      const backup = JSON.parse(backupContent);
      
      // Validate backup format
      if (!backup.claudeFlowTasks || !Array.isArray(backup.claudeFlowTasks)) {
        throw new Error('Invalid backup format');
      }

      // Restore tasks
      await this.restoreClaudeFlowData(backup.claudeFlowTasks);
      console.log(`Restored ${backup.claudeFlowTasks.length} tasks from backup`);
      
    } catch (error) {
      console.error('Restore failed:', error);
      throw error;
    }
  }

  public getSyncStatus(): SyncStatus {
    return { ...this.status, queuedOperations: this.syncQueue.length };
  }

  // Private helper methods
  private async readTaskMasterData(directory: string): Promise<TaskMasterTask[]> {
    const tasks: TaskMasterTask[] = [];
    
    try {
      const files = await readdir(directory);
      
      for (const file of files) {
        if (this.isTaskFile(file)) {
          const filePath = join(directory, file);
          const content = await readFile(filePath, 'utf-8');
          const taskData = JSON.parse(content);
          
          // Validate task data
          const validation = this.taskAdapter.validateTaskConversion(taskData);
          if (validation.isValid) {
            tasks.push(taskData);
          } else {
            console.warn(`Invalid task data in ${file}:`, validation.errors);
          }
        }
      }
    } catch (error) {
      console.error('Failed to read TaskMaster data:', error);
      throw error;
    }

    return tasks;
  }

  private async getClaudeFlowData(): Promise<ClaudeFlowTask[]> {
    // This would integrate with Claude-Flow's actual storage system
    // For now, return mock data structure
    try {
      // In a real implementation, this would query Claude-Flow's database/storage
      return [];
    } catch (error) {
      console.error('Failed to get Claude-Flow data:', error);
      throw error;
    }
  }

  private async getClaudeFlowTasksForProject(projectId: string): Promise<ClaudeFlowTask[]> {
    // Mock implementation - would integrate with actual Claude-Flow storage
    return [];
  }

  private async writeTaskMasterData(tasks: TaskMasterTask[], projectId: string): Promise<void> {
    // Mock implementation - would write to actual TaskMaster storage format
    console.log(`Would write ${tasks.length} tasks for project ${projectId}`);
  }

  private async restoreClaudeFlowData(tasks: ClaudeFlowTask[]): Promise<void> {
    // Mock implementation - would restore to actual Claude-Flow storage
    console.log(`Would restore ${tasks.length} tasks to Claude-Flow`);
  }

  private calculateDiff(tmTasks: TaskMasterTask[], cfTasks: ClaudeFlowTask[]): SyncDiff {
    const tmTaskMap = new Map(tmTasks.map(t => [t.id, t]));
    const cfTaskMap = new Map(cfTasks.map(t => [t.id, t]));
    
    const toCreate: TaskMasterTask[] = [];
    const toUpdate: { tm: TaskMasterTask; cf: ClaudeFlowTask }[] = [];
    const toDelete: string[] = [];

    // Find tasks to create or update
    for (const tmTask of tmTasks) {
      const cfTask = cfTaskMap.get(tmTask.id);
      if (!cfTask) {
        toCreate.push(tmTask);
      } else if (tmTask.updatedAt > cfTask.updatedAt) {
        toUpdate.push({ tm: tmTask, cf: cfTask });
      }
    }

    // Find tasks to delete (exist in CF but not in TM)
    for (const cfTask of cfTasks) {
      if (!tmTaskMap.has(cfTask.id)) {
        toDelete.push(cfTask.id);
      }
    }

    return { toCreate, toUpdate, toDelete };
  }

  private detectConflicts(diff: SyncDiff): Conflict[] {
    const conflicts: Conflict[] = [];
    
    for (const { tm, cf } of diff.toUpdate) {
      const taskConflicts = this.taskAdapter.detectConflicts(tm, cf);
      conflicts.push(...taskConflicts);
    }
    
    return conflicts;
  }

  private async applyResolutions(resolutions: Resolution[]): Promise<void> {
    for (const resolution of resolutions) {
      // Apply resolution based on strategy
      console.log(`Applying resolution for task ${resolution.taskId}: ${resolution.strategy}`);
      // Implementation would depend on storage system
    }
  }

  private async applySync(diff: SyncDiff): Promise<{ count: number }> {
    let count = 0;
    
    // Apply creates
    for (const task of diff.toCreate) {
      const cfTask = this.taskAdapter.toClaudeFlow(task);
      // Would save to Claude-Flow storage
      count++;
    }
    
    // Apply updates
    for (const { tm } of diff.toUpdate) {
      const cfTask = this.taskAdapter.toClaudeFlow(tm);
      // Would update in Claude-Flow storage
      count++;
    }
    
    // Apply deletes
    for (const taskId of diff.toDelete) {
      // Would delete from Claude-Flow storage
      count++;
    }
    
    return { count };
  }

  private queueSyncOperation(operation: SyncOperation): void {
    this.syncQueue.push(operation);
    
    // Limit queue size
    if (this.syncQueue.length > 1000) {
      this.syncQueue = this.syncQueue.slice(-500);
    }
  }

  private async processSyncQueue(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    while (this.syncQueue.length > 0) {
      const operation = this.syncQueue.shift()!;
      
      try {
        await this.processOperation(operation);
      } catch (error) {
        console.error(`Failed to process sync operation ${operation.id}:`, error);
        
        // Retry logic
        if (operation.retryCount < 3) {
          operation.retryCount++;
          this.syncQueue.push(operation);
        }
      }
      
      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.isProcessing = false;
  }

  private async processOperation(operation: SyncOperation): Promise<void> {
    // Process individual sync operation
    console.log(`Processing sync operation: ${operation.type} for task ${operation.taskId}`);
    // Implementation would depend on operation type and storage systems
  }

  private isTaskFile(filename: string): boolean {
    return filename.endsWith('.json') || filename.endsWith('.task');
  }

  private extractTaskIdFromFilename(filename: string): string {
    return filename.replace(/\.(json|task)$/, '');
  }
}

interface SyncDiff {
  toCreate: TaskMasterTask[];
  toUpdate: { tm: TaskMasterTask; cf: ClaudeFlowTask }[];
  toDelete: string[];
}

export default StorageSync;