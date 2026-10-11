/** Safe subprocess access to the local ruflo CLI: fixed argv arrays, no shell, hard timeout, output cap, scrubbed env. */
import { spawn } from 'node:child_process';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path';

/** Used by the integration test only (its own temp dir); never a runtime fallback. */
export const PINNED_NPX = ['npx', '--yes', '@claude-flow/cli@3.55.0'] as const;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
const ENV_ALLOW = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'SYSTEMROOT', 'USERPROFILE', 'APPDATA', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'CLAUDE_CONFIG_DIR'];

/** Minimal environment: nothing from the parent beyond the allowlist (no tokens, no API keys, no NODE_OPTIONS). */
export function scrubEnv(src: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const k of ENV_ALLOW) if (src[k] !== undefined) env[k] = src[k];
  // A relative PATH entry ("", ".", "bin", "node_modules/.bin") would resolve against the project dir the child runs in.
  if (env.PATH !== undefined) env.PATH = env.PATH.split(delimiter).filter(d => d !== '' && isAbsolute(d)).join(delimiter);
  return env;
}

export interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }
export interface RunOpts { cwd: string; timeoutMs?: number; maxBytes?: number; env?: NodeJS.ProcessEnv; /** Written to the child's stdin then closed (a value that must not appear in argv). */ stdin?: string }

/** argv[0] is the program, the rest are literal arguments. Never interpreted by a shell. */
export function runArgv(argv: readonly string[], o: RunOpts): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (argv.length === 0 || argv.some(a => typeof a !== 'string' || a.includes('\0'))) return reject(new Error('invalid argv'));
    const max = o.maxBytes ?? MAX_OUTPUT_BYTES;
    const child = spawn(argv[0]!, argv.slice(1), { cwd: o.cwd, env: o.env ?? scrubEnv(), shell: false, stdio: [o.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], windowsHide: true });
    if (o.stdin !== undefined) { child.stdin?.on('error', () => undefined); child.stdin?.end(o.stdin); }
    let out = '', err = '', bytes = 0, truncated = false, timedOut = false, done = false;
    const kill = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const take = (which: 'o' | 'e') => (b: Buffer) => {
      if (truncated) return;
      bytes += b.length;
      if (bytes > max) { truncated = true; kill(); return; }
      if (which === 'o') out += b.toString('utf8'); else err += b.toString('utf8');
    };
    child.stdout!.on('data', take('o')); child.stderr!.on('data', take('e'));
    child.on('error', e => { if (done) return; done = true; clearTimeout(timer); reject(e); });
    child.on('close', code => { if (done) return; done = true; clearTimeout(timer); resolve({ code, stdout: out, stderr: err, timedOut, truncated }); });
  });
}

export class RufloError extends Error { constructor(public code: string, message: string) { super(message); this.name = 'RufloError'; } }

