/**
 * Test suite for TestCleanup utilities
 * Validates Issue #120 implementation
 * CI trigger: test run
 */

import { TestCleanup, AsyncTestUtils, TestAssertions } from '../test-cleanup';
import { PerformanceTestUtils } from '../performance-test-utils';
import { TestHooks } from '../index';

describe('TestCleanup', () => {
  let cleanup: TestCleanup;

  beforeEach(() => {
    cleanup = new TestCleanup();
  });

  afterEach(async () => {
    if (cleanup) {
      await cleanup.cleanup();
    }
  });

  describe('Timer Management', () => {
    test('should register and cleanup timers', async () => {
      let timerExecuted = false;
      
      cleanup.setTimeout(() => {
        timerExecuted = true;
      }, 100);
      
      expect(cleanup.getStats().timers).toBe(1);
      
      await cleanup.cleanup();
      
      // Wait a bit to ensure timer would have fired if not cleaned up
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(timerExecuted).toBe(false);
      expect(cleanup.getStats().timers).toBe(0);
    });

    test('should register and cleanup intervals', async () => {
      let intervalCount = 0;
      
      cleanup.setInterval(() => {
        intervalCount++;
      }, 50);
      
      expect(cleanup.getStats().intervals).toBe(1);
      
      // Let it run a couple times
      await new Promise(resolve => setTimeout(resolve, 150));
      
      await cleanup.cleanup();
      
      const countAfterCleanup = intervalCount;
      
      // Wait to ensure interval doesn't continue
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(intervalCount).toBe(countAfterCleanup);
      expect(cleanup.getStats().intervals).toBe(0);
    });
  });

  describe('Promise Management', () => {
    test('should track and wait for promises', async () => {
      let promiseResolved = false;
      
      cleanup.registerPromise(
        new Promise<void>(resolve => {
          setTimeout(() => {
            promiseResolved = true;
            resolve();
          }, 100);
        })
      );
      
      expect(cleanup.getStats().promises).toBe(1);
      
      await cleanup.waitForPromises();
      
      expect(promiseResolved).toBe(true);
      expect(cleanup.getStats().promises).toBe(0);
    });

    test('should handle promise timeouts', async () => {
      const promise = cleanup.createTimeoutPromise<string>(
        () => {
          // Never resolve
        },
        100,
        'Test timeout'
      );
      
      await expect(promise).rejects.toThrow('Test timeout');
    });
  });

  describe('Event Listener Management', () => {
    test('should register and cleanup event listeners', async () => {
      const mockTarget = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      } as any;
      
      const listener = () => {};
      
      cleanup.registerEventListener(mockTarget, 'test', listener);
      
      expect(mockTarget.addEventListener).toHaveBeenCalledWith('test', listener);
      expect(cleanup.getStats().eventListeners).toBe(1);
      
      await cleanup.cleanup();
      
      expect(mockTarget.removeEventListener).toHaveBeenCalledWith('test', listener);
      expect(cleanup.getStats().eventListeners).toBe(0);
    });
  });

  describe('Resource Handle Management', () => {
    test('should cleanup handles with close method', async () => {
      const mockHandle = {
        close: jest.fn()
      };
      
      cleanup.registerHandle(mockHandle);
      
      expect(cleanup.getStats().openHandles).toBe(1);
      
      await cleanup.cleanup();
      
      expect(mockHandle.close).toHaveBeenCalled();
      expect(cleanup.getStats().openHandles).toBe(0);
    });

    test('should cleanup handles with destroy method', async () => {
      const mockHandle = {
        destroy: jest.fn()
      };
      
      cleanup.registerHandle(mockHandle);
      
      await cleanup.cleanup();
      
      expect(mockHandle.destroy).toHaveBeenCalled();
    });
  });

  describe('AbortController Management', () => {
    test('should abort controllers during cleanup', async () => {
      const controller = new AbortController();
      cleanup.registerAbortController(controller);
      
      expect(cleanup.getStats().abortControllers).toBe(1);
      expect(controller.signal.aborted).toBe(false);
      
      await cleanup.cleanup();
      
      expect(controller.signal.aborted).toBe(true);
      expect(cleanup.getStats().abortControllers).toBe(0);
    });
  });
});

