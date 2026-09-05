// Regression test for #2235(B) — system_status.uptime was reading a persisted
// metrics.startTime (the file's creation timestamp) instead of the live process
// uptime, so a freshly-spawned MCP server reported ~8.8 days of uptime.

import { describe, it, expect } from 'vitest';
import { systemTools } from '../src/mcp-tools/system-tools.js';

const statusTool = systemTools.find((t) => t.name === 'system_status')!;

describe('system_status.uptime (#2235 B)', () => {
  it('reports the live process uptime, not a persisted/stale value', async () => {
    const r = (await statusTool.handler({ verbose: false })) as { uptime: number; uptimeFormatted: string };
    // The vitest process itself has been running for at most a few minutes;
    // a stale persisted-startTime bug would yield values in the millions of
    // ms (hours/days). Cap generously to allow CI slowness.
    expect(r.uptime).toBeGreaterThanOrEqual(0);
    expect(r.uptime).toBeLessThan(60 * 60 * 1000); // < 1 hour
    expect(typeof r.uptimeFormatted).toBe('string');
  });

  it('produces a non-decreasing uptime across two reads (live counter, not file mtime)', async () => {
    const a = (await statusTool.handler({})) as { uptime: number };
    await new Promise((res) => setTimeout(res, 25));
    const b = (await statusTool.handler({})) as { uptime: number };
    expect(b.uptime).toBeGreaterThanOrEqual(a.uptime);
  });
});
