// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuosHostAdapter, isUp } from '../scripts/lib/adapter.mjs';
import { createExecPollTransport } from '../scripts/lib/jobs.mjs';
import { buildPromptChunks } from '../scripts/lib/command-builder.mjs';
import { RuosError } from '../scripts/lib/types.mjs';
import { desktop, fakeClock, fakeFleet, fakeTransport, fakeLedger, ok, DESKTOP_ID, FLY_ID } from './fakes.mjs';

const RUN = 'r-adapter-0001';
const PROMPT = 'write hello.txt';
const SHA = buildPromptChunks(RUN, PROMPT).sha256;
const b64 = (/** @type {string} */ s) => Buffer.from(s).toString('base64');

/**
 * Remote that answers each builder command; `polls` is consumed in order.
 * @param {string[]} polls
 * @param {{ sha?: string, launch?: string }} o
 */
function remote(polls, o = {}) {
  let i = 0;
  return fakeTransport((cmd) => {
    if (cmd.includes('RUOS%s_PREPARED')) return ok('RUOS_PREPARED\n');
    if (cmd.startsWith("printf '%s'")) return ok('');
    if (cmd.includes('RUOS%s_NO_RUNNER')) return ok(o.launch ?? `RUOS_SHA:${o.sha ?? SHA}\nRUOS_PID:4242\n`);
    if (cmd.includes('RUOS%s_POLL')) {
      // Once the script is exhausted, repeat the last state with no new
      // bytes — what a real desktop returns once the offset caught up.
      const p = i < polls.length ? polls[i++] : polls[polls.length - 1].replace(/:[A-Za-z0-9+/=]*$/, ':');
      if (p === 'THROW') throw new RuosError('network-down', 'gone');
      return ok(p);
    }
    if (cmd.includes('RUOS%s_STOPPED')) return ok('RUOS_STOPPED\n');
    throw new Error(`unexpected command ${cmd.slice(0, 40)}`);
  });
}

/** @param {any} over */
function setup(over = {}) {
  const clock = fakeClock();
  const ds = over.desktops ?? [desktop({ heartbeatAt: Math.floor(clock.now() / 1000) })];
  const fleet = over.fleet ?? fakeFleet(ds);
  const transport = over.transport ?? remote([`RUOS_POLL:-:6:1:${b64('hello ')}`, 'RUOS_POLL:-:6:1:', `RUOS_POLL:0:12:0:${b64('world\n')}`]);
  const ledger = fakeLedger();
  const adapter = new RuosHostAdapter({ fleet, jobs: createExecPollTransport(transport), ledger: /** @type {any} */ (ledger), now: clock.now, sleep: clock.sleep });
  return { adapter, fleet, transport, ledger, clock };
}

const base = { desktop: 'Work Desktop', prompt: PROMPT, runId: RUN, agentId: 'ruos-agent-1', agentType: 'coder', timeoutSecs: 600 };

test('happy path: launch, stream, ledger + claims, keepawake', async () => {
  const { adapter, ledger, fleet, transport } = setup();
  /** @type {string[]} */ const seen = [];
  const out = await adapter.run({ ...base, onOutput: (c) => seen.push(c.toString()) });
  assert.equal(out.status, 'completed');
  assert.equal(out.exitCode, 0);
  assert.equal(seen.join(''), 'hello world\n');
  assert.equal(out.bytes, 12);
  assert.equal(out.desktopId, DESKTOP_ID);
  assert.ok(out.firstOutputMs !== null && out.firstOutputMs >= out.dispatchMs);
  const names = ledger.calls.map((c) => c[0]);
  assert.deepEqual(names.filter((n) => n !== 'snapshotHosts'), ['claim', 'registerAgent', 'setHostAgent', 'setHostAgent', 'updateAgent', 'release']);
  assert.deepEqual(ledger.calls.filter((c) => c[0] === 'setHostAgent').map((c) => c[1][2]), [true, false], 'placed, then removed');
  const host = /** @type {any} */ (ledger.calls.find((c) => c[0] === 'registerAgent'))[1][2];
  assert.deepEqual(host, { kind: 'ruos', desktopId: DESKTOP_ID, desktopName: 'Work Desktop', transport: 'fleet-mcp', jobs: 'exec-poll', runId: RUN, stopAt: '2026-10-02T03:00:00.000Z' });
  assert.equal(out.stopAt, '2026-10-02T03:00:00.000Z', 'the 23:00 deadline is surfaced in swarm state');
  assert.deepEqual(ledger.events.map((e) => e.type), ['run.started', 'run.output', 'run.output', 'run.completed']);
  assert.ok(ledger.events.every((e) => !JSON.stringify(e).includes(PROMPT)), 'events never carry the prompt');
  assert.deepEqual(fleet.calls.find((c) => c[0] === 'keepAwake'), ['keepAwake', [FLY_ID, 15]]);
  assert.ok(!transport.commands.join('\n').includes(PROMPT), 'prompt never sent verbatim');
});

