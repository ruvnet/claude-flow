import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

/**
 * A process target Node can spawn with `shell: false`.
 * The caller appends its own argv after `argsPrefix`.
 */
export interface BrowserLaunch {
  command: string;
  argsPrefix: string[];
}

export interface BrowserLaunchOptions {
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  lookup?: (command: string, args: string[]) => string;
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
}

/**
 * Windows npm shims (`agent-browser.cmd`, `npx.cmd`) are batch files. Node
 * cannot spawn them with `shell: false`, and `shell: true` joins argv with
 * spaces and hands the result to cmd.exe, so every tool-supplied value (a
 * `fill` value, an `eval` script, a selector) becomes shell syntax. Resolve
 * the shim to the JavaScript entry point (or native executable) behind it and
 * spawn that directly, so argv reaches the process as literal data.
 *
 * A target ending in `.cmd` or `.bat` is never returned: spawning one implies
 * cmd.exe regardless of the `shell` option.
 */
const BATCH_TARGET = /\.(cmd|bat)$/i;

function defaults(options: BrowserLaunchOptions) {
  const platform = options.platform ?? process.platform;
  return {
    platform,
    path: platform === 'win32' ? win32 : posix,
    nodeExecutable: options.nodeExecutable ?? process.execPath,
    lookup: options.lookup ?? ((command: string, args: string[]) =>
      execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })),
    fileExists: options.fileExists ?? existsSync,
    readFile: options.readFile ?? ((file: string) => readFileSync(file, 'utf8')),
  };
}

function whereAll(lookup: (command: string, args: string[]) => string, name: string): string[] {
  try {
    return lookup('where.exe', [name])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** `bin` of a package.json, resolved to a path that stays inside the package. */
function packageBinEntry(
  packageRoot: string,
  binName: string,
  d: ReturnType<typeof defaults>,
): string | null {
  let manifest: { bin?: string | Record<string, string> };
  try {
    manifest = JSON.parse(d.readFile(d.path.join(packageRoot, 'package.json')));
  } catch {
    return null;
  }
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (typeof relative !== 'string' || !relative) return null;

  const entry = d.path.resolve(packageRoot, relative);
  const rootWithSep = d.path.resolve(packageRoot) + d.path.sep;
  if (!entry.startsWith(rootWithSep)) return null;
  return d.fileExists(entry) ? entry : null;
}

/**
 * Locate a globally installed `agent-browser`.
 * POSIX: the command name itself (spawned without a shell, as before).
 * Windows: a native `.exe`, or `node <entry.js>` behind the npm shim; null when
 * neither can be resolved without a shell.
 */
export function resolveAgentBrowserLaunch(options: BrowserLaunchOptions = {}): BrowserLaunch | null {
  const d = defaults(options);
  if (d.platform !== 'win32') return { command: 'agent-browser', argsPrefix: [] };

  const matches = whereAll(d.lookup, 'agent-browser');

  const executable = matches.find((candidate) =>
    d.path.extname(candidate).toLowerCase() === '.exe' && d.fileExists(candidate));
  if (executable) return { command: executable, argsPrefix: [] };

  for (const shim of matches) {
    const packageRoot = d.path.join(d.path.dirname(shim), 'node_modules', 'agent-browser');
    const entry = packageBinEntry(packageRoot, 'agent-browser', d);
    if (!entry || BATCH_TARGET.test(entry)) continue;
    if (d.path.extname(entry).toLowerCase() === '.exe') return { command: entry, argsPrefix: [] };
    return { command: d.nodeExecutable, argsPrefix: [entry] };
  }
  return null;
}

/**
 * Locate `npx` for the `npx --yes agent-browser` fallback.
 * POSIX: `npx` itself. Windows: `node <npm>/bin/npx-cli.js`, taken from the
 * running Node's own npm or from the npm that `where.exe npx` points at.
 */
export function resolveNpxLaunch(options: BrowserLaunchOptions = {}): BrowserLaunch | null {
  const d = defaults(options);
  if (d.platform !== 'win32') return { command: 'npx', argsPrefix: [] };

  const roots = [
    d.path.dirname(d.nodeExecutable),
    ...whereAll(d.lookup, 'npx').map((shim) => d.path.dirname(shim)),
  ];
  for (const root of roots) {
    const entry = d.path.join(root, 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (d.fileExists(entry)) return { command: d.nodeExecutable, argsPrefix: [entry] };
  }
  return null;
}
