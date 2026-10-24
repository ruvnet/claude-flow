// init-core.test.js - Core unit tests for init functionality
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import { initCommand } from '../../../../../src/cli/simple-commands/init/index.js';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn(),
    chmod: jest.fn(),
  },
  existsSync: jest.fn(),
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

jest.mock('process', () => ({
  cwd: jest.fn(() => '/test/workspace'),
  chdir: jest.fn(),
  env: { PWD: '/test/workspace' },
}));

// Mock utility functions
jest.mock('../../../../../src/cli/utils.js', () => ({
  printSuccess: jest.fn(),
  printError: jest.fn(),
  printWarning: jest.fn(),
  exit: jest.fn(),
}));

// Mock template functions
jest.mock('../../../../../src/cli/simple-commands/init/templates/claude-md.js', () => ({
  createOptimizedSparcClaudeMd: jest.fn(() => '# Mock CLAUDE.md'),
  createSparcClaudeMd: jest.fn(() => '# Mock SPARC CLAUDE.md'),
  createFullClaudeMd: jest.fn(() => '# Mock Full CLAUDE.md'),
  createMinimalClaudeMd: jest.fn(() => '# Mock Minimal CLAUDE.md'),
}));

jest.mock('../../../../../src/cli/simple-commands/init/templates/enhanced-templates.js', () => ({
  createEnhancedSettingsJson: jest.fn(() => '{"test": true}'),
  createWrapperScript: jest.fn(() => '#!/bin/bash\necho "test"'),
  createCommandDoc: jest.fn(() => '# Test Command'),
  createHelperScript: jest.fn(() => '#!/bin/bash\necho "helper"'),
  COMMAND_STRUCTURE: {
    core: ['init', 'status'],
    swarm: ['spawn', 'monitor'],
  },
}));

