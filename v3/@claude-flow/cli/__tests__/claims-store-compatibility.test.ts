import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaimService } from '../src/services/claim-service.js';
import { claimsTools } from '../src/mcp-tools/claims-tools.js';
let dir: string;
let file: string;
const owner = { type: 'agent' as const, agentId: 'worker', agentType: 'coder' };
const claimTool = claimsTools.find(t => t.name === 'claims_claim')!;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-claims-store-'));
  mkdirSync(join(dir, '.claude-flow', 'claims'), { recursive: true });
  file = join(dir, '.claude-flow', 'claims', 'claims.json');
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
});
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });
describe('shared CLI/MCP claims persistence', () => {
  it.each(['CLI', 'MCP'])('preserves claims when %s writes before the other surface', async first => {
    if (first === 'CLI') {
      const cli = new ClaimService(dir); await cli.initialize(); await cli.claim('first', owner);
      expect(await claimTool.handler({ issueId: 'second', claimant: 'agent:worker:coder' })).toMatchObject({ success: true });
    } else {
      await claimTool.handler({ issueId: 'first', claimant: 'agent:worker:coder' });
      const cli = new ClaimService(dir); await cli.initialize(); await cli.claim('second', owner);
    }
    const reopened = new ClaimService(dir); await reopened.initialize();
    expect((await reopened.getAllClaims()).map(c => c.issueId).sort()).toEqual(['first', 'second']);
    for (const issueId of ['first', 'second']) {
      expect(await claimTool.handler({ issueId, claimant: 'agent:other:coder' })).toMatchObject({ success: false });
    }
  });
  it.each(['{broken', '{"claims":null}', '{"claims":[{}]}'])('fails closed on malformed persisted claims: %s', async contents => {
    writeFileSync(file, contents);
    await expect(claimTool.handler({ issueId: 'new', claimant: 'agent:worker:coder' })).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe(contents);
    await expect(new ClaimService(dir).initialize()).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe(contents);
  });
  it('round trips work-stealing metadata and unrelated contest records', async () => {
    await claimTool.handler({ issueId: 'first', claimant: 'agent:worker:coder' });
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data.operatorMetadata = { custom: ['preserve', 'this'] };
    data.claims.first.externalReference = 'tracking-id';
    data.contests = { first: { reason: 'existing contest', originalClaimant: owner } };
    writeFileSync(file, JSON.stringify(data));
    const cli = new ClaimService(dir); await cli.initialize();
    await cli.markStealable('first', { reason: 'voluntary', stealableAt: new Date(), preferredTypes: ['tester'], progress: 25, context: 'resume here' });
    const reopened = new ClaimService(dir); await reopened.initialize();
    expect(await reopened.getStealable('coder')).toEqual([]);
    expect((await reopened.getStealable('tester')).map(c => c.issueId)).toEqual(['first']);
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    expect(stored.contests).toEqual(data.contests);
    expect(stored.operatorMetadata).toEqual(data.operatorMetadata);
    expect(stored.claims.first.externalReference).toBe('tracking-id');
    expect(stored.stealable.first.context).toBe('resume here');
  });
  it.each(['claim', 'mark', 'release'])('preserves an intervening MCP claim when a live CLI service performs %s', async operation => {
    const cli = new ClaimService(dir); await cli.initialize(); await cli.claim('first', owner);
    await claimTool.handler({ issueId: 'second', claimant: 'agent:worker:coder' });
    if (operation === 'claim') await cli.claim('third', owner);
    if (operation === 'mark') await cli.markStealable('first', { reason: 'voluntary', stealableAt: new Date(), progress: 10 });
    if (operation === 'release') await cli.release('first', owner);
    expect(JSON.parse(readFileSync(file, 'utf8')).claims.second.issueId).toBe('second');
  });
  it('does not resurrect claims removed through MCP after CLI initialization', async () => {
    const cli = new ClaimService(dir); await cli.initialize(); await cli.claim('first', owner);
    const release = claimsTools.find(t => t.name === 'claims_release')!;
    expect(await release.handler({ issueId: 'first', claimant: 'agent:worker:coder' })).toMatchObject({ success: true });
    await cli.claim('new', owner);
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).claims)).toEqual(['new']);
  });

  it('retains automatic expiry results while refreshing nested service calls', async () => {
    const cli = new ClaimService(dir); await cli.initialize();
    await cli.claim('first', owner); await cli.claim('second', owner);
    const expired = await cli.expireStale(-1);
    expect(expired.map(c => [c.issueId, c.status])).toEqual([['first', 'stealable'], ['second', 'stealable']]);
    expect((await cli.getStealable()).length).toBe(2);
  });

});
