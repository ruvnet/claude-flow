// @ts-check
/**
 * Requirements from the live E2E (2026-10-01) and the ruOS lane's design
 * rules: exec framing, jobs-API contract (ADR-105), no deletion tools,
 * credentials + redaction, Lite filtering, LLM route check, audit record.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FleetMcpClient, fleetConfigFromEnv, normalizeExec, normalizeDesktops, FORBIDDEN_TOOLS } from '../scripts/lib/fleet-mcp.mjs';
import { parseLaunch, parsePoll, parseStopped, buildLaunch, buildPoll, buildStop, buildPromptChunks, commandSha256 } from '../scripts/lib/command-builder.mjs';
import { createJobsApiTransport, createRestJobsBackend, createExecPollTransport } from '../scripts/lib/jobs.mjs';
import { RuosHostAdapter } from '../scripts/lib/adapter.mjs';
import { RuosError } from '../scripts/lib/types.mjs';
import { desktop, fakeClock, fakeFleet, fakeTransport, fakeLedger, ok, FLY_ID } from './fakes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RUN = 'r-0123456789abcdef0123456789abcdef';
const N = 'feedfacecafebeef';
const frame = (/** @type {string} */ cmd, /** @type {string} */ out) => ({
  status: 'ok', exitCode: 0, completionVerified: true,
  stdout: `▶ run: ${cmd}\n\n${out}\n\n✓ SUCCESS in 0s · 1 lines\n📝 transcript: /home/ruv/.ruos/activity/x.log\n`,
});

test('live framing: an echoed command containing marker text never false-matches', () => {
  const spec = { runId: RUN, prompt: 'x', runner: /** @type {'claude'} */ ('claude') };
  const launch = normalizeExec(frame(buildLaunch(spec, N), `RUOS${N}_SHA:${'a'.repeat(64)}\nRUOS${N}_PID:1995`));
  assert.deepEqual(parseLaunch(launch.stdout, N), { sha256: 'a'.repeat(64), pid: 1995, noRunner: false });
  const poll = normalizeExec(frame(buildPoll(RUN, 0, N), `RUOS${N}_POLL:0:22:0:UlVGTE9fUlVPU19MSVZFX09LIDQyCg==`));
  const p = parsePoll(poll.stdout, N);
  assert.ok(p !== 'norun' && p.chunk.toString() === 'RUFLO_RUOS_LIVE_OK 42\n');
  // Reproduce the live bug: the RAW echo (frame not stripped) of commands that
  // contain every marker name must not parse as a result.
  for (const cmd of [buildLaunch(spec, N), buildPoll(RUN, 0, N), buildStop(RUN, N)]) {
    const echoOnly = `▶ run: ${cmd}\n\n\n✓ SUCCESS in 0s · 0 lines`;
    assert.equal(parseLaunch(echoOnly, N).noRunner, false);
    assert.equal(parseLaunch(echoOnly, N).sha256, null);
    assert.equal(parseStopped(echoOnly, N), false);
    assert.throws(() => parsePoll(echoOnly, N), RuosError, 'NORUN in the echo must not read as norun');
  }
  // A marker line from a different command (other nonce) is ignored.
  assert.equal(parseStopped('RUOSaaaaaaaaaaaaaaaa_STOPPED', N), false);
  // A task output line that happens to say RUOS_STOPPED is not a marker.
  assert.equal(parseStopped('RUOS_STOPPED', N), false);
  const capped = normalizeExec({ stdout: '▶ run: seq\n\n0001 0002\n… [output truncated]\n', exitCode: 0 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.stdout.trim(), '0001 0002');
});

test('poll command + 2 KiB base64 slice fit the ~4 KiB head cap with the echo counted', () => {
  const cmd = buildPoll(RUN, 123456789, N);
  const echo = `▶ run: ${cmd}\n\n`;
  const payload = `RUOS${N}_POLL:-:999999999:1:${'A'.repeat(Math.ceil(2048 / 3) * 4)}\n`;
  assert.ok(Buffer.byteLength(echo + payload) < 4000, `${Buffer.byteLength(echo + payload)} bytes`);
});

/** In-memory jobs API that follows the ADR-105 contract. */
function jobsServer() {
  /** @type {Map<string, { owner: string, out: Buffer, state: string, exit: number|null, key: string }>} */
  const jobs = new Map();
  /** @type {any[]} */ const log = [];
  let capHits = 0;
  /** @type {typeof fetch} */
  const f = async (url, init) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    log.push({ method, path: u.pathname, search: u.search, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: /** @type {any} */ (init?.headers)?.authorization });
    const json = (/** @type {number} */ status, /** @type {unknown} */ b) => new Response(JSON.stringify(b), { status });
    if (u.pathname === '/api/v1/desktop/jobs' && method === 'GET') return json(200, { jobs: [...jobs.keys()] });
    if (u.pathname === '/api/v1/desktop/jobs' && method === 'POST') {
      if (capHits-- > 0) return json(429, { error: 'concurrency cap' });
      const b = JSON.parse(String(init?.body));
      for (const [id, j] of jobs) if (j.key === b.idempotency_key) return json(200, { job_id: id });
      const id = `job_${jobs.size + 1}`;
      jobs.set(id, { owner: 'me', out: Buffer.from('hello from the jobs api\n'), state: 'running', exit: null, key: b.idempotency_key });
      return json(200, { job_id: id });
    }
    const id = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    const j = jobs.get(id);
    if (!j || j.owner !== 'me') return json(404, { error: 'not found' });
    if (method === 'DELETE') { j.state = 'cancelled'; return json(200, {}); }
    const off = Number(u.searchParams.get('offset'));
    const chunk = j.out.subarray(off, off + Number(u.searchParams.get('max')));
    if (off + chunk.length >= j.out.length && j.state === 'running') { j.state = 'exited'; j.exit = 0; }
    return json(200, { chunk: chunk.toString('base64'), next_offset: off + chunk.length, running: j.state === 'running', state: j.state, exit_code: j.exit, truncated: false });
  };
  return { f, log, jobs, setCapHits: (/** @type {number} */ n) => { capHits = n; }, foreign: (/** @type {string} */ id) => jobs.set(id, { owner: 'other', out: Buffer.alloc(0), state: 'running', exit: null, key: 'x' }) };
}

