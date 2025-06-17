// config-validator.js - Configuration file validation

export class ConfigValidator {
  constructor(workingDir) {
    this.workingDir = workingDir;
  }

  /**
   * Validate .roomodes configuration file
   */
  async validateRoomodes() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      config: null
    };

    const roomodesPath = `${this.workingDir}/.roomodes`;

    try {
      // Check if file exists
      const stat = await Deno.stat(roomodesPath);
      if (!stat.isFile) {
        result.success = false;
        result.errors.push('.roomodes exists but is not a file');
        return result;
      }

      // Read and parse JSON
      const content = await Deno.readTextFile(roomodesPath);
      
      try {
        const config = JSON.parse(content);
        result.config = config;

        // Validate structure
        const validationResult = this.validateRoomodesStructure(config);
        if (!validationResult.valid) {
          result.success = false;
          result.errors.push(...validationResult.errors);
        }
        result.warnings.push(...validationResult.warnings);

      } catch (jsonError) {
        result.success = false;
        result.errors.push(`Invalid JSON in .roomodes: ${jsonError.message}`);
      }

    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        result.warnings.push('.roomodes file not found - SPARC features may not be available');
      } else {
        result.success = false;
        result.errors.push(`Could not read .roomodes: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Validate CLAUDE.md configuration
   */
  async validateClaudeMd() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      content: null
    };

    const claudeMdPath = `${this.workingDir}/CLAUDE.md`;

    try {
      const content = await Deno.readTextFile(claudeMdPath);
      result.content = content;

      // Check for required sections
      const requiredSections = [
        '# Claude Code Configuration',
        '## Project Overview',
        '## SPARC Development Commands'
      ];

      for (const section of requiredSections) {
        if (!content.includes(section)) {
          result.warnings.push(`Missing recommended section: ${section}`);
        }
      }

      // Check for important command patterns
      const importantCommands = [
        'npx claude-flow sparc',
        'npm run build',
        'npm run test'
      ];

      for (const command of importantCommands) {
        if (!content.includes(command)) {
          result.warnings.push(`Missing important command reference: ${command}`);
        }
      }

      // Check file size
      if (content.length < 100) {
        result.success = false;
        result.errors.push('CLAUDE.md appears to be too short or empty');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Could not read CLAUDE.md: ${error.message}`);
    }

    return result;
  }

  /**
   * Validate memory configuration
   */
  async validateMemoryConfig() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      data: null
    };

    const memoryDataPath = `${this.workingDir}/memory/claude-flow-data.json`;

    try {
      const content = await Deno.readTextFile(memoryDataPath);
      
      try {
        const data = JSON.parse(content);
        result.data = data;

        // Validate structure
        const validationResult = this.validateMemoryDataStructure(data);
        if (!validationResult.valid) {
          result.success = false;
          result.errors.push(...validationResult.errors);
        }
        result.warnings.push(...validationResult.warnings);

      } catch (jsonError) {
        result.success = false;
        result.errors.push(`Invalid JSON in memory data: ${jsonError.message}`);
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Could not read memory data: ${error.message}`);
    }

    return result;
  }

  /**
   * Validate coordination configuration
   */
  async validateCoordinationConfig() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      content: null
    };

    const coordinationPath = `${this.workingDir}/coordination.md`;

    try {
      const content = await Deno.readTextFile(coordinationPath);
      result.content = content;

      // Check for required sections
      const requiredSections = [
        '# Multi-Agent Coordination',
        '## Agent Coordination Patterns',
        '## Memory Management'
      ];

      for (const section of requiredSections) {
        if (!content.includes(section)) {
          result.warnings.push(`Missing recommended section in coordination.md: ${section}`);
        }
      }

      // Check file size
      if (content.length < 50) {
        result.warnings.push('coordination.md appears to be very short');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Could not read coordination.md: ${error.message}`);
    }

    return result;
  }

  /**
   * Validate executable configuration
   */
  async validateExecutable() {
    const result = {
      success: true,
      errors: [],
      warnings: []
    };

    const executablePath = `${this.workingDir}/claude-flow`;

    try {
      const stat = await Deno.stat(executablePath);
      
      if (!stat.isFile) {
        result.success = false;
        result.errors.push('claude-flow executable is not a file');
        return result;
      }

      // Check if executable (on Unix systems)
      if (Deno.build.os !== 'windows') {
        const isExecutable = (stat.mode & 0o111) !== 0;
        if (!isExecutable) {
          result.warnings.push('claude-flow file is not executable');
        }
      }

      // Read and validate content
      const content = await Deno.readTextFile(executablePath);
      
      // Check for required elements
      if (content.includes('#!/usr/bin/env')) {
        // Script file
        if (!content.includes('claude-flow') && !content.includes('deno run')) {
          result.warnings.push('Executable script may not be properly configured');
        }
      } else {
        result.warnings.push('Executable may not have proper shebang');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Could not validate executable: ${error.message}`);
    }

    return result;
  }

  // Helper methods

  validateRoomodesStructure(config) {
    const result = {
      valid: true,
      errors: [],
      warnings: []
    };

    // Check top-level structure
    if (typeof config !== 'object' || config === null) {
      result.valid = false;
      result.errors.push('.roomodes must be a JSON object');
      return result;
    }

    // Check for required fields
    const requiredFields = ['modes', 'version'];
    for (const field of requiredFields) {
      if (!(field in config)) {
        result.warnings.push(`Missing recommended field in .roomodes: ${field}`);
      }
    }

    // Validate modes if present
    if ('modes' in config) {
      if (typeof config.modes !== 'object' || config.modes === null) {
        result.valid = false;
        result.errors.push('.roomodes modes must be an object');
      } else {
        // Check each mode
        for (const [modeName, modeConfig] of Object.entries(config.modes)) {
          const modeValidation = this.validateModeConfig(modeName, modeConfig);
          if (!modeValidation.valid) {
            result.warnings.push(...modeValidation.errors.map(err => `Mode ${modeName}: ${err}`));
          }
        }
      }
    }

    return result;
  }

  validateModeConfig(modeName, modeConfig) {
    const result = {
      valid: true,
      errors: []
    };

    if (typeof modeConfig !== 'object' || modeConfig === null) {
      result.valid = false;
      result.errors.push('mode configuration must be an object');
      return result;
    }

    // Check for recommended fields
    const recommendedFields = ['description', 'persona', 'tools'];
    for (const field of recommendedFields) {
      if (!(field in modeConfig)) {
        result.errors.push(`missing recommended field: ${field}`);
      }
    }

    // Validate specific fields
    if ('tools' in modeConfig && !Array.isArray(modeConfig.tools)) {
      result.errors.push('tools must be an array');
    }

    if ('description' in modeConfig && typeof modeConfig.description !== 'string') {
      result.errors.push('description must be a string');
    }

    return result;
  }

  validateMemoryDataStructure(data) {
    const result = {
      valid: true,
      errors: [],
      warnings: []
    };

    if (typeof data !== 'object' || data === null) {
      result.valid = false;
      result.errors.push('Memory data must be a JSON object');
      return result;
    }

    // Check for required fields
    const requiredFields = ['agents', 'tasks', 'lastUpdated'];
    for (const field of requiredFields) {
      if (!(field in data)) {
        result.warnings.push(`Missing field in memory data: ${field}`);
      }
    }

    // Validate field types
    if ('agents' in data && !Array.isArray(data.agents)) {
      result.errors.push('agents must be an array');
    }

    if ('tasks' in data && !Array.isArray(data.tasks)) {
      result.errors.push('tasks must be an array');
    }

    if ('lastUpdated' in data && typeof data.lastUpdated !== 'number') {
      result.warnings.push('lastUpdated should be a timestamp number');
    }

    return result;
  }
}