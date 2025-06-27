/// <reference types="jest" />

/**
 * Enhanced Mock Factory - Robust, Async-Safe Mocking Patterns
 * Fixes Phase 1 Jest compatibility issues with proper TypeScript support
 */

// Type definitions for safe mocking
type MockedFunction<T extends (...args: any[]) => any> = jest.MockedFunction<T>;

type MockedObject<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any 
    ? MockedFunction<T[K]> 
    : T[K];
};

export type Spy = jest.SpyInstance;

/**
 * Enhanced AsyncMockBuilder for creating type-safe async mocks
 */
export class AsyncMockBuilder<T extends Record<string, any>> {
  private mock: T;
  private spiedMethods = new Set<keyof T>();
  
  static create<T extends Record<string, any>>(base: T): AsyncMockBuilder<T> {
    return new AsyncMockBuilder(base);
  }
  
  private constructor(base: T) {
    // Create a clean copy to avoid modifying original
    this.mock = { ...base };
  }
  
  /**
   * Spy on an async method with proper implementation
   */
  spyOnAsync<K extends keyof T>(
    method: K,
    implementation?: T[K]
  ): AsyncMockBuilder<T> {
    if (typeof this.mock[method] === 'function') {
      const impl = implementation || this.mock[method];
      this.mock[method] = jest.fn().mockImplementation(impl) as T[K];
      this.spiedMethods.add(method);
    }
    return this;
  }
  
  /**
   * Spy on a synchronous method with proper implementation
   */
  spyOnSync<K extends keyof T>(
    method: K,
    implementation?: T[K]
  ): AsyncMockBuilder<T> {
    if (typeof this.mock[method] === 'function') {
      const impl = implementation || this.mock[method];
      this.mock[method] = jest.fn().mockImplementation(impl) as T[K];
      this.spiedMethods.add(method);
    }
    return this;
  }
  
  /**
   * Configure a method to reject with an error
   */
  spyOnAsyncWithError<K extends keyof T>(
    method: K,
    error: Error = new Error('Mock async method failed')
  ): AsyncMockBuilder<T> {
    if (typeof this.mock[method] === 'function') {
      this.mock[method] = jest.fn().mockRejectedValue(error) as T[K];
      this.spiedMethods.add(method);
    }
    return this;
  }
  
  /**
   * Configure a method to throw an error synchronously
   */
  spyOnSyncWithError<K extends keyof T>(
    method: K,
    error: Error = new Error('Mock sync method failed')
  ): AsyncMockBuilder<T> {
    if (typeof this.mock[method] === 'function') {
      this.mock[method] = jest.fn().mockImplementation(() => {
        throw error;
      }) as T[K];
      this.spiedMethods.add(method);
    }
    return this;
  }
  
  /**
   * Configure method call counts and return values
   */
  withCallPattern<K extends keyof T>(
    method: K,
    pattern: {
      callCount?: number;
      returnValue?: any;
      returnValueOnce?: any[];
      resolvedValue?: any;
      rejectedValue?: any;
    }
  ): AsyncMockBuilder<T> {
    const mock = this.mock[method] as jest.MockedFunction<any>;
    if (mock && typeof mock.mockReturnValue === 'function') {
      if (pattern.callCount !== undefined) {
        mock.mockImplementation(() => {
          if (mock.mock.calls.length >= pattern.callCount!) {
            throw new Error(`Method ${String(method)} called more than expected ${pattern.callCount} times`);
          }
          return pattern.returnValue;
        });
      }
      
      if (pattern.returnValue !== undefined) {
        mock.mockReturnValue(pattern.returnValue);
      }
      
      if (pattern.returnValueOnce) {
        pattern.returnValueOnce.forEach(value => mock.mockReturnValueOnce(value));
      }
      
      if (pattern.resolvedValue !== undefined) {
        mock.mockResolvedValue(pattern.resolvedValue);
      }
      
      if (pattern.rejectedValue !== undefined) {
        mock.mockRejectedValue(pattern.rejectedValue);
      }
    }
    return this;
  }
  
  /**
   * Build the final mocked object
   */
  build(): T & MockedObject<T> {
    return this.mock as T & MockedObject<T>;
  }
  
  /**
   * Get list of methods that were spied on
   */
  getSpiedMethods(): (keyof T)[] {
    return Array.from(this.spiedMethods);
  }
}

/**
 * Enhanced MockFactory with proper async support
 */
export class EnhancedMockFactory {
  /**
   * Create a safe mock object with spied methods - FIXED VERSION
   */
  static createSafeMock<T extends Record<string, any>>(
    original: T,
    overrides: Partial<T> = {}
  ): T & MockedObject<T> {
    const mock = { ...original, ...overrides };
    
    // Create proper mocks for functions using jest.fn() instead of jest.spyOn
    for (const [key, value] of Object.entries(mock)) {
      if (typeof value === 'function') {
        // FIXED: Use jest.fn().mockImplementation() instead of jest.spyOn with wrong syntax
        mock[key] = jest.fn().mockImplementation(value);
      }
    }
    
    return mock as T & MockedObject<T>;
  }

  /**
   * Create a spy function with proper typing
   */
  static createSpy<T extends (...args: any[]) => any>(
    implementation?: T
  ): MockedFunction<T> {
    if (implementation) {
      return jest.fn().mockImplementation(implementation) as MockedFunction<T>;
    }
    return jest.fn() as MockedFunction<T>;
  }

