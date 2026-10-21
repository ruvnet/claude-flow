import { test } from 'vitest';
import assert from 'node:assert/strict';
import { RateLimiter } from '../v3/@claude-flow/cli/src/production/rate-limiter.ts';
test('status reports the same burst capacity as admission checks', () => {
 const limiter = new RateLimiter({ maxRequests: 2, burstMultiplier: 1.5 });
 assert.equal(limiter.getStatus('read').limit, 3);
 for (let i = 0; i < 3; i++) { const r = limiter.check('read'); const s = limiter.getStatus('read'); assert.equal(s.remaining, r.remaining); assert.equal(s.current, i + 1); }
 assert.equal(limiter.check('read').allowed, false);
});
test('custom operation limits use the same rounded capacity', () => {
 const limiter = new RateLimiter({ burstMultiplier: 1.5, operationLimits: { read: { maxRequests: 3, windowMs: 60000 } } });
 assert.equal(limiter.getStatus('read', 'user').limit, 4);
 assert.equal(limiter.getStatus('read', 'user').remaining, 4);
});
