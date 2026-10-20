/**
 * Live harness probe.
 *
 * Reports what is already running for a working tree: the host session, a
 * live daemon pid, ruflo MCP servers whose cwd is inside the tree, processes
 * holding the memory databases open, and teams that are still active.
 *
 * The probe is observe-only. It never writes to disk, never starts anything,
 * and never touches the network. It spawns at most one `ps` and two `lsof`
 * calls, all under one overall deadline, and says "unavailable" instead of
 * guessing when those tools are missing (Windows, minimal Linux).
 *
 * All OS access goes through `HarnessSys` so the probe can be tested without
 * real processes.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';

export type ProbeState = 'ok' | 'unavailable' | 'timeout';

export interface RunResult {
  stdout: string;
  state: ProbeState;
  status: number | null;
}

export interface HarnessSys {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  pid: number;
  ppid: number;
  cwd(): string;
  now(): number;
  run(cmd: string, args: string[], timeoutMs: number): RunResult;
  signal0(pid: number): 'alive' | 'dead' | 'eperm';
  exists(path: string): boolean;
  readFile(path: string): string;
  readDir(path: string): Array<{ name: string; isDir: boolean }>;
  mtimeMs(path: string): number | undefined;
  realpath(path: string): string;
  readlink(path: string): string | undefined;
}

export interface ProcRow {
  pid: number;
  ppid: number;
  argv: string[];
}

export interface LiveHarness {
  root: string;
  host: string;
  parent: { pid: number; name: string };
  session: Record<string, string>;
  daemon: { state: 'live' | 'down' | 'stale'; pid?: number; verified?: boolean; reason?: string };
  mcp: { count: number | null; servers: Array<{ pid: number; command: string }> };
  memory: { files: string[]; openPids: number[] | null };
  teams: Array<{ name: string; status: string; members: number; lastActivity?: string }>;
  staleTeams: string[];
  probes: { ps: ProbeState; lsof: ProbeState };
  status: 'live' | 'idle' | 'unknown';
  elapsedMs: number;
  line: string;
}

export interface CollectOptions {
  root?: string;
  budgetMs?: number;
  teamTtlMs?: number;
}

const DEFAULT_BUDGET_MS = 4000;
const PER_CALL_CAP_MS = 1500;
const MIN_CALL_MS = 100;
const DEFAULT_TEAM_TTL_MS = 30 * 60 * 1000;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'tcsh', 'csh', 'env', 'timeout', 'npm', 'npx', 'pnpm', 'script']);
const INTERPRETERS = new Set(['node', 'nodejs', 'bun', 'deno']);
const MCP_LAUNCHERS = new Set(['node', 'nodejs', 'bun', 'deno', 'npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'ruflo', 'claude-flow']);
const RUFLO_ID = /(^|\/)(ruflo|claude-flow)(@[\w.-]+)?$|(^|\/)@claude-flow\/cli(@[\w.-]+)?$|\/@claude-flow\/cli\/bin\/cli\.js$|\/ruflo\/bin\/[\w.-]+\.js$/;
const TEAM_ENDED = new Set(['shutdown', 'stopped']);

export const realSys: HarnessSys = {
  platform: process.platform,
  env: process.env,
  pid: process.pid,
  ppid: process.ppid,
  cwd: () => process.cwd(),
  now: () => Date.now(),
  run(cmd, args, timeoutMs) {
    const r = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ETIMEDOUT') return { stdout: r.stdout ?? '', state: 'timeout', status: r.status };
    if (r.error) return { stdout: '', state: 'unavailable', status: r.status };
    return { stdout: r.stdout ?? '', state: 'ok', status: r.status };
  },
  signal0(pid) {
    try {
      process.kill(pid, 0);
      return 'alive';
    } catch (error) {
      // EPERM: the pid exists but belongs to another user.
      return (error as NodeJS.ErrnoException).code === 'EPERM' ? 'eperm' : 'dead';
    }
  },
  exists: (path) => existsSync(path),
  readFile: (path) => readFileSync(path, 'utf8'),
  readDir: (path) => readdirSync(path, { withFileTypes: true }).map((d) => ({ name: d.name, isDir: d.isDirectory() })),
  mtimeMs(path) {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return undefined;
    }
  },
  realpath(path) {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  },
  readlink(path) {
    try {
      return readlinkSync(path);
    } catch {
      return undefined;
    }
  },
};

/** Overall deadline shared by every external call. */
class Budget {
  private readonly end: number;
  constructor(private readonly sys: HarnessSys, totalMs: number) {
    this.end = sys.now() + totalMs;
  }
  run(cmd: string, args: string[]): RunResult {
    const left = this.end - this.sys.now();
    if (left < MIN_CALL_MS) return { stdout: '', state: 'timeout', status: null };
    return this.sys.run(cmd, args, Math.min(PER_CALL_CAP_MS, left));
  }
}

