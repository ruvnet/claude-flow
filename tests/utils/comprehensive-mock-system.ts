/// <reference types="jest" />

/**
 * Comprehensive Mock System
 * Advanced mocking capabilities for complex testing scenarios
 */

import { TestEventEmitter } from './test-stability-helpers.js';
import { AsyncTestUtils } from './test-utils.js';

/**
 * Mock behavior types
 */
export type MockBehaviorType = 
  | 'success'
  | 'error'
  | 'timeout'
  | 'delay'
  | 'partial_success'
  | 'intermittent'
  | 'degraded_performance'
  | 'rate_limited'
  | 'circuit_breaker';

/**
 * Mock call information
 */
export interface MockCall {
  timestamp: number;
  method: string;
  args: any[];
  context?: any;
  duration?: number;
  result?: any;
  error?: Error;
}

/**
 * Mock behavior configuration
 */
export interface MockBehaviorConfig {
  type: MockBehaviorType;
  probability?: number; // 0-1, default 1
  delay?: number; // milliseconds
  errorMessage?: string;
  errorType?: string;
  data?: any;
  condition?: (call: MockCall) => boolean;
  responses?: any[]; // For cycling through responses
  degradationFactor?: number; // For degraded performance
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
}

/**
 * Mock configuration
 */
export interface MockConfig {
  name: string;
  defaultBehavior: MockBehaviorConfig;
  behaviors: Map<string, MockBehaviorConfig>; // method-specific behaviors
  middleware: Array<(call: MockCall) => Promise<MockCall>>;
  validation: {
    strictArgs?: boolean;
    requiredMethods?: string[];
    forbiddenMethods?: string[];
  };
  lifecycle: {
    setup?: () => Promise<void>;
    teardown?: () => Promise<void>;
    onCall?: (call: MockCall) => void;
    onError?: (error: Error, call: MockCall) => void;
  };
}

/**
 * Mock state tracking
 */
export interface MockState {
  calls: MockCall[];
  callCounts: Map<string, number>;
  lastCall?: MockCall;
  errors: Array<{ error: Error; call: MockCall; timestamp: number }>;
  startTime: number;
  isActive: boolean;
  rateLimitWindows: Map<string, { calls: number; windowStart: number }>;
}

/**
 * Advanced mock factory
 */
export class AdvancedMockFactory {
  private mocks: Map<string, EnhancedMock> = new Map();
  private globalMiddleware: Array<(call: MockCall) => Promise<MockCall>> = [];
  private eventBus: TestEventEmitter;

  constructor() {
    this.eventBus = new TestEventEmitter();
  }

  /**
   * Create an enhanced mock with advanced capabilities
   */
  createMock<T = any>(config: MockConfig): EnhancedMock<T> {
    const mock = new EnhancedMock<T>(config, this.eventBus, this.globalMiddleware);
    this.mocks.set(config.name, mock);
    return mock;
  }

  /**
   * Create a database mock with realistic behavior
   */
  createDatabaseMock(name: string, options: {
    latency?: { min: number; max: number };
    errorRate?: number;
    connectionLimit?: number;
    transactionSupport?: boolean;
  } = {}): EnhancedMock {
    const { latency = { min: 10, max: 100 }, errorRate = 0.01, connectionLimit = 10, transactionSupport = true } = options;

    return this.createMock({
      name,
      defaultBehavior: {
        type: 'success',
        delay: latency.min + Math.random() * (latency.max - latency.min)
      },
      behaviors: new Map([
        ['query', {
          type: Math.random() < errorRate ? 'error' : 'success',
          delay: latency.min + Math.random() * (latency.max - latency.min),
          errorMessage: 'Database query failed'
        }],
        ['insert', {
          type: 'success',
          delay: latency.min,
          data: { insertId: Math.floor(Math.random() * 10000), affectedRows: 1 }
        }],
        ['update', {
          type: 'success',
          delay: latency.min,
          data: { affectedRows: Math.floor(Math.random() * 5) + 1 }
        }],
        ['delete', {
          type: 'success',
          delay: latency.min,
          data: { affectedRows: Math.floor(Math.random() * 3) }
        }],
        ['transaction', transactionSupport ? {
          type: 'success',
          delay: latency.min * 2
        } : {
          type: 'error',
          errorMessage: 'Transactions not supported'
        }]
      ]),
      middleware: [
        this.createConnectionLimitMiddleware(connectionLimit),
        this.createQueryValidationMiddleware()
      ],
      validation: {
        strictArgs: true,
        requiredMethods: ['query']
      },
      lifecycle: {
        setup: async () => {
          console.log(`Database mock ${name} initialized`);
        },
        teardown: async () => {
          console.log(`Database mock ${name} cleaned up`);
        }
      }
    });
  }

