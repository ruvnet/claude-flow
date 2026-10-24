// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuosHostAdapter } from '../scripts/lib/adapter.mjs';
import { createLedger } from '../scripts/lib/ledger.mjs';
import { RunStore } from '../scripts/lib/run-store.mjs';
import { createJobsApiTransport } from '../scripts/lib/jobs.mjs';
import { RuosError } from '../scripts/lib/types.mjs';
import { fakeClock, fakeFleet, fakeLedger, desktop, DESKTOP_ID, OTHER_ID } from './fakes.mjs';

const RUN = 'r-recovery-001';
const SHA = 'a'.repeat(64);
const BINDING = { missionId: `msn_${'a'.repeat(24)}`, missionRevision: 2, worktree: '/work/project', commit: 'b'.repeat(40), sourceDigest: `sha256:${'c'.repeat(64)}` };
const options = { desktop: DESKTOP_ID, runId: RUN, agentId: 'coder-1', prompt: 'private prompt never in observations', timeoutSecs: 60, binding: BINDING };
const chunk = (text, state = 'running', exitCode = null, offset = 0) => ({ chunk: Buffer.from(text), nextOffset: offset + Buffer.byteLength(text), running: state === 'running', state, exitCode, truncated: false });

function fixture(t, scripts = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'ruflo-recovery-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const clock = fakeClock();
  const fleet = fakeFleet([desktop(), desktop({ id: OTHER_ID, name: 'other', displayName: 'other' })]);
  const calls = { start: [], poll: [], cancel: [] };
  const jobs = {
    kind: 'jobs-api',
    start: async (d, spec) => { calls.start.push([d.id, spec.runId]); return scripts.start ? scripts.start(d, spec) : { jobId: 'server_opaque_7', commandSha256: SHA }; },
    poll: async (d, id, offset) => { calls.poll.push([id, offset]); return scripts.poll ? scripts.poll(d, id, offset) : chunk('', 'running', null, offset); },
    cancel: async (d, id) => { calls.cancel.push([d.id, id]); return scripts.cancel ? scripts.cancel(d, id) : true; },
  };
  const make = () => {
    const ledger = fakeLedger();
    ledger.runs = new RunStore(cwd, () => new Date(clock.now()));
    const adapter = new RuosHostAdapter({ fleet, jobs: /** @type {any} */ (jobs), ledger: /** @type {any} */ (ledger), now: clock.now, sleep: clock.sleep });
    return { adapter, ledger };
  };
  return { cwd, clock, fleet, jobs, calls, make, ...make() };
}

function reserve(runs, extra = {}) {
  return runs.reserve({ runId: RUN, agentId: 'coder-1', agentType: 'coder', desktopId: DESKTOP_ID, jobs: 'jobs-api', transport: 'fleet-mcp', jobId: 'server_opaque_7', state: 'running', connection: 'healthy', startedAt: '2026-10-01T15:00:00.000Z', commandSha256: SHA, exitCode: null, timeoutSecs: 60, stopAt: null, binding: BINDING, ...extra });
}

test('new adapter reconnects to saved server job + cursor after client loss, launches once and copies every byte once', async t => {
  let n = 0;
  const f = fixture(t, { poll: (_d, _id, offset) => {
    if (++n === 1) return chunk('hello ', 'running', null, offset);
    if (n === 2) throw new RuosError('network-down', 'client disconnected');
    return chunk(offset === 6 ? 'world' : '', 'exited', 0, offset);
  } });
  await assert.rejects(f.adapter.run(options), e => e.code === 'network-down');
  const lost = f.ledger.runs.required(RUN);
  assert.equal(lost.jobId, 'server_opaque_7');
  assert.equal(lost.nextOffset, 6);
  assert.equal(lost.state, 'running');
  assert.equal(lost.connection, 'disconnected');
  assert.ok(!f.ledger.calls.some(([name]) => name === 'release'));
  const second = f.make();
  const seen = [];
  const result = await second.adapter.attach({ runId: RUN, onOutput: b => seen.push(b.toString()) });
  assert.equal(result.status, 'completed');
  assert.equal(seen.join(''), 'world');
  assert.deepEqual(f.calls.poll[2], ['server_opaque_7', 6]);
  assert.equal(f.calls.start.length, 1);
  assert.equal(f.calls.cancel.length, 0);
  assert.equal(readFileSync(join(f.cwd, '.claude-flow/ruos/runs', `${RUN}.log`), 'utf8'), 'hello world');
  const polls = f.calls.poll.length;
  assert.equal((await second.adapter.attach({ runId: RUN })).bytes, 0);
  assert.equal(f.calls.poll.length, polls, 'terminal reconnect does not contact or restart the job');
  assert.ok(second.ledger.calls.some(([name]) => name === 'release'));
  const observation = readFileSync(join(f.cwd, '.claude-flow/ruos/observation.json'), 'utf8');
  assert.ok(!observation.includes(options.prompt));
  assert.ok(!observation.includes('hello'));
  assert.deepEqual(JSON.parse(observation).runs[0].binding, BINDING);
});

