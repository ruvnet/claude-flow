/**
 * `ruflo harness` live probe (PR #3521 review).
 *
 * Each block is a regression test for one review item. The probe runs
 * against a fake HarnessSys so process tables, lsof output and team files are
 * exact; the last block runs real processes.
 */
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectLiveHarness,
  detectHost,
  insideRoot,
  isRufloMcp,
  parsePs,
  redactCommand,
  realSys,
  type HarnessSys,
  type ProcRow,
  type RunResult,
} from '../src/services/live-harness.js';

const ROOT = '/work/pr-3521';
const CLI = '/opt/ruflo/v3/@claude-flow/cli/bin/cli.js';

interface FakeOpts {
  ps?: string | RunResult;
  lsof?: (args: string[]) => RunResult;
  files?: Record<string, string>;
  dirs?: Record<string, Array<{ name: string; isDir: boolean }>>;
  mtimes?: Record<string, number>;
  alive?: Record<number, 'alive' | 'dead' | 'eperm'>;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  realpaths?: Record<string, string>;
  now?: () => number;
  ppid?: number;
}

function fakeSys(o: FakeOpts = {}): HarnessSys & { calls: Array<{ cmd: string; args: string[]; timeoutMs: number }> } {
  const calls: Array<{ cmd: string; args: string[]; timeoutMs: number }> = [];
  const files = o.files ?? {};
  const dirs = o.dirs ?? {};
  return {
    calls,
    platform: o.platform ?? 'darwin',
    env: o.env ?? {},
    pid: 99999,
    ppid: o.ppid ?? 500,
    cwd: () => ROOT,
    now: o.now ?? (() => Date.parse('2026-09-28T12:00:00Z')),
    run(cmd, args, timeoutMs) {
      calls.push({ cmd, args, timeoutMs });
      if (cmd === 'ps') {
        if (o.ps === undefined) return { stdout: '', state: 'unavailable', status: null };
        return typeof o.ps === 'string' ? { stdout: o.ps, state: 'ok', status: 0 } : o.ps;
      }
      if (cmd === 'lsof') return o.lsof ? o.lsof(args) : { stdout: '', state: 'unavailable', status: null };
      return { stdout: '', state: 'unavailable', status: null };
    },
    signal0: (pid) => o.alive?.[pid] ?? 'dead',
    exists: (p) => p in files || p in dirs,
    readFile: (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
    readDir: (p) => dirs[p] ?? [],
    mtimeMs: (p) => o.mtimes?.[p],
    realpath: (p) => o.realpaths?.[p] ?? p,
    readlink: () => undefined,
  };
}

const ps = (rows: Array<[number, number, string]>) => rows.map(([pid, ppid, cmd]) => `${pid} ${ppid} ${cmd}`).join('\n');
const lsofCwd = (map: Record<number, string>) => (args: string[]): RunResult => {
  if (!args.includes('cwd')) return { stdout: '', state: 'ok', status: 1 };
  const pids = args[args.indexOf('-p') + 1].split(',').map(Number);
  return { stdout: pids.filter((p) => map[p]).map((p) => `p${p}\nfcwd\nn${map[p]}`).join('\n'), state: 'ok', status: 0 };
};

describe('MCP detection matches the root exactly (review #4)', () => {
  it('does not count a server in a sibling directory whose path shares a prefix', () => {
    const sys = fakeSys({
      ps: ps([[100, 1, `node ${CLI} mcp start`], [101, 1, `node ${CLI} mcp start`]]),
      alive: { 100: 'alive', 101: 'alive' },
      lsof: lsofCwd({ 100: ROOT, 101: `${ROOT}-2` }),
    });
    const r = collectLiveHarness(sys, { root: ROOT });
    expect(r.mcp.count).toBe(1);
    expect(r.mcp.servers.map((s) => s.pid)).toEqual([100]);
  });

  it('does not count a process whose argv merely mentions the root', () => {
    const sys = fakeSys({
      ps: ps([[200, 1, `/bin/zsh -c echo ruflo mcp start ${ROOT}`], [201, 1, `grep ${CLI} mcp start ${ROOT}`]]),
      lsof: lsofCwd({ 200: ROOT, 201: ROOT }),
    });
    expect(collectLiveHarness(sys, { root: ROOT }).mcp.count).toBe(0);
  });

  it('counts a server whose cwd is a subdirectory of the root', () => {
    const sys = fakeSys({ ps: ps([[300, 1, `npx ruflo@latest mcp start`]]), lsof: lsofCwd({ 300: `${ROOT}/packages/a` }) });
    expect(collectLiveHarness(sys, { root: ROOT }).mcp.count).toBe(1);
  });

  it('ignores another tool\'s `mcp start` and counts npx→node once', () => {
    const sys = fakeSys({
      ps: ps([
        [400, 1, 'npm exec ruvector mcp start'],
        [401, 1, 'npx ruflo mcp start'],
        [402, 401, `node /home/u/.npm/_npx/abc/node_modules/.bin/ruflo mcp start`],
      ]),
      lsof: lsofCwd({ 400: ROOT, 401: ROOT, 402: ROOT }),
    });
    const r = collectLiveHarness(sys, { root: ROOT });
    expect(r.mcp.servers.map((s) => s.pid)).toEqual([402]);
  });

  it('uses one lsof call for every candidate cwd', () => {
    const sys = fakeSys({
      ps: ps([[1, 0, `node ${CLI} mcp start`], [2, 0, `node ${CLI} mcp start`], [3, 0, `node ${CLI} mcp start`]]),
      lsof: lsofCwd({ 1: ROOT, 2: ROOT, 3: '/elsewhere' }),
    });
    collectLiveHarness(sys, { root: ROOT });
    expect(sys.calls.filter((c) => c.cmd === 'lsof')).toHaveLength(1);
  });

  it('path helpers: boundary match and launcher/identity rules', () => {
    expect(insideRoot('/a/b', ['/a/b'])).toBe(true);
    expect(insideRoot('/a/b/c', ['/a/b'])).toBe(true);
    expect(insideRoot('/a/b-2', ['/a/b'])).toBe(false);
    expect(isRufloMcp(['sh', '-c', `node ${CLI} mcp start`])).toBe(false);
    expect(isRufloMcp(['node', CLI, 'mcp', 'start'])).toBe(true);
    expect(isRufloMcp(['node', CLI, 'mcp', 'status'])).toBe(false);
    expect(isRufloMcp(['npx', '@claude-flow/cli@latest', 'mcp', 'start'])).toBe(true);
  });
});

describe('MCP output never includes full command lines (review #6)', () => {
  it('reports count, pid and a redacted command without arguments', () => {
    const secret = 'sk-live-THIS_MUST_NOT_LEAK';
    const sys = fakeSys({
      ps: ps([[500, 1, `node ${CLI} mcp start --token ${secret} --api-key=${secret}`]]),
      lsof: lsofCwd({ 500: ROOT }),
    });
    const r = collectLiveHarness(sys, { root: ROOT });
    const json = JSON.stringify(r);
    expect(json).not.toContain(secret);
    expect(json).not.toContain('/opt/ruflo');
    expect(r.mcp.servers[0]).toEqual({ pid: 500, command: 'cli mcp start (+3 args)' });
    expect(redactCommand(['npx', 'ruflo', 'mcp', 'start'])).toBe('npx mcp start');
  });
});

describe('memory probe covers both databases (review #5)', () => {
  it('asks lsof about memory.db and agentdb-memory.db (+WAL/SHM) in one call', () => {
    const swarm = `${ROOT}/.swarm`;
    const files = Object.fromEntries(
      ['agentdb-memory.db', 'agentdb-memory.db-wal', 'agentdb-memory.db-shm', 'memory.db'].map((f) => [`${swarm}/${f}`, '']),
    );
    let asked: string[] = [];
    const sys = fakeSys({
      ps: ps([[1, 0, 'launchd']]),
      files,
      lsof: (args) => {
        asked = args;
        return { stdout: '700\n701\n700\n99999\n', state: 'ok', status: 0 };
      },
    });
    const r = collectLiveHarness(sys, { root: ROOT });
    expect(asked).toEqual(expect.arrayContaining(Object.keys(files)));
    expect(r.memory.openPids).toEqual([700, 701]);
    expect(r.line).toContain('memory-open=2');
    expect(sys.calls.filter((c) => c.cmd === 'lsof')).toHaveLength(1);
  });

  it('reports held-open when only agentdb-memory.db exists', () => {
    const sys = fakeSys({
      ps: ps([[1, 0, 'launchd']]),
      files: { [`${ROOT}/.swarm/agentdb-memory.db`]: '' },
      lsof: () => ({ stdout: '42\n', state: 'ok', status: 0 }),
    });
    expect(collectLiveHarness(sys, { root: ROOT }).memory.openPids).toEqual([42]);
  });
});

describe('teams read the team-bus layout with a liveness check (review #3)', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const teams = `${ROOT}/.claude-flow/teams`;
  const recent = new Date(now - 60_000).toISOString();
  const old = new Date(now - 6 * 3600_000).toISOString();
  const team = (name: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ id: name, name, status: 'active', createdAt: old, members: { a: { name: 'a', registeredAt: old } }, ...extra });

  it('finds `<name>/team.json` and the legacy flat file', () => {
    const sys = fakeSys({
      ps: ps([[1, 0, 'launchd']]),
      dirs: { [teams]: [{ name: 'bus', isDir: true }, { name: 'flat.json', isDir: false }] },
      files: {
        [`${teams}/bus/team.json`]: team('bus', { plan: { steps: [], index: 0, updatedAt: recent } }),
        [`${teams}/flat.json`]: team('flat', { createdAt: recent }),
      },
    });
    const r = collectLiveHarness(sys, { root: ROOT });
    expect(r.teams.map((t) => t.name).sort()).toEqual(['bus', 'flat']);
    expect(r.line).toContain('teams=2');
  });

  it('a crashed team with no recent activity is stale, not live forever', () => {
    const sys = fakeSys({
      ps: ps([[1, 0, 'launchd']]),
      dirs: { [teams]: [{ name: 'crashed', isDir: true }] },
      files: { [`${teams}/crashed/team.json`]: team('crashed') },
      mtimes: { [`${teams}/crashed/team.json`]: now - 6 * 3600_000 },
    });
    const r = collectLiveHarness(sys, { root: ROOT });
    expect(r.teams).toEqual([]);
    expect(r.staleTeams).toEqual(['crashed']);
    expect(r.line).toContain('teams=0');
    expect(r.line).toContain('stale-teams=1');
  });

  it('a recently written team.json (mtime) counts as live; shutdown never does', () => {
    const sys = fakeSys({
      ps: ps([[1, 0, 'launchd']]),
      dirs: { [teams]: [{ name: 'busy', isDir: true }, { name: 'done', isDir: true }] },
      files: {
        [`${teams}/busy/team.json`]: team('busy'),
        [`${teams}/done/team.json`]: team('done', { status: 'shutdown', shutdownAt: recent }),
      },
      mtimes: { [`${teams}/busy/team.json`]: now - 30_000, [`${teams}/done/team.json`]: now },
    });
    const r = collectLiveHarness(sys, { root: ROOT });
    expect(r.teams.map((t) => t.name)).toEqual(['busy']);
    expect(r.staleTeams).toEqual([]);
  });

  it('an old team with a running member pid stays live', () => {
    const sys = fakeSys({
      ps: ps([[1, 0, 'launchd']]),
      dirs: { [teams]: [{ name: 't', isDir: true }] },
      files: { [`${teams}/t/team.json`]: team('t', { members: { a: { pid: 4242, registeredAt: old } } }) },
      alive: { 4242: 'alive' },
    });
    expect(collectLiveHarness(sys, { root: ROOT }).teams).toHaveLength(1);
  });
});