  /**
   * Create an API mock with HTTP-like behavior
   */
  createAPIMock(name: string, options: {
    baseUrl?: string;
    rateLimits?: { [endpoint: string]: { maxCalls: number; windowMs: number } };
    authRequired?: boolean;
    responseDelay?: number;
  } = {}): EnhancedMock {
    const { baseUrl = 'https://api.example.com', rateLimits = {}, authRequired = false, responseDelay = 50 } = options;

    const behaviors = new Map<string, MockBehaviorConfig>();

    // HTTP method behaviors
    behaviors.set('get', {
      type: 'success',
      delay: responseDelay,
      data: { status: 200, data: { message: 'GET request successful' } }
    });

    behaviors.set('post', {
      type: 'success',
      delay: responseDelay + 20,
      data: { status: 201, data: { id: Math.floor(Math.random() * 1000), created: true } }
    });

    behaviors.set('put', {
      type: 'success',
      delay: responseDelay + 15,
      data: { status: 200, data: { updated: true } }
    });

    behaviors.set('delete', {
      type: 'success',
      delay: responseDelay + 10,
      data: { status: 204, data: null }
    });

    // Add rate limiting behaviors
    Object.entries(rateLimits).forEach(([endpoint, limit]) => {
      behaviors.set(endpoint, {
        type: 'rate_limited',
        rateLimit: limit,
        errorMessage: 'Rate limit exceeded'
      });
    });

    return this.createMock({
      name,
      defaultBehavior: {
        type: 'success',
        delay: responseDelay
      },
      behaviors,
      middleware: [
        authRequired ? this.createAuthMiddleware() : this.createNoOpMiddleware(),
        this.createHTTPHeadersMiddleware(),
        this.createResponseValidationMiddleware()
      ],
      validation: {
        strictArgs: false
      },
      lifecycle: {
        setup: async () => {
          console.log(`API mock ${name} started at ${baseUrl}`);
        }
      }
    });
  }

  /**
   * Create a file system mock
   */
  createFileSystemMock(name: string, options: {
    diskSpace?: number;
    permissions?: { read: boolean; write: boolean; execute: boolean };
    latency?: number;
  } = {}): EnhancedMock {
    const { diskSpace = 1000000, permissions = { read: true, write: true, execute: true }, latency = 5 } = options;

    let usedSpace = 0;
    const files = new Map<string, { content: string; size: number; created: number; modified: number }>();

    return this.createMock({
      name,
      defaultBehavior: {
        type: 'success',
        delay: latency
      },
      behaviors: new Map([
        ['readFile', {
          type: 'success',
          delay: latency,
          condition: () => permissions.read
        }],
        ['writeFile', {
          type: 'success',
          delay: latency * 2,
          condition: (call) => {
            const content = call.args[1] || '';
            const size = Buffer.byteLength(content, 'utf8');
            return permissions.write && (usedSpace + size) <= diskSpace;
          }
        }],
        ['deleteFile', {
          type: 'success',
          delay: latency,
          condition: () => permissions.write
        }],
        ['stat', {
          type: 'success',
          delay: latency / 2
        }]
      ]),
      middleware: [
        this.createFileSystemMiddleware(files, { diskSpace, usedSpace: () => usedSpace })
      ],
      validation: {
        strictArgs: true,
        requiredMethods: ['readFile', 'writeFile']
      },
      lifecycle: {
        setup: async () => {
          files.clear();
          usedSpace = 0;
        }
      }
    });
  }

