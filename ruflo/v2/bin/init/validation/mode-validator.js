import { promises as fs } from 'fs';
// mode-validator.js - SPARC mode functionality testing

export class ModeValidator {
  constructor(workingDir) {
    this.workingDir = workingDir;
  }

  /**
   * Test all SPARC modes for basic functionality
   */
  async testAllModes() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      modes: {},
    };

    try {
      // First, check if SPARC is initialized
      const sparcInitialized = await this.checkSparcInitialization();
      if (!sparcInitialized.initialized) {
        result.warnings.push('SPARC not initialized - mode testing skipped');
        return result;
      }

      // Get available modes
      const availableModes = await this.getAvailableModes();
      if (availableModes.length === 0) {
        result.warnings.push('No SPARC modes found for testing');
        return result;
      }

      // Test each mode
      for (const mode of availableModes) {
        const modeTest = await this.testMode(mode);
        result.modes[mode] = modeTest;

        if (!modeTest.success) {
          result.success = false;
          result.errors.push(`Mode ${mode} failed testing: ${modeTest.error}`);
        }
      }
    } catch (error) {
      result.success = false;
      result.errors.push(`Mode testing failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Test a specific SPARC mode
   */
  async testMode(modeName) {
    const result = {
      success: true,
      error: null,
      checks: {
        accessible: false,
        configValid: false,
        executable: false,
      },
    };

    try {
      // Test 1: Check if mode is accessible via CLI
      const accessTest = await this.testModeAccess(modeName);
      result.checks.accessible = accessTest.success;
      if (!accessTest.success) {
        result.success = false;
        result.error = accessTest.error;
        return result;
      }

      // Test 2: Validate mode configuration
      const configTest = await this.testModeConfig(modeName);
      result.checks.configValid = configTest.success;
      if (!configTest.success) {
        result.success = false;
        result.error = configTest.error;
        return result;
      }

      // Test 3: Test mode execution (dry run)
      const execTest = await this.testModeExecution(modeName);
      result.checks.executable = execTest.success;
      if (!execTest.success) {
        result.success = false;
        result.error = execTest.error;
        return result;
      }
    } catch (error) {
      result.success = false;
      result.error = error.message;
    }

    return result;
  }

  /**
   * Check if SPARC is properly initialized
   */
  async checkSparcInitialization() {
    const result = {
      initialized: false,
      hasRoomodes: false,
      hasExecutable: false,
      error: null,
    };

    try {
      // Check for .roomodes file
      try {
        const stat = await Deno.stat(`${this.workingDir}/.roomodes`);
        result.hasRoomodes = stat.isFile;
      } catch {
        result.error = '.roomodes file not found';
      }

      // Check for claude-flow executable
      try {
        const stat = await Deno.stat(`${this.workingDir}/claude-flow`);
        result.hasExecutable = stat.isFile;
      } catch {
        result.error = 'claude-flow executable not found';
      }

      result.initialized = result.hasRoomodes && result.hasExecutable;
    } catch (error) {
      result.error = error.message;
    }

    return result;
  }

  /**
   * Get list of available SPARC modes
   */
  async getAvailableModes() {
    const modes = [];

    try {
      // Try to get modes from .roomodes
      const roomodesPath = `${this.workingDir}/.roomodes`;
      const content = await fs.readFile(roomodesPath, 'utf8');
      const config = JSON.parse(content);

      if (config.modes && typeof config.modes === 'object') {
        modes.push(...Object.keys(config.modes));
      }
    } catch (error) {
      // Fallback to common modes
      modes.push(
        'architect',
        'code',
        'tdd',
        'spec-pseudocode',
        'integration',
        'debug',
        'docs-writer',
      );
    }

    return modes;
  }

  /**
   * Test if a mode is accessible via CLI
   */
  async testModeAccess(modeName) {
    const result = {
      success: false,
      error: null,
    };

    try {
      // Test with sparc info command
      const command = new Deno.Command('./claude-flow', {
        args: ['sparc', 'info', modeName],
        cwd: this.workingDir,
        stdout: 'piped',
        stderr: 'piped',
      });

      const { success, stdout, stderr } = await command.output();

      if (success) {
        result.success = true;
      } else {
        const errorOutput = new TextDecoder().decode(stderr);
        result.error = `Mode not accessible: ${errorOutput}`;
      }
    } catch (error) {
      result.error = `Failed to test mode access: ${error.message}`;
    }

    return result;
  }

  /**
   * Test mode configuration validity
   */
  async testModeConfig(modeName) {
    const result = {
      success: false,
      error: null,
    };

    try {
      // Read .roomodes and validate mode config
      const roomodesPath = `${this.workingDir}/.roomodes`;
      const content = await fs.readFile(roomodesPath, 'utf8');
      const config = JSON.parse(content);

      if (!config.modes || !config.modes[modeName]) {
        result.error = `Mode ${modeName} not found in configuration`;
        return result;
      }

      const modeConfig = config.modes[modeName];

      // Basic validation
      if (typeof modeConfig !== 'object') {
        result.error = `Invalid configuration for mode ${modeName}`;
        return result;
      }

      // Check for required fields
      const requiredFields = ['description'];
      for (const field of requiredFields) {
        if (!modeConfig[field]) {
          result.error = `Mode ${modeName} missing required field: ${field}`;
          return result;
        }
      }

      result.success = true;
    } catch (error) {
      result.error = `Configuration validation failed: ${error.message}`;
    }

    return result;
  }

  /**
   * Test mode execution with a safe dry run
   */
  async testModeExecution(modeName) {
    const result = {
      success: false,
      error: null,
    };

    try {
      // Test with a safe, non-destructive command
      const command = new Deno.Command('./claude-flow', {
        args: ['sparc', 'run', modeName, 'test validation', '--dry-run'],
        cwd: this.workingDir,
        stdout: 'piped',
        stderr: 'piped',
      });

      const { success, stdout, stderr } = await command.output();

      if (success) {
        result.success = true;
      } else {
        // Check if it's just because --dry-run isn't supported
        const errorOutput = new TextDecoder().decode(stderr);
        if (errorOutput.includes('dry-run') || errorOutput.includes('unknown flag')) {
          // Try without dry-run but with a safe test task
          const testCommand = new Deno.Command('./claude-flow', {
            args: ['sparc', 'modes'],
            cwd: this.workingDir,
            stdout: 'piped',
            stderr: 'piped',
          });

          const testResult = await testCommand.output();
          if (testResult.success) {
            const output = new TextDecoder().decode(testResult.stdout);
            result.success = output.includes(modeName);
            if (!result.success) {
              result.error = `Mode ${modeName} not listed in available modes`;
            }
          } else {
            result.error = `Mode execution test failed: ${errorOutput}`;
          }
        } else {
          result.error = `Mode execution failed: ${errorOutput}`;
        }
      }
    } catch (error) {
      result.error = `Execution test failed: ${error.message}`;
    }

    return result;
  }

  /**
   * Test SPARC workflow functionality
   */
  async testWorkflowFunctionality() {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      workflows: {},
    };

    try {
      // Check for workflow files
      const workflowDir = `${this.workingDir}/.roo/workflows`;

      try {
        const entries = [];
        for await (const entry of Deno.readDir(workflowDir)) {
          if (entry.isFile && entry.name.endsWith('.json')) {
            entries.push(entry.name);
          }
        }

        // Test each workflow file
        for (const workflowFile of entries) {
          const workflowTest = await this.testWorkflowFile(workflowFile);
          result.workflows[workflowFile] = workflowTest;

          if (!workflowTest.success) {
            result.warnings.push(`Workflow ${workflowFile} has issues: ${workflowTest.error}`);
          }
        }

        if (entries.length === 0) {
          result.warnings.push('No workflow files found');
        }
      } catch {
        result.warnings.push('Workflow directory not accessible');
      }
    } catch (error) {
      result.errors.push(`Workflow testing failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Test a specific workflow file
   */
  async testWorkflowFile(filename) {
    const result = {
      success: true,
      error: null,
    };

    try {
      const workflowPath = `${this.workingDir}/.roo/workflows/${filename}`;
      const content = await fs.readFile(workflowPath, 'utf8');

      // Parse JSON
      const workflow = JSON.parse(content);

      // Basic validation
      if (typeof workflow !== 'object' || workflow === null) {
        result.success = false;
        result.error = 'Workflow must be a JSON object';
        return result;
      }

      // Check for recommended fields
      const recommendedFields = ['name', 'description', 'steps'];
      for (const field of recommendedFields) {
        if (!(field in workflow)) {
          result.success = false;
          result.error = `Missing recommended field: ${field}`;
          return result;
        }
      }
    } catch (error) {
      result.success = false;
      result.error = `Workflow validation failed: ${error.message}`;
    }

    return result;
  }
}