test('stopped desktop without --start is refused before any exec', async () => {
  const { adapter, transport, fleet } = setup({ desktops: [desktop({ state: 'stopped', heartbeatStatus: 'asleep' })] });
  await assert.rejects(adapter.run(base), (e) => e instanceof RuosError && e.code === 'desktop-stopped');
  assert.equal(transport.commands.length, 0);
  assert.ok(!fleet.calls.some((c) => c[0] === 'start'));
});

test('--start wakes the desktop and waits for a fresh heartbeat (not `ready`)', async () => {
  const clock = fakeClock();
  let started = false;
  /** @type {any} */ let fleet;
  fleet = fakeFleet(() => {
    const woke = started && fleet.calls.filter((/** @type {any} */ c) => c[0] === 'listDesktops').length > 3;
    return [desktop(woke ? { heartbeatAt: Math.floor(clock.now() / 1000), heartbeatStatus: 'ok', state: 'started' } : { state: 'stopped', heartbeatStatus: 'asleep', heartbeatAt: 1 })];
  });
  const origStart = fleet.start;
  fleet.start = async (/** @type {string} */ id) => { started = true; return origStart(id); };
  const ledger = fakeLedger();
  const transport = remote([`RUOS_POLL:0:2:0:${b64('ok')}`]);
  const adapter = new RuosHostAdapter({ fleet, jobs: createExecPollTransport(transport), ledger: /** @type {any} */ (ledger), now: clock.now, sleep: clock.sleep });
  const out = await adapter.run({ ...base, allowStart: true });
  assert.equal(out.status, 'completed');
  assert.deepEqual(fleet.calls.find((/** @type {any} */ c) => c[0] === 'start'), ['start', [DESKTOP_ID]]);
  assert.ok(ledger.events.some((e) => e.type === 'desktop.state' && e.state === 'started'));
});

test('desktop auto-stopped mid-run is reported as auto-stopped and released', async () => {
  const clock = fakeClock();
  let calls = 0;
  const fleet = fakeFleet(() => [desktop(++calls <= 1 ? { heartbeatAt: Math.floor(clock.now() / 1000) } : { state: 'stopped', heartbeatStatus: 'asleep' })]);
  const ledger = fakeLedger();
  const adapter = new RuosHostAdapter({ fleet, jobs: createExecPollTransport(remote([`RUOS_POLL:-:2:1:${b64('hi')}`, 'THROW'])), ledger: /** @type {any} */ (ledger), now: clock.now, sleep: clock.sleep });
  await assert.rejects(adapter.run(base), (e) => e instanceof RuosError && e.code === 'auto-stopped');
  assert.ok(ledger.calls.some((c) => c[0] === 'release'), 'claim released on failure');
  assert.equal(ledger.events.at(-1).type, 'run.failed');
  assert.equal(ledger.events.at(-1).error, 'auto-stopped');
});

test('auth expired mid-run surfaces as auth-expired', async () => {
  const { adapter } = setup({ transport: remote(['THROW']) });
  // make the poll throw auth-expired instead of network-down
  const t = fakeTransport((cmd) => {
    if (cmd.includes('RUOS%s_POLL')) throw new RuosError('auth-expired', 'token expired');
    if (cmd.includes('RUOS%s_NO_RUNNER')) return ok(`RUOS_SHA:${SHA}\nRUOS_PID:1\n`);
    return ok('RUOS_PREPARED\n');
  });
  adapter.jobs = createExecPollTransport(t);
  await assert.rejects(adapter.run(base), (e) => e instanceof RuosError && e.code === 'auth-expired');
});

test('network down while desktop is still up stays network-down', async () => {
  const { adapter } = setup({ transport: remote(['THROW']) });
  await assert.rejects(adapter.run(base), (e) => e instanceof RuosError && e.code === 'network-down');
});

test('prompt integrity mismatch aborts before streaming', async () => {
  const { adapter, ledger } = setup({ transport: remote([], { sha: 'f'.repeat(64) }) });
  await assert.rejects(adapter.run(base), /integrity/);
  assert.ok(!ledger.events.some((e) => e.type === 'run.started'));
});

test('missing runner on the desktop is a clear error', async () => {
  const { adapter } = setup({ transport: remote([], { launch: 'RUOS_NO_RUNNER\n' }) });
  await assert.rejects(adapter.run(base), /not installed/);
});

test('a run that would cross the 23:00 Toronto auto-stop is refused unless overridden', async () => {
  const clock = fakeClock(Date.parse('2026-10-02T02:45:00Z')); // Thu 22:45 EDT
  const fleet = fakeFleet([desktop({ heartbeatAt: Math.floor(clock.now() / 1000) })]);
  const transport = remote([`RUOS_POLL:0:0:0:`]);
  const adapter = new RuosHostAdapter({ fleet, jobs: createExecPollTransport(transport), ledger: /** @type {any} */ (fakeLedger()), now: clock.now, sleep: clock.sleep });
  await assert.rejects(adapter.run({ ...base, timeoutSecs: 3600 }), (e) => e instanceof RuosError && e.code === 'autostop-window');
  assert.equal(transport.commands.length, 0);
  const out = await adapter.run({ ...base, timeoutSecs: 3600, ignoreAutoStop: true });
  assert.equal(out.status, 'completed');
});

