/**
 * V3 Claude-Flow Custom Assertions
 *
 * London School TDD Custom Assertions
 * - Behavior-focused assertions
 * - Interaction verification helpers
 * - Contract testing utilities
 */
import { expect, type Mock } from 'vitest';

/**
 * Assert that a mock was called in a specific sequence
 *
 * @example
 * assertCallSequence([
 *   [mockRepo.findById, ['123']],
 *   [mockValidator.validate, [user]],
 *   [mockRepo.save, [user]],
 * ]);
 */
export function assertCallSequence(
  sequence: Array<[Mock, unknown[]]>
): void {
  const calls: Array<{ mock: Mock; args: unknown[]; order: number }> = [];

  for (const [mock, expectedArgs] of sequence) {
    const mockCalls = mock.mock.calls;
    const invocationOrder = mock.mock.invocationCallOrder;

    for (let i = 0; i < mockCalls.length; i++) {
      if (JSON.stringify(mockCalls[i]) === JSON.stringify(expectedArgs)) {
        calls.push({
          mock,
          args: mockCalls[i],
          order: invocationOrder[i],
        });
        break;
      }
    }
  }

  expect(calls.length).toBe(sequence.length);

  for (let i = 1; i < calls.length; i++) {
    expect(calls[i].order).toBeGreaterThan(calls[i - 1].order);
  }
}

/**
 * Assert that a mock was NOT called with specific arguments
 *
 * @example
 * assertNotCalledWith(mockRepo.save, [invalidUser]);
 */
export function assertNotCalledWith(mock: Mock, args: unknown[]): void {
  const wasCalledWith = mock.mock.calls.some(
    (call: unknown[]) => JSON.stringify(call) === JSON.stringify(args)
  );
  expect(wasCalledWith).toBe(false);
}

/**
 * Assert interaction count for behavior verification
 *
 * @example
 * assertInteractionCount(mockService.process, 3);
 */
export function assertInteractionCount(mock: Mock, expectedCount: number): void {
  expect(mock.mock.calls.length).toBe(expectedCount);
}

/**
 * Assert that all mocks in a group were called
 *
 * @example
 * assertAllCalled([mockA.method, mockB.method, mockC.method]);
 */
export function assertAllCalled(mocks: Mock[]): void {
  for (const mock of mocks) {
    expect(mock).toHaveBeenCalled();
  }
}

/**
 * Assert that none of the mocks were called
 *
 * @example
 * assertNoneCalled([mockA.method, mockB.method]);
 */
export function assertNoneCalled(mocks: Mock[]): void {
  for (const mock of mocks) {
    expect(mock).not.toHaveBeenCalled();
  }
}

/**
 * Assert contract compliance
 * Verifies that an object implements expected interface
 *
 * @example
 * assertContractCompliance(userService, UserServiceContract);
 */
export function assertContractCompliance<T extends object>(
  implementation: T,
  contract: ContractDefinition<T>
): void {
  for (const [method, spec] of Object.entries(contract.methods)) {
    expect(typeof (implementation as Record<string, unknown>)[method]).toBe('function');
  }
}

/**
 * Contract definition for interface compliance
 */
export interface ContractDefinition<T> {
  methods: {
    [K in keyof T]?: {
      params: Array<{ name: string; type: string }>;
      returns: string;
    };
  };
}

/**
 * Assert async operation timing
 *
 * @example
 * await assertTimingWithin(async () => service.process(), 100);
 */
export async function assertTimingWithin(
  operation: () => Promise<unknown>,
  maxMs: number
): Promise<void> {
  const start = Date.now();
  await operation();
  const duration = Date.now() - start;
  expect(duration).toBeLessThanOrEqual(maxMs);
}

/**
 * Assert that an async operation completes within expected time range
 *
 * @example
 * await assertTimingRange(async () => service.process(), 50, 150);
 */
export async function assertTimingRange(
  operation: () => Promise<unknown>,
  minMs: number,
  maxMs: number
): Promise<void> {
  const start = Date.now();
  await operation();
  const duration = Date.now() - start;
  expect(duration).toBeGreaterThanOrEqual(minMs);
  expect(duration).toBeLessThanOrEqual(maxMs);
}

/**
 * Assert error type and message
 *
 * @example
 * await assertThrowsWithMessage(
 *   async () => service.validate(invalid),
 *   ValidationError,
 *   'Invalid input'
 * );
 */
export async function assertThrowsWithMessage(
  operation: () => Promise<unknown>,
  ErrorType: new (...args: unknown[]) => Error,
  expectedMessage: string | RegExp
): Promise<void> {
  let error: Error | null = null;

  try {
    await operation();
  } catch (e) {
    error = e as Error;
  }

  expect(error).toBeInstanceOf(ErrorType);
  if (typeof expectedMessage === 'string') {
    expect(error?.message).toContain(expectedMessage);
  } else {
    expect(error?.message).toMatch(expectedMessage);
  }
}

/**
 * Assert domain event was published
 *
 * @example
 * await assertEventPublished(mockEventBus, 'UserCreated', { userId: '123' });
 */
export function assertEventPublished(
  eventBusMock: Mock,
  eventType: string,
  expectedPayload?: Record<string, unknown>
): void {
  const publishCalls = eventBusMock.mock.calls;

  const matchingEvent = publishCalls.find((call: unknown[]) => {
    const event = call[0] as { type: string; payload: unknown };
    return event.type === eventType;
  });

  expect(matchingEvent).toBeDefined();

  if (expectedPayload && matchingEvent) {
    const actualPayload = (matchingEvent[0] as { payload: unknown }).payload;
    expect(actualPayload).toMatchObject(expectedPayload);
  }
}

/**
 * Assert that mock returns expected values in sequence
 *
 * @example
 * assertMockSequence(mockCounter.next, [1, 2, 3]);
 */
export async function assertMockSequence(
  mock: Mock,
  expectedValues: unknown[]
): Promise<void> {
  for (const expected of expectedValues) {
    const result = await mock();
    expect(result).toEqual(expected);
  }
}

/**
 * Security assertion - verify sensitive data handling
 *
 * @example
 * assertNoSensitiveDataLogged(mockLogger, ['password', 'token', 'secret']);
 */
export function assertNoSensitiveDataLogged(
  loggerMock: Mock,
  sensitivePatterns: string[]
): void {
  const allCalls = loggerMock.mock.calls;

  for (const call of allCalls) {
    const logContent = JSON.stringify(call);
    for (const pattern of sensitivePatterns) {
      expect(logContent.toLowerCase()).not.toContain(pattern.toLowerCase());
    }
  }
}

/**
 * Performance assertion - verify operation meets target
 *
 * @example
 * await assertPerformanceTarget(
 *   async () => await search.execute(query),
 *   { targetMs: 100, iterations: 10 }
 * );
 */
export async function assertPerformanceTarget(
  operation: () => Promise<unknown>,
  config: { targetMs: number; iterations: number; warmupIterations?: number }
): Promise<{ averageMs: number; minMs: number; maxMs: number }> {
  const { targetMs, iterations, warmupIterations = 3 } = config;

  // Warmup
  for (let i = 0; i < warmupIterations; i++) {
    await operation();
  }

  const timings: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await operation();
    timings.push(performance.now() - start);
  }

  const averageMs = timings.reduce((a, b) => a + b, 0) / timings.length;
  const minMs = Math.min(...timings);
  const maxMs = Math.max(...timings);

  expect(averageMs).toBeLessThanOrEqual(targetMs);

  return { averageMs, minMs, maxMs };
}