  /**
   * Create a failing mock that throws/rejects for specified methods
   */
  static createFailingMock<T extends Record<string, any>>(
    original: T,
    failingMethods: (keyof T)[],
    error: Error = new Error('Mock failure')
  ): T & MockedObject<T> {
    const mock = this.createSafeMock(original);
    
    for (const method of failingMethods) {
      const originalMethod = original[method];
      if (typeof originalMethod === 'function') {
        // Determine if the method is async by checking if it returns a Promise
        const isAsync = originalMethod.constructor.name === 'AsyncFunction' || 
                       (originalMethod.toString().includes('async') || 
                        originalMethod.toString().includes('Promise'));
        
        if (isAsync) {
          (mock[method] as jest.MockedFunction<any>).mockRejectedValue(error);
        } else {
          (mock[method] as jest.MockedFunction<any>).mockImplementation(() => {
            throw error;
          });
        }
      }
    }

    return mock;
  }

  /**
   * Create a partial mock that only mocks specified methods
   */
  static createPartialMock<T extends Record<string, any>>(
    original: T,
    methodsToMock: (keyof T)[],
    implementations: Partial<Record<keyof T, any>> = {}
  ): T & Partial<MockedObject<T>> {
    const mock = { ...original };
    
    for (const method of methodsToMock) {
      if (typeof original[method] === 'function') {
        const implementation = implementations[method] || original[method];
        mock[method] = jest.fn().mockImplementation(implementation);
      }
    }
    
    return mock as T & Partial<MockedObject<T>>;
  }

  /**
   * Create mock with call tracking and assertion helpers
   */
  static createTrackedMock<T extends Record<string, any>>(
    original: T,
    overrides: Partial<T> = {}
  ): T & MockedObject<T> & {
    getCallCount(method: keyof T): number;
    getLastCall(method: keyof T): any[] | undefined;
    getAllCalls(method: keyof T): any[][];
    resetCalls(method?: keyof T): void;
    assertCalledWith(method: keyof T, ...args: any[]): void;
    assertCalledTimes(method: keyof T, times: number): void;
  } {
    const mock = this.createSafeMock(original, overrides);
    
    const trackingMethods = {
      getCallCount(method: keyof T): number {
        const mockFn = mock[method] as jest.MockedFunction<any>;
        return mockFn?.mock?.calls?.length || 0;
      },
      
      getLastCall(method: keyof T): any[] | undefined {
        const mockFn = mock[method] as jest.MockedFunction<any>;
        const calls = mockFn?.mock?.calls;
        return calls?.[calls.length - 1];
      },
      
      getAllCalls(method: keyof T): any[][] {
        const mockFn = mock[method] as jest.MockedFunction<any>;
        return mockFn?.mock?.calls || [];
      },
      
      resetCalls(method?: keyof T): void {
        if (method) {
          const mockFn = mock[method] as jest.MockedFunction<any>;
          mockFn?.mockClear?.();
        } else {
          Object.keys(mock).forEach(key => {
            const mockFn = mock[key] as jest.MockedFunction<any>;
            mockFn?.mockClear?.();
          });
        }
      },
      
      assertCalledWith(method: keyof T, ...args: any[]): void {
        const mockFn = mock[method] as jest.MockedFunction<any>;
        expect(mockFn).toHaveBeenCalledWith(...args);
      },
      
      assertCalledTimes(method: keyof T, times: number): void {
        const mockFn = mock[method] as jest.MockedFunction<any>;
        expect(mockFn).toHaveBeenCalledTimes(times);
      },
    };
    
    return Object.assign(mock, trackingMethods);
  }
}

/**
 * Async testing utilities
 */
export class AsyncTestUtils {
  /**
   * Test async function with proper error handling and timeout
   */
  static async testAsyncFunction<T>(
    fn: () => Promise<T>,
    options: {
      timeout?: number;
      expectError?: boolean;
      errorType?: new (...args: any[]) => Error;
      errorMessage?: string;
    } = {}
  ): Promise<T | Error> {
    const { 
      timeout = 5000, 
      expectError = false, 
      errorType,
      errorMessage 
    } = options;
    
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Async operation timed out after ${timeout}ms`)), timeout)
        )
      ]);
      
      if (expectError) {
        throw new Error('Expected function to throw, but it succeeded');
      }
      
      return result;
    } catch (error) {
      if (!expectError) {
        throw error;
      }
      
      if (errorType && !(error instanceof errorType)) {
        throw new Error(
          `Expected error of type ${errorType.name}, got ${error.constructor.name}: ${error.message}`
        );
      }
      
      if (errorMessage && !error.message.includes(errorMessage)) {
        throw new Error(
          `Expected error message to include "${errorMessage}", got: ${error.message}`
        );
      }
      
      return error as Error;
    }
  }

  /**
   * Wait for condition with proper error handling
   */
  static async waitFor(
    condition: () => boolean | Promise<boolean>,
    options: { 
      timeout?: number; 
      interval?: number; 
      message?: string;
      onTimeout?: () => void;
    } = {}
  ): Promise<void> {
    const { 
      timeout = 5000, 
      interval = 100, 
      message = 'Condition not met',
      onTimeout
    } = options;
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    if (onTimeout) {
      onTimeout();
    }
    
    throw new Error(`${message} (timeout: ${timeout}ms)`);
  }

  /**
   * Race multiple async operations
   */
  static async raceWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage?: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(timeoutMessage || `Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }
}

// Export the fixed MockFactory for backward compatibility
export const MockFactory = EnhancedMockFactory;