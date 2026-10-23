/**
 * #4410 memory scan: FallbackEmbeddingService used execFileSync, blocking the
 * event loop for up to 10 s per embedding whenever the primary embedder was
 * unavailable. Use the async execFile instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  execFile: (_file: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    setTimeout(() => cb(null, '[0.5,0.25]', ''), 60);
  },
  // The pre-fix implementation uses this; keep the baseline comparable.
  execFileSync: () => {
    const end = Date.now() + 60;
    while (Date.now() < end) { /* simulate the blocking child */ }
    return '[0.5,0.25]';
  },
}));

import { FallbackEmbeddingService } from '../reasoningbank/index.js';

afterEach(() => {
  vi.clearAllTimers();
});

describe('FallbackEmbeddingService embed is non-blocking (#4410)', () => {
  it('lets a timer run while the fallback embedding process is pending', async () => {
    const service = new FallbackEmbeddingService(2);
    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; }, 10);

    const embedding = await service.embed('probe');

    clearTimeout(timer);
    expect(timerFired).toBe(true);
    expect(Array.from(embedding)).toEqual([0.5, 0.25]);
  });
});
