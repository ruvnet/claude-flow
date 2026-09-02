// init-performance.test.js - Performance tests for init operations
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import { performance } from 'perf_hooks';
import { initCommand } from '../../src/cli/simple-commands/init/index.js';
import { batchInitCommand } from '../../src/cli/simple-commands/init/batch-init.js';

const TEST_DIR = '/tmp/claude-flow-perf-test';

describe('Init Performance Tests', () => {
  beforeEach(async () => {
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (err) {
      // Directory might not exist
    }
    await fs.mkdir(TEST_DIR, { recursive: true });
    process.chdir(TEST_DIR);
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Single Project Performance', () => {
    it('should initialize a project under 5 seconds', async () => {
      const startTime = performance.now();

      await initCommand([], {});

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(5000); // 5 seconds
    });

    it('should handle dry-run mode very quickly', async () => {
      const startTime = performance.now();

      await initCommand(['--dry-run'], { dryRun: true });

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000); // 1 second for dry run
    });

    it('should not consume excessive memory', async () => {
      const initialMemory = process.memoryUsage();

      await initCommand([], {});

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Should not use more than 50MB for single project
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });

  describe('Batch Performance', () => {
    it('should handle 10 projects under 30 seconds', async () => {
      const projects = Array.from({ length: 10 }, (_, i) => `perf-project-${i}`);

      const startTime = performance.now();

      await batchInitCommand(projects, {
        progressTracking: false,
        performanceMonitoring: false,
      });

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(30000); // 30 seconds
    });

    it('should show performance improvement with parallelization', async () => {
      const projects = Array.from({ length: 5 }, (_, i) => `parallel-${i}`);

      // Sequential execution
      const sequentialStart = performance.now();
      await batchInitCommand([...projects.map(p => `seq-${p}`)], {
        parallel: false,
        progressTracking: false,
        performanceMonitoring: false,
      });
      const sequentialTime = performance.now() - sequentialStart;

      // Parallel execution
      const parallelStart = performance.now();
      await batchInitCommand([...projects.map(p => `par-${p}`)], {
        parallel: true,
        maxConcurrency: 3,
        progressTracking: false,
        performanceMonitoring: false,
      });
      const parallelTime = performance.now() - parallelStart;

      // Parallel should be faster (allowing for some variance)
      expect(parallelTime).toBeLessThan(sequentialTime * 0.8);
    });

    it('should scale linearly with project count', async () => {
      const smallBatch = Array.from({ length: 3 }, (_, i) => `small-${i}`);
      const largeBatch = Array.from({ length: 9 }, (_, i) => `large-${i}`);

      // Small batch timing
      const smallStart = performance.now();
      await batchInitCommand(smallBatch, {
        progressTracking: false,
        performanceMonitoring: false,
      });
      const smallTime = performance.now() - smallStart;

      // Large batch timing
      const largeStart = performance.now();
      await batchInitCommand(largeBatch, {
        progressTracking: false,
        performanceMonitoring: false,
      });
      const largeTime = performance.now() - largeStart;

      // Large batch should be roughly 3x slower (3x more projects)
      // Allow for some overhead and variance
      expect(largeTime).toBeLessThan(smallTime * 4);
      expect(largeTime).toBeGreaterThan(smallTime * 2);
    });
  });

  describe('Memory Efficiency', () => {
    it('should not leak memory across multiple operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      const memorySnapshots = [];

      // Perform multiple operations
      for (let i = 0; i < 5; i++) {
        await initCommand([], { force: true });

        if (global.gc) global.gc(); // Force garbage collection

        memorySnapshots.push(process.memoryUsage().heapUsed);
      }

      const finalMemory = memorySnapshots[memorySnapshots.length - 1];
      const memoryGrowth = finalMemory - initialMemory;

      // Memory growth should be minimal
      expect(memoryGrowth).toBeLessThan(20 * 1024 * 1024); // 20MB max growth

      // Memory should stabilize (not grow continuously)
      const lastThree = memorySnapshots.slice(-3);
      const memoryVariance = Math.max(...lastThree) - Math.min(...lastThree);
      expect(memoryVariance).toBeLessThan(10 * 1024 * 1024); // 10MB variance
    });

    it('should handle large template files efficiently', async () => {
      // Mock large template content
      const originalCreateClaudeMd = jest.requireActual(
        '../../src/cli/simple-commands/init/templates/claude-md.js'
      ).createFullClaudeMd;

      const mockCreateClaudeMd = jest.fn(() => {
        // Create a large template (1MB)
        return 'x'.repeat(1024 * 1024);
      });

      jest.doMock('../../src/cli/simple-commands/init/templates/claude-md.js', () => ({
        createFullClaudeMd: mockCreateClaudeMd,
        createSparcClaudeMd: mockCreateClaudeMd,
        createMinimalClaudeMd: mockCreateClaudeMd,
        createOptimizedSparcClaudeMd: mockCreateClaudeMd,
      }));

      const startMemory = process.memoryUsage().heapUsed;

      await initCommand([], {});

      const endMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = endMemory - startMemory;

      // Should not hold large templates in memory unnecessarily
      expect(memoryIncrease).toBeLessThan(5 * 1024 * 1024); // 5MB
    });
  });

  describe('File System Performance', () => {
    it('should efficiently handle many small files', async () => {
      const startTime = performance.now();

      await initCommand([], {});

      // Count created files
      async function countFiles(dir) {
        let count = 0;
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile()) {
              count++;
            } else if (entry.isDirectory()) {
              count += await countFiles(`${dir}/${entry.name}`);
            }
          }
        } catch (err) {
          // Directory might not exist
        }
        return count;
      }

      const fileCount = await countFiles('.');
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should handle many files efficiently
      expect(fileCount).toBeGreaterThan(10); // Should create many files
      expect(duration / fileCount).toBeLessThan(100); // Less than 100ms per file
    });

    it('should batch file operations effectively', async () => {
      const writeOperations = [];
      const originalWriteFile = fs.writeFile;

      // Mock to track write operations
      fs.writeFile = jest.fn(async (...args) => {
        writeOperations.push(Date.now());
        return originalWriteFile.apply(fs, args);
      });

      const startTime = performance.now();
      await initCommand([], {});
      const endTime = performance.now();

      // Restore original function
      fs.writeFile = originalWriteFile;

      // Analyze operation timing
      const operationTimes = writeOperations.map((time, index) =>
        index > 0 ? time - writeOperations[index - 1] : 0
      ).slice(1);

      // Most operations should be close together (batched)
      const averageGap = operationTimes.reduce((a, b) => a + b, 0) / operationTimes.length;
      expect(averageGap).toBeLessThan(50); // Average gap less than 50ms
    });
  });

  describe('Concurrency Performance', () => {
    it('should respect concurrency limits without performance penalty', async () => {
      const projects = Array.from({ length: 8 }, (_, i) => `concurrent-${i}`);

      // Test different concurrency levels
      const concurrencyLevels = [1, 2, 4];
      const timings = [];

      for (const concurrency of concurrencyLevels) {
        const projectNames = projects.map(p => `${p}-${concurrency}`);

        const startTime = performance.now();
        await batchInitCommand(projectNames, {
          parallel: true,
          maxConcurrency: concurrency,
          progressTracking: false,
          performanceMonitoring: false,
        });
        const endTime = performance.now();

        timings.push({
          concurrency,
          time: endTime - startTime,
        });
      }

      // Higher concurrency should generally be faster
      // (allowing for system limitations and variance)
      const sequential = timings.find(t => t.concurrency === 1);
      const parallel = timings.find(t => t.concurrency === 4);

      expect(parallel.time).toBeLessThan(sequential.time * 0.9);
    });

    it('should handle resource contention gracefully', async () => {
      const projects = Array.from({ length: 20 }, (_, i) => `contention-${i}`);

      const startTime = performance.now();

      await batchInitCommand(projects, {
        parallel: true,
        maxConcurrency: 10, // High concurrency to test contention
        progressTracking: false,
        performanceMonitoring: false,
      });

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete without hanging or excessive time
      expect(duration).toBeLessThan(60000); // 1 minute max
    });
  });

  describe('Edge Case Performance', () => {
    it('should handle deep directory structures efficiently', async () => {
      // Create a deep directory structure
      const deepPath = Array.from({ length: 10 }, (_, i) => `level${i}`).join('/');
      await fs.mkdir(deepPath, { recursive: true });
      process.chdir(deepPath);

      const startTime = performance.now();
      await initCommand([], {});
      const endTime = performance.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(10000); // 10 seconds max for deep paths
    });

    it('should handle many existing files efficiently', async () => {
      // Create many existing files
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(fs.writeFile(`existing-${i}.txt`, 'content'));
      }
      await Promise.all(promises);

      const startTime = performance.now();
      await initCommand([], {}); // Should skip existing files
      const endTime = performance.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(8000); // 8 seconds max with many existing files
    });
  });

  describe('CPU and Resource Usage', () => {
    it('should not block the event loop excessively', async () => {
      let eventLoopBlocked = false;

      // Set up a timer to detect event loop blocking
      const timer = setTimeout(() => {
        eventLoopBlocked = true;
      }, 100);

      await initCommand([], {});

      clearTimeout(timer);

      // Event loop should not be blocked for more than 100ms
      expect(eventLoopBlocked).toBe(false);
    });

    it('should distribute CPU usage across time', async () => {
      const cpuUsageSnapshots = [];
      const startUsage = process.cpuUsage();

      const timer = setInterval(() => {
        cpuUsageSnapshots.push(process.cpuUsage(startUsage));
      }, 100);

      await batchInitCommand(
        Array.from({ length: 5 }, (_, i) => `cpu-test-${i}`),
        {
          progressTracking: false,
          performanceMonitoring: false,
        }
      );

      clearInterval(timer);

      // CPU usage should be distributed (not all at once)
      expect(cpuUsageSnapshots.length).toBeGreaterThan(1);

      // Should not max out CPU for extended periods
      const avgCpuPercent = cpuUsageSnapshots.reduce((acc, snapshot) => {
        return acc + (snapshot.user + snapshot.system) / 1000; // Convert to ms
      }, 0) / cpuUsageSnapshots.length;

      expect(avgCpuPercent).toBeLessThan(1000); // Less than 1 second average CPU time per 100ms
    });
  });
});