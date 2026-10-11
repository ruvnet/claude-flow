/** R-SEC-p1-12..: the capability channel. Each fails against code without the local catalog / pinning / schema rules. */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITY_RISKS } from '../../src/dashboard/protocol/index.js';
import { AuditLog } from '../../src/dashboard/state.js';
import { BindingTable, BINDINGS, CAPABILITY_TOOLS } from '../../src/dashboard/capabilities/bindings.js';
import { buildCatalog, catalogBody } from '../../src/dashboard/capabilities/catalog.js';
import { CapabilityService, HISTORY_MAX, RUNS_PER_MINUTE, validateArgs, type Prepared } from '../../src/dashboard/capabilities/service.js';
import type { Binding } from '../../src/dashboard/capabilities/types.js';
import { stubRuflo } from './_support/harness.js';
import { makeClaudeHome, writeFile } from './_support/plugin-fixture.js';

const roots: string[] = [];
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'rfp1-'))); roots.push(d); return d; };
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });
const ok = (stdout = '{}', code = 0) => ({ code, stdout, stderr: '', timedOut: false, truncated: false });

const AGENTDB = '# agentdb\n';
const MODS_CONFIG = { costBudgetUsd: { type: 'number', default: 0 }, toolHints: { type: 'boolean', default: false }, modTrust: { type: 'string', options: ['observe', 'refuse-risky', 'off'], default: 'observe' }, statusLine: { type: 'boolean' }, apiToken: { type: 'string' }, look: { type: 'string', options: ['bbs', 'plain'] }, freeText: { type: 'string' }, refreshSeconds: { type: 'number', default: 5 } };
function setup(extra: Array<Parameters<typeof makeClaudeHome>[1][number]> = [], over: { table?: BindingTable; claude?: string | null; run?: (argv: string[], o: { cwd: string; timeoutMs: number; stdin?: string }) => Promise<ReturnType<typeof ok>> } = {}) {
  const home = tmp(); const project = tmp(); const stub = stubRuflo();
  const dirs = makeClaudeHome(home, [
    { name: 'ruflo-agentdb', version: '0.4.7', files: { 'commands/agentdb.md': AGENTDB, 'commands/embeddings.md': 'e' } },
    { name: 'ruflo-workflows', version: '0.6.4', files: { 'commands/workflow.md': 'wf', 'commands/gaia-run.md': 'g' } },
    { name: 'ruflo-metaharness', version: '0.2.4', files: { 'skills/harness-score/SKILL.md': 'score' } },
    { name: 'ruflo-mods', version: '0.3.16', files: { 'README.md': 'r', 'hooks/register.ts': 'x' }, userConfig: MODS_CONFIG },
    { name: 'ruflo-browser', version: '0.2.0', files: { 'skills/browser-login/SKILL.md': 'b' } },
    { name: 'ruflo-adr', version: '0.5.3', files: { 'skills/adr-index/SKILL.md': 'i' } },
    { name: 'ruflo-evil', marketplace: 'evil', version: '1.0.0', files: { 'commands/agentdb.md': 'x' } },
    ...extra,
  ]);
  const calls: Array<{ argv: string[]; stdin?: string }> = [];
  const run = over.run ?? (async (argv: string[], o: { stdin?: string }) => { calls.push({ argv, ...(o.stdin !== undefined ? { stdin: o.stdin } : {}) }); return ok(argv.includes('--json') ? JSON.stringify({ inputs: { costBudgetUsd: '10', modTrust: 'observe', toolHints: 'false', refreshSeconds: '5' } }) : 'done'); });
  const audit = new AuditLog(join(home, 'state'));
  const changes: string[][] = [];
  let t = 1_000_000;
  const svc = new CapabilityService({ home, projectDir: project, ruflo: stub, rufloBase: ['/usr/bin/ruflo'], claude: over.claude === undefined ? '/usr/bin/claude' : over.claude, audit, run, table: over.table, now: () => (t += 1000), onChange: n => changes.push(n) });
  return { home, project, stub, dirs, svc, calls, changes, audit };
}
const must = async (p: ReturnType<CapabilityService['prepare']>): Promise<Prepared> => { const r = await p; if (!r.ok) throw new Error(`refused: ${r.code}`); return r; };
const capOf = (s: ReturnType<typeof setup>, id: string, name: string) => s.svc.catalog().plugins.find(p => p.id === id)!.caps.find(c => c.name === name)!;

