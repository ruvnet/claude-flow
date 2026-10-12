// #3364: `mcp start` on the stdio transport SIGKILLed whichever MCP server was
// recorded in the per-user PID file ($TMPDIR/claude-flow-mcp.pid): another
// stdio server started from a terminal, or a running http/websocket server.
// commands/mcp.ts forced a "restart" for stdio (`shouldForceRestart = force ||
// transport === 'stdio'`) because a stdio server can't be health-checked, and
// MCPServerManager.start() refused to start next to any live recorded PID.
// This path runs whenever `mcp start` goes through the command parser: stdin is
// a TTY (a terminal), or argv does not begin with `mcp [start]` (a leading
// global flag, e.g. `-Q mcp start`), or the transport is http/websocket.
// bin/cli.js answers the documented piped-stdin `mcp start` from its inline
// fast path, which never reads the file.
//
// A stdio server is owned by the client that spawned it, over that client's own
// pipes, so any number can run side by side. The single-instance PID file only
// makes sense for a port-bound transport. These tests pin both halves:
//   1. commands/mcp.ts — stdio start never kills or clears a recorded server
//      unless --force is given; http keeps its "already running" guard.
//   2. MCPServerManager — a stdio server neither refuses to start over, nor
//      overwrites, nor removes, nor health-checks the PID file of another
//      server. The fix keys on transport, so it covers every route above.
//
// Review round 2 (@ruvnet, 2026-09-20). The first round kept a one-way
// "has served stdio" flag so a second stop() could not delete another
// server's record, and that flag outlived the server it described: after
// start -> stop, status still said running and health still said healthy.
// The flag is now the manager's live lifecycle, and the PID record carries
// durable instance identity (host, OS, Linux PID namespace and kernel boot,
// and the owner's process start time) instead of a bare PID. Blocks 3-6
// below cover the four things that review asked for: start -> stop ->
// independent status/health denial, concurrent ownership, PID reuse and
// non-owned processes, and the Windows lifecycle.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const h = vi.hoisted(() => ({
  status: {} as Record<string, unknown>,
  manager: {
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(async () => {}),
    checkHealth: vi.fn(async () => ({ healthy: true })),
  },
}));

// Command-level tests drive commands/mcp.ts against a fake manager. The real
// MCPServerManager is loaded with vi.importActual in the second block.
vi.mock('../src/mcp-server.js', () => ({
  MCPServerManager: class {},
  createMCPServerManager: vi.fn(),
  getServerManager: vi.fn(() => h.manager),
  startMCPServer: vi.fn(),
  stopMCPServer: vi.fn(),
  getMCPServerStatus: vi.fn(async () => h.status),
  filterAdvertisedMcpTools: (tools: unknown[]) => tools,
  parseMcpToolSelection: () => 'all',
  resolveMcpHttpAuthToken: () => undefined,
  isLoopbackHost: () => true,
}));

// mcp-client.js pulls in the full tool registry; the start path never needs it.
vi.mock('../src/mcp-client.js', () => ({
  listMCPTools: () => [],
  callMCPTool: vi.fn(),
  hasTool: vi.fn(),
  getToolMetadata: vi.fn(),
}));

vi.mock('../src/runtime/parent-death-watchdog.js', () => ({ installParentDeathWatchdog: vi.fn() }));
vi.mock('../src/prompt.js', () => ({ select: vi.fn(), confirm: vi.fn() }));
vi.mock('../src/output.js', () => ({
  output: {
    writeln: vi.fn(),
    printInfo: vi.fn(),
    printWarning: vi.fn(),
    printError: vi.fn(),
    printSuccess: vi.fn(),
    printTable: vi.fn(),
    dim: (value: string) => value,
    success: (value: string) => value,
    bold: (value: string) => value,
  },
}));

import { mcpCommand } from '../src/commands/mcp.js';

// A real, live node process standing in for the other server: the manager's
// isProcessRunning() checks both `kill -0` and that the PID is a node process.
let sibling: ChildProcess;
beforeAll(() => {
  sibling = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
});
afterAll(() => {
  sibling.kill('SIGKILL');
});
const siblingAlive = () => sibling.exitCode === null && sibling.signalCode === null;

