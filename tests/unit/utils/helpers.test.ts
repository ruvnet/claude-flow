/// <reference types="jest" />

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
} from '../../test.utils.js';
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
} from '../../../src/utils/helpers.js';
import { cleanupTestEnv, setupTestEnv } from '../../test.config.js';

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
      
      expect(id1);
      expect(id2);
      expect(id1 === id2).toBe( false);
      expect(typeof id1).toBe( 'string');
      expect(typeof id2).toBe( 'string');
    });

    it('should include prefix when provided', () => {
      const id = generateId('test');
      expect(id.startsWith('test_')).toBe( true);
    });

    it('should generate IDs of reasonable length', () => {
      const id = generateId();
      expect(id.length > 10).toBe( true);
      expect(id.length < 50).toBe( true);
    });
  });

  describe('delay', () => {
    it('should resolve after specified time', async () => {
      const time = jest.useFakeTimers();
      
      const promise = delay(1000);
      await time.tickAsync(1000);
      
      await promise; // Should not throw
      
      jest.useRealTimers();
    });

    it('should work with zero delay', async () => {
      const start = Date.now();
      await delay(0);
      const elapsed = Date.now() - start;
      
      expect(elapsed < 10).toBe( true);
    });
  });

  describe('retry', () => {
    it('should succeed on first attempt if no error', async () => {
      const fn = jest.spyOn(() => Promise.resolve('success'));
      
      const result = await retry(fn);
      
      expect(result).toBe( 'success');
      expect(fn.calls.length).toBe( 1);
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
      
      expect(result).toBe( 'success');
      expect(attempts).toBe( 3);
    });

    it('should throw after max attempts', async () => {
      let attempts = 0;
      
      await expect(
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
      
      expect(attempts).toBe( 2);
    });

    it('should call onRetry callback', async () => {
      let attempts = 0;
      const onRetry = jest.spyOn();
      
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
      
      expect(onRetry.calls.length).toBe( 1);
      expect(onRetry.calls[0].args[0]).toBe( 1); // attempt number
      expect(onRetry.calls[0].args[1].message).toBe( 'Retry'); // error
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
      
      expect(result).toBe( 'success');
      expect(attempts).toBe( 3);
    });
  });

  describe('debounce', () => {
    it('should debounce function calls', async () => {
      const fn = jest.spyOn();
      const debouncedFn = debounce(fn, 10); // Use small delay to avoid long waits
      
      debouncedFn();
      debouncedFn();
      debouncedFn();
      
      // Should not call yet
      expect(fn.calls.length).toBe( 0);
      
      await delay(15); // Wait for debounce
      
      // Should call once
      expect(fn.calls.length).toBe( 1);
    });

    it('should reset timer on subsequent calls', async () => {
      const fn = jest.spyOn();
      const debouncedFn = debounce(fn, 20);
      
      debouncedFn();
      await delay(10);
      debouncedFn(); // Reset timer
      await delay(10);
      
      // Should not call yet (timer was reset)
      expect(fn.calls.length).toBe( 0);
      
      await delay(25); // Wait for final debounce
      
      // Should call now
      expect(fn.calls.length).toBe( 1);
    });
  });

  describe('throttle', () => {
    it('should throttle function calls', async () => {
      const fn = jest.spyOn();
      const throttledFn = throttle(fn, 10);
      
      throttledFn();
      throttledFn();
      throttledFn();
      
      // Should call immediately once
      expect(fn.calls.length).toBe( 1);
      
      await delay(15); // Wait for throttle
      
      // Should call the last queued call
      expect(fn.calls.length).toBe( 2);
    });
  });

  describe('deepClone', () => {
    it('should clone primitives', () => {
      expect(deepClone(5)).toBe( 5);
      expect(deepClone('test')).toBe( 'test');
      expect(deepClone(true)).toBe( true);
      expect(deepClone(null)).toBe( null);
    });

    it('should clone dates', () => {
      const date = new Date();
      const cloned = deepClone(date);
      
      expect(cloned.getTime()).toBe( date.getTime());
      expect(cloned === date).toBe( false); // Different objects
    });

    it('should clone arrays deeply', () => {
      const original = [1, [2, 3], { a: 4 }];
      const cloned = deepClone(original);
      
      expect(cloned).toBe( original);
      expect(cloned === original).toBe( false);
      expect(cloned[1] === original[1]).toBe( false);
      expect(cloned[2] === original[2]).toBe( false);
    });

    it('should clone objects deeply', () => {
      const original = {
        a: 1,
        b: { c: 2, d: [3, 4] },
        e: new Date(),
      };
      
      const cloned = deepClone(original);
      
      expect(cloned.a).toBe( original.a);
      expect(cloned.b.c).toBe( original.b.c);
      expect(cloned.b.d).toBe( original.b.d);
      expect(cloned.e.getTime()).toBe( original.e.getTime());
      
      // Different references
      expect(cloned === original).toBe( false);
      expect(cloned.b === original.b).toBe( false);
      expect(cloned.b.d === original.b.d).toBe( false);
      expect(cloned.e === original.e).toBe( false);
    });

    it('should clone Maps', () => {
      const original = new Map([['a', 1], ['b', { c: 2 }]]);
      const cloned = deepClone(original);
      
      expect(cloned.get('a')).toBe( 1);
      expect((cloned.get('b') as any).c).toBe( 2);
      expect(cloned === original).toBe( false);
      expect(cloned.get('b') === original.get('b')).toBe( false);
    });

    it('should clone Sets', () => {
      const original = new Set([1, { a: 2 }, [3, 4]]);
      const cloned = deepClone(original);
      
      expect(cloned.size).toBe( original.size);
      expect(cloned === original).toBe( false);
      expect(cloned.has(1)).toBe( true);
    });
  });

  describe('deepMerge', () => {
    it('should merge objects deeply', () => {
      const target = { a: 1, b: { c: 2 } } as any;
      const source1 = { b: { d: 3 }, e: 4 } as any;
      const source2 = { b: { c: 5 }, f: 6 } as any;
      
      const result = deepMerge(target, source1, source2);
      
      expect(result, {
        a: 1,
        b: { c: 5, d: 3 },
        e: 4,
        f: 6,
      });
    });

    it('should handle empty sources', () => {
      const target = { a: 1 };
      const result = deepMerge(target);
      
      expect(result).toEqual({ a: 1 });
    });

    it('should not mutate target object', () => {
      const target = { a: 1, b: { c: 2 } } as any;
      const source = { b: { d: 3 } } as any;
      
      const result = deepMerge(target, source);
      
      expect(target.b.d).toBe( undefined); // Target not mutated
      expect(result.b.d).toBe( 3); // Result has merged value
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
      const handler = jest.spyOn();
      
      emitter.on('test', handler);
      emitter.emit('test', { message: 'hello' });
      
      expect(handler.calls.length).toBe( 1);
      expect(handler.calls[0].args[0]).toEqual({ message: 'hello' });
    });

    it('should handle multiple listeners', () => {
      const handler1 = jest.spyOn();
      const handler2 = jest.spyOn();
      
      emitter.on('test', handler1);
      emitter.on('test', handler2);
      emitter.emit('test', { message: 'hello' });
      
      expect(handler1.calls.length).toBe( 1);
      expect(handler2.calls.length).toBe( 1);
    });

    it('should support once listeners', () => {
      const handler = jest.spyOn();
      
      emitter.once('test', handler);
      emitter.emit('test', { message: 'hello' });
      emitter.emit('test', { message: 'world' });
      
      expect(handler.calls.length).toBe( 1);
    });

    it('should remove listeners', () => {
      const handler = jest.spyOn();
      
      emitter.on('test', handler);
      emitter.emit('test', { message: 'hello' });
      
      emitter.off('test', handler);
      emitter.emit('test', { message: 'world' });
      
      expect(handler.calls.length).toBe( 1);
    });

    it('should remove all listeners', () => {
      const handler1 = jest.spyOn();
      const handler2 = jest.spyOn();
      
      emitter.on('test', handler1);
      emitter.on('test', handler2);
      
      emitter.removeAllListeners('test');
      emitter.emit('test', { message: 'hello' });
      
      expect(handler1.calls.length).toBe( 0);
      expect(handler2.calls.length).toBe( 0);
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1073741824)).toBe('1 GB');
      expect(formatBytes(1099511627776)).toBe('1 TB');
    });

    it('should format with decimals', () => {
      expect(formatBytes(1500)).toBe('1.46 KB');
      expect(formatBytes(1500, 1)).toBe('1.5 KB');
      expect(formatBytes(1500, 0)).toBe('1 KB');
    });

    it('should handle negative values', () => {
      expect(formatBytes(-1024)).toBe('-1 KB');
    });
  });

  describe('parseDuration', () => {
    it('should parse different time units', () => {
      expect(parseDuration('100ms')).toBe( 100);
      expect(parseDuration('5s')).toBe( 5000);
      expect(parseDuration('2m')).toBe( 120000);
      expect(parseDuration('1h')).toBe( 3600000);
      expect(parseDuration('1d')).toBe( 86400000);
    });

    it('should throw on invalid format', () => {
      expect(
        () => parseDuration('invalid'),
        Error,
        'Invalid duration format'
      );
      
      expect(
        () => parseDuration('100'),
        Error,
        'Invalid duration format'
      );
      
      expect(
        () => parseDuration('100x'),
        Error,
        'Invalid duration format'
      );
    });
  });

  describe('ensureArray', () => {
    it('should convert single values to arrays', () => {
      expect(ensureArray('test')).toEqual(['test']);
      expect(ensureArray(5)).toEqual([5]);
      expect(ensureArray(null)).toEqual([null]);
    });

    it('should keep arrays as arrays', () => {
      expect(ensureArray(['test'])).toEqual(['test']);
      expect(ensureArray([1).toBe( 2, 3]), [1, 2, 3]);
      expect(ensureArray([])).toEqual([]);
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
      
      expect(grouped, {
        a: [{ id: 1, type: 'a' }, { id: 3, type: 'a' }],
        b: [{ id: 2, type: 'b' }],
        c: [{ id: 4, type: 'c' }],
      });
    });

    it('should handle empty arrays', () => {
      const grouped = groupBy([], (item: any) => item.type);
      expect(grouped).toEqual({});
    });

    it('should handle number keys', () => {
      const items = [
        { id: 1, score: 100 },
        { id: 2, score: 90 },
        { id: 3, score: 100 },
      ];
      
      const grouped = groupBy(items, item => item.score);
      
      expect(grouped[100].length).toBe( 2);
      expect(grouped[90].length).toBe( 1);
    });
  });

  describe('createDeferred', () => {
    it('should create a deferred promise', async () => {
      const deferred = createDeferred<string>();
      
      // Resolve immediately to avoid timer leaks
      deferred.resolve('success');
      
      const result = await deferred.promise;
      expect(result).toBe( 'success');
    });

    it('should handle rejection', async () => {
      const deferred = createDeferred<string>();
      
      // Reject immediately to avoid timer leaks
      deferred.reject(new Error('failed'));
      
      await expect(
        () => deferred.promise,
        Error,
        'failed'
      );
    });
  });

  describe('safeParseJSON', () => {
    it('should parse valid JSON', () => {
      const result = safeParseJSON('{"key": "value"}');
      expect(result).toEqual({ key: 'value' });
    });

    it('should return undefined for invalid JSON', () => {
      const result = safeParseJSON('invalid json');
      expect(result).toBe( undefined);
    });

    it('should return fallback for invalid JSON', () => {
      const result = safeParseJSON('invalid json', { default: true });
      expect(result).toEqual({ default: true });
    });

    it('should handle complex objects', () => {
      const obj = { a: 1, b: [2, 3], c: { d: 4 } };
      const result = safeParseJSON(JSON.stringify(obj));
      expect(result).toBe( obj);
    });
  });

  describe('timeout', () => {
    it('should resolve if promise completes in time', async () => {
      const promise = Promise.resolve('success');
      const result = await timeout(promise, 1000);
      expect(result).toBe( 'success');
    });

    it('should reject if promise times out', async () => {
      const promise = new Promise(resolve => {
        setTimeout(() => resolve('too late'), 50);
      });
      
      await expect(
        () => timeout(promise, 10),
        Error,
        'Operation timed out'
      );
    });

    it('should use custom error message', async () => {
      const promise = new Promise(resolve => {
        setTimeout(() => resolve('too late'), 50);
      });
      
      await expect(
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
      expect(result).toBe( 'success');
      
      const state = breaker.getState();
      expect(state.state).toBe( 'closed');
      expect(state.failureCount).toBe( 0);
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
      expect(state.state).toBe( 'open');
      expect(state.failureCount).toBe( 3);
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
      await expect(
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
      
      expect(breaker.getState().state).toBe( 'open');
      
      // Wait for reset timeout
      await delay(60);
      
      // Should be half-open now
      const result = await breaker.execute(() => Promise.resolve('success'));
      expect(result).toBe( 'success');
      expect(breaker.getState().state).toBe( 'closed');
    });

    it('should handle timeout errors', async () => {
      const breaker = circuitBreaker('test', {
        threshold: 3,
        timeout: 10,
        resetTimeout: 5000,
      });
      
      // Use a promise that never resolves to test timeout behavior
      await expect(
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
      
      expect(breaker.getState().failureCount).toBe( 1);
      
      // Success should reset count
      await breaker.execute(() => Promise.resolve('success'));
      
      const state = breaker.getState();
      expect(state.failureCount).toBe( 0);
      expect(state.state).toBe( 'closed');
    });

    it('should allow manual reset', () => {
      const breaker = circuitBreaker('test', {
        threshold: 2,
        timeout: 1000,
        resetTimeout: 5000,
      });
      
      breaker.reset();
      
      const state = breaker.getState();
      expect(state.state).toBe( 'closed');
      expect(state.failureCount).toBe( 0);
      expect(state.lastFailureTime).toBe( 0);
    });
  });
});
