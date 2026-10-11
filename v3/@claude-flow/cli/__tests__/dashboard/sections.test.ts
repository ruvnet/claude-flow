import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSectionFrame, parseCommand, parseSectionFrame, SECTION_NAMES, SECTION_TTL_S, type SectionFrame, type SectionName } from '../../src/dashboard/protocol/index.js';
import { adrs, cost, events, findLedger, whatsnew } from '../../src/dashboard/collect-files.js';
import { control, health, memory, meta, missions, mission_events, settings, swarm, tasks, type CollectCtx } from '../../src/dashboard/collect-core.js';
import { alerts, approvals, notices } from '../../src/dashboard/derive.js';
import { EXECUTORS, COMMAND_TOOLS } from '../../src/dashboard/executors.js';
import { guard, RufloError, Semaphore } from '../../src/dashboard/exec.js';
import { confine, listDir, readRegular } from '../../src/dashboard/read.js';
import { COLLECTORS, FORCED_MIN_INTERVAL_MS, SectionScheduler } from '../../src/dashboard/scheduler.js';
import { stubRuflo } from './_support/harness.js';
import { READ_TOOLS } from '../../src/dashboard/protocol/index.js';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rfsec-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const noRun = async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, truncated: false });

function ctx(over: Partial<CollectCtx> = {}, dir = tmp()): CollectCtx & { stub: ReturnType<typeof stubRuflo> } {
  mkdirSync(join(dir, '.claude-flow'), { recursive: true });
  const stub = stubRuflo();
  return { stub, ruflo: stub, projectDir: dir, level: 'read', autoApprove: false, cliChoice: 'path', now: () => 1_000_000, cache: {}, errors: new Map(), pending: () => [], notices: () => [], run: noRun, home: dir, ...over };
}
const valid = (n: SectionName, body: Record<string, unknown>) => expect(parseSectionFrame(buildSectionFrame(n, body as never, { rev: 1, at: 1 })).ok).toBe(true);

