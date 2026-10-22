/**
 * After settings are written, make the mod plugins loadable the way a person
 * would (ADR-404): refresh (or add) the `ruflo` marketplace clone, then
 * `claude plugin install <id> --scope <scope>` for each plugin the clone
 * carries. The refreshed clone is what makes a plugin load; the install adds
 * a cached copy (and the `claude plugin list` entry) that survives a later
 * stale clone.
 *
 * Fixed argv through execFile, never a shell; each step bounded. The `add`
 * step passes `--scope` so the marketplace is declared in the same settings
 * file ruflo already wrote, not in user settings. `~/.claude.json` is never
 * touched by ruflo. No `-y`: a marketplace-declared command is never accepted
 * on a person's behalf.
 */

import { execFile } from 'node:child_process';

import { findClaudeInstalls } from './claude-installs.js';
import { MARKETPLACE_NAME, MARKETPLACE_SOURCE, MOD_PLUGINS, type MarketplaceEntry, type ModPlugin, type Scope } from './install.js';
import { cloneHas, marketplaceState, nodeReadFs, sameSource, type ReadFs } from './plugin-resolve.js';

export const MARKETPLACE_TIMEOUT_MS = 150_000; // Claude Code's own clone timeout is 120s
export const INSTALL_TIMEOUT_MS = 60_000;

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (file: string, args: readonly string[], opts: { cwd: string; timeout: number; env: NodeJS.ProcessEnv }) => Promise<ExecResult>;

export const nodeExec: Exec = (file, args, opts) =>
  new Promise((done) => {
    execFile(file, [...args], { ...opts, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      // error.code is the exit status, or a string (ENOENT, ...) when it never ran; a timeout kills it.
      const status = (error as { code?: unknown } | null)?.code;
      const code = !error ? 0 : typeof status === 'number' && status !== 0 ? status : 1;
      done({ code, stdout: String(stdout), stderr: String(stderr) || (error ? error.message : '') });
    });
  });

/** The `claude` a shell would run, when it can be exec'd without a shell. */
export function findClaudeBinary(env: NodeJS.ProcessEnv, home: string): string | null {
  const first = findClaudeInstalls(env, home, () => null)[0];
  if (!first) return null;
  // A .cmd shim needs a shell to run; ruflo never uses one.
  return process.platform === 'win32' && !first.path.toLowerCase().endsWith('.exe') ? null : first.path;
}

export type StepState = 'ok' | 'failed' | 'pending';

export interface RepairStep {
  argv: string[];
  state: StepState;
  output: string;
}

export interface RepairOptions {
  projectRoot: string;
  scope: Scope;
  /** Claude Code's config directory, read after the marketplace step to see what the clone carries. */
  configDir: string;
  claude: string;
  plugins?: readonly ModPlugin[];
  /** The marketplace the settings declare (default github ruvnet/ruflo). */
  marketplace?: MarketplaceEntry;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
  fs?: ReadFs;
}

/**
 * `update` when Claude Code already knows ruflo by the wanted source; else
 * `add` it at the scope, which also switches a ruflo marketplace known by
 * another source (Claude Code keeps one per config dir).
 */
export function marketplaceArgv(scope: Scope, known: boolean, wanted: MarketplaceEntry = MARKETPLACE_SOURCE): string[] {
  if (known) return ['plugin', 'marketplace', 'update', MARKETPLACE_NAME];
  const from = wanted.source.source === 'directory' ? wanted.source.path : wanted.source.repo;
  return ['plugin', 'marketplace', 'add', from, '--scope', scope];
}

export function uninstallArgv(id: string, scope: Scope): string[] {
  return ['plugin', 'uninstall', id, '--scope', scope];
}

export function installArgv(id: string, scope: Scope): string[] {
  return ['plugin', 'install', id, '--scope', scope];
}

/**
 * Marketplace first (a failure there stops everything: nothing below can
 * work); then one install per plugin, every failure collected. A plugin the
 * refreshed clone does not carry is pending when not required, a failure when
 * required.
 */
export async function repairPluginInstall(opts: RepairOptions): Promise<{ ok: boolean; steps: RepairStep[] }> {
  const exec = opts.exec ?? nodeExec;
  const env = opts.env ?? process.env;
  const fs = opts.fs ?? nodeReadFs;
  const plugins = opts.plugins ?? MOD_PLUGINS;
  const steps: RepairStep[] = [];
  const run = async (argv: string[], timeout: number): Promise<boolean> => {
    let result: ExecResult;
    try {
      result = await exec(opts.claude, argv, { cwd: opts.projectRoot, timeout, env });
    } catch (error) {
      result = { code: 1, stdout: '', stderr: (error as Error).message };
    }
    steps.push({ argv, state: result.code === 0 ? 'ok' : 'failed', output: `${result.stdout}${result.stderr}`.trim() });
    return result.code === 0;
  };

  const wanted = opts.marketplace ?? MARKETPLACE_SOURCE;
  const before = marketplaceState(opts.configDir, fs);
  if (!(await run(marketplaceArgv(opts.scope, before.known && sameSource(before.source, wanted.source), wanted), MARKETPLACE_TIMEOUT_MS))) {
    return { ok: false, steps };
  }
  const market = marketplaceState(opts.configDir, fs);
  // A directory marketplace loads each plugin live from the working tree;
  // an install would pin a cached snapshot of it instead.
  if (wanted.source.source === 'directory') {
    const missing = plugins.filter((p) => p.required && !cloneHas(market, p.id, fs));
    for (const p of missing) steps.push({ argv: installArgv(p.id, opts.scope), state: 'failed', output: `${p.id} is not in ${wanted.source.path}` });
    return { ok: missing.length === 0, steps };
  }
  let ok = true;
  for (const plugin of plugins) {
    const argv = installArgv(plugin.id, opts.scope);
    if (!cloneHas(market, plugin.id, fs)) {
      steps.push({ argv, state: plugin.required ? 'failed' : 'pending', output: `${plugin.id} is not in the ruflo marketplace${plugin.required ? ' even after the update' : ' yet (pending)'}` });
      ok &&= !plugin.required;
      continue;
    }
    ok = (await run(argv, INSTALL_TIMEOUT_MS)) && ok;
  }
  return { ok, steps };
}

/** `claude plugin uninstall` for each id, every failure collected. */
export async function uninstallPlugins(opts: { projectRoot: string; scope: Scope; ids: readonly string[]; claude: string; exec?: Exec; env?: NodeJS.ProcessEnv }): Promise<{ ok: boolean; steps: RepairStep[] }> {
  const exec = opts.exec ?? nodeExec;
  const steps: RepairStep[] = [];
  for (const id of opts.ids) {
    const argv = uninstallArgv(id, opts.scope);
    let result: ExecResult;
    try {
      result = await exec(opts.claude, argv, { cwd: opts.projectRoot, timeout: INSTALL_TIMEOUT_MS, env: opts.env ?? process.env });
    } catch (error) {
      result = { code: 1, stdout: '', stderr: (error as Error).message };
    }
    steps.push({ argv, state: result.code === 0 ? 'ok' : 'failed', output: `${result.stdout}${result.stderr}`.trim() });
  }
  return { ok: steps.every((st) => st.state === 'ok'), steps };
}
