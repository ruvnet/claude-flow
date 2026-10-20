import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SlidingWindowRateLimiter, TokenBucketRateLimiter } from '../v3/@claude-flow/shared/src/resilience/rate-limiter.ts';
test('sliding-window admission expires a request at its advertised reset time', () => {
 const original = Date.now; let now = 1000; Date.now = () => now; const l = new SlidingWindowRateLimiter({ maxRequests: 1, windowMs: 10000 });
 try { assert.equal(l.consume().allowed, true); now = 11000; assert.equal(l.status().allowed, true); assert.equal(l.consume().allowed, true); } finally { l.destroy(); Date.now = original; }
});
test('token-bucket retry delay counts only the remaining refill time', () => {
 const original = Date.now; let now = 1000; Date.now = () => now; const l = new TokenBucketRateLimiter({ maxRequests: 1, windowMs: 10000 });
 try { l.consume(); now = 10000; for (const r of [l.check(), l.consume()]) { assert.equal(r.allowed, false); assert.equal(r.retryAfter, 1000); assert.equal(r.resetAt.getTime(), now + r.retryAfter); } now = 11000; assert.equal(l.consume().allowed, true); } finally { l.destroy(); Date.now = original; }
});