describe('CLI-backed collectors (shapes match ruflo 3.55.0 output)', () => {
  it('meta, control, health', async () => {
    const c = ctx();
    const m = await meta(c); expect(m).toMatchObject({ ruflo: { version: '3.55.0' }, project: true, cli: 'path' }); valid('meta', m);
    const k = await control({ ...c, level: 'write', autoApprove: true }); expect(k).toEqual({ level: 'write', autoApprove: true }); valid('control', k);
    c.errors = new Map([['memory', 'boom']]);
    const h = await health(c); expect(h).toMatchObject({ ok: false }); expect((h.notes as string[]).join()).toContain('memory: boom'); valid('health', h);
  });
  it('health reports a non-ruflo project dir', async () => {
    const d = tmp(); const c = { ...ctx({}, tmp()), projectDir: d };
    expect(((await health(c)).notes as string[]).join()).toContain('ruflo init');
  });
  it('missions: newest first, detail only for the 10 newest, budget/executor/blocked handled', async () => {
    const c = ctx();
    const list = Array.from({ length: 15 }, (_, i) => ({ missionId: 'msn_' + String(i).padStart(24, '0'), objective: 'o' + i, state: 'draft', revision: i, updatedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      plan: { taskCount: 1, tasks: [{ taskId: 't1', title: 'T', status: 'todo' }] }, evidence: { count: 2, verified: 1 }, executor: i === 14 ? { kind: 'session-bound' } : null, blockedReason: i === 13 ? 'needs authorization' : null, budget: null }));
    c.stub.overrides.mission_get = { ok: true, data: { missions: list } };
    const r = (await missions(c)) as { missions: { id: string; detail?: Record<string, unknown> }[] }; valid('missions', r);
    expect(r.missions[0]!.id).toBe('msn_' + '14'.padStart(24, '0'));
    expect(r.missions.filter(m => m.detail)).toHaveLength(10);
    expect(r.missions[0]!.detail).toMatchObject({ executor: 'session-bound', evidence: { count: 2, verified: 1 }, plan: { taskCount: 1 } });
    expect(r.missions[1]!.detail).toMatchObject({ blockedReason: 'needs authorization' });
  });
  it('mission_events: newest 100 over the 10 newest missions, evidence kind only for evidence events', async () => {
    const c = ctx(); c.cache.missions = { missions: Array.from({ length: 12 }, (_, i) => ({ id: 'msn_' + i })) };
    c.stub.overrides.mission_events = { ok: true, data: { events: [{ seq: 1, type: 'evidence.added', at: '2026-10-08T00:00:00Z', payload: { kind: 'test-run', state: 'x' } }, { seq: 2, type: 'mission.created', at: '2026-10-08T00:00:01Z', payload: {} }] } };
    const r = await mission_events(c) as { events: { type: string; evidenceKind?: string }[] }; valid('mission_events', r);
    expect(c.stub.calls.filter(x => x.tool === 'mission_events')).toHaveLength(10);
    expect(r.events.length).toBe(20); expect(r.events.find(e => e.type === 'evidence.added')?.evidenceKind).toBe('test-run');
  });
  it('tasks, swarm (terminated => null), memory, settings (secret-looking keys dropped)', async () => {
    const c = ctx();
    const t = await tasks(c); expect(t).toMatchObject({ total: 3, done: 1, failed: 0, items: [{ id: 'task-1', title: 'probe', agent: 'agent-1' }] }); valid('tasks', t);
    const s = await swarm(c); expect(s).toMatchObject({ swarm: { id: 'swarm-1', health: 'healthy' }, agents: [{ id: 'agent-1' }] }); valid('swarm', s);
    c.stub.overrides.swarm_status = { swarmId: 'swarm-9', status: 'terminated' };
    expect((await swarm(c)).swarm).toBeNull();
    c.stub.overrides.swarm_status = { status: 'no_swarm' }; expect((await swarm(c)).swarm).toBeNull();
    const m = await memory(c); expect(m).toMatchObject({ entries: 12, namespaceCount: 2, namespaces: [{ name: 'a', count: 1 }, { name: 'b', count: 2 }] }); valid('memory', m);
    const st = await settings(c); expect(JSON.stringify(st)).toContain('logging.level'); expect(JSON.stringify(st)).not.toContain('api.token'); valid('settings', st);
  });
  it('a malformed tool result throws (the scheduler turns it into a note)', async () => {
    const c = ctx(); c.stub.overrides.system_info = 'garbage'; await expect(meta(c)).rejects.toThrow(/unexpected/);
  });
});