const staging = () => fakeTransport((cmd) => ok(cmd.includes('RUOS%s_PREPARED') ? 'RUOS_PREPARED' : ''));

test('jobs API transport: start with idempotency key, stream to exit, audit, through the adapter', async () => {
  const srv = jobsServer();
  srv.setCapHits(1); // first create hits the per-tenant cap → adapter backs off
  const backend = createRestJobsBackend({ baseUrl: 'https://fleet.example.test', token: 'tok', fetchImpl: srv.f });
  assert.equal(await backend.detect(FLY_ID), true);
  const clock = fakeClock();
  const ledger = fakeLedger();
  const adapter = new RuosHostAdapter({
    fleet: fakeFleet([desktop({ heartbeatAt: Math.floor(clock.now() / 1000) })]),
    jobs: createJobsApiTransport(backend, staging()),
    ledger: /** @type {any} */ (ledger), now: clock.now, sleep: clock.sleep,
  });
  /** @type {string[]} */ const seen = [];
  const out = await adapter.run({ desktop: 'Work Desktop', prompt: 'secret task text', runId: RUN, agentId: 'a1', timeoutSecs: 600, onOutput: (c) => seen.push(c.toString()) });
  assert.equal(out.status, 'completed');
  assert.equal(out.jobs, 'jobs-api');
  assert.equal(seen.join(''), 'hello from the jobs api\n');
  const creates = srv.log.filter((r) => r.method === 'POST');
  assert.equal(creates.length, 2, 'one capped attempt, one retry');
  assert.deepEqual(Object.keys(creates[1].body).sort(), ['command', 'idempotency_key', 'machine', 'timeout_secs']);
  assert.equal(creates[1].body.idempotency_key, RUN);
  assert.equal(creates[1].body.machine, FLY_ID);
  assert.ok(!JSON.stringify(creates).includes('secret task text'), 'prompt never in the job command');
  assert.ok(ledger.warnings.some((w) => w.includes('concurrency cap')));
  // Audit record: hash of the launched command, no prompt text.
  assert.equal(ledger.audits.length, 1);
  assert.match(ledger.audits[0].commandSha256, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(ledger.audits).includes('secret task text'));
});

