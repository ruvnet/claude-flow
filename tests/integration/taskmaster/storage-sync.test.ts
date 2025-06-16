/**
 * Storage Synchronization Integration Tests
 * Tests bidirectional sync, conflict resolution, and file watching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'npm:vitest';
import { StorageSync } from '../../../src/integrations/taskmaster/services/storage-sync.ts';
import { TaskAdapter } from '../../../src/integrations/taskmaster/adapters/task-adapter.ts';
import {
  TaskMasterTask,
  ClaudeFlowTask,
  TaskMasterStatus,
  ClaudeFlowStatus,
  TaskMasterPriority,
  ClaudeFlowPriority,
  SyncResult,
  Conflict
} from '../../../src/integrations/taskmaster/types/task-types.ts';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock fs module for testing
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    watch: vi.fn()
  };
});

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn()
}));

describe('StorageSync Integration Tests', () => {
  let storageSync: StorageSync;
  let taskAdapter: TaskAdapter;
  let mockTempDir: string;
  let mockTaskMasterTasks: TaskMasterTask[];
  let mockClaudeFlowTasks: ClaudeFlowTask[];

  beforeEach(() => {
    taskAdapter = new TaskAdapter();
    storageSync = new StorageSync(taskAdapter);
    mockTempDir = join(tmpdir(), 'taskmaster-test');

    mockTaskMasterTasks = [
      {
        id: 'tm-1',
        title: 'Setup Project Structure',
        description: 'Initialize project with proper directory structure',
        status: TaskMasterStatus.DONE,
        priority: TaskMasterPriority.HIGH,
        tags: ['setup', 'infrastructure'],
        estimate: 2,
        createdAt: new Date('2024-01-01T10:00:00Z'),
        updatedAt: new Date('2024-01-01T12:00:00Z'),
        metadata: {
          prd_section: 'Project Setup',
          complexity: 3,
          ai_generated: true,
          model_used: 'claude-3-opus'
        }
      },
      {
        id: 'tm-2',
        title: 'Implement Authentication',
        description: 'Build user authentication with JWT',
        status: TaskMasterStatus.IN_PROGRESS,
        priority: TaskMasterPriority.CRITICAL,
        tags: ['auth', 'security'],
        dependencies: ['tm-1'],
        estimate: 8,
        assignee: 'developer-1',
        createdAt: new Date('2024-01-01T11:00:00Z'),
        updatedAt: new Date('2024-01-02T09:00:00Z'),
        metadata: {
          prd_section: 'Authentication Requirements',
          complexity: 7,
          ai_generated: true,
          model_used: 'claude-3-opus'
        }
      }
    ];

    mockClaudeFlowTasks = [
      {
        id: 'cf-1',
        title: 'Design System Architecture',
        description: 'Create overall system architecture diagram',
        status: ClaudeFlowStatus.COMPLETED,
        priority: ClaudeFlowPriority.HIGH,
        phase: 'architecture' as any,
        agent: 'architect',
        estimatedHours: 4,
        createdAt: new Date('2024-01-01T09:00:00Z'),
        updatedAt: new Date('2024-01-01T13:00:00Z')
      },
      {
        id: 'tm-2', // Same ID as TaskMaster task for conflict testing
        title: 'Implement User Authentication',
        description: 'Build secure user authentication system',
        status: ClaudeFlowStatus.IN_PROGRESS,
        priority: ClaudeFlowPriority.HIGH,
        phase: 'refinement' as any,
        agent: 'code',
        dependencies: ['cf-1'],
        estimatedHours: 6,
        createdAt: new Date('2024-01-01T11:00:00Z'),
        updatedAt: new Date('2024-01-01T15:00:00Z')
      }
    ];

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    storageSync.disableWatcher();
  });

  describe('Sync From TaskMaster', () => {
    it('should successfully sync tasks from TaskMaster directory', async () => {
      // Mock file system operations
      vi.mocked(fs.readdir).mockResolvedValue(['tm-1.json', 'tm-2.json', 'readme.txt'] as any);
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockTaskMasterTasks[0]))
        .mockResolvedValueOnce(JSON.stringify(mockTaskMasterTasks[1]));

      // Mock StorageSync's private methods through implementation
      const syncSpy = vi.spyOn(storageSync as any, 'getClaudeFlowData').mockResolvedValue([]);
      const applySpy = vi.spyOn(storageSync as any, 'applySync').mockResolvedValue({ count: 2 });

      const result = await storageSync.syncFromTaskMaster(mockTempDir);

      expect(result.success).toBe(true);
      expect(result.syncedTasks).toBe(2);
      expect(result.conflicts).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(syncSpy).toHaveBeenCalled();
      expect(applySpy).toHaveBeenCalled();
    });

    it('should handle invalid task files gracefully', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['valid.json', 'invalid.json'] as any);
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockTaskMasterTasks[0]))
        .mockResolvedValueOnce('{ invalid json }');

      // Mock console.warn to avoid test output pollution
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.spyOn(storageSync as any, 'getClaudeFlowData').mockResolvedValue([]);
      vi.spyOn(storageSync as any, 'applySync').mockResolvedValue({ count: 1 });

      const result = await storageSync.syncFromTaskMaster(mockTempDir);

      expect(result.success).toBe(true);
      expect(result.syncedTasks).toBe(1);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('should detect and resolve conflicts during sync', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['tm-2.json'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTaskMasterTasks[1]));

      // Mock existing ClaudeFlow task that conflicts
      vi.spyOn(storageSync as any, 'getClaudeFlowData').mockResolvedValue([mockClaudeFlowTasks[1]]);
      
      const conflictResolveSpy = vi.spyOn(storageSync as any, 'conflictResolver').mockReturnValue({
        resolve: vi.fn().mockResolvedValue([{
          taskId: 'tm-2',
          field: 'title',
          resolvedValue: 'Implement Authentication',
          strategy: 'merge'
        }])
      });

      vi.spyOn(storageSync as any, 'applySync').mockResolvedValue({ count: 1 });
      vi.spyOn(storageSync as any, 'applyResolutions').mockResolvedValue();

      const result = await storageSync.syncFromTaskMaster(mockTempDir);

      expect(result.success).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it('should handle sync errors gracefully', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Directory not found'));

      const result = await storageSync.syncFromTaskMaster('/nonexistent');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Directory not found');
      expect(result.syncedTasks).toBe(0);
    });
  });

  describe('Sync To TaskMaster', () => {
    it('should successfully sync tasks to TaskMaster format', async () => {
      vi.spyOn(storageSync as any, 'getClaudeFlowTasksForProject').mockResolvedValue(mockClaudeFlowTasks);
      vi.spyOn(storageSync as any, 'writeTaskMasterData').mockResolvedValue();

      const result = await storageSync.syncToTaskMaster('test-project');

      expect(result.success).toBe(true);
      expect(result.syncedTasks).toBe(mockClaudeFlowTasks.length);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle conversion errors during sync to TaskMaster', async () => {
      const invalidTask = { id: 'invalid' } as ClaudeFlowTask;
      vi.spyOn(storageSync as any, 'getClaudeFlowTasksForProject').mockResolvedValue([invalidTask]);
      vi.spyOn(storageSync as any, 'writeTaskMasterData').mockResolvedValue();

      // Mock console.warn to check error handling
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await storageSync.syncToTaskMaster('test-project');

      expect(result.success).toBe(true);
      expect(result.syncedTasks).toBe(0); // Invalid task should be filtered out
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('should handle write errors gracefully', async () => {
      vi.spyOn(storageSync as any, 'getClaudeFlowTasksForProject').mockResolvedValue(mockClaudeFlowTasks);
      vi.spyOn(storageSync as any, 'writeTaskMasterData').mockRejectedValue(new Error('Write failed'));

      const result = await storageSync.syncToTaskMaster('test-project');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Write failed');
    });
  });

  describe('File System Watcher', () => {
    it('should enable file system watcher successfully', () => {
      const mockWatcher = {
        close: vi.fn()
      };
      
      const { watch } = require('fs');
      watch.mockReturnValue(mockWatcher);

      storageSync.enableWatcher(mockTempDir);

      expect(watch).toHaveBeenCalledWith(
        mockTempDir,
        { recursive: true },
        expect.any(Function)
      );

      const status = storageSync.getSyncStatus();
      expect(status.isWatching).toBe(true);
    });

    it('should disable existing watcher before enabling new one', () => {
      const mockWatcher1 = { close: vi.fn() };
      const mockWatcher2 = { close: vi.fn() };
      
      const { watch } = require('fs');
      watch.mockReturnValueOnce(mockWatcher1).mockReturnValueOnce(mockWatcher2);

      storageSync.enableWatcher(mockTempDir);
      storageSync.enableWatcher('/another/path');

      expect(mockWatcher1.close).toHaveBeenCalled();
      expect(watch).toHaveBeenCalledTimes(2);
    });

    it('should disable file system watcher', () => {
      const mockWatcher = { close: vi.fn() };
      const { watch } = require('fs');
      watch.mockReturnValue(mockWatcher);

      storageSync.enableWatcher(mockTempDir);
      storageSync.disableWatcher();

      expect(mockWatcher.close).toHaveBeenCalled();
      
      const status = storageSync.getSyncStatus();
      expect(status.isWatching).toBe(false);
    });

    it('should handle watcher errors gracefully', () => {
      const { watch } = require('fs');
      watch.mockImplementation(() => {
        throw new Error('Watch failed');
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      storageSync.enableWatcher(mockTempDir);

      expect(errorSpy).toHaveBeenCalledWith('Failed to enable file watcher:', expect.any(Error));
      
      const status = storageSync.getSyncStatus();
      expect(status.errors).toContain('Failed to enable file watcher');

      errorSpy.mockRestore();
    });
  });

  describe('Conflict Resolution', () => {
    it('should resolve conflicts using auto conflict resolver', async () => {
      const conflicts: Conflict[] = [
        {
          taskId: 'test-1',
          field: 'status',
          taskMasterValue: TaskMasterStatus.DONE,
          claudeFlowValue: ClaudeFlowStatus.IN_PROGRESS,
          source: 'taskmaster'
        }
      ];

      const resolutions = await storageSync.resolveConflicts(conflicts);

      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].taskId).toBe('test-1');
      expect(resolutions[0].strategy).toBe('merge');
    });
  });

  describe('Backup and Restore', () => {
    it('should create backup successfully', async () => {
      const backupPath = '/tmp/backup.json';
      vi.mocked(fs.writeFile).mockResolvedValue();
      vi.spyOn(storageSync as any, 'getClaudeFlowData').mockResolvedValue(mockClaudeFlowTasks);

      await storageSync.backup(backupPath);

      expect(fs.writeFile).toHaveBeenCalledWith(
        backupPath,
        expect.stringContaining('claudeFlowTasks')
      );
    });

    it('should handle backup errors', async () => {
      const backupPath = '/invalid/path/backup.json';
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Permission denied'));
      vi.spyOn(storageSync as any, 'getClaudeFlowData').mockResolvedValue(mockClaudeFlowTasks);

      await expect(storageSync.backup(backupPath)).rejects.toThrow('Permission denied');
    });

    it('should restore from backup successfully', async () => {
      const backupContent = {
        timestamp: '2024-01-01T00:00:00.000Z',
        version: '1.0',
        claudeFlowTasks: mockClaudeFlowTasks,
        metadata: { totalTasks: 2 }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(backupContent));
      vi.spyOn(storageSync as any, 'restoreClaudeFlowData').mockResolvedValue();

      await storageSync.restore('/tmp/backup.json');

      expect(fs.readFile).toHaveBeenCalledWith('/tmp/backup.json', 'utf-8');
    });

    it('should handle invalid backup format', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{ "invalid": "backup" }');

      await expect(storageSync.restore('/tmp/invalid.json')).rejects.toThrow('Invalid backup format');
    });

    it('should handle restore file not found', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      await expect(storageSync.restore('/tmp/nonexistent.json')).rejects.toThrow('File not found');
    });
  });

  describe('Status Monitoring', () => {
    it('should return current sync status', () => {
      const status = storageSync.getSyncStatus();

      expect(status).toHaveProperty('isWatching');
      expect(status).toHaveProperty('lastSync');
      expect(status).toHaveProperty('queuedOperations');
      expect(status).toHaveProperty('conflicts');
      expect(status).toHaveProperty('errors');
      expect(Array.isArray(status.errors)).toBe(true);
    });

    it('should update status after successful sync', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['test.json'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTaskMasterTasks[0]));
      vi.spyOn(storageSync as any, 'getClaudeFlowData').mockResolvedValue([]);
      vi.spyOn(storageSync as any, 'applySync').mockResolvedValue({ count: 1 });

      await storageSync.syncFromTaskMaster(mockTempDir);

      const status = storageSync.getSyncStatus();
      expect(status.lastSync).toBeInstanceOf(Date);
      expect(status.errors).toHaveLength(0);
    });

    it('should update status after failed sync', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Test error'));

      await storageSync.syncFromTaskMaster('/invalid');

      const status = storageSync.getSyncStatus();
      expect(status.errors).toContain('Test error');
    });
  });

  describe('Private Helper Methods', () => {
    it('should identify task files correctly', () => {
      const isTaskFile = (storageSync as any).isTaskFile;
      
      expect(isTaskFile('task.json')).toBe(true);
      expect(isTaskFile('task.task')).toBe(true);
      expect(isTaskFile('readme.txt')).toBe(false);
      expect(isTaskFile('data.xml')).toBe(false);
    });

    it('should extract task ID from filename', () => {
      const extractTaskId = (storageSync as any).extractTaskIdFromFilename;
      
      expect(extractTaskId('task-123.json')).toBe('task-123');
      expect(extractTaskId('my-task.task')).toBe('my-task');
      expect(extractTaskId('complex-task-name.json')).toBe('complex-task-name');
    });

    it('should calculate sync differences correctly', () => {
      const calculateDiff = (storageSync as any).calculateDiff;
      
      const tmTasks = [mockTaskMasterTasks[0]];
      const cfTasks: ClaudeFlowTask[] = [];
      
      const diff = calculateDiff(tmTasks, cfTasks);
      
      expect(diff.toCreate).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.toDelete).toHaveLength(0);
    });
  });

  describe('Integration with TaskAdapter', () => {
    it('should use TaskAdapter for conflict detection', async () => {
      const detectConflictsSpy = vi.spyOn(taskAdapter, 'detectConflicts');
      
      vi.mocked(fs.readdir).mockResolvedValue(['tm-2.json'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTaskMasterTasks[1]));
      vi.spyOn(storageSync as any, 'getClaudeFlowData').mockResolvedValue([mockClaudeFlowTasks[1]]);
      vi.spyOn(storageSync as any, 'applySync').mockResolvedValue({ count: 1 });
      vi.spyOn(storageSync as any, 'applyResolutions').mockResolvedValue();

      await storageSync.syncFromTaskMaster(mockTempDir);

      expect(detectConflictsSpy).toHaveBeenCalled();
    });

    it('should use TaskAdapter for batch conversions during sync to TaskMaster', async () => {
      const batchToTaskMasterSpy = vi.spyOn(taskAdapter, 'batchToTaskMaster');
      
      vi.spyOn(storageSync as any, 'getClaudeFlowTasksForProject').mockResolvedValue(mockClaudeFlowTasks);
      vi.spyOn(storageSync as any, 'writeTaskMasterData').mockResolvedValue();

      await storageSync.syncToTaskMaster('test-project');

      expect(batchToTaskMasterSpy).toHaveBeenCalledWith(mockClaudeFlowTasks);
    });
  });
});