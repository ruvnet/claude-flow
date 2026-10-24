// rollback.test.js - Tests for rollback and recovery mechanisms
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import { RollbackSystem, createAtomicOperation } from '../../../../../src/cli/simple-commands/init/rollback/index.js';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    copyFile: jest.fn(),
    rm: jest.fn(),
    access: jest.fn(),
  },
}));

jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  dirname: jest.fn((path) => path.split('/').slice(0, -1).join('/')),
  basename: jest.fn((path) => path.split('/').pop()),
}));

describe('RollbackSystem', () => {
  let rollbackSystem;
  const testWorkingDir = '/test/workspace';

  beforeEach(() => {
    jest.clearAllMocks();
    rollbackSystem = new RollbackSystem(testWorkingDir);

    // Setup default mock responses
    fs.mkdir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    fs.readFile.mockResolvedValue('{}');
    fs.readdir.mockResolvedValue([]);
    fs.stat.mockResolvedValue({ isFile: () => true, isDirectory: () => false });
    fs.copyFile.mockResolvedValue();
    fs.rm.mockResolvedValue();
    fs.access.mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Backup Management', () => {
    it('should create pre-init backup successfully', async () => {
      // Mock existing files
      fs.readdir.mockResolvedValue(['CLAUDE.md', 'package.json']);
      fs.stat.mockImplementation((path) => {
        if (path.endsWith('CLAUDE.md') || path.endsWith('package.json')) {
          return Promise.resolve({ isFile: () => true, isDirectory: () => false });
        }
        return Promise.resolve({ isFile: () => false, isDirectory: () => true });
      });

      const result = await rollbackSystem.createPreInitBackup();

      expect(result.success).toBe(true);
      expect(result.backupId).toBeDefined();
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.rollback'),
        { recursive: true }
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        expect.any(String)
      );
    });

    it('should handle backup creation errors gracefully', async () => {
      fs.mkdir.mockRejectedValue(new Error('Permission denied'));

      const result = await rollbackSystem.createPreInitBackup();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Permission denied');
    });

    it('should create incremental backups', async () => {
      // First backup
      const backup1 = await rollbackSystem.createPreInitBackup();
      expect(backup1.success).toBe(true);

      // Second backup should have different ID
      const backup2 = await rollbackSystem.createPreInitBackup();
      expect(backup2.success).toBe(true);
      expect(backup2.backupId).not.toBe(backup1.backupId);
    });

    it('should backup only relevant files', async () => {
      fs.readdir.mockResolvedValue([
        'CLAUDE.md',
        '.claude',
        'package.json',
        'node_modules',
        '.git',
        'random.txt'
      ]);

      fs.stat.mockImplementation((path) => {
        if (path.includes('node_modules') || path.includes('.git')) {
          return Promise.resolve({ isFile: () => false, isDirectory: () => true });
        }
        return Promise.resolve({ isFile: () => true, isDirectory: () => false });
      });

      await rollbackSystem.createPreInitBackup();

      // Should not backup node_modules or .git
      expect(fs.copyFile).toHaveBeenCalledWith(
        expect.stringContaining('CLAUDE.md'),
        expect.any(String)
      );
      expect(fs.copyFile).toHaveBeenCalledWith(
        expect.stringContaining('package.json'),
        expect.any(String)
      );
      expect(fs.copyFile).not.toHaveBeenCalledWith(
        expect.stringContaining('node_modules'),
        expect.any(String)
      );
      expect(fs.copyFile).not.toHaveBeenCalledWith(
        expect.stringContaining('.git'),
        expect.any(String)
      );
    });
  });

  describe('Checkpoint Management', () => {
    it('should create checkpoints during operations', async () => {
      const checkpointData = {
        phase: 'file-creation',
        timestamp: Date.now(),
        files: ['CLAUDE.md', '.claude/settings.json']
      };

      const result = await rollbackSystem.createCheckpoint('test-checkpoint', checkpointData);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('checkpoint.json'),
        expect.stringContaining('"phase":"file-creation"')
      );
    });

    it('should list rollback points and checkpoints', async () => {
      // Mock rollback directory structure
      fs.readdir.mockImplementation((path) => {
        if (path.includes('.rollback')) {
          return Promise.resolve(['backup-123', 'backup-456']);
        }
        if (path.includes('backup-')) {
          return Promise.resolve(['manifest.json', 'checkpoint.json']);
        }
        return Promise.resolve([]);
      });

      fs.readFile.mockImplementation((path) => {
        if (path.includes('manifest.json')) {
          return Promise.resolve(JSON.stringify({
            type: 'pre-init',
            timestamp: Date.now(),
            files: ['CLAUDE.md']
          }));
        }
        if (path.includes('checkpoint.json')) {
          return Promise.resolve(JSON.stringify({
            phase: 'file-creation',
            timestamp: Date.now(),
            status: 'completed'
          }));
        }
        return Promise.resolve('{}');
      });

      const result = await rollbackSystem.listRollbackPoints();

      expect(result.rollbackPoints).toHaveLength(2);
      expect(result.checkpoints).toHaveLength(2);
    });

    it('should handle corrupted checkpoint data', async () => {
      fs.readFile.mockResolvedValue('invalid json {');

      const result = await rollbackSystem.listRollbackPoints();

      expect(result.success).toBe(true);
      expect(result.rollbackPoints).toHaveLength(0);
      expect(result.errors).toContain(expect.stringContaining('Failed to parse'));
    });
  });

  describe('Rollback Operations', () => {
    it('should perform full rollback successfully', async () => {
      // Mock backup structure
      fs.readdir.mockImplementation((path) => {
        if (path.includes('backup-123')) {
          return Promise.resolve(['CLAUDE.md', 'package.json']);
        }
        return Promise.resolve(['backup-123']);
      });

      fs.readFile.mockImplementation((path) => {
        if (path.includes('manifest.json')) {
          return Promise.resolve(JSON.stringify({
            type: 'pre-init',
            timestamp: Date.now(),
            files: ['CLAUDE.md', 'package.json']
          }));
        }
        return Promise.resolve('{}');
      });

      const result = await rollbackSystem.performFullRollback('backup-123');

      expect(result.success).toBe(true);
      expect(fs.copyFile).toHaveBeenCalledWith(
        expect.stringContaining('backup-123/CLAUDE.md'),
        expect.stringContaining('CLAUDE.md')
      );
    });

    it('should perform partial rollback for specific phase', async () => {
      // Mock checkpoint data
      fs.readFile.mockResolvedValue(JSON.stringify({
        phase: 'file-creation',
        timestamp: Date.now(),
        files: ['CLAUDE.md'],
        actions: [
          { type: 'create', path: 'CLAUDE.md' },
          { type: 'mkdir', path: '.claude' }
        ]
      }));

      const result = await rollbackSystem.performPartialRollback('file-creation');

      expect(result.success).toBe(true);
      expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining('CLAUDE.md'));
      expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining('.claude'));
    });

    it('should handle rollback failures gracefully', async () => {
      fs.copyFile.mockRejectedValue(new Error('File not found'));

      const result = await rollbackSystem.performFullRollback('backup-123');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('File not found');
    });

    it('should validate backup before rollback', async () => {
      // Mock missing backup
      fs.access.mockRejectedValue(new Error('Backup not found'));

      const result = await rollbackSystem.performFullRollback('missing-backup');

      expect(result.success).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('Backup not found'));
    });
  });

  describe('Atomic Operations', () => {
    it('should create atomic operation context', async () => {
      const atomicOp = createAtomicOperation(rollbackSystem, 'test-operation');

      expect(atomicOp).toBeDefined();
      expect(atomicOp.begin).toBeDefined();
      expect(atomicOp.commit).toBeDefined();
      expect(atomicOp.rollback).toBeDefined();
    });

    it('should handle atomic operation lifecycle', async () => {
      const atomicOp = createAtomicOperation(rollbackSystem, 'test-operation');

      // Begin operation
      const beginResult = await atomicOp.begin();
      expect(beginResult).toBe(true);

      // Simulate some operations
      await rollbackSystem.createCheckpoint('step1', { phase: 'step1' });
      await rollbackSystem.createCheckpoint('step2', { phase: 'step2' });

      // Commit operation
      const commitResult = await atomicOp.commit();
      expect(commitResult).toBe(true);
      expect(atomicOp.completed).toBe(true);
    });

    it('should rollback on atomic operation failure', async () => {
      const atomicOp = createAtomicOperation(rollbackSystem, 'failing-operation');

      await atomicOp.begin();

      // Create some checkpoints
      await rollbackSystem.createCheckpoint('step1', {
        phase: 'step1',
        actions: [{ type: 'create', path: 'test-file.txt' }]
      });

      // Rollback operation
      const rollbackResult = await atomicOp.rollback();
      expect(rollbackResult).toBe(true);
      expect(atomicOp.completed).toBe(true);

      // Should have cleaned up created files
      expect(fs.rm).toHaveBeenCalledWith(
        expect.stringContaining('test-file.txt')
      );
    });

    it('should prevent double commit/rollback', async () => {
      const atomicOp = createAtomicOperation(rollbackSystem, 'test-operation');

      await atomicOp.begin();
      await atomicOp.commit();

      // Second commit should fail
      const secondCommit = await atomicOp.commit();
      expect(secondCommit).toBe(false);

      // Rollback after commit should fail
      const rollbackAfterCommit = await atomicOp.rollback();
      expect(rollbackAfterCommit).toBe(false);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from partial file corruption', async () => {
      // Mock some files as corrupted
      fs.readFile.mockImplementation((path) => {
        if (path.includes('corrupted.json')) {
          return Promise.reject(new Error('File corrupted'));
        }
        return Promise.resolve('{}');
      });

      const result = await rollbackSystem.listRollbackPoints();

      expect(result.success).toBe(true);
      expect(result.warnings).toContain(
        expect.stringContaining('Failed to read')
      );
    });

    it('should handle disk space issues during backup', async () => {
      fs.copyFile.mockRejectedValue(new Error('No space left on device'));

      const result = await rollbackSystem.createPreInitBackup();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('No space left on device');
    });

    it('should cleanup incomplete operations', async () => {
      const atomicOp = createAtomicOperation(rollbackSystem, 'incomplete-operation');

      await atomicOp.begin();

      // Simulate process interruption
      const rollbackResult = await atomicOp.rollback();
      expect(rollbackResult).toBe(true);

      // Verify cleanup occurred
      expect(fs.rm).toHaveBeenCalled();
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle large backup operations efficiently', async () => {
      // Mock many files
      const manyFiles = Array.from({ length: 1000 }, (_, i) => `file${i}.txt`);
      fs.readdir.mockResolvedValue(manyFiles);

      const startTime = Date.now();
      const result = await rollbackSystem.createPreInitBackup();
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should limit backup size to prevent disk exhaustion', async () => {
      // Mock very large files
      fs.stat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100 * 1024 * 1024 // 100MB per file
      });

      fs.readdir.mockResolvedValue(['huge1.txt', 'huge2.txt', 'huge3.txt']);

      const result = await rollbackSystem.createPreInitBackup();

      // Should either succeed with size limits or fail gracefully
      if (result.success) {
        expect(result.warnings).toContain(
          expect.stringContaining('large files')
        );
      } else {
        expect(result.errors).toContain(
          expect.stringContaining('too large')
        );
      }
    });

    it('should cleanup old backups automatically', async () => {
      // Mock many old backups
      const oldBackups = Array.from({ length: 20 }, (_, i) => `backup-${i}`);
      fs.readdir.mockResolvedValue(oldBackups);

      fs.readFile.mockImplementation((path) => {
        const backupNum = path.match(/backup-(\d+)/)?.[1];
        return Promise.resolve(JSON.stringify({
          type: 'pre-init',
          timestamp: Date.now() - (backupNum * 24 * 60 * 60 * 1000), // Days old
          files: []
        }));
      });

      await rollbackSystem.createPreInitBackup();

      // Should have cleaned up some old backups
      expect(fs.rm).toHaveBeenCalledWith(
        expect.stringContaining('backup-'),
        { recursive: true }
      );
    });
  });
});