test('jobs API: another tenant\'s id is 404 → not-owned, never retried', async () => {
  const srv = jobsServer();
  srv.foreign('job_other');
  const t = createJobsApiTransport(createRestJobsBackend({ baseUrl: 'https://fleet.example.test', token: 'tok', fetchImpl: srv.f }), staging());
  const before = srv.log.length;
  await assert.rejects(t.poll(desktop(), 'job_other', 0), (e) => e instanceof RuosError && e.code === 'not-owned');
  assert.equal(srv.log.length - before, 1, 'exactly one request');
});

test('jobs API: states map; a stopped desktop is resumable, not a silent success', async () => {
  const backend = {
    create: async () => ({ job_id: 'j1' }),
    read: async () => ({ chunk: '', next_offset: 0, running: false, state: 'stopped', exit_code: null, truncated: false }),
    cancel: async () => {},
    list: async () => [],
  };
  const clock = fakeClock();
  const adapter = new RuosHostAdapter({ fleet: fakeFleet([desktop({ heartbeatAt: Math.floor(clock.now() / 1000) })]), jobs: createJobsApiTransport(backend, staging()), ledger: /** @type {any} */ (fakeLedger()), now: clock.now, sleep: clock.sleep });
  await assert.rejects(adapter.run({ desktop: 'Work Desktop', prompt: 'x', runId: RUN, agentId: 'a1' }), (e) => e instanceof RuosError && e.code === 'auto-stopped' && /attach/.test(e.message));
  const missing = createRestJobsBackend({ baseUrl: 'https://fleet.example.test', token: 'tok', fetchImpl: async () => new Response('', { status: 404 }) });
  assert.equal(await missing.detect(FLY_ID), false, 'jobs API not deployed → fall back to exec-poll');
});

test('no code path issues desktop_delete or secret_delete', async () => {
  // Runtime guard: refused before any network request.
  let fetched = false;
  const c = new FleetMcpClient({ url: 'https://fleet.example.test/mcp', token: 'tok', fetchImpl: async () => { fetched = true; return new Response('{}'); } });
  for (const name of FORBIDDEN_TOOLS) await assert.rejects(c.callTool(name, {}), RuosError);
  assert.equal(fetched, false);
  // Static guard: the names appear only in the FORBIDDEN_TOOLS definition.
  const root = join(here, '..');
  /** @param {string} d @returns {string[]} */
  const walk = (d) => readdirSync(d).filter((n) => !n.startsWith('.') || n === '.claude-plugin').flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const file of walk(root).filter((p) => !p.includes(`${join(root, 'tests')}`) && /\.(mjs|ts|md|sh|json)$/.test(p))) {
    const text = readFileSync(file, 'utf8');
    for (const name of FORBIDDEN_TOOLS) {
      const hits = text.split('\n').filter((l) => l.includes(name) && !l.includes('FORBIDDEN_TOOLS = ') && !/never|human/i.test(l));
      assert.deepEqual(hits, [], `${file} mentions ${name}`);
    }
  }
});

test('credentials: env first, then @cognitum/ruos file; token never echoed', async () => {
  assert.equal(fleetConfigFromEnv({ RUOS_MCP_URL: 'https://a/mcp', RUOS_MCP_TOKEN: 't' }, () => { throw new Error('no'); }).source, 'env');
  const fromFile = fleetConfigFromEnv({ HOME: '/home/u' }, (p) => { assert.equal(p, '/home/u/.config/ruos/credentials.json'); return JSON.stringify({ access_token: 'oauth-tok' }); });
  assert.deepEqual(fromFile, { url: 'https://ruos.cognitum.one/mcp', token: 'oauth-tok', source: 'credentials-file' });
  assert.equal(fleetConfigFromEnv({ HOME: '/home/u' }, () => { throw new Error('ENOENT'); }).source, 'none');
  const token = 'ruos_mcp_SUPERSECRET123';
  const c = new FleetMcpClient({ url: 'https://fleet.example.test/mcp', token, fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: `bad token ${token}` } }), { status: 200 }) });
  await assert.rejects(c.callTool('desktop_status', {}), (e) => e instanceof Error && !e.message.includes(token) && e.message.includes('[redacted]'));
});

