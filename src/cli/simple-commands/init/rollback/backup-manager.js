// backup-manager.js - Backup creation and management

// Phase 2 Runtime Migration: Deno compatibility layer
import Deno from '../../../../utils/deno-compat.js';
// Node.js compatible import
import fs from 'fs';

// Polyfill for Deno's ensureDirSync
function ensureDirSync(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

export class BackupManager {
  constructor(workingDir) {
    this.workingDir = workingDir;
    this.backupDir = `${workingDir}/.claude-flow-backups`;
  }

  /**
   * Create a backup of the current state
   */
  async createBackup(type = 'manual', description = '') {
    const result = {
      success: true,
      id: null,
      location: null,
      errors: [],
      warnings: [],
      files: []
    };

    try {
      // Generate backup ID
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupId = `${type}-${timestamp}`;
      result.id = backupId;

      // Create backup directory
      const backupPath = `${this.backupDir}/${backupId}`;
      result.location = backupPath;

      await this.ensureBackupDir();
      await Deno.mkdir(backupPath, { recursive: true });

      // Create backup manifest
      const manifest = {
        id: backupId,
        type,
        description,
        timestamp: Date.now(),
        workingDir: this.workingDir,
        files: [],
        directories: []
      };

      // Backup critical files
      const criticalFiles = await this.getCriticalFiles();
      for (const file of criticalFiles) {
        const backupResult = await this.backupFile(file, backupPath);
        if (backupResult.success) {
          manifest.files.push(backupResult.fileInfo);
          result.files.push(file);
        } else {
          result.warnings.push(`Failed to backup file: ${file}`);
        }
      }

      // Backup critical directories
      const criticalDirs = await this.getCriticalDirectories();
      for (const dir of criticalDirs) {
        const backupResult = await this.backupDirectory(dir, backupPath);
        if (backupResult.success) {
          manifest.directories.push(backupResult.dirInfo);
        } else {
          result.warnings.push(`Failed to backup directory: ${dir}`);
        }
      }

      // Save manifest
      await Deno.writeTextFile(
        `${backupPath}/manifest.json`,
        JSON.stringify(manifest, null, 2)
      );

      // Create backup metadata
      const metadata = {
        created: Date.now(),
        size: await this.calculateBackupSize(backupPath),
        fileCount: manifest.files.length,
        dirCount: manifest.directories.length
      };

      await Deno.writeTextFile(
        `${backupPath}/metadata.json`,
        JSON.stringify(metadata, null, 2)
      );

      console.log(`  ✓ Backup created: ${backupId}`);
      console.log(`  📁 Files backed up: ${result.files.length}`);

    } catch (error) {
      result.success = false;
      result.errors.push(`Backup creation failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Restore from backup
   */
  async restoreBackup(backupId) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      restored: []
    };

    try {
      const backupPath = `${this.backupDir}/${backupId}`;
      
      // Check if backup exists
      try {
        await Deno.stat(backupPath);
      } catch {
        result.success = false;
        result.errors.push(`Backup not found: ${backupId}`);
        return result;
      }

      // Read manifest
      const manifestPath = `${backupPath}/manifest.json`;
      const manifestContent = await Deno.readTextFile(manifestPath);
      const manifest = JSON.parse(manifestContent);

      // Restore files
      for (const fileInfo of manifest.files) {
        const restoreResult = await this.restoreFile(fileInfo, backupPath);
        if (restoreResult.success) {
          result.restored.push(fileInfo.originalPath);
        } else {
          result.warnings.push(`Failed to restore file: ${fileInfo.originalPath}`);
        }
      }

      // Restore directories
      for (const dirInfo of manifest.directories) {
        const restoreResult = await this.restoreDirectory(dirInfo, backupPath);
        if (restoreResult.success) {
          result.restored.push(dirInfo.originalPath);
        } else {
          result.warnings.push(`Failed to restore directory: ${dirInfo.originalPath}`);
        }
      }

      console.log(`  ✓ Backup restored: ${backupId}`);
      console.log(`  📁 Items restored: ${result.restored.length}`);

    } catch (error) {
      result.success = false;
      result.errors.push(`Backup restoration failed: ${error.message}`);
    }

    return result;
  }

  /**
   * List available backups
   */
  async listBackups() {
    const backups = [];

    try {
      await this.ensureBackupDir();
      
      for await (const entry of Deno.readDir(this.backupDir)) {
        if (entry.isDirectory) {
          try {
            const metadataPath = `${this.backupDir}/${entry.name}/metadata.json`;
            const manifestPath = `${this.backupDir}/${entry.name}/manifest.json`;
            
            const metadata = JSON.parse(await Deno.readTextFile(metadataPath));
            const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
            
            backups.push({
              id: entry.name,
              type: manifest.type,
              description: manifest.description,
              created: metadata.created,
              size: metadata.size,
              fileCount: metadata.fileCount,
              dirCount: metadata.dirCount
            });
          } catch {
            // Skip invalid backup directories
          }
        }
      }
    } catch {
      // Backup directory doesn't exist or can't be read
    }

    return backups.sort((a, b) => b.created - a.created);
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId) {
    const result = {
      success: true,
      errors: []
    };

    try {
      const backupPath = `${this.backupDir}/${backupId}`;
      await Deno.remove(backupPath, { recursive: true });
      console.log(`  🗑️  Deleted backup: ${backupId}`);
    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to delete backup: ${error.message}`);
    }

    return result;
  }

  /**
   * Clean up old backups
   */
  async cleanupOldBackups(keepCount = 5) {
    const result = {
      success: true,
      cleaned: [],
      errors: []
    };

    try {
      const backups = await this.listBackups();
      
      if (backups.length > keepCount) {
        const toDelete = backups.slice(keepCount);
        
        for (const backup of toDelete) {
          const deleteResult = await this.deleteBackup(backup.id);
          if (deleteResult.success) {
            result.cleaned.push(backup.id);
          } else {
            result.errors.push(...deleteResult.errors);
          }
        }
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Cleanup failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Validate backup system
   */
  async validateBackupSystem() {
    const result = {
      success: true,
      errors: [],
      warnings: []
    };

    try {
      // Check backup directory
      await this.ensureBackupDir();
      
      // Test backup creation
      const testBackup = await this.createTestBackup();
      if (!testBackup.success) {
        result.success = false;
        result.errors.push('Cannot create test backup');
      } else {
        // Clean up test backup
        await this.deleteBackup(testBackup.id);
      }

      // Check disk space
      const spaceCheck = await this.checkBackupDiskSpace();
      if (!spaceCheck.adequate) {
        result.warnings.push('Low disk space for backups');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Backup system validation failed: ${error.message}`);
    }

    return result;
  }

  // Helper methods

  async ensureBackupDir() {
    try {
      await Deno.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }
  }

  async getCriticalFiles() {
    const files = [];
    const potentialFiles = [
      'CLAUDE.md',
      'memory-bank.md',
      'coordination.md',
      'package.json',
      'package-lock.json',
      '.roomodes',
      'claude-flow',
      'memory/claude-flow-data.json'
    ];

    for (const file of potentialFiles) {
      try {
        const stat = await Deno.stat(`${this.workingDir}/${file}`);
        if (stat.isFile) {
          files.push(file);
        }
      } catch {
        // File doesn't exist
      }
    }

    return files;
  }

  async getCriticalDirectories() {
    const dirs = [];
    const potentialDirs = [
      '.claude',
      '.roo',
      'memory/agents',
      'memory/sessions',
      'coordination'
    ];

    for (const dir of potentialDirs) {
      try {
        const stat = await Deno.stat(`${this.workingDir}/${dir}`);
        if (stat.isDirectory) {
          dirs.push(dir);
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return dirs;
  }

  async backupFile(relativePath, backupPath) {
    const result = {
      success: true,
      fileInfo: null
    };

    try {
      const sourcePath = `${this.workingDir}/${relativePath}`;
      const destPath = `${backupPath}/${relativePath}`;
      
      // Ensure destination directory exists
      const destDir = destPath.split('/').slice(0, -1).join('/');
      await Deno.mkdir(destDir, { recursive: true });
      
      // Copy file
      await Deno.copyFile(sourcePath, destPath);
      
      // Get file info
      const stat = await Deno.stat(sourcePath);
      result.fileInfo = {
        originalPath: relativePath,
        backupPath: destPath,
        size: stat.size,
        modified: stat.mtime?.getTime() || 0
      };

    } catch (error) {
      result.success = false;
      result.error = error.message;
    }

    return result;
  }

  async backupDirectory(relativePath, backupPath) {
    const result = {
      success: true,
      dirInfo: null
    };

    try {
      const sourcePath = `${this.workingDir}/${relativePath}`;
      const destPath = `${backupPath}/${relativePath}`;
      
      // Create destination directory
      await Deno.mkdir(destPath, { recursive: true });
      
      // Copy directory contents recursively
      await this.copyDirectoryRecursive(sourcePath, destPath);
      
      result.dirInfo = {
        originalPath: relativePath,
        backupPath: destPath
      };

    } catch (error) {
      result.success = false;
      result.error = error.message;
    }

    return result;
  }

  async copyDirectoryRecursive(source, dest) {
    for await (const entry of Deno.readDir(source)) {
      const sourcePath = `${source}/${entry.name}`;
      const destPath = `${dest}/${entry.name}`;
      
      if (entry.isFile) {
        await Deno.copyFile(sourcePath, destPath);
      } else if (entry.isDirectory) {
        await Deno.mkdir(destPath, { recursive: true });
        await this.copyDirectoryRecursive(sourcePath, destPath);
      }
    }
  }

  async restoreFile(fileInfo, backupPath) {
    const result = {
      success: true
    };

    try {
      const sourcePath = fileInfo.backupPath;
      const destPath = `${this.workingDir}/${fileInfo.originalPath}`;
      
      // Ensure destination directory exists
      const destDir = destPath.split('/').slice(0, -1).join('/');
      await Deno.mkdir(destDir, { recursive: true });
      
      // Copy file back
      await Deno.copyFile(sourcePath, destPath);

    } catch (error) {
      result.success = false;
      result.error = error.message;
    }

    return result;
  }

  async restoreDirectory(dirInfo, backupPath) {
    const result = {
      success: true
    };

    try {
      const sourcePath = dirInfo.backupPath;
      const destPath = `${this.workingDir}/${dirInfo.originalPath}`;
      
      // Remove existing directory if it exists
      try {
        await Deno.remove(destPath, { recursive: true });
      } catch {
        // Directory might not exist
      }
      
      // Create destination directory
      await Deno.mkdir(destPath, { recursive: true });
      
      // Copy directory contents back
      await this.copyDirectoryRecursive(sourcePath, destPath);

    } catch (error) {
      result.success = false;
      result.error = error.message;
    }

    return result;
  }

  async calculateBackupSize(backupPath) {
    let totalSize = 0;

    try {
      for await (const entry of Deno.readDir(backupPath)) {
        const entryPath = `${backupPath}/${entry.name}`;
        const stat = await Deno.stat(entryPath);
        
        if (stat.isFile) {
          totalSize += stat.size;
        } else if (stat.isDirectory) {
          totalSize += await this.calculateBackupSize(entryPath);
        }
      }
    } catch {
      // Error calculating size
    }

    return totalSize;
  }

  async createTestBackup() {
    try {
      return await this.createBackup('test', 'System validation test');
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async checkBackupDiskSpace() {
    const result = {
      adequate: true,
      available: 0
    };

    try {
      const command = new Deno.Command('df', {
        args: ['-k', this.backupDir],
        stdout: 'piped'
      });

      const { stdout, success } = await command.output();
      
      if (success) {
        const output = new TextDecoder().decode(stdout);
        const lines = output.trim().split('\n');
        
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          if (parts.length >= 4) {
            result.available = parseInt(parts[3]) / 1024; // MB
            result.adequate = result.available > 500; // At least 500MB for backups
          }
        }
      }
    } catch {
      // Can't check - assume adequate
      result.adequate = true;
    }

    return result;
  }
}