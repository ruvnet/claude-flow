/** Protocol-side regressions for the P0 parity security review (R-SEC-p0-4, 7, 8, 10). */
import { describe, expect, it } from 'vitest';
import { buildSectionFrame, DigestSchema, legacyDigestToSections, maskSecrets, parseCommand, parseDigest, parseSectionFrame, SectionSchemas, type Digest } from '../../src/dashboard/protocol/index.js';

describe('R-SEC-p0-7 legacyDigestToSections output validates against the section schemas', () => {
  const base = (over: Partial<Digest>): Digest => DigestSchema.parse({ collectedAt: 1, ruflo: { version: '1' }, level: 'read', health: { ok: true, notes: [] }, ...over });
  it('caps counts at 16, clamps titles, and survives prototype-named statuses', () => {
    const adrs = [...Array.from({ length: 98 }, (_, i) => ({ id: `ADR-${i}`, title: 't'.repeat(200), status: `st${i}` })), { id: 'ADR-x', title: 'x', status: 'toString' }, { id: 'ADR-y', title: 'y', status: 'hasOwnProperty' }];
    const d = base({ adrs: adrs as never });
    const out = legacyDigestToSections(d);
    for (const s of out) expect(SectionSchemas[s.section].safeParse(s.body).success, s.section).toBe(true);
    const a = out.find(s => s.section === 'adrs')!.body as { counts: Record<string, number>; items: { title: string }[] };
    expect(Object.keys(a.counts).length).toBeLessThanOrEqual(16); expect(a.items.every(i => i.title.length <= 160)).toBe(true);
    for (const v of Object.values(a.counts)) expect(typeof v).toBe('number');
  });
  it('counts a status named toString as 1, not a function string', () => {
    const out = legacyDigestToSections(base({ adrs: [{ id: 'ADR-1', title: 't', status: 'toString' }] }));
    expect((out.find(s => s.section === 'adrs')!.body as { counts: Record<string, number> }).counts).toEqual({ toString: 1 });
  });
  it('drops a mapped section that cannot be made valid', () => {
    const d = base({ tasks: { total: 1, pending: 0, running: 0, done: 1 } });
    (d as { memory: unknown }).memory = { entries: 1e308 };
    expect(legacyDigestToSections(d).some(s => s.section === 'memory')).toBe(false);
  });
});

describe('R-SEC-p0-8 non-safe integers are rejected', () => {
  it('section bodies reject 1e308 counters', () => {
    expect(SectionSchemas.tasks.safeParse({ total: 1e308, pending: 0, running: 0, done: 0, failed: 0, items: [] }).success).toBe(false);
    expect(SectionSchemas.tasks.safeParse({ total: 5, pending: 0, running: 0, done: 0, failed: 0, items: [] }).success).toBe(true);
  });
  it('frames reject unsafe rev and an at beyond year 2100 inside parseSectionFrame itself', () => {
    const ok = buildSectionFrame('control', { level: 'read', autoApprove: false }, { rev: 1, at: Date.now() });
    expect(parseSectionFrame(ok).ok).toBe(true);
    for (const patch of [{ rev: Number.MAX_SAFE_INTEGER }, { rev: 1e308 }, { at: 1e15 }, { at: 1e308 }, { sv: 1e308 }]) expect(parseSectionFrame({ ...ok, ...patch }).ok, JSON.stringify(patch)).toBe(false);
  });
  it('digest counters reject 1e308', () => {
    expect(parseDigest({ collectedAt: 1, ruflo: { version: '1' }, level: 'read', health: { ok: true }, tasks: { total: 1e308, pending: 0, running: 0, done: 0 } }).ok).toBe(false);
  });
});

describe('R-SEC-p0-4 maskSecrets is idempotent and linear on adversarial input', () => {
  it('idempotent', () => { const once = maskSecrets('postgres://a:b12345@h AWS_SECRET=abcdef123456'); expect(maskSecrets(once)).toBe(once); });
  it('no catastrophic backtracking on 200 KB of near-matches', () => {
    for (const s of ['a'.repeat(200_000), 'token '.repeat(30_000), ('secret' + '-'.repeat(50)).repeat(3_000), 'sk-' + 'a'.repeat(100_000), 'x://' + 'u'.repeat(100_000)]) {
      const t0 = performance.now(); maskSecrets(s); expect(performance.now() - t0, s.slice(0, 12)).toBeLessThan(500);
    }
  });
});

describe('R-SEC-p0-10 command schema', () => {
  it('expectedRevision is optional strict int >= 1 for pause/resume/stop and unknown for others', () => {
    const id = 'msn_' + 'a'.repeat(24);
    expect(parseCommand('mission.pause', { missionId: id, expectedRevision: 2 }).ok).toBe(true);
    expect(parseCommand('mission.pause', { missionId: id, expectedRevision: 0 }).ok).toBe(false);
    expect(parseCommand('swarm.stop', { expectedRevision: 1 }).ok).toBe(false);
  });
});
