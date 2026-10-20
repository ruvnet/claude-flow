import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimsTools } from '../src/mcp-tools/claims-tools.js';

// Regression tests for #3180 (items 1 and 6): `expiresAt` on IssueClaim was
// declared but never settable by any handler, and the agent-load/rebalance
// max-claims threshold was duplicated as a magic literal in two places.
let dir: string;
const claimTool = claimsTools.find(t => t.name === 'claims_claim')!;
const loadTool = claimsTools.find(t => t.name === 'claims_load')!;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-claims-ttl-'));
  mkdirSync(join(dir, '.claude-flow', 'claims'), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('claims_claim ttlMs / expiresAt', () => {
  it('leaves expiresAt unset when no ttlMs is given (backward compatible)', async () => {
    const result = await claimTool.handler({ issueId: 'a', claimant: 'agent:worker:coder' });
    expect(result).toMatchObject({ success: true });
    expect((result as { claim: { expiresAt?: string } }).claim.expiresAt).toBeUndefined();
  });

  it('sets expiresAt from ttlMs when provided', async () => {
    const before = Date.now();
    const result = await claimTool.handler({ issueId: 'b', claimant: 'agent:worker:coder', ttlMs: 60_000 });
    expect(result).toMatchObject({ success: true });
    const expiresAt = (result as { claim: { expiresAt: string } }).claim.expiresAt;
    expect(expiresAt).toBeDefined();
    const delta = new Date(expiresAt).getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(60_000);
    expect(delta).toBeLessThan(65_000);
  });

  it.each([-1, 0, Number.NaN, Number.POSITIVE_INFINITY])('rejects a non-positive/non-finite ttlMs: %s', async ttlMs => {
    const result = await claimTool.handler({ issueId: 'c', claimant: 'agent:worker:coder', ttlMs });
    expect(result).toMatchObject({ success: false });
  });
});

describe('claims_load maxClaims consistency', () => {
  it('reports the same maxClaims threshold used in utilization math', async () => {
    await claimTool.handler({ issueId: 'd', claimant: 'agent:worker:coder' });
    const result = await loadTool.handler({});
    const load = (result as { loads: Array<{ claimCount: number; maxClaims: number; utilization: number }> }).loads[0];
    expect(load.maxClaims).toBe(5);
    expect(load.utilization).toBeCloseTo(load.claimCount / load.maxClaims);
  });
});