/** The host's project dir if it says so, else the nearest `.git` above cwd, else cwd. */
export function findWorkspaceRoot(sys: HarnessSys): string {
  const fromEnv = sys.env.GROK_WORKSPACE_ROOT || sys.env.CLAUDE_PROJECT_DIR || sys.env.CODEX_PROJECT_DIR;
  if (fromEnv) return fromEnv;
  const start = sys.cwd();
  let dir = start;
  for (;;) {
    if (sys.exists(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** True when `path` is one of `roots` or lies inside one on a path boundary. */
export function insideRoot(path: string, roots: string[]): boolean {
  return roots.some((root) => {
    const base = root.length > 1 && root.endsWith(sep) ? root.slice(0, -1) : root;
    return path === base || path.startsWith(base + sep);
  });
}

export function parsePs(stdout: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), argv: m[3].split(/\s+/) });
  }
  return rows;
}

/** Name a process by its program, looking past node/bun to the script. */
export function programName(argv: string[]): string {
  const first = basename(argv[0] ?? '').replace(/^-/, '');
  if (INTERPRETERS.has(first) && argv[1] && !argv[1].startsWith('-')) {
    return basename(argv[1]).replace(/\.(c|m)?js$/, '');
  }
  return first;
}

/** A ruflo MCP server: a launcher, a ruflo identity token, then `mcp [start]`. */
export function isRufloMcp(argv: string[]): boolean {
  if (!MCP_LAUNCHERS.has(basename(argv[0] ?? ''))) return false;
  const at = argv.indexOf('mcp');
  if (at < 0) return false;
  const next = argv[at + 1];
  if (next !== undefined && next !== 'start' && !next.startsWith('-')) return false;
  return argv.slice(0, at).some((token) => RUFLO_ID.test(token));
}

/** Program name and subcommand words only; every argument is dropped and counted. */
export function redactCommand(argv: string[]): string {
  const words = [programName(argv), 'mcp'];
  const at = argv.indexOf('mcp');
  if (argv[at + 1] === 'start') words.push('start');
  const kept = at + words.length - 1;
  const dropped = Math.max(0, argv.length - kept);
  return dropped > 0 ? `${words.join(' ')} (+${dropped} args)` : words.join(' ');
}

export function detectHost(
  sys: HarnessSys,
  table: Map<number, ProcRow> | null,
): { host: string; parent: { pid: number; name: string } } {
  const env = sys.env;
  let parent = { pid: sys.ppid, name: '' };
  const names: string[] = [];
  if (table) {
    // Hooks usually run under `sh -c`; walk past shells and wrappers.
    let pid = sys.ppid;
    for (let depth = 0; depth < 8 && pid > 1; depth++) {
      const row = table.get(pid);
      if (!row) break;
      const name = programName(row.argv);
      if (!SHELLS.has(name)) {
        if (!parent.name) parent = { pid, name };
        names.push(name);
      }
      pid = row.ppid;
    }
  }
  const seen = (re: RegExp) => names.some((n) => re.test(n));
  let host: string;
  if (env.WEFTOS_SESSION || env.WEFT_SESSION || seen(/^weftos/i)) host = 'weftos';
  else if (env.GROK_SESSION_ID || env.GROK_WORKSPACE_ROOT || seen(/^grok([-_.]|$)/)) host = 'grok';
  else if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX || env.CODEX_CI || seen(/^codex([-_.]|$)/)) host = 'codex';
  else if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT || seen(/^claude([-_.]|$)/)) host = 'claude';
  else host = parent.name ? `process:${parent.name}` : 'unknown';
  return { host, parent };
}

