/** Regression tests for the P0 parity security review (docs/security-review.md, 2026-10-08). Each one fails on the pre-fix code. */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { maskSecrets, parseCommand } from '../../src/dashboard/protocol/index.js';
import { isObj, mission_events, nat, str, type CollectCtx } from '../../src/dashboard/collect-core.js';
import { adrs, cost, events, findLedger } from '../../src/dashboard/collect-files.js';
import { EXECUTORS } from '../../src/dashboard/executors.js';
import { resolveRufloCommand, runArgv, scrubEnv, Semaphore } from '../../src/dashboard/exec.js';
import { SectionScheduler } from '../../src/dashboard/scheduler.js';
import { stubRuflo } from './_support/harness.js';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rfp0-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const noRun = async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, truncated: false });
function ctx(over: Partial<CollectCtx> = {}, dir = tmp()): CollectCtx & { stub: ReturnType<typeof stubRuflo> } {
  mkdirSync(join(dir, '.claude-flow'), { recursive: true });
  const stub = stubRuflo();
  return { stub, ruflo: stub, projectDir: dir, level: 'read', autoApprove: false, cliChoice: 'path', now: () => 1_000_000, cache: {}, errors: new Map(), pending: () => [], notices: () => [], run: noRun, home: dir, ...over };
}
/** A trusted-looking plugin cache: private dirs and file, as `claude` creates them. */
function pluginCache(ver = '1.0.0'): { home: string; script: string } {
  const home = tmp(); const sd = join(home, '.claude/plugins/cache/mk/ruflo-cost-tracker', ver, 'scripts');
  mkdirSync(sd, { recursive: true, mode: 0o700 }); writeFileSync(join(sd, 'ledger.mjs'), 'console.log("{}")', { mode: 0o600 });
  return { home, script: join(realpathSync(home), '.claude/plugins/cache/mk/ruflo-cost-tracker', ver, 'scripts/ledger.mjs') };
}