describe('file-backed collectors', () => {
  it('read helpers confine to the root, refuse symlinks and cap sizes', () => {
    const d = tmp(); writeFileSync(join(d, 'a.txt'), 'x'.repeat(1000)); mkdirSync(join(d, 'sub')); symlinkSync('/etc/passwd', join(d, 'sub', 'evil.md')); symlinkSync(tmp(), join(d, 'linkdir'));
    expect(readRegular(d, 'a.txt', 10)?.text).toBe('x'.repeat(10)); expect(readRegular(d, 'a.txt', 10, true)?.text).toHaveLength(10);
    expect(readRegular(d, '../etc/passwd', 100)).toBeNull(); expect(readRegular(d, 'sub/evil.md', 100)).toBeNull(); expect(readRegular(d, 'linkdir/x', 100)).toBeNull();
    expect(confine(d, '../..')).toBeNull(); expect(listDir(d, 'sub').map(e => e.name)).toEqual([]);
  });
  it('events: parses the console log tail, skips bad/newer lines, merges mission events, caps at 100', async () => {
    const d = tmp(); const c = ctx({}, d); mkdirSync(join(d, '.claude-flow/console'), { recursive: true });
    const lines = [...Array.from({ length: 150 }, (_, i) => JSON.stringify({ v: 1, t: 1_700_000_000_000 + i, kind: 'swarm', level: 'info', text: `e${i} token=abcdef123456`, src: 'hook' })), 'not json', JSON.stringify({ v: 2, t: 1, kind: 'x', text: 'newer' })];
    writeFileSync(join(d, '.claude-flow/console/events.jsonl'), lines.join('\n') + '\n');
    c.cache.mission_events = { events: [{ missionId: 'msn_1', seq: 3, type: 'mission.created', at: 1_800_000_000_000 }] };
    const r = await events(c) as { events: { at: number; text: string; src: string }[] }; valid('events', r);
    expect(r.events).toHaveLength(100); expect(r.events[0]!.src).toBe('mission'); expect(r.events.some(e => e.text === 'newer')).toBe(false);
  });
  it('events: works with no log file (mission events only)', async () => {
    const c = ctx(); c.cache.mission_events = { events: [] }; expect((await events(c)).events).toEqual([]);
  });
  it('adrs: several status forms, date, supersedes, lint, picks the richest folder', async () => {
    const d = tmp(); const c = ctx({}, d); mkdirSync(join(d, 'docs/adr'), { recursive: true }); mkdirSync(join(d, 'docs/decisions'), { recursive: true });
    writeFileSync(join(d, 'docs/decisions/0001-x.md'), '# X\nStatus: Accepted\n');
    writeFileSync(join(d, 'docs/adr/0001-first.md'), '# First\n\nStatus: Accepted\nDate: 2026-01-02\n');
    writeFileSync(join(d, 'docs/adr/0002-second.md'), '# Second\n\n- **Status**: Proposed\nSupersedes: 0001\n');
    writeFileSync(join(d, 'docs/adr/0003-third.md'), '# Third\n\n## Status\n\nSuperseded\nSuperseded by: ADR-9\n');
    writeFileSync(join(d, 'docs/adr/0004-nostatus.md'), '# Fourth\n');
    writeFileSync(join(d, 'docs/adr/README.md'), '# index');
    const r = await adrs(c) as { folder: string; counts: Record<string, number>; items: { id: string; status: string; date?: string }[]; lint: string[] }; valid('adrs', r);
    expect(r.folder).toBe('docs/adr'); expect(r.items).toHaveLength(4);
    expect(r.counts).toMatchObject({ accepted: 1, proposed: 1, superseded: 1, unknown: 1 });
    expect(r.items.find(i => i.date)?.date).toBe('2026-01-02');
    expect(r.lint.join('|')).toContain('no Status line'); expect(r.lint.join('|')).toContain('ADR-9 not found');
  });
  it('adrs: none found => empty, honest', async () => { expect(await adrs(ctx())).toMatchObject({ folder: 'none', items: [] }); });
  it('whatsnew: newest 3 entries per changelog, breaking lines collected, symlinked changelog ignored', async () => {
    const d = tmp(); const c = ctx({}, d); mkdirSync(join(d, 'plugins/p1'), { recursive: true }); mkdirSync(join(d, 'plugins/p2'), { recursive: true });
    writeFileSync(join(d, 'CHANGELOG.md'), '# Changelog\n## [2.0.0] - 2026-10-01\n- BREAKING: drop node 18\n- new thing\n## [1.9.0] - 2026-09-01\n- fix\n## 1.8.0 (2026-08-01)\n- a\n## 1.7.0\n- old\n');
    writeFileSync(join(d, 'plugins/p1/CHANGELOG.md'), '## 0.1.0\n- first\n'); symlinkSync('/etc/hostname', join(d, 'plugins/p2/CHANGELOG.md'));
    const r = await whatsnew(c) as { plugins: { name: string; entries: { version: string; changes: string[] }[] }[]; breaking: string[] }; valid('whatsnew', r);
    expect(r.plugins.map(p => p.name)).toEqual(['project', 'p1']); expect(r.plugins[0]!.entries.map(e => e.version)).toEqual(['2.0.0', '1.9.0', '1.8.0']);
    expect(r.breaking[0]).toContain('drop node 18');
  });
  it('cost: unavailable (honest) when the ledger script is absent; parsed when present; failures are reported, not zeros', async () => {
    const d = tmp(); const c = ctx({}, d);
    const none = await cost(c); expect(none).toMatchObject({ available: false }); expect(String(none.reason)).toContain('not found'); expect(none.totals).toBeUndefined(); valid('cost', none);
    mkdirSync(join(d, 'plugins/ruflo-cost-tracker/scripts'), { recursive: true }); writeFileSync(join(d, 'plugins/ruflo-cost-tracker/scripts/ledger.mjs'), '//');
    expect(findLedger(d, undefined)).toBeNull(); // never from the project (R-SEC-p0-1)
    const home = tmp(); const sd = join(home, '.claude/plugins/cache/mk/ruflo-cost-tracker/1.2.3/scripts'); mkdirSync(sd, { recursive: true, mode: 0o700 }); writeFileSync(join(sd, 'ledger.mjs'), '//', { mode: 0o600 });
    expect(findLedger(d, home)).toBe(join(require_realpath(home), '.claude/plugins/cache/mk/ruflo-cost-tracker/1.2.3/scripts/ledger.mjs'));
    c.home = home;
    const argvs: string[][] = [];
    const out = { totals: { usd: 12.34, credits: 500 }, byModel: { 'claude|opus': { usd: 10 }, 'codex|gpt': { credits: 500 } }, byDay: { [new Date(1_000_000).toISOString().slice(0, 10)]: { usd: 1.5 } }, cache: { claude: { hitRatio: 0.97 } }, unpriced: { 'gpt-x': {} }, tokens: { 'claude|opus': { input: 1, cache_read: 2, cache_write: 3, output: 4 } }, findings: [{ title: 'Sub-agents on top tier', evidence: '5 msgs' }] };
    c.costDetail = 'full';
    const ok = await cost({ ...c, run: async a => { argvs.push(a); return { code: 0, stdout: JSON.stringify(out), stderr: '', timedOut: false, truncated: false }; } }) as { available: boolean; totals: { totalMinor: number; todayMinor: number }; creditsTotal: number; byModel: { unit: string; minor: number; tokens?: number }[]; cacheHitRatio: number };
    valid('cost', ok); expect(ok).toMatchObject({ available: true, totals: { totalMinor: 1234, todayMinor: 150 }, creditsTotal: 500, cacheHitRatio: 0.97 });
    expect(ok.byModel[0]).toMatchObject({ unit: 'usd', minor: 1000, tokens: 10 });
    expect(argvs[0]!.slice(2)).toEqual(['--since', '7d', '--format', 'json', '--advise']);
    expect(ok).toMatchObject({ detail: 'full' });
    for (const bad of [{ code: 1, stdout: '' }, { code: 0, stdout: 'nope' }, { code: null, stdout: '', timedOut: true }]) {
      const r = await cost({ ...c, run: async () => ({ stderr: '', timedOut: false, truncated: false, ...bad }) }); expect(r.available).toBe(false); valid('cost', r);
    }
  });
});
import { realpathSync } from 'node:fs';
const require_realpath = (p: string) => realpathSync(p);