  /**
   * Create a network service mock with realistic network behavior
   */
  createNetworkServiceMock(name: string, options: {
    latency?: { min: number; max: number };
    packetLoss?: number;
    bandwidth?: number; // bytes per second
    jitter?: number;
  } = {}): EnhancedMock {
    const { 
      latency = { min: 10, max: 200 }, 
      packetLoss = 0.01, 
      bandwidth = 1000000, // 1MB/s
      jitter = 10 
    } = options;

    return this.createMock({
      name,
      defaultBehavior: {
        type: 'success',
        delay: this.calculateNetworkDelay(latency, jitter)
      },
      behaviors: new Map([
        ['send', {
          type: Math.random() < packetLoss ? 'error' : 'success',
          delay: this.calculateNetworkDelay(latency, jitter),
          errorMessage: 'Packet lost'
        }],
        ['receive', {
          type: 'success',
          delay: this.calculateNetworkDelay(latency, jitter)
        }],
        ['upload', {
          type: 'success',
          delay: this.calculateTransferTime(bandwidth, latency)
        }],
        ['download', {
          type: 'success',
          delay: this.calculateTransferTime(bandwidth, latency)
        }]
      ]),
      middleware: [
        this.createBandwidthThrottlingMiddleware(bandwidth),
        this.createNetworkErrorMiddleware(packetLoss)
      ],
      validation: {
        strictArgs: false
      },
      lifecycle: {
        setup: async () => {
          console.log(`Network service mock ${name} initialized`);
        }
      }
    });
  }

  /**
   * Add global middleware that applies to all mocks
   */
  addGlobalMiddleware(middleware: (call: MockCall) => Promise<MockCall>): void {
    this.globalMiddleware.push(middleware);
  }

  /**
   * Reset all mocks
   */
  resetAllMocks(): void {
    for (const mock of this.mocks.values()) {
      mock.reset();
    }
  }

  /**
   * Get mock statistics across all mocks
   */
  getGlobalStatistics(): {
    totalMocks: number;
    totalCalls: number;
    totalErrors: number;
    averageResponseTime: number;
    mocksByType: Record<string, number>;
  } {
    let totalCalls = 0;
    let totalErrors = 0;
    let totalResponseTime = 0;
    const mocksByType: Record<string, number> = {};

    for (const mock of this.mocks.values()) {
      const stats = mock.getStatistics();
      totalCalls += stats.totalCalls;
      totalErrors += stats.totalErrors;
      totalResponseTime += stats.averageResponseTime * stats.totalCalls;
      
      const mockType = mock.getConfig().name.split('-')[0];
      mocksByType[mockType] = (mocksByType[mockType] || 0) + 1;
    }

    return {
      totalMocks: this.mocks.size,
      totalCalls,
      totalErrors,
      averageResponseTime: totalCalls > 0 ? totalResponseTime / totalCalls : 0,
      mocksByType
    };
  }

  private calculateNetworkDelay(latency: { min: number; max: number }, jitter: number): number {
    const baseDelay = latency.min + Math.random() * (latency.max - latency.min);
    const jitterOffset = (Math.random() - 0.5) * jitter * 2;
    return Math.max(0, baseDelay + jitterOffset);
  }

  private calculateTransferTime(bandwidth: number, latency: { min: number; max: number }): number {
    const dataSize = Math.random() * 10000; // Random data size up to 10KB
    const transferTime = (dataSize / bandwidth) * 1000; // Convert to milliseconds
    const networkDelay = this.calculateNetworkDelay(latency, 5);
    return transferTime + networkDelay;
  }

