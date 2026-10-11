/** R-SEC-p1-20..: P1 collectors, the shadow-plugin guard, and the signed channel end to end for the capability commands. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSectionFrame, SectionSchemas, type SectionName } from '../../src/dashboard/protocol/index.js';
import type { CollectCtx } from '../../src/dashboard/collect-core.js';
import * as P1 from '../../src/dashboard/collect-p1.js';
import { Rig, stubRuflo } from './_support/harness.js';
import { makeClaudeHome, type FixturePlugin } from './_support/plugin-fixture.js';

const dirs: string[] = [];
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'rfp1s-'))); dirs.push(d); return d; };
let rig: Rig | undefined;
afterEach(async () => { await rig?.cleanup(); rig = undefined; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const ctx = (over: Partial<CollectCtx> = {}, dir = tmp()) => {
  mkdirSync(join(dir, '.claude-flow'), { recursive: true }); const stub = stubRuflo();
  return { stub, c: { ruflo: stub, projectDir: dir, level: 'read', autoApprove: false, cliChoice: 'path', now: () => 1_000_000, cache: {}, errors: new Map(), pending: () => [], notices: () => [], run: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, truncated: false }), home: dir, ...over } as CollectCtx };
};
const valid = (n: SectionName, body: Record<string, unknown>) => expect(SectionSchemas[n].safeParse(body).success, JSON.stringify(SectionSchemas[n].safeParse(body))).toBe(true);

describe('R-SEC-p1-20 collectors map real tool output to strict bodies', () => {
  it('claims, hive, workflows, learning, security, perf, automation, metaharness all validate', async () => {
    const { c } = ctx();
    const cl = await P1.claims(c); valid('claims', cl);
    expect(cl).toMatchObject({ summary: { total: 2, blocked: 1 } }); expect((cl.claims as Array<{ stealable: boolean; kind: string }>).map(x => [x.kind, x.stealable])).toEqual([['human', false], ['agent', true]]);
    const h = await P1.hive(c); valid('hive', h); expect(h).toMatchObject({ hive: { id: 'hive-1', queen: { id: 'queen-1' } }, workers: [{ id: 'w1' }, { id: 'w2' }] });
    valid('workflows', await P1.workflows(c)); valid('learning', await P1.learning(c)); valid('security', await P1.security(c)); valid('automation', await P1.automation(c));
    const mh = await P1.metaharness(c); valid('metaharness', mh); expect(mh).toMatchObject({ available: true, score: { harnessFit: 37 }, auditCount: 1 });
  });
  it('a hive ruflo never initialised (it answers with a phantom id) is no hive', async () => {
    const { c, stub } = ctx(); stub.overrides['hive-mind_status'] = { hiveId: 'hive-1791494472347', status: 'offline', initialized: false, workers: [], queen: { id: 'N/A' } };
    expect(await P1.hive(c)).toEqual({ hive: null, workers: [], proposals: [] });
  });
  it('perf carries only the measured cpu and memory subtrees; ruflo\'s placeholder latency/throughput never reach the dashboard', async () => {
    const { c, stub } = ctx(); const r = await P1.perf(c); valid('perf', r); expect(Object.keys(r).sort()).toEqual(['cpu', 'memory', 'note']); expect(JSON.stringify(r)).not.toMatch(/1250|"p95"/);
    stub.overrides.performance_metrics = { metrics: { cpu: { current: 5 }, memory: { current: 1 } } }; // not marked _real: dropped
    expect(await P1.perf(c)).toMatchObject({ cpu: null, memory: null });
  });
  it('a tool failure throws (the section is reported as unreadable), a failure payload is not an empty list', async () => {
    const { c, stub } = ctx(); stub.overrides.claims_list = { success: false, error: 'store corrupt' };
    await expect(P1.claims(c)).rejects.toThrow('store corrupt');
  });
  it('R-SEC-p1-21 a project that could shadow ruflo\'s metaharness scripts never reaches the metaharness tools', async () => {
    for (const rel of ['plugins/ruflo-metaharness/scripts', 'node_modules/@claude-flow/cli/plugins/ruflo-metaharness/scripts']) {
      const dir = tmp(); mkdirSync(join(dir, rel), { recursive: true });
      const { c, stub } = ctx({}, dir);
      const r = await P1.metaharness(c); valid('metaharness', r);
      expect(r).toMatchObject({ available: false }); expect(String(r.reason)).toContain('never run');
      expect(stub.calls.filter(x => x.tool.startsWith('metaharness_'))).toEqual([]);
    }
  });
  it('degraded metaharness (package absent) is reported as unavailable, not as zeros', async () => {
    const { c, stub } = ctx(); stub.overrides.metaharness_score = { success: true, data: { degraded: true, reason: 'plugin-not-found' }, degraded: true, exitCode: 0 };
    expect(await P1.metaharness(c)).toMatchObject({ available: false, score: null });
  });
  it('security never asks for AIDefence statistics (that call makes ruflo install a package)', async () => {
    const { c, stub } = ctx(); await P1.security(c); expect(stub.calls.map(x => x.tool)).toEqual(['policy_status']);
  });
});

describe('R-SEC-p1-22 the signed channel: capability commands end to end', () => {
  const DEFAULTS: FixturePlugin[] = [
    { name: 'ruflo-agentdb', version: '0.4.7', files: { 'commands/agentdb.md': '# agentdb\n' } },
    { name: 'ruflo-adr', version: '0.5.3', files: { 'skills/adr-index/SKILL.md': 'i' } },
    { name: 'ruflo-mods', version: '0.3.16', files: { 'README.md': 'r' }, userConfig: { costBudgetUsd: { type: 'number', default: 0 }, toolHints: { type: 'boolean', default: false } } },
  ];
  async function boot(level: 'read' | 'write' | 'manage', autoApprove: boolean, answers: boolean[]) {
    rig = await Rig.create({}, level);
    const dirs = makeClaudeHome(rig.root, DEFAULTS);
    rig.setConfig({ autoApprove });
    const cards: Array<{ cmd: string; level: string; args: Record<string, unknown> }> = [];
    const approver = async (req: { cmd: string; level: string; args: Record<string, unknown> }) => { cards.push({ cmd: req.cmd, level: req.level, args: req.args }); return answers.shift() ?? false; };
    const proc: Array<{ argv: string[]; stdin?: string }> = [];
    const run = rig.start(approver as never, 200, { runCmd: async (argv, _t, stdin) => { proc.push({ argv, stdin }); return { code: 0, stdout: argv.includes('--json') ? JSON.stringify({ inputs: { costBudgetUsd: '10', toolHints: 'false' } }) : 'ok', stderr: '', timedOut: false, truncated: false }; } });
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    const cap = await rig.srv.waitFor(() => rig!.srv.byTyp('digest').find(e => e.body.section === 'capabilities'));
    const body = parseSectionFrame(cap.body); if (!body.ok) throw new Error('bad capabilities frame');
    const caps = (body.frame.body as { plugins: Array<{ id: string; caps: Array<{ cid: string; name: string }> }> }).plugins.flatMap(p => p.caps.map(c => ({ plugin: p.id, ...c })));
    const send = async (cmd: string, args: Record<string, unknown>) => {
      const f = rig!.srv.command(cmd, args); const cid = (JSON.parse(f) as { body: { cid: string } }).body.cid; rig!.srv.broadcast(f);
      await rig!.srv.waitFor(() => rig!.srv.received.find(e => (e.typ === 'result' || (e.typ === 'ack' && e.body.status === 'denied')) && e.body.cid === cid));
      return rig!.srv.received.filter(e => e.body.cid === cid).map(e => ({ typ: e.typ, ...e.body } as { typ: string; status?: unknown; ok?: unknown; error?: unknown }));
    };
    return { run, caps, cards, proc, send, dirs };
  }
  const find = (caps: Array<{ plugin: string; cid: string; name: string }>, name: string) => caps.find(c => c.name === name)!;

  it('the capabilities and plugins sections are published as valid frames without any path or install dir', async () => {
    const t = await boot('read', false, []); 
    await rig!.srv.waitFor(() => rig!.srv.byTyp('digest').find(e => e.body.section === 'plugins'));
    const text = JSON.stringify(rig!.srv.byTyp('digest').filter(e => ['plugins', 'capabilities'].includes(String(e.body.section))));
    expect(text).not.toContain(rig!.root); expect(text).toContain('ruflo-agentdb/view/health@0.4.7+');
    t.run.stop();
  });
  it('write capability with autoApprove=true STILL shows the card with the exact tool call; yes runs it, no does not', async () => {
    const t = await boot('write', true, [true, false]);
    const cap = find(t.caps, 'consolidate');
    const a = await t.send('capability.run', { pluginId: cap.plugin, capabilityId: cap.cid, args: {} });
    expect(a.some(x => x.typ === 'ack' && x.status === 'awaiting_approval')).toBe(true);
    expect(a.find(x => x.typ === 'result')).toMatchObject({ ok: true });
    expect(t.cards).toHaveLength(1); expect(t.cards[0]).toMatchObject({ cmd: 'capability.run', level: 'write' });
    expect(String(t.cards[0]!.args.run)).toBe('ruflo mcp exec -t agentdb_consolidate -p {}');
    expect(rig!.ruflo.calls.map(c => c.tool)).toContain('agentdb_consolidate');
    rig!.ruflo.calls.length = 0;
    const b = await t.send('capability.run', { pluginId: cap.plugin, capabilityId: cap.cid, args: {} });
    expect(b.find(x => x.typ === 'ack' && x.status === 'denied')).toMatchObject({ error: 'approval_denied' }); expect(rig!.ruflo.calls.map(c => c.tool)).not.toContain('agentdb_consolidate');
    t.run.stop();
  });
  it('a read capability runs without a card; unknown ids and unbound ones are refused with their code', async () => {
    const t = await boot('read', false, []);
    const h = find(t.caps, 'health');
    expect((await t.send('capability.run', { pluginId: h.plugin, capabilityId: h.cid, args: {} })).find(x => x.typ === 'result')).toMatchObject({ ok: true });
    expect(t.cards).toEqual([]);
    const un = await t.send('capability.run', { pluginId: h.plugin, capabilityId: h.cid.replace(/\+.{12}$/, '+ffffffffffff'), args: {} });
    expect(un.find(x => x.typ === 'ack' && x.status === 'denied')).toMatchObject({ error: 'unknown_capability' });
    const ni = find(t.caps, 'adr-index');
    expect((await t.send('capability.run', { pluginId: ni.plugin, capabilityId: ni.cid, args: {} })).find(x => x.status === 'denied')).toMatchObject({ error: 'no-binding' });
    t.run.stop();
  });
  it('a device at level read cannot run a write capability, and the card is never shown for it', async () => {
    const t = await boot('read', false, [true]); const cap = find(t.caps, 'consolidate');
    expect((await t.send('capability.run', { pluginId: cap.plugin, capabilityId: cap.cid, args: {} })).find(x => x.status === 'denied')).toMatchObject({ error: 'level_read_below_write' });
    expect(t.cards).toEqual([]); t.run.stop();
  });
  it('mod.option.set needs the card even with autoApprove, writes through stdin, and a cap raise is refused before any card', async () => {
    const t = await boot('write', true, [true]);
    const r = await t.send('mod.option.set', { modId: 'ruflo-mods@ruflo', key: 'toolHints', value: true });
    expect(r.find(x => x.typ === 'result')).toMatchObject({ ok: true }); expect(t.cards).toHaveLength(1); expect(String(t.cards[0]!.args.option)).toBe('ruflo-mods.toolHints: false -> true');
    const w = t.proc.find(p => p.argv.includes('--values-stdin'))!; expect(w.stdin).toBe('{"toolHints":"true"}'); expect(w.argv.join(' ')).not.toContain('true');
    const up = await t.send('mod.option.set', { modId: 'ruflo-mods@ruflo', key: 'costBudgetUsd', value: 99 });
    expect(up.find(x => x.status === 'denied')).toMatchObject({ error: 'would-raise-cap' }); expect(t.cards).toHaveLength(1);
    t.run.stop();
  });
  it('plugin.enable needs manage; plugin.list is read and re-publishes the sections', async () => {
    const t = await boot('write', false, []);
    const e = await t.send('plugin.enable', { pluginId: 'ruflo-adr@ruflo' }); expect(e.find(x => x.status === 'denied')).toMatchObject({ error: 'level_write_below_manage' });
    expect((await t.send('plugin.list', {})).find(x => x.typ === 'result')).toMatchObject({ ok: true });
    expect(t.proc.some(p => p.argv.includes('enable'))).toBe(false); t.run.stop();
  });
  it('history lands in capability_runs, including refused and denied attempts', async () => {
    const t = await boot('write', false, [false]); const cap = find(t.caps, 'consolidate');
    await t.send('capability.run', { pluginId: cap.plugin, capabilityId: cap.cid, args: {} });
    await t.send('capability.run', { pluginId: cap.plugin, capabilityId: cap.cid.replace(/\+.{12}$/, '+ffffffffffff'), args: {} });
    const f = await rig!.srv.waitFor(() => { const all = rig!.srv.byTyp('digest').filter(e => e.body.section === 'capability_runs').map(e => e.body.body as { history: Array<{ outcome: string; reason?: string }> }); const last = all.at(-1); return last && last.history.length >= 2 ? last : undefined; });
    expect(f.history.map(h => h.reason)).toEqual(expect.arrayContaining(['approval_denied', 'unknown_capability']));
    t.run.stop();
  });
  it('R-SEC-p1-23 a changed capability file is republished with new ids on plugin.list and on capability_changed; restoring the file makes the old id known again', async () => {
    const t = await boot('read', false, []);
    const latest = () => { const all = rig!.srv.byTyp('digest').filter(e => e.body.section === 'capabilities'); return JSON.stringify(all.at(-1)!.body); };
    const h = find(t.caps, 'health'); const file = join(t.dirs['ruflo-agentdb@ruflo']!, 'commands/agentdb.md');
    const { writeFileSync, readFileSync } = await import('node:fs'); const orig = readFileSync(file, 'utf8');
    writeFileSync(file, '# changed\n');
    const un = await t.send('capability.run', { pluginId: h.plugin, capabilityId: h.cid, args: {} });
    expect(un.find(x => x.status === 'denied')).toMatchObject({ error: 'unknown_capability' });
    await rig!.srv.waitFor(() => !latest().includes(h.cid), 4000);
    expect(latest()).toContain('ruflo-agentdb/view/health@0.4.7+');
    writeFileSync(file, orig);
    expect((await t.send('plugin.list', {})).find(x => x.typ === 'result')).toMatchObject({ ok: true });
    await rig!.srv.waitFor(() => latest().includes(h.cid), 4000);
    expect((await t.send('capability.run', { pluginId: h.plugin, capabilityId: h.cid, args: {} })).find(x => x.typ === 'result')).toMatchObject({ ok: true });
    t.run.stop();
  });
});

describe('R-SEC-p1-25 the connector keeps the server\'s per-section gap and does not count a too-early frame as delivered', () => {
  it('an immediate republish right after a frame waits out the gap', async () => {
    const { SectionScheduler } = await import('../../src/dashboard/scheduler.js');
    const stub = stubRuflo(); const sent: Array<{ section: string; body: Record<string, unknown> }> = []; const clock = { t: 1_000_000_000 };
    const d = tmp(); mkdirSync(join(d, '.claude-flow'), { recursive: true });
    const s = new SectionScheduler({ now: () => clock.t, emit: f => sent.push(f), only: ['workflows'], ctx: { ruflo: stub, projectDir: d, level: 'read', autoApprove: false, cliChoice: 'path', pending: () => [], run: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, truncated: false }), home: d, now: () => clock.t } });
    await s.tick(); expect(sent).toHaveLength(1);
    stub.overrides.workflow_list = { workflows: [{ workflowId: 'w-new', name: 'n', status: 'ready', stepCount: 1 }], total: 1 };
    const t0 = Date.now(); const r = await s.refresh('workflows', { immediate: true }); // the connector's own publish right after a frame
    expect(r).toEqual({ sent: true }); expect(Date.now() - t0).toBeGreaterThanOrEqual(2000); // it waited out the server's 2 s gap instead of being dropped
    expect(JSON.stringify(sent.at(-1)!.body)).toContain('w-new');
  }, 15_000);
});
