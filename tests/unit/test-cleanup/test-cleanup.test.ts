/**
 * Test suite for TestCleanup utilities - Issue #120 Implementation
 * Validates comprehensive async operation cleanup patterns
 */

import { describe, it, beforeEach, afterEach } from "https://deno.land/std@0.220.0/testing/bdd.ts";
import { assertEquals, assertExists, assertThrows } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { TestCleanup, AsyncTestUtils, TestAssertions } from "./test-cleanup.ts";

describe("TestCleanup - Issue #120 Implementation", () => {
  let cleanup: TestCleanup;

  beforeEach(() => {
    cleanup = new TestCleanup();
  });

  afterEach(async () => {
    if (cleanup) {
      await cleanup.cleanup();
    }
  });

  describe("Timer Management", () => {
    it("should register and cleanup timers", async () => {
      let timerExecuted = false;
      
      cleanup.setTimeout(() => {
        timerExecuted = true;
      }, 100);
      
      assertEquals(cleanup.getStats().timers, 1);
      
      await cleanup.cleanup();
      
      // Wait a bit to ensure timer would have fired if not cleaned up
      await new Promise(resolve => setTimeout(resolve, 150));
      
      assertEquals(timerExecuted, false);
      assertEquals(cleanup.getStats().timers, 0);
    });

    it("should register and cleanup intervals", async () => {
      let intervalCount = 0;
      
      cleanup.setInterval(() => {
        intervalCount++;
      }, 50);
      
      assertEquals(cleanup.getStats().intervals, 1);
      
      // Let it run a couple times
      await new Promise(resolve => setTimeout(resolve, 150));
      
      await cleanup.cleanup();
      
      const countAfterCleanup = intervalCount;
      
      // Wait to ensure interval doesn't continue
      await new Promise(resolve => setTimeout(resolve, 100));
      
      assertEquals(intervalCount, countAfterCleanup);
      assertEquals(cleanup.getStats().intervals, 0);
    });
  });

  describe("Promise Management", () => {
    it("should track and wait for promises", async () => {
      let promiseResolved = false;
      
      cleanup.registerPromise(
        new Promise<void>(resolve => {
          setTimeout(() => {
            promiseResolved = true;
            resolve();
          }, 100);
        })
      );
      
      assertEquals(cleanup.getStats().promises, 1);
      
      await cleanup.waitForPromises();
      
      assertEquals(promiseResolved, true);
      assertEquals(cleanup.getStats().promises, 0);
    });

    it("should handle promise timeouts", async () => {
      const promise = cleanup.createTimeoutPromise<string>(
        () => {
          // Never resolve - should timeout
        },
        100,
        'Test timeout'
      );
      
      await assertThrows(
        async () => await promise,
        Error,
        'Test timeout'
      );
    });
  });

  describe("Event Listener Management", () => {
    it("should register and cleanup event listeners", async () => {
      // Create a mock event target for testing
      const mockTarget = {
        listeners: new Map(),
        addEventListener(event: string, listener: EventListener) {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
          }
          this.listeners.get(event).push(listener);
        },
        removeEventListener(event: string, listener: EventListener) {
          if (this.listeners.has(event)) {
            const listeners = this.listeners.get(event);
            const index = listeners.indexOf(listener);
            if (index > -1) {
              listeners.splice(index, 1);
            }
          }
        }
      } as unknown as EventTarget;
      
      const listener = () => {};
      
      cleanup.registerEventListener(mockTarget, 'test', listener);
      
      // Verify listener was added
      assertEquals((mockTarget as any).listeners.get('test').length, 1);
      assertEquals(cleanup.getStats().eventListeners, 1);
      
      await cleanup.cleanup();
      
      // Verify listener was removed
      assertEquals((mockTarget as any).listeners.get('test').length, 0);
      assertEquals(cleanup.getStats().eventListeners, 0);
    });
  });

  describe("Resource Handle Management", () => {
    it("should cleanup handles with close method", async () => {
      let closeCalled = false;
      const mockHandle = {
        close: () => {
          closeCalled = true;
        }
      };
      
      cleanup.registerHandle(mockHandle);
      
      assertEquals(cleanup.getStats().openHandles, 1);
      
      await cleanup.cleanup();
      
      assertEquals(closeCalled, true);
      assertEquals(cleanup.getStats().openHandles, 0);
    });

    it("should cleanup handles with destroy method", async () => {
      let destroyCalled = false;
      const mockHandle = {
        destroy: () => {
          destroyCalled = true;
        }
      };
      
      cleanup.registerHandle(mockHandle);
      
      await cleanup.cleanup();
      
      assertEquals(destroyCalled, true);
    });
  });

  describe("AbortController Management", () => {
    it("should abort controllers during cleanup", async () => {
      const controller = new AbortController();
      cleanup.registerAbortController(controller);
      
      assertEquals(cleanup.getStats().abortControllers, 1);
      assertEquals(controller.signal.aborted, false);
      
      await cleanup.cleanup();
      
      assertEquals(controller.signal.aborted, true);
      assertEquals(cleanup.getStats().abortControllers, 0);
    });
  });
});

describe("AsyncTestUtils", () => {
  beforeEach(() => {
    AsyncTestUtils.resetCleanup();
  });

  afterEach(async () => {
    await AsyncTestUtils.getCleanup().cleanup();
  });

  describe("withTimeout", () => {
    it("should resolve when promise completes in time", async () => {
      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve('success'), 50);
      });
      
      const result = await AsyncTestUtils.withTimeout(promise, 100);
      assertEquals(result, 'success');
    });

    it("should reject when promise times out", async () => {
      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve('success'), 200);
      });
      
      await assertThrows(
        async () => await AsyncTestUtils.withTimeout(promise, 100),
        Error,
        'Promise timed out'
      );
    });
  });
});

describe("TestAssertions", () => {
  it("should assert async throws", async () => {
    await TestAssertions.assertThrowsAsync(
      async () => {
        throw new Error('Test error');
      },
      'Test error'
    );
  });

  it("should assert completion within timeout", async () => {
    const result = await TestAssertions.assertCompletesWithin(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'completed';
      },
      100
    );
    
    assertEquals(result, 'completed');
  });

  it("should assert value in range", () => {
    TestAssertions.assertInRange(50, 0, 100);
    
    assertThrows(
      () => TestAssertions.assertInRange(150, 0, 100),
      Error,
      'Expected 150 to be between 0 and 100'
    );
  });
});