  // Middleware factories
  private createConnectionLimitMiddleware(limit: number) {
    let activeConnections = 0;
    
    return async (call: MockCall): Promise<MockCall> => {
      if (activeConnections >= limit) {
        throw new Error('Connection limit exceeded');
      }
      
      activeConnections++;
      
      // Simulate connection cleanup after call
      setTimeout(() => {
        activeConnections = Math.max(0, activeConnections - 1);
      }, 100);
      
      return call;
    };
  }

  private createQueryValidationMiddleware() {
    return async (call: MockCall): Promise<MockCall> => {
      if (call.method === 'query' && (!call.args[0] || typeof call.args[0] !== 'string')) {
        throw new Error('Invalid query: SQL string required');
      }
      return call;
    };
  }

  private createAuthMiddleware() {
    return async (call: MockCall): Promise<MockCall> => {
      const authHeader = call.context?.headers?.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Authentication required');
      }
      return call;
    };
  }

  private createNoOpMiddleware() {
    return async (call: MockCall): Promise<MockCall> => call;
  }

  private createHTTPHeadersMiddleware() {
    return async (call: MockCall): Promise<MockCall> => {
      call.context = {
        ...call.context,
        headers: {
          'content-type': 'application/json',
          'x-mock-timestamp': Date.now().toString(),
          ...call.context?.headers
        }
      };
      return call;
    };
  }

  private createResponseValidationMiddleware() {
    return async (call: MockCall): Promise<MockCall> => {
      // Validate response format for API calls
      if (call.result && typeof call.result === 'object') {
        if (!call.result.status) {
          call.result.status = 200;
        }
        if (!call.result.data) {
          call.result.data = {};
        }
      }
      return call;
    };
  }

  private createFileSystemMiddleware(
    files: Map<string, any>, 
    diskInfo: { diskSpace: number; usedSpace: () => number }
  ) {
    return async (call: MockCall): Promise<MockCall> => {
      const [filePath, content] = call.args;
      
      switch (call.method) {
        case 'writeFile':
          if (content) {
            const size = Buffer.byteLength(content, 'utf8');
            if (diskInfo.usedSpace() + size > diskInfo.diskSpace) {
              throw new Error('No space left on device');
            }
            files.set(filePath, {
              content,
              size,
              created: Date.now(),
              modified: Date.now()
            });
          }
          break;
          
        case 'readFile':
          const file = files.get(filePath);
          if (!file) {
            throw new Error('File not found');
          }
          call.result = file.content;
          break;
          
        case 'deleteFile':
          if (!files.has(filePath)) {
            throw new Error('File not found');
          }
          files.delete(filePath);
          break;
          
        case 'stat':
          const statFile = files.get(filePath);
          if (!statFile) {
            throw new Error('File not found');
          }
          call.result = {
            size: statFile.size,
            created: statFile.created,
            modified: statFile.modified
          };
          break;
      }
      
      return call;
    };
  }

  private createBandwidthThrottlingMiddleware(bandwidth: number) {
    return async (call: MockCall): Promise<MockCall> => {
      if (call.method === 'upload' || call.method === 'download') {
        const dataSize = call.args[0]?.length || 1000; // Estimate data size
        const throttleDelay = (dataSize / bandwidth) * 1000; // Convert to milliseconds
        await AsyncTestUtils.delay(throttleDelay);
      }
      return call;
    };
  }

  private createNetworkErrorMiddleware(errorRate: number) {
    return async (call: MockCall): Promise<MockCall> => {
      if (Math.random() < errorRate) {
        throw new Error('Network error occurred');
      }
      return call;
    };
  }
}

/**
 * Enhanced mock implementation
 */
export class EnhancedMock<T = any> {
  private config: MockConfig;
  private state: MockState;
  private eventBus: TestEventEmitter;
  private globalMiddleware: Array<(call: MockCall) => Promise<MockCall>>;
  private proxy: T;