test('Lite browsers are never host candidates', () => {
  const raw = {
    desktops: [{ machine_id: 'a'.repeat(32), fly_machine_id: 'b'.repeat(14), name: 'w' }],
    lite_browsers: [{ machine_id: 'lite-2be6c1bd3e06f05ae8da5f470e4737c3', kind: 'lite_browser', state: 'running' }],
  };
  assert.deepEqual(normalizeDesktops(raw).map((d) => d.id), ['a'.repeat(32)]);
  assert.deepEqual(normalizeDesktops({ desktops: [{ machine_id: 'c'.repeat(32), kind: 'lite_browser' }] }), []);
});

test('LLM route: no route fails fast before any exec; unconfigured gateway only warns', async () => {
  const clock = fakeClock();
  const t = fakeTransport(() => ok(''));
  const fleet = fakeFleet([desktop({ heartbeatAt: Math.floor(clock.now() / 1000) })]);
  fleet.llmRoute = async () => ({ route: null, provider: null, gateway: null, keyPresent: false });
  const adapter = new RuosHostAdapter({ fleet, jobs: createExecPollTransport(t), ledger: /** @type {any} */ (fakeLedger()), now: clock.now, sleep: clock.sleep });
  await assert.rejects(adapter.run({ desktop: 'Work Desktop', prompt: 'x', runId: RUN, agentId: 'a1' }), (e) => e instanceof RuosError && e.code === 'llm-unconfigured');
  assert.equal(t.commands.length, 0);

  const sha = buildPromptChunks(RUN, 'x').sha256;
  const t2 = fakeTransport((cmd) => {
    if (cmd.includes('RUOS%s_NO_RUNNER')) return ok(`RUOS_SHA:${sha}\nRUOS_PID:1`);
    if (cmd.includes('RUOS%s_POLL')) return ok('RUOS_POLL:0:0:0:');
    return ok('RUOS_PREPARED');
  });
  const ledger = fakeLedger();
  const a2 = new RuosHostAdapter({ fleet: fakeFleet([desktop({ heartbeatAt: Math.floor(clock.now() / 1000) })]), jobs: createExecPollTransport(t2, () => N), ledger: /** @type {any} */ (ledger), now: clock.now, sleep: clock.sleep });
  const out = await a2.run({ desktop: 'Work Desktop', prompt: 'x', runId: RUN, agentId: 'a1' });
  assert.equal(out.status, 'completed');
  assert.ok(out.warnings.some((w) => w.includes('shared route')), 'live-observed shape: gateway unconfigured, route shared → warn, not fail');
  assert.equal(ledger.audits[0].commandSha256, commandSha256(buildLaunch({ runId: RUN, prompt: 'x', runner: 'claude' }, N).split(N).join('<nonce>')), 'nonce-masked, stable hash');
});

/**
 * Mock of the LIVE ruos-desktop ADR-105 contract (fleet 64261be), exact codes:
 * POST 202 new / 200 idempotent_replay / 409 same key + different request /
 * 429 cap; GET 503 once (desktop up, poll unanswered), queued with running:true,
 * wait_ms honoured; 404 for another tenant's id.
 */