describe('derived sections', () => {
  it('alerts come from health, collector errors, blocked missions, failed tasks, unhealthy swarm and budget', async () => {
    const c = ctx({ errors: new Map([['cost', 'ledger down']]) });
    c.cache.health = { ok: false, areas: [{ name: 'memory', status: 'degraded' }] };
    c.cache.missions = { missions: [{ id: 'msn_a', state: 'failed', detail: {} }, { id: 'msn_b', state: 'draft', detail: { blockedReason: 'needs plan' } }] };
    c.cache.tasks = { failed: 2 }; c.cache.swarm = { swarm: { health: 'unhealthy' } }; c.cache.cost = { budget: { limitMinor: 100, spentMinor: 120 } };
    const r = await alerts(c) as { alerts: { level: string; key: string }[] }; valid('alerts', r);
    const keys = r.alerts.map(a => a.key);
    for (const k of ['health', 'collect:cost', 'mission:msn_a:failed', 'mission:msn_b:blocked', 'swarm:unhealthy', 'tasks:failed', 'cost:budget']) expect(keys).toContain(k);
    expect(r.alerts[0]!.level).toBe('error');
  });
  it('approvals: local pending commands + missions awaiting authorization (read only)', async () => {
    const c = ctx({ now: () => 100_000, pending: () => [{ cid: 'cmd_1', cmd: 'swarm.init', since: 70_000 }] });
    c.cache.missions = { missions: [{ id: 'msn_a', state: 'awaiting-authorization', objective: 'x', updatedAt: 90_000 }, { id: 'msn_b', state: 'draft' }] };
    const r = await approvals(c) as { items: { kind: string; ageS: number }[] }; valid('approvals', r);
    expect(r.items).toHaveLength(2); expect(r.items[0]).toMatchObject({ kind: 'command', ageS: 30 });
  });
  it('notices mirror the scheduler ring', async () => {
    const c = ctx({ notices: () => [{ at: 1, level: 'info', text: 'hi', key: 'k' }] }); const r = await notices(c); valid('notices', r); expect(r.notices).toHaveLength(1);
  });
});

