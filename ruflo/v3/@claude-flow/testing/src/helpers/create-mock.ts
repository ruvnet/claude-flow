/**
 * V3 Claude-Flow Mock Factory
 *
 * London School TDD Mock Creation Utilities
 * - Creates type-safe mocks for behavior verification
 * - Supports deep mocking for complex objects
 * - Enables interaction tracking for behavior testing
 */
import { vi, type Mock } from 'vitest';

/**
 * Type for a fully mocked interface
 */
export type MockedInterface<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : T[K];
};

/**
 * Create a shallow mock of an interface
 * Each method becomes a vi.fn() for behavior verification
 *
 * @example
 * const mockRepo = createMock<UserRepository>();
 * mockRepo.findById.mockResolvedValue(user);
 * expect(mockRepo.save).toHaveBeenCalledWith(user);
 */
export function createMock<T extends object>(): MockedInterface<T> {
  return new Proxy({} as MockedInterface<T>, {
    get: (target, prop: string | symbol) => {
      if (typeof prop === 'string' && !(prop in target)) {
        (target as Record<string | symbol, unknown>)[prop] = vi.fn();
      }
      return (target as Record<string | symbol, unknown>)[prop];
    },
  });
}

/**
 * Create a deep mock that handles nested objects
 * Useful for complex interfaces with nested dependencies
 *
 * @example
 * const mockService = createDeepMock<ComplexService>();
 * mockService.nested.method.mockReturnValue(result);
 */
export function createDeepMock<T extends object>(): MockedInterface<T> {
  const cache = new Map<string | symbol, unknown>();

  return new Proxy({} as MockedInterface<T>, {
    get: (target, prop: string | symbol) => {
      if (!cache.has(prop)) {
        const mock = vi.fn();
        // Allow chaining for nested access
        (mock as unknown as Record<string, unknown>).mockReturnValue =
          mock.mockReturnValue.bind(mock);
        cache.set(prop, mock);
      }
      return cache.get(prop);
    },
  });
}

/**
 * Create a spy mock that wraps an existing object
 * Preserves original behavior while enabling verification
 *
 * @example
 * const spied = createSpyMock(realService);
 * await spied.process();
 * expect(spied.process).toHaveBeenCalled();
 */
export function createSpyMock<T extends object>(target: T): MockedInterface<T> {
  const spied = { ...target } as MockedInterface<T>;

  for (const key of Object.keys(target) as Array<keyof T>) {
    const value = target[key];
    if (typeof value === 'function') {
      (spied as Record<keyof T, unknown>)[key] = vi.fn(value.bind(target));
    }
  }

  return spied;
}

/**
 * Create a mock with predefined behavior
 * Useful for common test scenarios
 *
 * @example
 * const mockRepo = createMockWithBehavior<UserRepository>({
 *   findById: async (id) => ({ id, name: 'Test' }),
 *   save: async (user) => user,
 * });
 */
export function createMockWithBehavior<T extends object>(
  implementations: Partial<{ [K in keyof T]: T[K] }>
): MockedInterface<T> {
  const mock = createMock<T>();

  for (const [key, impl] of Object.entries(implementations)) {
    if (typeof impl === 'function') {
      (mock as Record<string, Mock>)[key].mockImplementation(impl as (...args: unknown[]) => unknown);
    }
  }

  return mock;
}

/**
 * Create a mock that fails on first call, succeeds on retry
 * Useful for testing retry logic and error handling
 *
 * @example
 * const mockApi = createRetryMock<ApiClient>('fetch', new Error('Network'), data);
 */
export function createRetryMock<T extends object>(
  methodName: keyof T,
  firstError: Error,
  successValue: unknown
): MockedInterface<T> {
  const mock = createMock<T>();

  (mock as Record<string, Mock>)[methodName as string]
    .mockRejectedValueOnce(firstError)
    .mockResolvedValue(successValue);

  return mock;
}

/**
 * Create a sequence mock that returns different values per call
 * Useful for testing stateful interactions
 *
 * @example
 * const mockCounter = createSequenceMock<Counter>('next', [1, 2, 3, 4, 5]);
 */
export function createSequenceMock<T extends object>(
  methodName: keyof T,
  values: unknown[]
): MockedInterface<T> {
  const mock = createMock<T>();
  const fn = (mock as Record<string, Mock>)[methodName as string];

  values.forEach((value, index) => {
    if (index === values.length - 1) {
      fn.mockReturnValue(value);
    } else {
      fn.mockReturnValueOnce(value);
    }
  });

  return mock;
}

/**
 * Interaction recorder for complex behavior verification
 * Tracks all calls across multiple mocks
 *
 * @example
 * const recorder = new InteractionRecorder();
 * recorder.track('repo', mockRepo);
 * recorder.track('notifier', mockNotifier);
 * await service.process();
 * expect(recorder.getInteractionOrder()).toEqual(['repo.save', 'notifier.notify']);
 */
export class InteractionRecorder {
  private interactions: Array<{ name: string; method: string; args: unknown[]; timestamp: number }> = [];

  track<T extends object>(name: string, mock: MockedInterface<T>): void {
    for (const key of Object.keys(mock)) {
      const method = (mock as Record<string, Mock>)[key];
      if (typeof method?.mockImplementation === 'function') {
        const original = method.getMockImplementation();
        method.mockImplementation((...args: unknown[]) => {
          this.interactions.push({
            name,
            method: key,
            args,
            timestamp: Date.now(),
          });
          return original?.(...args);
        });
      }
    }
  }

  getInteractions(): Array<{ name: string; method: string; args: unknown[] }> {
    return this.interactions.map(({ name, method, args }) => ({ name, method, args }));
  }

  getInteractionOrder(): string[] {
    return this.interactions.map(({ name, method }) => `${name}.${method}`);
  }

  clear(): void {
    this.interactions = [];
  }
}
