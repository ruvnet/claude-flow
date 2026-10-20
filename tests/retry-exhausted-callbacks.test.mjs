import { test } from 'vitest';
import assert from 'node:assert/strict';
import { withRetry } from '../v3/@claude-flow/cli/src/production/retry.ts';
test('retry callbacks and history describe only actual retries', async () => {
 for (const maxAttempts of [1, 3]) {
  let calls = 0; const callbacks = [];
  const result = await withRetry(async () => { calls++; throw new Error('failure'); }, { maxAttempts, initialDelayMs: 0, jitter: 0, shouldRetry: () => true, onRetry: (_, attempt) => callbacks.push(attempt) });
  assert.equal(calls, maxAttempts);
  assert.equal(result.success, false);
  assert.equal(result.retryHistory.length, maxAttempts - 1);
  assert.deepEqual(callbacks, Array.from({ length: maxAttempts - 1 }, (_, i) => i + 1));
 }
});
test('successful retry preserves prior retry history', async () => {
 let calls = 0;
 const result = await withRetry(async () => { if (++calls === 1) throw new Error('transient'); return 42; }, { initialDelayMs: 0, jitter: 0, shouldRetry: () => true });
 assert.equal(result.result, 42); assert.equal(result.retryHistory.length, 1);
});
