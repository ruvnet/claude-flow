const { TestHarness } = require('../test-harness');
const assert = require('assert');

describe('Batch Operations Unit Tests', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
    harness.createMockProject('standard');
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Parallel File Operations', () => {
    it('should read multiple files in parallel', async () => {
      const files = ['src/index.js', 'src/utils.js', 'package.json'];
      const results = await harness.batchReadFiles(files);
      
      assert.strictEqual(results.successful.length, 3);
      assert.strictEqual(results.failed.length, 0);
      assert.strictEqual(results.successRate, 1);
    });

    it('should handle partial failures gracefully', async () => {
      const files = ['src/index.js', 'non-existent.js', 'package.json'];
      const results = await harness.batchReadFiles(files);
      
      assert.strictEqual(results.successful.length, 2);
      assert.strictEqual(results.failed.length, 1);
      assert.strictEqual(results.successRate, 2/3);
      assert(results.failed[0].error.message.includes('ENOENT'));
    });

    it('should write multiple files concurrently', async () => {
      const filesToWrite = {
        'src/new1.js': 'console.log("File 1");',
        'src/new2.js': 'console.log("File 2");',
        'src/new3.js': 'console.log("File 3");'
      };
      
      const results = await harness.batchWriteFiles(filesToWrite);
      assert.strictEqual(results.successful.length, 3);
      
      // Verify files were written
      for (const [path, content] of Object.entries(filesToWrite)) {
        const readContent = await harness.mockReadFile(path);
        assert.strictEqual(readContent, content);
      }
    });

    it('should respect concurrency limits', async () => {
      harness.concurrencyLimit = 2;
      harness.mockDelay = 100; // Increase delay to measure concurrency
      
      const files = Array.from({ length: 6 }, (_, i) => `file${i}.js`);
      files.forEach(f => harness.mockFS.set(f, `content of ${f}`));
      
      const startTime = Date.now();
      await harness.batchReadFiles(files);
      const duration = Date.now() - startTime;
      
      // With concurrency limit of 2, 6 files should take ~300ms (3 batches)
      assert(duration >= 300 && duration < 400, 
        `Expected duration ~300ms, got ${duration}ms`);
    });
  });

  describe('Concurrent Search Operations', () => {
    it('should search multiple patterns concurrently', async () => {
      const patterns = ['console', 'export', 'describe'];
      const results = await harness.batchSearch(patterns);
      
      assert.strictEqual(results.successful.length, 3);
      assert(results.successful[0].length > 0); // Should find console.log
      assert(results.successful[1].length > 0); // Should find export
      assert(results.successful[2].length > 0); // Should find describe
    });

    it('should search with path filtering', async () => {
      const patterns = ['test'];
      const results = await harness.batchSearch(patterns, 'test/');
      
      assert(results.successful[0].every(r => r.file.includes('test/')));
    });

    it('should handle complex regex patterns', async () => {
      const patterns = [
        'module\\d+',           // Match module followed by digits
        'export\\s+const',      // Match export const with whitespace
        '\\{[^}]+\\}'          // Match content within braces
      ];
      
      harness.createMockProject('large');
      const results = await harness.batchSearch(patterns);
      
      assert.strictEqual(results.successful.length, 3);
      assert(results.successful[0].length > 0); // Should find module patterns
    });
  });

  describe('Batch Task Execution', () => {
    it('should execute multiple tasks with proper error handling', async () => {
      const tasks = [
        async () => 'Task 1 complete',
        async () => { throw new Error('Task 2 failed'); },
        async () => 'Task 3 complete',
        async () => 'Task 4 complete'
      ];
      
      const results = await harness.executeBatch(tasks, async (task) => await task());
      
      assert.strictEqual(results.successful.length, 3);
      assert.strictEqual(results.failed.length, 1);
      assert.strictEqual(results.failed[0].error.message, 'Task 2 failed');
    });

    it('should maintain task order in results', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => async () => i);
      const results = await harness.executeBatch(tasks, async (task) => await task());
      
      results.successful.forEach((result, index) => {
        assert.strictEqual(result, index);
      });
    });
  });

  describe('Performance Characteristics', () => {
    it('should demonstrate parallel speedup', async () => {
      harness.createMockProject('large');
      const files = Array.from({ length: 20 }, (_, i) => `src/module${i}.js`);
      
      // Sequential simulation
      harness.concurrencyLimit = 1;
      const sequentialStart = Date.now();
      await harness.batchReadFiles(files);
      const sequentialTime = Date.now() - sequentialStart;
      
      // Parallel execution
      harness.concurrencyLimit = 5;
      const parallelStart = Date.now();
      await harness.batchReadFiles(files);
      const parallelTime = Date.now() - parallelStart;
      
      // Parallel should be significantly faster
      const speedup = sequentialTime / parallelTime;
      assert(speedup > 2, `Expected speedup > 2x, got ${speedup.toFixed(2)}x`);
    });

    it('should track performance metrics accurately', async () => {
      const files = ['src/index.js', 'src/utils.js', 'package.json'];
      await harness.batchReadFiles(files);
      
      const report = harness.getPerformanceReport();
      assert(report.batchReadFiles);
      assert.strictEqual(report.batchReadFiles.totalItemsProcessed, 3);
      assert(report.batchReadFiles.averageThroughput);
    });
  });

  describe('Resource Utilization', () => {
    it('should measure resource usage for batch operations', async () => {
      harness.createMockProject('large');
      const files = Array.from({ length: 50 }, (_, i) => `src/module${i}.js`);
      
      const { metrics } = await harness.measureResourceUsage(
        async () => await harness.batchReadFiles(files)
      );
      
      assert(metrics.duration > 0);
      assert(metrics.memory.heapUsed !== undefined);
      assert(metrics.cpu.user >= 0);
    });

    it('should handle memory efficiently with large batches', async () => {
      const largeContent = 'x'.repeat(10000); // 10KB per file
      const files = Array.from({ length: 100 }, (_, i) => {
        const path = `large${i}.txt`;
        harness.mockFS.set(path, largeContent);
        return path;
      });
      
      const { metrics } = await harness.measureResourceUsage(
        async () => await harness.batchReadFiles(files)
      );
      
      // Memory usage should be reasonable (not loading all at once)
      const memoryMB = metrics.memory.heapUsed / 1024 / 1024;
      assert(memoryMB < 50, `Memory usage too high: ${memoryMB.toFixed(2)}MB`);
    });
  });
});