function adr105Server() {
  /** @type {Map<string, { body: any, out: Buffer, state: string, exit: number|null, polls: number }>} */
  const byKey = new Map();
  /** @type {any[]} */ const log = [];
  let cap = 0;
  let unanswered = 0;
  /** @type {typeof fetch} */
  const f = async (url, init) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    log.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body });
    const json = (/** @type {number} */ status, /** @type {unknown} */ b) => new Response(JSON.stringify(b), { status });
    if (u.pathname === '/api/v1/desktop/jobs' && method === 'POST') {
      if (!body.idempotency_key) return json(400, { error: 'idempotency_key required' });
      if (String(body.machine).startsWith('lite-')) return json(400, { error: 'Lite browsers have no shell' });
      const prev = byKey.get(body.idempotency_key);
      if (prev) {
        return JSON.stringify(prev.body) === JSON.stringify(body)
          ? json(200, { job_id: `job_${body.idempotency_key.slice(2, 10)}`, state: prev.state, idempotent_replay: true })
          : json(409, { error: 'idempotency key reused with a different request' });
      }
      if (cap-- > 0) return json(429, { error: 'concurrency cap' });
      byKey.set(body.idempotency_key, { body, out: Buffer.from('exit three\n'), state: 'queued', exit: null, polls: 0 });
      return json(202, { job_id: `job_${body.idempotency_key.slice(2, 10)}`, state: 'queued' });
    }
    if (u.pathname === '/api/v1/desktop/jobs' && method === 'GET') return json(200, { jobs: [] });
    const id = u.pathname.split('/').pop() ?? '';
    const job = [...byKey.entries()].find(([k]) => `job_${k.slice(2, 10)}` === id)?.[1];
    if (!job) return json(404, { error: 'not found' });
    if (method === 'DELETE') { job.state = 'cancelled'; job.exit = 143; return json(200, { job_id: id, state: 'cancelled' }); }
    if (unanswered-- > 0) return new Response('', { status: 503 });
    if (job.state === 'cancelled') {
      const off = Number(u.searchParams.get('offset'));
      const chunk = job.out.subarray(off);
      return json(200, { chunk: chunk.toString('base64'), next_offset: off + chunk.length, running: false, state: 'cancelled', exit_code: 143, truncated: false, desktop: 'up' });
    }
    job.polls++;
    if (job.polls === 1) return json(200, { chunk: '', next_offset: 0, running: true, state: 'queued', exit_code: null, truncated: false, desktop: 'up' });
    const off = Number(u.searchParams.get('offset'));
    const chunk = job.out.subarray(off);
    job.state = 'exited'; job.exit = 3; // `exited` carries ANY exit code
    return json(200, { chunk: chunk.toString('base64'), next_offset: off + chunk.length, running: false, state: 'exited', exit_code: 3, truncated: false, desktop: 'up', stop_at: '2026-10-02T03:00:00.000Z' });
  };
  return { f, log, setCap: (/** @type {number} */ n) => { cap = n; }, setUnanswered: (/** @type {number} */ n) => { unanswered = n; } };
}

test('ADR-105 live contract: 202, 200 replay, 409, 429, 503, queued, exited≠0, wait_ms', async () => {
  const srv = adr105Server();
  /** @type {number[]} */ const backoffs = [];
  const backend = createRestJobsBackend({ baseUrl: 'https://ruos.cognitum.one', token: 'tok', fetchImpl: srv.f, sleep: async (ms) => { backoffs.push(ms); } });
  const body = { machine: FLY_ID, command: 'x', timeout_secs: 60, idempotency_key: RUN };
  const created = await backend.create(body);
  assert.match(created.job_id, /^job_/);
  const replay = await backend.create(body);
  assert.equal(replay.job_id, created.job_id, '200 replay reuses the job id');
  assert.equal(replay.idempotent_replay, true);
  const before = srv.log.length;
  await assert.rejects(backend.create({ ...body, command: 'different' }), (e) => e instanceof RuosError && e.code === 'invalid-input' && /client bug/.test(e.message));
  assert.equal(srv.log.length - before, 1, '409 is never retried');
  srv.setCap(1);
  await assert.rejects(backend.create({ ...body, idempotency_key: 'r-ffffffffffffffffffffffffffffffff' }), (e) => e instanceof RuosError && e.code === 'capacity');
  srv.setUnanswered(2);
  const first = await backend.read(created.job_id, 0, 65536, 20000);
  assert.deepEqual(backoffs, [1000, 2000], '503 retried with backoff');
  assert.equal(first.state, 'queued');
  assert.equal(first.running, true, 'running is true while queued');
  const getLog = srv.log.filter((r) => r.method === 'GET' && r.path.includes('/jobs/')).at(-1);
  assert.equal(getLog.query.wait_ms, '20000');
  assert.equal(getLog.query.max, '65536');
});

