/// <reference types="jest" />

/**
 * Test suite for SystemMonitor
 */

import { SystemMonitor } from '../../../../src/cli/commands/start/system-monitor.js';
import { ProcessManager } from '../../../../src/cli/commands/start/process-manager.js';
import { eventBus } from '../../../../src/core/event-bus.js';
import { SystemEvents } from '../../../../src/utils/types.js';

describe('SystemMonitor', () => {
  let processManager: ProcessManager;
  let systemMonitor: SystemMonitor;

  beforeEach(() => {
    processManager = new ProcessManager();
    systemMonitor = new SystemMonitor(processManager);
  });

  describe('initialization', () => {
    it('should create SystemMonitor instance', () => {
      expect(systemMonitor);
    });

    it('should setup event listeners', () => {
      // Monitor should track events
      const monitor = new SystemMonitor(processManager);
      
      // Emit some events
      eventBus.emit(SystemEvents.AGENT_SPAWNED, { agentId: 'test-1', profile: { type: 'researcher' } });
      eventBus.emit(SystemEvents.TASK_COMPLETED, { taskId: 'task-1' });
      
      const events = monitor.getRecentEvents(10);
      expect(events.length >= 2).toBe( true);
    });
  });

  describe('event tracking', () => {
    it('should track agent spawned events', () => {
      eventBus.emit(SystemEvents.AGENT_SPAWNED, { 
        agentId: 'agent-123', 
        profile: { type: 'researcher' } 
      });
      
      const events = systemMonitor.getRecentEvents(10);
      const agentEvent = events.find(e => e.type === 'agent_spawned');
      
      expect(agentEvent);
      expect(agentEvent?.data.agentId).toBe( 'agent-123');
      expect(agentEvent?.level).toBe( 'info');
    });

    it('should track agent terminated events', () => {
      eventBus.emit(SystemEvents.AGENT_TERMINATED, { 
        agentId: 'agent-123', 
        reason: 'Task completed' 
      });
      
      const events = systemMonitor.getRecentEvents(10);
      const event = events.find(e => e.type === 'agent_terminated');
      
      expect(event);
      expect(event?.data.reason).toBe( 'Task completed');
      expect(event?.level).toBe( 'warning');
    });

    it('should track task events', () => {
      eventBus.emit(SystemEvents.TASK_ASSIGNED, { 
        taskId: 'task-1', 
        agentId: 'agent-1' 
      });
      
      eventBus.emit(SystemEvents.TASK_COMPLETED, { 
        taskId: 'task-1' 
      });
      
      eventBus.emit(SystemEvents.TASK_FAILED, { 
        taskId: 'task-2',
        error: new Error('Test error')
      });
      
      const events = systemMonitor.getRecentEvents(10);
      
      const assigned = events.find(e => e.type === 'task_assigned');
      const completed = events.find(e => e.type === 'task_completed');
      const failed = events.find(e => e.type === 'task_failed');
      
      expect(assigned);
      expect(completed);
      expect(failed);
      
      expect(assigned?.level).toBe( 'info');
      expect(completed?.level).toBe( 'success');
      expect(failed?.level).toBe( 'error');
    });

    it('should track system errors', () => {
      eventBus.emit(SystemEvents.SYSTEM_ERROR, { 
        component: 'TestComponent',
        error: new Error('System failure')
      });
      
      const events = systemMonitor.getRecentEvents(10);
      const errorEvent = events.find(e => e.type === 'system_error');
      
      expect(errorEvent);
      expect(errorEvent?.data.component).toBe( 'TestComponent');
      expect(errorEvent?.level).toBe( 'error');
    });

    it('should track process manager events', () => {
      processManager.emit('processStarted', { 
        processId: 'test-process',
        process: { name: 'Test Process' }
      });
      
      processManager.emit('processStopped', { 
        processId: 'test-process'
      });
      
      processManager.emit('processError', { 
        processId: 'test-process',
        error: new Error('Process error')
      });
      
      const events = systemMonitor.getRecentEvents(10);
      
      const started = events.find(e => e.type === 'process_started');
      const stopped = events.find(e => e.type === 'process_stopped');
      const error = events.find(e => e.type === 'process_error');
      
      expect(started);
      expect(stopped);
      expect(error);
    });

    it('should limit stored events to maxEvents', () => {
      // Add more than maxEvents (100)
      for (let i = 0; i < 150; i++) {
        eventBus.emit(SystemEvents.AGENT_SPAWNED, { 
          agentId: `agent-${i}`,
          profile: { type: 'test' }
        });
      }
      
      const events = systemMonitor.getRecentEvents(200);
      expect(events.length <= 100).toBe( true);
    });
  });

  describe('event formatting', () => {
    it('should format event messages correctly', () => {
      const formatMessage = systemMonitor['formatEventMessage'].bind(systemMonitor);
      
      const agentSpawnedMsg = formatMessage({
        type: 'agent_spawned',
        data: { agentId: 'agent-1', profile: { type: 'researcher' } }
      });
      expect(agentSpawnedMsg.includes('Agent spawned')).toBe( true);
      expect(agentSpawnedMsg.includes('agent-1')).toBe( true);
      expect(agentSpawnedMsg.includes('researcher')).toBe( true);
      
      const taskCompletedMsg = formatMessage({
        type: 'task_completed',
        data: { taskId: 'task-1' }
      });
      expect(taskCompletedMsg.includes('Task completed')).toBe( true);
      expect(taskCompletedMsg.includes('task-1')).toBe( true);
      
      const systemErrorMsg = formatMessage({
        type: 'system_error',
        data: { component: 'TestComp', error: { message: 'Error msg' } }
      });
      expect(systemErrorMsg.includes('System error')).toBe( true);
      expect(systemErrorMsg.includes('TestComp')).toBe( true);
      expect(systemErrorMsg.includes('Error msg')).toBe( true);
    });

    it('should get correct event icons', () => {
      const getIcon = systemMonitor['getEventIcon'].bind(systemMonitor);
      
      expect(getIcon('agent_spawned')).toBe( '🤖');
      expect(getIcon('agent_terminated')).toBe( '🔚');
      expect(getIcon('task_assigned')).toBe( '📌');
      expect(getIcon('task_completed')).toBe( '✅');
      expect(getIcon('task_failed')).toBe( '❌');
      expect(getIcon('system_error')).toBe( '⚠️');
      expect(getIcon('process_started')).toBe( '▶️');
      expect(getIcon('process_stopped')).toBe( '⏹️');
      expect(getIcon('process_error')).toBe( '🚨');
      expect(getIcon('unknown')).toBe( '•');
    });
  });

  describe('metrics collection', () => {
    it('should start and stop metrics collection', () => {
      let intervalId: number | undefined;
      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      
      globalThis.setInterval = ((fn: any, ms: number) => {
        intervalId = 123;
        return intervalId;
      }) as any;
      
      globalThis.clearInterval = ((id: number) => {
        expect(id).toBe( intervalId);
      }) as any;
      
      systemMonitor.start();
      expect(intervalId);
      
      systemMonitor.stop();
      
      // Restore
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    });

    it('should collect metrics for running processes', async () => {
      await processManager.initialize();
      await processManager.startProcess('event-bus');
      
      // Manually trigger metrics collection
      systemMonitor['collectMetrics']();
      
      const process = processManager.getProcess('event-bus');
      expect(process?.metrics?.cpu);
      expect(process?.metrics?.memory);
      expect(typeof process?.metrics?.cpu).toBe( 'number');
      expect(typeof process?.metrics?.memory).toBe( 'number');
    });
  });

  describe('event log printing', () => {
    it('should print event log', () => {
      // Add some events
      eventBus.emit(SystemEvents.AGENT_SPAWNED, { agentId: 'test-1', profile: { type: 'test' } });
      eventBus.emit(SystemEvents.TASK_COMPLETED, { taskId: 'task-1' });
      
      // Mock console output
      const originalLog = console.log;
      let logOutput: string[] = [];
      console.log = (...args) => {
        logOutput.push(args.join(' '));
      };
      
      systemMonitor.printEventLog(5);
      
      // Check output contains expected content
      const output = logOutput.join('\n');
      expect(output.includes('Recent System Events')).toBe( true);
      expect(output.includes('Agent spawned')).toBe( true);
      expect(output.includes('Task completed')).toBe( true);
      
      // Restore
      console.log = originalLog;
    });
  });

  describe('system health printing', () => {
    it('should print system health', async () => {
      await processManager.initialize();
      await processManager.startProcess('event-bus');
      
      // Mock console output
      const originalLog = console.log;
      let logOutput: string[] = [];
      console.log = (...args) => {
        logOutput.push(args.join(' '));
      };
      
      systemMonitor.printSystemHealth();
      
      // Check output contains expected content
      const output = logOutput.join('\n');
      expect(output.includes('System Health')).toBe( true);
      expect(output.includes('Status:')).toBe( true);
      expect(output.includes('Uptime:')).toBe( true);
      expect(output.includes('Process Status:')).toBe( true);
      expect(output.includes('System Metrics:')).toBe( true);
      
      // Restore
      console.log = originalLog;
    });

    it('should show recent errors in health output', () => {
      // Add an error event
      eventBus.emit(SystemEvents.SYSTEM_ERROR, { 
        component: 'TestComponent',
        error: new Error('Test error')
      });
      
      // Mock console output
      const originalLog = console.log;
      let logOutput: string[] = [];
      console.log = (...args) => {
        logOutput.push(args.join(' '));
      };
      
      systemMonitor.printSystemHealth();
      
      // Check output contains error section
      const output = logOutput.join('\n');
      expect(output.includes('Recent Errors:')).toBe( true);
      expect(output.includes('TestComponent')).toBe( true);
      
      // Restore
      console.log = originalLog;
    });
  });

  describe('uptime formatting', () => {
    it('should format uptime correctly', () => {
      const formatUptime = systemMonitor['formatUptime'].bind(systemMonitor);
      
      expect(formatUptime(1000)).toBe( '1s');
      expect(formatUptime(60000)).toBe( '1m 0s');
      expect(formatUptime(3600000)).toBe( '1h 0m 0s');
      expect(formatUptime(86400000)).toBe( '1d 0h 0m');
      expect(formatUptime(90061000)).toBe( '1d 1h 1m'); 
    });
  });
});
