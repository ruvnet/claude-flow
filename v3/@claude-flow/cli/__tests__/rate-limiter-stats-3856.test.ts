import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/production/rate-limiter.js';

describe('#3856 — RateLimiter.getStats() operation/user labels', () => {
  it('reports an anonymous operation by its name with zero active users', () => {
    const rl = new RateLimiter();
    rl.check('build');
    const s = rl.getStats();
    expect(s.activeUsers).toBe(0);
    expect(s.mostLimitedOperations).toEqual([{ operation: 'build', requests: 1 }]);
  });

  it('keeps colon-containing operation names whole and does not count them as users', () => {
    const rl = new RateLimiter();
    rl.check('agent:spawn');
    rl.check('agent:spawn', 'alice');
    const s = rl.getStats();
    expect(s.mostLimitedOperations).toEqual([{ operation: 'agent:spawn', requests: 2 }]);
    expect(s.activeUsers).toBe(1);
  });

  it('counts distinct users and aggregates requests per operation', () => {
    const rl = new RateLimiter();
    rl.check('build', 'alice');
    rl.check('build', 'alice');
    rl.check('build', 'bob');
    rl.check('deploy', 'alice');
    const s = rl.getStats();
    expect(s.totalBuckets).toBe(3);
    expect(s.activeUsers).toBe(2);
    expect(s.mostLimitedOperations).toEqual([
      { operation: 'build', requests: 3 },
      { operation: 'deploy', requests: 1 },
    ]);
  });

  it('reports no users when per-user tracking is disabled', () => {
    const rl = new RateLimiter({ perUserLimits: false });
    rl.check('build', 'alice');
    rl.check('build', 'bob');
    const s = rl.getStats();
    expect(s.activeUsers).toBe(0);
    expect(s.totalBuckets).toBe(1);
    expect(s.mostLimitedOperations).toEqual([{ operation: 'build', requests: 2 }]);
  });

  it('leaves allowance and reset behaviour unchanged', () => {
    const rl = new RateLimiter({ maxRequests: 2, burstMultiplier: 1 });
    expect(rl.check('x', 'u').allowed).toBe(true);
    expect(rl.check('x', 'u').allowed).toBe(true);
    expect(rl.check('x', 'u').allowed).toBe(false);
    rl.reset('x', 'u');
    expect(rl.check('x', 'u').allowed).toBe(true);
  });
});