describe('R-SEC-p1-12 catalog is built locally and pinned to file bytes', () => {
  it('ids are plugin/kind/name@version+sha12 of the real file; editing the file changes the id', () => {
    const s = setup();
    const c1 = capOf(s, 'ruflo-agentdb@ruflo', 'health');
    expect(c1.cid).toMatch(/^ruflo-agentdb\/view\/health@0\.4\.7\+[0-9a-f]{12}$/);
    writeFile(s.dirs['ruflo-agentdb@ruflo']!, 'commands/agentdb.md', '# changed\n');
    expect(capOf(s, 'ruflo-agentdb@ruflo', 'health').cid).not.toBe(c1.cid);
  });
  it('a plugin from another marketplace is listed but every capability is refused: an @evil look-alike inherits no binding', () => {
    const s = setup(); const evil = s.svc.catalog().plugins.find(p => p.id === 'ruflo-evil@evil')!;
    expect(evil.foreign).toBe(true);
    expect(evil.caps.every(c => c.mode === 'refused' && c.why === 'foreign-marketplace')).toBe(true);
  });
  it('unbound capabilities are refused with a reason code and the danger class (browser=network, adr-index=no-binding, gaia-run=spend)', () => {
    const s = setup();
    expect(capOf(s, 'ruflo-browser@ruflo', 'browser-login')).toMatchObject({ mode: 'refused', why: 'risk-network', risk: 'network', level: null });
    expect(capOf(s, 'ruflo-workflows@ruflo', 'gaia-run')).toMatchObject({ mode: 'refused', why: 'risk-spend' });
    expect(capOf(s, 'ruflo-adr@ruflo', 'adr-index')).toMatchObject({ mode: 'refused', why: 'no-binding' });
  });
  it('hostile layout is skipped: install path outside the cache, link as a skill file, oversize file, names that are not plain words', () => {
    const s = setup(); const d = s.dirs['ruflo-agentdb@ruflo']!;
    writeFile(d, 'commands/ev il.md', 'x'); writeFile(d, 'commands/big.md', 'x'.repeat(130_000));
    mkdirSync(join(d, 'skills/linked'), { recursive: true }); const outside = tmp(); writeFileSync(join(outside, 'SKILL.md'), 'secret'); symlinkSync(join(outside, 'SKILL.md'), join(d, 'skills/linked/SKILL.md'));
    const names = capOf(s, 'ruflo-agentdb@ruflo', 'health') && s.svc.catalog().plugins.find(p => p.id === 'ruflo-agentdb@ruflo')!.caps.map(c => c.name);
    expect(names).not.toContain('ev il'); expect(names).not.toContain('big'); expect(names).not.toContain('linked');
    // an installed_plugins.json entry pointing outside the cache is never read
    writeFile(outside, '.claude-plugin/plugin.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
    writeFile(s.home, '.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'ruflo-x@ruflo': [{ scope: 'user', installPath: outside, version: '1.0.0' }] } }));
    expect(buildCatalog(s.home).plugins).toEqual([]);
  });
  it('the section body carries no description, path or script text and counts refused entries by code', () => {
    const s = setup(); const body = catalogBody(s.svc.catalog()); const text = JSON.stringify(body);
    expect(text).not.toContain(s.home); expect(text).not.toContain('# agentdb'); expect(text).not.toMatch(/"binding"|fileSha12/);
    expect((body.refused as { total: number; byCode: Record<string, number> }).byCode['foreign-marketplace']).toBeGreaterThan(0);
  });
  it('R-SEC-p1-13 every runnable binding has a schema, no string argument is free text, and nothing network/install/spend/delete is bound', () => {
    for (const b of BINDINGS) {
      expect(['read', 'write', 'manage']).toContain(b.level);
      expect(['network', 'install', 'spend', 'delete']).not.toContain(b.risk);
      expect(CAPABILITY_RISKS).toContain(b.risk);
      for (const a of b.args) if (a.type === 'string') { expect(a.pattern, `${b.name}.${a.name}`).toBeInstanceOf(RegExp); expect(a.pattern!.test('-rf')).toBe(false); expect(a.pattern!.test('a b')).toBe(false); expect(a.pattern!.test('a;b')).toBe(false); }
    }
    for (const t of ['memory_store', 'memory_delete', 'task_create', 'swarm_shutdown', 'terminal_execute', 'http_fetch', 'aidefence_stats', 'agent_spawn', 'mission_create', 'hooks_worker-dispatch', 'metaharness_flywheel', 'metaharness_evolve', 'workflow_execute', 'workflow_run', 'workflow_delete', 'workflow_cancel']) expect(CAPABILITY_TOOLS.has(t), t).toBe(false);
  });
});

describe('R-SEC-p1-24 names are plain words and bound capabilities are mode run', () => {
  it('leading dot/dash/underscore and any .. are not listed', () => {
    const s = setup(); const d = s.dirs['ruflo-agentdb@ruflo']!;
    for (const n of ['..evil', '.hidden', '-flag', '_x', 'a..b']) writeFile(d, `commands/${n}.md`, 'x');
    writeFile(d, 'commands/ok-name_1.md', 'x');
    const names = s.svc.catalog().plugins.find(p => p.id === 'ruflo-agentdb@ruflo')!.caps.map(c => c.name);
    for (const n of ['..evil', '.hidden', '-flag', '_x', 'a..b']) expect(names).not.toContain(n);
    expect(names).toContain('ok-name_1');
  });
  it('every capability with a shipped binding is mode run with its true level; none is mode view', () => {
    const s = setup(); const caps = s.svc.catalog().plugins.flatMap(p => p.caps);
    const bound = caps.filter(c => c.binding);
    expect(bound.length).toBeGreaterThan(5); expect(bound.every(c => c.mode === 'run' && c.level !== null)).toBe(true);
    expect(caps.some(c => c.mode === 'view')).toBe(false);
    expect(capOf(s, 'ruflo-agentdb@ruflo', 'consolidate')).toMatchObject({ mode: 'run', level: 'write', risk: 'write' });
    expect(capOf(s, 'ruflo-agentdb@ruflo', 'health')).toMatchObject({ mode: 'run', level: 'read', risk: 'read' });
  });
});

describe('R-SEC-p1-14 capability.run resolves ONLY against the local catalog and re-validates arguments', () => {
  it('an id the connector did not build is unknown_capability, even if syntactically valid and for the right plugin', async () => {
    const s = setup(); const real = capOf(s, 'ruflo-agentdb@ruflo', 'health').cid;
    expect(await s.svc.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: real.replace(/\+.{12}$/, '+000000000000'), args: {} }, 'u')).toEqual({ ok: false, code: 'unknown_capability' });
    expect(await s.svc.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: 'ruflo-agentdb/view/anything@0.4.7+0123456789ab', args: {} }, 'u')).toEqual({ ok: false, code: 'unknown_capability' });
    // an id of another plugin cannot be run under this plugin's name
    expect(await s.svc.prepare('capability.run', { pluginId: 'ruflo-workflows@ruflo', capabilityId: real, args: {} }, 'u')).toEqual({ ok: false, code: 'unknown_capability' });
  });
  it('refusals carry the catalog code: foreign, network, no-binding', async () => {
    const s = setup();
    const go = (id: string, name: string) => s.svc.prepare('capability.run', { pluginId: id, capabilityId: capOf(s, id, name).cid, args: {} }, 'u');
    expect(await go('ruflo-evil@evil', 'agentdb')).toEqual({ ok: false, code: 'foreign-marketplace' });
    expect(await go('ruflo-browser@ruflo', 'browser-login')).toEqual({ ok: false, code: 'risk-network' });
    expect(await go('ruflo-adr@ruflo', 'adr-index')).toEqual({ ok: false, code: 'no-binding' });
  });
  it('unknown arguments, option-like strings, secrets, free text and paths outside the project are refused', async () => {
    const s = setup(); const pause = capOf(s, 'ruflo-workflows@ruflo', 'workflow-pause').cid;
    const go = (args: Record<string, unknown>) => s.svc.prepare('capability.run', { pluginId: 'ruflo-workflows@ruflo', capabilityId: pause, args }, 'u');
    expect(await go({ workflowId: 'workflow-1' })).toMatchObject({ ok: true, level: 'write' });
    expect(await go({ workflowId: 'workflow-1', extra: 'x' })).toEqual({ ok: false, code: 'invalid_arguments:unknown_argument:extra' });
    expect(await go({})).toEqual({ ok: false, code: 'invalid_arguments:missing_argument:workflowId' });
    for (const bad of ['--all', '-rf', 'a b', 'a;rm -rf /', '$(id)', 'a\nb', '../x', 'a'.repeat(81)]) expect(await go({ workflowId: bad }), bad).toMatchObject({ ok: false });
    expect(await go({ workflowId: 'sk-abcdefghijklmnopqrstuvwxyz' })).toEqual({ ok: false, code: 'secret_in_args' });
    expect(await go({ workflowId: 5 })).toMatchObject({ ok: false });
  });
  it('validateArgs: path arguments are confined to the project (no .., no absolute, no hidden dir, no link); a string slot with no pattern is rejected', () => {
    const project = tmp(); mkdirSync(join(project, 'docs')); writeFileSync(join(project, 'docs/a.md'), 'x'); const outside = tmp(); symlinkSync(outside, join(project, 'docs/out'));
    const spec = [{ name: 'p', type: 'path' as const }];
    expect(validateArgs(spec, { p: 'docs/a.md' }, project)).toMatchObject({ ok: true });
    for (const p of ['../a', '/etc/passwd', 'docs/../../x', '.git/config', 'docs/.hidden', 'docs/out/x', '-x']) expect(validateArgs(spec, { p }, project), p).toMatchObject({ ok: false });
    expect(validateArgs([{ name: 's', type: 'string' }], { s: 'hello' }, project)).toEqual({ ok: false, code: 'invalid_arguments:no-schema' });
    expect(validateArgs([{ name: 'n', type: 'int', min: 1, max: 5 }], { n: 6 }, project)).toMatchObject({ ok: false });
    expect(validateArgs([{ name: 'n', type: 'int', min: 1, max: 5 }], { n: 1.5 }, project)).toMatchObject({ ok: false });
  });
});

