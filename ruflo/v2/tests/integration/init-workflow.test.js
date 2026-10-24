// init-workflow.test.js - Integration tests for complete init workflows
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import { initCommand } from '../../src/cli/simple-commands/init/index.js';
import { batchInitCommand } from '../../src/cli/simple-commands/init/batch-init.js';
import { runFullValidation } from '../../src/cli/simple-commands/init/validation/index.js';

// Create a temporary test directory
const TEST_DIR = '/tmp/claude-flow-init-test';

describe('Init Workflow Integration Tests', () => {
  beforeEach(async () => {
    // Clean up any existing test directory
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (err) {
      // Directory might not exist
    }

    // Create fresh test directory
    await fs.mkdir(TEST_DIR, { recursive: true });
    process.chdir(TEST_DIR);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Basic Init Workflow', () => {
    it('should complete full initialization workflow', async () => {
      // Run initialization
      await initCommand([], {});

      // Verify core files were created
      const coreFiles = [
        'CLAUDE.md',
        '.claude/settings.json',
        '.mcp.json',
        'memory/claude-flow@alpha-data.json',
      ];

      for (const file of coreFiles) {
        await expect(fs.access(file)).resolves.not.toThrow();
      }

      // Verify directory structure
      const directories = [
        'memory',
        'memory/agents',
        'memory/sessions',
        'coordination',
        '.claude',
        '.claude/commands',
        '.swarm',
        '.hive-mind',
      ];

      for (const dir of directories) {
        const stat = await fs.stat(dir);
        expect(stat.isDirectory()).toBe(true);
      }
    });

    it('should handle force overwrite correctly', async () => {
      // Create initial files
      await fs.writeFile('CLAUDE.md', '# Initial content');

      // Run init without force (should skip)
      await initCommand([], {});

      const contentBefore = await fs.readFile('CLAUDE.md', 'utf8');
      expect(contentBefore).toBe('# Initial content');

      // Run init with force (should overwrite)
      await initCommand(['--force'], { force: true });

      const contentAfter = await fs.readFile('CLAUDE.md', 'utf8');
      expect(contentAfter).not.toBe('# Initial content');
      expect(contentAfter).toContain('Claude Code Configuration');
    });

    it('should create valid JSON configuration files', async () => {
      await initCommand([], {});

      // Test MCP configuration
      const mcpConfig = await fs.readFile('.mcp.json', 'utf8');
      const mcpData = JSON.parse(mcpConfig);
      expect(mcpData).toHaveProperty('mcpServers');
      expect(mcpData.mcpServers).toHaveProperty('claude-flow@alpha');

      // Test settings configuration
      const settingsConfig = await fs.readFile('.claude/settings.json', 'utf8');
      const settingsData = JSON.parse(settingsConfig);
      expect(settingsData).toHaveProperty('hooks');

      // Test memory data
      const memoryData = await fs.readFile('memory/claude-flow@alpha-data.json', 'utf8');
      const memory = JSON.parse(memoryData);
      expect(memory).toHaveProperty('agents');
      expect(memory).toHaveProperty('tasks');
    });
  });

  describe('SPARC Mode Workflow', () => {
    it('should initialize with SPARC mode', async () => {
      // Mock create-sparc command
      jest.spyOn(require, 'resolve').mockImplementation((id) => {
        if (id === 'create-sparc') {
          return '/mock/create-sparc';
        }
        throw new Error('Module not found');
      });

      await initCommand(['--roo'], { roo: true });

      // Verify SPARC-specific content
      const claudeMd = await fs.readFile('CLAUDE.md', 'utf8');
      expect(claudeMd).toContain('SPARC');

      // Verify slash commands directory exists
      const stat = await fs.stat('.claude/commands');
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('Batch Initialization Workflow', () => {
    it('should initialize multiple projects', async () => {
      const projects = ['project1', 'project2', 'project3'];
      const results = await batchInitCommand(projects, {
        progressTracking: false,
        performanceMonitoring: false,
      });

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);

      // Verify each project directory was created
      for (const project of projects) {
        const stat = await fs.stat(project);
        expect(stat.isDirectory()).toBe(true);

        // Verify core files in each project
        const claudeMd = await fs.readFile(`${project}/CLAUDE.md`, 'utf8');
        expect(claudeMd).toContain('Claude Code Configuration');
      }
    });

    it('should handle template-based initialization', async () => {
      const projects = ['api-project'];
      const results = await batchInitCommand(projects, {
        template: 'web-api',
        progressTracking: false,
        performanceMonitoring: false,
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);

      // Verify template-specific files
      const packageJson = await fs.readFile('api-project/package.json', 'utf8');
      const pkg = JSON.parse(packageJson);
      expect(pkg.dependencies).toHaveProperty('express');

      const serverJs = await fs.readFile('api-project/src/index.js', 'utf8');
      expect(serverJs).toContain('Welcome to api-project API');
    });
  });

  describe('Validation Integration', () => {
    it('should pass validation after successful init', async () => {
      await initCommand([], {});

      const validationResult = await runFullValidation(TEST_DIR, {
        postInit: true,
        skipModeTest: true, // Skip mode tests in integration tests
      });

      expect(validationResult.success).toBe(true);
      expect(validationResult.errors).toHaveLength(0);
    });

    it('should detect validation issues', async () => {
      await initCommand([], {});

      // Corrupt a file to trigger validation failure
      await fs.writeFile('CLAUDE.md', 'invalid content');

      const validationResult = await runFullValidation(TEST_DIR, {
        postInit: true,
        skipModeTest: true,
      });

      // Note: Depending on validation implementation,
      // this might be a warning rather than an error
      expect(validationResult.warnings.length + validationResult.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery', () => {
    it('should handle partial initialization gracefully', async () => {
      // Create a file that will cause mkdir to fail
      await fs.writeFile('.claude', 'blocking file');

      // This should handle the error gracefully
      await expect(initCommand([], {})).resolves.not.toThrow();
    });

    it('should recover from permission issues', async () => {
      // On systems where we can test permissions
      if (process.platform !== 'win32') {
        // Create a directory with restricted permissions
        await fs.mkdir('restricted');
        await fs.chmod('restricted', 0o000);

        try {
          process.chdir('restricted');
          await initCommand([], {});

          // Should handle gracefully and provide error message
        } finally {
          process.chdir(TEST_DIR);
          await fs.chmod('restricted', 0o755);
          await fs.rm('restricted', { recursive: true });
        }
      }
    });
  });

  describe('Cross-Platform Compatibility', () => {
    it('should handle different path separators', async () => {
      await initCommand([], {});

      // Verify files were created with correct paths
      const stat = await fs.stat('.claude/commands');
      expect(stat.isDirectory()).toBe(true);
    });

    it('should handle different line endings', async () => {
      await initCommand([], {});

      const claudeMd = await fs.readFile('CLAUDE.md', 'utf8');
      // Should not contain mixed line endings
      expect(claudeMd.includes('\r\n')).toBe(false);
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should not leak memory during large batch operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Run batch initialization
      const projects = Array.from({ length: 10 }, (_, i) => `mem-test-${i}`);
      await batchInitCommand(projects, {
        progressTracking: false,
        performanceMonitoring: false,
      });

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 100MB for 10 projects)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    });

    it('should handle concurrent operations efficiently', async () => {
      const startTime = Date.now();

      const projects = Array.from({ length: 5 }, (_, i) => `concurrent-${i}`);
      await batchInitCommand(projects, {
        parallel: true,
        maxConcurrency: 3,
        progressTracking: false,
        performanceMonitoring: false,
      });

      const duration = Date.now() - startTime;

      // Parallel execution should be faster than sequential
      // (This is a rough check - actual timing may vary)
      expect(duration).toBeLessThan(30000); // 30 seconds max
    });
  });

  describe('File System Edge Cases', () => {
    it('should handle very long path names', async () => {
      const longName = 'a'.repeat(100);

      await initCommand([], {});

      // Try to create a file with a long name
      await fs.writeFile(`memory/${longName}.json`, '{}');

      const stat = await fs.stat(`memory/${longName}.json`);
      expect(stat.isFile()).toBe(true);
    });

    it('should handle special characters in paths', async () => {
      const specialDir = 'test-öäü-项目';

      await fs.mkdir(specialDir);
      process.chdir(specialDir);

      await initCommand([], {});

      const stat = await fs.stat('CLAUDE.md');
      expect(stat.isFile()).toBe(true);
    });

    it('should handle readonly filesystem gracefully', async () => {
      // This is difficult to test consistently across platforms
      // but we can at least verify the error handling doesn't crash

      await initCommand([], {});

      // Try to make a file readonly and then overwrite
      await fs.chmod('CLAUDE.md', 0o444);

      try {
        await initCommand(['--force'], { force: true });
      } finally {
        // Restore permissions for cleanup
        await fs.chmod('CLAUDE.md', 0o644);
      }
    });
  });
});