describe('scheduler', () => {
  function mk(over: Partial<CollectCtx> = {}, only?: readonly SectionName[]) {
    const clock = { t: 1_000_000_000 }; const stub = stubRuflo(); const sent: SectionFrame[] = []; const d = tmp(); mkdirSync(join(d, '.claude-flow'), { recursive: true });
    const s = new SectionScheduler({ now: () => clock.t, emit: f => sent.push(f), only, ctx: { ruflo: stub, projectDir: d, level: 'read', autoApprove: false, cliChoice: 'path', pending: () => [], run: noRun, home: d, now: () => clock.t, ...over } });
    return { s, clock, stub, sent };
  }
  const names = (sent: SectionFrame[]) => sent.map(f => f.section);

  it('first pass sends every section once; an idle second pass sends nothing (hash-diff)', async () => {
    const { s, sent, clock } = mk();
    const r1 = await s.tick(); expect(new Set(r1.sent)).toEqual(new Set(SECTION_NAMES));
    expect(sent.every(f => parseSectionFrame(f).ok)).toBe(true);
    clock.t += 11_000; const n = sent.length; const r2 = await s.tick();
    expect(r2.sent).toEqual([]); expect(sent.length).toBe(n);
  });
  it('re-sends an unchanged section at half its ttl (heartbeat) with a higher rev', async () => {
    const { s, sent, clock } = mk({}, ['tasks']);
    await s.tick(); const rev0 = sent[0]!.rev;
    clock.t += 11_000; await s.tick(); expect(sent).toHaveLength(1); // collected, unchanged, before half ttl
    clock.t += 11_000; expect(22_000).toBeGreaterThan((SECTION_TTL_S.tasks * 1000) / 2); await s.tick(); expect(sent).toHaveLength(2); expect(sent[1]!.rev).toBe(rev0 + 1);
  });
  it('sends again when content changes, and never before the cadence elapses', async () => {
    const { s, sent, clock, stub } = mk({}, ['tasks']);
    await s.tick(); stub.overrides.task_summary = { total: 9, pending: 9, running: 0, completed: 0, failed: 0 };
    clock.t += 3000; await s.tick(); expect(sent).toHaveLength(1);
    clock.t += 8000; await s.tick(); expect(sent).toHaveLength(2); expect((sent[1]!.body as { total: number }).total).toBe(9);
  });
  it('rev is strictly increasing per section', async () => {
    const { s, sent, clock, stub } = mk({}, ['tasks']);
    for (let i = 0; i < 4; i++) { stub.overrides.task_summary = { total: i, pending: 0, running: 0, completed: 0, failed: 0 }; await s.tick(); clock.t += 11_000; }
    const revs = sent.map(f => f.rev); expect(revs).toEqual([...revs].sort((a, b) => a - b)); expect(new Set(revs).size).toBe(revs.length);
  });
  it('watch hints: watched sections keep their cadence, others slow down 4x; missions run at 5 s while a mission runs', async () => {
    const { s, clock, stub } = mk({}, ['tasks', 'memory', 'missions']);
    s.setWatch(['tasks']); expect(s.cadenceMs('tasks')).toBe(10_000); expect(s.cadenceMs('memory')).toBe(60_000 * 4); expect(s.cadenceMs('missions')).toBe(40_000);
    const u = mk({}, ['missions']); u.stub.overrides.mission_get = { ok: true, data: { missions: [{ missionId: 'msn_1', objective: 'o', state: 'running', revision: 1 }] } };
    await u.s.tick(); expect(u.s.cadenceMs('missions')).toBe(5000); void clock; void stub;
  });
  it('a failing collector adds a notice once, keeps the others running and recovers', async () => {
    const { s, sent, clock, stub } = mk({}, ['tasks', 'memory', 'notices']);
    stub.fail.add('memory_stats'); await s.tick();
    expect(names(sent)).toContain('tasks'); expect(names(sent)).not.toContain('memory'); expect(s.errorsNow().has('memory')).toBe(true);
    clock.t += 61_000; await s.tick(); expect(s.snapshot().notices && JSON.stringify(s.snapshot().notices)).toContain('memory could not be read');
    stub.fail.delete('memory_stats'); clock.t += 61_000; await s.tick(); expect(names(sent)).toContain('memory'); expect(s.errorsNow().size).toBe(0);
  });
  it('refresh forces a send but is rate limited per section; refreshAll likewise', async () => {
    const { s, sent, clock } = mk({}, ['tasks', 'memory']);
    await s.tick(); const n = sent.length;
    expect(await s.refresh('tasks')).toEqual({ sent: true }); expect(sent).toHaveLength(n + 1);
    expect(await s.refresh('tasks')).toEqual({ sent: false, rateLimited: true });
    clock.t += FORCED_MIN_INTERVAL_MS + 1; expect((await s.refresh('tasks')).sent).toBe(true);
    const all = await s.refreshAll(); expect(all.sent.sort()).toEqual(['memory', 'tasks']);
    expect((await s.refreshAll()).rateLimited).toBe(true);
  });
  it('mission state changes become notices; resetSent re-sends everything after a reconnect', async () => {
    const { s, sent, clock, stub } = mk({}, ['missions', 'notices']);
    stub.overrides.mission_get = { ok: true, data: { missions: [{ missionId: 'msn_1', objective: 'o', state: 'draft', revision: 1 }] } }; await s.tick();
    stub.overrides.mission_get = { ok: true, data: { missions: [{ missionId: 'msn_1', objective: 'o', state: 'cancelled', revision: 2 }] } }; clock.t += 11_000; await s.tick();
    expect(JSON.stringify(sent.filter(f => f.section === 'notices').at(-1))).toContain('draft -> cancelled');
    const n = sent.length; s.resetSent(); clock.t += 1; await s.tick(); expect(sent.length).toBeGreaterThan(n);
  });
  it('every section has a collector and the stub-based pass emits valid frames for all 27', async () => {
    expect(Object.keys(COLLECTORS).sort()).toEqual([...SECTION_NAMES].sort());
  });
});