describe('daemon pid handling (minor: PID reuse, EPERM)', () => {
  const pidFile = `${ROOT}/.claude-flow/daemon.pid`;

  it('a recycled pid that is not a daemon reads as stale', () => {
    const sys = fakeSys({ ps: ps([[800, 1, '/usr/bin/vim notes.txt']]), files: { [pidFile]: '800' }, alive: { 800: 'alive' } });
    expect(collectLiveHarness(sys, { root: ROOT }).daemon).toMatchObject({ state: 'stale', pid: 800, reason: 'pid reused' });
  });

  it('a daemon for another workspace reads as stale', () => {
    const sys = fakeSys({
      ps: ps([[801, 1, `node ${CLI} daemon start --foreground --workspace /work/other`]]),
      files: { [pidFile]: '801' },
      alive: { 801: 'alive' },
    });
    expect(collectLiveHarness(sys, { root: ROOT }).daemon.state).toBe('stale');
  });

  it('our daemon is live and verified', () => {
    const sys = fakeSys({
      ps: ps([[802, 1, `node ${CLI} daemon start --foreground --workspace ${ROOT}`]]),
      files: { [pidFile]: '802' },
      alive: { 802: 'alive' },
    });
    expect(collectLiveHarness(sys, { root: ROOT }).daemon).toEqual({ state: 'live', pid: 802, verified: true });
  });

  it('EPERM (another user\'s process) is alive, not dead', () => {
    const sys = fakeSys({ files: { [pidFile]: '803' }, alive: { 803: 'eperm' } });
    expect(collectLiveHarness(sys, { root: ROOT }).daemon).toMatchObject({ state: 'live', pid: 803 });
  });

  it('a dead pid is stale', () => {
    const sys = fakeSys({ ps: ps([[1, 0, 'launchd']]), files: { [pidFile]: '804' } });
    expect(collectLiveHarness(sys, { root: ROOT }).daemon.state).toBe('stale');
  });
});