// The two Linux identity fields, read exactly as src/mcp-server.ts reads them,
// so `record()` below builds a record this host would accept. Both are
// undefined off Linux, where JSON.stringify drops them — and the manager
// compares undefined to undefined, so the record still matches.
const readOrUndefined = (read: () => string): string | undefined => {
  try {
    return read();
  } catch {
    return undefined;
  }
};
const PID_NAMESPACE = readOrUndefined(() => fs.readlinkSync('/proc/self/ns/pid'));
const BOOT_ID = readOrUndefined(() =>
  fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
);

/** A PID record as src/mcp-server.ts writes it: bare PID, then the identity. */
const record = (pid: number, identity: Record<string, unknown> = {}): string =>
  `${pid}\n${JSON.stringify({
    v: 1,
    pid,
    host: os.hostname(),
    platform: process.platform,
    pidns: PID_NAMESPACE,
    boot: BOOT_ID,
    transport: 'http',
    port: 3000,
    ...identity,
  })}\n`;

describe('mcp start: stdio never kills a recorded server (#3364)', () => {
  const start = mcpCommand.subcommands!.find((command) => command.name === 'start')!;
  const run = (flags: Record<string, unknown>) =>
    start.action!({ args: [], flags, interactive: false } as never);
  let kill: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    h.status = { running: true, pid: sibling.pid, transport: 'stdio' };
    // A successful start blocks forever (#2984), so park it inside
    // manager.start(): every kill/cleanup decision is made before that.
    h.manager.start.mockReset().mockImplementation(() => new Promise(() => {}));
    h.manager.stop.mockClear();
    h.manager.checkHealth.mockReset().mockResolvedValue({ healthy: true });
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });
  afterEach(() => {
    kill.mockRestore();
  });

  it('starts next to a running server without signalling it or clearing its PID file', async () => {
    void run({ transport: 'stdio' });
    await vi.waitFor(() => expect(h.manager.start).toHaveBeenCalled());

    expect(kill).not.toHaveBeenCalled();
    expect(h.manager.stop).not.toHaveBeenCalled();
  });

  it('still kills the recorded server when --force is given (explicit opt-in)', async () => {
    void run({ transport: 'stdio', force: true });
    await vi.waitFor(() => expect(h.manager.start).toHaveBeenCalled());

    expect(kill).toHaveBeenCalledWith(sibling.pid, 'SIGKILL');
    expect(h.manager.stop).toHaveBeenCalled();
  });

  it('keeps the single-instance guard for http: refuses while the recorded server is healthy', async () => {
    const result = await run({ transport: 'http' });

    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(kill).not.toHaveBeenCalled();
    expect(h.manager.start).not.toHaveBeenCalled();
  });
});

type Manager = import('../src/mcp-server.js').MCPServerManager;

/**
 * Per-test harness for the real MCPServerManager: a throwaway PID-file
 * directory, stubbed transports (the stdin hooks and the http listener are out
 * of scope), and managers that are stopped and cleaned up afterwards.
 */