describe('R-SEC-p1-15 pinning: a change after the card was shown voids the approval', () => {
  const prep = async (s: ReturnType<typeof setup>, name = 'consolidate') => must(s.svc.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: capOf(s, 'ruflo-agentdb@ruflo', name).cid, args: {} }, 'u'));
  it('the card shows the exact tool call, version, manifest sha and capability id', async () => {
    const s = setup(); const p = await prep(s);
    expect(p.level).toBe('write');
    expect(p.card).toMatchObject({ plugin: 'ruflo-agentdb@ruflo', version: '0.4.7', risk: 'write', run: 'ruflo mcp exec -t agentdb_consolidate -p {}' });
    expect(p.card.manifestSha).toMatch(/^[0-9a-f]{12}$/); expect(p.card.capability).toMatch(/^ruflo-agentdb\/view\/consolidate@/);
  });
  it('unchanged: runs through the allowlisted tool and is recorded', async () => {
    const s = setup(); s.stub.overrides.agentdb_consolidate = { done: true };
    const r = await s.svc.execute(await prep(s));
    expect(r).toMatchObject({ ok: true }); expect(s.stub.calls.map(c => c.tool)).toEqual(['agentdb_consolidate']);
    expect(s.svc.runsBody().history).toMatchObject([{ outcome: 'succeeded', exit: 0, level: 'write' }]);
  });
  it('the capability file changed after approval: capability_changed, nothing runs, recorded as changed', async () => {
    const s = setup(); const p = await prep(s);
    writeFile(s.dirs['ruflo-agentdb@ruflo']!, 'commands/agentdb.md', '# poisoned after approval\n');
    expect(await s.svc.execute(p)).toEqual({ ok: false, error: 'capability_changed' });
    expect(s.stub.calls).toEqual([]); expect(s.svc.runsBody().history).toMatchObject([{ outcome: 'changed' }]);
  });
  it('the manifest changed after approval (plugin updated in place): capability_changed', async () => {
    const s = setup(); const p = await prep(s);
    writeFile(s.dirs['ruflo-agentdb@ruflo']!, '.claude-plugin/plugin.json', JSON.stringify({ name: 'ruflo-agentdb', version: '0.4.7', description: 'now different' }));
    expect(await s.svc.execute(p)).toEqual({ ok: false, error: 'capability_changed' }); expect(s.stub.calls).toEqual([]);
  });
  it('the plugin was removed after approval: capability_changed', async () => {
    const s = setup(); const p = await prep(s);
    writeFile(s.home, '.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: {} }));
    expect(await s.svc.execute(p)).toEqual({ ok: false, error: 'capability_changed' });
  });
  it('one run at a time and at most 6 per minute', async () => {
    const s = setup(); s.stub.overrides.agentdb_health = { ok: 1 };
    let release: () => void = () => undefined; const gate = new Promise<void>(r => { release = r; });
    const slow = { ...s.stub, mcp: async (t: string, p?: Record<string, unknown>) => { await gate; return s.stub.mcp(t, p); } };
    const svc = new CapabilityService({ ...(s.svc as unknown as { d: ConstructorParameters<typeof CapabilityService>[0] }).d, ruflo: slow });
    const p = await must(svc.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: capOf(s, 'ruflo-agentdb@ruflo', 'health').cid, args: {} }, 'u'));
    const first = svc.execute(p); await new Promise(r => setTimeout(r, 5));
    expect(await svc.execute(p)).toEqual({ ok: false, error: 'busy' });
    release(); expect(await first).toMatchObject({ ok: true });
    for (let i = 0; i < RUNS_PER_MINUTE; i++) await svc.execute(p);
    expect(await svc.execute(p)).toEqual({ ok: false, error: 'rate_limited' });
  });
});

