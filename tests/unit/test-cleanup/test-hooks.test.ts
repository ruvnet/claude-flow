/**
 * Test Hooks and Lifecycle Management Test Suite
 * Validates test setup, teardown, and automation capabilities
 */

import { describe, it, beforeEach, afterEach } from "https://deno.land/std@0.220.0/testing/bdd.ts";
import { assertEquals, assertExists, assert } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { TestHooks } from "./test-hooks.ts";

describe("TestHooks", () => {
  afterEach(async () => {
    // Emergency cleanup to ensure no test contexts leak between tests
    await TestHooks.cleanupAllContexts();
  });

  describe("Test Context Management", () => {
    it("should create isolated test environment", async () => {
      const result = await TestHooks.isolatedTest(async (context) => {
        assertExists(context.testId);
        assertExists(context.cleanup);
        assertExists(context.performance);
        assert(typeof context.startTime === 'number');
        
        // Register a timer that should be cleaned up
        context.cleanup.setTimeout(() => {}, 1000);
        
        return 'test-result';
      });
      
      assertEquals(result, 'test-result');
      
      // Verify no active contexts remain
      assertEquals(TestHooks.getActiveContexts().size, 0);
    });

    it("should wrap test with cleanup", async () => {
      const testFn = TestHooks.wrapTest(async (context) => {
        assertExists(context.testId);
        
        // Register resources that should be cleaned up
        context.cleanup.setTimeout(() => {}, 1000);
        const controller = new AbortController();
        context.cleanup.registerAbortController(controller);
        
        assert(!controller.signal.aborted);
      });
      
      await testFn();
      
      // Verify cleanup occurred and no contexts remain
      assertEquals(TestHooks.getActiveContexts().size, 0);
    });
  });

  describe("Memory Leak Detection", () => {
    it("should perform memory leak detection", async () => {
      const result = await TestHooks.memoryLeakTest(async () => {
        // Create some objects but don't hold references
        for (let i = 0; i < 100; i++) {
          const obj = { data: new Array(1000).fill(i) };
          // Use obj to avoid warning, but don't keep reference
          obj.data.length;
        }
        return 'memory-test-result';
      }, {
        iterations: 10,
        memoryThreshold: 1024 * 1024 * 10 // 10MB
      });
      
      assertEquals(result.result, 'memory-test-result');
      assertEquals(result.iterations, 10);
      assert(typeof result.memoryLeak === 'boolean');
      assert(typeof result.memoryIncrease === 'number');
    });
  });

  describe("Test Suite Management", () => {
    it("should create and manage test suite", async () => {
      const suite = TestHooks.createTestSuite('example-suite');
      
      // Add some suite-wide resources
      let resource1Cleaned = false;
      let resource2Cleaned = false;
      
      suite.addCleanup('resource1', () => {
        resource1Cleaned = true;
      });
      
      suite.addCleanup('resource2', () => {
        resource2Cleaned = true;
      });
      
      // Run a test within the suite
      const testResult = await suite.runTest('test1', async (context) => {
        assertExists(context.testId);
        assert(context.testId.includes('example-suite_test1'));
        return 'suite-test-result';
      });
      
      assertEquals(testResult, 'suite-test-result');
      
      // Cleanup the suite
      await suite.cleanup();
      
      // Verify suite-wide resources were cleaned up
      assertEquals(resource1Cleaned, true);
      assertEquals(resource2Cleaned, true);
    });
  });

  describe("Parallel Testing", () => {
    it("should run tests in parallel with isolated contexts", async () => {
      const tests = [
        {
          name: 'test1',
          fn: async (context: any) => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return `result1-${context.testId}`;
          }
        },
        {
          name: 'test2', 
          fn: async (context: any) => {
            await new Promise(resolve => setTimeout(resolve, 30));
            return `result2-${context.testId}`;
          }
        },
        {
          name: 'test3',
          fn: async (context: any) => {
            await new Promise(resolve => setTimeout(resolve, 40));
            return `result3-${context.testId}`;
          }
        }
      ];
      
      const startTime = performance.now();
      const results = await TestHooks.parallelTests(tests);
      const totalTime = performance.now() - startTime;
      
      assertEquals(results.length, 3);
      
      // Verify all tests completed
      assertEquals(results[0].name, 'test1');
      assertEquals(results[1].name, 'test2');
      assertEquals(results[2].name, 'test3');
      
      // Results should contain test IDs
      assert(results[0].result.includes('result1-'));
      assert(results[1].result.includes('result2-'));
      assert(results[2].result.includes('result3-'));
      
      // Should have run in parallel (less than sum of individual times)
      assert(totalTime < 150); // Sum would be ~120ms, parallel should be ~50-60ms
      
      // Verify durations are reasonable
      results.forEach(result => {
        assert(result.duration > 0);
        assert(result.duration < 100);
      });
    });
  });

  describe("Timeout Management", () => {
    it("should handle test timeouts", async () => {
      const fastOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'completed';
      };
      
      const result = await TestHooks.withTestTimeout(fastOperation, 100, 'fast-test');
      assertEquals(result, 'completed');
    });
  });

  describe("Context Tracking", () => {
    it("should track active contexts", async () => {
      const context1 = TestHooks.setupTest('manual-test-1');
      const context2 = TestHooks.setupTest('manual-test-2');
      
      const activeContexts = TestHooks.getActiveContexts();
      assertEquals(activeContexts.size, 2);
      
      // Verify contexts exist
      assert(activeContexts.has(context1.testId));
      assert(activeContexts.has(context2.testId));
      
      // Cleanup contexts
      await TestHooks.teardownTest(context1.testId);
      await TestHooks.teardownTest(context2.testId);
      
      // Verify contexts were removed
      assertEquals(TestHooks.getActiveContexts().size, 0);
    });
  });
});