  constructor(
    config: MockConfig, 
    eventBus: TestEventEmitter, 
    globalMiddleware: Array<(call: MockCall) => Promise<MockCall>>
  ) {
    this.config = config;
    this.eventBus = eventBus;
    this.globalMiddleware = globalMiddleware;
    this.state = {
      calls: [],
      callCounts: new Map(),
      errors: [],
      startTime: Date.now(),
      isActive: true,
      rateLimitWindows: new Map()
    };

    this.proxy = this.createProxy();
  }

  /**
   * Get the mock proxy object
   */
  getMock(): T {
    return this.proxy;
  }

  /**
   * Get mock configuration
   */
  getConfig(): MockConfig {
    return this.config;
  }

  /**
   * Get current mock state
   */
  getState(): MockState {
    return { ...this.state };
  }

  /**
   * Get call history
   */
  getCallHistory(): MockCall[] {
    return [...this.state.calls];
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalCalls: number;
    totalErrors: number;
    averageResponseTime: number;
    callsByMethod: Record<string, number>;
    errorRate: number;
  } {
    const totalCalls = this.state.calls.length;
    const totalErrors = this.state.errors.length;
    const averageResponseTime = totalCalls > 0 
      ? this.state.calls.reduce((sum, call) => sum + (call.duration || 0), 0) / totalCalls
      : 0;
    
    const callsByMethod: Record<string, number> = {};
    for (const [method, count] of this.state.callCounts) {
      callsByMethod[method] = count;
    }

    const errorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;

    return {
      totalCalls,
      totalErrors,
      averageResponseTime,
      callsByMethod,
      errorRate
    };
  }

  /**
   * Reset mock state
   */
  reset(): void {
    this.state.calls = [];
    this.state.callCounts.clear();
    this.state.errors = [];
    this.state.lastCall = undefined;
    this.state.rateLimitWindows.clear();
    this.state.startTime = Date.now();
  }

  /**
   * Verify that a method was called
   */
  wasCalledWith(method: string, ...args: any[]): boolean {
    return this.state.calls.some(call => 
      call.method === method && 
      JSON.stringify(call.args) === JSON.stringify(args)
    );
  }

  /**
   * Get number of times a method was called
   */
  getCallCount(method: string): number {
    return this.state.callCounts.get(method) || 0;
  }