/** Narrow interface the collectors/executors depend on, so tests can stub ruflo entirely. */
export interface Ruflo { mcp(tool: string, params?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown> }

/** `ruflo mcp exec` prints log lines, then `Result:` and a JSON document. Returns the parsed document. */
export function parseMcpOutput(stdout: string): unknown {
  if (/^\[ERROR\]/m.test(stdout) && !/^Result:/m.test(stdout)) throw new RufloError('tool_error', stdout.split('\n').find(l => l.startsWith('[ERROR]'))?.slice(0, 200) ?? 'tool error');
  const i = stdout.search(/^Result:\s*$/m);
  if (i < 0) throw new RufloError('no_result', 'ruflo printed no Result block');
  const rest = stdout.slice(i).replace(/^Result:\s*/, '').trim();
  try { return JSON.parse(rest); } catch { throw new RufloError('bad_json', 'ruflo result is not valid JSON'); }
}

/**
 * Resolve the ruflo launcher: explicit config, else `ruflo`/`claude-flow` on PATH. There is deliberately NO npx fallback: npx would
 * fetch code from a registry chosen by the project's own .npmrc (cwd = project dir) with no integrity pin.
 */
export function resolveRufloCommand(configured?: string[], pathEnv: string | undefined = process.env.PATH, projectDir?: string): string[] {
  if (configured && configured.length > 0) return configured;
  for (const bin of ['ruflo', 'claude-flow']) {
    const p = resolveOnPath(bin, pathEnv, projectDir);
    if (p) return [p];
  }
  throw new RufloError('ruflo_not_found', 'ruflo is not on PATH; install it (npm i -g ruflo) or set "rufloCommand" in config.json');
}

/** First executable named `bin` in an ABSOLUTE PATH directory (relative entries would resolve inside the untrusted project). */
export function resolveOnPath(bin: string, pathEnv: string | undefined = process.env.PATH, projectDir?: string): string | null {
  const root = projectDir ? realOr(projectDir) : null;
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    try {
      const p = join(dir, bin); if (!statSync(p).isFile()) continue; accessSync(p, constants.X_OK);
      // A binary that lives inside the project (a direnv/`npm run` PATH with node_modules/.bin, or a link into it) is project code: never run.
      if (root && inside(realOr(p), root)) continue;
      return p;
    } catch { /* next */ }
  }
  return null;
}
const realOr = (p: string): string => { try { return realpathSync(p); } catch { return resolve(p); } };
const inside = (child: string, root: string): boolean => child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);

export class RufloClient implements Ruflo {
  constructor(private base: string[], private cwd: string, private timeoutMs = DEFAULT_TIMEOUT_MS) {}
  argvFor(tool: string, params: Record<string, unknown> = {}): string[] {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(tool)) throw new RufloError('bad_tool', 'invalid tool name');
    return [...this.base, 'mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)];
  }
  async mcp(tool: string, params: Record<string, unknown> = {}, opts: { timeoutMs?: number } = {}): Promise<unknown> {
    const argv = this.argvFor(tool, params);
    let r: RunResult;
    try { r = await runArgv(argv, { cwd: this.cwd, timeoutMs: opts.timeoutMs ?? this.timeoutMs }); } catch (e) { throw new RufloError('spawn_failed', `cannot run ruflo: ${(e as Error).message}`.slice(0, 200)); }
    if (r.timedOut) throw new RufloError('timeout', `${tool} timed out`);
    if (r.truncated) throw new RufloError('output_too_large', `${tool} output exceeded cap`);
    if (r.code !== 0 && !/^Result:/m.test(r.stdout)) throw new RufloError('exit_nonzero', `${tool} exited ${r.code}`);
    return parseMcpOutput(r.stdout);
  }
}

/** Counting semaphore: bounds how many ruflo/node child processes run at once. */
export class Semaphore {
  private waiting: Array<() => void> = []; private active = 0;
  constructor(readonly max: number) {}
  async run<T>(f: () => Promise<T>): Promise<T> {
    // Loop: a woken waiter re-checks, because a caller that arrived in between may already have taken the slot.
    while (this.active >= this.max) await new Promise<void>(r => this.waiting.push(r));
    this.active++;
    try { return await f(); } finally { this.active--; this.waiting.shift()?.(); }
  }
  get inFlight(): number { return this.active; }
}
export const MAX_CONCURRENT_SPAWNS = 3;

/** Wrap a Ruflo so only `allow`ed tools can be called, and at most `sem.max` calls run concurrently. */
export function guard(inner: Ruflo, allow: ReadonlySet<string>, sem: Semaphore, argRules?: (tool: string, params: Record<string, unknown> | undefined) => boolean): Ruflo {
  return {
    mcp: async (tool, params, opts) => {
      if (!allow.has(tool)) throw new RufloError('tool_not_allowed', `ruflo tool "${tool.slice(0, 40)}" is not allowed here`);
      // A tool that is only a read with certain parameters (metaharness_flywheel {op:'status'}) is pinned to them.
      if (argRules && !argRules(tool, params)) throw new RufloError('params_not_allowed', `ruflo tool "${tool.slice(0, 40)}" is not allowed with these parameters`);
      return sem.run(() => inner.mcp(tool, params, opts));
    },
  };
}