describe('R-SEC-p1-16 results and history are masked and bounded', () => {
  it('a secret in the tool output is masked in the history tail; history keeps at most 40 runs, newest first', async () => {
    const s = setup(); s.stub.overrides.agentdb_health = { note: 'token=supersecretvalue123 and sk-abcdefghijklmnopqrstuv' };
    const p = await must(s.svc.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: capOf(s, 'ruflo-agentdb@ruflo', 'health').cid, args: {} }, 'u'));
    const r = await s.svc.execute(p);
    const text = JSON.stringify([r, s.svc.runsBody()]);
    expect(text).not.toContain('supersecretvalue123'); expect(text).not.toContain('sk-abcdefghijklmnopqrstuv'); expect(text).toContain('[masked]');
    for (let i = 0; i < 60; i++) s.svc.recordNever('capability.run', 'x/view/y@1.0.0+000000000000', 'read', 'read', 'u', 'denied', 'approval_denied');
    const h = s.svc.runsBody().history as Array<{ startedAt: number }>;
    expect(h).toHaveLength(HISTORY_MAX); expect(h[0]!.startedAt).toBeGreaterThanOrEqual(h[39]!.startedAt);
  });
  it('the audit record has no argument values or output', async () => {
    const s = setup(); s.stub.overrides.agentdb_health = { secret: 'do-not-log-this-output' };
    await s.svc.execute(await must(s.svc.prepare('capability.run', { pluginId: 'ruflo-agentdb@ruflo', capabilityId: capOf(s, 'ruflo-agentdb@ruflo', 'health').cid, args: {} }, 'u')));
    const { readFileSync } = await import('node:fs'); const log = readFileSync(join(s.home, 'state/audit.jsonl'), 'utf8');
    expect(log).toContain('capability_run'); expect(log).not.toContain('do-not-log-this-output');
  });
});

