/**
 * Tests for swarm command
 */

import { jest } from '@jest/globals';
import { swarmCommand } from '../swarm.js';
import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import ora from 'ora';

jest.mock('fs-extra');
jest.mock('child_process');
jest.mock('ora');

describe('Swarm Command', () => {
  let consoleLogSpy;
  let consoleErrorSpy;
  let mockSpinner;
  let mockSpawnProcess;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockSpinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
      info: jest.fn().mockReturnThis(),
      warn: jest.fn().mockReturnThis(),
      text: '',
    };
    ora.mockReturnValue(mockSpinner);

    mockSpawnProcess = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn(),
    };
    spawn.mockReturnValue(mockSpawnProcess);

    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('main swarm command', () => {
    test('should initialize swarm with objective', async () => {
      const swarmDir = path.join(process.cwd(), '.claude', 'swarm');
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);

      // Mock spawn process events
      mockSpawnProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 100);
        }
      });

      await swarmCommand(['Build a REST API'], {});

      expect(mockSpinner.start).toHaveBeenCalledWith('Initializing swarm...');
      expect(fs.ensureDir).toHaveBeenCalledWith(swarmDir);

      const writeJsonCall = fs.writeJson.mock.calls[0];
      expect(writeJsonCall[0]).toBe(path.join(swarmDir, 'swarm.json'));
      expect(writeJsonCall[1]).toMatchObject({
        objective: 'Build a REST API',
        status: 'initializing',
        topology: 'hierarchical',
        strategy: 'adaptive',
      });
    });

    test('should handle custom strategy', async () => {
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);

      mockSpawnProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') callback(0);
      });

      await swarmCommand(['Research task'], { strategy: 'research' });

      const writeJsonCall = fs.writeJson.mock.calls[0];
      expect(writeJsonCall[1].strategy).toBe('research');
    });

    test('should handle custom topology mode', async () => {
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);

      mockSpawnProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') callback(0);
      });

      await swarmCommand(['Task'], { mode: 'mesh' });

      const writeJsonCall = fs.writeJson.mock.calls[0];
      expect(writeJsonCall[1].topology).toBe('mesh');
    });

    test('should set max agents', async () => {
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);

      mockSpawnProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') callback(0);
      });

      await swarmCommand(['Task'], { 'max-agents': '10' });

      const writeJsonCall = fs.writeJson.mock.calls[0];
      expect(writeJsonCall[1].maxAgents).toBe(10);
    });

    test('should enable parallel execution', async () => {
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);

      mockSpawnProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') callback(0);
      });

      await swarmCommand(['Task'], { parallel: true });

      const writeJsonCall = fs.writeJson.mock.calls[0];
      expect(writeJsonCall[1].parallel).toBe(true);
    });

    test('should enable monitoring', async () => {
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);

      mockSpawnProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') callback(0);
      });

      await swarmCommand(['Task'], { monitor: true });

      expect(spawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining(['--monitor']),
        expect.any(Object),
      );
    });
  });

  describe('swarm status', () => {
    test('should show swarm status', async () => {
      const mockSwarmData = {
        id: 'swarm-123',
        objective: 'Build API',
        status: 'active',
        topology: 'hierarchical',
        agents: [
          { id: 'agent-1', type: 'researcher', status: 'active' },
          { id: 'agent-2', type: 'coder', status: 'working' },
        ],
        metrics: {
          startTime: new Date(Date.now() - 300000).toISOString(),
          tasksCompleted: 15,
          tasksInProgress: 3,
          tasksPending: 7,
        },
      };

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(mockSwarmData);

      await swarmCommand(['status'], {});

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Swarm Status');
      expect(output).toContain('Build API');
      expect(output).toContain('active');
      expect(output).toContain('hierarchical');
      expect(output).toContain('2 agents');
      expect(output).toContain('15 completed');
    });

    test('should show no active swarm message', async () => {
      fs.pathExists.mockResolvedValue(false);

      await swarmCommand(['status'], {});

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No active swarm found'));
    });
  });

  describe('swarm stop', () => {
    test('should stop active swarm', async () => {
      const mockSwarmData = {
        id: 'swarm-123',
        status: 'active',
        agents: [{ id: 'agent-1' }, { id: 'agent-2' }],
      };

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(mockSwarmData);
      fs.writeJson.mockResolvedValue(undefined);
      fs.remove.mockResolvedValue(undefined);

      await swarmCommand(['stop'], {});

      expect(mockSpinner.succeed).toHaveBeenCalledWith('Swarm stopped successfully');
      expect(fs.remove).toHaveBeenCalledWith(
        path.join(process.cwd(), '.claude', 'swarm', 'swarm.json'),
      );
    });

    test('should handle stop with force flag', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.remove.mockResolvedValue(undefined);

      await swarmCommand(['stop'], { force: true });

      expect(fs.remove).toHaveBeenCalled();
      expect(mockSpinner.warn).toHaveBeenCalledWith('Swarm forcefully terminated');
    });
  });

  describe('swarm pause/resume', () => {
    test('should pause active swarm', async () => {
      const mockSwarmData = {
        id: 'swarm-123',
        status: 'active',
      };

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(mockSwarmData);
      fs.writeJson.mockResolvedValue(undefined);

      await swarmCommand(['pause'], {});

      const writeCall = fs.writeJson.mock.calls[0];
      expect(writeCall[1].status).toBe('paused');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Swarm paused');
    });

    test('should resume paused swarm', async () => {
      const mockSwarmData = {
        id: 'swarm-123',
        status: 'paused',
      };

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(mockSwarmData);
      fs.writeJson.mockResolvedValue(undefined);

      await swarmCommand(['resume'], {});

      const writeCall = fs.writeJson.mock.calls[0];
      expect(writeCall[1].status).toBe('active');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Swarm resumed');
    });
  });

  describe('swarm logs', () => {
    test('should display swarm logs', async () => {
      const mockLogs = [
        { timestamp: new Date().toISOString(), level: 'info', message: 'Swarm initialized' },
        { timestamp: new Date().toISOString(), level: 'info', message: 'Agent spawned' },
        { timestamp: new Date().toISOString(), level: 'error', message: 'Task failed' },
      ];

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ logs: mockLogs });

      await swarmCommand(['logs'], {});

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Swarm Logs');
      expect(output).toContain('Swarm initialized');
      expect(output).toContain('Agent spawned');
      expect(output).toContain('Task failed');
    });

    test('should filter logs by level', async () => {
      const mockLogs = [
        { timestamp: new Date().toISOString(), level: 'info', message: 'Info message' },
        { timestamp: new Date().toISOString(), level: 'error', message: 'Error message' },
        { timestamp: new Date().toISOString(), level: 'debug', message: 'Debug message' },
      ];

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ logs: mockLogs });

      await swarmCommand(['logs'], { level: 'error' });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Error message');
      expect(output).not.toContain('Info message');
      expect(output).not.toContain('Debug message');
    });

    test('should tail logs', async () => {
      const mockLogs = Array.from({ length: 50 }, (_, i) => ({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `Log entry ${i + 1}`,
      }));

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ logs: mockLogs });

      await swarmCommand(['logs'], { tail: '10' });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Log entry 50');
      expect(output).toContain('Log entry 41');
      expect(output).not.toContain('Log entry 40');
    });
  });

  describe('error handling', () => {
    test('should handle missing objective', async () => {
      await swarmCommand([], {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('objective is required'),
      );
    });

    test('should handle invalid strategy', async () => {
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);

      await swarmCommand(['Task'], { strategy: 'invalid-strategy' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid strategy'));
    });

    test('should handle spawn process errors', async () => {
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);

      mockSpawnProcess.on.mockImplementation((event, callback) => {
        if (event === 'error') callback(new Error('Spawn failed'));
      });

      await swarmCommand(['Task'], {});

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize swarm'),
      );
    });

    test('should handle file system errors', async () => {
      fs.ensureDir.mockRejectedValue(new Error('Permission denied'));

      await swarmCommand(['Task'], {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error:'));
    });
  });

  describe('help', () => {
    test('should show help for invalid subcommand', async () => {
      await swarmCommand(['invalid'], {});

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Swarm Orchestration');
      expect(output).toContain('USAGE:');
    });
  });
});