describe('RollbackSystem Integration', () => {
  it('should integrate with initialization workflow', async () => {
    const rollbackSystem = new RollbackSystem('/test/workspace');

    // Create backup before init
    const backupResult = await rollbackSystem.createPreInitBackup();
    expect(backupResult.success).toBe(true);

    // Create atomic operation for init
    const atomicOp = createAtomicOperation(rollbackSystem, 'init-workflow');
    await atomicOp.begin();

    // Simulate init steps with checkpoints
    await rollbackSystem.createCheckpoint('files', {
      phase: 'file-creation',
      actions: [
        { type: 'create', path: 'CLAUDE.md' },
        { type: 'mkdir', path: '.claude' }
      ]
    });

    await rollbackSystem.createCheckpoint('directories', {
      phase: 'directory-creation',
      actions: [
        { type: 'mkdir', path: 'memory' },
        { type: 'mkdir', path: 'coordination' }
      ]
    });

    // Commit successful init
    const commitResult = await atomicOp.commit();
    expect(commitResult).toBe(true);
  });

  it('should handle init failure with automatic rollback', async () => {
    const rollbackSystem = new RollbackSystem('/test/workspace');

    const atomicOp = createAtomicOperation(rollbackSystem, 'failing-init');
    await atomicOp.begin();

    // Simulate partial init
    await rollbackSystem.createCheckpoint('partial', {
      phase: 'file-creation',
      actions: [
        { type: 'create', path: 'CLAUDE.md' }
      ]
    });

    // Simulate failure and rollback
    const rollbackResult = await atomicOp.rollback();
    expect(rollbackResult).toBe(true);

    // Verify cleanup
    expect(fs.rm).toHaveBeenCalledWith(
      expect.stringContaining('CLAUDE.md')
    );
  });
});