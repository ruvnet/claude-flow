// post-init-validator.js - Post-initialization verification checks

export class PostInitValidator {
  constructor(workingDir) {
    this.workingDir = workingDir;
  }

  /**
   * Check file integrity (existence, size, readability)
   */
  async checkFileIntegrity() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      files: {}
    };

    const expectedFiles = [
      { path: 'CLAUDE.md', minSize: 100 },
      { path: 'memory-bank.md', minSize: 50 },
      { path: 'coordination.md', minSize: 50 },
      { path: 'memory/claude-flow-data.json', minSize: 10 },
      { path: 'memory/agents/README.md', minSize: 10 },
      { path: 'memory/sessions/README.md', minSize: 10 },
      { path: 'claude-flow', minSize: 50, executable: true }
    ];

    for (const file of expectedFiles) {
      const filePath = `${this.workingDir}/${file.path}`;
      
      try {
        const stat = await Deno.stat(filePath);
        
        // Check if it exists and is a file
        if (!stat.isFile) {
          result.success = false;
          result.errors.push(`Expected file but found directory: ${file.path}`);
          result.files[file.path] = { status: 'not_file' };
          continue;
        }

        // Check file size
        if (stat.size < file.minSize) {
          result.success = false;
          result.errors.push(`File too small: ${file.path} (${stat.size} bytes, expected >= ${file.minSize})`);
          result.files[file.path] = { status: 'too_small', size: stat.size };
          continue;
        }

        // Check if executable (if required)
        if (file.executable && Deno.build.os !== 'windows') {
          const isExecutable = (stat.mode & 0o111) !== 0;
          if (!isExecutable) {
            result.warnings.push(`File not executable: ${file.path}`);
            result.files[file.path] = { status: 'not_executable', size: stat.size };
            continue;
          }
        }

        // Try to read the file
        try {
          await Deno.readTextFile(filePath);
          result.files[file.path] = { status: 'ok', size: stat.size };
        } catch (readError) {
          result.success = false;
          result.errors.push(`Cannot read file: ${file.path} - ${readError.message}`);
          result.files[file.path] = { status: 'unreadable', size: stat.size };
        }

      } catch (error) {
        result.success = false;
        result.errors.push(`File not found: ${file.path}`);
        result.files[file.path] = { status: 'missing' };
      }
    }

    return result;
  }

  /**
   * Check completeness of initialization
   */
  async checkCompleteness() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      missing: []
    };

    const requiredDirs = [
      'memory',
      'memory/agents',
      'memory/sessions',
      'coordination',
      'coordination/memory_bank',
      'coordination/subtasks',
      'coordination/orchestration',
      '.claude',
      '.claude/commands',
      '.claude/logs'
    ];

    const optionalDirs = [
      '.roo',
      '.roo/templates',
      '.roo/workflows',
      '.roo/modes',
      '.roo/configs',
      '.claude/commands/sparc'
    ];

    // Check required directories
    for (const dir of requiredDirs) {
      const dirPath = `${this.workingDir}/${dir}`;
      
      try {
        const stat = await Deno.stat(dirPath);
        if (!stat.isDirectory) {
          result.success = false;
          result.errors.push(`Expected directory but found file: ${dir}`);
          result.missing.push(dir);
        }
      } catch {
        result.success = false;
        result.errors.push(`Required directory missing: ${dir}`);
        result.missing.push(dir);
      }
    }

    // Check optional directories (SPARC-related)
    for (const dir of optionalDirs) {
      const dirPath = `${this.workingDir}/${dir}`;
      
      try {
        await Deno.stat(dirPath);
      } catch {
        if (dir.includes('.roo') || dir.includes('sparc')) {
          result.warnings.push(`Optional SPARC directory missing: ${dir}`);
        }
      }
    }

    return result;
  }

  /**
   * Validate directory structure and organization
   */
  async validateStructure() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      structure: {}
    };

    try {
      // Check memory structure
      const memoryStructure = await this.validateMemoryStructure();
      result.structure.memory = memoryStructure;
      if (!memoryStructure.valid) {
        result.warnings.push('Memory directory structure is incomplete');
      }

      // Check coordination structure
      const coordinationStructure = await this.validateCoordinationStructure();
      result.structure.coordination = coordinationStructure;
      if (!coordinationStructure.valid) {
        result.warnings.push('Coordination directory structure is incomplete');
      }

      // Check Claude integration structure
      const claudeStructure = await this.validateClaudeStructure();
      result.structure.claude = claudeStructure;
      if (!claudeStructure.valid) {
        result.warnings.push('Claude integration structure is incomplete');
      }

      // Check SPARC structure (if present)
      const sparcExists = await this.checkSparcExists();
      if (sparcExists) {
        const sparcStructure = await this.validateSparcStructure();
        result.structure.sparc = sparcStructure;
        if (!sparcStructure.valid) {
          result.warnings.push('SPARC structure is incomplete');
        }
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Structure validation failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Check permissions on created files and directories
   */
  async checkPermissions() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      permissions: {}
    };

    const itemsToCheck = [
      { path: 'CLAUDE.md', type: 'file', requiredMode: 0o644 },
      { path: 'memory-bank.md', type: 'file', requiredMode: 0o644 },
      { path: 'coordination.md', type: 'file', requiredMode: 0o644 },
      { path: 'claude-flow', type: 'file', requiredMode: 0o755 },
      { path: 'memory', type: 'dir', requiredMode: 0o755 },
      { path: 'coordination', type: 'dir', requiredMode: 0o755 },
      { path: '.claude', type: 'dir', requiredMode: 0o755 }
    ];

    // Skip permission checks on Windows
    if (Deno.build.os === 'windows') {
      result.warnings.push('Permission checks skipped on Windows');
      return result;
    }

    for (const item of itemsToCheck) {
      const itemPath = `${this.workingDir}/${item.path}`;
      
      try {
        const stat = await Deno.stat(itemPath);
        const actualMode = stat.mode & 0o777;
        const expectedMode = item.requiredMode;
        
        result.permissions[item.path] = {
          actual: actualMode.toString(8),
          expected: expectedMode.toString(8),
          correct: actualMode === expectedMode
        };

        if (actualMode !== expectedMode) {
          result.warnings.push(
            `Incorrect permissions on ${item.path}: ` +
            `${actualMode.toString(8)} (expected ${expectedMode.toString(8)})`
          );
        }

      } catch (error) {
        result.warnings.push(`Could not check permissions for ${item.path}: ${error.message}`);
      }
    }

    return result;
  }

  // Helper methods

  async validateMemoryStructure() {
    const structure = {
      valid: true,
      dirs: [],
      files: []
    };

    const expectedDirs = ['agents', 'sessions'];
    const expectedFiles = ['claude-flow-data.json', 'agents/README.md', 'sessions/README.md'];

    for (const dir of expectedDirs) {
      try {
        await Deno.stat(`${this.workingDir}/memory/${dir}`);
        structure.dirs.push(dir);
      } catch {
        structure.valid = false;
      }
    }

    for (const file of expectedFiles) {
      try {
        await Deno.stat(`${this.workingDir}/memory/${file}`);
        structure.files.push(file);
      } catch {
        structure.valid = false;
      }
    }

    return structure;
  }

  async validateCoordinationStructure() {
    const structure = {
      valid: true,
      dirs: []
    };

    const expectedDirs = ['memory_bank', 'subtasks', 'orchestration'];

    for (const dir of expectedDirs) {
      try {
        await Deno.stat(`${this.workingDir}/coordination/${dir}`);
        structure.dirs.push(dir);
      } catch {
        structure.valid = false;
      }
    }

    return structure;
  }

  async validateClaudeStructure() {
    const structure = {
      valid: true,
      dirs: [],
      hasCommands: false
    };

    const expectedDirs = ['commands', 'logs'];

    for (const dir of expectedDirs) {
      try {
        await Deno.stat(`${this.workingDir}/.claude/${dir}`);
        structure.dirs.push(dir);
      } catch {
        structure.valid = false;
      }
    }

    // Check if there are any command files
    try {
      const entries = [];
      for await (const entry of Deno.readDir(`${this.workingDir}/.claude/commands`)) {
        if (entry.isFile && entry.name.endsWith('.js')) {
          entries.push(entry.name);
        }
      }
      structure.hasCommands = entries.length > 0;
      structure.commandCount = entries.length;
    } catch {
      structure.hasCommands = false;
    }

    return structure;
  }

  async checkSparcExists() {
    try {
      await Deno.stat(`${this.workingDir}/.roomodes`);
      return true;
    } catch {
      return false;
    }
  }

  async validateSparcStructure() {
    const structure = {
      valid: true,
      hasRoomodes: false,
      hasRooDir: false,
      dirs: []
    };

    // Check .roomodes file
    try {
      const stat = await Deno.stat(`${this.workingDir}/.roomodes`);
      structure.hasRoomodes = stat.isFile;
    } catch {
      structure.valid = false;
    }

    // Check .roo directory
    try {
      const stat = await Deno.stat(`${this.workingDir}/.roo`);
      structure.hasRooDir = stat.isDirectory;
      
      if (structure.hasRooDir) {
        const expectedDirs = ['templates', 'workflows', 'modes', 'configs'];
        for (const dir of expectedDirs) {
          try {
            await Deno.stat(`${this.workingDir}/.roo/${dir}`);
            structure.dirs.push(dir);
          } catch {
            // Optional subdirectories
          }
        }
      }
    } catch {
      // .roo directory is optional
    }

    return structure;
  }
}