function sessionIds(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['GROK_SESSION_ID', 'CODEX_THREAD_ID', 'CLAUDE_SESSION_ID', 'WEFTOS_SESSION', 'WEFT_SESSION']) {
    const value = env[key];
    if (value) out[key] = value;
  }
  return out;
}

function daemonState(
  sys: HarnessSys,
  root: string,
  roots: string[],
  table: Map<number, ProcRow> | null,
): LiveHarness['daemon'] {
  const pidFile = join(root, '.claude-flow', 'daemon.pid');
  if (!sys.exists(pidFile)) return { state: 'down' };
  let raw: string;
  try {
    raw = sys.readFile(pidFile).trim();
  } catch {
    return { state: 'down' };
  }
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) return { state: 'stale', reason: 'bad pidfile' };
  // EPERM means the pid exists under another user; only ESRCH means gone.
  if (sys.signal0(pid) === 'dead') return { state: 'stale', pid, reason: 'not running' };
  const row = table?.get(pid);
  if (!row) return { state: 'live', pid, verified: false };
  // The pid is alive; make sure it is still our daemon and not a recycled pid.
  if (!row.argv.includes('daemon')) return { state: 'stale', pid, reason: 'pid reused' };
  const ws = row.argv.indexOf('--workspace');
  const workspace = ws >= 0 ? row.argv[ws + 1] : undefined;
  if (workspace && !roots.includes(workspace) && !roots.includes(sys.realpath(workspace))) {
    return { state: 'stale', pid, reason: 'pid belongs to another workspace' };
  }
  return { state: 'live', pid, verified: true };
}

/** cwd for each pid: /proc on Linux, then one batched lsof for the rest. */
function processCwds(
  sys: HarnessSys,
  budget: Budget,
  pids: number[],
): { cwds: Map<number, string>; lsof: ProbeState | null } {
  const cwds = new Map<number, string>();
  if (sys.platform === 'linux') {
    for (const pid of pids) {
      const cwd = sys.readlink(`/proc/${pid}/cwd`);
      if (cwd) cwds.set(pid, cwd);
    }
  }
  const rest = pids.filter((pid) => !cwds.has(pid));
  if (rest.length === 0) return { cwds, lsof: null };
  const r = budget.run('lsof', ['-a', '-d', 'cwd', '-p', rest.join(','), '-Fpn']);
  let current = 0;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('p')) current = Number(line.slice(1));
    else if (line.startsWith('n') && current) cwds.set(current, line.slice(1));
  }
  return { cwds, lsof: r.state };
}

function mcpServers(
  sys: HarnessSys,
  budget: Budget,
  roots: string[],
  rows: ProcRow[],
): { mcp: LiveHarness['mcp']; lsof: ProbeState | null } {
  let candidates = rows.filter((row) => row.pid !== sys.pid && isRufloMcp(row.argv));
  // `npx ruflo mcp start` forks the real server; count the leaf only.
  const parents = new Set(candidates.map((row) => row.ppid));
  candidates = candidates.filter((row) => !parents.has(row.pid));
  if (candidates.length === 0) return { mcp: { count: 0, servers: [] }, lsof: null };
  const { cwds, lsof } = processCwds(sys, budget, candidates.map((row) => row.pid));
  if (lsof !== null && lsof !== 'ok' && cwds.size < candidates.length) {
    return { mcp: { count: null, servers: [] }, lsof };
  }
  const servers = candidates
    .filter((row) => {
      const cwd = cwds.get(row.pid);
      return cwd !== undefined && (insideRoot(cwd, roots) || insideRoot(sys.realpath(cwd), roots));
    })
    .map((row) => ({ pid: row.pid, command: redactCommand(row.argv) }));
  return { mcp: { count: servers.length, servers }, lsof };
}

