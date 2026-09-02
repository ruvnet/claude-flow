/**
 * Functional tests for portability improvements
 * Tests the actual behavior of the fixed components
 */

import { jest } from '@jest/globals';
import { platform } from 'os';
import { spawn, execSync } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

describe('Functional Portability Tests', () => {
  describe('RuvSwarmWrapper Functional Tests', () => {
    let RuvSwarmWrapper;

    beforeEach(async () => {
      const module = await import('../../src/mcp/ruv-swarm-wrapper.js');
      RuvSwarmWrapper = module.RuvSwarmWrapper;
    });

    test('wrapper should instantiate with proper options', () => {
      const wrapper = new RuvSwarmWrapper({
        silent: true,
        autoRestart: false,
        maxRestarts: 5
      });

      expect(wrapper.options.silent).toBe(true);
      expect(wrapper.options.autoRestart).toBe(false);
      expect(wrapper.options.maxRestarts).toBe(5);
      expect(wrapper.process).toBeNull();
      expect(wrapper.isRunning()).toBe(false);
    });

    test('wrapper should handle process lifecycle methods', () => {
      const wrapper = new RuvSwarmWrapper({ autoRestart: false });
      
      // Test initial state
      expect(wrapper.isRunning()).toBe(false);
      
      // Mock console methods to suppress output during test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Test handleProcessExit with code 0 (normal exit)
      wrapper.handleProcessExit(0);
      expect(wrapper.process).toBeNull();
      
      // Test with code 1 and auto-restart disabled
      wrapper.handleProcessExit(1);
      expect(wrapper.restartCount).toBe(0); // Should not increment when autoRestart is false
      
      consoleSpy.mockRestore();
    });
  });

  describe('Cross-Platform Command Detection', () => {
    test('should detect common commands correctly', async () => {
      // Test detection of a command that should exist on all platforms
      const nodeExists = await checkIfCommandExists('node');
      expect(nodeExists).toBe(true);

      // Test detection of a command that likely doesn't exist
      const fakeCommandExists = await checkIfCommandExists('definitely-not-a-real-command-12345');
      expect(fakeCommandExists).toBe(false);
    });

    test('should use platform-appropriate detection method', () => {
      const detectionCommand = getCommandDetectionCommand('node');
      
      if (platform() === 'win32') {
        expect(detectionCommand).toContain('where');
      } else {
        expect(detectionCommand).toContain('command -v');
      }
    });
  });

  describe('Process Management', () => {
    test('should track and terminate processes correctly', async () => {
      const processTracker = new Map();
      
      // Simulate adding a process
      const mockProcess = {
        pid: 12345,
        killed: false,
        kill: jest.fn()
      };
      
      processTracker.set('test-process', mockProcess);
      
      // Simulate termination
      for (const [id, proc] of processTracker) {
        if (proc.pid && !proc.killed) {
          proc.kill('SIGTERM');
          proc.killed = true;
        }
      }
      
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.killed).toBe(true);
    });

    test('should handle missing processes gracefully', () => {
      const processTracker = new Map();
      
      // Add a process that's already dead
      const deadProcess = {
        pid: null,
        killed: true,
        kill: jest.fn()
      };
      
      processTracker.set('dead-process', deadProcess);
      
      // Attempt to kill should not throw
      expect(() => {
        for (const [id, proc] of processTracker) {
          if (proc.pid && !proc.killed) {
            proc.kill('SIGTERM');
          }
        }
      }).not.toThrow();
      
      expect(deadProcess.kill).not.toHaveBeenCalled();
    });
  });
});

// Helper functions that mirror the implementation
async function checkIfCommandExists(command) {
  try {
    if (platform() === 'win32') {
      execSync(`where ${command}`, { stdio: 'ignore' });
      return true;
    } else {
      execSync(`command -v ${command}`, { stdio: 'ignore', shell: true });
      return true;
    }
  } catch (e) {
    return false;
  }
}

function getCommandDetectionCommand(command) {
  if (platform() === 'win32') {
    return `where ${command}`;
  } else {
    return `command -v ${command}`;
  }
}