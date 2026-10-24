/**
 * Tests for agent command
 */

import { jest } from '@jest/globals';
import { agentCommand } from '../agent.js';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';

jest.mock('fs-extra');
jest.mock('ora');
jest.mock('chalk', () => ({
  default: {
    blue: jest.fn((str) => str),
    green: jest.fn((str) => str),
    yellow: jest.fn((str) => str),
    red: jest.fn((str) => str),
    cyan: jest.fn((str) => str),
    dim: jest.fn((str) => str),
    bold: jest.fn((str) => str),
  },
}));

describe('Agent Command', () => {
  let consoleLogSpy;
  let consoleErrorSpy;
  let mockSpinner;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockSpinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
      info: jest.fn().mockReturnThis(),
      text: '',
    };
    ora.mockReturnValue(mockSpinner);

    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('list subcommand', () => {
    test('should list available agent types', async () => {
      await agentCommand(['list'], {});

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join('\n');

      expect(output).toContain('Available Agent Types');
      expect(output).toContain('researcher');
      expect(output).toContain('coder');
      expect(output).toContain('analyst');
      expect(output).toContain('architect');
      expect(output).toContain('tester');
      expect(output).toContain('coordinator');
    });
  });

  describe('spawn subcommand', () => {
    test('should spawn an agent with type', async () => {
      const swarmDir = path.join(process.cwd(), '.claude', 'swarm');
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({
        id: 'swarm-123',
        agents: [],
        status: 'active',
      });
      fs.writeJson.mockResolvedValue(undefined);

      await agentCommand(['spawn', 'researcher'], {});

      expect(mockSpinner.start).toHaveBeenCalledWith('Spawning researcher agent...');
      expect(mockSpinner.succeed).toHaveBeenCalled();
      expect(fs.writeJson).toHaveBeenCalled();

      const writeCall = fs.writeJson.mock.calls[0];
      expect(writeCall[1].agents).toHaveLength(1);
      expect(writeCall[1].agents[0].type).toBe('researcher');
    });

    test('should spawn agent with custom name', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({
        id: 'swarm-123',
        agents: [],
        status: 'active',
      });
      fs.writeJson.mockResolvedValue(undefined);

      await agentCommand(['spawn', 'coder'], { name: 'CustomCoder' });

      const writeCall = fs.writeJson.mock.calls[0];
      expect(writeCall[1].agents[0].name).toBe('CustomCoder');
    });

    test('should error if swarm not initialized', async () => {
      fs.pathExists.mockResolvedValue(false);

      await agentCommand(['spawn', 'researcher'], {});

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        expect.stringContaining('No active swarm found'),
      );
    });

    test('should error for invalid agent type', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ agents: [] });

      await agentCommand(['spawn', 'invalid-type'], {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid agent type'));
    });
  });

  describe('status subcommand', () => {
    test('should show agent status', async () => {
      const mockSwarmData = {
        id: 'swarm-123',
        agents: [
          {
            id: 'agent-1',
            name: 'Researcher',
            type: 'researcher',
            status: 'active',
            created: new Date().toISOString(),
            tasksCompleted: 5,
            currentTask: 'Analyzing data',
          },
          {
            id: 'agent-2',
            name: 'Coder',
            type: 'coder',
            status: 'idle',
            created: new Date().toISOString(),
            tasksCompleted: 3,
            currentTask: null,
          },
        ],
      };

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(mockSwarmData);

      await agentCommand(['status'], {});

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Active Agents');
      expect(output).toContain('Researcher');
      expect(output).toContain('active');
      expect(output).toContain('Analyzing data');
      expect(output).toContain('Coder');
      expect(output).toContain('idle');
    });

    test('should show specific agent status', async () => {
      const mockSwarmData = {
        agents: [
          {
            id: 'agent-1',
            name: 'Researcher',
            type: 'researcher',
            status: 'active',
            metrics: {
              tasksCompleted: 10,
              avgCompletionTime: 5000,
              successRate: 0.95,
            },
          },
        ],
      };

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(mockSwarmData);

      await agentCommand(['status', 'agent-1'], {});

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Agent Details');
      expect(output).toContain('Researcher');
      expect(output).toContain('Tasks Completed: 10');
      expect(output).toContain('Success Rate: 95%');
    });
  });

  describe('remove subcommand', () => {
    test('should remove an agent', async () => {
      const mockSwarmData = {
        agents: [
          { id: 'agent-1', name: 'Researcher' },
          { id: 'agent-2', name: 'Coder' },
        ],
      };

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(mockSwarmData);
      fs.writeJson.mockResolvedValue(undefined);

      await agentCommand(['remove', 'agent-1'], {});

      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        expect.stringContaining('Agent agent-1 removed'),
      );

      const writeCall = fs.writeJson.mock.calls[0];
      expect(writeCall[1].agents).toHaveLength(1);
      expect(writeCall[1].agents[0].id).toBe('agent-2');
    });

    test('should error if agent not found', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ agents: [] });

      await agentCommand(['remove', 'nonexistent'], {});

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        expect.stringContaining('Agent nonexistent not found'),
      );
    });
  });

  describe('assign subcommand', () => {
    test('should assign task to agent', async () => {
      const mockSwarmData = {
        agents: [{ id: 'agent-1', name: 'Researcher', currentTask: null }],
      };

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(mockSwarmData);
      fs.writeJson.mockResolvedValue(undefined);

      await agentCommand(['assign', 'agent-1', 'Research new algorithms'], {});

      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        expect.stringContaining('Task assigned to agent-1'),
      );

      const writeCall = fs.writeJson.mock.calls[0];
      expect(writeCall[1].agents[0].currentTask).toBe('Research new algorithms');
      expect(writeCall[1].agents[0].status).toBe('working');
    });
  });

  describe('help subcommand', () => {
    test('should show help when no arguments', async () => {
      await agentCommand([], {});

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Agent Management');
      expect(output).toContain('USAGE:');
      expect(output).toContain('agent <subcommand>');
      expect(output).toContain('SUBCOMMANDS:');
    });

    test('should show help for help subcommand', async () => {
      await agentCommand(['help'], {});

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Agent Management');
    });
  });

  describe('error handling', () => {
    test('should handle file read errors gracefully', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockRejectedValue(new Error('Permission denied'));

      await agentCommand(['status'], {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error:'));
    });

    test('should handle invalid subcommands', async () => {
      await agentCommand(['invalid-subcommand'], {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown subcommand: invalid-subcommand'),
      );
    });
  });
});
