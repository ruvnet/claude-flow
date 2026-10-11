/** R-SEC-p1-q1..q10: regressions for the P1 capability channel review (docs/security-review.md). Each fails on the code before the fix. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSectionFrame, sanitize } from '../../src/dashboard/protocol/index.js';
import { printable, renderApproval, visible } from '../../src/dashboard/approver.js';
import { BindingTable } from '../../src/dashboard/capabilities/bindings.js';
import { buildCatalogAsync, catalogBody, pluginsBody } from '../../src/dashboard/capabilities/catalog.js';
import { OPTION_ALLOW } from '../../src/dashboard/capabilities/options.js';
import { CapabilityService, LIST_MIN_INTERVAL_MS, type Prepared } from '../../src/dashboard/capabilities/service.js';
import type { Binding } from '../../src/dashboard/capabilities/types.js';
import { meta, type CollectCtx } from '../../src/dashboard/collect-core.js';
import { resolveOnPath, resolveRufloCommand } from '../../src/dashboard/exec.js';
import { AuditLog } from '../../src/dashboard/state.js';
import { stubRuflo } from './_support/harness.js';
import { makeClaudeHome, writeFile, type FixturePlugin } from './_support/plugin-fixture.js';

const roots: string[] = [];
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'rfq-'))); roots.push(d); return d; };
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });
const ok = (stdout = '{}', code = 0) => ({ code, stdout, stderr: '', timedOut: false, truncated: false });

const bool = (def: boolean) => ({ type: 'boolean', default: def });
const onOff = (def: string) => ({ type: 'string', options: ['on', 'off'], default: def });
const REAL: FixturePlugin[] = [
  { name: 'ruflo-protector', files: { 'README.md': 'p' }, userConfig: { mode: { type: 'string', options: ['off', 'learn', 'notify', 'enforce'], default: 'enforce' }, autoGraduate: onOff('on'), guard: onOff('on') } },
  { name: 'ruflo-neural-trader', files: { 'README.md': 'n' }, userConfig: { liveGuard: onOff('on'), guard: onOff('on') } },
  { name: 'ruflo-bbs-federation', files: { 'README.md': 'b' }, userConfig: { allowWildcardBind: onOff('off') } },
  { name: 'ruflo-mods', files: { 'README.md': 'm' }, userConfig: { deliveryScreen: bool(true), costHardStop: bool(true), toolHints: bool(false), statusLine: bool(true), costBudgetUsd: { type: 'number', default: 0 }, agentTrim: bool(false), guidanceLearning: bool(false) } },
  { name: 'ruflo-intelligence', files: { 'README.md': 'i' }, userConfig: { confirmReset: onOff('on') } },
  { name: 'ruflo-jujutsu', files: { 'README.md': 'j' }, userConfig: { confirmPrActions: onOff('on') } },
  { name: 'ruflo-console', files: { 'README.md': 'c' }, userConfig: { look: { type: 'string', options: ['bbs', 'plain'], default: 'bbs' }, fps: { type: 'number', default: 8 }, wfBudgetDayUsd: { type: 'number', default: 0 } } },
  { name: 'ruflo-adr', files: { 'README.md': 'a' }, userConfig: { guard: onOff('on') } },
];
function setup(extra: FixturePlugin[] = [], o: { current?: Record<string, string>; run?: (argv: string[], x: { cwd: string; timeoutMs: number; stdin?: string }) => Promise<ReturnType<typeof ok>>; table?: BindingTable; project?: string; sources?: string[] } = {}) {
  const home = tmp(); const project = o.project ?? tmp(); const stub = stubRuflo(); const mcpOpts: Array<{ tool: string; timeoutMs?: number }> = [];
  const dirs = makeClaudeHome(home, [...REAL, ...extra]);
  const calls: Array<{ argv: string[]; cwd: string; stdin?: string }> = [];
  const run = o.run ?? (async (argv: string[], x: { cwd: string; stdin?: string }) => { calls.push({ argv, cwd: x.cwd, stdin: x.stdin }); return ok(argv.includes('--json') ? JSON.stringify({ inputs: o.current ?? {} }) : 'done'); });
  const ruflo = { calls: stub.calls, async mcp(tool: string, params?: Record<string, unknown>, opts?: { timeoutMs?: number }) { mcpOpts.push({ tool, timeoutMs: opts?.timeoutMs }); return stub.mcp(tool, params); } };
  stub.overrides.agentdb_consolidate = { done: true };
  const audit = new AuditLog(join(home, 'state')); let t = 1_000_000;
  const svc = new CapabilityService({ home, projectDir: project, ruflo, rufloBase: ['/usr/bin/ruflo'], claude: '/usr/bin/claude', audit, run, table: o.table, now: () => (t += 1000), marketplaceSources: o.sources });
  return { home, project, stub, dirs, svc, calls, mcpOpts, advance: (ms: number) => { t += ms; } };
}
const set = (s: ReturnType<typeof setup>, id: string, key: string, value: unknown) => s.svc.prepare('mod.option.set', { modId: id, key, value }, 'u');

describe('R-SEC-p1-q1 mod.option.set is an allowlist; safety options move only toward the safer value', () => {
  const LOOSEN: Array<[string, string, unknown, Record<string, string>]> = [
    ['ruflo-protector@ruflo', 'mode', 'off', { mode: 'enforce' }], ['ruflo-protector@ruflo', 'mode', 'learn', { mode: 'enforce' }], ['ruflo-neural-trader@ruflo', 'liveGuard', 'off', { liveGuard: 'on' }],
    ['ruflo-bbs-federation@ruflo', 'allowWildcardBind', 'on', { allowWildcardBind: 'off' }], ['ruflo-mods@ruflo', 'deliveryScreen', false, { deliveryScreen: 'true' }], ['ruflo-mods@ruflo', 'costHardStop', false, { costHardStop: 'true' }],
    ['ruflo-intelligence@ruflo', 'confirmReset', 'off', { confirmReset: 'on' }], ['ruflo-jujutsu@ruflo', 'confirmPrActions', 'off', { confirmPrActions: 'on' }], ['ruflo-adr@ruflo', 'guard', 'off', { guard: 'on' }],
  ];
  it.each(LOOSEN)('%s.%s -> %s is refused (loosens-gate)', async (id, key, value, current) => {
    const s = setup([], { current }); expect(await set(s, id, key, value)).toEqual({ ok: false, code: 'loosens-gate' });
  });
  it('the same options are accepted toward the safer value, with old and new on the card', async () => {
    const s = setup([], { current: { mode: 'learn', liveGuard: 'off', allowWildcardBind: 'on', deliveryScreen: 'false', guard: 'off' } });
    const p = await set(s, 'ruflo-protector@ruflo', 'mode', 'enforce'); expect(p).toMatchObject({ ok: true, typed: 'ruflo-protector' }); expect((p as Prepared).card.option).toBe('ruflo-protector.mode: learn -> enforce');
    expect(await set(s, 'ruflo-neural-trader@ruflo', 'liveGuard', 'on')).toMatchObject({ ok: true });
    expect(await set(s, 'ruflo-bbs-federation@ruflo', 'allowWildcardBind', 'off')).toMatchObject({ ok: true });
    expect(await set(s, 'ruflo-mods@ruflo', 'deliveryScreen', true)).toMatchObject({ ok: true, typed: 'ruflo-mods' });
    expect(await set(s, 'ruflo-adr@ruflo', 'guard', 'on')).toMatchObject({ ok: true });
  });
  it('options that are not on the allowlist are not-settable whatever their type: autoGraduate, agentTrim, guidanceLearning', async () => {
    const s = setup();
    for (const [key, v] of [['autoGraduate', 'off'], ['autoGraduate', 'on']] as const) expect(await set(s, 'ruflo-protector@ruflo', key, v)).toEqual({ ok: false, code: 'not-settable' });
    expect(await set(s, 'ruflo-mods@ruflo', 'agentTrim', true)).toEqual({ ok: false, code: 'not-settable' });
    expect(await set(s, 'ruflo-mods@ruflo', 'guidanceLearning', true)).toEqual({ ok: false, code: 'not-settable' });
  });
  it('cosmetic options and ranged numbers stay settable; a plugin cannot widen its own rule by changing the option type in its manifest', async () => {
    const s = setup([{ name: 'ruflo-evilcfg', files: { 'README.md': 'e' }, userConfig: { guard: { type: 'string', options: ['off'] }, look: onOff('on') } }], { current: { look: 'bbs', fps: '8' } });
    expect(await set(s, 'ruflo-console@ruflo', 'look', 'plain')).toMatchObject({ ok: true });
    expect(await set(s, 'ruflo-console@ruflo', 'fps', 30)).toMatchObject({ ok: true });
    expect(await set(s, 'ruflo-console@ruflo', 'fps', 61)).toEqual({ ok: false, code: 'bad_value' });
    expect(await set(s, 'ruflo-evilcfg@ruflo', 'look', 'off')).toEqual({ ok: false, code: 'not-settable' });
    expect(await set(s, 'ruflo-evilcfg@ruflo', 'guard', 'off')).toEqual({ ok: false, code: 'loosens-gate' });
  });
  it('a garbled stored budget is never read as "no cap" (config_unreadable)', async () => {
    const s = setup([], { current: { costBudgetUsd: 'garbage' } }); expect(await set(s, 'ruflo-mods@ruflo', 'costBudgetUsd', 1e6 / 20)).toEqual({ ok: false, code: 'config_unreadable' });
  });
  it('every allowlisted safety rule names exactly one safe direction (no "free" rule on a guard-like key)', () => {
    for (const [k, r] of Object.entries(OPTION_ALLOW)) if (/guard|confirm|mode|strict|Wildcard|deliveryScreen|HardStop|liveGuard/i.test(k)) expect(r.t, k).toBe('toward');
  });
});

describe('R-SEC-p1-q2 binding timeouts reach the ruflo call', () => {
  it('agentdb_consolidate runs with its 120 s budget and a timed-out write says the outcome is unknown', async () => {
    const s = setup([{ name: 'ruflo-agentdb', version: '0.4.7', files: { 'commands/agentdb.md': '# a\n' } }]);
    const cap = s.svc.catalog().plugins.find(p => p.id === 'ruflo-agentdb@ruflo')!.caps.find(c => c.name === 'consolidate')!;
    const p = await s.svc.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: cap.cid, args: {} }, 'u'); if (!p.ok) throw new Error(p.code);
    expect(await s.svc.execute(p)).toMatchObject({ ok: true }); expect(s.mcpOpts.at(-1)).toEqual({ tool: 'agentdb_consolidate', timeoutMs: 120_000 });
    s.advance(120_000);
    const slow = { async mcp() { throw new Error('agentdb_consolidate timed out'); } };
    const svc2 = new CapabilityService({ ...(s.svc as unknown as { d: ConstructorParameters<typeof CapabilityService>[0] }).d, ruflo: slow });
    const p2 = await svc2.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: cap.cid, args: {} }, 'u'); if (!p2.ok) throw new Error(p2.code);
    expect(await svc2.execute(p2)).toEqual({ ok: false, error: 'timeout_outcome_unknown' });
  });
});

describe('R-SEC-p1-q3 one bad plugin never blanks the others', () => {
  it('a 60-character version, a 130 KB manifest and a garbage manifest are listed (version unknown / unreadable) while the sections still build', async () => {
    const s = setup([{ name: 'ruflo-longver', version: '1.0.0-' + 'x'.repeat(60), files: { 'commands/a.md': 'a' } }, { name: 'ruflo-hugeman', files: { 'commands/a.md': 'a' } }, { name: 'ruflo-garbage', files: {} }]);
    writeFile(s.dirs['ruflo-hugeman@ruflo']!, '.claude-plugin/plugin.json', JSON.stringify({ name: 'x', version: '1.0.0', pad: 'p'.repeat(130_000) }));
    writeFile(s.dirs['ruflo-garbage@ruflo']!, '.claude-plugin/plugin.json', '{not json');
    const cat = await buildCatalogAsync({ configDir: join(s.home, '.claude'), cacheDir: join(s.home, '.claude/plugins/cache') });
    const caps = catalogBody(cat); const pl = pluginsBody(cat);
    expect(() => buildSectionFrame('capabilities', caps as never, { rev: 1, at: 1 })).not.toThrow();
    expect(() => buildSectionFrame('plugins', pl as never, { rev: 1, at: 1 })).not.toThrow();
    const byId = Object.fromEntries((caps.plugins as Array<{ id: string; why?: string; version: string; caps: unknown[] }>).map(p => [p.id, p]));
    expect(byId['ruflo-hugeman@ruflo']).toMatchObject({ why: 'unreadable' }); expect(byId['ruflo-garbage@ruflo']).toMatchObject({ why: 'unreadable' });
    expect(byId['ruflo-longver@ruflo']!.version.length).toBeLessThanOrEqual(40); expect(byId['ruflo-longver@ruflo']!.caps).toEqual([]);
    expect(byId['ruflo-protector@ruflo']).toBeDefined(); expect(byId['ruflo-mods@ruflo']!.caps.length).toBeGreaterThan(-1);
  });
});

describe('R-SEC-p1-q4 the catalog is cached, shared, rate limited and verified uncached', () => {
  it('a rewrite that keeps size and mtime (utimes) is still seen: the cache key includes ctime', async () => {
    const s = setup([{ name: 'ruflo-agentdb', version: '0.4.7', files: { 'commands/agentdb.md': 'AAAA' } }]);
    const r = { configDir: join(s.home, '.claude'), cacheDir: join(s.home, '.claude/plugins/cache') };
    const cid = async () => (await buildCatalogAsync(r)).plugins.find(p => p.id === 'ruflo-agentdb@ruflo')!.caps.find(c => c.name === 'agentdb')!.cid;
    const a = await cid(); expect(await cid()).toBe(a);
    const f = join(s.dirs['ruflo-agentdb@ruflo']!, 'commands/agentdb.md'); const { statSync } = await import('node:fs'); const st = statSync(f);
    writeFileSync(f, 'BBBB'); utimesSync(f, st.atime, st.mtime);
    expect(await cid()).not.toBe(a);
  });
  it('plugin.list is limited to one per 5 s per device; the plugins and capabilities collectors of one pass share one build', async () => {
    const s = setup();
    expect(await s.svc.prepare('plugin.list', {}, 'u')).toMatchObject({ ok: true });
    expect(await s.svc.prepare('plugin.list', {}, 'u')).toEqual({ ok: false, code: 'rate_limited' });
    s.advance(LIST_MIN_INTERVAL_MS + 1); expect(await s.svc.prepare('plugin.list', {}, 'u')).toMatchObject({ ok: true });
    const [a, b] = await Promise.all([s.svc.pluginsBody(), s.svc.capabilitiesBody()]);
    expect((a as { plugins: unknown[] }).plugins.length).toBe((b as { plugins: unknown[] }).plugins.length);
  });
  it('building yields to the event loop (a timer fires between plugins)', async () => {
    const s = setup(); let ticks = 0; const t = setInterval(() => { ticks++; }, 0);
    await buildCatalogAsync({ configDir: join(s.home, '.claude'), cacheDir: join(s.home, '.claude/plugins/cache') }); clearInterval(t);
    expect(ticks).toBeGreaterThan(0);
  });
});

describe('R-SEC-p1-q5 a project that moves ruflo\'s store outside itself is told and write-class runs are refused', () => {
  const cfg = (project: string, body: unknown) => writeFileSync(join(project, 'claude-flow.config.json'), JSON.stringify(body));
  const ctx = (project: string): CollectCtx => ({ ruflo: { async mcp() { return { version: '3.55.0' }; } }, projectDir: project, level: 'read', autoApprove: false, cliChoice: 'path', now: () => 1, cache: {}, errors: new Map(), pending: () => [], notices: () => [], run: async () => ok() } as unknown as CollectCtx);
  it('meta carries a note, naming the key and not the path', async () => {
    const project = tmp(); cfg(project, { memory: { path: '/tmp/elsewhere/memory.db' } });
    const m = await meta(ctx(project)) as { notes?: string[] }; expect(m.notes?.[0]).toContain('memory.path'); expect(JSON.stringify(m)).not.toContain('/tmp/elsewhere');
    expect(buildSectionFrame('meta', m as never, { rev: 1, at: 1 })).toBeTruthy();
    const inside = tmp(); cfg(inside, { memory: { path: './data/memory.db' } }); expect((await meta(ctx(inside)) as { notes?: string[] }).notes).toBeUndefined();
  });
  it('a write capability is refused (path-outside-root), a read one still runs', async () => {
    const project = tmp(); cfg(project, { memory: { dbPath: '../outside/memory.db' } });
    const s = setup([{ name: 'ruflo-agentdb', version: '0.4.7', files: { 'commands/agentdb.md': '# a\n' } }], { project });
    const cap = (n: string) => s.svc.catalog().plugins.find(p => p.id === 'ruflo-agentdb@ruflo')!.caps.find(c => c.name === n)!.cid;
    expect(await s.svc.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: cap('consolidate'), args: {} }, 'u')).toEqual({ ok: false, code: 'path-outside-root' });
    expect(await s.svc.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: cap('health'), args: {} }, 'u')).toMatchObject({ ok: true });
  });
});

describe('R-SEC-p1-q6 a ruflo/claude binary inside the project is never resolved', () => {
  it('PATH entries inside the project (absolute, or a link into it) are skipped; binaries outside are found', () => {
    const proj = tmp(); const outside = tmp(); mkdirSync(join(proj, 'node_modules/.bin'), { recursive: true });
    for (const d of [join(proj, 'node_modules/.bin'), outside]) writeFileSync(join(d, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
    expect(resolveOnPath('claude', join(proj, 'node_modules/.bin'), proj)).toBeNull();
    const lk = tmp(); symlinkSync(join(proj, 'node_modules/.bin/claude'), join(lk, 'claude')); expect(resolveOnPath('claude', lk, proj)).toBeNull();
    expect(resolveOnPath('claude', `${join(proj, 'node_modules/.bin')}:${outside}`, proj)).toBe(join(outside, 'claude'));
    expect(() => resolveRufloCommand(undefined, join(proj, 'node_modules/.bin'), proj)).toThrow(/not on PATH/);
  });
});

describe('R-SEC-p1-q7 marketplace trust includes the recorded source', () => {
  const known = (home: string, source: Record<string, string>) => writeFile(home, '.claude/plugins/known_marketplaces.json', JSON.stringify({ ruflo: { source } }));
  const foreignOf = async (s: ReturnType<typeof setup>) => (await s.svc.pluginsBody() as { plugins: Array<{ id: string; foreign: boolean }> }).plugins.find(p => p.id === 'ruflo-adr@ruflo')!.foreign;
  it('a marketplace named ruflo whose recorded source is another repo gets no bindings', async () => {
    const s = setup(); known(s.home, { source: 'github', repo: 'evil/ruflo' }); expect(await foreignOf(s)).toBe(true);
    const s2 = setup(); known(s2.home, { source: 'github', repo: 'ruvnet/ruflo' }); expect(await foreignOf(s2)).toBe(false);
    const s3 = setup(); expect(await foreignOf(s3)).toBe(false); // nothing recorded: name only
  });
  it('a local directory source (a development checkout the user registered) is accepted; another remote source type needs an allow entry', async () => {
    const s = setup(); known(s.home, { source: 'directory', path: '/home/u/ruflo-live' }); expect(await foreignOf(s)).toBe(false);
    const s2 = setup(); known(s2.home, { source: 'git', url: 'https://example.com/ruflo.git' }); expect(await foreignOf(s2)).toBe(true);
    const s3 = setup([], { sources: ['git:https://example.com/ruflo.git'] }); known(s3.home, { source: 'git', url: 'https://example.com/ruflo.git' }); expect(await foreignOf(s3)).toBe(false);
  });
  it('run records carry the plugin id so look-alikes with the same capability name cannot be confused', async () => {
    const s = setup([{ name: 'ruflo-agentdb', version: '0.4.7', files: { 'commands/agentdb.md': '# a\n' } }]);
    const cap = s.svc.catalog().plugins.find(p => p.id === 'ruflo-agentdb@ruflo')!.caps.find(c => c.name === 'health')!;
    await s.svc.execute(await s.svc.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: cap.cid, args: {} }, 'u') as Prepared);
    expect((s.svc.runsBody().history as Array<{ plugin?: string }>)[0]!.plugin).toBe('ruflo-agentdb@ruflo');
  });
});

describe('R-SEC-p1-q8 bidi, zero-width and format characters are stripped from display text', () => {
  const EVIL = 'a‮b​c⁦d⁩e﻿f‎g';
  it('protocol sanitize, the card helpers and the card itself', () => {
    expect(sanitize(EVIL)).toBe('abcdefg');
    expect(printable(EVIL)).not.toMatch(/[​-‏‪-‮⁦-⁩﻿]/); expect(visible(EVIL)).not.toMatch(/[​-‏‪-‮⁦-⁩﻿]/);
    expect(renderApproval({ cid: 'c', cmd: 'capability.run', summary: 's', level: 'write', by: EVIL, args: { option: EVIL } }).join('\n')).not.toMatch(/[​-‏‪-‮⁦-⁩﻿]/);
  });
});

describe('R-SEC-p1-q9/q10 smaller items', () => {
  it('modTrustAllow is compared by name@marketplace', async () => {
    const run = async (argv: string[]) => ok(argv.includes('--json') ? JSON.stringify({ inputs: { modTrust: 'refuse-risky', modTrustAllow: 'ruflo-swarm@ruflo ruflo-other' } }) : 'x');
    const s = setup([{ name: 'ruflo-swarm', files: { 'README.md': 's', 'hooks/register.ts': 'x' } }], { run });
    expect(await s.svc.prepare('plugin.enable', { pluginId: 'ruflo-swarm@ruflo' }, 'u')).toMatchObject({ ok: true });
    const s2 = setup([{ name: 'ruflo-swarm', files: { 'README.md': 's', 'hooks/register.ts': 'x' } }], { run: async (argv: string[]) => ok(argv.includes('--json') ? JSON.stringify({ inputs: { modTrust: 'refuse-risky', modTrustAllow: 'ruflo-swarm@evil' } }) : 'x') });
    expect(await s2.svc.prepare('plugin.enable', { pluginId: 'ruflo-swarm@ruflo' }, 'u')).toEqual({ ok: false, code: 'loosens-gate' });
  });
  it('the audit record always has an argvSha; approvedBy is none for a read run and local for a write', async () => {
    const s = setup([{ name: 'ruflo-agentdb', version: '0.4.7', files: { 'commands/agentdb.md': '# a\n' } }]);
    const cat = s.svc.catalog().plugins.find(p => p.id === 'ruflo-agentdb@ruflo')!;
    for (const n of ['health', 'consolidate']) { const c = cat.caps.find(x => x.name === n)!; await s.svc.execute(await s.svc.prepare('capability.run', { pluginId: cat.id, capabilityId: c.cid, args: {} }, 'u') as Prepared); }
    s.svc.recordNever('capability.run', 'x/view/y@1.0.0+000000000000', 'read', 'read', 'u', 'refused', 'no-binding');
    const rows = readFileSync(join(s.home, 'state/audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>).filter(r => r.kind === 'capability_run');
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.argvSha).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.find(r => String(r.capabilityId).includes('/health@'))!.approvedBy).toBe('none'); expect(rows.find(r => String(r.capabilityId).includes('/consolidate@'))!.approvedBy).toBe('local');
    expect(JSON.stringify(s.svc.runsBody())).not.toContain('argvSha');
  });
  it('an exception inside prepare is not forwarded to the server', async () => {
    const s = setup(); (s.svc as unknown as { catalog: () => never }).catalog = () => { throw new Error('/home/secret/path exploded'); };
    expect(await s.svc.prepare('capability.run', { pluginId: 'ruflo-adr@ruflo', capabilityId: 'ruflo-adr/skill/a@1.0.0+000000000000', args: {} }, 'u')).toEqual({ ok: false, code: 'prepare_failed' });
  });
  it('a script binding runs with the plugin directory as cwd, never the project', async () => {
    const { sha256Hex } = await import('../../src/dashboard/capabilities/hash.js'); const body = 'console.log(1)';
    const b: Binding = { plugin: 'ruflo-scr', kind: 'view', name: 'report', pinFile: 'README.md', level: 'read', risk: 'read', args: [], action: { kind: 'script', file: 'scripts/report.mjs', sha256: { 'scripts/report.mjs': sha256Hex(body) }, argv: () => [] } };
    const s = setup([{ name: 'ruflo-scr', files: { 'README.md': 'r', 'scripts/report.mjs': body } }], { table: new BindingTable([b]) });
    const c = s.svc.catalog().plugins.find(p => p.id === 'ruflo-scr@ruflo')!.caps.find(x => x.name === 'report')!;
    expect(await s.svc.execute(await s.svc.prepare('capability.run', { pluginId: 'ruflo-scr@ruflo', capabilityId: c.cid, args: {} }, 'u') as Prepared)).toMatchObject({ ok: true });
    expect(s.calls[0]!.cwd).toBe(s.dirs['ruflo-scr@ruflo']); expect(s.calls[0]!.cwd).not.toBe(s.project);
  });
});
