/** R-SEC-p1c-*: P1-complete connector rules (collectors, executors, guard). Each fails on the code before this change. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSectionFrame, readToolArgsAllowed, READ_TOOLS } from '../../src/dashboard/protocol/index.js';
import { AUTO_APPROVABLE } from '../../src/dashboard/channel.js';
import { COMMANDS } from '../../src/dashboard/protocol/index.js';
import { cost } from '../../src/dashboard/collect-files.js';
import { agents, anatole, autopilot, flywheel, hiveProposalsFromFile, skills, timeline } from '../../src/dashboard/collect-p1c.js';
import { hive, metaharness } from '../../src/dashboard/collect-p1.js';
import type { CollectCtx } from '../../src/dashboard/collect-core.js';
import { guard, Semaphore } from '../../src/dashboard/exec.js';
import { EXECUTORS, COMMAND_TOOLS } from '../../src/dashboard/executors.js';
import { stubRuflo } from './_support/harness.js';
import { ConfigSchema } from '../../src/dashboard/state.js';

const roots: string[] = [];
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'rfp1c-'))); roots.push(d); return d; };
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });
const noRun = async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, truncated: false });
function ctx(over: Partial<CollectCtx> = {}, dir = tmp()): CollectCtx & { stub: ReturnType<typeof stubRuflo> } {
  mkdirSync(join(dir, '.claude-flow'), { recursive: true });
  const stub = stubRuflo();
  return { stub, ruflo: stub, projectDir: dir, level: 'read', autoApprove: false, cliChoice: 'path', now: () => 1_000_000, cache: {}, errors: new Map(), pending: () => [], notices: () => [], run: noRun, home: tmp(), ...over };
}
const exec = (stub: ReturnType<typeof stubRuflo>, projectDir?: string) => ({ ruflo: stub, cid: 'cmd_test_cid_000001', projectDir, refreshAll: async () => ({ sent: [] }), refreshSection: async () => ({ sent: false }) });
const valid = (n: Parameters<typeof buildSectionFrame>[0], b: Record<string, unknown>) => expect(() => buildSectionFrame(n, b as never, { rev: 1, at: 1 })).not.toThrow();
const writeLedger = (c: CollectCtx) => {
  const sd = join(c.home!, '.claude/plugins/cache/mk/ruflo-cost-tracker/1.2.3/scripts'); mkdirSync(sd, { recursive: true, mode: 0o700 }); writeFileSync(join(sd, 'ledger.mjs'), '//', { mode: 0o600 });
  return JSON.stringify({ totals: { usd: 123.45, credits: 9 }, byModel: { 'claude|opus-secret-model': { usd: 120 } }, cache: { claude: { hitRatio: 0.9 } }, findings: [{ title: 'cut', evidence: 'x' }] });
};

describe('R-SEC-p1c cost privacy (connector)', () => {
  it('R-SEC-p1c-10 the default body is a bucket only: no totals, models, tokens, ratio or advice reach the frame', async () => {
    const c = ctx(); const out = writeLedger(c);
    const r = await cost({ ...c, run: async () => ({ code: 0, stdout: out, stderr: '', timedOut: false, truncated: false }) });
    expect(r).toEqual({ available: true, detail: 'coarse', bucket: '100-1000', windowDays: 7, byModel: [], advice: [], perMission: [] });
    expect(JSON.stringify(r)).not.toMatch(/123|opus|0\.9|Minor/); valid('cost', r);
    const unavailable = await cost(c); expect(unavailable).toMatchObject({ available: false, detail: 'coarse' }); valid('cost', unavailable);
  });
  it('R-SEC-p1c-11 full detail only with the local switch, and the config accepts nothing else', async () => {
    const c = ctx(); const out = writeLedger(c);
    const r = await cost({ ...c, costDetail: 'full', run: async () => ({ code: 0, stdout: out, stderr: '', timedOut: false, truncated: false }) });
    expect(r).toMatchObject({ detail: 'full', totals: { totalMinor: 12345 } }); valid('cost', r);
    const base = { baseUrl: 'https://x', connectUrl: 'wss://x', deviceId: 'dev_' + 'a'.repeat(16), tenantId: 'tnt_' + 'a'.repeat(16), publicKey: 'a'.repeat(43), serverPublicKey: 'b'.repeat(43) };
    expect(ConfigSchema.parse(base).cost).toBeUndefined();
    expect(ConfigSchema.safeParse({ ...base, cost: { detail: 'full' } }).success).toBe(true);
    for (const bad of [{ detail: 'everything' }, { detail: 'full', extra: 1 }]) expect(ConfigSchema.safeParse({ ...base, cost: bad }).success).toBe(false);
  });
});

describe('R-SEC-p1c tool guard', () => {
  it('R-SEC-p1c-12 the collection guard refuses a flywheel promote even though the tool name is allowed', async () => {
    const stub = stubRuflo(); const g = guard(stub, READ_TOOLS, new Semaphore(2), readToolArgsAllowed);
    await expect(g.mcp('metaharness_flywheel', { op: 'promote', receiptId: 'r' })).rejects.toMatchObject({ code: 'params_not_allowed' });
    await expect(g.mcp('metaharness_flywheel', { op: 'status', x: 1 })).rejects.toMatchObject({ code: 'params_not_allowed' });
    await expect(g.mcp('metaharness_flywheel', { op: 'status' })).resolves.toBeTruthy();
    expect(stub.calls.map(x => x.params)).toEqual([{ op: 'status' }]);
  });
  it('R-SEC-p1c-13 flywheel is not called when the project could shadow the metaharness scripts', async () => {
    const c = ctx(); mkdirSync(join(c.projectDir, 'plugins/ruflo-metaharness/scripts'), { recursive: true });
    expect(await flywheel(c)).toBeNull(); expect(c.stub.calls.some(x => x.tool === 'metaharness_flywheel')).toBe(false);
    const m = await metaharness(c); expect(m.available).toBe(false);
  });
  it('R-SEC-p1c-14 the new write tools are command tools only, never collection tools', () => {
    for (const t of ['agent_terminate', 'task_create', 'claims_release', 'claims_status', 'memory_store', 'agent_logs']) { expect(COMMAND_TOOLS.has(t)).toBe(true); expect(READ_TOOLS.has(t)).toBe(false); }
    for (const t of ['hive-mind_consensus', 'claims_steal', 'claims_handoff', 'security_scan', 'metaharness_flywheel']) expect(COMMAND_TOOLS.has(t)).toBe(false);
  });
  it('R-SEC-p1c-15 every new write command is approved locally even when autoApprove is on', () => {
    for (const n of ['agent.stop', 'task.create', 'claims.release', 'claims.pause', 'claims.resume', 'memory.store', 'autopilot.stop'] as const) {
      expect((COMMANDS[n] as { level: string }).level).not.toBe('read'); expect(AUTO_APPROVABLE).not.toContain(n);
    }
  });
});

describe('R-SEC-p1c executors', () => {
  it('R-SEC-p1c-20 agent.logs masks before it cuts, caps the lines and flags synthetic entries', async () => {
    const stub = stubRuflo(); const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    stub.overrides.agent_logs = { agentId: 'a', entries: Array.from({ length: 300 }, (_, i) => ({ timestamp: '2026-10-09T00:00:00Z', level: 'info', message: `${'x'.repeat(150)}${secret}${i}` })), note: 'entries are synthetic (ruvnet/ruflo#1916)' };
    const r = await EXECUTORS['agent.logs']({ agentId: 'a', lines: 100 }, exec(stub));
    expect(r.ok).toBe(true); const res = (r as unknown as { result: { entries: { text: string }[]; synthetic: boolean } }).result;
    expect(res.entries.length).toBeLessThanOrEqual(100); expect(res.entries.length).toBeGreaterThan(5); expect(JSON.stringify(res)).not.toContain('sk-abcdefghijkl'); expect(res.synthetic).toBe(true);
    stub.overrides.agent_logs = { agentId: 'zz', entries: [], total: 0, error: 'Agent not found' };
    expect(await EXECUTORS['agent.logs']({ agentId: 'zz', lines: 5 }, exec(stub))).toEqual({ ok: false, error: 'agent_not_found' });
  });
  it('R-SEC-p1c-21 agent.stop terminates only an agent that exists', async () => {
    const stub = stubRuflo();
    expect(await EXECUTORS['agent.stop']({ agentId: 'ghost' }, exec(stub))).toEqual({ ok: false, error: 'agent_not_found' });
    expect(stub.calls.some(x => x.tool === 'agent_terminate')).toBe(false);
    expect((await EXECUTORS['agent.stop']({ agentId: 'agent-1' }, exec(stub))).ok).toBe(true);
    expect(stub.calls.find(x => x.tool === 'agent_terminate')!.params).toEqual({ agentId: 'agent-1' });
  });
  it('R-SEC-p1c-22 memory.store can only write the "dashboard" namespace, whatever else is in the call', async () => {
    const stub = stubRuflo();
    await EXECUTORS['memory.store']({ key: 'n1', value: 'v', namespace: 'patterns' } as never, exec(stub));
    expect(stub.calls.find(x => x.tool === 'memory_store')!.params).toEqual({ key: 'n1', value: 'v', namespace: 'dashboard' });
  });
  it('R-SEC-p1c-23 claims.release acts only if the claim is still held by the claimant the person saw', async () => {
    const stub = stubRuflo();
    expect(await EXECUTORS['claims.release']({ issue: 'ISSUE-1', claimant: 'human:someone:Else' }, exec(stub))).toEqual({ ok: false, error: 'claimant_changed' });
    expect(await EXECUTORS['claims.release']({ issue: 'NOPE-9', claimant: 'agent:a1:coder' }, exec(stub))).toEqual({ ok: false, error: 'claim_not_found' });
    expect(stub.calls.some(x => x.tool === 'claims_release')).toBe(false);
    expect((await EXECUTORS['claims.release']({ issue: 'ISSUE-2', claimant: 'agent:a1:coder' }, exec(stub))).ok).toBe(true);
    expect(stub.calls.find(x => x.tool === 'claims_release')!.params).toEqual({ issueId: 'ISSUE-2', claimant: 'agent:a1:coder' });
  });
  it('R-SEC-p1c-24 claims.pause needs an active claim and claims.resume a paused one', async () => {
    const stub = stubRuflo();
    expect(await EXECUTORS['claims.resume']({ issue: 'ISSUE-1' }, exec(stub))).toEqual({ ok: false, error: 'claim_is_active' });
    expect(await EXECUTORS['claims.pause']({ issue: 'ISSUE-2' }, exec(stub))).toEqual({ ok: false, error: 'claim_is_blocked' });
    expect((await EXECUTORS['claims.pause']({ issue: 'ISSUE-1' }, exec(stub))).ok).toBe(true);
    expect(stub.calls.find(x => x.tool === 'claims_status')!.params).toEqual({ issueId: 'ISSUE-1', status: 'paused' });
  });
  it('R-SEC-p1c-25 a project that moves ruflo\'s store outside itself gets no write from the dashboard', async () => {
    const d = tmp(); writeFileSync(join(d, 'claude-flow.config.json'), JSON.stringify({ memory: { path: '/tmp/elsewhere' } }));
    const stub = stubRuflo();
    for (const [n, a] of [['task.create', { type: 'feature', description: 'abc' }], ['memory.store', { key: 'k', value: 'v' }], ['agent.stop', { agentId: 'agent-1' }], ['claims.release', { issue: 'ISSUE-1', claimant: 'human:u1:Ana' }], ['claims.pause', { issue: 'ISSUE-1' }]] as const)
      expect(await EXECUTORS[n](a as never, exec(stub, d))).toEqual({ ok: false, error: 'project_store_redirected' });
    expect(stub.calls.filter(x => ['task_create', 'memory_store', 'agent_terminate', 'claims_release', 'claims_status'].includes(x.tool))).toEqual([]);
  });
  it('R-SEC-p1c-26 task.create passes the exact type and description and nothing else', async () => {
    const stub = stubRuflo();
    await EXECUTORS['task.create']({ type: 'bugfix', description: 'fix the thing', priority: 'critical', assignedTo: ['x'] } as never, exec(stub));
    expect(stub.calls.find(x => x.tool === 'task_create')!.params).toEqual({ type: 'bugfix', description: 'fix the thing' });
  });
});

describe('R-SEC-p1c autopilot.stop', () => {
  it('R-SEC-p1c-30 needs an existing autopilot folder; creates KILL exclusively; never overwrites or removes', async () => {
    const d = tmp(); const stub = stubRuflo();
    expect(await EXECUTORS['autopilot.stop']({}, exec(stub, d))).toEqual({ ok: false, error: 'no_autopilot' });
    expect(existsSync(join(d, '.claude-flow/console'))).toBe(false);
    mkdirSync(join(d, '.claude-flow/console/autopilot'), { recursive: true });
    expect(await EXECUTORS['autopilot.stop']({}, exec(stub, d))).toEqual({ ok: true, result: { killed: true, alreadyStopped: false } });
    const kill = join(d, '.claude-flow/console/autopilot/KILL'); expect(readFileSync(kill, 'utf8')).toContain('dashboard');
    writeFileSync(kill, 'person wrote this');
    expect(await EXECUTORS['autopilot.stop']({}, exec(stub, d))).toEqual({ ok: true, result: { killed: true, alreadyStopped: true } });
    expect(readFileSync(kill, 'utf8')).toBe('person wrote this');
  });
  it('R-SEC-p1c-31 a symlinked folder or KILL is refused, nothing is created through it', async () => {
    const d = tmp(); const out = tmp(); const stub = stubRuflo();
    mkdirSync(join(d, '.claude-flow/console'), { recursive: true }); symlinkSync(out, join(d, '.claude-flow/console/autopilot'));
    expect(await EXECUTORS['autopilot.stop']({}, exec(stub, d))).toEqual({ ok: false, error: 'no_autopilot' }); expect(existsSync(join(out, 'KILL'))).toBe(false);
    rmSync(join(d, '.claude-flow/console/autopilot')); mkdirSync(join(d, '.claude-flow/console/autopilot')); symlinkSync(join(out, 'target'), join(d, '.claude-flow/console/autopilot/KILL'));
    expect(await EXECUTORS['autopilot.stop']({}, exec(stub, d))).toEqual({ ok: false, error: 'kill_path_not_a_file' }); expect(existsSync(join(out, 'target'))).toBe(false);
    expect(await EXECUTORS['autopilot.stop']({}, exec(stub))).toEqual({ ok: false, error: 'no_project' });
  });
});

describe('R-SEC-p1c collectors', () => {
  it('R-SEC-p1c-40 hive proposals come from the state file and the hive token never leaves', async () => {
    const c = ctx(); mkdirSync(join(c.projectDir, '.claude-flow/hive-mind'), { recursive: true });
    writeFileSync(join(c.projectDir, '.claude-flow/hive-mind/state.json'), JSON.stringify({ hiveToken: 'TOPSECRETHIVETOKEN0123456789abcdef', consensus: { pending: [{ proposalId: 'proposal-1', type: 't', status: 'pending', strategy: 'raft', votes: { w1: true, w2: false, w3: true } }], history: [] } }));
    c.stub.overrides['hive-mind_status'] = { hiveId: 'h', status: 'initialized', initialized: true, pendingConsensus: 1, workers: [], metrics: {} };
    const r = await hive(c); expect(r.proposals).toEqual([{ id: 'proposal-1', type: 't', status: 'pending', strategy: 'raft', votesFor: 2, votesAgainst: 1 }]); expect(r.pendingConsensus).toBe(1);
    expect(JSON.stringify(r)).not.toContain('TOPSECRET'); valid('hive', r);
    expect(hiveProposalsFromFile({ projectDir: tmp() })).toEqual([]);
  });
  it('R-SEC-p1c-41 agents: shapes from agent_health, valid frame, empty project is a valid empty body', async () => {
    const c = ctx(); const r = await agents(c); expect(r).toMatchObject({ summary: { total: 1, healthy: 1 }, agents: [{ id: 'agent-1', type: 'coder', tasksCompleted: 1, uptimeS: 3 }] }); valid('agents', r);
    c.stub.overrides.agent_health = { agents: [], overall: {}, total: 0 }; valid('agents', await agents(c));
  });
  it('R-SEC-p1c-42 autopilot: hostile journal lines are counted, not trusted; KILL wins the phase; symlinked folder reads as absent', async () => {
    const c = ctx(); expect(await autopilot(c)).toMatchObject({ present: false, phase: 'none', killed: false });
    const dir = join(c.projectDir, '.claude-flow/console/autopilot'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'journal.jsonl'), ['{"t":"start","at":1000}', '{"t":"step.started","at":1001}', '{"t":"step.done","verified":true,"at":1002}', 'not json', '{"t":"<script>","at":1}', '{"t":"parked","at":1003}', '{"t":"pause","at":1004}'].join('\n'));
    let r = await autopilot(c); expect(r).toMatchObject({ present: true, phase: 'paused', steps: { started: 1, done: 1, verified: 1, parked: 1 }, badLines: 2, journalLines: 7, unauthenticated: true }); valid('autopilot', r);
    writeFileSync(join(dir, 'KILL'), '1'); r = await autopilot(c); expect(r).toMatchObject({ killed: true, phase: 'stopped' });
    const d2 = tmp(); const real = tmp(); mkdirSync(join(d2, '.claude-flow/console'), { recursive: true }); symlinkSync(real, join(d2, '.claude-flow/console/autopilot')); writeFileSync(join(real, 'KILL'), '1');
    expect(await autopilot(ctx({}, d2))).toMatchObject({ present: false, killed: false });
  });
  it('R-SEC-p1c-43 skills: names only, valid names only, symlinked entries ignored, no paths', async () => {
    const c = ctx(); const home = c.home!; const outside = tmp();
    for (const n of ['good-skill', 'bad name', '.hidden', '..', 'x;y']) { try { mkdirSync(join(c.projectDir, '.claude/skills', n), { recursive: true }); } catch { /* skip */ } }
    writeFileSync(join(c.projectDir, '.claude/skills/good-skill/SKILL.md'), '# s'); symlinkSync(outside, join(c.projectDir, '.claude/skills/linked'));
    mkdirSync(join(c.projectDir, '.agents/skills/ag'), { recursive: true }); mkdirSync(join(home, '.claude/skills/usr'), { recursive: true });
    const r = await skills(c) as { total: number; skills: { name: string; source: string; manifest: boolean }[] };
    expect(r.skills.map(s => `${s.source}:${s.name}`).sort()).toEqual(['agents:ag', 'project:good-skill', 'user:usr']); expect(r.skills.find(s => s.name === 'good-skill')!.manifest).toBe(true);
    expect(JSON.stringify(r)).not.toContain(c.projectDir); valid('skills', r);
  });
  it('R-SEC-p1c-44 anatole is labelled unauthenticated, enums are whitelisted, a wrong schema version reads as absent', () => {
    const c = ctx(); const f = join(c.projectDir, '.claude-flow/protector-mod'); mkdirSync(f, { recursive: true });
    expect(anatole(c)).toBeNull();
    writeFileSync(join(f, 'status.json'), JSON.stringify({ schemaVersion: 1, mode: 'rm -rf /', calls: 5, blocked: 2, alerts: { critical: 1, high: 2 }, degraded: 'sk-abcdefghijklmnopqrstuvwxyz1234 failed open' }));
    const a = anatole(c)!; expect(a).toMatchObject({ present: true, mode: null, calls: 5, blocked: 2, open: { critical: 1, high: 2, total: 3 }, unauthenticated: true }); expect(JSON.stringify(a)).not.toContain('sk-abcdefghijklmnop');
    writeFileSync(join(f, 'status.json'), JSON.stringify({ schemaVersion: 2, mode: 'enforce' })); expect(anatole(c)).toBeNull();
  });
  it('R-SEC-p1c-45 timeline: event activity bucketed per source, bounded lanes, valid frame', async () => {
    const c = ctx({ now: () => 10_000_000 }); const ev = (at: number, src: string) => ({ at, kind: 'k', level: 'info', src, text: 't' });
    c.cache.events = { events: [ev(9_999_000, 'console'), ev(9_990_000, 'console'), ev(9_000_000, 'mission'), ...Array.from({ length: 40 }, (_, i) => ev(9_000_000 + i, `src${i}`))] };
    const r = await timeline(c) as { lanes: { lane: string; total: number; counts: number[] }[]; buckets: number }; valid('timeline', r);
    expect(r.lanes.length).toBeLessThanOrEqual(16); expect(r.lanes[0]).toMatchObject({ lane: 'console', total: 2 }); expect(r.lanes.every(l => l.counts.length === r.buckets)).toBe(true);
  });
});