function useManagerHarness() {
  const managers: Manager[] = [];
  const originalCwdEnv = process.env.CLAUDE_FLOW_CWD;
  const h = {
    MCPServerManager: undefined as unknown as typeof import('../src/mcp-server.js').MCPServerManager,
    dir: '',
    pidFile: '',
    create(transport: 'stdio' | 'http', pidFile = h.pidFile): Manager {
      const manager = new h.MCPServerManager({ transport, pidFile, port: 1 });
      managers.push(manager);
      return manager;
    },
  };

  beforeAll(async () => {
    ({ MCPServerManager: h.MCPServerManager } =
      await vi.importActual<typeof import('../src/mcp-server.js')>('../src/mcp-server.js'));
  });
  beforeEach(() => {
    h.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stdio-pidfile-'));
    h.pidFile = path.join(h.dir, 'claude-flow-mcp.pid');
    // removePidFile() also unlinks a legacy <CLAUDE_FLOW_CWD>/.claude-flow/mcp-server.pid.
    process.env.CLAUDE_FLOW_CWD = h.dir;
    vi.spyOn(h.MCPServerManager.prototype as any, 'startStdioServer').mockResolvedValue(undefined);
    vi.spyOn(h.MCPServerManager.prototype as any, 'startHttpServer').mockResolvedValue(undefined);
  });
  afterEach(async () => {
    for (const manager of managers.splice(0)) await manager.stop().catch(() => {});
    vi.restoreAllMocks();
    if (originalCwdEnv === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = originalCwdEnv;
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  return h;
}

describe('MCPServerManager: stdio servers stay out of the PID file (#3364)', () => {
  const h = useManagerHarness();
  const create = (transport: 'stdio' | 'http') => h.create(transport);
  let pidFile: string;
  beforeEach(() => {
    pidFile = h.pidFile;
  });

  it('starts while another live server is recorded, and never overwrites or removes its PID file', async () => {
    fs.writeFileSync(pidFile, String(sibling.pid));
    const manager = create('stdio');

    const status = await manager.start();
    expect(status).toMatchObject({ running: true, pid: process.pid, transport: 'stdio' });
    expect(fs.readFileSync(pidFile, 'utf8')).toBe(String(sibling.pid));

    // Twice: the second stop() must not read the other server's live record
    // and delete it. It no longer can, because after the first stop() this
    // manager reports itself not running and stop() returns straight away.
    await manager.stop();
    await manager.stop();
    expect(fs.readFileSync(pidFile, 'utf8')).toBe(String(sibling.pid));
    expect(siblingAlive()).toBe(true);
  });

  it('does not claim the PID file for itself', async () => {
    await create('stdio').start();
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it('reports itself healthy and leaves a stale record alone (the 30s health monitor runs this)', async () => {
    fs.writeFileSync(pidFile, '999999999'); // no such process
    const manager = create('stdio');
    await manager.start();

    await expect(manager.checkHealth()).resolves.toEqual({ healthy: true });
    expect(fs.readFileSync(pidFile, 'utf8')).toBe('999999999');
  });

  it('keeps the single-instance guard for http', async () => {
    fs.writeFileSync(pidFile, String(sibling.pid));
    await expect(create('http').start()).rejects.toThrow(`MCP Server already running (PID: ${sibling.pid})`);
    expect(fs.readFileSync(pidFile, 'utf8')).toBe(String(sibling.pid));
  });
});

// ---------------------------------------------------------------------------
// Review round 2, ask 1: start -> stop -> independent status/health denial.
// ---------------------------------------------------------------------------
describe('MCPServerManager lifecycle: a stopped server denies status and health (#3364)', () => {
  const h = useManagerHarness();

  it('start -> stop -> the manager denies both status and health', async () => {
    // Another server is recorded throughout, so "denied" has to mean "I am not
    // running", not "I read the file and found nothing".
    fs.writeFileSync(h.pidFile, String(sibling.pid));
    const manager = h.create('stdio');

    await expect(manager.start()).resolves.toMatchObject({ running: true, pid: process.pid });
    await expect(manager.checkHealth()).resolves.toEqual({ healthy: true });

    await manager.stop();

    // The round-1 flag was one-way, so both of these still said "yes".
    await expect(manager.getStatus()).resolves.toEqual({ running: false });
    await expect(manager.checkHealth()).resolves.toEqual({ healthy: false, error: 'Server stopped' });
    // ...and it stays denied however many times it is asked.
    await expect(manager.getStatus()).resolves.toEqual({ running: false });
    await expect(manager.checkHealth()).resolves.toEqual({ healthy: false, error: 'Server stopped' });
    // ...without ever having touched the other server.
    expect(fs.readFileSync(h.pidFile, 'utf8')).toBe(String(sibling.pid));
    expect(siblingAlive()).toBe(true);
  });

  it('start -> stop -> the module-level query behind `mcp status` / `mcp health` is denied', async () => {
    // getMCPServerStatus() and mcp health both go through getServerManager(),
    // the module singleton, so this is the query path as the commands run it.
    // A fresh module instance keeps that singleton out of the other tests.
    vi.resetModules();
    const mod = await vi.importActual<typeof import('../src/mcp-server.js')>('../src/mcp-server.js');
    vi.spyOn(mod.MCPServerManager.prototype as any, 'startStdioServer').mockResolvedValue(undefined);

    await mod.startMCPServer({ transport: 'stdio', pidFile: h.pidFile });
    await expect(mod.getMCPServerStatus()).resolves.toMatchObject({ running: true });

    await mod.stopMCPServer();

    await expect(mod.getMCPServerStatus()).resolves.toEqual({ running: false });
    await expect(mod.getServerManager().checkHealth()).resolves.toMatchObject({ healthy: false });
  });
});

// ---------------------------------------------------------------------------
// Review round 2, ask 2: concurrent ownership.
// ---------------------------------------------------------------------------
describe('MCPServerManager: concurrent ownership of the PID slot (#3364)', () => {
  const h = useManagerHarness();

  it('two stdio servers run side by side: each answers for itself, neither touches the record', async () => {
    fs.writeFileSync(h.pidFile, String(sibling.pid)); // a live recorded server
    const a = h.create('stdio');
    const b = h.create('stdio');

    await a.start();
    await b.start();
    await expect(a.getStatus()).resolves.toMatchObject({ running: true });
    await expect(b.getStatus()).resolves.toMatchObject({ running: true });

    await a.stop();

    await expect(a.getStatus()).resolves.toEqual({ running: false });
    await expect(a.checkHealth()).resolves.toMatchObject({ healthy: false });
    // B is untouched by A's lifecycle — one stdio server stopping says nothing
    // about the next one.
    await expect(b.getStatus()).resolves.toMatchObject({ running: true });
    await expect(b.checkHealth()).resolves.toEqual({ healthy: true });

    await b.stop();
    await expect(b.getStatus()).resolves.toEqual({ running: false });
    expect(fs.readFileSync(h.pidFile, 'utf8')).toBe(String(sibling.pid));
    expect(siblingAlive()).toBe(true);
  });

  it('a server retracts only its own record: once the slot has changed hands, stop() leaves it alone', async () => {
    const manager = h.create('http');
    await manager.start();
    expect(fs.readFileSync(h.pidFile, 'utf8').split('\n')[0]).toBe(String(process.pid));

    // Our record is replaced while we run: another server claimed the slot.
    const theirs = record(sibling.pid!);
    fs.writeFileSync(h.pidFile, theirs);

    await manager.stop();

    expect(fs.readFileSync(h.pidFile, 'utf8')).toBe(theirs);
    expect(siblingAlive()).toBe(true);
  });

  it("the record's first line is still a bare PID, so every existing reader keeps working", async () => {
    await h.create('http').start();
    const raw = fs.readFileSync(h.pidFile, 'utf8');

    // An older ruflo's readPidFile(): parseInt stops at the newline.
    expect(parseInt(raw.trim(), 10)).toBe(process.pid);
    // v3/scripts/start-mcp.sh's `head -n 1`.
    expect(raw.split('\n')[0]).toBe(String(process.pid));
    expect(JSON.parse(raw.split('\n')[1])).toMatchObject({
      v: 1,
      pid: process.pid,
      host: os.hostname(),
      platform: process.platform,
    });
  });
});

// ---------------------------------------------------------------------------
// Review round 2, ask 3: PID reuse and non-owned processes.
// ---------------------------------------------------------------------------
describe('MCPServerManager: a PID is liveness evidence, not identity (#3364)', () => {
  const h = useManagerHarness();

  it('a recorded PID whose owner has been replaced is not the recorded server', async () => {
    // The same live node process, recorded as having started at a different
    // moment — which is exactly what PID reuse looks like from here.
    fs.writeFileSync(h.pidFile, record(sibling.pid!, { start: 'Thu Jan  1 00:00:00 1970' }));

    await expect(h.create('stdio').getStatus()).resolves.toEqual({ running: false });
    expect(siblingAlive()).toBe(true); // never signalled, never adopted
    expect(fs.existsSync(h.pidFile)).toBe(false); // cleaned up as stale

    // ...so the slot is free and a new port-bound server starts over it.
    await expect(h.create('http').start()).resolves.toMatchObject({ running: true });
  });

  it('a record from another host, kernel boot or PID namespace is never believed', async () => {
    for (const foreign of [
      { host: 'some-other-host' },
      { boot: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
      { pidns: 'pid:[4026531111]' },
    ]) {
      fs.writeFileSync(h.pidFile, record(sibling.pid!, foreign));
      await expect(h.create('stdio').getStatus()).resolves.toEqual({ running: false });
      expect(siblingAlive()).toBe(true);
    }
  });

  it('an identity line that names a different PID is ignored, not applied to this one', async () => {
    // A half-overwritten record: line 1 replaced, line 2 left behind. The
    // identity says nothing about the PID now on line 1, so the record falls
    // back to PID-only — believed here, because the sibling really is alive.
    fs.writeFileSync(
      h.pidFile,
      `${sibling.pid}\n${JSON.stringify(JSON.parse(record(999999999, { start: 'Thu Jan  1 00:00:00 1970' }).split('\n')[1]))}\n`
    );
    await expect(h.create('stdio').getStatus()).resolves.toMatchObject({
      running: true,
      pid: sibling.pid,
    });
  });

  it('pins ADR-071: a live process that is not one of ours is not the recorded server', async () => {
    // Pre-existing guard (isProcessRunning's process-name check), pinned here
    // because it is the other half of non-owned-process protection and a
    // bare-integer record — an older ruflo's — has nothing else to go on.
    const stranger = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
    try {
      await vi.waitFor(() => expect(stranger.pid).toBeDefined());
      fs.writeFileSync(h.pidFile, String(stranger.pid));
      await expect(h.create('stdio').getStatus()).resolves.toEqual({ running: false });
      expect(stranger.exitCode).toBe(null); // not signalled
    } finally {
      stranger.kill('SIGKILL');
    }
  });

  it('the query `mcp start` reads denies a PID-reused record, so its --force SIGKILL is unreachable', async () => {
    // commands/mcp.ts only ever kills `(await getMCPServerStatus()).pid`. With
    // no live owned server there is no pid, so the kill branch cannot run.
    const originalTmp = process.env.TMPDIR;
    process.env.TMPDIR = h.dir; // the default pidFile is os.tmpdir()/claude-flow-mcp.pid
    try {
      vi.resetModules();
      const mod = await vi.importActual<typeof import('../src/mcp-server.js')>('../src/mcp-server.js');
      fs.writeFileSync(h.pidFile, record(sibling.pid!, { start: 'Thu Jan  1 00:00:00 1970' }));

      const status = await mod.getMCPServerStatus();
      expect(status.running).toBe(false);
      expect(status.pid).toBeUndefined();
      expect(siblingAlive()).toBe(true);
    } finally {
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
    }
  });
});

// ---------------------------------------------------------------------------
// Review round 2, ask 4: Windows lifecycle.
//
// There is no Windows host here, so these run the Windows-shaped inputs on
// this one; nothing below is a measurement on Windows. What Windows does with
// `process.kill(pid, 0)` is taken from libuv's source, not from a run:
// src/win/process.c `uv_kill` answers signal 0 by opening the process and
// calling GetExitCodeProcess, returning UV_ESRCH when it is gone, and
// src/win/error.c:158 maps ERROR_ACCESS_DENIED to UV_EPERM. Node surfaces both
// as a throw from process.kill, so isProcessRunning() answers false for either
// — including for a live process owned by another user, where POSIX answers
// EPERM and therefore true.
// ---------------------------------------------------------------------------
describe('MCPServerManager: Windows lifecycle, derived not measured (#3364)', () => {
  const h = useManagerHarness();

  it('a record written on Windows is not believed on this host', async () => {
    fs.writeFileSync(h.pidFile, record(sibling.pid!, { platform: 'win32' }));
    await expect(h.create('stdio').getStatus()).resolves.toEqual({ running: false });
    expect(siblingAlive()).toBe(true);
  });

  it('a record with no start token — what Windows writes — keeps exactly the evidence used today', async () => {
    // processStartToken() has neither /proc nor ps on Windows and returns
    // undefined, so the record carries no start time and liveness falls back
    // to isProcessRunning(). That must neither call every record stale...
    fs.writeFileSync(h.pidFile, record(sibling.pid!));
    await expect(h.create('stdio').getStatus()).resolves.toMatchObject({
      running: true,
      pid: sibling.pid,
    });

    // ...nor stop cleaning up a dead one.
    fs.writeFileSync(h.pidFile, record(999999999));
    await expect(h.create('stdio').getStatus()).resolves.toEqual({ running: false });
  });

  it('the start -> stop denial is in-process state: no record, no process probe, no platform', async () => {
    // The stdio lifecycle never reads the PID file, never signals a PID and
    // never asks the OS anything, so it behaves identically on every platform.
    // Pointed at an unwritable path to prove it: if any of that were involved,
    // this would not get through start().
    const unusable = path.join(h.dir, 'no-such-directory', 'claude-flow-mcp.pid');
    const manager = h.create('stdio', unusable);

    await expect(manager.start()).resolves.toMatchObject({ running: true, pid: process.pid });
    await expect(manager.checkHealth()).resolves.toEqual({ healthy: true });

    await manager.stop();

    await expect(manager.getStatus()).resolves.toEqual({ running: false });
    await expect(manager.checkHealth()).resolves.toMatchObject({ healthy: false });
    expect(fs.existsSync(path.dirname(unusable))).toBe(false);
  });
});
