/**
 * @claude-flow/testing - Assertion Helpers
 *
 * Custom Vitest matchers and assertion utilities for V3 module testing.
 * Implements London School TDD behavior verification patterns.
 */
import { expect, type Mock, type ExpectStatic } from 'vitest';

/**
 * Assert that a mock was called with arguments matching a pattern
 *
 * @example
 * assertCalledWithPattern(mockFn, { userId: expect.any(String) });
 */
export function assertCalledWithPattern(
  mock: Mock,
  pattern: Record<string, unknown> | unknown[]
): void {
  const calls = mock.mock.calls;
  const matched = calls.some(call => {
    if (Array.isArray(pattern)) {
      return pattern.every((expected, i) => {
        if (typeof expected === 'object' && expected !== null && 'asymmetricMatch' in expected) {
          return (expected as { asymmetricMatch: (actual: unknown) => boolean }).asymmetricMatch(call[i]);
        }
        return JSON.stringify(call[i]) === JSON.stringify(expected);
      });
    }

    const callArg = call[0] as Record<string, unknown>;
    return Object.entries(pattern).every(([key, expected]) => {
      if (typeof expected === 'object' && expected !== null && 'asymmetricMatch' in expected) {
        return (expected as { asymmetricMatch: (actual: unknown) => boolean }).asymmetricMatch(callArg[key]);
      }
      return JSON.stringify(callArg[key]) === JSON.stringify(expected);
    });
  });

  expect(matched).toBe(true);
}

/**
 * Assert that events were published in order
 *
 * @example
 * assertEventOrder(mockEventBus.publish, ['UserCreated', 'EmailSent']);
 */
export function assertEventOrder(
  publishMock: Mock,
  expectedEventTypes: string[]
): void {
  const actualEventTypes = publishMock.mock.calls
    .map(call => (call[0] as { type: string }).type)
    .filter(type => expectedEventTypes.includes(type));

  expect(actualEventTypes).toEqual(expectedEventTypes);
}

/**
 * Assert that an event was published with specific payload
 *
 * @example
 * assertEventPublished(mockEventBus, 'UserCreated', { userId: '123' });
 */
export function assertEventPublished(
  eventBusMock: { publish: Mock } | Mock,
  eventType: string,
  expectedPayload?: Record<string, unknown>
): void {
  const publishMock = 'publish' in eventBusMock ? eventBusMock.publish : eventBusMock;
  const calls = publishMock.mock.calls;

  const matchingEvent = calls.find(call => {
    const event = call[0] as { type: string; payload?: unknown };
    return event.type === eventType;
  });

  expect(matchingEvent).toBeDefined();

  if (expectedPayload && matchingEvent) {
    const actualPayload = (matchingEvent[0] as { payload: unknown }).payload;
    expect(actualPayload).toMatchObject(expectedPayload);
  }
}

/**
 * Assert that no event of a specific type was published
 *
 * @example
 * assertEventNotPublished(mockEventBus, 'UserDeleted');
 */
export function assertEventNotPublished(
  eventBusMock: { publish: Mock } | Mock,
  eventType: string
): void {
  const publishMock = 'publish' in eventBusMock ? eventBusMock.publish : eventBusMock;
  const calls = publishMock.mock.calls;

  const matchingEvent = calls.find(call => {
    const event = call[0] as { type: string };
    return event.type === eventType;
  });

  expect(matchingEvent).toBeUndefined();
}

/**
 * Assert that mocks were called in a specific order
 *
 * @example
 * assertMocksCalledInOrder([mockValidate, mockSave, mockNotify]);
 */
export function assertMocksCalledInOrder(mocks: Mock[]): void {
  const orders = mocks.map(mock => {
    if (mock.mock.invocationCallOrder.length === 0) {
      return Infinity;
    }
    return Math.min(...mock.mock.invocationCallOrder);
  });

  for (let i = 1; i < orders.length; i++) {
    expect(orders[i]).toBeGreaterThan(orders[i - 1]);
  }
}

/**
 * Assert that a mock was called exactly n times with specific arguments
 *
 * @example
 * assertCalledNTimesWith(mockFn, 3, ['arg1', 'arg2']);
 */
