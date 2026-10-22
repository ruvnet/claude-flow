/**
 * #4055: native addons compiled against Node >= 24.19 headers abort when a
 * garbage-collected ObjectWrap (a better-sqlite3 Statement) calls
 * RemoveEnvironmentCleanupHook() with no Environment (nodejs/node#65446).
 * The fix (abe1b673e9b, PR #65943) was in no release through v24.21.0.
 *
 * Only copies that were COMPILED LOCALLY carry a build/config.gypi naming the
 * headers they were built against; prebuilt binaries (prebuild-install) do not,
 * so they are never flagged. The check is read-only and never loads an addon.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface NativeAddonCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

const NAME = 'Native addon headers (Node 24)';

function parse(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Node 24.19.0 up to, but not including, 24.22.0. Re-check this bound when a release ships the fix. */
export function isAffectedNodeVersion(version: string): boolean {
  const v = parse(version);
  if (!v || v[0] !== 24) return false;
  return v[1] >= 19 && v[1] <= 21;
}

/** The Node version of the headers a copy was built against, from its config.gypi. */
export function headersVersionFromGypi(gypi: string): string | null {
  const field = /["']node_version["']\s*:\s*["']v?(\d+\.\d+\.\d+)["']/.exec(gypi);
  if (field) return field[1];
  const dir = /["']nodedir["']\s*:\s*["']([^"']*)["']/.exec(gypi);
  if (!dir) return null;
  const all = [...dir[1].matchAll(/(\d+)\.(\d+)\.(\d+)/g)];
  const last = all[all.length - 1];
  return last ? `${last[1]}.${last[2]}.${last[3]}` : null;
}

function readJson(path: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

function listDir(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}

/** `better-sqlite3` copies in node_modules next to, or one level under, each ancestor of the start dirs. */
export function findBetterSqlite3Copies(startDirs: string[], maxDepth = 12): string[] {
  const found = new Set<string>();
  const add = (dir: string) => {
    if (!existsSync(join(dir, 'package.json'))) return;
    try { found.add(realpathSync(dir)); } catch { /* unreadable */ }
  };
  const scanNodeModules = (nm: string) => {
    add(join(nm, 'better-sqlite3'));
    for (const entry of listDir(nm)) {
      if (entry.startsWith('.') || entry === 'better-sqlite3') continue;
      if (entry.startsWith('@')) {
        for (const sub of listDir(join(nm, entry))) add(join(nm, entry, sub, 'node_modules', 'better-sqlite3'));
      } else {
        add(join(nm, entry, 'node_modules', 'better-sqlite3'));
      }
    }
  };
  for (const start of startDirs) {
    let dir = resolve(start);
    for (let i = 0; i < maxDepth; i++) {
      scanNodeModules(join(dir, 'node_modules'));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return [...found].sort();
}

export interface NativeAddonCheckDeps {
  /** Runtime version, default process.versions.node. */
  nodeVersion?: string;
  /** Exact better-sqlite3 package directories to inspect (skips discovery). */
  copies?: string[];
  /** Directories to walk up from when discovering copies. */
  startDirs?: string[];
}

const FIX = [
  'Use a Node release that contains nodejs/node#65943 (not in any release through 24.21.0), or Node 22 / 24.18.1;',
  'or rebuild each listed copy against 24.18.1 headers:',
  'cd <copy> && npx node-gyp rebuild --release --nodedir=<path to node 24.18.1 headers> ;',
  'or install the 12.x prebuilt (npm install better-sqlite3@12 in the project).',
  'ruflo itself opens AgentDB through its own prebuilt 12.x copy, so a flagged nested copy matters only to code that loads it directly.',
].join(' ');

/** Read-only: warn when a locally compiled better-sqlite3 was built against Node >= 24.19 headers on an affected runtime. */
export async function checkNativeAddonHeaders(deps: NativeAddonCheckDeps = {}): Promise<NativeAddonCheck> {
  const nodeVersion = deps.nodeVersion ?? process.versions.node;
  if (!isAffectedNodeVersion(nodeVersion)) {
    return { name: NAME, status: 'pass', message: `Node ${nodeVersion} is not in the affected range (24.19.0-24.21.x)` };
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const copies = deps.copies ?? findBetterSqlite3Copies(deps.startDirs ?? [here, process.cwd()]);
  if (copies.length === 0) {
    return { name: NAME, status: 'pass', message: `Node ${nodeVersion}: no better-sqlite3 copy found to inspect` };
  }
  const bad: string[] = [];
  for (const copy of copies) {
    let gypi: string;
    try { gypi = readFileSync(join(copy, 'build', 'config.gypi'), 'utf8'); } catch { continue; }
    const headers = headersVersionFromGypi(gypi);
    const parsed = headers ? parse(headers) : null;
    if (!parsed || parsed[0] !== 24 || parsed[1] < 19) continue;
    const version = readJson(join(copy, 'package.json'))?.version;
    bad.push(`${copy} (better-sqlite3 ${typeof version === 'string' ? version : '?'}, built against Node ${headers} headers)`);
  }
  if (bad.length === 0) {
    return { name: NAME, status: 'pass', message: `Node ${nodeVersion}: ${copies.length} better-sqlite3 cop${copies.length === 1 ? 'y' : 'ies'} checked, none built against 24.19+ headers` };
  }
  return {
    name: NAME,
    status: 'warn',
    message: `Node ${nodeVersion} can abort ("Assertion failed: (env) != nullptr", nodejs/node#65446) in: ${bad.join('; ')}`,
    fix: FIX,
  };
}
