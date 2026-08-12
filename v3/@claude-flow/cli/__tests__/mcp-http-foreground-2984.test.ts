// #2984: `ruflo mcp start -t http` printed a full "Status: Running" success
// table — PID, health/RPC URLs — then exited with code 0 within seconds,
// without ever binding the port. Root cause: bin/cli.js's "normal CLI mode"
// branch (which `-t http` always takes, since it disqualifies the implicit
// piped-stdin MCP auto-detect) unconditionally exits the process once the
// dispatched command's action() promise resolves (#1552). mcp.ts's `start`
// action returned normally right after printing the table, so the freshly
// bound http.Server was torn down within milliseconds of the printed
// success claim — `lsof`/`curl` against the advertised port both showed
// nothing was ever actually listening.
//
// This is an end-to-end guard: it spawns the built CLI exactly like the bug
// report, confirms the port is actually accepting connections *after* the
// success table prints (not just that the table printed), and confirms
// SIGTERM still produces a clean shutdown (proving the fix blocks forever
// rather than hanging unkillably).
//
// Skipped when the CLI has not been built (`bin/cli.js` absent) — same
// convention as memory-search-recall-2558.test.ts.

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createConnection } from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'cli.js');
const CLI_BUILT = fs.existsSync(CLI);

let child: ChildProcessWithoutNullStreams | undefined;

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  child = undefined;
});

function waitForOutput(proc: ChildProcessWithoutNullStreams, match: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${match}" in: ${buf}`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      if (buf.includes(match)) {
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
  });
}

function tcpConnects(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

describe.skipIf(!CLI_BUILT)('mcp start -t http stays running (#2984, end-to-end)', () => {
  it('keeps the process alive and the port actually bound after printing success, then exits cleanly on SIGTERM', async () => {
    const port = 39000 + Math.floor(Math.random() * 5000);
    const host = '127.0.0.1';

    child = spawn('node', [CLI, 'mcp', 'start', '-t', 'http', '--port', String(port), '--host', host], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitForOutput(child, 'MCP Server started', 20_000);

    // Give the event loop a moment past the point where the pre-fix code
    // would have already called process.exit(0).
    await new Promise((r) => setTimeout(r, 1500));

    expect(child.exitCode, 'process exited early instead of staying in the foreground').toBeNull();

    const connected = await tcpConnects(port, host, 3000);
    expect(connected, `nothing was listening on ${host}:${port} — the server was torn down`).toBe(true);

    // Graceful shutdown must still work — this isn't supposed to hang forever uncontrollably.
    const exited = new Promise<number | null>((resolve) => {
      child!.once('exit', (code) => resolve(code));
    });
    child.kill('SIGTERM');
    const code = await Promise.race([
      exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000)),
    ]);
    expect(code, 'process did not exit within 5s of SIGTERM').not.toBe('timeout');
    expect(code).toBe(0);
  }, 30_000);
});