export function assertCalledNTimesWith(
  mock: Mock,
  times: number,
  args: unknown[]
): void {
  const matchingCalls = mock.mock.calls.filter(
    call => JSON.stringify(call) === JSON.stringify(args)
  );

  expect(matchingCalls).toHaveLength(times);
}

/**
 * Assert that async operations completed within time limit
 *
 * @example
 * await assertCompletesWithin(async () => await slowOp(), 1000);
 */
export async function assertCompletesWithin(
  operation: () => Promise<unknown>,
  maxMs: number
): Promise<void> {
  const start = performance.now();
  await operation();
  const duration = performance.now() - start;

  expect(duration).toBeLessThanOrEqual(maxMs);
}

/**
 * Assert that an operation throws a specific error
 *
 * @example
 * await assertThrowsError(
 *   async () => await riskyOp(),
 *   ValidationError,
 *   'Invalid input'
 * );
 */
export async function assertThrowsError<E extends Error>(
  operation: () => Promise<unknown>,
  ErrorType: new (...args: unknown[]) => E,
  messagePattern?: string | RegExp
): Promise<E> {
  let error: E | undefined;

  try {
    await operation();
  } catch (e) {
    error = e as E;
  }

  expect(error).toBeInstanceOf(ErrorType);

  if (messagePattern && error) {
    if (typeof messagePattern === 'string') {
      expect(error.message).toContain(messagePattern);
    } else {
      expect(error.message).toMatch(messagePattern);
    }
  }

  return error!;
}

/**
 * Assert that no sensitive data appears in logs
 *
 * @example
 * assertNoSensitiveData(mockLogger.logs, ['password', 'token', 'secret']);
 */
export function assertNoSensitiveData(
  logs: Array<{ message: string; context?: Record<string, unknown> }>,
  sensitivePatterns: string[]
): void {
  for (const log of logs) {
    const content = JSON.stringify(log).toLowerCase();

    for (const pattern of sensitivePatterns) {
      expect(content).not.toContain(pattern.toLowerCase());
    }
  }
}

/**
 * Assert that a value matches a snapshot with custom serialization
 *
 * @example
 * assertMatchesSnapshot(result, { ignoreFields: ['timestamp', 'id'] });
 */
export function assertMatchesSnapshot(
  value: unknown,
  options: SnapshotOptions = {}
): void {
  const { ignoreFields = [], transform } = options;

  let processed = value;

  if (ignoreFields.length > 0 && typeof processed === 'object' && processed !== null) {
    processed = removeFields(processed as Record<string, unknown>, ignoreFields);
  }

  if (transform) {
    processed = transform(processed);
  }

  expect(processed).toMatchSnapshot();
}

/**
 * Snapshot options interface
 */
export interface SnapshotOptions {
  ignoreFields?: string[];
  transform?: (value: unknown) => unknown;
}

/**
 * Remove fields from object for snapshot comparison
 */
function removeFields(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const result = { ...obj };

  for (const field of fields) {
    delete result[field];
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'object' && value !== null) {
      result[key] = removeFields(value as Record<string, unknown>, fields);
    }
  }

  return result;
}

/**
 * Assert that performance metrics meet V3 targets
 *
 * @example
 * assertV3PerformanceTargets({
 *   searchSpeedup: 160,
 *   memoryReduction: 0.55,
 * });
 */
export function assertV3PerformanceTargets(metrics: V3PerformanceMetrics): void {
  // Search speedup: 150x - 12500x
  if (metrics.searchSpeedup !== undefined) {
    expect(metrics.searchSpeedup).toBeGreaterThanOrEqual(150);
    expect(metrics.searchSpeedup).toBeLessThanOrEqual(12500);
  }

  // Flash attention speedup: 2.49x - 7.47x
  if (metrics.flashAttentionSpeedup !== undefined) {
    expect(metrics.flashAttentionSpeedup).toBeGreaterThanOrEqual(2.49);
    expect(metrics.flashAttentionSpeedup).toBeLessThanOrEqual(7.47);
  }

  // Memory reduction: >= 50%
  if (metrics.memoryReduction !== undefined) {
    expect(metrics.memoryReduction).toBeGreaterThanOrEqual(0.50);
  }

  // Startup time: < 500ms
  if (metrics.startupTimeMs !== undefined) {
    expect(metrics.startupTimeMs).toBeLessThan(500);
  }

  // Response time: sub-100ms
  if (metrics.responseTimeMs !== undefined) {
    expect(metrics.responseTimeMs).toBeLessThan(100);
  }
}