describe('R-SEC-p1-17 mod.option.set', () => {
  const set = (s: ReturnType<typeof setup>, key: string, value: unknown, id = 'ruflo-mods@ruflo') => s.svc.prepare('mod.option.set', { modId: id, key, value }, 'u');
  it('a boolean change is a fixed argv with the value on STDIN (never in argv) and a card showing old and new', async () => {
    const s = setup(); const p = await must(set(s, 'toolHints', true));
    expect(p.level).toBe('write'); expect(p.card.option).toBe('ruflo-mods.toolHints: false -> true');
    const r = await s.svc.execute(p);
    expect(r).toMatchObject({ ok: true });
    const w = s.calls.find(c => c.argv.includes('--values-stdin'))!;
    expect(w.argv).toEqual(['/usr/bin/claude', 'plugin', 'configure', 'ruflo-mods@ruflo', '--values-stdin']); expect(w.stdin).toBe('{"toolHints":"true"}');
    expect(w.argv.join(' ')).not.toContain('true');
    expect(s.changes.flat()).toContain('capabilities');
  });
  it('budget caps may only be lowered: raise, 0 (off) and a non-number are refused; lowering and setting from off are allowed', async () => {
    const s = setup(); // current costBudgetUsd = 10
    expect(await set(s, 'costBudgetUsd', 20)).toEqual({ ok: false, code: 'would-raise-cap' });
    expect(await set(s, 'costBudgetUsd', 0)).toEqual({ ok: false, code: 'would-raise-cap' });
    expect(await set(s, 'costBudgetUsd', '5')).toEqual({ ok: false, code: 'bad_value' });
    expect(await set(s, 'costBudgetUsd', -1)).toEqual({ ok: false, code: 'bad_value' });
    expect(await set(s, 'costBudgetUsd', 5)).toMatchObject({ ok: true });
    expect(await set(s, 'costBudgetUsd', 10)).toMatchObject({ ok: true });
    const off = setup([], { run: async argv => ok(argv.includes('--json') ? JSON.stringify({ inputs: {} }) : 'x') });
    expect(await set(off, 'costBudgetUsd', 50)).toMatchObject({ ok: true }); // from no cap to a cap tightens
  });
  it('gates, secrets, free strings, unknown keys and foreign plugins are refused by rule, not by the person\'s attention', async () => {
    const s = setup();
    expect(await set(s, 'modTrust', 'off')).toEqual({ ok: false, code: 'not-settable' });
    expect(await set(s, 'apiToken', 'x')).toEqual({ ok: false, code: 'secret-option' });
    expect(await set(s, 'freeText', 'anything')).toEqual({ ok: false, code: 'not-settable' });
    expect(await set(s, 'nope', true)).toEqual({ ok: false, code: 'unknown_option' });
    expect(await set(s, 'toolHints', 'true')).toEqual({ ok: false, code: 'bad_value' });
    expect(await set(s, 'toolHints', true, 'ruflo-evil@evil')).toEqual({ ok: false, code: 'foreign-marketplace' });
  });
  it('without a claude binary it refuses instead of guessing one', async () => {
    const s = setup([], { claude: null }); expect(await set(s, 'toolHints', true)).toEqual({ ok: false, code: 'claude_not_found' });
  });
});

