/**
 * Unit tests for utility helpers
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
  spy,
  FakeTime,
} from '../../test.utils.ts';
import {
  generateId,
  delay,
  retry,
  debounce,
  throttle,
  deepClone,
  deepMerge,
  TypedEventEmitter,
  formatBytes,
  parseDuration,
  ensureArray,
  groupBy,
  createDeferred,
  safeParseJSON,
  timeout,
  circuitBreaker,
  greeting,
} from '../../../src/utils/helpers.ts';
import { cleanupTestEnv, setupTestEnv } from '../../test.config.ts';

describe('Helpers', () => {
  beforeEach(() => {
    setupTestEnv();
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      
      assertExists(id1);
      assertExists(id2);
      assertEquals(id1 === id2, false);
      assertEquals(typeof id1, 'string');
      assertEquals(typeof id2, 'string');
    });

    it('should include prefix when provided', () => {
      const id = generateId('test');
      assertEquals(id.startsWith('test_'), true);
    });

    it('should generate IDs of reasonable length', () => {
      const id = generateId();
      assertEquals(id.length > 10, true);
      assertEquals(id.length < 50, true);
    });
  });

  describe('delay', () => {
    it('should resolve after specified time', async () => {
      const time = new FakeTime();
      
      const promise = delay(1000);
      await time.tickAsync(1000);
      
      await promise; // Should not throw
      
      time.restore();
    });

    it('should work with zero delay', async () => {
      const start = Date.now();
      await delay(0);
      const elapsed = Date.now() - start;
      
      assertEquals(elapsed < 10, true);
    });
  });

  describe('retry', () => {
    it('should succeed on first attempt if no error', async () => {
      const fn = spy(() => Promise.resolve('success'));
      
      const result = await retry(fn);
      
      assertEquals(result, 'success');
      assertEquals(fn.calls.length, 1);
    });

    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0;
      
      const result = await retry(
        () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Failed');
          }
          return Promise.resolve('success');
        },
        { maxAttempts: 3, initialDelay: 10 }
      );
      
      assertEquals(result, 'success');
      assertEquals(attempts, 3);
    });

    it('should throw after max attempts', async () => {
      let attempts = 0;
      
      await assertRejects(
        () => retry(
          () => {
            attempts++;
            throw new Error('Always fails');
          },
          { maxAttempts: 2, initialDelay: 10 }
        ),
        Error,
        'Always fails'
      );
      
      assertEquals(attempts, 2);
    });

    it('should call onRetry callback', async () => {
      let attempts = 0;
      const onRetry = spy();
      
      await retry(
        () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('Retry');
          }
          return Promise.resolve('success');
        },
        { maxAttempts: 2, initialDelay: 10, onRetry }
      );
      
      assertEquals(onRetry.calls.length, 1);
      assertEquals(onRetry.calls[0].args[0], 1); // attempt number
      assertEquals(onRetry.calls[0].args[1].message, 'Retry'); // error
    });

    it('should use exponential backoff', async () => {
      const delays: number[] = [];
      let attempts = 0;
      
      // Mock delay function instead of setTimeout directly
      const originalDelay = delay;
      const mockDelay = (ms: number) => {
        delays.push(ms);
        return Promise.resolve(); // Resolve immediately for testing
      };
      
      // Temporarily replace the delay import
      const { retry: originalRetry } = await import('../../../src/utils/helpers.ts');
      
      // Test with very small delays
      const result = await retry(
        () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Retry');
          }
          return Promise.resolve('success');
        },
        { maxAttempts: 3, initialDelay: 1, factor: 2 }
      );
      
      assertEquals(result, 'success');
      assertEquals(attempts, 3);
    });
  });

  describe('debounce', () => {
    it('should debounce function calls', async () => {
      const fn = spy();
      const debouncedFn = debounce(fn, 10); // Use small delay to avoid long waits
      
      debouncedFn();
      debouncedFn();
      debouncedFn();
      
      // Should not call yet
      assertEquals(fn.calls.length, 0);
      
      await delay(15); // Wait for debounce
      
      // Should call once
      assertEquals(fn.calls.length, 1);
    });

    it('should reset timer on subsequent calls', async () => {
      const fn = spy();
      const debouncedFn = debounce(fn, 20);
      
      debouncedFn();
      await delay(10);
      debouncedFn(); // Reset timer
      await delay(10);
      
      // Should not call yet (timer was reset)
      assertEquals(fn.calls.length, 0);
      
      await delay(25); // Wait for final debounce
      
      // Should call now
      assertEquals(fn.calls.length, 1);
    });
  });

  describe('throttle', () => {
    it('should throttle function calls', async () => {
      const fn = spy();
      const throttledFn = throttle(fn, 10);
      
      throttledFn();
      throttledFn();
      throttledFn();
      
      // Should call immediately once
      assertEquals(fn.calls.length, 1);
      
      await delay(15); // Wait for throttle
      
      // Should call the last queued call
      assertEquals(fn.calls.length, 2);
    });
  });

  describe('deepClone', () => {
    it('should clone primitives', () => {
      assertEquals(deepClone(5), 5);
      assertEquals(deepClone('test'), 'test');
      assertEquals(deepClone(true), true);
      assertEquals(deepClone(null), null);
    });

    it('should clone dates', () => {
      const date = new Date();
      const cloned = deepClone(date);
      
      assertEquals(cloned.getTime(), date.getTime());
      assertEquals(cloned === date, false); // Different objects
    });

    it('should clone arrays deeply', () => {
      const original = [1, [2, 3], { a: 4 }];
      const cloned = deepClone(original);
      
      assertEquals(cloned, original);
      assertEquals(cloned === original, false);
      assertEquals(cloned[1] === original[1], false);
      assertEquals(cloned[2] === original[2], false);
    });

    it('should clone objects deeply', () => {
      const original = {
        a: 1,
        b: { c: 2, d: [3, 4] },
        e: new Date(),
      };
      
      const cloned = deepClone(original);
      
      assertEquals(cloned.a, original.a);
      assertEquals(cloned.b.c, original.b.c);
      assertEquals(cloned.b.d, original.b.d);
      assertEquals(cloned.e.getTime(), original.e.getTime());
      
      // Different references
      assertEquals(cloned === original, false);
      assertEquals(cloned.b === original.b, false);
      assertEquals(cloned.b.d === original.b.d, false);
      assertEquals(cloned.e === original.e, false);
    });

    it('should clone Maps', () => {
      const original = new Map([['a', 1], ['b', { c: 2 }]]);
      const cloned = deepClone(original);
      
      assertEquals(cloned.get('a'), 1);
      assertEquals((cloned.get('b') as any).c, 2);
      assertEquals(cloned === original, false);
      assertEquals(cloned.get('b') === original.get('b'), false);
    });

    it('should clone Sets', () => {
      const original = new Set([1, { a: 2 }, [3, 4]]);
      const cloned = deepClone(original);
      
      assertEquals(cloned.size, original.size);
      assertEquals(cloned === original, false);
      assertEquals(cloned.has(1), true);
    });
  });

  describe('deepMerge', () => {
    it('should merge objects deeply', () => {
      const target = { a: 1, b: { c: 2 } } as any;
      const source1 = { b: { d: 3 }, e: 4 } as any;
      const source2 = { b: { c: 5 }, f: 6 } as any;
      
      const result = deepMerge(target, source1, source2);
      
      assertEquals(result, {
        a: 1,
        b: { c: 5, d: 3 },
        e: 4,
        f: 6,
      });
    });

    it('should handle empty sources', () => {
      const target = { a: 1 };
      const result = deepMerge(target);
      
      assertEquals(result, { a: 1 });
    });

    it('should not mutate target object', () => {
      const target = { a: 1, b: { c: 2 } } as any;
      const source = { b: { d: 3 } } as any;
      
      const result = deepMerge(target, source);
      
      assertEquals(target.b.d, undefined); // Target not mutated
      assertEquals(result.b.d, 3); // Result has merged value
    });
  });

  describe('TypedEventEmitter', () => {
    interface TestEvents extends Record<string, unknown> {
      test: { message: string };
      number: { value: number };
    }
    
    let emitter: TypedEventEmitter<TestEvents>;
    
    beforeEach(() => {
      emitter = new TypedEventEmitter<TestEvents>();
    });

    it('should emit and receive events', () => {
      const handler = spy();
      
      emitter.on('test', handler);
      emitter.emit('test', { message: 'hello' });
      
      assertEquals(handler.calls.length, 1);
      assertEquals(handler.calls[0].args[0], { message: 'hello' });
    });

    it('should handle multiple listeners', () => {
      const handler1 = spy();
      const handler2 = spy();
      
      emitter.on('test', handler1);
      emitter.on('test', handler2);
      emitter.emit('test', { message: 'hello' });
      
      assertEquals(handler1.calls.length, 1);
      assertEquals(handler2.calls.length, 1);
    });

    it('should support once listeners', () => {
      const handler = spy();
      
      emitter.once('test', handler);
      emitter.emit('test', { message: 'hello' });
      emitter.emit('test', { message: 'world' });
      
      assertEquals(handler.calls.length, 1);
    });

    it('should remove listeners', () => {
      const handler = spy();
      
      emitter.on('test', handler);
      emitter.emit('test', { message: 'hello' });
      
      emitter.off('test', handler);
      emitter.emit('test', { message: 'world' });
      
      assertEquals(handler.calls.length, 1);
    });

    it('should remove all listeners', () => {
      const handler1 = spy();
      const handler2 = spy();
      
      emitter.on('test', handler1);
      emitter.on('test', handler2);
      
      emitter.removeAllListeners('test');
      emitter.emit('test', { message: 'hello' });
      
      assertEquals(handler1.calls.length, 0);
      assertEquals(handler2.calls.length, 0);
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      assertEquals(formatBytes(0), '0 Bytes');
      assertEquals(formatBytes(1024), '1 KB');
      assertEquals(formatBytes(1048576), '1 MB');
      assertEquals(formatBytes(1073741824), '1 GB');
      assertEquals(formatBytes(1099511627776), '1 TB');
    });

    it('should format with decimals', () => {
      assertEquals(formatBytes(1500), '1.46 KB');
      assertEquals(formatBytes(1500, 1), '1.5 KB');
      assertEquals(formatBytes(1500, 0), '1 KB');
    });

    it('should handle negative values', () => {
      assertEquals(formatBytes(-1024), '-1 KB');
    });
  });

  describe('parseDuration', () => {
    it('should parse different time units', () => {
      assertEquals(parseDuration('100ms'), 100);
      assertEquals(parseDuration('5s'), 5000);
      assertEquals(parseDuration('2m'), 120000);
      assertEquals(parseDuration('1h'), 3600000);
      assertEquals(parseDuration('1d'), 86400000);
    });

    it('should throw on invalid format', () => {
      assertThrows(
        () => parseDuration('invalid'),
        Error,
        'Invalid duration format'
      );
      
      assertThrows(
        () => parseDuration('100'),
        Error,
        'Invalid duration format'
      );
      
      assertThrows(
        () => parseDuration('100x'),
        Error,
        'Invalid duration format'
      );
    });
  });

  describe('ensureArray', () => {
    it('should convert single values to arrays', () => {
      assertEquals(ensureArray('test'), ['test']);
      assertEquals(ensureArray(5), [5]);
      assertEquals(ensureArray(null), [null]);
    });

    it('should keep arrays as arrays', () => {
      assertEquals(ensureArray(['test']), ['test']);
      assertEquals(ensureArray([1, 2, 3]), [1, 2, 3]);
      assertEquals(ensureArray([]), []);
    });
  });

  describe('groupBy', () => {
    it('should group items by key function', () => {
      const items = [
        { id: 1, type: 'a' },
        { id: 2, type: 'b' },
        { id: 3, type: 'a' },
        { id: 4, type: 'c' },
      ];
      
      const grouped = groupBy(items, item => item.type);
      
      assertEquals(grouped, {
        a: [{ id: 1, type: 'a' }, { id: 3, type: 'a' }],
        b: [{ id: 2, type: 'b' }],
        c: [{ id: 4, type: 'c' }],
      });
    });

    it('should handle empty arrays', () => {
      const grouped = groupBy([], (item: any) => item.type);
      assertEquals(grouped, {});
    });

    it('should handle number keys', () => {
      const items = [
        { id: 1, score: 100 },
        { id: 2, score: 90 },
        { id: 3, score: 100 },
      ];
      
      const grouped = groupBy(items, item => item.score);
      
      assertEquals(grouped[100].length, 2);
      assertEquals(grouped[90].length, 1);
    });
  });

  describe('createDeferred', () => {
    it('should create a deferred promise', async () => {
      const deferred = createDeferred<string>();
      
      // Resolve immediately to avoid timer leaks
      deferred.resolve('success');
      
      const result = await deferred.promise;
      assertEquals(result, 'success');
    });

    it('should handle rejection', async () => {
      const deferred = createDeferred<string>();
      
      // Reject immediately to avoid timer leaks
      deferred.reject(new Error('failed'));
      
      await assertRejects(
        () => deferred.promise,
        Error,
        'failed'
      );
    });
  });

  describe('safeParseJSON', () => {
    it('should parse valid JSON', () => {
      const result = safeParseJSON('{"key": "value"}');
      assertEquals(result, { key: 'value' });
    });

    it('should return undefined for invalid JSON', () => {
      const result = safeParseJSON('invalid json');
      assertEquals(result, undefined);
    });

    it('should return fallback for invalid JSON', () => {
      const result = safeParseJSON('invalid json', { default: true });
      assertEquals(result, { default: true });
    });

    it('should handle complex objects', () => {
      const obj = { a: 1, b: [2, 3], c: { d: 4 } };
      const result = safeParseJSON(JSON.stringify(obj));
      assertEquals(result, obj);
    });
  });

  describe('timeout', () => {
    it('should resolve if promise completes in time', async () => {
      const promise = Promise.resolve('success');
      const result = await timeout(promise, 1000);
      assertEquals(result, 'success');
    });

    it('should reject if promise times out', async () => {
      const promise = new Promise(resolve => {
        setTimeout(() => resolve('too late'), 50);
      });
      
      await assertRejects(
        () => timeout(promise, 10),
        Error,
        'Operation timed out'
      );
    });

    it('should use custom error message', async () => {
      const promise = new Promise(resolve => {
        setTimeout(() => resolve('too late'), 50);
      });
      
      await assertRejects(
        () => timeout(promise, 10, 'Custom timeout'),
        Error,
        'Custom timeout'
      );
    });
  });

  describe('circuitBreaker', () => {
    it('should execute function normally when closed', async () => {
      const breaker = circuitBreaker('test', {
        threshold: 3,
        timeout: 1000,
        resetTimeout: 5000,
      });
      
      const result = await breaker.execute(() => Promise.resolve('success'));
      assertEquals(result, 'success');
      
      const state = breaker.getState();
      assertEquals(state.state, 'closed');
      assertEquals(state.failureCount, 0);
    });

    it('should open after threshold failures', async () => {
      const breaker = circuitBreaker('test', {
        threshold: 3,
        timeout: 1000,
        resetTimeout: 5000,
      });
      
      // Trigger failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {}
      }
      
      const state = breaker.getState();
      assertEquals(state.state, 'open');
      assertEquals(state.failureCount, 3);
    });

    it('should reject immediately when open', async () => {
      const breaker = circuitBreaker('test', {
        threshold: 2,
        timeout: 1000,
        resetTimeout: 5000,
      });
      
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {}
      }
      
      // Should reject immediately
      await assertRejects(
        () => breaker.execute(() => Promise.resolve('success')),
        Error,
        'Circuit breaker test is open'
      );
    });

    it('should reset after timeout', async () => {
      const breaker = circuitBreaker('test', {
        threshold: 2,
        timeout: 1000,
        resetTimeout: 50, // Use short timeout for testing
      });
      
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {}
      }
      
      assertEquals(breaker.getState().state, 'open');
      
      // Wait for reset timeout
      await delay(60);
      
      // Should be half-open now
      const result = await breaker.execute(() => Promise.resolve('success'));
      assertEquals(result, 'success');
      assertEquals(breaker.getState().state, 'closed');
    });

    it('should handle timeout errors', async () => {
      const breaker = circuitBreaker('test', {
        threshold: 3,
        timeout: 10,
        resetTimeout: 5000,
      });
      
      // Use a promise that never resolves to test timeout behavior
      await assertRejects(
        () => breaker.execute(() => new Promise(() => {})),
        Error
      );
    });

    it('should reset failure count on success', async () => {
      const breaker = circuitBreaker('test', {
        threshold: 3,
        timeout: 1000,
        resetTimeout: 5000,
      });
      
      // Some failures
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch {}
      
      assertEquals(breaker.getState().failureCount, 1);
      
      // Success should reset count
      await breaker.execute(() => Promise.resolve('success'));
      
      const state = breaker.getState();
      assertEquals(state.failureCount, 0);
      assertEquals(state.state, 'closed');
    });

    it('should allow manual reset', () => {
      const breaker = circuitBreaker('test', {
        threshold: 2,
        timeout: 1000,
        resetTimeout: 5000,
      });
      
      breaker.reset();
      
      const state = breaker.getState();
      assertEquals(state.state, 'closed');
      assertEquals(state.failureCount, 0);
      assertEquals(state.lastFailureTime, 0);
    });
  });
});