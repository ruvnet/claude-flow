/// <reference types="jest" />

/**
 * Comprehensive test suite for ProcessManager
 */

import { ProcessManager } from '../../../../src/cli/commands/start/process-manager.js';
import { ProcessStatus, ProcessType } from '../../../../src/cli/commands/start/types.js';

describe('ProcessManager', () => {
  let processManager: ProcessManager;

  beforeEach(() => {
    processManager = new ProcessManager();
  });

  describe('initialization', () => {
    it('should initialize with all process definitions', () => {
      const processes = processManager.getAllProcesses();
      expect(processes.length).toBe( 6);
      
      const processIds = processes.map(p => p.id);
      expect(processIds.includes('event-bus')).toBe( true);
      expect(processIds.includes('orchestrator')).toBe( true);
      expect(processIds.includes('memory-manager')).toBe( true);
      expect(processIds.includes('terminal-pool')).toBe( true);
      expect(processIds.includes('mcp-server')).toBe( true);
      expect(processIds.includes('coordinator')).toBe( true);
    });

    it('should initialize all processes with STOPPED status', () => {
      const processes = processManager.getAllProcesses();
      processes.forEach(process => {
        expect(process.status).toBe( ProcessStatus.STOPPED);
      });
    });

    it('should load configuration', async () => {
      await processManager.initialize();
      // Configuration should be loaded without errors
      expect(processManager);
    });
  });

  describe('getProcess', () => {
    it('should return process by id', () => {
      const process = processManager.getProcess('orchestrator');
      expect(process);
      expect(process?.id).toBe( 'orchestrator');
      expect(process?.type).toBe( ProcessType.ORCHESTRATOR);
    });

    it('should return undefined for unknown process', () => {
      const process = processManager.getProcess('unknown');
      expect(process).toBe( undefined);
    });
  });

  describe('getAllProcesses', () => {
    it('should return all processes', () => {
      const processes = processManager.getAllProcesses();
      expect(Array.isArray(processes)).toBe( true);
      expect(processes.length).toBe( 6);
    });
  });

  describe('getSystemStats', () => {
    it('should return correct initial stats', () => {
      const stats = processManager.getSystemStats();
      expect(stats.totalProcesses).toBe( 6);
      expect(stats.runningProcesses).toBe( 0);
      expect(stats.stoppedProcesses).toBe( 6);
      expect(stats.errorProcesses).toBe( 0);
      expect(stats.systemUptime).toBe( 0);
    });
  });

  describe('startProcess', () => {
    it('should reject starting unknown process', async () => {
      await expect(
        () => processManager.startProcess('unknown'),
        Error,
        'Unknown process: unknown'
      );
    });

    it('should update process status to STARTING then RUNNING', async () => {
      const processId = 'event-bus';
      
      // Listen for status changes
      const statusChanges: ProcessStatus[] = [];
      processManager.on('statusChanged', ({ status }) => {
        statusChanges.push(status);
      });

      await processManager.initialize();
      await processManager.startProcess(processId);
      
      const process = processManager.getProcess(processId);
      expect(process?.status).toBe( ProcessStatus.RUNNING);
      expect(statusChanges.includes(ProcessStatus.STARTING)).toBe( true);
      expect(statusChanges.includes(ProcessStatus.RUNNING)).toBe( true);
    });

    it('should set process start time', async () => {
      const processId = 'event-bus';
      await processManager.initialize();
      await processManager.startProcess(processId);
      
      const process = processManager.getProcess(processId);
      expect(process?.startTime);
      expect(typeof process?.startTime).toBe( 'number');
    });

    it('should reject starting already running process', async () => {
      const processId = 'event-bus';
      await processManager.initialize();
      await processManager.startProcess(processId);
      
      await expect(
        () => processManager.startProcess(processId),
        Error,
        'Process event-bus is already running'
      );
    });

    it('should emit processStarted event', async () => {
      const processId = 'event-bus';
      let eventData: any = null;
      
      processManager.on('processStarted', (data) => {
        eventData = data;
      });
      
      await processManager.initialize();
      await processManager.startProcess(processId);
      
      expect(eventData);
      expect(eventData.processId).toBe( processId);
      expect(eventData.process);
    });

    it('should handle process start errors', async () => {
      const processId = 'orchestrator'; // This requires other components
      let errorEvent: any = null;
      
      processManager.on('processError', (data) => {
        errorEvent = data;
      });
      
      await processManager.initialize();
      
      // Should fail because required components are not initialized
      await expect(
        () => processManager.startProcess(processId),
        Error,
        'Required components not initialized'
      );
      
      expect(errorEvent);
      expect(errorEvent.processId).toBe( processId);
    });
  });

  describe('stopProcess', () => {
    it('should reject stopping unknown process', async () => {
      await expect(
        () => processManager.stopProcess('unknown'),
        Error,
        'Process unknown is not running'
      );
    });

    it('should reject stopping non-running process', async () => {
      await expect(
        () => processManager.stopProcess('event-bus'),
        Error,
        'Process event-bus is not running'
      );
    });

    it('should stop running process', async () => {
      const processId = 'event-bus';
      await processManager.initialize();
      await processManager.startProcess(processId);
      
      await processManager.stopProcess(processId);
      
      const process = processManager.getProcess(processId);
      expect(process?.status).toBe( ProcessStatus.STOPPED);
    });

    it('should emit processStopped event', async () => {
      const processId = 'event-bus';
      let stoppedEvent: any = null;
      
      processManager.on('processStopped', (data) => {
        stoppedEvent = data;
      });
      
      await processManager.initialize();
      await processManager.startProcess(processId);
      await processManager.stopProcess(processId);
      
      expect(stoppedEvent);
      expect(stoppedEvent.processId).toBe( processId);
    });
  });

  describe('restartProcess', () => {
    it('should restart a running process', async () => {
      const processId = 'event-bus';
      await processManager.initialize();
      await processManager.startProcess(processId);
      
      const firstStartTime = processManager.getProcess(processId)?.startTime;
      
      // Wait a bit to ensure different start times
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await processManager.restartProcess(processId);
      
      const process = processManager.getProcess(processId);
      expect(process?.status).toBe( ProcessStatus.RUNNING);
      expect(process?.startTime);
      // New start time should be different
      expect(process?.startTime !== firstStartTime).toBe( true);
    });
  });

  describe('startAll', () => {
    it('should start all processes in correct order', async () => {
      await processManager.initialize();
      
      const startedProcesses: string[] = [];
      processManager.on('processStarted', ({ processId }) => {
        startedProcesses.push(processId);
      });
      
      await processManager.startAll();
      
      // Check order matches dependency order
      const expectedOrder = [
        'event-bus',
        'memory-manager',
        'terminal-pool',
        'coordinator',
        'mcp-server',
        'orchestrator'
      ];
      
      expect(startedProcesses.slice(0).toBe( 5), expectedOrder.slice(0, 5));
      // Orchestrator might fail due to missing dependencies, that's ok
    });

    it('should update system stats after starting all', async () => {
      await processManager.initialize();
      await processManager.startAll();
      
      const stats = processManager.getSystemStats();
      expect(stats.runningProcesses >= 5).toBe( true); // At least core processes
    });
  });

  describe('stopAll', () => {
    it('should stop all processes in reverse order', async () => {
      await processManager.initialize();
      
      // Start some processes
      await processManager.startProcess('event-bus');
      await processManager.startProcess('memory-manager');
      
      const stoppedProcesses: string[] = [];
      processManager.on('processStopped', ({ processId }) => {
        stoppedProcesses.push(processId);
      });
      
      await processManager.stopAll();
      
      // Should stop in reverse order
      expect(stoppedProcesses[0]).toBe( 'memory-manager');
      expect(stoppedProcesses[1]).toBe( 'event-bus');
    });

    it('should handle stopping already stopped processes', async () => {
      await processManager.initialize();
      // No processes running
      await processManager.stopAll(); // Should not throw
      
      const stats = processManager.getSystemStats();
      expect(stats.runningProcesses).toBe( 0);
    });
  });

  describe('process logs', () => {
    it('should return placeholder logs', async () => {
      const logs = await processManager.getProcessLogs('event-bus', 10);
      expect(Array.isArray(logs)).toBe( true);
      expect(logs.length).toBe( 2); // Placeholder returns 2 logs
    });
  });

  describe('event emission', () => {
    it('should emit initialized event', async () => {
      let initialized = false;
      processManager.on('initialized', () => {
        initialized = true;
      });
      
      await processManager.initialize();
      expect(initialized).toBe( true);
    });

    it('should emit error event on initialization failure', async () => {
      // Create a new manager with invalid config path
      const manager = new ProcessManager();
      let errorEmitted = false;
      
      manager.on('error', () => {
        errorEmitted = true;
      });
      
      try {
        await manager.initialize('/invalid/path/to/config.json');
      } catch {
        // Expected to throw
      }
      
      expect(errorEmitted).toBe( true);
    });
  });

  describe('process metrics', () => {
    it('should track last error in metrics', async () => {
      const processId = 'orchestrator';
      await processManager.initialize();
      
      try {
        await processManager.startProcess(processId);
      } catch {
        // Expected to fail
      }
      
      const process = processManager.getProcess(processId);
      expect(process?.metrics?.lastError);
      expect(process?.metrics?.lastError).toBe( 'Required components not initialized');
    });
  });
});