/**
 * V3 performance metrics interface
 */
export interface V3PerformanceMetrics {
  searchSpeedup?: number;
  flashAttentionSpeedup?: number;
  memoryReduction?: number;
  startupTimeMs?: number;
  responseTimeMs?: number;
}

/**
 * Assert that a domain object is valid
 *
 * @example
 * assertValidDomainObject(user, UserSchema);
 */
export function assertValidDomainObject<T>(
  object: T,
  validator: (obj: T) => { valid: boolean; errors?: string[] }
): void {
  const result = validator(object);

  if (!result.valid) {
    throw new Error(`Invalid domain object: ${result.errors?.join(', ')}`);
  }
}

/**
 * Assert that a mock was only called with allowed arguments
 *
 * @example
 * assertOnlyCalledWithAllowed(mockFn, [['valid1'], ['valid2']]);
 */
export function assertOnlyCalledWithAllowed(
  mock: Mock,
  allowedCalls: unknown[][]
): void {
  const calls = mock.mock.calls;

  for (const call of calls) {
    const isAllowed = allowedCalls.some(
      allowed => JSON.stringify(call) === JSON.stringify(allowed)
    );

    if (!isAllowed) {
      throw new Error(
        `Mock was called with unexpected arguments: ${JSON.stringify(call)}\n` +
        `Allowed: ${JSON.stringify(allowedCalls)}`
      );
    }
  }
}

/**
 * Assert that an array contains elements in partial order
 *
 * @example
 * assertPartialOrder(events, [
 *   { type: 'Start' },
 *   { type: 'Process' },
 *   { type: 'End' },
 * ]);
 */
export function assertPartialOrder<T>(
  actual: T[],
  expectedOrder: Partial<T>[]
): void {
  let lastIndex = -1;

  for (const expected of expectedOrder) {
    const index = actual.findIndex((item, i) =>
      i > lastIndex &&
      Object.entries(expected as Record<string, unknown>).every(
        ([key, value]) => (item as Record<string, unknown>)[key] === value
      )
    );

    if (index === -1) {
      throw new Error(
        `Expected to find ${JSON.stringify(expected)} after index ${lastIndex} in array`
      );
    }

    lastIndex = index;
  }
}

/**
 * Assert that all items in a collection pass a predicate
 *
 * @example
 * assertAllPass(results, result => result.success);
 */
export function assertAllPass<T>(
  items: T[],
  predicate: (item: T, index: number) => boolean,
  message?: string
): void {
  for (let i = 0; i < items.length; i++) {
    if (!predicate(items[i], i)) {
      throw new Error(
        message ?? `Item at index ${i} failed predicate: ${JSON.stringify(items[i])}`
      );
    }
  }
}

/**
 * Assert that none of the items in a collection pass a predicate
 *
 * @example
 * assertNonePass(results, result => result.error);
 */
export function assertNonePass<T>(
  items: T[],
  predicate: (item: T, index: number) => boolean,
  message?: string
): void {
  for (let i = 0; i < items.length; i++) {
    if (predicate(items[i], i)) {
      throw new Error(
        message ?? `Item at index ${i} passed predicate but should not have: ${JSON.stringify(items[i])}`
      );
    }
  }
}

/**
 * Assert that two arrays have the same elements regardless of order
 *
 * @example
 * assertSameElements([1, 2, 3], [3, 1, 2]);
 */
export function assertSameElements<T>(actual: T[], expected: T[]): void {
  expect(actual).toHaveLength(expected.length);

  const actualSorted = [...actual].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
  const expectedSorted = [...expected].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );

  expect(actualSorted).toEqual(expectedSorted);
}

/**
 * Assert that a mock returns expected results in sequence
 *
 * @example
 * await assertMockReturnsSequence(mockFn, [1, 2, 3]);
 */
export async function assertMockReturnsSequence(
  mock: Mock,
  expectedResults: unknown[]
): Promise<void> {
  for (const expected of expectedResults) {
    const result = await mock();
    expect(result).toEqual(expected);
  }
}