  /**
   * Wait for a specific method to be called
   */
  async waitForCall(method: string, timeout: number = 5000): Promise<MockCall> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for method ${method} to be called`));
      }, timeout);

      const checkCall = (call: MockCall) => {
        if (call.method === method) {
          clearTimeout(timeoutId);
          resolve(call);
        }
      };

      // Check if method was already called
      const existingCall = this.state.calls.find(call => call.method === method);
      if (existingCall) {
        clearTimeout(timeoutId);
        resolve(existingCall);
        return;
      }

      // Listen for future calls
      this.eventBus.on('mock:call', checkCall);
      
      // Cleanup listener when promise resolves/rejects
      const originalResolve = resolve;
      const originalReject = reject;
      
      resolve = (value) => {
        this.eventBus.removeAllListeners('mock:call');
        originalResolve(value);
      };
      
      reject = (reason) => {
        this.eventBus.removeAllListeners('mock:call');
        originalReject(reason);
      };
    });
  }

  private createProxy(): T {
    return new Proxy({} as T, {
      get: (target, prop: string | symbol) => {
        if (typeof prop === 'symbol') {
          return undefined;
        }

        return async (...args: any[]) => {
          const call: MockCall = {
            timestamp: Date.now(),
            method: prop,
            args: [...args],
            context: {}
          };

          const startTime = performance.now();

          try {
            // Apply global middleware
            let processedCall = call;
            for (const middleware of this.globalMiddleware) {
              processedCall = await middleware(processedCall);
            }

            // Apply local middleware
            for (const middleware of this.config.middleware) {
              processedCall = await middleware(processedCall);
            }

            // Get behavior for this method
            const behavior = this.config.behaviors.get(prop) || this.config.defaultBehavior;

            // Check rate limiting
            if (behavior.rateLimit) {
              this.checkRateLimit(prop, behavior.rateLimit);
            }

            // Execute behavior
            const result = await this.executeBehavior(behavior, processedCall);
            
            processedCall.result = result;
            processedCall.duration = performance.now() - startTime;

            // Record the call
            this.recordCall(processedCall);

            // Emit event
            this.eventBus.emit('mock:call', processedCall);

            // Lifecycle callback
            if (this.config.lifecycle.onCall) {
              this.config.lifecycle.onCall(processedCall);
            }

            return result;

          } catch (error) {
            const err = error as Error;
            call.error = err;
            call.duration = performance.now() - startTime;

            // Record error
            this.state.errors.push({
              error: err,
              call,
              timestamp: Date.now()
            });

            // Lifecycle callback
            if (this.config.lifecycle.onError) {
              this.config.lifecycle.onError(err, call);
            }

            throw error;
          }
        };
      }
    });
  }

  private async executeBehavior(behavior: MockBehaviorConfig, call: MockCall): Promise<any> {
    // Check condition if specified
    if (behavior.condition && !behavior.condition(call)) {
      throw new Error('Behavior condition not met');
    }

    // Check probability
    if (behavior.probability !== undefined && Math.random() > behavior.probability) {
      // Fall back to default behavior
      return this.executeBehavior(this.config.defaultBehavior, call);
    }

    // Apply delay
    if (behavior.delay) {
      await AsyncTestUtils.delay(behavior.delay);
    }

    // Execute behavior based on type
    switch (behavior.type) {
      case 'success':
        return behavior.data || { success: true };

      case 'error':
        throw new Error(behavior.errorMessage || 'Mock error');

      case 'timeout':
        await AsyncTestUtils.delay(behavior.delay || 30000);
        throw new Error('Operation timed out');

      case 'partial_success':
        if (Math.random() < 0.5) {
          return { ...behavior.data, partial: true };
        } else {
          throw new Error(behavior.errorMessage || 'Partial failure');
        }

      case 'intermittent':
        if (Math.random() < 0.3) {
          throw new Error(behavior.errorMessage || 'Intermittent failure');
        }
        return behavior.data || { success: true };

      case 'degraded_performance':
        const degradationDelay = (behavior.delay || 100) * (behavior.degradationFactor || 3);
        await AsyncTestUtils.delay(degradationDelay);
        return behavior.data || { success: true, degraded: true };

      case 'rate_limited':
        throw new Error(behavior.errorMessage || 'Rate limit exceeded');

      case 'circuit_breaker':
        // Simple circuit breaker implementation
        const errorRate = this.getStatistics().errorRate;
        if (errorRate > 0.5) {
          throw new Error('Circuit breaker open');
        }
        return behavior.data || { success: true };

      default:
        return behavior.data || { success: true };
    }
  }

  private checkRateLimit(method: string, rateLimit: { maxCalls: number; windowMs: number }): void {
    const now = Date.now();
    const window = this.state.rateLimitWindows.get(method);

    if (!window || (now - window.windowStart) > rateLimit.windowMs) {
      // New window
      this.state.rateLimitWindows.set(method, {
        calls: 1,
        windowStart: now
      });
    } else {
      // Existing window
      window.calls++;
      if (window.calls > rateLimit.maxCalls) {
        throw new Error(`Rate limit exceeded for method ${method}`);
      }
    }
  }

  private recordCall(call: MockCall): void {
    this.state.calls.push(call);
    this.state.lastCall = call;
    
    const currentCount = this.state.callCounts.get(call.method) || 0;
    this.state.callCounts.set(call.method, currentCount + 1);
  }
}