test('attach wait expiry detaches without cancel, wake, keepawake, or launch', async t => {
  const f = fixture(t);
  reserve(f.ledger.runs);
  const out = await f.adapter.attach({ runId: RUN, timeoutSecs: 1 });
  assert.equal(out.status, 'detached');
  assert.equal(f.calls.start.length, 0);
  assert.equal(f.calls.cancel.length, 0);
  assert.ok(!f.fleet.calls.some(([name]) => ['start', 'keepAwake', 'llmRoute'].includes(name)));
  assert.ok(!f.ledger.calls.some(([name]) => name === 'release'));
});

test('ambiguous launch acknowledgement persists unknown and cannot be rerun or guessed as run id', async t => {
  const f = fixture(t, { start: () => { throw new RuosError('network-down', 'response lost after server launch'); } });
  await assert.rejects(f.adapter.run(options), e => e.code === 'network-down');
  assert.equal(f.ledger.runs.required(RUN).jobId, null);
  assert.equal(f.ledger.runs.required(RUN).state, 'unknown');
  await assert.rejects(f.make().adapter.run(options), e => e.code === 'run-exists');
  await assert.rejects(f.make().adapter.attach({ runId: RUN }), e => e.code === 'reconciliation-required');
  assert.equal(f.calls.start.length, 1);
  assert.equal(f.calls.poll.length, 0);
  assert.equal(f.calls.cancel.length, 0);
});

