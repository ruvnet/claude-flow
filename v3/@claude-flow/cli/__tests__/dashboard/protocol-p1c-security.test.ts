/** R-SEC-p1c-*: P1-complete protocol rules. Each fails on the code before this change (no such section, command or rule existed). */
import { describe, expect, it } from 'vitest';
import { buildSectionFrame, COMMANDS, costBucket, COST_BUCKETS, parseCommand, parseSectionFrame, readToolArgsAllowed, READ_TOOLS, SECTION_NAMES, SectionSchemas } from '../../src/dashboard/protocol/index.js';

const coarse = { available: true, detail: 'coarse', bucket: '1-10', windowDays: 7, byModel: [], advice: [], perMission: [] };
describe('R-SEC-p1c cost privacy', () => {
  it('R-SEC-p1c-01 a coarse cost body carries a bucket only; any detail makes the whole frame invalid', () => {
    expect(SectionSchemas.cost.safeParse(coarse).success).toBe(true);
    const leaks: Record<string, unknown>[] = [
      { totals: { currency: 'USD', totalMinor: 1234 } }, { byModel: [{ provider: 'claude', model: 'opus', minor: 5 }] }, { advice: ['switch to haiku'] }, { perMission: [{ missionId: 'm', minor: 1 }] },
      { creditsTotal: 5 }, { cacheHitRatio: 0.9 }, { budget: { currency: 'USD', limitMinor: 1, spentMinor: 1 } }, { unpriced: ['gpt-x'] },
    ];
    for (const l of leaks) expect(SectionSchemas.cost.safeParse({ ...coarse, ...l }).success).toBe(false);
    expect(parseSectionFrame(JSON.parse(JSON.stringify(buildSectionFrame('cost', coarse as never, { rev: 1, at: 1 })))).ok).toBe(true);
  });
  it('R-SEC-p1c-02 buckets are fixed order-of-magnitude edges; garbage is "none"', () => {
    expect(COST_BUCKETS).toEqual(['none', 'under-1', '1-10', '10-100', '100-1000', 'over-1000']);
    expect([0, -3, NaN, Infinity].map(costBucket)).toEqual(['none', 'none', 'none', 'none']);
    expect([0.01, 0.99, 1, 9.99, 10, 99.99, 100, 999, 1000, 1e9].map(costBucket)).toEqual(['under-1', 'under-1', '1-10', '1-10', '10-100', '10-100', '100-1000', '100-1000', 'over-1000', 'over-1000']);
    expect(SectionSchemas.cost.safeParse({ ...coarse, bucket: '12.34' }).success).toBe(false);
  });
  it('R-SEC-p1c-03 nothing a remote caller can send reaches the cost detail switch', () => {
    for (const n of Object.keys(COMMANDS)) expect(n).not.toMatch(/cost|detail|config/i);
    for (const bad of ['cost.detail', 'cost.set', 'config.set', 'settings.set']) expect(parseCommand(bad, { detail: 'full' }).ok).toBe(false);
  });
});

describe('R-SEC-p1c collection', () => {
  it('R-SEC-p1c-04 metaharness_flywheel is a read only with exactly {op:"status"}; promote and every other shape is refused', () => {
    expect(READ_TOOLS.has('metaharness_flywheel')).toBe(true);
    expect(readToolArgsAllowed('metaharness_flywheel', { op: 'status' })).toBe(true);
    for (const p of [{ op: 'promote' }, { op: 'receipts' }, { op: 'status', confirm: true }, { op: 'promote', receiptId: 'x' }, {}, undefined, { op: ['status'] }]) expect(readToolArgsAllowed('metaharness_flywheel', p as never)).toBe(false);
    expect(readToolArgsAllowed('system_info', undefined)).toBe(true);
  });
  it('R-SEC-p1c-05 the new sections are strict, budgeted and carry no path or free text of a skill/agent log', () => {
    for (const n of ['agents', 'autopilot', 'skills', 'timeline'] as const) expect(SECTION_NAMES).toContain(n);
    expect(SectionSchemas.skills.safeParse({ total: 1, skills: [{ name: 'a', source: 'project', manifest: true, path: '/home/x' }] }).success).toBe(false);
    expect(SectionSchemas.autopilot.safeParse({ present: true, killed: false, phase: 'running', envelope: null, steps: { started: 0, done: 0, failed: 0, verified: 0, parked: 0 }, journalLines: 0, badLines: 0, unauthenticated: false }).success).toBe(false);
    expect(SectionSchemas.security.safeParse({ policy: null, findings: [], anatole: { present: true, mode: 'enforce', calls: 1, blocked: 0, open: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, degraded: null, unauthenticated: false } }).success).toBe(false);
  });
});

describe('R-SEC-p1c commands', () => {
  const lvl = (n: string) => (COMMANDS as Record<string, { level: string }>)[n]?.level;
  it('R-SEC-p1c-06 levels: logs read; stop/task/claims manage; note write; nothing for hive votes, scans, autopilot pause or env/config', () => {
    expect(lvl('agent.logs')).toBe('read');
    for (const n of ['agent.stop', 'task.create', 'claims.release', 'claims.pause', 'claims.resume', 'autopilot.stop']) expect(lvl(n)).toBe('manage');
    expect(lvl('memory.store')).toBe('write');
    for (const n of ['hive.vote', 'hive.spawn', 'security.scan', 'autopilot.pause', 'autopilot.start', 'claims.steal', 'claims.handoff', 'worker.dispatch', 'flywheel.promote', 'memory.delete', 'task.cancel']) expect(parseCommand(n, {}).ok).toBe(false);
  });
  it('R-SEC-p1c-07 arguments are exact: ids by regex, no namespace for memory.store, bounded text, no extras', () => {
    expect(parseCommand('agent.stop', { agentId: 'agent-1' }).ok).toBe(true);
    for (const id of ['', ' a', 'a b', '../x', 'a;rm -rf /', '$(x)', 'a'.repeat(81), 'a\nb']) expect(parseCommand('agent.stop', { agentId: id }).ok).toBe(false);
    expect(parseCommand('agent.logs', { agentId: 'a', lines: 100 }).ok).toBe(true); expect(parseCommand('agent.logs', { agentId: 'a', lines: 101 }).ok).toBe(false);
    expect(parseCommand('memory.store', { key: 'note-1', value: 'hello' }).ok).toBe(true);
    expect(parseCommand('memory.store', { key: 'note-1', value: 'hello', namespace: 'default' }).ok).toBe(false);
    expect(parseCommand('memory.store', { key: 'a b', value: 'x' }).ok).toBe(false); expect(parseCommand('memory.store', { key: 'k', value: 'x'.repeat(2049) }).ok).toBe(false);
    expect(parseCommand('task.create', { type: 'feature', description: 'x'.repeat(500) }).ok).toBe(true);
    expect(parseCommand('task.create', { type: 'feature', description: 'x'.repeat(501) }).ok).toBe(false); expect(parseCommand('task.create', { type: 'shell', description: 'abc' }).ok).toBe(false);
    expect(parseCommand('claims.release', { issue: 'owner/repo#12', claimant: 'agent:a1:coder' }).ok).toBe(true);
    for (const c of ['agent:a\x1b[2J', 'root:x', 'agent:', 'human:' + 'x'.repeat(80), 'agent:a\nb']) expect(parseCommand('claims.release', { issue: 'I-1', claimant: c }).ok).toBe(false);
    expect(parseCommand('claims.release', { issue: 'I-1' }).ok).toBe(false); expect(parseCommand('autopilot.stop', { path: '/etc' }).ok).toBe(false);
  });
});