describe('R-SEC-p1-18 plugin.enable / plugin.disable', () => {
  it('fixed argv at user scope; the card shows it; an unknown plugin and a foreign enable are refused; disabling a guard needs the typed name', async () => {
    const s = setup();
    const e = await must(s.svc.prepare('plugin.enable', { pluginId: 'ruflo-agentdb@ruflo' }, 'u'));
    expect(e.level).toBe('manage'); expect(e.card.run).toBe('/usr/bin/claude plugin enable ruflo-agentdb@ruflo --scope user'); expect(e.typed).toBeUndefined();
    await s.svc.execute(e); expect(s.calls.at(-1)!.argv).toEqual(['/usr/bin/claude', 'plugin', 'enable', 'ruflo-agentdb@ruflo', '--scope', 'user']);
    expect(await s.svc.prepare('plugin.enable', { pluginId: 'ruflo-nothere@ruflo' }, 'u')).toEqual({ ok: false, code: 'unknown_plugin' });
    expect(await s.svc.prepare('plugin.enable', { pluginId: 'ruflo-evil@evil' }, 'u')).toEqual({ ok: false, code: 'foreign-marketplace' });
    expect(await s.svc.prepare('plugin.disable', { pluginId: 'ruflo-evil@evil' }, 'u')).toMatchObject({ ok: true }); // narrowing is always allowed
    expect(await must(s.svc.prepare('plugin.disable', { pluginId: 'ruflo-mods@ruflo' }, 'u'))).toMatchObject({ typed: 'ruflo-mods' });
  });
  it('enabling a mod is refused when modTrust is refuse-risky and the mod is not on the allow list', async () => {
    const s = setup([], { run: async argv => ok(argv.includes('--json') ? JSON.stringify({ inputs: { modTrust: 'refuse-risky', modTrustAllow: 'other-mod' } }) : 'x') });
    expect(await s.svc.prepare('plugin.enable', { pluginId: 'ruflo-mods@ruflo' }, 'u')).toEqual({ ok: false, code: 'loosens-gate' });
  });
});

