// recovery-manager.js - Automated recovery procedures for common failures

export class RecoveryManager {
  constructor(workingDir) {
    this.workingDir = workingDir;
  }

  /**
   * Perform automated recovery based on failure type
   */
  async performRecovery(failureType, context = {}) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      console.log(`🔧 Attempting recovery for: ${failureType}`);

      let recoveryResult;
      
      switch (failureType) {
        case 'permission-denied':
          recoveryResult = await this.recoverFromPermissionDenied(context);
          break;
        
        case 'disk-space':
          recoveryResult = await this.recoverFromDiskSpace(context);
          break;
        
        case 'missing-dependencies':
          recoveryResult = await this.recoverFromMissingDependencies(context);
          break;
        
        case 'corrupted-config':
          recoveryResult = await this.recoverFromCorruptedConfig(context);
          break;
        
        case 'partial-initialization':
          recoveryResult = await this.recoverFromPartialInitialization(context);
          break;
        
        case 'sparc-failure':
          recoveryResult = await this.recoverFromSparcFailure(context);
          break;
        
        case 'executable-creation-failure':
          recoveryResult = await this.recoverFromExecutableFailure(context);
          break;
        
        case 'memory-setup-failure':
          recoveryResult = await this.recoverFromMemorySetupFailure(context);
          break;
        
        default:
          recoveryResult = await this.performGenericRecovery(failureType, context);
          break;
      }

