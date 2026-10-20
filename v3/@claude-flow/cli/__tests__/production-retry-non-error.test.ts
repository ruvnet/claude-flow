import { describe, it, expect } from 'vitest';
import { withRetry } from '../src/production/retry.js';
describe('production retry rejection values', () => {
  it.each(['network reset', null, 42])(
    'returns failed retry evidence for %s',
    async (value) => {
      const result = await withRetry(
        async () => {
          throw value;
        },
        { maxAttempts: 2, initialDelayMs: 0, jitter: 0 },
      );
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toBe(String(value));
      expect(result.retryHistory[0].error).toBe(String(value));
    },
  );
  it('retains Error identity and nonretryable classification', async () => {
    const error = new Error('authentication denied');
    const result = await withRetry(
      async () => {
        throw error;
      },
      { maxAttempts: 2, initialDelayMs: 0 },
    );
    expect(result.attempts).toBe(1);
    expect(result.error).toBe(error);
  });
});