test('ADR-105 through the adapter: queued → exited with exit 3 is failed, not completed; 429 backs off', async () => {
  const srv = adr105Server();
  srv.setCap(1);
  const clock = fakeClock();
  const backend = createRestJobsBackend({ baseUrl: 'https://ruos.cognitum.one', token: 'tok', fetchImpl: srv.f, sleep: clock.sleep });
  const ledger = fakeLedger();
  const adapter = new RuosHostAdapter({
    fleet: fakeFleet([desktop({ heartbeatAt: Math.floor(clock.now() / 1000) })]),
    jobs: createJobsApiTransport(backend, staging(), () => N),
    ledger: /** @type {any} */ (ledger), now: clock.now, sleep: clock.sleep,
  });
  /** @type {string[]} */ const seen = [];
  const out = await adapter.run({ desktop: 'Work Desktop', prompt: 'p', runId: RUN, agentId: 'a1', timeoutSecs: 900, onOutput: (c) => seen.push(c.toString()) });
  assert.equal(out.status, 'failed', '`exited` with exit_code 3');
  assert.equal(out.exitCode, 3);
  assert.equal(seen.join(''), 'exit three\n');
  assert.equal(srv.log.filter((r) => r.method === 'POST').length, 2, 'one 429, one accepted create');
  assert.equal(srv.log.find((r) => r.method === 'POST' && r.body)?.body.timeout_secs, 900);
});

test('ADR-105: timeout_secs above 21600 is clamped client-side, never refused', async () => {
  const srv = adr105Server();
  const t = createJobsApiTransport(createRestJobsBackend({ baseUrl: 'https://ruos.cognitum.one', token: 'tok', fetchImpl: srv.f }), staging(), () => N);
  await t.start(desktop(), { runId: RUN, prompt: 'p', runner: 'claude', timeoutSecs: 30000 });
  assert.equal(srv.log.find((r) => r.method === 'POST')?.body.timeout_secs, 21600);
});

test('ADR-105: a Lite target is 400 → invalid-input, never retried', async () => {
  const srv = adr105Server();
  const backend = createRestJobsBackend({ baseUrl: 'https://ruos.cognitum.one', token: 'tok', fetchImpl: srv.f });
  await assert.rejects(backend.create({ machine: 'lite-2be6c1bd3e06f05ae8da5f470e4737c3', command: 'x', timeout_secs: 60, idempotency_key: RUN }),
    (e) => e instanceof RuosError && e.code === 'invalid-input');
  assert.equal(srv.log.filter((r) => r.method === 'POST').length, 1);
});

test('ADR-105: cancel → 200, job ends cancelled with exit 143, output before the cancel kept, reported as stopped', async () => {
  const srv = adr105Server();
  const clock = fakeClock();
  const backend = createRestJobsBackend({ baseUrl: 'https://ruos.cognitum.one', token: 'tok', fetchImpl: srv.f, sleep: clock.sleep });
  const ledger = fakeLedger();
  const adapter = new RuosHostAdapter({
    fleet: fakeFleet([desktop({ heartbeatAt: Math.floor(clock.now() / 1000) })]),
    jobs: createJobsApiTransport(backend, staging(), () => N),
    ledger: /** @type {any} */ (ledger), now: clock.now, sleep: clock.sleep,
  });
  const ac = new AbortController();
  ac.abort(); // cancel right after the first (queued) poll
  /** @type {string[]} */ const seen = [];
  const out = await adapter.run({ desktop: 'Work Desktop', prompt: 'p', runId: RUN, agentId: 'a1', signal: ac.signal, onOutput: (c) => seen.push(c.toString()) });
  assert.equal(out.status, 'stopped', 'cancelled is a stop, not a failure');
  assert.equal(out.exitCode, 143);
  assert.equal(seen.join(''), 'exit three\n', 'output written before the cancel is kept');
  assert.equal(srv.log.filter((r) => r.method === 'DELETE').length, 1);
  assert.equal(ledger.events.at(-1).type, 'run.stopped');
});