describe('probe availability and budget (minors: portability, hang budget)', () => {
  it('reports "probe unavailable" instead of idle when ps/lsof are missing', () => {
    const sys = fakeSys({ files: { [`${ROOT}/.swarm/memory.db`]: '' } });
    const r = collectLiveHarness(sys, { root: ROOT });
    expect(r.status).toBe('unknown');
    expect(r.line).toContain('mcp=?');
    expect(r.line).toContain('memory-open=?');
    expect(r.line).toContain('probe-unavailable=ps:unavailable,lsof:unavailable');
  });

  it('never spawns ps or lsof on Windows', () => {
    const sys = fakeSys({ platform: 'win32', ps: 'x', files: { [`${ROOT}/.swarm/memory.db`]: '' } });
    const r = collectLiveHarness(sys, { root: ROOT });
    expect(sys.calls).toEqual([]);
    expect(r.probes).toEqual({ ps: 'unavailable', lsof: 'unavailable' });
  });

  it('treats a ps that lists nothing (busybox) as unavailable', () => {
    const r = collectLiveHarness(fakeSys({ ps: '' }), { root: ROOT });
    expect(r.probes.ps).toBe('unavailable');
  });

  it('stays inside one overall deadline: later calls are skipped, per-call timeouts shrink', () => {
    let t = 0;
    const sys = fakeSys({
      now: () => t,
      ps: ps([[1, 0, `node ${CLI} mcp start`]]),
      files: { [`${ROOT}/.swarm/memory.db`]: '' },
      lsof: () => ({ stdout: '', state: 'timeout', status: null }),
    });
    const run = sys.run.bind(sys);
    sys.run = (cmd, args, timeoutMs) => {
      const r = run(cmd, args, timeoutMs);
      t += timeoutMs; // every call burns its full timeout
      return r;
    };
    const r = collectLiveHarness(sys, { root: ROOT, budgetMs: 2000 });
    const total = sys.calls.reduce((sum, c) => sum + c.timeoutMs, 0);
    expect(total).toBeLessThanOrEqual(2000);
    expect(sys.calls.length).toBeLessThanOrEqual(3);
    expect(r.elapsedMs).toBeLessThanOrEqual(2000);
    expect(r.probes.lsof).toBe('timeout');
  });
});

