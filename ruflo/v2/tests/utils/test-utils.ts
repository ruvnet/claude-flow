import { jest } from '@jest/globals';

// Async test utilities
export const AsyncTestUtils = {
  delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  waitFor: async (condition: () => boolean, timeout = 5000, interval = 100) => {
    const startTime = Date.now();
    while (!condition()) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Condition not met within timeout');
      }
      await AsyncTestUtils.delay(interval);
    }
  }
};

// Memory test utilities
export const MemoryTestUtils = {
  checkMemoryLeak: async (fn: () => Promise<void>) => {
    const initialMemory = process.memoryUsage().heapUsed;
    await fn();
    global.gc?.();
    const finalMemory = process.memoryUsage().heapUsed;
    const leaked = finalMemory > initialMemory * 1.5;
    return { leaked, initialMemory, finalMemory };
  }
};

// Performance test utilities
export const PerformanceTestUtils = {
  benchmark: async (fn: () => any | Promise<any>, options = { iterations: 100, concurrency: 1 }) => {
    const times: number[] = [];
    
    for (let i = 0; i < options.iterations; i++) {
      const start = performance.now();
      if (options.concurrency > 1) {
        const promises = Array(options.concurrency).fill(null).map(() => fn());
        await Promise.all(promises);
      } else {
        await fn();
      }
      const end = performance.now();
      times.push(end - start);
    }
    
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    
    return { stats: { mean, min, max, iterations: options.iterations } };
  },
  
  loadTest: async (fn: () => Promise<any>, options: any) => {
    const startTime = Date.now();
    let totalRequests = 0;
    let successfulRequests = 0;
    const responseTimes: number[] = [];
    
    while (Date.now() - startTime < options.duration) {
      const promises = [];
      for (let i = 0; i < options.maxConcurrency; i++) {
        const reqStart = performance.now();
        promises.push(
          fn().then(() => {
            successfulRequests++;
            responseTimes.push(performance.now() - reqStart);
          }).catch(() => {})
        );
        totalRequests++;
      }
      await Promise.all(promises);
      await AsyncTestUtils.delay(1000 / options.requestsPerSecond);
    }
    
    const averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    
    return {
      totalRequests,
      successfulRequests,
      averageResponseTime
    };
  }
};

// Test assertions
export const TestAssertions = {
  assertInRange: (value: number, min: number, max: number) => {
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  },
  
  assertThrowsAsync: async (fn: () => Promise<any>, errorType: any, messageIncludes?: string) => {
    try {
      await fn();
      throw new Error('Expected function to throw');
    } catch (error: any) {
      if (errorType && !(error instanceof errorType)) {
        throw new Error(`Expected error to be instance of ${errorType.name}, got ${error.constructor.name}`);
      }
      if (messageIncludes && !error.message.includes(messageIncludes)) {
        throw new Error(`Expected error message to include "${messageIncludes}", got "${error.message}"`);
      }
    }
  }
};

// Mock factory
export const MockFactory = {
  createMockAgent: (overrides?: any) => ({
    id: 'mock-agent-' + Math.random(),
    type: 'test',
    capabilities: ['test'],
    status: 'idle',
    execute: jest.fn(),
    ...overrides
  }),
  
  createMockTask: (overrides?: any) => ({
    id: 'mock-task-' + Math.random(),
    description: 'Mock task',
    status: 'pending',
    priority: 'medium',
    createdAt: new Date(),
    ...overrides
  })
};

// File system test utilities
export const FileSystemTestUtils = {
  createTempDir: async (prefix: string) => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    
    const tempDir = path.join(os.tmpdir(), prefix + Date.now());
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  },
  
  cleanup: async (paths: string[]) => {
    const fs = await import('fs/promises');
    for (const path of paths) {
      try {
        await fs.rm(path, { recursive: true, force: true });
      } catch (e) {
        // Ignore errors
      }
    }
  }
};

// Test data generator
export const TestDataGenerator = {
  randomString: (length: number) => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },
  
  largeDataset: (size: number) => {
    return Array.from({ length: size }, (_, i) => ({
      id: `item-${i}`,
      data: TestDataGenerator.randomString(100),
      timestamp: Date.now() - Math.random() * 1000000
    }));
  }
};