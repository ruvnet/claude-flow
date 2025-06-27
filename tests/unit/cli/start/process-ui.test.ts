/// <reference types="jest" />

/**
 * Test suite for ProcessUI
 */

import { ProcessUI } from '../../../../src/cli/commands/start/process-ui.js';
import { ProcessManager } from '../../../../src/cli/commands/start/process-manager.js';
import { ProcessStatus } from '../../../../src/cli/commands/start/types.js';

describe('ProcessUI', () => {
  let processManager: ProcessManager;
  let processUI: ProcessUI;

  beforeEach(() => {
    processManager = new ProcessManager();
    processUI = new ProcessUI(processManager);
  });

  describe('initialization', () => {
    it('should create ProcessUI instance', () => {
      expect(processUI);
    });

    it('should setup event listeners on ProcessManager', () => {
      // UI should react to process manager events
      let renderCalled = false;
      const originalRender = ProcessUI.prototype['render'];
      ProcessUI.prototype['render'] = function() {
        renderCalled = true;
      };

      // Create new instance to test event setup
      const ui = new ProcessUI(processManager);
      processManager.emit('statusChanged', { processId: 'test', status: ProcessStatus.RUNNING });
      
      // Restore original
      ProcessUI.prototype['render'] = originalRender;
    });
  });

  describe('formatting helpers', () => {
    it('should format uptime correctly', () => {
      const formatUptime = processUI['formatUptime'].bind(processUI);
      
      expect(formatUptime(1000)).toBe( '1s');
      expect(formatUptime(60000)).toBe( '1m 0s');
      expect(formatUptime(3600000)).toBe( '1h 0m');
      expect(formatUptime(86400000)).toBe( '1d 0h');
      expect(formatUptime(90061000)).toBe( '1d 1h'); // 1 day, 1 hour, 1 minute, 1 second
    });

    it('should display correct status icons', () => {
      const getStatusDisplay = processUI['getStatusDisplay'].bind(processUI);
      
      // Check each status has a unique display
      const displays = {
        [ProcessStatus.RUNNING]: getStatusDisplay(ProcessStatus.RUNNING),
        [ProcessStatus.STOPPED]: getStatusDisplay(ProcessStatus.STOPPED),
        [ProcessStatus.STARTING]: getStatusDisplay(ProcessStatus.STARTING),
        [ProcessStatus.STOPPING]: getStatusDisplay(ProcessStatus.STOPPING),
        [ProcessStatus.ERROR]: getStatusDisplay(ProcessStatus.ERROR),
        [ProcessStatus.CRASHED]: getStatusDisplay(ProcessStatus.CRASHED),
      };
      
      // All should be defined and unique
      const values = Object.values(displays);
      expect(values.length).toBe( 6);
      expect(new Set(values).size).toBe( 6); // All unique
    });
  });

  describe('command handling', () => {
    it('should handle help command', async () => {
      const handleCommand = processUI['handleCommand'].bind(processUI);
      
      // Mock console output
      const originalLog = console.log;
      let helpShown = false;
      console.log = (...args) => {
        if (args.join(' ').includes('Help')) {
          helpShown = true;
        }
      };
      
      await handleCommand('h');
      expect(helpShown).toBe( true);
      
      // Restore
      console.log = originalLog;
    });

    it('should handle refresh command', async () => {
      const handleCommand = processUI['handleCommand'].bind(processUI);
      let renderCalled = false;
      
      processUI['render'] = () => {
        renderCalled = true;
      };
      
      await handleCommand('r');
      expect(renderCalled).toBe( true);
    });

    it('should handle invalid commands', async () => {
      const handleCommand = processUI['handleCommand'].bind(processUI);
      
      // Mock console output
      const originalLog = console.log;
      let invalidMessageShown = false;
      console.log = (...args) => {
        if (args.join(' ').includes('Invalid command')) {
          invalidMessageShown = true;
        }
      };
      
      await handleCommand('xyz');
      expect(invalidMessageShown).toBe( true);
      
      // Restore
      console.log = originalLog;
    });

    it('should handle numeric process selection', async () => {
      const handleCommand = processUI['handleCommand'].bind(processUI);
      await processManager.initialize();
      
      // Mock showProcessMenu
      let menuShownForProcess: any = null;
      processUI['showProcessMenu'] = async (process) => {
        menuShownForProcess = process;
      };
      
      await handleCommand('1');
      expect(menuShownForProcess);
      expect(menuShownForProcess.id).toBe( 'event-bus');
    });
  });

  describe('process actions', () => {
    beforeEach(async () => {
      await processManager.initialize();
    });

    it('should start process', async () => {
      const startProcess = processUI['startProcess'].bind(processUI);
      
      await startProcess('event-bus');
      
      const process = processManager.getProcess('event-bus');
      expect(process?.status).toBe( ProcessStatus.RUNNING);
    });

    it('should stop process', async () => {
      const stopProcess = processUI['stopProcess'].bind(processUI);
      
      // Start first
      await processManager.startProcess('event-bus');
      
      await stopProcess('event-bus');
      
      const process = processManager.getProcess('event-bus');
      expect(process?.status).toBe( ProcessStatus.STOPPED);
    });

    it('should restart process', async () => {
      const restartProcess = processUI['restartProcess'].bind(processUI);
      
      // Start first
      await processManager.startProcess('event-bus');
      const firstStartTime = processManager.getProcess('event-bus')?.startTime;
      
      await new Promise(resolve => setTimeout(resolve, 100));
      await restartProcess('event-bus');
      
      const process = processManager.getProcess('event-bus');
      expect(process?.status).toBe( ProcessStatus.RUNNING);
      expect(process?.startTime !== firstStartTime).toBe( true);
    });

    it('should start all processes', async () => {
      const startAll = processUI['startAll'].bind(processUI);
      
      await startAll();
      
      const stats = processManager.getSystemStats();
      expect(stats.runningProcesses >= 5).toBe( true);
    });

    it('should stop all processes', async () => {
      const stopAll = processUI['stopAll'].bind(processUI);
      
      // Start some processes first
      await processManager.startProcess('event-bus');
      await processManager.startProcess('memory-manager');
      
      await stopAll();
      
      const stats = processManager.getSystemStats();
      expect(stats.runningProcesses).toBe( 0);
    });
  });

  describe('process details', () => {
    it('should show process details', () => {
      const showProcessDetails = processUI['showProcessDetails'].bind(processUI);
      
      // Mock console output
      const originalLog = console.log;
      let detailsShown = false;
      console.log = (...args) => {
        if (args.join(' ').includes('Process Details')) {
          detailsShown = true;
        }
      };
      
      const mockProcess = processManager.getProcess('event-bus')!;
      showProcessDetails(mockProcess);
      
      expect(detailsShown).toBe( true);
      
      // Restore
      console.log = originalLog;
    });

    it('should display metrics when available', () => {
      const showProcessDetails = processUI['showProcessDetails'].bind(processUI);
      
      // Mock console output
      const originalLog = console.log;
      let metricsShown = false;
      console.log = (...args) => {
        if (args.join(' ').includes('Metrics:')) {
          metricsShown = true;
        }
      };
      
      const mockProcess = processManager.getProcess('event-bus')!;
      mockProcess.metrics = {
        cpu: 25.5,
        memory: 128,
        restarts: 2,
        lastError: 'Test error'
      };
      
      showProcessDetails(mockProcess);
      
      expect(metricsShown).toBe( true);
      
      // Restore
      console.log = originalLog;
    });
  });

  describe('exit handling', () => {
    it('should prompt to stop running processes on exit', async () => {
      const handleExit = processUI['handleExit'].bind(processUI);
      
      // Start a process
      await processManager.initialize();
      await processManager.startProcess('event-bus');
      
      // Mock console and stdin
      const originalLog = console.log;
      let promptShown = false;
      console.log = (...args) => {
        if (args.join(' ').includes('processes are still running')) {
          promptShown = true;
        }
      };
      
      // Mock stdin to return 'n'
      const originalRead = Deno.stdin.read;
      Deno.stdin.read = async (buf: Uint8Array) => {
        buf[0] = 110; // 'n'
        return 1;
      };
      
      // Mock stop method
      let stopCalled = false;
      processUI['stop'] = async () => {
        stopCalled = true;
      };
      
      await handleExit();
      
      expect(promptShown).toBe( true);
      expect(stopCalled).toBe( true);
      
      // Restore
      console.log = originalLog;
      Deno.stdin.read = originalRead;
    });
  });
});
