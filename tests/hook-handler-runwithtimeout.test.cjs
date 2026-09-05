'use strict';
/**
 * Unit tests for hook-handler.cjs runWithTimeout (FIX 1).
 *
 * The previous implementation called fn() and clearTimeout(timer) immediately,
 * so an async fn returned a *pending* promise that resolved through the race —
 * the timeout never fired. The "times out a slow async fn" case below fails
 * against the old code (it would return 'late') and passes against the fix.
 *
 * Uses node:test (built-in) so it runs without installing dependencies.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { runWithTimeout, INTELLIGENCE_TIMEOUT_MS } = require(
  path.join(__dirname, '..', '.claude', 'helpers', 'hook-handler.cjs')
);

test('returns the value for a fast async fn', async () => {
  const r = await runWithTimeout(() => Promise.resolve(42), 'fast-async');
  assert.equal(r, 42);
});

test('returns the value for a fast sync fn', async () => {
  const r = await runWithTimeout(() => 7, 'fast-sync');
  assert.equal(r, 7);
});

test('resolves null (never rejects) when fn throws synchronously', async () => {
  const r = await runWithTimeout(() => { throw new Error('boom'); }, 'sync-throw');
  assert.equal(r, null);
});

test('resolves null (never rejects) when an async fn rejects', async () => {
  const r = await runWithTimeout(() => Promise.reject(new Error('boom')), 'async-reject');
  assert.equal(r, null);
});

test('times out a slow async fn and resolves null near the timeout', { timeout: 8000 }, async () => {
  const start = Date.now();
  const r = await runWithTimeout(
    () => new Promise((res) => {
      // .unref() so the dangling timer never keeps the test process alive
      const t = setTimeout(() => res('late'), INTELLIGENCE_TIMEOUT_MS + 2000);
      if (t.unref) t.unref();
    }),
    'slow-async'
  );
  const elapsed = Date.now() - start;
  assert.equal(r, null, "should time out to null, not return the late value");
  assert.ok(
    elapsed >= INTELLIGENCE_TIMEOUT_MS - 200 && elapsed < INTELLIGENCE_TIMEOUT_MS + 1500,
    `should resolve near the ${INTELLIGENCE_TIMEOUT_MS}ms timeout, took ${elapsed}ms`
  );
});