function memoryHolders(
  sys: HarnessSys,
  budget: Budget,
  root: string,
): { memory: LiveHarness['memory']; lsof: ProbeState | null } {
  // memory.db is the sql.js writer; agentdb-memory.db is the native AgentDB store.
  const files: string[] = [];
  for (const db of ['memory.db', 'agentdb-memory.db']) {
    for (const suffix of ['', '-wal', '-shm']) {
      const path = join(root, '.swarm', db + suffix);
      if (sys.exists(path)) files.push(path);
    }
  }
  if (files.length === 0) return { memory: { files, openPids: [] }, lsof: null };
  if (sys.platform === 'win32') return { memory: { files, openPids: null }, lsof: 'unavailable' };
  const r = budget.run('lsof', ['-t', '--', ...files]);
  if (r.state !== 'ok') return { memory: { files, openPids: null }, lsof: r.state };
  const pids = r.stdout
    .split('\n')
    .map((row) => Number(row.trim()))
    .filter((pid) => pid > 0 && pid !== sys.pid);
  return { memory: { files, openPids: [...new Set(pids)] }, lsof: 'ok' };
}

interface TeamFile {
  name?: string;
  status?: string;
  shutdownAt?: string;
  createdAt?: string;
  updatedAt?: string;
  members?: Record<string, { pid?: number; registeredAt?: string; lastStopAt?: string; lastSeenAt?: string }>;
  plan?: { updatedAt?: string };
}

function lastActivity(sys: HarnessSys, file: string, team: TeamFile): number {
  const stamps = [team.createdAt, team.updatedAt, team.plan?.updatedAt];
  for (const member of Object.values(team.members ?? {})) {
    stamps.push(member?.registeredAt, member?.lastStopAt, member?.lastSeenAt);
  }
  const times = stamps.map((s) => (s ? Date.parse(s) : NaN)).filter((t) => Number.isFinite(t));
  return Math.max(sys.mtimeMs(file) ?? 0, ...times, 0);
}

/**
 * Teams under .claude-flow/teams: `<name>/team.json` (the team bus layout)
 * and the legacy flat `<name>.json`. A team counts as live only if it has not
 * shut down AND shows activity within the TTL or has a member pid running.
 */
function teamsIn(sys: HarnessSys, root: string, ttlMs: number): { live: LiveHarness['teams']; stale: string[] } {
  const dir = join(root, '.claude-flow', 'teams');
  const live: LiveHarness['teams'] = [];
  const stale: string[] = [];
  if (!sys.exists(dir)) return { live, stale };
  let entries: Array<{ name: string; isDir: boolean }>;
  try {
    entries = sys.readDir(dir);
  } catch {
    return { live, stale };
  }
  for (const entry of entries) {
    const file = entry.isDir
      ? join(dir, entry.name, 'team.json')
      : entry.name.endsWith('.json') ? join(dir, entry.name) : '';
    if (!file || !sys.exists(file)) continue;
    let team: TeamFile;
    try {
      team = JSON.parse(sys.readFile(file)) as TeamFile;
    } catch {
      continue; // an unreadable team file is not a live team
    }
    if (!team || typeof team !== 'object') continue;
    if (team.shutdownAt || TEAM_ENDED.has(String(team.status))) continue;
    const name = team.name || entry.name.replace(/\.json$/, '');
    const last = lastActivity(sys, file, team);
    const pidAlive = Object.values(team.members ?? {}).some(
      (m) => Number.isInteger(m?.pid) && (m.pid as number) > 0 && sys.signal0(m.pid as number) !== 'dead',
    );
    if (!pidAlive && sys.now() - last > ttlMs) {
      stale.push(name);
      continue;
    }
    live.push({
      name,
      status: team.status || 'unknown',
      members: team.members ? Object.keys(team.members).length : 0,
      lastActivity: last ? new Date(last).toISOString() : undefined,
    });
  }
  return { live, stale };
}

