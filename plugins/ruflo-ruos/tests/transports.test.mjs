// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  FleetMcpClient, createFleet, createFleetTransport, normalizeDesktops, classifyToolError, parseRpcBody,
} from '../scripts/lib/fleet-mcp.mjs';
import { buildSshArgv, createSshTransport, sshHostFor } from '../scripts/lib/ssh.mjs';
import { RuosError } from '../scripts/lib/types.mjs';
import { desktop } from './fakes.mjs';

const URL_ = 'https://fleet.example.test/mcp';
const TOKEN = 'test-token-not-real';

/**
 * Fake fetch: answers initialize/initialized, then `onTool(name, args)`.
 * @param {(name: string, args: any) => { status?: number, result?: any, sse?: boolean, throws?: Error }} onTool
 */
function fakeFetch(onTool) {
  /** @type {any[]} */
  const requests = [];
  /** @type {typeof fetch} */
  const f = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url, headers: init?.headers, body });
    const headers = new Headers({ 'mcp-session-id': 'sess-1', 'content-type': 'application/json' });
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202, headers });
    const r = onTool(body.params.name, body.params.arguments);
    if (r.throws) throw r.throws;
    if (r.status && r.status !== 200) return new Response('no', { status: r.status });
    const msg = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: r.result });
    if (r.sse) return new Response(`event: message\ndata: ${msg}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    return new Response(msg, { status: 200, headers });
  };
  return { f, requests };
}

const text = (/** @type {unknown} */ o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });

test('fleet MCP: unconfigured client refuses with no network call', async () => {
  let called = false;
  const c = new FleetMcpClient({ url: undefined, token: undefined, fetchImpl: async () => { called = true; return new Response(''); } });
  await assert.rejects(c.callTool('desktop_status', {}), (e) => e instanceof RuosError && e.code === 'not-configured');
  assert.equal(called, false);
});

test('fleet MCP: refuses http and the executor port', async () => {
  for (const url of ['http://fleet.example.test/mcp', 'https://desk.internal:17870/x']) {
    const c = new FleetMcpClient({ url, token: TOKEN, fetchImpl: async () => new Response('') });
    await assert.rejects(c.callTool('desktop_status', {}), (e) => e instanceof RuosError && e.code === 'invalid-input');
  }
});

test('fleet MCP: stateless tools/call, bearer, SSE and structured payloads', async () => {
  const { f, requests } = fakeFetch((name) => name === 'desktop_status'
    ? { result: text({ desktops: [{ machine_id: 'a'.repeat(32), fly_machine_id: 'b'.repeat(14), name: 'n', display_name: 'D', state: 'started', heartbeat_status: 'ok', last_heartbeat_at: 5, ready: true }, { machine_id: 'bogus' }] }), sse: true }
    : { result: { structuredContent: { stdout: 'RUOS_RUNNER_OK\n', exit_code: 0 } } });
  const client = new FleetMcpClient({ url: URL_, token: TOKEN, fetchImpl: f });
  const ds = await createFleet(client).listDesktops();
  assert.equal(ds.length, 1, 'malformed ids are dropped');
  assert.equal(ds[0].flyMachineId, 'b'.repeat(14));
  const r = await createFleetTransport(client).exec(ds[0], 'echo', 999);
  assert.deepEqual(r, { stdout: 'RUOS_RUNNER_OK\n', stderr: '', exitCode: 0, truncated: false });
  const call = requests.at(-1);
  assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(call.body.method, 'tools/call');
  assert.ok(!requests.some((r) => r.body.method === 'initialize'), 'remote /mcp is stateless: no handshake');
  assert.deepEqual(call.body.params.arguments, { command: 'echo', machine: 'b'.repeat(14), timeout_secs: 300 });
});

test('fleet MCP failure typing: auth expired, network down, stopped, timeout', async () => {
  const mk = (/** @type {any} */ r) => new FleetMcpClient({ url: URL_, token: TOKEN, fetchImpl: fakeFetch(() => r).f });
  await assert.rejects(mk({ status: 401 }).callTool('desktop_exec', {}), (e) => e instanceof RuosError && e.code === 'auth-expired');
  await assert.rejects(mk({ status: 403 }).callTool('desktop_exec', {}), (e) => e instanceof RuosError && e.code === 'insufficient-scope', 'read-only token on a control tool');
  await assert.rejects(mk({ status: 403 }).callTool('desktop_status', {}), (e) => e instanceof RuosError && e.code === 'auth-expired');
  await assert.rejects(mk({ throws: new TypeError('fetch failed') }).callTool('desktop_exec', {}), (e) => e instanceof RuosError && e.code === 'network-down');
  const timeoutErr = Object.assign(new Error('t'), { name: 'TimeoutError' });
  await assert.rejects(mk({ throws: timeoutErr }).callTool('desktop_exec', {}), (e) => e instanceof RuosError && e.code === 'timeout');
  await assert.rejects(mk({ result: { isError: true, content: [{ type: 'text', text: 'machine is stopped' }] } }).callTool('desktop_exec', {}), (e) => e instanceof RuosError && e.code === 'desktop-stopped');
  await assert.rejects(mk({ status: 500 }).callTool('desktop_exec', {}), (e) => e instanceof RuosError && e.code === 'tool-error');
  // A failed handshake is retried on the next call instead of being cached.
  let n = 0;
  const flaky = new FleetMcpClient({ url: URL_, token: TOKEN, fetchImpl: async (u, i) => { if (n++ === 0) throw new TypeError('down'); return fakeFetch(() => ({ result: text({ desktops: [] }) })).f(u, i); } });
  await assert.rejects(flaky.callTool('desktop_status', {}));
  assert.deepEqual(await flaky.callTool('desktop_status', {}), { desktops: [] });
});

test('classifyToolError / parseRpcBody / normalizeDesktops edge cases', () => {
  assert.equal(classifyToolError('token expired').code, 'auth-expired');
  assert.equal(classifyToolError('machine not found').code, 'not-owned');
  assert.equal(classifyToolError('boom').code, 'tool-error');
  assert.throws(() => parseRpcBody('', 'text/event-stream'), RuosError);
  assert.deepEqual(normalizeDesktops(null), []);
});

test('ssh argv is fixed, no shell, executor port never used', () => {
  const argv = buildSshArgv({ keyPath: '/k', user: 'ruv', host: 'h', command: 'echo hi' });
  assert.deepEqual(argv.slice(0, 2), ['-p', '2222']);
  assert.equal(argv.at(-1), 'echo hi');
  assert.equal(argv.at(-3), '--');
  assert.ok(!argv.includes('17870'));
  assert.throws(() => buildSshArgv({ keyPath: '-oProxyCommand=x', user: 'ruv', host: 'h', command: 'c' }), RuosError);
  assert.throws(() => buildSshArgv({ keyPath: '/k', user: 'root;id', host: 'h', command: 'c' }), RuosError);
  assert.equal(sshHostFor(desktop(), 'ruos-desktop'), '85050dc77130e8.vm.ruos-desktop.internal');
  assert.throws(() => sshHostFor(desktop({ flyMachineId: null }), 'ruos-desktop'), RuosError);
  assert.throws(() => sshHostFor(desktop(), 'bad app;'), RuosError);
  assert.throws(() => createSshTransport({ keyPath: '' }), (e) => e instanceof RuosError && e.code === 'not-configured');
});

/**
 * @param {{ code?: number, stdout?: string, stderr?: string, hang?: boolean, error?: Error }} o
 */
function fakeSpawn(o) {
  /** @type {any[]} */
  const calls = [];
  const spawnImpl = /** @type {any} */ ((/** @type {string} */ cmd, /** @type {string[]} */ argv, /** @type {any} */ opts) => {
    calls.push({ cmd, argv, opts });
    const child = /** @type {any} */ (new EventEmitter());
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; };
    setImmediate(() => {
      if (o.error) return child.emit('error', o.error);
      if (o.hang) return;
      if (o.stdout) child.stdout.emit('data', Buffer.from(o.stdout));
      if (o.stderr) child.stderr.emit('data', Buffer.from(o.stderr));
      child.emit('close', o.code ?? 0);
    });
    return child;
  });
  return { spawnImpl, calls };
}

test('ssh transport: success, key refused, unreachable, timeout', async () => {
  const good = fakeSpawn({ stdout: 'RUOS_RUNNER_OK\n' });
  const t = createSshTransport({ keyPath: '/k', spawnImpl: good.spawnImpl });
  assert.equal((await t.exec(desktop(), 'echo', 5)).stdout, 'RUOS_RUNNER_OK\n');
  assert.equal(good.calls[0].cmd, 'ssh');
  assert.equal(good.calls[0].opts.shell, false);
  const denied = createSshTransport({ keyPath: '/k', spawnImpl: fakeSpawn({ code: 255, stderr: 'Permission denied (publickey).' }).spawnImpl });
  await assert.rejects(denied.exec(desktop(), 'x', 5), (e) => e instanceof RuosError && e.code === 'auth-expired');
  const down = createSshTransport({ keyPath: '/k', spawnImpl: fakeSpawn({ code: 255, stderr: 'Connection timed out' }).spawnImpl });
  await assert.rejects(down.exec(desktop(), 'x', 5), (e) => e instanceof RuosError && e.code === 'network-down');
  const noBin = createSshTransport({ keyPath: '/k', spawnImpl: fakeSpawn({ error: new Error('ENOENT') }).spawnImpl });
  await assert.rejects(noBin.exec(desktop(), 'x', 5), (e) => e instanceof RuosError && e.code === 'network-down');
  const hang = createSshTransport({ keyPath: '/k', spawnImpl: fakeSpawn({ hang: true }).spawnImpl });
  await assert.rejects(hang.exec(desktop(), 'x', 0.01), (e) => e instanceof RuosError && e.code === 'timeout');
  const remoteFail = createSshTransport({ keyPath: '/k', spawnImpl: fakeSpawn({ code: 3, stdout: 'RUOS_NORUN' }).spawnImpl });
  assert.equal((await remoteFail.exec(desktop(), 'x', 5)).exitCode, 3, 'remote exit codes pass through');
});
