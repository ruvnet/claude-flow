/**
 * Test Cleanup Utilities - Deno Implementation
 * Comprehensive async operation cleanup patterns for reliable testing
 */

export { TestCleanup, AsyncTestUtils, TestAssertions } from "./test-cleanup.ts";
export { PerformanceTestUtils } from "./performance-test-utils.ts";
export { TestHooks } from "./test-hooks.ts";

export type { CleanupStats } from "./test-cleanup.ts";
export type { PerformanceMetrics, BenchmarkResult, PerformanceProfile } from "./performance-test-utils.ts";
export type { TestContext, TestSetupOptions, MemoryLeakTestResult } from "./test-hooks.ts";

/**
 * Quick setup for common test cleanup patterns
 * 
 * @example
 * ```typescript
 * import { quickCleanup } from "../../tests/unit/test-cleanup/index.ts";
 * 
 * describe("My Test Suite", () => {
 *   const { cleanup, beforeEach, afterEach } = quickCleanup();
 *   
 *   beforeEach(beforeEach);
 *   afterEach(afterEach);
 *   
 *   it("should test with automatic cleanup", () => {
 *     cleanup.setTimeout(() => console.log("test"), 1000);
 *     // Test logic - cleanup happens automatically
 *   });
 * });
 * ```
 */
export function quickCleanup() {
  let cleanup: TestCleanup;
  
  return {
    cleanup: () => cleanup,
    beforeEach: () => {
      cleanup = new TestCleanup();
    },
    afterEach: async () => {
      if (cleanup) {
        await cleanup.cleanup();
      }
    }
  };
}