describe('root normalisation (minor: macOS /tmp vs /private/tmp)', () => {
  it('matches a cwd reported under the real path of a symlinked root', () => {
    const sys = fakeSys({
      ps: ps([[900, 1, `node ${CLI} mcp start`]]),
      realpaths: { '/tmp/proj': '/private/tmp/proj' },
      lsof: lsofCwd({ 900: '/private/tmp/proj' }),
    });
    expect(collectLiveHarness(sys, { root: '/tmp/proj' }).mcp.count).toBe(1);
  });
});

describe('host detection walks past `sh -c` (minor)', () => {
  it('finds codex above a shell parent with no env hints', () => {
    const table = new Map<number, ProcRow>(
      parsePs(ps([[500, 400, 'sh -c node cli.js harness --hook'], [400, 300, '/opt/homebrew/bin/codex'], [300, 1, '-zsh']])).map((r) => [r.pid, r]),
    );
    const { host, parent } = detectHost(fakeSys({ ppid: 500 }), table);
    expect(host).toBe('codex');
    expect(parent).toEqual({ pid: 400, name: 'codex' });
  });

  it('reports the first non-shell ancestor as the parent, not `sh`', () => {
    const table = new Map<number, ProcRow>(
      parsePs(ps([[500, 400, '/bin/bash -c x'], [400, 1, '/usr/local/bin/tmux']])).map((r) => [r.pid, r]),
    );
    expect(detectHost(fakeSys({ ppid: 500 }), table)).toEqual({ host: 'process:tmux', parent: { pid: 400, name: 'tmux' } });
  });
});

describe('real processes', () => {
  const hasLsof = process.platform !== 'win32' && spawnSync('lsof', ['-v'], { stdio: 'ignore' }).error === undefined;

  it.skipIf(!hasLsof)('counts a server in the root and not one in a sibling directory', async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'harness-real-')));
    const root = join(base, 'pr-3521');
    const sibling = join(base, 'pr-3521-2');
    const binDir = join(base, 'node_modules', '@claude-flow', 'cli', 'bin');
    for (const d of [root, sibling, binDir]) mkdirSync(d, { recursive: true });
    const fakeCli = join(binDir, 'cli.js');
    writeFileSync(fakeCli, 'setInterval(() => {}, 1000);\n');
    const inRoot = spawn(process.execPath, [fakeCli, 'mcp', 'start'], { cwd: root, stdio: 'ignore' });
    const inSibling = spawn(process.execPath, [fakeCli, 'mcp', 'start'], { cwd: sibling, stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 300));
      const r = collectLiveHarness(realSys, { root });
      expect(r.mcp.servers.map((s) => s.pid)).toEqual([inRoot.pid]);
    } finally {
      inRoot.kill();
      inSibling.kill();
    }
  });
});
