/**
 * ADR-476 end-to-end: the real dispatchers classify real callers.
 *
 *  - bin/mcp-server.js (what Claude Code launches) and `mcp start -t stdio`
 *    are LOCAL: init/spawn/broadcast/shutdown work with no credential.
 *  - `mcp start -t http` is REMOTE: the same calls are refused until the
 *    operator secret is supplied, and the token never appears in a response.
 *
 * Needs the built CLI (like mcp-http-protocol-tools-2990.test.ts).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(HERE, '..', 'bin');
const DIST = path.resolve(HERE, '..', 'dist', 'src', 'index.js');
// The HTTP transport needs the built @claude-flow/mcp package. The root CI
// `Test Suite` job does not build it (mcp-http-foreground-2984 and friends
// fail there for the same reason and sit in the ratchet baseline), so the HTTP
// case runs wherever the package is built and is skipped, not failed, elsewhere.
const MCP_BUILT = (() => {
  try {
    return fs.existsSync(createRequire(import.meta.url).resolve('@claude-flow/mcp'));
  } catch {
    return false;
  }
})();
const SECRET = 'operator-secret-for-e2e-0123456789';

let child: ChildProcessWithoutNullStreams | undefined;
let dir: string;

beforeAll(() => {
  if (!fs.existsSync(DIST)) throw new Error(`Built CLI required for end-to-end coverage: ${DIST}`);
});
afterEach(() => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  child = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-e2e-'));
  // The HTTP server's pid file lives in os.tmpdir() and is machine-wide, so a
  // concurrent server from another test file (mcp-http-protocol-tools-2990)
  // makes `mcp start` exit 1 ("already running"). Give this run its own tmpdir.
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  return {
    ...process.env,
    CLAUDE_FLOW_CWD: dir,
    CLAUDE_FLOW_MCP_TOOLS: 'all',
    RUFLO_DAEMON_AUTOSTART: '0',
    TMPDIR: tmp,
    TEMP: tmp,
    TMP: tmp,
    ...extra,
  };
}

/** Minimal newline-delimited JSON-RPC client over stdio. */
function stdioClient(args: string[], e: NodeJS.ProcessEnv) {
  child = spawn('node', args, { cwd: dir, env: e, stdio: ['pipe', 'pipe', 'pipe'] });
  const proc = child;
  let buf = '';
  const waiters = new Map<number, (m: any) => void>();
  proc.stdout.on('data', (c: Buffer) => {
    buf += c.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); waiters.get(m.id)?.(m); } catch { /* not a frame */ }
    }
  });
  let id = 0;
  const rpc = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const n = ++id;
      const t = setTimeout(() => reject(new Error(`timeout on ${method}`)), 20_000);
      waiters.set(n, (m) => { clearTimeout(t); resolve(m); });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  return {
    async ready() {
      await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
    },
    async call(name: string, args: Record<string, unknown> = {}) {
      const r = await rpc('tools/call', { name, arguments: args });
      return JSON.parse(r.result.content[0].text);
    },
  };
}

