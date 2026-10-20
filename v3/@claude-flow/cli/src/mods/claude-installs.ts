/**
 * Which Claude Code binaries a shell would find, and whether the one it runs
 * can load mods (ADR-404). Mods are on by default from Claude Code 2.1.287;
 * from 2.1.277 they load with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1; older
 * builds predate them. A server-side rollout switch can still hold them off
 * on any version (reported separately). A stale install earlier on PATH
 * (a 2.1.107 npm-global beside a current native one, say) silently decides.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const MODS_DEFAULT_ON = '2.1.287';
export const MODS_FIRST = '2.1.277';

export interface ClaudeInstall {
  path: string;
  version: string | null;
}

export type VersionOf = (path: string) => string | null;

const parse = (v: string) => v.split('.').map((n) => Number(n));
/** a < b for dotted numeric versions. */
export function versionLess(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return false;
}

/** `claude --version` of one binary, bounded; null when it cannot say. */
export const defaultVersionOf: VersionOf = (path) => {
  try {
    const out = execFileSync(path, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
  } catch {
    return null;
  }
};

/** Every `claude` on PATH, in PATH order (the first is what runs), plus ~/.local/bin. */
export function findClaudeInstalls(env: NodeJS.ProcessEnv, home: string, versionOf: VersionOf = defaultVersionOf): ClaudeInstall[] {
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), join(home, '.local', 'bin')];
  const seen = new Set<string>();
  const installs: ClaudeInstall[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      const path = join(dir, name);
      let real: string;
      try {
        if (!existsSync(path) || !statSync(path).isFile()) continue;
        real = realpathSync(path);
      } catch {
        continue;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      installs.push({ path, version: versionOf(path) });
    }
  }
  return installs;
}

export interface InstallsFinding {
  status: 'pass' | 'warn';
  message: string;
  fix?: string;
}

/** The doctor's reading of what `claude` resolves to and what else is installed. */
export function judgeInstalls(installs: readonly ClaudeInstall[], enableEnvSet: boolean): InstallsFinding {
  if (installs.length === 0) return { status: 'warn', message: 'no claude binary on PATH', fix: 'install Claude Code >= 2.1.287' };
  const [first] = installs;
  const others = installs.slice(1).filter((i) => i.version !== first!.version);
  const mixed = others.length
    ? `; also installed: ${others.map((i) => `${i.path} (${i.version ?? 'unknown'})`).join(', ')}. The first on PATH runs; a stale one can shadow a current one.`
    : '';
  const runs = `${first!.path} (${first!.version ?? 'version unknown'})`;
  if (!first!.version) return { status: 'warn', message: `claude resolves to ${runs}${mixed}`, fix: `run \`${first!.path} --version\` and reinstall Claude Code if it prints nothing` };
  if (!versionLess(first!.version, MODS_DEFAULT_ON)) {
    return others.length
      ? { status: 'warn', message: `claude resolves to ${runs}: mods on by default${mixed}`, fix: `put the claude you want first on PATH, or remove: ${others.map((i) => i.path).join(' ')}` }
      : { status: 'pass', message: `claude resolves to ${runs}: mods on by default` };
  }
  if (!versionLess(first!.version, MODS_FIRST)) {
    return enableEnvSet
      ? (others.length
        ? { status: 'warn' as const, message: `claude resolves to ${runs}: mods load with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (set)${mixed}`, fix: `put the claude you want first on PATH, or remove: ${others.map((i) => i.path).join(' ')}` }
        : { status: 'pass' as const, message: `claude resolves to ${runs}: mods load with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (set)` })
      : { status: 'warn', message: `claude resolves to ${runs}: below ${MODS_DEFAULT_ON}, mods need CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (not set)${mixed}`, fix: `upgrade to >= ${MODS_DEFAULT_ON}, or export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` };
  }
  return { status: 'warn', message: `claude resolves to ${runs}: predates mods (< ${MODS_FIRST}); classic hooks handle every event${mixed}`, fix: `upgrade to >= ${MODS_DEFAULT_ON} and remove the stale install from PATH` };
}
