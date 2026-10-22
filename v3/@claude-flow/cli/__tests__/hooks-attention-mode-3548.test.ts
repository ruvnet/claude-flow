// #3548: hooks_intelligence_attention advertised mode "hyperbolic", but only flash
// and moe have branches. Any other mode returned { results: [], _stub: true } with a
// note telling users to install @ruvector/attention, a package this tool never
// imports. Unimplemented modes are now rejected with an error that says so.

import { describe, it, expect } from 'vitest';
import { hooksIntelligenceAttention } from '../src/mcp-tools/hooks-tools.js';

const call = (params: Record<string, unknown>) =>
  hooksIntelligenceAttention.handler(params) as Promise<Record<string, any>>;

describe('hooks_intelligence_attention modes (#3548)', () => {
  it.each(['hyperbolic', 'not-a-mode'])('rejects unimplemented mode %s instead of returning a stub', async (mode) => {
    const r = await call({ query: 'test', mode });
    expect(r.success).toBe(false);
    expect(r.error).toContain(`"${mode}" is not implemented`);
    expect(r.error).toContain('flash, moe');
    expect(JSON.stringify(r)).not.toContain('@ruvector/attention');
  });

  it('no longer advertises hyperbolic', () => {
    const schema = hooksIntelligenceAttention.inputSchema as { properties: { mode: { description: string } } };
    expect(schema.properties.mode.description).toBe('Attention mode (flash, moe)');
    expect(hooksIntelligenceAttention.description).not.toMatch(/hyperbolic/i);
  });

  it.each(['flash', 'moe', undefined])('still runs mode %s (default: flash)', async (mode) => {
    const r = await call(mode ? { query: 'test', mode } : { query: 'test' });
    expect(r.success).not.toBe(false);
    expect(r.mode).toBe(mode ?? 'flash');
    expect(Array.isArray(r.results)).toBe(true);
    // Honest marker contract (ADR-073) is unchanged for the no-backend case.
    expect(r.stats._stub).toBe(r.stats.implementation === 'none');
    if (r.stats._stub) expect(r.stats._note).toContain('@claude-flow/neural');
  });
});
