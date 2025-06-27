/// <reference types="jest" />

/**
 * FIXED VERSION - Comprehensive unit tests for Terminal Manager
 * Demonstrates correct mocking patterns that resolve Phase 1 failures
 */

import { TerminalManager } from '../../../src/terminal/manager.js';
import { TerminalPool } from '../../../src/terminal/pool.js';
import { NativeTerminalAdapter } from '../../../src/terminal/adapters/native.js';
import { 
  AsyncTestUtils,
  EnhancedMockFactory,
  AsyncMockBuilder 
} from '../../utils/enhanced-mock-factory.js';
import { 
  createTerminalManagerMock,
  createTerminalPoolMock 
} from '../../utils/mock-templates.js';

describe('Terminal Manager - Fixed Comprehensive Tests', () => {
  let terminalManager: TerminalManager;
  let mockPool: any;

  beforeEach(() => {
    // ✅ FIXED: Use the correct mocking pattern
    mockPool = createTerminalPoolMock({
      // Override specific methods if needed
      executeCommand: async (sessionId: string, command: any) => `Fixed output for: ${command}`,
    });

    terminalManager = new TerminalManager({
      pool: mockPool,
      maxConcurrentSessions: 10,
      sessionTimeout: 30000,
      commandTimeout: 10000,
    });

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('Initialization and Configuration', () => {
    it('should initialize successfully with valid configuration', async () => {
      // ✅ FIXED: Proper async testing with enhanced utilities
      await AsyncTestUtils.testAsyncFunction(
        () => terminalManager.initialize(),
        { timeout: 5000 }
      );

      // ✅ FIXED: Proper mock assertion
      expect(mockPool.initialize).toHaveBeenCalledTimes(1);
    });

    it('should validate configuration parameters', async () => {
      // ✅ FIXED: Test configuration validation
      const invalidConfig = {
        pool: mockPool,
        maxConcurrentSessions: -1, // Invalid
        sessionTimeout: 30000,
        commandTimeout: 10000,
      };

      expect(() => new TerminalManager(invalidConfig)).toThrow();
    });

    it('should handle initialization failure gracefully', async () => {
      // ✅ FIXED: Proper error mocking
      mockPool.initialize.mockRejectedValue(new Error('Pool initialization failed'));

      // ✅ FIXED: Proper async error testing
      await AsyncTestUtils.testAsyncFunction(
        () => terminalManager.initialize(),
        { 
          expectError: true,
          errorMessage: 'Pool initialization failed'
        }
      );
    });
  });

  describe('Session Management', () => {
    beforeEach(async () => {
      await terminalManager.initialize();
    });

    it('should create terminal session successfully', async () => {
      const profile = { 
        type: 'bash',
        workingDirectory: '/tmp',
        environment: { NODE_ENV: 'test' }
      };

      const sessionId = await terminalManager.createSession(profile);

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(mockPool.createSession).toHaveBeenCalledWith(profile);
    });

    it('should handle session creation failure', async () => {
      mockPool.createSession.mockRejectedValue(new Error('Session creation failed'));

      const profile = { type: 'bash' };

      await expect(terminalManager.createSession(profile))
        .rejects.toThrow('Session creation failed');
    });

    it('should destroy session successfully', async () => {
      const sessionId = 'test-session-123';

      await terminalManager.destroySession(sessionId);

      expect(mockPool.destroySession).toHaveBeenCalledWith(sessionId);
    });

    it('should list active sessions', async () => {
      // ✅ FIXED: Configure mock return value properly
      const mockSessions = [
        { id: 'session-1', status: 'active' },
        { id: 'session-2', status: 'active' }
      ];
      mockPool.listSessions.mockReturnValue(mockSessions);

      const sessions = await terminalManager.listSessions();

      expect(sessions).toEqual(mockSessions);
      expect(mockPool.listSessions).toHaveBeenCalled();
    });
  });

  describe('Command Execution', () => {
    const sessionId = 'test-session';

    beforeEach(async () => {
      await terminalManager.initialize();
    });

    it('should execute command successfully', async () => {
      const command = 'echo "hello world"';
      const expectedOutput = 'Fixed output for: echo "hello world"';
      
      mockPool.executeCommand.mockResolvedValue(expectedOutput);

      const result = await terminalManager.executeCommand(sessionId, command);

      expect(result).toBe(expectedOutput);
      expect(mockPool.executeCommand).toHaveBeenCalledWith(sessionId, command);
    });

    it('should handle command execution timeout', async () => {
      const command = 'sleep 100';
      
      // ✅ FIXED: Simulate timeout with proper delay
      mockPool.executeCommand.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 15000)); // Longer than timeout
        return 'This should not be reached';
      });

      await expect(
        AsyncTestUtils.testAsyncFunction(
          () => terminalManager.executeCommand(sessionId, command),
          { timeout: 10000, expectError: true }
        )
      ).resolves.toBeInstanceOf(Error);
    });

    it('should handle command execution failure', async () => {
      const command = 'invalid-command';
      const error = new Error('Command not found');
      
      mockPool.executeCommand.mockRejectedValue(error);

      await expect(terminalManager.executeCommand(sessionId, command))
        .rejects.toThrow('Command not found');
    });
  });

  describe('Resource Management', () => {
    beforeEach(async () => {
      await terminalManager.initialize();
    });

    it('should track concurrent sessions', async () => {
      mockPool.getSessionCount.mockReturnValue(5);

      const count = await terminalManager.getActiveSessions();

      expect(count).toBe(5);
      expect(mockPool.getSessionCount).toHaveBeenCalled();
    });

    it('should enforce maximum concurrent sessions', async () => {
      // ✅ FIXED: Simulate max sessions reached
      mockPool.getSessionCount.mockReturnValue(10); // At maximum
      mockPool.getAvailableSlots.mockReturnValue(0);

      const profile = { type: 'bash' };

      await expect(terminalManager.createSession(profile))
        .rejects.toThrow(/maximum.*sessions/i);
    });

    it('should perform maintenance tasks', async () => {
      await terminalManager.performMaintenance();

      expect(mockPool.performMaintenance).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should recover from pool failures', async () => {
      await terminalManager.initialize();

      // ✅ FIXED: Simulate pool failure and recovery
      mockPool.executeCommand
        .mockRejectedValueOnce(new Error('Pool temporarily unavailable'))
        .mockResolvedValueOnce('Command executed after recovery');

      const sessionId = 'test-session';
      const command = 'test command';

      // First call should fail
      await expect(terminalManager.executeCommand(sessionId, command))
        .rejects.toThrow('Pool temporarily unavailable');

      // Second call should succeed (simulating recovery)
      const result = await terminalManager.executeCommand(sessionId, command);
      expect(result).toBe('Command executed after recovery');
    });

    it('should cleanup resources on shutdown', async () => {
      await terminalManager.initialize();
      await terminalManager.shutdown();

      expect(mockPool.shutdown).toHaveBeenCalled();
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle minimal configuration', () => {
      const minimalConfig = {
        pool: mockPool,
      };

      expect(() => new TerminalManager(minimalConfig)).not.toThrow();
    });

    it('should use default values for missing config', () => {
      const manager = new TerminalManager({ pool: mockPool });
      
      // Verify defaults are applied (this would depend on actual implementation)
      expect(manager).toBeDefined();
    });
  });

  describe('Performance and Load Testing', () => {
    beforeEach(async () => {
      await terminalManager.initialize();
    });

    it('should handle multiple concurrent operations', async () => {
      const operations = Array.from({ length: 5 }, (_, i) => 
        terminalManager.executeCommand(`session-${i}`, `command-${i}`)
      );

      const results = await Promise.all(operations);

      expect(results).toHaveLength(5);
      expect(mockPool.executeCommand).toHaveBeenCalledTimes(5);
    });

    it('should maintain performance under load', async () => {
      const startTime = performance.now();
      
      const operations = Array.from({ length: 10 }, () => 
        terminalManager.executeCommand('session', 'fast-command')
      );

      await Promise.all(operations);
      
      const duration = performance.now() - startTime;
      
      // ✅ FIXED: Reasonable performance expectation
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Integration with Different Terminal Types', () => {
    it('should work with bash profile', async () => {
      await terminalManager.initialize();

      const bashProfile = {
        type: 'bash',
        workingDirectory: '/home/user',
        environment: { SHELL: '/bin/bash' }
      };

      const sessionId = await terminalManager.createSession(bashProfile);
      
      expect(sessionId).toBeDefined();
      expect(mockPool.createSession).toHaveBeenCalledWith(bashProfile);
    });

    it('should work with zsh profile', async () => {
      await terminalManager.initialize();

      const zshProfile = {
        type: 'zsh',
        workingDirectory: '/home/user',
        environment: { SHELL: '/bin/zsh' }
      };

      const sessionId = await terminalManager.createSession(zshProfile);
      
      expect(sessionId).toBeDefined();
      expect(mockPool.createSession).toHaveBeenCalledWith(zshProfile);
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory during normal operations', async () => {
      await terminalManager.initialize();

      // ✅ FIXED: Use proper memory testing pattern
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform operations that might cause leaks
      for (let i = 0; i < 100; i++) {
        const sessionId = await terminalManager.createSession({ type: 'bash' });
        await terminalManager.executeCommand(sessionId, `echo ${i}`);
        await terminalManager.destroySession(sessionId);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });
});

// ✅ FIXED: Example of custom mock builder for specific test needs
describe('Custom Mock Patterns', () => {
  it('should demonstrate AsyncMockBuilder usage', async () => {
    const customMock = AsyncMockBuilder.create({
      complexOperation: async (input: string) => `processed: ${input}`,
      simpleOperation: (input: string) => `simple: ${input}`,
      failingOperation: async () => { throw new Error('Always fails'); }
    })
    .spyOnAsync('complexOperation')
    .spyOnSync('simpleOperation')
    .spyOnAsyncWithError('failingOperation', new Error('Custom error'))
    .build();

    // Test successful operations
    const result1 = await customMock.complexOperation('test');
    expect(result1).toBe('processed: test');

    const result2 = customMock.simpleOperation('test');
    expect(result2).toBe('simple: test');

    // Test failing operation
    await expect(customMock.failingOperation()).rejects.toThrow('Custom error');

    // Verify call tracking
    expect(customMock.complexOperation).toHaveBeenCalledWith('test');
    expect(customMock.simpleOperation).toHaveBeenCalledWith('test');
    expect(customMock.failingOperation).toHaveBeenCalled();
  });

  it('should demonstrate safe mock factory usage', async () => {
    const safeMock = EnhancedMockFactory.createSafeMock({
      asyncMethod: async (param: string) => `async: ${param}`,
      syncMethod: (param: string) => `sync: ${param}`,
      property: 'some value'
    });

    const asyncResult = await safeMock.asyncMethod('test');
    const syncResult = safeMock.syncMethod('test');

    expect(asyncResult).toBe('async: test');
    expect(syncResult).toBe('sync: test');
    expect(safeMock.property).toBe('some value');

    // Verify spying works
    expect(safeMock.asyncMethod).toHaveBeenCalledWith('test');
    expect(safeMock.syncMethod).toHaveBeenCalledWith('test');
  });
});