describe('initCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.writeFile.mockResolvedValue();
    fs.mkdir.mockResolvedValue();
    fs.stat.mockRejectedValue(new Error('File not found'));
    fs.readFile.mockResolvedValue('{}');
    fs.chmod.mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Basic Initialization', () => {
    it('should initialize with default settings', async () => {
      await initCommand([], {});

      // Verify directory creation
      expect(fs.mkdir).toHaveBeenCalledWith('/test/workspace/.claude', { recursive: true });
      expect(fs.mkdir).toHaveBeenCalledWith('/test/workspace/.claude/commands', { recursive: true });
      expect(fs.mkdir).toHaveBeenCalledWith('/test/workspace/.claude/helpers', { recursive: true });

      // Verify file creation
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/workspace/CLAUDE.md',
        expect.any(String),
        'utf8'
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/workspace/.claude/settings.json',
        expect.any(String),
        'utf8'
      );
    });

    it('should handle force flag properly', async () => {
      // Mock existing files
      fs.stat.mockResolvedValue({ isFile: () => true });

      await initCommand(['--force'], { force: true });

      // Should continue with initialization despite existing files
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/workspace/CLAUDE.md',
        expect.any(String),
        'utf8'
      );
    });

    it('should skip initialization when files exist without force', async () => {
      // Mock existing files
      fs.stat.mockResolvedValue({ isFile: () => true });

      await initCommand([], {});

      // Should not write files when they exist without force
      expect(fs.writeFile).not.toHaveBeenCalledWith(
        '/test/workspace/CLAUDE.md',
        expect.any(String),
        'utf8'
      );
    });

    it('should handle dry-run mode', async () => {
      await initCommand(['--dry-run'], { dryRun: true });

      // Should not create any files in dry-run mode
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.mkdir).not.toHaveBeenCalled();
    });
  });

  describe('SPARC Mode', () => {
    it('should initialize SPARC mode with --roo flag', async () => {
      // Mock execSync for create-sparc
      const { execSync } = require('child_process');
      execSync.mockReturnValue('');

      await initCommand(['--roo'], { roo: true });

      // Verify SPARC-specific initialization
      expect(execSync).toHaveBeenCalledWith(
        'npx -y create-sparc init --force',
        expect.objectContaining({
          cwd: '/test/workspace',
          stdio: 'inherit',
        })
      );
    });

    it('should fallback gracefully when create-sparc fails', async () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => {
        throw new Error('create-sparc not found');
      });

      await initCommand(['--roo'], { roo: true });

      // Should continue initialization even if create-sparc fails
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/workspace/CLAUDE.md',
        expect.any(String),
        'utf8'
      );
    });
  });

  describe('Enhanced Mode', () => {
    it('should use enhanced templates by default', async () => {
      await initCommand([], {});

      // Should use optimized SPARC template by default
      const { createOptimizedSparcClaudeMd } = require('../../../../../src/cli/simple-commands/init/templates/claude-md.js');
      expect(createOptimizedSparcClaudeMd).toHaveBeenCalled();
    });

    it('should handle Flow Nexus minimal init', async () => {
      await initCommand([], { 'flow-nexus': true });

      // Should create Flow Nexus specific files
      expect(fs.writeFile).toHaveBeenCalledWith(
        'CLAUDE.md',
        expect.any(String)
      );
    });
  });

  describe('MCP Server Setup', () => {
    it('should setup MCP servers when Claude Code is installed', async () => {
      const { execSync } = require('child_process');
      execSync.mockReturnValue(''); // Simulate Claude Code installation

      await initCommand([], {});

      // Should attempt to add MCP servers
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('claude mcp add'),
        expect.any(Object)
      );
    });

    it('should skip MCP setup with --skip-mcp flag', async () => {
      const { execSync } = require('child_process');
      execSync.mockReturnValue('');

      await initCommand(['--skip-mcp'], {});

      // Should not attempt to add MCP servers
      expect(execSync).not.toHaveBeenCalledWith(
        expect.stringContaining('claude mcp add'),
        expect.any(Object)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle file system errors gracefully', async () => {
      fs.writeFile.mockRejectedValue(new Error('Permission denied'));

      await initCommand([], {});

      const { printError } = require('../../../../../src/cli/utils.js');
      expect(printError).toHaveBeenCalledWith(
        expect.stringContaining('Permission denied')
      );
    });

    it('should handle directory creation failures', async () => {
      fs.mkdir.mockRejectedValue(new Error('Cannot create directory'));

      await initCommand([], {});

      const { printError } = require('../../../../../src/cli/utils.js');
      expect(printError).toHaveBeenCalledWith(
        expect.stringContaining('Cannot create directory')
      );
    });
  });

  describe('Directory Structure', () => {
    it('should create all required directories', async () => {
      await initCommand([], {});

      const expectedDirs = [
        '/test/workspace/memory',
        '/test/workspace/memory/agents',
        '/test/workspace/memory/sessions',
        '/test/workspace/coordination',
        '/test/workspace/coordination/memory_bank',
        '/test/workspace/coordination/subtasks',
        '/test/workspace/coordination/orchestration',
        '/test/workspace/.swarm',
        '/test/workspace/.hive-mind',
        '/test/workspace/.claude/checkpoints',
      ];

      expectedDirs.forEach(dir => {
        expect(fs.mkdir).toHaveBeenCalledWith(dir, { recursive: true });
      });
    });

    it('should create memory system files', async () => {
      await initCommand([], {});

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/workspace/memory/claude-flow@alpha-data.json',
        expect.stringContaining('agents'),
        'utf8'
      );
    });
  });

  describe('Configuration Files', () => {
    it('should create MCP configuration', async () => {
      await initCommand([], {});

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/workspace/.mcp.json',
        expect.stringContaining('claude-flow@alpha'),
        'utf8'
      );
    });

    it('should create settings files', async () => {
      await initCommand([], {});

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/workspace/.claude/settings.local.json',
        expect.stringContaining('permissions'),
        'utf8'
      );
    });
  });

  describe('Help and Information', () => {
    it('should show help when requested', async () => {
      await initCommand(['--help'], { help: true });

      // Should not perform initialization when help is requested
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle various help flags', async () => {
      const helpFlags = ['-h', '--help'];

      for (const flag of helpFlags) {
        jest.clearAllMocks();
        await initCommand([flag], {});
        expect(fs.writeFile).not.toHaveBeenCalled();
      }
    });
  });
});