describe('R-SEC-p1-19 script bindings run only trusted, pinned, plugin-cache code', () => {
  const script: Binding = { plugin: 'ruflo-scr', kind: 'view', name: 'report', pinFile: 'README.md', level: 'read', risk: 'read', args: [], action: { kind: 'script', file: 'scripts/report.mjs', sha256: {}, argv: () => [] } };
  async function withScript(mutate?: (dir: string) => void) {
    const { sha256Hex } = await import('../../src/dashboard/capabilities/hash.js');
    const body = 'console.log("ok")'; const b: Binding = { ...script, action: { ...(script.action as Extract<Binding['action'], { kind: 'script' }>), sha256: { 'scripts/report.mjs': sha256Hex(body) } } };
    const s = setup([{ name: 'ruflo-scr', version: '1.0.0', files: { 'README.md': 'r', 'scripts/report.mjs': body } }], { table: new BindingTable([b]) });
    mutate?.(s.dirs['ruflo-scr@ruflo']!); return s;
  }
  const go = async (s: ReturnType<typeof setup>) => s.svc.execute(await must(s.svc.prepare('capability.run', { pluginId: 'ruflo-scr@ruflo', capabilityId: capOf(s, 'ruflo-scr@ruflo', 'report').cid, args: {} }, 'u')));
  it('a private, pinned script runs with node and a fixed argv', async () => {
    const s = await withScript(); expect(await go(s)).toMatchObject({ ok: true });
    expect(s.calls[0]!.argv[0]).toBe(process.execPath); expect(s.calls[0]!.argv[1]).toMatch(/scripts\/report\.mjs$/);
  });
  it('a script whose bytes differ from the pinned hash is script-changed (the pin is on file content, so even a same-version edit is caught)', async () => {
    const s = await withScript(); const p = await must(s.svc.prepare('capability.run', { pluginId: 'ruflo-scr@ruflo', capabilityId: capOf(s, 'ruflo-scr@ruflo', 'report').cid, args: {} }, 'u'));
    writeFile(s.dirs['ruflo-scr@ruflo']!, 'scripts/report.mjs', 'console.log("evil")');
    expect(await s.svc.execute(p)).toEqual({ ok: false, error: 'script-changed' }); expect(s.calls).toEqual([]);
  });
  it('a group/world-writable script is refused', async () => {
    const s = await withScript(d => chmodSync(join(d, 'scripts/report.mjs'), 0o666)); expect(await go(s)).toEqual({ ok: false, error: 'script-changed' });
  });
});
