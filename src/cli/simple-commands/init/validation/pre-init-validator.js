// pre-init-validator.js - Pre-initialization validation checks

import { printWarning } from '../../../utils.js';

export class PreInitValidator {
  constructor(workingDir) {
    this.workingDir = workingDir;
  }

  /**
   * Check file system permissions
   */
  async checkPermissions() {
    const result = {
      success: true,
      errors: [],
      warnings: []
    };

    try {
      // Test write permission in working directory
      const testFile = `${this.workingDir}/.claude-flow-permission-test`;
      await Deno.writeTextFile(testFile, 'test');
      await Deno.remove(testFile);

      // Test directory creation permission
      const testDir = `${this.workingDir}/.claude-flow-dir-test`;
      await Deno.mkdir(testDir);
      await Deno.remove(testDir);

    } catch (error) {
      result.success = false;
      result.errors.push(`Insufficient permissions in ${this.workingDir}: ${error.message}`);
    }

    return result;
  }

  /**
   * Check available disk space
   */
  async checkDiskSpace() {
    const result = {
      success: true,
      errors: [],
      warnings: []
    };

    try {
      // Get disk usage information
      const command = new Deno.Command('df', {
        args: ['-k', this.workingDir],
        stdout: 'piped',
        stderr: 'piped'
      });

      const { stdout, success } = await command.output();
      
      if (success) {
        const output = new TextDecoder().decode(stdout);
        const lines = output.trim().split('\n');
        
        if (lines.length >= 2) {
          const dataLine = lines[1];
          const parts = dataLine.split(/\s+/);
          
          if (parts.length >= 4) {
            const availableKB = parseInt(parts[3]);
            const availableMB = availableKB / 1024;
            
            // Require at least 100MB free space
            if (availableMB < 100) {
              result.success = false;
              result.errors.push(`Insufficient disk space: ${availableMB.toFixed(2)}MB available (minimum 100MB required)`);
            } else if (availableMB < 500) {
              result.warnings.push(`Low disk space: ${availableMB.toFixed(2)}MB available`);
            }
          }
        }
      }
    } catch (error) {
      // Non-critical - just warn if we can't check disk space
      result.warnings.push(`Could not check disk space: ${error.message}`);
    }

    return result;
  }

  /**
   * Check for existing files and conflicts
   */
  async checkConflicts(force = false) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      conflicts: []
    };

    const criticalFiles = [
      'CLAUDE.md',
      'memory-bank.md',
      'coordination.md',
      '.roomodes',
      'memory/claude-flow-data.json'
    ];

    const criticalDirs = [
      '.roo',
      '.claude',
      'memory',
      'coordination'
    ];

    // Check critical files
    for (const file of criticalFiles) {
      try {
        const stat = await Deno.stat(`${this.workingDir}/${file}`);
        if (stat.isFile) {
          result.conflicts.push(file);
          if (!force) {
            result.success = false;
            result.errors.push(`File already exists: ${file}`);
          } else {
            result.warnings.push(`File will be overwritten: ${file}`);
          }
        }
      } catch {
        // File doesn't exist - good
      }
    }

    // Check critical directories
    for (const dir of criticalDirs) {
      try {
        const stat = await Deno.stat(`${this.workingDir}/${dir}`);
        if (stat.isDirectory) {
          // Check if directory has important content
          const entries = [];
          for await (const entry of Deno.readDir(`${this.workingDir}/${dir}`)) {
            entries.push(entry.name);
          }
          
          if (entries.length > 0) {
            result.conflicts.push(`${dir}/ (${entries.length} items)`);
            if (!force) {
              result.warnings.push(`Directory exists with content: ${dir}/`);
            }
          }
        }
      } catch {
        // Directory doesn't exist - good
      }
    }

    return result;
  }

  /**
   * Check for required dependencies
   */
  async checkDependencies() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      dependencies: {}
    };

    const dependencies = [
      { name: 'node', command: 'node', args: ['--version'], required: true },
      { name: 'npm', command: 'npm', args: ['--version'], required: true },
      { name: 'git', command: 'git', args: ['--version'], required: false },
      { name: 'npx', command: 'npx', args: ['--version'], required: true }
    ];

    for (const dep of dependencies) {
      try {
        const command = new Deno.Command(dep.command, {
          args: dep.args,
          stdout: 'piped',
          stderr: 'piped'
        });

        const { stdout, success } = await command.output();
        
        if (success) {
          const version = new TextDecoder().decode(stdout).trim();
          result.dependencies[dep.name] = {
            available: true,
            version
          };
        } else {
          throw new Error('Command failed');
        }
      } catch (error) {
        result.dependencies[dep.name] = {
          available: false,
          error: error.message
        };

        if (dep.required) {
          result.success = false;
          result.errors.push(`Required dependency '${dep.name}' is not available`);
        } else {
          result.warnings.push(`Optional dependency '${dep.name}' is not available`);
        }
      }
    }

    return result;
  }

  /**
   * Check environment variables and configuration
   */
  async checkEnvironment() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      environment: {}
    };

    // Check for important environment variables
    const envVars = [
      { name: 'HOME', required: false },
      { name: 'PATH', required: true },
      { name: 'PWD', required: false },
      { name: 'CLAUDE_FLOW_DEBUG', required: false }
    ];

    for (const envVar of envVars) {
      const value = Deno.env.get(envVar.name);
      
      if (value) {
        result.environment[envVar.name] = 'set';
      } else {
        result.environment[envVar.name] = 'not set';
        
        if (envVar.required) {
          result.success = false;
          result.errors.push(`Required environment variable ${envVar.name} is not set`);
        }
      }
    }

    // Check if we're in a git repository
    try {
      const command = new Deno.Command('git', {
        args: ['rev-parse', '--git-dir'],
        cwd: this.workingDir,
        stdout: 'piped',
        stderr: 'piped'
      });

      const { success } = await command.output();
      result.environment.gitRepo = success;
      
      if (!success) {
        result.warnings.push('Not in a git repository - version control recommended');
      }
    } catch {
      result.environment.gitRepo = false;
      result.warnings.push('Could not check git repository status');
    }

    return result;
  }

  /**
   * Run all pre-initialization checks
   */
  async runAllChecks(options = {}) {
    const results = {
      permissions: await this.checkPermissions(),
      diskSpace: await this.checkDiskSpace(),
      conflicts: await this.checkConflicts(options.force),
      dependencies: await this.checkDependencies(),
      environment: await this.checkEnvironment()
    };

    const overallSuccess = Object.values(results).every(r => r.success);
    const allErrors = Object.values(results).flatMap(r => r.errors || []);
    const allWarnings = Object.values(results).flatMap(r => r.warnings || []);

    return {
      success: overallSuccess,
      results,
      errors: allErrors,
      warnings: allWarnings
    };
  }
}