function worst(...states: Array<ProbeState | null>): ProbeState {
  const rank: Record<ProbeState, number> = { ok: 0, timeout: 1, unavailable: 2 };
  return states.reduce<ProbeState>((acc, s) => (s !== null && rank[s] > rank[acc] ? s : acc), 'ok');
}

function teamTtl(sys: HarnessSys, fallback: number): number {
  const secs = Number(sys.env.RUFLO_HARNESS_TEAM_TTL_SECS);
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : fallback;
}

export function collectLiveHarness(sys: HarnessSys = realSys, opts: CollectOptions = {}): LiveHarness {
  const start = sys.now();
  const budget = new Budget(sys, opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const root = opts.root ?? findWorkspaceRoot(sys);
  // Both spellings of the root, so macOS /tmp and /private/tmp compare equal.
  const roots = [...new Set([root, sys.realpath(root)])];

  let ps: ProbeState = 'unavailable';
  let rows: ProcRow[] = [];
  if (sys.platform !== 'win32') {
    const r = budget.run('ps', ['-ax', '-o', 'pid=,ppid=,command=']);
    rows = r.state === 'ok' ? parsePs(r.stdout) : [];
    // busybox ps rejects -ax: "ran but listed nothing" is unavailable, not idle.
    ps = r.state === 'ok' && rows.length === 0 ? 'unavailable' : r.state;
  }
  const table = ps === 'ok' ? new Map(rows.map((row) => [row.pid, row])) : null;

  const { host, parent } = detectHost(sys, table);
  const daemon = daemonState(sys, root, roots, table);
  const mcpProbe = ps === 'ok'
    ? mcpServers(sys, budget, roots, rows)
    : { mcp: { count: null, servers: [] } as LiveHarness['mcp'], lsof: null };
  const memProbe = memoryHolders(sys, budget, root);
  const teams = teamsIn(sys, root, teamTtl(sys, opts.teamTtlMs ?? DEFAULT_TEAM_TTL_MS));
  const probes = { ps, lsof: worst(mcpProbe.lsof, memProbe.lsof) };

  const openCount = memProbe.memory.openPids === null ? null : memProbe.memory.openPids.length;
  const live = daemon.state === 'live' || (mcpProbe.mcp.count ?? 0) > 0 || (openCount ?? 0) > 0 || teams.live.length > 0;
  const unknown = mcpProbe.mcp.count === null || openCount === null;
  const status: LiveHarness['status'] = live ? 'live' : unknown ? 'unknown' : 'idle';
  const unavailable = Object.entries(probes).filter(([, s]) => s !== 'ok').map(([k, s]) => `${k}:${s}`);
  const count = (n: number | null) => (n === null ? '?' : String(n));
  const parts = [
    'harness',
    status,
    `host=${host}`,
    parent.name ? `parent=${parent.name}` : '',
    `daemon=${daemon.state}${daemon.pid ? `:${daemon.pid}` : ''}`,
    `mcp=${count(mcpProbe.mcp.count)}`,
    `memory-open=${count(openCount)}`,
    `teams=${teams.live.length}`,
    teams.stale.length ? `stale-teams=${teams.stale.length}` : '',
    unavailable.length ? `probe-unavailable=${unavailable.join(',')}` : '',
  ].filter(Boolean);

  return {
    root,
    host,
    parent,
    session: sessionIds(sys.env),
    daemon,
    mcp: mcpProbe.mcp,
    memory: memProbe.memory,
    teams: teams.live,
    staleTeams: teams.stale,
    probes,
    status,
    elapsedMs: sys.now() - start,
    line: parts.join(' │ '),
  };
}