describe('AsyncTestUtils', () => {
  beforeEach(() => {
    AsyncTestUtils.resetCleanup();
  });

  afterEach(async () => {
    await AsyncTestUtils.getCleanup().cleanup();
  });

  describe('waitFor', () => {
    test('should wait for condition to be true', async () => {
      let condition = false;
      
      // Set condition to true after a short delay
      setTimeout(() => {
        condition = true;
      }, 50);
      
      await AsyncTestUtils.waitFor(() => condition, { timeout: 200, interval: 10 });
      
      expect(condition).toBe(true);
    });

    test('should timeout when condition is not met', async () => {
      await expect(
        AsyncTestUtils.waitFor(() => false, { timeout: 100 })
      ).rejects.toThrow('Condition not met (timeout: 100ms)');
    });
  });

  describe('delay', () => {
    test('should delay execution', async () => {
      const start = Date.now();
      await AsyncTestUtils.delay(100);
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });
  });

  describe('withTimeout', () => {
    test('should resolve when promise completes in time', async () => {
      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve('success'), 50);
      });
      
      const result = await AsyncTestUtils.withTimeout(promise, 100);
      expect(result).toBe('success');
    });

    test('should reject when promise times out', async () => {
      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve('success'), 200);
      });
      
      await expect(
        AsyncTestUtils.withTimeout(promise, 100)
      ).rejects.toThrow('Promise timed out');
    });
  });
});

describe('PerformanceTestUtils', () => {
  beforeEach(() => {
    PerformanceTestUtils.resetCleanup();
  });

  afterEach(async () => {
    await PerformanceTestUtils.getCleanup().cleanup();
  });

  describe('measurePerformance', () => {
    test('should measure execution time and memory', async () => {
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'result';
      };
      
      const { result, metrics } = await PerformanceTestUtils.measurePerformance(operation);
      
      expect(result).toBe('result');
      expect(metrics.duration).toBeGreaterThan(90);
      expect(metrics.operations).toBe(1);
      expect(metrics.throughput).toBeGreaterThan(0);
    });
  });

  describe('benchmark', () => {
    test('should run performance benchmark', async () => {
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return Math.random();
      };
      
      const { results, stats } = await PerformanceTestUtils.benchmark(operation, {
        iterations: 10,
        warmupIterations: 2
      });
      
      expect(results).toHaveLength(10);
      expect(stats.operations).toBe(10);
      expect(stats.mean).toBeGreaterThan(0);
      expect(stats.min).toBeGreaterThan(0);
      expect(stats.max).toBeGreaterThanOrEqual(stats.min);
      expect(stats.throughput).toBeGreaterThan(0);
    });
  });

  describe('profile', () => {
    test('should provide performance profile with recommendations', async () => {
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'result';
      };
      
      const { result, benchmark, recommendations } = await PerformanceTestUtils.profile(operation, {
        iterations: 5
      });
      
      expect(result).toBe('result');
      expect(benchmark.operations).toBe(5);
      expect(Array.isArray(recommendations)).toBe(true);
    });
  });
});

describe('TestHooks', () => {
  test('should create isolated test environment', async () => {
    const result = await TestHooks.isolatedTest(async (context) => {
      expect(context.testId).toBeDefined();
      expect(context.cleanup).toBeDefined();
      expect(context.performance).toBeDefined();
      
      // Register a timer that should be cleaned up
      context.cleanup.setTimeout(() => {}, 1000);
      
      return 'test-result';
    });
    
    expect(result).toBe('test-result');
  });

  test('should wrap test with cleanup', async () => {
    const testFn = TestHooks.wrapTest(async (context) => {
      expect(context.testId).toBeDefined();
      
      // Register resources that should be cleaned up
      context.cleanup.setTimeout(() => {}, 1000);
    });
    
    await testFn();
  });

  test('should perform memory leak detection', async () => {
    const result = await TestHooks.memoryLeakTest(async () => {
      // Create some objects but don't hold references
      for (let i = 0; i < 100; i++) {
        const obj = { data: new Array(1000).fill(i) };
        // Use obj to avoid warning
        obj.data.length;
      }
      return 'memory-test-result';
    }, {
      iterations: 10,
      memoryThreshold: 1024 * 1024 * 10 // 10MB
    });
    
    expect(result.result).toBe('memory-test-result');
    expect(result.iterations).toBe(10);
    expect(typeof result.memoryLeak).toBe('boolean');
    expect(typeof result.memoryIncrease).toBe('number');
  });
});

describe('TestAssertions', () => {
  test('should assert async throws', async () => {
    await TestAssertions.assertThrowsAsync(
      async () => {
        throw new Error('Test error');
      },
      'Test error'
    );
  });

  test('should assert completion within timeout', async () => {
    const result = await TestAssertions.assertCompletesWithin(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'completed';
      },
      100
    );
    
    expect(result).toBe('completed');
  });

  test('should assert value in range', () => {
    TestAssertions.assertInRange(50, 0, 100);
    
    expect(() => {
      TestAssertions.assertInRange(150, 0, 100);
    }).toThrow('Expected 150 to be between 0 and 100');
  });
});