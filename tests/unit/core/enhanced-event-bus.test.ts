/// <reference types="jest" />

/**
 * Enhanced comprehensive unit tests for EventBus
 */

import { EventBus } from '../../../src/core/event-bus.js';
import { 
  AsyncTestUtils, 
  MemoryTestUtils, 
  PerformanceTestUtils,
  TestAssertions,
  TestDataGenerator 
} from '../../utils/test-utils.js';
import { generateEventBusEvents, generateEdgeCaseData } from '../../fixtures/generators.js';
import { setupTestEnv, cleanupTestEnv, TEST_CONFIG } from '../../test.config.js';

describe('EventBus - Enhanced Tests', () => {
  let eventBus: EventBus;
  let fakeTime: FakeTime;

  beforeEach(() => {
    setupTestEnv();
    eventBus = new EventBus();
    fakeTime = jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await cleanupTestEnv();
  });

  describe('Basic Event Operations', () => {
    it('should emit and handle events correctly', () => {
      const handler = jest.spyOn();
      
      eventBus.on('test.event', handler);
      eventBus.emit('test.event', { message: 'test data' });
      
      expect(handler.calls.length).toBe(1);
      expect(handler.calls[0].args[0]).toEqual({ message: 'test data' });
    });

    it('should handle multiple handlers for same event', () => {
      const handler1 = jest.spyOn();
      const handler2 = jest.spyOn();
      const handler3 = jest.spyOn();
      
      eventBus.on('multi.event', handler1);
      eventBus.on('multi.event', handler2);
      eventBus.on('multi.event', handler3);
      
      eventBus.emit('multi.event', { data: 'multi' });
      
      expect(handler1.calls.length).toBe( 1);
      expect(handler2.calls.length).toBe( 1);
      expect(handler3.calls.length).toBe( 1);
      
      [handler1, handler2, handler3].forEach(handler => {
        expect(handler.calls[0].args[0]).toEqual({ data: 'multi' });
      });
    });

    it('should handle wildcard events', () => {
      const wildHandler = jest.spyOn();
      const specificHandler = jest.spyOn();
      
      eventBus.on('task.*', wildHandler);
      eventBus.on('task.completed', specificHandler);
      
      eventBus.emit('task.completed', { taskId: '123' });
      eventBus.emit('task.started', { taskId: '456' });
      
      expect(wildHandler.calls.length).toBe( 2);
      expect(specificHandler.calls.length).toBe( 1);
    });

    it('should handle once listeners correctly', () => {
      const handler = jest.spyOn();
      
      eventBus.once('once.event', handler);
      
      eventBus.emit('once.event', { first: true });
      eventBus.emit('once.event', { second: true });
      
      expect(handler.calls.length).toBe(1);
      expect(handler.calls[0].args[0]).toEqual({ first: true });
    });

    it('should remove event handlers correctly', () => {
      const handler = jest.spyOn();
      
      eventBus.on('remove.event', handler);
      eventBus.emit('remove.event', { before: true });
      
      eventBus.off('remove.event', handler);
      eventBus.emit('remove.event', { after: true });
      
      expect(handler.calls.length).toBe(1);
      expect(handler.calls[0].args[0]).toEqual({ before: true });
    });

    it('should handle removing non-existent handlers gracefully', () => {
      const handler = jest.spyOn();
      
      // Should not throw when removing non-existent handler
      eventBus.off('nonexistent.event', handler);
      eventBus.off('test.event', handler); // Handler not registered
      
      // Event bus should still work normally
      eventBus.on('test.event', handler);
      eventBus.emit('test.event', { data: 'test' });
      
      expect(handler.calls.length).toBe(1);
    });
  });

  describe('Event Patterns and Namespaces', () => {
    it('should handle hierarchical event patterns', () => {
      const rootHandler = jest.spyOn();
      const branchHandler = jest.spyOn();
      const leafHandler = jest.spyOn();
      
      eventBus.on('app.*', rootHandler);
      eventBus.on('app.module.*', branchHandler);
      eventBus.on('app.module.component.action', leafHandler);
      
      eventBus.emit('app.module.component.action', { data: 'leaf' });
      eventBus.emit('app.module.other', { data: 'branch' });
      eventBus.emit('app.other', { data: 'root' });
      
      expect(rootHandler.calls.length).toBe( 3);
      expect(branchHandler.calls.length).toBe( 2);
      expect(leafHandler.calls.length).toBe( 1);
    });

    it('should handle complex pattern matching', () => {
      const patterns = [
        'user.*.created',
        'user.*.updated',
        'user.admin.*',
        'system.*.error',
        'system.*.warning',
      ];
      
      const handlers = patterns.map(() => jest.spyOn());
      patterns.forEach((pattern, i) => {
        eventBus.on(pattern, handlers[i]);
      });
      
      const testEvents = [
        'user.profile.created',
        'user.profile.updated',
        'user.admin.login',
        'user.admin.logout',
        'system.database.error',
        'system.network.warning',
        'other.event', // Should not match any pattern
      ];
      
      testEvents.forEach(event => {
        eventBus.emit(event, { event });
      });
      
      // Verify pattern matches
      expect(handlers[0].calls.length).toBe(1); // user.*.created
      expect(handlers[1].calls.length).toBe(1); // user.*.updated
      expect(handlers[2].calls.length).toBe(2); // user.admin.*
      expect(handlers[3].calls.length).toBe(1); // system.*.error
      expect(handlers[4].calls.length).toBe(1); // system.*.warning
    });

    it('should handle event namespaces correctly', () => {
      const namespaceHandler = jest.spyOn();
      
      eventBus.on('namespace:test.*', namespaceHandler);
      
      eventBus.emit('namespace:test.event1', { data: 1 });
      eventBus.emit('namespace:test.event2', { data: 2 });
      eventBus.emit('namespace:other.event', { data: 3 });
      eventBus.emit('test.event', { data: 4 });
      
      expect(namespaceHandler.calls.length).toBe( 2);
    });
  });

  describe('Event Priority and Ordering', () => {
    it('should handle event priority correctly', () => {
      const callOrder: number[] = [];
      
      const lowPriorityHandler = jest.spyOn(() => callOrder.push(1));
      const highPriorityHandler = jest.spyOn(() => callOrder.push(2));
      const normalPriorityHandler = jest.spyOn(() => callOrder.push(3));
      
      eventBus.on('priority.event', lowPriorityHandler, { priority: 1 });
      eventBus.on('priority.event', highPriorityHandler, { priority: 10 });
      eventBus.on('priority.event', normalPriorityHandler, { priority: 5 });
      
      eventBus.emit('priority.event', {});
      
      // Should be called in priority order: high (10), normal (5), low (1)
      expect(callOrder).toEqual([2, 3, 1]);
    });

    it('should handle async handlers in order', async () => {
      const callOrder: number[] = [];
      
      const handler1 = jest.fn(async () => {
        await AsyncTestUtils.delay(10);
        callOrder.push(1);
      });
      
      const handler2 = jest.fn(async () => {
        await AsyncTestUtils.delay(5);
        callOrder.push(2);
      });
      
      const handler3 = jest.spyOn(() => {
        callOrder.push(3);
      });
      
      eventBus.on('async.event', handler1);
      eventBus.on('async.event', handler2);
      eventBus.on('async.event', handler3);
      
      await eventBus.emitAsync('async.event', {});
      
      // All handlers should complete, order depends on implementation
      expect(handler1.calls.length).toBe( 1);
      expect(handler2.calls.length).toBe( 1);
      expect(handler3.calls.length).toBe( 1);
      expect(callOrder.length).toBe( 3);
    });

    it('should handle handler errors gracefully', () => {
      const errorHandler = jest.spyOn(() => {
        throw new Error('Handler error');
      });
      
      const successHandler = jest.spyOn();
      
      eventBus.on('error.event', errorHandler);
      eventBus.on('error.event', successHandler);
      
      // Should not throw, but continue with other handlers
      eventBus.emit('error.event', {});
      
      expect(errorHandler.calls.length).toBe( 1);
      expect(successHandler.calls.length).toBe( 1);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle high-frequency events efficiently', async () => {
      const handler = jest.spyOn();
      eventBus.on('high.frequency', handler);
      
      const { stats } = await PerformanceTestUtils.benchmark(
        () => {
          eventBus.emit('high.frequency', { timestamp: Date.now() });
        },
        { iterations: 10000, concurrency: 1 }
      );
      
      expect(handler.calls.length).toBe( 10000);
      TestAssertions.assertInRange(stats.mean, 0, 1); // Should be very fast
      
      console.log(`High-frequency event performance: ${stats.mean.toFixed(4)}ms per event`);
    });

    it('should handle many concurrent handlers efficiently', async () => {
      const handlerCount = 1000;
      const handlers = Array.from({ length: handlerCount }, () => jest.spyOn());
      
      handlers.forEach(handler => {
        eventBus.on('many.handlers', handler);
      });
      
      const { stats } = await PerformanceTestUtils.benchmark(
        () => {
          eventBus.emit('many.handlers', { data: 'test' });
        },
        { iterations: 100 }
      );
      
      // Verify all handlers were called
      handlers.forEach(handler => {
        expect(handler.calls.length).toBe( 100);
      });
      
      TestAssertions.assertInRange(stats.mean, 0, 50); // Should complete within 50ms
      
      console.log(`Many handlers performance: ${stats.mean.toFixed(2)}ms for ${handlerCount} handlers`);
    });

    it('should handle event bus under memory pressure', async () => {
      const events = generateEventBusEvents(10000);
      const handler = jest.spyOn();
      
      eventBus.on('*', handler);
      
      const { leaked } = await MemoryTestUtils.checkMemoryLeak(async () => {
        // Emit many events
        for (const event of events) {
          eventBus.emit(event.type, event.data);
        }
        
        // Clear handlers
        eventBus.removeAllListeners();
      });
      
      expect(leaked).toBe( false);
      expect(handler.calls.length).toBe( 10000);
    });

    it('should handle load testing scenario', async () => {
      const handler = jest.spyOn();
      eventBus.on('load.test', handler);
      
      const results = await PerformanceTestUtils.loadTest(
        () => {
          eventBus.emit('load.test', { 
            timestamp: Date.now(),
            data: TestDataGenerator.randomString(100) 
          });
        },
        {
          duration: 5000, // 5 seconds
          maxConcurrency: 10,
          requestsPerSecond: 1000,
        }
      );
      
      expect(results.failedRequests).toBe( 0);
      TestAssertions.assertInRange(results.successfulRequests, 4000, 6000); // ~5000 requests
      TestAssertions.assertInRange(results.averageResponseTime, 0, 5);
      
      console.log(`Load test: ${results.successfulRequests} events/sec, avg=${results.averageResponseTime.toFixed(3)}ms`);
    });
  });

  describe('Memory Management', () => {
    it('should clean up removed handlers', () => {
      const handlers = Array.from({ length: 100 }, () => jest.spyOn());
      
      // Add many handlers
      handlers.forEach(handler => {
        eventBus.on('cleanup.test', handler);
      });
      
      // Remove half of them
      handlers.slice(0, 50).forEach(handler => {
        eventBus.off('cleanup.test', handler);
      });
      
      eventBus.emit('cleanup.test', {});
      
      // Only remaining handlers should be called
      handlers.slice(0, 50).forEach(handler => {
        expect(handler.calls.length).toBe( 0);
      });
      
      handlers.slice(50).forEach(handler => {
        expect(handler.calls.length).toBe(1);
      });
    });

    it('should handle removeAllListeners correctly', () => {
      const handlers = Array.from({ length: 10 }, () => jest.spyOn());
      
      handlers.forEach((handler, i) => {
        eventBus.on(`test.${i}`, handler);
      });
      
      eventBus.removeAllListeners();
      
      // Emit events - no handlers should be called
      for (let i = 0; i < 10; i++) {
        eventBus.emit(`test.${i}`, {});
      }
      
      handlers.forEach(handler => {
        expect(handler.calls.length).toBe( 0);
      });
    });

    it('should handle removeAllListeners for specific event', () => {
      const specificHandlers = Array.from({ length: 5 }, () => jest.spyOn());
      const otherHandlers = Array.from({ length: 5 }, () => jest.spyOn());
      
      specificHandlers.forEach(handler => {
        eventBus.on('specific.event', handler);
      });
      
      otherHandlers.forEach(handler => {
        eventBus.on('other.event', handler);
      });
      
      eventBus.removeAllListeners('specific.event');
      
      eventBus.emit('specific.event', {});
      eventBus.emit('other.event', {});
      
      specificHandlers.forEach(handler => {
        expect(handler.calls.length).toBe( 0);
      });
      
      otherHandlers.forEach(handler => {
        expect(handler.calls.length).toBe(1);
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid event names gracefully', () => {
      const handler = jest.spyOn();
      
      const invalidNames = [
        '',
        null,
        undefined,
        123,
        {},
        [],
      ];
      
      invalidNames.forEach(invalidName => {
        // Should not throw when registering invalid event names
        try {
          eventBus.on(invalidName as any, handler);
          eventBus.emit(invalidName as any, {});
        } catch (error) {
          // Expected for truly invalid names
        }
      });
      
      // Event bus should still work normally
      eventBus.on('valid.event', handler);
      eventBus.emit('valid.event', {});
      
      expect(handler.calls.length >= 1).toBe( true);
    });

    it('should handle edge case data types', () => {
      const handler = jest.spyOn();
      eventBus.on('edge.cases', handler);
      
      const edgeCases = generateEdgeCaseData();
      
      // Test with various edge case data
      Object.values(edgeCases).forEach(category => {
        Object.values(category).forEach(value => {
          eventBus.emit('edge.cases', value);
        });
      });
      
      // Should handle all edge cases without crashing
      TestAssertions.assertInRange(handler.calls.length, 10, 50);
    });

    it('should handle recursive event emission', () => {
      let emissionCount = 0;
      const maxEmissions = 5;
      
      const recursiveHandler = jest.spyOn(() => {
        emissionCount++;
        if (emissionCount < maxEmissions) {
          eventBus.emit('recursive.event', { count: emissionCount });
        }
      });
      
      eventBus.on('recursive.event', recursiveHandler);
      eventBus.emit('recursive.event', { count: 0 });
      
      expect(recursiveHandler.calls.length).toBe( maxEmissions);
      expect(emissionCount).toBe( maxEmissions);
    });

    it('should handle handler that modifies handler list', () => {
      const handlers = Array.from({ length: 5 }, () => jest.spyOn());
      
      // Handler that removes other handlers
      const disruptiveHandler = jest.spyOn(() => {
        handlers.forEach(handler => {
          eventBus.off('disruptive.event', handler);
        });
      });
      
      eventBus.on('disruptive.event', disruptiveHandler);
      handlers.forEach(handler => {
        eventBus.on('disruptive.event', handler);
      });
      
      eventBus.emit('disruptive.event', {});
      
      // Disruptive handler should have been called
      expect(disruptiveHandler.calls.length).toBe( 1);
      
      // Some or all of the other handlers may have been called
      // depending on implementation details
      const totalCalls = handlers.reduce((sum, handler) => sum + handler.calls.length, 0);
      TestAssertions.assertInRange(totalCalls, 0, 5);
    });

    it('should handle async handler errors', async () => {
      const errorHandler = jest.fn(async () => {
        await AsyncTestUtils.delay(10);
        throw new Error('Async handler error');
      });
      
      const successHandler = jest.fn(async () => {
        await AsyncTestUtils.delay(5);
        return 'success';
      });
      
      eventBus.on('async.error', errorHandler);
      eventBus.on('async.error', successHandler);
      
      // Should not throw, even with async errors
      await eventBus.emitAsync('async.error', {});
      
      expect(errorHandler.calls.length).toBe( 1);
      expect(successHandler.calls.length).toBe( 1);
    });

    it('should handle timeout for slow async handlers', async () => {
      const slowHandler = jest.fn(async () => {
        await AsyncTestUtils.delay(5000); // 5 seconds
        return 'slow result';
      });
      
      const fastHandler = jest.fn(async () => {
        await AsyncTestUtils.delay(10);
        return 'fast result';
      });
      
      eventBus.on('timeout.test', slowHandler);
      eventBus.on('timeout.test', fastHandler);
      
      // Should timeout and continue with other handlers
      await TestAssertions.assertCompletesWithin(
        () => eventBus.emitAsync('timeout.test', {}, { timeout: 1000 }),
        2000
      );
      
      expect(slowHandler.calls.length).toBe( 1);
      expect(fastHandler.calls.length).toBe( 1);
    });
  });

  describe('Event History and Debugging', () => {
    it('should track event history when enabled', () => {
      eventBus.enableHistory(100); // Keep last 100 events
      
      const events = Array.from({ length: 50 }, (_, i) => ({
        name: `history.event.${i}`,
        data: { index: i },
      }));
      
      events.forEach(event => {
        eventBus.emit(event.name, event.data);
      });
      
      const history = eventBus.getEventHistory();
      expect(history.length).toBe( 50);
      
      // Most recent event should be last
      expect(history[49].event).toBe( 'history.event.49');
      expect(history[49].data).toEqual({ index: 49 });
    });

    it('should limit event history size', () => {
      eventBus.enableHistory(10); // Keep only last 10 events
      
      // Emit 20 events
      for (let i = 0; i < 20; i++) {
        eventBus.emit(`limited.history.${i}`, { index: i });
      }
      
      const history = eventBus.getEventHistory();
      expect(history.length).toBe( 10);
      
      // Should contain only the last 10 events
      expect(history[0].event).toBe( 'limited.history.10');
      expect(history[9].event).toBe( 'limited.history.19');
    });

    it('should provide event statistics', () => {
      const handler = jest.spyOn();
      eventBus.on('*', handler);
      
      // Emit various events
      eventBus.emit('stats.event.1', {});
      eventBus.emit('stats.event.2', {});
      eventBus.emit('stats.event.1', {}); // Duplicate
      eventBus.emit('other.event', {});
      
      const stats = eventBus.getEventStats();
      
      expect(typeof stats.totalEvents).toBe( 'number');
      expect(typeof stats.uniqueEventTypes).toBe( 'number');
      expect(typeof stats.totalHandlers).toBe( 'number');
      
      expect(stats.totalEvents >= 4).toBe( true);
      expect(stats.uniqueEventTypes >= 3).toBe( true);
    });
  });
});