test('run timeout stops the remote process group', async () => {
  const { adapter, transport } = setup({ transport: remote(['RUOS_POLL:-:0:1:']) });
  await assert.rejects(adapter.run({ ...base, timeoutSecs: 30 }), (e) => e instanceof RuosError && e.code === 'timeout');
  assert.ok(transport.commands.at(-1)?.includes('RUOS%s_STOPPED'));
});

test('abort signal stops the run and records run.stopped', async () => {
  const ac = new AbortController();
  const { adapter, ledger } = setup({ transport: remote([`RUOS_POLL:-:1:1:${b64('x')}`, 'RUOS_POLL:-:1:1:']) });
  const p = adapter.run({ ...base, signal: ac.signal, onOutput: () => ac.abort() });
  const out = await p;
  assert.equal(out.status, 'stopped');
  assert.equal(ledger.events.at(-1).type, 'run.stopped');
});

test('foreign desktop ids never reach a transport', async () => {
  const { adapter, transport } = setup();
  await assert.rejects(adapter.run({ ...base, desktop: 'ffffffffffffffffffffffffffffffff' }), (e) => e instanceof RuosError && e.code === 'not-owned');
  assert.equal(transport.commands.length, 0);
});

test('destructive ops require explicit confirm', async () => {
  const { adapter, fleet, transport } = setup();
  await assert.rejects(adapter.stopRun({ desktop: 'Work Desktop', runId: RUN }), (e) => e instanceof RuosError && e.code === 'confirm-required');
  await assert.rejects(adapter.stopDesktop({ desktop: 'Work Desktop' }), (e) => e instanceof RuosError && e.code === 'confirm-required');
  assert.equal(transport.commands.length, 0);
  assert.ok(!fleet.calls.some((c) => c[0] === 'stop'));
  assert.deepEqual(await adapter.stopRun({ desktop: 'Work Desktop', runId: RUN, confirm: true }), { runId: RUN, desktopId: DESKTOP_ID, stopped: true });
  await adapter.stopDesktop({ desktop: 'Work Desktop', confirm: true });
  assert.deepEqual(fleet.calls.find((c) => c[0] === 'stop'), ['stop', [DESKTOP_ID]]);
});

test('isUp uses heartbeat freshness, not `ready`', () => {
  const now = Date.UTC(2026, 9, 1, 15, 0, 0);
  assert.equal(isUp(desktop({ heartbeatAt: now / 1000 - 10 }), now), true);
  assert.equal(isUp(desktop({ heartbeatAt: now / 1000 - 1000 }), now), false);
  assert.equal(isUp(desktop({ heartbeatStatus: 'asleep', heartbeatAt: now / 1000 }), now), false);
  assert.equal(isUp(desktop({ heartbeatAt: null, ready: true }), now), false);
});

test('runner killed without an exit code is detected, not waited out', async () => {
  const { adapter, ledger } = setup({ transport: remote(['RUOS_POLL:-:0:0:']) });
  await assert.rejects(adapter.run(base), /died without an exit code/);
  assert.equal(ledger.events.at(-1).type, 'run.failed');
});

test('enrolled devices (no Fly id) are not subject to the cloud auto-stop window', async () => {
  const clock = fakeClock(Date.parse('2026-10-02T02:45:00Z'));
  const fleet = fakeFleet([desktop({ flyMachineId: null, heartbeatAt: Math.floor(clock.now() / 1000) })]);
  const adapter = new RuosHostAdapter({ fleet, jobs: createExecPollTransport(remote(['RUOS_POLL:0:0:0:'])), ledger: /** @type {any} */ (fakeLedger()), now: clock.now, sleep: clock.sleep });
  assert.equal((await adapter.run({ ...base, timeoutSecs: 3600 })).status, 'completed');
});

test('a poll truncated mid-base64-quantum loses no bytes', async () => {
  const full = Buffer.from('abcdefghij').toString('base64'); // 16 chars
  const cut = full.slice(0, 7); // transport truncated: 1 whole quantum + 3 chars
  let polls = 0;
  const t = fakeTransport((cmd) => {
    if (cmd.includes('RUOS%s_PREPARED')) return ok('RUOS_PREPARED');
    if (cmd.startsWith("printf '%s'")) return ok('');
    if (cmd.includes('RUOS%s_NO_RUNNER')) return ok(`RUOS_SHA:${SHA}\nRUOS_PID:7\n`);
    const off = Number(/tail -c \+(\d+)/.exec(cmd)?.[1]) - 1;
    polls++;
    if (polls === 1) return ok(`RUOS_POLL:-:10:1:${cut}`);
    return ok(`RUOS_POLL:0:10:0:${Buffer.from('abcdefghij'.slice(off)).toString('base64')}`);
  });
  const { adapter } = setup({ transport: t });
  /** @type {string[]} */ const seen = [];
  const out = await adapter.run({ ...base, onOutput: (c) => seen.push(c.toString()) });
  assert.equal(seen.join(''), 'abcdefghij');
  assert.equal(out.bytes, 10);
});