describe('hive-mind gate end to end (ADR-476)', () => {
  for (const [label, args] of [
    ['bin/mcp-server.js (Claude Code stdio entry)', [path.join(BIN, 'mcp-server.js')]],
    ['cli.js mcp start -t stdio', [path.join(BIN, 'cli.js'), 'mcp', 'start', '-t', 'stdio']],
  ] as Array<[string, string[]]>) {
    it(`${label}: a local stdio client runs the whole hive lifecycle with no credential and is never handed the token`, async () => {
      const c = stdioClient(args, env());
      await c.ready();
      const init = await c.call('hive-mind_init', {});
      expect(init.success).toBe(true);
      expect(init.hiveToken).toBeUndefined();
      expect((await c.call('hive-mind_spawn', { count: 1 })).success).toBe(true);
      expect((await c.call('hive-mind_broadcast', { message: 'hello' })).success).toBe(true);
      expect((await c.call('hive-mind_memory', { action: 'set', key: 'k', value: 1 })).success).toBe(true);
      expect((await c.call('hive-mind_shutdown', { force: true })).success).toBe(true);

      const hiveDir = path.join(dir, '.claude-flow', 'hive-mind');
      const token = JSON.parse(fs.readFileSync(path.join(hiveDir, 'state.json'), 'utf-8')).hiveToken;
      expect(JSON.stringify(init)).not.toContain(token);
      if (process.platform !== 'win32') {
        expect(fs.statSync(path.join(hiveDir, 'state.json')).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.join(hiveDir, 'bootstrap.secret')).mode & 0o777).toBe(0o600);
      }
    }, 60_000);
  }

  it('RUFLO_HIVE_REQUIRE_AUTH=1 makes the stdio server demand the operator secret', async () => {
    const c = stdioClient([path.join(BIN, 'mcp-server.js')], env({ RUFLO_HIVE_REQUIRE_AUTH: '1', RUFLO_HIVE_BOOTSTRAP_SECRET: SECRET }));
    await c.ready();
    expect((await c.call('hive-mind_init', {})).success).toBe(false);
    expect((await c.call('hive-mind_init', { bootstrapSecret: SECRET })).success).toBe(true);
  }, 60_000);

  it.skipIf(!MCP_BUILT)('the HTTP server refuses every gated call without the operator secret, then accepts it', async () => {
    // CI builds dist/ concurrently with other test files (integration-docker runs
    // `npm run build`), so a cold server start can hit a half-written dist and
    // exit before binding. Retry a few times on an early exit; a real failure
    // (the assertions below) is never retried.
    let port = 0;
    let lastFailure = '';
    for (let attempt = 1; attempt <= 4 && !port; attempt++) {
      const candidate = 34000 + Math.floor(Math.random() * 4000);
      const e = env({ RUFLO_HIVE_BOOTSTRAP_SECRET: SECRET });
      child = spawn('node', [path.join(BIN, 'cli.js'), 'mcp', 'start', '-t', 'http', '--port', String(candidate)], {
        cwd: dir, env: e, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const started = await new Promise<string | null>((resolve) => {
        let out = '';
        let err = '';
        const t = setTimeout(() => resolve(`start timeout\nstdout: ${out}\nstderr: ${err}`), 20_000);
        child!.stdout.on('data', (c: Buffer) => { out += c.toString(); if (out.includes('MCP Server started')) { clearTimeout(t); resolve(null); } });
        child!.stderr.on('data', (c: Buffer) => { err += c.toString(); });
        child!.once('exit', (code) => { clearTimeout(t); resolve(`exited ${code}\nstdout: ${out}\nstderr: ${err}`); });
      });
      if (started === null) { port = candidate; break; }
      lastFailure = started;
      if (child.exitCode === null) child.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!port) throw new Error(`HTTP server never started after 4 attempts. Last failure: ${lastFailure}`);
    let id = 0;
    const post = async (body: unknown) => (await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })).json() as Promise<any>;
    await post({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await post({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
      return JSON.parse(r.result.content[0].text);
    };

    const denied = await call('hive-mind_init', {});
    expect(denied.success).toBe(false);
    expect(denied.hiveToken).toBeUndefined();
    expect(fs.existsSync(path.join(dir, '.claude-flow', 'hive-mind', 'state.json'))).toBe(false);
    expect((await call('hive-mind_init', { bootstrapSecret: 'wrong-wrong-wrong-wrong' })).success).toBe(false);

    const init = await call('hive-mind_init', { bootstrapSecret: SECRET });
    expect(init.success).toBe(true);
    expect(init.hiveToken).toBeUndefined();

    expect((await call('hive-mind_spawn', { count: 1 })).success).toBe(false);
    expect((await call('hive-mind_broadcast', { message: 'x' })).success).toBe(false);
    expect((await call('hive-mind_shutdown', { force: true })).success).toBe(false);
    expect((await call('hive-mind_consensus', { action: 'propose', type: 't', value: 1 })).error).toBeTruthy();
    expect((await call('hive-mind_memory', { action: 'set', key: 'k', value: 1 })).error).toBeTruthy();

    expect((await call('hive-mind_spawn', { count: 1, bootstrapSecret: SECRET })).success).toBe(true);
    expect((await call('hive-mind_shutdown', { force: true, bootstrapSecret: SECRET })).success).toBe(true);
  }, 150_000);
});