describe('R-SEC-p0-1 the ledger is never run from the project', () => {
  const planted = (dir: string, marker: string) => {
    const sd = join(dir, 'plugins/ruflo-cost-tracker/scripts'); mkdirSync(sd, { recursive: true });
    writeFileSync(join(sd, 'ledger.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran'); console.log('{}');`);
  };
  it('a project containing plugins/ruflo-cost-tracker/scripts/ledger.mjs is not executed (marker not written)', async () => {
    const d = tmp(); const marker = join(tmp(), 'marker'); planted(d, marker);
    const c = ctx({ home: tmp(), run: (argv, t) => runArgv(argv, { cwd: d, timeoutMs: t }) }, d);
    const r = await cost(c);
    expect(existsSync(marker)).toBe(false);
    expect(r).toMatchObject({ available: false }); expect(String(r.reason)).toContain('never run');
  });
  it('the project cannot reach the script through home either (home inside the project, symlink into the project)', () => {
    const d = tmp(); planted(d, join(d, 'm'));
    const cache = join(d, '.claude/plugins/cache/mk/ruflo-cost-tracker/1.0.0'); mkdirSync(join(d, '.claude/plugins/cache/mk/ruflo-cost-tracker'), { recursive: true });
    symlinkSync(join(d, 'plugins/ruflo-cost-tracker'), cache);
    expect(findLedger(d, d)).toBeNull();
    const { home } = pluginCache(); const base = join(home, '.claude/plugins/cache/mk/ruflo-cost-tracker'); symlinkSync(join(d, 'plugins/ruflo-cost-tracker'), join(base, '9.9.9'));
    expect(findLedger(d, home)).toMatch(/1\.0\.0/); // the symlinked higher version is ignored
  });
  it('the plugin cache is trusted only when private: a group/world-writable script or directory is refused', () => {
    const { home, script } = pluginCache(); const d = tmp();
    expect(findLedger(d, home)).toBe(script);
    chmodSync(script, 0o666); expect(findLedger(d, home)).toBeNull();
    chmodSync(script, 0o600); chmodSync(join(script, '..'), 0o775); expect(findLedger(d, home)).toBeNull();
  });
  it('an explicit user ledgerPath works only when absolute, private, and outside the project', () => {
    const { script } = pluginCache(); const d = tmp();
    expect(findLedger(d, undefined, script)).toBe(script);
    expect(findLedger(d, undefined, 'relative/ledger.mjs')).toBeNull();
    const inside = join(d, 'ledger.mjs'); writeFileSync(inside, '//', { mode: 0o600 }); chmodSync(d, 0o700);
    expect(findLedger(d, undefined, inside)).toBeNull();
    expect(findLedger(d, undefined, join(d, 'nope.mjs'))).toBeNull();
  });
});

describe('R-SEC-p0-2 no ReDoS on hostile ADR files', () => {
  it('a 4 KiB "## status" + newlines ADR is parsed in < 50 ms (was ~10 s)', async () => {
    const d = tmp(); mkdirSync(join(d, 'docs/adr'), { recursive: true });
    const hostile: Record<string, string> = {
      '0001-nl.md': ('# T\n## status' + '\n'.repeat(4096)).slice(0, 4096),
      '0002-sp.md': ('# T\n## status' + ' \n'.repeat(2048)).slice(0, 4096),
      '0003-mix.md': ('# T\n## status\n' + '\t \r\n'.repeat(1024)).slice(0, 4096),
      '0004-ok.md': '# Fine\n## Status\n\nAccepted\n',
      '0005-inline.md': '# Inline\nStatus: Proposed\n',
    };
    for (const [n, t] of Object.entries(hostile)) writeFileSync(join(d, 'docs/adr', n), t);
    const t0 = performance.now(); const r = await adrs(ctx({}, d)) as { items: { id: string; status: string }[] }; const ms = performance.now() - t0;
    expect(ms).toBeLessThan(50);
    expect(r.items.find(i => i.id === 'ADR-4')?.status ?? r.items.find(i => i.status === 'accepted')?.status).toBe('accepted');
    expect(r.items.some(i => i.status === 'proposed')).toBe(true);
  });
});

describe('R-SEC-p0-3 a FIFO named like an expected file does not hang the connector', () => {
  it('readRegular returns promptly (child process with a hard timeout) for FIFO CHANGELOG.md and events.jsonl', () => {
    const d = tmp(); mkdirSync(join(d, '.claude-flow/console'), { recursive: true });
    for (const f of ['CHANGELOG.md', '.claude-flow/console/events.jsonl']) expect(spawnSync('mkfifo', [join(d, f)]).status).toBe(0);
    const here = realpathSync(join(__dirname, '../../src/dashboard/read.ts'));
    const script = `import {readRegular} from ${JSON.stringify(here)}; const a=readRegular(${JSON.stringify(d)},'CHANGELOG.md',1000); const b=readRegular(${JSON.stringify(d)},'.claude-flow/console/events.jsonl',1000,true); console.log(JSON.stringify([a,b]));`;
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: join(__dirname, '../..'), timeout: 8000, encoding: 'utf8' });
    expect(r.error, 'child must not time out').toBeUndefined();
    expect(r.stdout.trim()).toBe('[null,null]');
  }, 20_000);
});

describe('R-SEC-p0-4 masking: URL credentials, env-style names, live keys, bare secrets; mask before truncating', () => {
  const gone: [string, string][] = [
    ['postgres://admin:hunter2pass@db.internal:5432/app', 'hunter2pass'], ['mysql://root:toor@h/x', 'toor@'], ['redis://:s3cretpw@cache:6379', 's3cretpw'],
    ['AWS_SECRET=wJalrXUtnFEMI/K7MDENG', 'wJalrXUtnFEMI'], ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCY', 'wJalrXUtnFEMI'], ['CLIENT_SECRET: abcdef123456', 'abcdef123456'],
    ['sk_live_51HabcdefGHIJKLmnop', 'sk_live_51H'], ['rk_live_abcdefgh12345678', 'rk_live_abcd'], ['pk_live_abcdefgh12345678', 'pk_live_abcd'],
    ['dbpass: 9f8e7d6c5b4a39281706f5e4d3c2b1a0', '9f8e7d6c5b4a3928'], ['the token is Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg==', 'Zm9vYmFy'], ['password 0123456789abcdef0123456789abcdef01234567', '0123456789abcdef0123'],
  ];
  for (const [input, secret] of gone) it(`masks: ${input.slice(0, 30)}`, () => { const out = maskSecrets(`see ${input} end`); expect(out).not.toContain(secret); expect(out).toContain('[masked]'); });
  it('keeps ordinary text: ADR ids, bare git hashes, dates, plain words after "token"/"key"', () => {
    for (const keep of ['ADR-0042: use postgres', 'commit 9fa701a46 merged', 'sha 38c30b112d0e4a9b8f7c6d5e4f3a2b1c0d9e8f7a done', 'https://github.com/ruvnet/ruflo/pull/3905', 'token budget enforcement-and-limits-policy-for-production', 'key rotation every 90 days', '2026-10-08 Accepted', 'http://example.com/a:b@c'])
      expect(maskSecrets(keep), keep).toBe(keep);
  });
  it('str() masks BEFORE it truncates, so a token cut at the limit leaves no prefix', () => {
    const text = 'x'.repeat(184) + ' sk-ABCDEFGHIJKLMNOPQRSTUVWX tail';
    const old = text.slice(0, 200); expect(old).toContain('sk-ABCDE'); // what the pre-fix order produced
    expect(str(text, 200)).not.toContain('sk-A');
  });
  it('events from a hostile console log never carry a token prefix', async () => {
    const d = tmp(); const line = JSON.stringify({ v: 1, t: 1_000, kind: 'k', text: 'y'.repeat(184) + ' sk-ABCDEFGHIJKLMNOPQRSTUVWX tail' });
    mkdirSync(join(d, '.claude-flow/console'), { recursive: true }); writeFileSync(join(d, '.claude-flow/console/events.jsonl'), line + '\n');
    const r = await events(ctx({}, d)) as { events: { text: string }[] }; expect(r.events[0]!.text).not.toContain('sk-A');
  });
});

describe('R-SEC-p0-6 relative PATH entries never resolve against the project', () => {
  it('resolveRufloCommand ignores relative entries and returns an absolute path for absolute ones', () => {
    const proj = tmp(); mkdirSync(join(proj, 'bin')); writeFileSync(join(proj, 'bin/ruflo'), '#!/bin/sh\ntouch marker\n', { mode: 0o755 });
    const cwd = process.cwd(); process.chdir(proj);
    try { expect(() => resolveRufloCommand(undefined, 'bin')).toThrowError(/not on PATH/); expect(() => resolveRufloCommand(undefined, `.:${join(proj, 'nope')}`)).toThrowError(/not on PATH/); } finally { process.chdir(cwd); }
    // R-SEC-p1-q6: an absolute PATH entry INSIDE the project is project code too (direnv, `npm run`): never resolved there
    expect(() => resolveRufloCommand(undefined, `bin:${join(proj, 'bin')}`, proj)).toThrowError(/not on PATH/);
    const other = tmp(); writeFileSync(join(other, 'ruflo'), '#!/bin/sh\n', { mode: 0o755 });
    expect(resolveRufloCommand(undefined, `${join(proj, 'bin')}:${other}`, proj)).toEqual([join(other, 'ruflo')]);
  });
  it('a child spawned with cwd=project and PATH=bin:... does not run the project-local bin/ruflo', async () => {
    const proj = tmp(); mkdirSync(join(proj, 'bin')); writeFileSync(join(proj, 'bin/ruflo'), '#!/bin/sh\ntouch marker\n', { mode: 0o755 });
    const env = scrubEnv({ PATH: 'bin:./node_modules/.bin::/nonexistent-dir', HOME: '/h' });
    expect(env.PATH).toBe('/nonexistent-dir');
    await runArgv(['ruflo', 'mcp'], { cwd: proj, env }).catch(() => undefined);
    expect(existsSync(join(proj, 'marker'))).toBe(false);
  });
});

describe('R-SEC-p0-8 non-safe integers', () => {
  it('nat() clamps to a safe integer', () => { expect(nat(1e308)).toBe(Number.MAX_SAFE_INTEGER); expect(nat(-1)).toBe(0); expect(nat(41.9)).toBe(41); });
});

describe('R-SEC-p0-9 collector spawn rate and the 3-process semaphore', () => {
  it('mission_events is fetched once per CHANGED mission, not for all missions on every pass', async () => {
    const missions = Array.from({ length: 10 }, (_, i) => ({ missionId: 'msn_' + String(i).padStart(24, '0'), objective: 'm' + i, state: 'draft', revision: 1, updatedAt: '2026-10-08T03:11:19.776Z' }));
    const c = ctx(); c.stub.overrides.mission_get = { ok: true, data: { missions } };
    const clock = { t: 1_000_000 };
    const s = new SectionScheduler({ now: () => clock.t, emit: () => undefined, only: ['missions', 'mission_events'], ctx: { ruflo: c.stub, projectDir: c.projectDir, level: 'read', autoApprove: false, cliChoice: 'path', pending: () => [], run: noRun, home: c.projectDir, now: () => clock.t } });
    const count = () => c.stub.calls.filter(k => k.tool === 'mission_events').length;
    await s.tick(); expect(count()).toBe(10);
    for (let i = 0; i < 6; i++) { clock.t += 10_000; await s.tick(); }
    expect(count()).toBe(10); // idle: no refetch
    missions[3]!.revision = 2; missions[3]!.updatedAt = '2026-10-08T03:20:00.000Z';
    clock.t += 10_000; await s.tick(); expect(count()).toBe(11); // only the changed mission
  });
  it('a woken waiter cannot push the semaphore past its max (a caller arriving between the wake-up and the resume used to take the slot too)', async () => {
    const sem = new Semaphore(1); let cur = 0, peak = 0; const later: Promise<void>[] = [];
    const hold = async () => { cur++; peak = Math.max(peak, cur); await new Promise(r => setImmediate(r)); cur--; };
    // A releases; a microtask chained behind A's own continuation calls run() after A freed the slot but before waiter B resumes.
    const A = sem.run(async () => { cur++; peak = Math.max(peak, cur); await new Promise(r => setImmediate(r)); cur--; queueMicrotask(() => queueMicrotask(() => { later.push(sem.run(hold)); })); });
    const B = sem.run(hold);
    await Promise.all([A, B]); await Promise.all(later); await new Promise(r => setImmediate(r));
    expect(later.length).toBe(1); expect(peak).toBe(1); expect(sem.inFlight).toBe(0);
  });
});

describe('R-SEC-p0-10 expectedRevision', () => {
  const id = 'msn_' + 'a'.repeat(24);
  const run = (cmd: 'mission.pause' | 'mission.resume' | 'mission.stop', args: Record<string, unknown>, live: number) => {
    const calls: string[] = [];
    const ruflo = { mcp: async (t: string, p?: Record<string, unknown>) => { calls.push(t); return t === 'mission_get' ? { ok: true, data: { record: { revision: live } } } : { ok: true, data: { missionId: p!.missionId, state: 'paused', revision: live + 1 } }; } };
    return EXECUTORS[cmd](args, { ruflo, cid: 'cmd_x', refreshAll: async () => ({ sent: [] }), refreshSection: async () => ({ sent: false }) }).then(r => ({ r, calls }));
  };
  it('schema: optional strict integer >= 1 on pause, resume and stop', () => {
    for (const cmd of ['mission.pause', 'mission.resume', 'mission.stop']) {
      expect(parseCommand(cmd, { missionId: id })).toMatchObject({ ok: true });
      expect(parseCommand(cmd, { missionId: id, expectedRevision: 3 })).toMatchObject({ ok: true, args: { expectedRevision: 3 } });
      for (const bad of [0, -1, 1.5, 1e308, Number.MAX_SAFE_INTEGER + 2, '2', null]) expect(parseCommand(cmd, { missionId: id, expectedRevision: bad }), String(bad)).toEqual({ ok: false, reason: 'invalid_arguments' });
    }
  });
  it('a mismatch with the live revision fails revision_changed and NEVER requests the action', async () => {
    for (const cmd of ['mission.pause', 'mission.resume', 'mission.stop'] as const) {
      const { r, calls } = await run(cmd, { missionId: id, expectedRevision: 3 }, 4);
      expect(r).toEqual({ ok: false, error: 'revision_changed' }); expect(calls).toEqual(['mission_get']);
    }
  });
  it('a match acts with that revision; omitting it keeps the old behaviour', async () => {
    const a = await run('mission.pause', { missionId: id, expectedRevision: 4 }, 4); expect(a.r.ok).toBe(true); expect(a.calls).toEqual(['mission_get', 'mission_request_action']);
    const b = await run('mission.stop', { missionId: id }, 9); expect(b.r.ok).toBe(true);
  });
});
void isObj; void mission_events;