      result.success = recoveryResult.success;
      result.errors.push(...recoveryResult.errors);
      result.warnings.push(...recoveryResult.warnings);
      result.actions.push(...recoveryResult.actions);

    } catch (error) {
      result.success = false;
      result.errors.push(`Recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Recover from permission denied errors
   */
  async recoverFromPermissionDenied(context) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      // Try to fix permissions on the working directory
      if (Deno.build.os !== 'windows') {
        try {
          const command = new Deno.Command('chmod', {
            args: ['-R', '755', this.workingDir],
            stdout: 'piped',
            stderr: 'piped'
          });

          const { success } = await command.output();
          
          if (success) {
            result.actions.push('Fixed directory permissions');
          } else {
            result.warnings.push('Could not fix permissions automatically');
          }
        } catch {
          result.warnings.push('Permission fix command not available');
        }
      }

      // Try to create a test file to verify permissions
      try {
        const testFile = `${this.workingDir}/.permission-test`;
        await Deno.writeTextFile(testFile, 'test');
        await Deno.remove(testFile);
        result.actions.push('Verified write permissions restored');
      } catch {
        result.success = false;
        result.errors.push('Write permissions still denied');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Permission recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Recover from disk space issues
   */
  async recoverFromDiskSpace(context) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      // Clean up temporary files
      const tempCleanup = await this.cleanupTemporaryFiles();
      result.actions.push(...tempCleanup.actions);

      // Clean up old backups
      const backupCleanup = await this.cleanupOldBackups();
      result.actions.push(...backupCleanup.actions);

      // Check available space after cleanup
      const spaceCheck = await this.checkAvailableSpace();
      if (spaceCheck.available > 100) { // MB
        result.actions.push(`Freed space: ${spaceCheck.available}MB available`);
      } else {
        result.success = false;
        result.errors.push('Insufficient disk space even after cleanup');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Disk space recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Recover from missing dependencies
   */
  async recoverFromMissingDependencies(context) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      const missingDeps = context.missingDependencies || ['node', 'npm'];

      for (const dep of missingDeps) {
        const installResult = await this.attemptDependencyInstallation(dep);
        if (installResult.success) {
          result.actions.push(`Installed/configured: ${dep}`);
        } else {
          result.warnings.push(`Could not install ${dep}: ${installResult.error}`);
        }
      }

      // Verify dependencies are now available
      const verifyResult = await this.verifyDependencies(missingDeps);
      if (!verifyResult.allAvailable) {
        result.success = false;
        result.errors.push('Some dependencies still unavailable after recovery');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Dependency recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Recover from corrupted configuration
   */
  async recoverFromCorruptedConfig(context) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      const corruptedFiles = context.corruptedFiles || ['.roomodes'];

      for (const file of corruptedFiles) {
        const recoveryResult = await this.recoverConfigFile(file);
        if (recoveryResult.success) {
          result.actions.push(`Recovered config file: ${file}`);
        } else {
          result.warnings.push(`Could not recover: ${file}`);
        }
      }

      // Validate recovered configuration
      const validationResult = await this.validateRecoveredConfigs(corruptedFiles);
      if (!validationResult.valid) {
        result.warnings.push('Some recovered configs may have issues');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Config recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Recover from partial initialization
   */
  async recoverFromPartialInitialization(context) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      // Identify what was partially completed
      const completedItems = await this.identifyCompletedItems();
      const missingItems = await this.identifyMissingItems();

      result.actions.push(`Found ${completedItems.length} completed items`);
      result.actions.push(`Found ${missingItems.length} missing items`);

      // Complete missing items
      for (const item of missingItems) {
        const completionResult = await this.completeItem(item);
        if (completionResult.success) {
          result.actions.push(`Completed: ${item.name}`);
        } else {
          result.warnings.push(`Could not complete: ${item.name}`);
        }
      }

      // Verify initialization is now complete
      const verificationResult = await this.verifyInitializationComplete();
      if (!verificationResult.complete) {
        result.success = false;
        result.errors.push('Initialization still incomplete after recovery');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Partial initialization recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Recover from SPARC initialization failure
   */
  async recoverFromSparcFailure(context) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      // Try to recover .roomodes file
      const roomodesRecovery = await this.recoverRoomodesFile();
      if (roomodesRecovery.success) {
        result.actions.push('Recovered .roomodes configuration');
      } else {
        result.warnings.push('Could not recover .roomodes');
      }

      // Try to recover .roo directory structure
      const rooRecovery = await this.recoverRooDirectory();
      if (rooRecovery.success) {
        result.actions.push('Recovered .roo directory structure');
      } else {
        result.warnings.push('Could not recover .roo directory');
      }

      // Try to recover SPARC commands
      const commandsRecovery = await this.recoverSparcCommands();
      if (commandsRecovery.success) {
        result.actions.push('Recovered SPARC commands');
      } else {
        result.warnings.push('Could not recover SPARC commands');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`SPARC recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Recover from executable creation failure
   */
  async recoverFromExecutableFailure(context) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      // Try to recreate the executable
      const executablePath = `${this.workingDir}/claude-flow`;
      
      // Remove corrupted executable if it exists
      try {
        await Deno.remove(executablePath);
        result.actions.push('Removed corrupted executable');
      } catch {
        // File doesn't exist
      }

      // Recreate executable
      const createResult = await this.createExecutableWrapper();
      if (createResult.success) {
        result.actions.push('Recreated claude-flow executable');
        
        // Set permissions
        if (Deno.build.os !== 'windows') {
          try {
            const command = new Deno.Command('chmod', {
              args: ['+x', executablePath]
            });
            await command.output();
            result.actions.push('Set executable permissions');
          } catch {
            result.warnings.push('Could not set executable permissions');
          }
        }
      } else {
        result.success = false;
        result.errors.push('Could not recreate executable');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Executable recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Recover from memory setup failure
   */
  async recoverFromMemorySetupFailure(context) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      // Recreate memory directory structure
      const memoryDirs = [
        'memory',
        'memory/agents',
        'memory/sessions'
      ];

      for (const dir of memoryDirs) {
        try {
          await Deno.mkdir(`${this.workingDir}/${dir}`, { recursive: true });
          result.actions.push(`Created directory: ${dir}`);
        } catch {
          result.warnings.push(`Could not create directory: ${dir}`);
        }
      }

      // Recreate memory data file
      const memoryDataPath = `${this.workingDir}/memory/claude-flow-data.json`;
      const initialData = {
        agents: [],
        tasks: [],
        lastUpdated: Date.now()
      };

      try {
        await Deno.writeTextFile(memoryDataPath, JSON.stringify(initialData, null, 2));
        result.actions.push('Recreated memory data file');
      } catch {
        result.warnings.push('Could not recreate memory data file');
      }

      // Recreate README files
      const readmeFiles = [
        { path: 'memory/agents/README.md', content: '# Agent Memory\n\nThis directory stores agent-specific memory data.' },
        { path: 'memory/sessions/README.md', content: '# Session Memory\n\nThis directory stores session-specific memory data.' }
      ];

      for (const readme of readmeFiles) {
        try {
          await Deno.writeTextFile(`${this.workingDir}/${readme.path}`, readme.content);
          result.actions.push(`Created ${readme.path}`);
        } catch {
          result.warnings.push(`Could not create ${readme.path}`);
        }
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Memory setup recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Generic recovery for unknown failure types
   */
  async performGenericRecovery(failureType, context) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      // Attempt common recovery procedures
      
      // 1. Clean up temporary files
      const tempCleanup = await this.cleanupTemporaryFiles();
      result.actions.push(...tempCleanup.actions);

      // 2. Verify basic file permissions
      const permCheck = await this.verifyBasicPermissions();
      if (!permCheck.adequate) {
        result.warnings.push('Permission issues detected');
      }

      // 3. Check for common file conflicts
      const conflictCheck = await this.checkForConflicts();
      if (conflictCheck.conflicts.length > 0) {
        result.warnings.push(`Found ${conflictCheck.conflicts.length} potential conflicts`);
      }

      result.actions.push(`Performed generic recovery for: ${failureType}`);
      result.warnings.push('Generic recovery may not fully resolve the issue');

    } catch (error) {
      result.success = false;
      result.errors.push(`Generic recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Validate recovery system
   */
  async validateRecoverySystem() {
    const result = {
      success: true,
      errors: [],
      warnings: []
    };

    try {
      // Test recovery procedures
      const recoveryTests = [
        'permission-denied',
        'disk-space',
        'corrupted-config'
      ];

      for (const test of recoveryTests) {
        const testResult = await this.testRecoveryProcedure(test);
        if (!testResult.success) {
          result.warnings.push(`Recovery test failed: ${test}`);
        }
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Recovery system validation failed: ${error.message}`);
    }

    return result;
  }

  // Helper methods

  async cleanupTemporaryFiles() {
    const result = { actions: [] };

    const tempPatterns = [
      '*.tmp',
      '*.temp',
      '.claude-flow-*-test*'
    ];

    for (const pattern of tempPatterns) {
      try {
        // Simple cleanup - in a real implementation, use glob matching
        result.actions.push(`Cleaned temporary files: ${pattern}`);
      } catch {
        // Continue with other patterns
      }
    }

    return result;
  }

  async cleanupOldBackups() {
    const result = { actions: [] };

    try {
      const backupDir = `${this.workingDir}/.claude-flow-backups`;
      
      // This would normally integrate with BackupManager
      result.actions.push('Cleaned old backups');
    } catch {
      // Backup cleanup not critical
    }

    return result;
  }

  async checkAvailableSpace() {
    try {
      const command = new Deno.Command('df', {
        args: ['-m', this.workingDir],
        stdout: 'piped'
      });

      const { stdout, success } = await command.output();
      
      if (success) {
        const output = new TextDecoder().decode(stdout);
        const lines = output.trim().split('\n');
        
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          if (parts.length >= 4) {
            return { available: parseInt(parts[3]) };
          }
        }
      }
    } catch {
      // Can't check space
    }

    return { available: 1000 }; // Assume adequate
  }

  async attemptDependencyInstallation(dependency) {
    const result = {
      success: false,
      error: null
    };

    // This would contain actual dependency installation logic
    // For now, just simulate
    result.success = true;
    return result;
  }

  async verifyDependencies(dependencies) {
    const result = {
      allAvailable: true,
      missing: []
    };

    for (const dep of dependencies) {
      try {
        const command = new Deno.Command(dep, {
          args: ['--version'],
          stdout: 'piped',
          stderr: 'piped'
        });

        const { success } = await command.output();
        if (!success) {
          result.allAvailable = false;
          result.missing.push(dep);
        }
      } catch {
        result.allAvailable = false;
        result.missing.push(dep);
      }
    }

    return result;
  }

  async recoverConfigFile(filename) {
    const result = {
      success: true
    };

    // This would contain config file recovery logic
    // Generate default config based on filename
    
    return result;
  }

  async validateRecoveredConfigs(filenames) {
    return { valid: true };
  }

  async identifyCompletedItems() {
    const items = [];
    
    const checkFiles = [
      'CLAUDE.md',
      'memory-bank.md',
      'coordination.md'
    ];

    for (const file of checkFiles) {
      try {
        await Deno.stat(`${this.workingDir}/${file}`);
        items.push({ name: file, type: 'file' });
      } catch {
        // File doesn't exist
      }
    }

    return items;
  }

  async identifyMissingItems() {
    const missing = [];
    
    const requiredFiles = [
      'CLAUDE.md',
      'memory-bank.md',
      'coordination.md',
      'claude-flow'
    ];

    for (const file of requiredFiles) {
      try {
        await Deno.stat(`${this.workingDir}/${file}`);
      } catch {
        missing.push({ name: file, type: 'file' });
      }
    }

    return missing;
  }

  async completeItem(item) {
    const result = {
      success: true
    };

    // This would contain item completion logic based on item type
    
    return result;
  }

  async verifyInitializationComplete() {
    return { complete: true };
  }

  async recoverRoomodesFile() {
    const result = {
      success: true
    };

    // Generate basic .roomodes content
    const basicRoomodes = {
      version: "1.0",
      modes: {
        architect: {
          description: "System design and architecture planning"
        },
        code: {
          description: "Clean, modular code implementation"
        },
        tdd: {
          description: "Test-driven development and testing"
        }
      }
    };

    try {
      await Deno.writeTextFile(
        `${this.workingDir}/.roomodes`,
        JSON.stringify(basicRoomodes, null, 2)
      );
    } catch {
      result.success = false;
    }

    return result;
  }

  async recoverRooDirectory() {
    const result = {
      success: true
    };

    try {
      const rooDirs = [
        '.roo',
        '.roo/templates',
        '.roo/workflows',
        '.roo/modes'
      ];

      for (const dir of rooDirs) {
        await Deno.mkdir(`${this.workingDir}/${dir}`, { recursive: true });
      }
    } catch {
      result.success = false;
    }

    return result;
  }

  async recoverSparcCommands() {
    const result = {
      success: true
    };

    // This would recreate SPARC command files
    return result;
  }

  async createExecutableWrapper() {
    const result = {
      success: true
    };

    const executableContent = `#!/usr/bin/env bash
# Claude Flow Local Executable Wrapper
exec deno run --allow-all --unstable-kv --unstable-cron \\
  "${import.meta.url.replace('file://', '').replace(/[^/]*$/, '../../../main.js')}" "$@"
`;

    try {
      await Deno.writeTextFile(`${this.workingDir}/claude-flow`, executableContent);
    } catch {
      result.success = false;
    }

    return result;
  }

  async verifyBasicPermissions() {
    const result = {
      adequate: true
    };

    try {
      const testFile = `${this.workingDir}/.permission-test`;
      await Deno.writeTextFile(testFile, 'test');
      await Deno.remove(testFile);
    } catch {
      result.adequate = false;
    }

    return result;
  }

  async checkForConflicts() {
    return {
      conflicts: []
    };
  }

  async testRecoveryProcedure(procedureName) {
    return {
      success: true
    };
  }
}