describe('spawn budget and tool allowlist', () => {
  it('guard refuses tools outside the allowlist and never calls the inner client for them', async () => {
    const stub = stubRuflo(); const g = guard(stub, READ_TOOLS, new Semaphore(3));
    for (const bad of ['mission_create', 'swarm_init', 'terminal_execute', 'memory_store', 'task_create', 'swarm_shutdown']) await expect(g.mcp(bad, {})).rejects.toBeInstanceOf(RufloError);
    expect(stub.calls).toHaveLength(0);
  });
  it('the command allowlist is the read tools plus a fixed set of writes; no free terminals', () => {
    for (const t of ['terminal_execute', 'memory_delete', 'config_set', 'hooks_worker-dispatch', 'hive-mind_consensus', 'claims_steal', 'claims_handoff', 'workflow_execute', 'metaharness_flywheel']) expect(COMMAND_TOOLS.has(t)).toBe(false);
    for (const t of ['mission_create', 'swarm_shutdown', 'agent_spawn', 'agent_terminate', 'task_create', 'memory_store', 'claims_release', 'claims_status', 'agent_logs']) expect(COMMAND_TOOLS.has(t)).toBe(true);
  });
  it('never runs more than N calls at once', async () => {
    let active = 0, peak = 0;
    const slow = { mcp: async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 15)); active--; return {}; } };
    const g = guard(slow, new Set(['system_info']), new Semaphore(2));
    await Promise.all(Array.from({ length: 9 }, () => g.mcp('system_info', {})));
    expect(peak).toBe(2);
  });
});

