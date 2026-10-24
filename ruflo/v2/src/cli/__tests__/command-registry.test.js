/**
 * Tests for command-registry.js
 */

import { jest } from '@jest/globals';
import {
  commandRegistry,
  registerCoreCommands,
  executeCommand,
  hasCommand,
  showCommandHelp,
  showAllCommands,
  listCommands,
} from '../command-registry.js';

// Mock all command modules
jest.mock('../simple-commands/init.js', () => ({
  initCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/memory.js', () => ({
  memoryCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/agent.js', () => ({
  agentCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/task.js', () => ({
  taskCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/swarm.js', () => ({
  swarmCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/config.js', () => ({
  configCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/status.js', () => ({
  statusCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/mcp.js', () => ({
  mcpCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/monitor.js', () => ({
  monitorCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/start.js', () => ({
  startCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/sparc.js', () => ({
  sparcCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../simple-commands/batch-manager.js', () => ({
  batchManagerCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../commands/ruv-swarm.js', () => ({
  ruvSwarmAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../commands/config-integration.js', () => ({
  configIntegrationAction: jest.fn().mockResolvedValue(undefined),
}));

describe('Command Registry', () => {
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    commandRegistry.clear();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('registerCoreCommands', () => {
    test('should register all core commands', () => {
      registerCoreCommands();

      const expectedCommands = [
        'init',
        'start',
        'memory',
        'sparc',
        'agent',
        'task',
        'config',
        'status',
        'mcp',
        'monitor',
        'swarm',
        'batch-manager',
        'github',
        'docker',
        'ruv-swarm',
        'config-integration',
      ];

      expectedCommands.forEach((cmd) => {
        expect(commandRegistry.has(cmd)).toBe(true);
      });
    });

    test('should register commands with correct metadata', () => {
      registerCoreCommands();

      const initCmd = commandRegistry.get('init');
      expect(initCmd).toHaveProperty('handler');
      expect(initCmd).toHaveProperty('description');
      expect(initCmd).toHaveProperty('usage');
      expect(initCmd).toHaveProperty('examples');
      expect(initCmd.description).toContain('Initialize Claude Code integration');
    });
  });

  describe('hasCommand', () => {
    beforeEach(() => {
      registerCoreCommands();
    });

    test('should return true for registered commands', () => {
      expect(hasCommand('init')).toBe(true);
      expect(hasCommand('swarm')).toBe(true);
      expect(hasCommand('agent')).toBe(true);
    });

    test('should return false for unregistered commands', () => {
      expect(hasCommand('nonexistent')).toBe(false);
      expect(hasCommand('')).toBe(false);
      expect(hasCommand(null)).toBe(false);
    });
  });

  describe('executeCommand', () => {
    beforeEach(() => {
      registerCoreCommands();
    });

    test('should execute command handler with arguments', async () => {
      const { initCommand } = await import('../simple-commands/init.js');

      await executeCommand('init', ['--sparc'], { force: true });

      expect(initCommand).toHaveBeenCalledWith(['--sparc'], { force: true });
    });

    test('should throw error for unknown command', async () => {
      await expect(executeCommand('unknown', [], {})).rejects.toThrow('Unknown command: unknown');
    });

    test('should handle command execution errors', async () => {
      const { swarmCommand } = await import('../simple-commands/swarm.js');
      swarmCommand.mockRejectedValue(new Error('Command failed'));

      await expect(executeCommand('swarm', ['test'], {})).rejects.toThrow('Command failed');
    });
  });

  describe('showCommandHelp', () => {
    beforeEach(() => {
      registerCoreCommands();
    });

    test('should display help for existing command', () => {
      showCommandHelp('init');

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('init');
      expect(output).toContain('Initialize Claude Code integration');
      expect(output).toContain('Usage:');
      expect(output).toContain('Examples:');
    });

    test('should show error for unknown command', () => {
      showCommandHelp('unknown');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown command: unknown'),
      );
    });
  });

  describe('showAllCommands', () => {
    test('should display all registered commands grouped by category', () => {
      registerCoreCommands();
      showAllCommands();

      const output = consoleLogSpy.mock.calls.flat().join('\n');

      // Check for categories
      expect(output).toContain('SWARM INTELLIGENCE COMMANDS');
      expect(output).toContain('WORKFLOW AUTOMATION');
      expect(output).toContain('DEVELOPMENT & TESTING');
      expect(output).toContain('INFRASTRUCTURE');

      // Check for specific commands
      expect(output).toContain('swarm');
      expect(output).toContain('agent');
      expect(output).toContain('task');
      expect(output).toContain('github');
      expect(output).toContain('docker');
    });
  });

  describe('listCommands', () => {
    test('should return array of all command names', () => {
      registerCoreCommands();
      const commands = listCommands();

      expect(Array.isArray(commands)).toBe(true);
      expect(commands).toContain('init');
      expect(commands).toContain('swarm');
      expect(commands).toContain('agent');
      expect(commands.length).toBeGreaterThan(10);
    });

    test('should return empty array when no commands registered', () => {
      commandRegistry.clear();
      const commands = listCommands();

      expect(commands).toEqual([]);
    });
  });
});
