import { describe, it, expect, vi } from 'vitest';
import { ConnectionPool as MCPPool } from '../src/connection-pool.js';
import { ConnectionPool as SharedPool } from '../../shared/src/mcp/connection-pool.js';
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
describe.each([
  ['mcp', MCPPool],
  ['shared', SharedPool],
] as const)('%s connection reservation', (_, Pool) => {
  it('returns distinct leases to simultaneous demand creation', async () => {
    const pool = new Pool(
      { minConnections: 0, maxConnections: 2, evictionRunInterval: 60000 },
      logger,
    );
    try {
      const a = pool.acquire();
      const b = pool.acquire();
      const [first, second] = await Promise.all([a, b]);
      expect(first.id).not.toBe(second.id);
      expect(pool.getStats().busyConnections).toBe(2);
      pool.release(first);
      pool.release(second);
    } finally {
      await pool.clear();
    }
  });
});