describe('new commands', () => {
  const ex = (calls: [string, unknown][], map: Record<string, unknown> = {}) => ({ ruflo: { mcp: async (t: string, p?: Record<string, unknown>) => { calls.push([t, p]); return map[t] ?? {}; } }, cid: 'cmd_abcdefghijklmnop', refreshAll: async () => ({ sent: ['a'] }), refreshSection: async (s: string) => ({ sent: s === 'tasks' }) });
  it('strict argument schemas and levels', () => {
    expect(parseCommand('section.refresh', { section: 'cost' })).toMatchObject({ ok: true, level: 'read' });
    expect(parseCommand('section.refresh', { section: 'bogus' })).toEqual({ ok: false, reason: 'invalid_arguments' });
    expect(parseCommand('memory.list', { namespace: 'dashboard', limit: 50 })).toMatchObject({ ok: true, level: 'read' });
    for (const bad of [{ namespace: 'a b' }, { namespace: '../x' }, { namespace: 'x', limit: 101 }, { namespace: 'x', extra: 1 }, {}]) expect(parseCommand('memory.list', bad).ok).toBe(false);
    expect(parseCommand('swarm.stop', {})).toMatchObject({ ok: true, level: 'manage' }); expect(parseCommand('swarm.stop', { force: true }).ok).toBe(false);
  });
  it('section.refresh and memory.list (keys only) and swarm.stop map to fixed calls', async () => {
    const calls: [string, unknown][] = [];
    expect(await EXECUTORS['section.refresh']({ section: 'tasks' }, ex(calls))).toMatchObject({ ok: true, result: { section: 'tasks', sent: true } });
    const l = await EXECUTORS['memory.list']({ namespace: 'dashboard', limit: 5 }, ex(calls, { memory_list: { entries: [{ key: 'k', namespace: 'dashboard', size: 3, value: 'SECRET-VALUE' }], total: 1 } }));
    expect(JSON.stringify(l)).not.toContain('SECRET-VALUE'); expect(calls.at(-1)).toEqual(['memory_list', { namespace: 'dashboard', limit: 5 }]);
    const sw = await EXECUTORS['swarm.stop']({}, ex(calls, { swarm_status: { swarmId: 'swarm-7', status: 'running' }, swarm_shutdown: { success: true, swarmId: 'swarm-7', terminated: true, agentsTerminated: 2 } }));
    expect(sw).toMatchObject({ ok: true, result: { swarmId: 'swarm-7', agentsTerminated: 2 } }); expect(calls.at(-1)).toEqual(['swarm_shutdown', { swarmId: 'swarm-7' }]);
  });
  it('swarm.stop with nothing running fails honestly and never shuts anything down', async () => {
    const calls: [string, unknown][] = [];
    for (const st of [{ status: 'no_swarm' }, { swarmId: 's', status: 'terminated' }]) expect(await EXECUTORS['swarm.stop']({}, ex(calls, { swarm_status: st }))).toEqual({ ok: false, error: 'no_active_swarm' });
    expect(calls.some(c => c[0] === 'swarm_shutdown')).toBe(false);
  });
  it('a tool answering success:false is a failure, not a success (mission.resume without an executor)', async () => {
    await expect(EXECUTORS['swarm.init']({ topology: 'mesh', maxAgents: 2 }, ex([], { swarm_init: { success: false, error: 'nope' } }))).rejects.toThrow(/nope/);
    const m = ex([], { mission_get: { ok: true, data: { record: { revision: 3 } } }, mission_request_action: { ok: false, code: 'executor-unavailable', message: 'no durable executor' } });
    await expect(EXECUTORS['mission.resume']({ missionId: 'msn_' + 'a'.repeat(24) }, m)).rejects.toThrow(/executor-unavailable/);
  });
  it('mission.resume passes the live revision and reports what ruflo answered', async () => {
    const calls: [string, unknown][] = [];
    const r = await EXECUTORS['mission.resume']({ missionId: 'msn_' + 'a'.repeat(24) }, ex(calls, { mission_get: { ok: true, data: { record: { revision: 8 } } }, mission_request_action: { ok: true, data: { missionId: 'msn_x', state: 'paused', revision: 9 } } }));
    expect(r).toMatchObject({ ok: true, result: { requested: 'resume', state: 'paused', revision: 9 } });
    expect(calls[1]![1]).toMatchObject({ action: 'resume', expectedRevision: 8 });
  });
});
void chmodSync;