/**
 * Assert state transition is valid
 *
 * @example
 * assertValidStateTransition(
 *   'pending',
 *   'running',
 *   { pending: ['running', 'cancelled'], running: ['completed', 'failed'] }
 * );
 */
export function assertValidStateTransition<T extends string>(
  from: T,
  to: T,
  allowedTransitions: Record<T, T[]>
): void {
  const allowed = allowedTransitions[from];

  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Invalid state transition from '${from}' to '${to}'. ` +
      `Allowed transitions from '${from}': ${allowed?.join(', ') ?? 'none'}`
    );
  }
}

/**
 * Assert that a retry policy was followed
 *
 * @example
 * assertRetryPattern(mockFn, { attempts: 3, backoffPattern: 'exponential' });
 */
export function assertRetryPattern(
  mock: Mock,
  options: RetryPatternOptions
): void {
  const calls = mock.mock.calls;

  expect(calls).toHaveLength(options.attempts);

  if (options.backoffPattern === 'exponential' && calls.length > 1) {
    // Check that intervals roughly follow exponential pattern
    const invocationOrder = mock.mock.invocationCallOrder;
    for (let i = 2; i < invocationOrder.length; i++) {
      const prevGap = invocationOrder[i - 1] - invocationOrder[i - 2];
      const currentGap = invocationOrder[i] - invocationOrder[i - 1];
      // Allow some variance in timing
      expect(currentGap).toBeGreaterThanOrEqual(prevGap * 0.8);
    }
  }
}

/**
 * Retry pattern options interface
 */
export interface RetryPatternOptions {
  attempts: number;
  backoffPattern?: 'linear' | 'exponential' | 'constant';
  initialDelayMs?: number;
}

/**
 * Assert that a dependency was properly injected
 *
 * @example
 * assertDependencyInjected(service, 'repository', mockRepository);
 */
export function assertDependencyInjected<T extends object>(
  subject: T,
  propertyName: keyof T,
  expectedDependency: unknown
): void {
  expect(subject[propertyName]).toBe(expectedDependency);
}

/**
 * Custom Vitest matcher declarations
 * Note: Main declarations in setup.ts - these extend CustomMatchers
 */

/**
 * Register custom Vitest matchers
 */
export function registerCustomMatchers(): void {
  expect.extend({
    toHaveBeenCalledWithPattern(received: Mock, pattern: Record<string, unknown>) {
      const calls = received.mock.calls;
      const pass = calls.some(call => {
        const callArg = call[0] as Record<string, unknown>;
        return Object.entries(pattern).every(([key, expected]) =>
          JSON.stringify(callArg[key]) === JSON.stringify(expected)
        );
      });

      return {
        pass,
        message: () => pass
          ? `Expected mock not to have been called with pattern ${JSON.stringify(pattern)}`
          : `Expected mock to have been called with pattern ${JSON.stringify(pattern)}`,
      };
    },

    toHaveEventType(received: { type: string }, eventType: string) {
      const pass = received.type === eventType;

      return {
        pass,
        message: () => pass
          ? `Expected event not to have type ${eventType}`
          : `Expected event to have type ${eventType}, but got ${received.type}`,
      };
    },

    toMeetV3PerformanceTargets(received: V3PerformanceMetrics) {
      const issues: string[] = [];

      if (received.searchSpeedup !== undefined) {
        if (received.searchSpeedup < 150) {
          issues.push(`Search speedup ${received.searchSpeedup}x is below minimum 150x`);
        }
      }

      if (received.flashAttentionSpeedup !== undefined) {
        if (received.flashAttentionSpeedup < 2.49) {
          issues.push(`Flash attention speedup ${received.flashAttentionSpeedup}x is below minimum 2.49x`);
        }
      }

      if (received.memoryReduction !== undefined) {
        if (received.memoryReduction < 0.50) {
          issues.push(`Memory reduction ${received.memoryReduction * 100}% is below target 50%`);
        }
      }

      if (received.startupTimeMs !== undefined) {
        if (received.startupTimeMs >= 500) {
          issues.push(`Startup time ${received.startupTimeMs}ms exceeds target 500ms`);
        }
      }

      return {
        pass: issues.length === 0,
        message: () => issues.length === 0
          ? 'Performance metrics meet V3 targets'
          : `Performance issues: ${issues.join('; ')}`,
      };
    },
  });
}
