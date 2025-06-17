const { TestHarness } = require('../test-harness');
const assert = require('assert');

describe('Parallel Utilities Unit Tests', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Concurrency Control', () => {
    it('should limit concurrent operations to specified limit', async () => {
      const operations = [];
      let activeCount = 0;
      let maxActive = 0;
      
      // Create operations that track concurrency
      const items = Array.from({ length: 10 }, (_, i) => i);
      const trackingOperation = async (item) => {
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        await harness.simulateDelay(50);
        activeCount--;
        return item * 2;
      };
      
      harness.concurrencyLimit = 3;
      await harness.executeBatch(items, trackingOperation);
      
      assert(maxActive <= 3, `Max active operations (${maxActive}) exceeded limit (3)`);
    });

    it('should dynamically adjust concurrency based on system resources', async () => {
      // Simulate different concurrency limits
      const testCases = [1, 3, 5, 10];
      const results = {};
      
      for (const limit of testCases) {
        harness.concurrencyLimit = limit;
        const items = Array.from({ length: 20 }, (_, i) => i);
        
        const start = Date.now();
        await harness.executeBatch(items, async (item) => {
          await harness.simulateDelay(10);
          return item;
        });
        const duration = Date.now() - start;
        
        results[limit] = duration;
      }
      
      // Higher concurrency should result in faster completion
      assert(results[10] < results[1], 'Higher concurrency should be faster');
      assert(results[5] < results[3], 'Concurrency scaling should improve performance');
    });
  });

  describe('Error Recovery', () => {
    it('should continue processing after individual failures', async () => {
      const items = Array.from({ length: 10 }, (_, i) => i);
      const operation = async (item) => {
        if (item % 3 === 0) {
          throw new Error(`Item ${item} failed`);
        }
        return item * 2;
      };
      
      const results = await harness.executeBatch(items, operation);
      
      // Items 0, 3, 6, 9 should fail
      assert.strictEqual(results.failed.length, 4);
      assert.strictEqual(results.successful.length, 6);
      
      // Verify successful items were processed correctly
      const expectedSuccessful = [2, 4, 8, 10, 14, 16];
      assert.deepStrictEqual(results.successful, expectedSuccessful);
    });

    it('should provide detailed error information', async () => {
      const items = ['valid', 'error', 'valid'];
      const operation = async (item) => {
        if (item === 'error') {
          const error = new Error('Detailed error message');
          error.code = 'TEST_ERROR';
          error.details = { item, timestamp: Date.now() };
          throw error;
        }
        return item.toUpperCase();
      };
      
      const results = await harness.executeBatch(items, operation);
      
      assert.strictEqual(results.failed.length, 1);
      const failure = results.failed[0];
      assert.strictEqual(failure.index, 1);
      assert.strictEqual(failure.error.message, 'Detailed error message');
      assert.strictEqual(failure.error.code, 'TEST_ERROR');
      assert(failure.error.details);
    });
  });

  describe('Batch Chunking', () => {
    it('should process items in correct chunk sizes', async () => {
      const processedChunks = [];
      let currentChunk = [];
      
      const items = Array.from({ length: 17 }, (_, i) => i);
      const operation = async (item) => {
        currentChunk.push(item);
        if (currentChunk.length === harness.concurrencyLimit || 
            item === items[items.length - 1]) {
          processedChunks.push([...currentChunk]);
          currentChunk = [];
        }
        return item;
      };
      
      harness.concurrencyLimit = 5;
      await harness.executeBatch(items, operation);
      
      // Should have 4 chunks: [5, 5, 5, 2]
      assert.strictEqual(processedChunks.length, 4);
      assert.strictEqual(processedChunks[0].length, 5);
      assert.strictEqual(processedChunks[1].length, 5);
      assert.strictEqual(processedChunks[2].length, 5);
      assert.strictEqual(processedChunks[3].length, 2);
    });

    it('should maintain order within chunks', async () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const results = await harness.executeBatch(items, async (item) => {
        await harness.simulateDelay(Math.random() * 20);
        return item;
      });
      
      // Results should maintain original order
      results.successful.forEach((value, index) => {
        assert.strictEqual(value, index);
      });
    });
  });

  describe('Promise Management', () => {
    it('should handle mixed sync/async operations', async () => {
      const items = Array.from({ length: 10 }, (_, i) => i);
      const operation = (item) => {
        // Mix of sync and async operations
        if (item % 2 === 0) {
          return item * 2; // Sync
        } else {
          return new Promise(resolve => {
            setTimeout(() => resolve(item * 3), 10); // Async
          });
        }
      };
      
      const results = await harness.executeBatch(items, operation);
      
      assert.strictEqual(results.successful.length, 10);
      results.successful.forEach((value, index) => {
        const expected = index % 2 === 0 ? index * 2 : index * 3;
        assert.strictEqual(value, expected);
      });
    });

    it('should handle promise rejection properly', async () => {
      const items = ['resolve', 'reject', 'resolve'];
      const operation = (item) => {
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            if (item === 'reject') {
              reject(new Error('Promise rejected'));
            } else {
              resolve(item.toUpperCase());
            }
          }, 10);
        });
      };
      
      const results = await harness.executeBatch(items, operation);
      
      assert.strictEqual(results.successful.length, 2);
      assert.strictEqual(results.failed.length, 1);
      assert.deepStrictEqual(results.successful, ['RESOLVE', 'RESOLVE']);
      assert.strictEqual(results.failed[0].error.message, 'Promise rejected');
    });
  });

  describe('Performance Optimization', () => {
    it('should show linear scaling with concurrency', async () => {
      const itemCounts = [10, 20, 40];
      const measurements = {};
      
      for (const count of itemCounts) {
        const items = Array.from({ length: count }, (_, i) => i);
        harness.concurrencyLimit = 5;
        
        const start = Date.now();
        await harness.executeBatch(items, async (item) => {
          await harness.simulateDelay(10);
          return item * 2;
        });
        const duration = Date.now() - start;
        
        measurements[count] = duration;
      }
      
      // Time should scale linearly with item count when concurrency is fixed
      const ratio1 = measurements[20] / measurements[10];
      const ratio2 = measurements[40] / measurements[20];
      
      // Ratios should be close to 2 (linear scaling)
      assert(Math.abs(ratio1 - 2) < 0.5, `Scaling ratio 20/10: ${ratio1.toFixed(2)}`);
      assert(Math.abs(ratio2 - 2) < 0.5, `Scaling ratio 40/20: ${ratio2.toFixed(2)}`);
    });

    it('should efficiently handle empty batches', async () => {
      const results = await harness.executeBatch([], async (item) => item);
      
      assert.strictEqual(results.successful.length, 0);
      assert.strictEqual(results.failed.length, 0);
      assert.strictEqual(results.totalProcessed, 0);
      assert.isNaN(results.successRate); // 0/0
    });

    it('should handle single item batches efficiently', async () => {
      const results = await harness.executeBatch(['single'], async (item) => item.toUpperCase());
      
      assert.strictEqual(results.successful.length, 1);
      assert.strictEqual(results.successful[0], 'SINGLE');
      assert.strictEqual(results.successRate, 1);
    });
  });
});