test('duplicate start reservations across adapters permit only one launch', async t => {
  const f = fixture(t, { poll: (_d, _id, offset) => chunk('', 'exited', 0, offset) });
  const results = await Promise.allSettled([f.adapter.run(options), f.make().adapter.run(options)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.calls.start.length, 1);
});

test('reconnect rejects changed backend, desktop, agent and cursor before remote polling', async t => {
  const f = fixture(t);
  reserve(f.ledger.runs);
  await assert.rejects(f.adapter.attach({ runId: RUN, desktop: OTHER_ID }), e => e.code === 'binding-mismatch');
  await assert.rejects(f.adapter.attach({ runId: RUN, agentId: 'someone-else' }), e => e.code === 'binding-mismatch');
  await assert.rejects(f.adapter.attach({ runId: RUN, offset: 10 }), e => e.code === 'revision-conflict');
  f.jobs.kind = 'exec-poll';
  await assert.rejects(f.adapter.attach({ runId: RUN }), e => e.code === 'binding-mismatch');
  assert.equal(f.calls.poll.length, 0);
  assert.equal(f.calls.cancel.length, 0);
});

test('stale stop approval is refused; fresh approval uses saved server job; failed delivery can be explicitly retried', async t => {
  let attempts = 0;
  const f = fixture(t, { cancel: () => { if (++attempts === 1) throw new RuosError('network-down', 'cancel delivery unknown'); return true; } });
  const old = reserve(f.ledger.runs);
  f.ledger.runs.checkpoint(RUN, { expectedOffset: 0, nextOffset: 1, chunk: Buffer.from('x') });
  await assert.rejects(f.adapter.stopRun({ runId: RUN, confirm: true, expectedRevision: old.revision, bindingDigest: old.bindingDigest }), e => e.code === 'revision-conflict');
  assert.equal(f.calls.cancel.length, 0);
  const fresh = f.ledger.runs.required(RUN);
  await assert.rejects(f.adapter.stopRun({ runId: RUN, confirm: true, expectedRevision: fresh.revision, bindingDigest: fresh.bindingDigest }), e => e.code === 'network-down');
  const retry = f.ledger.runs.required(RUN);
  assert.equal(retry.state, 'stopping');
  assert.equal(retry.connection, 'disconnected');
  const out = await f.adapter.stopRun({ runId: RUN, confirm: true, expectedRevision: retry.revision, bindingDigest: retry.bindingDigest });
  assert.equal(out.acknowledgement, 'pending');
  assert.deepEqual(f.calls.cancel, [[DESKTOP_ID, 'server_opaque_7'], [DESKTOP_ID, 'server_opaque_7']]);
  assert.ok(!f.ledger.calls.some(([name]) => name === 'release'));
});

test('output journal recovers uncommitted suffix and fences duplicate readers', t => {
  const f = fixture(t);
  reserve(f.ledger.runs);
  f.ledger.runs.checkpoint(RUN, { expectedOffset: 0, nextOffset: 3, chunk: Buffer.from('one') });
  const log = join(f.cwd, '.claude-flow/ruos/runs', `${RUN}.log`);
  appendFileSync(log, 'uncommitted suffix after interrupted checkpoint');
  const restarted = new RunStore(f.cwd);
  restarted.checkpoint(RUN, { expectedOffset: 3, nextOffset: 6, chunk: Buffer.from('two') });
  assert.equal(readFileSync(log, 'utf8'), 'onetwo');
  assert.throws(() => restarted.checkpoint(RUN, { expectedOffset: 3, nextOffset: 6, chunk: Buffer.from('two') }), e => e.code === 'revision-conflict');
  assert.equal(statSync(log).mode & 0o077, 0);
  writeFileSync(log, 'short');
  assert.throws(() => restarted.checkpoint(RUN, { expectedOffset: 6, nextOffset: 7, chunk: Buffer.from('!') }), e => e.code === 'output-corrupt');
});

test('store refuses symlink output, hostile bindings, changed source digest and corrupted record', t => {
  const f = fixture(t);
  assert.throws(() => reserve(f.ledger.runs, { binding: { worktree: 'bad\npath' } }), e => e.code === 'invalid-input');
  reserve(f.ledger.runs);
  const log = join(f.cwd, '.claude-flow/ruos/runs', `${RUN}.log`);
  const outside = join(f.cwd, 'outside'); writeFileSync(outside, 'keep'); symlinkSync(outside, log);
  assert.throws(() => f.ledger.runs.checkpoint(RUN, { expectedOffset: 0, nextOffset: 1, chunk: Buffer.from('x') }));
  assert.equal(readFileSync(outside, 'utf8'), 'keep');
  const r = f.ledger.runs.required(RUN);
  assert.throws(() => f.ledger.runs.requestStop(RUN, r.revision, `sha256:${'f'.repeat(64)}`), e => e.code === 'revision-conflict');
  const file = join(f.cwd, '.claude-flow/ruos/runs', `${RUN}.json`);
  const bad = JSON.parse(readFileSync(file, 'utf8')); bad.binding.commit = 'd'.repeat(40); writeFileSync(file, JSON.stringify(bad));
  assert.throws(() => f.ledger.runs.required(RUN), e => e.code === 'invalid-input');
});


test('successful quiet polls refresh observation without restarting or cancelling', async t => {
  const f = fixture(t);
  const r = reserve(f.ledger.runs);
  f.clock.tick(61_000);
  await f.adapter.attach({ runId: RUN, timeoutSecs: 1 });
  const observed = f.ledger.runs.required(RUN);
  assert.ok(Date.parse(observed.updatedAt) >= Date.parse(r.updatedAt) + 60_000);
  assert.equal(observed.connection, 'healthy');
  assert.equal(f.calls.start.length, 0); assert.equal(f.calls.cancel.length, 0);
});

test('jobs API refuses invalid output encodings and regressing offsets before durable cursor advancement', async () => {
  for (const bad of [{ chunk: 'eA==', next_offset: 0 }, { chunk: 'not base64', next_offset: 20 }, { chunk: '', next_offset: Number.NaN }]) {
    const backend = { read: async () => ({ ...bad, state: 'running', running: true, exit_code: null, truncated: false }) };
    const transport = createJobsApiTransport(/** @type {any} */ (backend), /** @type {any} */ ({}));
    await assert.rejects(transport.poll(desktop(), 'server_opaque_7', 0), e => e.code === 'remote-error');
  }
});


test('configured policy denials stop dependent remote launch and desktop wake', async t => {
  for (const refused of ['claims_claim', 'agent_spawn', 'agent_update']) {
    const f = fixture(t);
    const ledger = createLedger({ cwd: f.cwd, callTool: async name => name === refused ? { success: false, error: 'policy-denied' } : { success: true }, now: () => new Date(f.clock.now()) });
    const adapter = new RuosHostAdapter({ fleet: f.fleet, jobs: /** @type {any} */ (f.jobs), ledger, now: f.clock.now, sleep: f.clock.sleep });
    await assert.rejects(adapter.run({ ...options, allowStart: true }), e => e.code === 'policy-denied');
    assert.equal(f.calls.start.length, 0);
    assert.equal(f.calls.poll.length, 0);
    assert.ok(!f.fleet.calls.some(([name]) => ['start', 'keepAwake'].includes(name)));
    assert.equal(ledger.runs.required(RUN).state, 'stopped');
  }
});


test('public observation is bounded by count and UTF-8 bytes', t => {
  const f = fixture(t);
  for (let i = 0; i < 51; i++) reserve(f.ledger.runs, { runId: `r-bounded-${String(i).padStart(3, '0')}`, binding: { worktree: '界'.repeat(512), workspace: '界'.repeat(512) } });
  const bytes = readFileSync(join(f.cwd, '.claude-flow/ruos/observation.json'));
  const observation = JSON.parse(bytes.toString());
  assert.ok(bytes.length <= 128_000);
  assert.ok(observation.runs.length <= 50);
  assert.equal(observation.truncated, true);
});

test('missing optional claim tool does not suppress configured agent policy checks', async t => {
  const f = fixture(t);
  const calls = [];
  const ledger = createLedger({ cwd: f.cwd, callTool: async name => { calls.push(name); if (name === 'claims_claim') throw Error('unknown tool claims_claim'); return { allowed: false }; } });
  const adapter = new RuosHostAdapter({ fleet: f.fleet, jobs: /** @type {any} */ (f.jobs), ledger, now: f.clock.now });
  await assert.rejects(adapter.run(options), e => e.code === 'policy-denied');
  assert.deepEqual(calls, ['claims_claim', 'agent_spawn']);
  assert.equal(f.calls.start.length, 0);
});
