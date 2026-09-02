import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';

describe('monitor.js - Real Metrics Implementation', () => {
  let consoleSpy;
  let processExitSpy;

  beforeEach(() => {
    // Setup console spies
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      clear: jest.spyOn(console, 'clear').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };

    // Setup process spies
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation();
  });

  afterEach(() => {
    // Restore all spies
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    processExitSpy.mockRestore();
  });

  describe('Basic Functionality', () => {
    test('should import without errors', async () => {
      const monitor = await import('../../../../src/cli/simple-commands/monitor.js');
      expect(monitor.monitorCommand).toBeDefined();
      expect(monitor.showMonitorHelp).toBeDefined();
    });

    test('should collect and display metrics', async () => {
      const { monitorCommand } = await import('../../../../src/cli/simple-commands/monitor.js');
      
      await monitorCommand([], {});

      // Check if metrics were displayed
      const output = consoleSpy.log.mock.calls.join('\n');
      expect(output).toContain('System Metrics');
    });

    test('should show help information', async () => {
      const { showMonitorHelp } = await import('../../../../src/cli/simple-commands/monitor.js');
      
      showMonitorHelp();

      const output = consoleSpy.log.mock.calls.join('\n');
      expect(output).toContain('Monitor commands:');
      expect(output).toContain('--interval');
      expect(output).toContain('--format');
    });
  });

  describe('Output Formats', () => {
    test('should output JSON format when specified', async () => {
      const { monitorCommand } = await import('../../../../src/cli/simple-commands/monitor.js');
      
      await monitorCommand(['--format', 'json'], {});

      const calls = consoleSpy.log.mock.calls;
      const jsonOutput = calls.find(call => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonOutput).toBeDefined();
      if (jsonOutput) {
        const parsed = JSON.parse(jsonOutput[0]);
        expect(parsed).toHaveProperty('timestamp');
        expect(parsed).toHaveProperty('system');
      }
    });

    test('should output pretty format by default', async () => {
      const { monitorCommand } = await import('../../../../src/cli/simple-commands/monitor.js');
      
      await monitorCommand([], {});

      const output = consoleSpy.log.mock.calls.join('\n');
      expect(output).toMatch(/System Metrics|System Resources|Performance/);
    });
  });
});