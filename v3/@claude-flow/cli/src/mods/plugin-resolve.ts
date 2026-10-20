/**
 * Whether Claude Code can actually load the ruflo mod plugins (ADR-404).
 *
 * `enabledPlugins["ruflo-mods@ruflo"] = true` in settings is only a request.
 * Observed live on Claude Code 2.1.287: an interactive, trusted session clones
 * the `ruflo` marketplace a project declares and loads an enabled plugin
 * straight from that clone (no install record needed); a headless `-p` run
 * clones nothing. A clone from before ruflo-mods shipped has no
 * `plugins/ruflo-mods`, and Claude Code skips the enabled plugin without a
 * word: `/ruflo-mods` is an unknown command, and the clone is not refreshed
 * on start. So the clone decides; an install record (`installed_plugins.json`,
 * pointing into `plugins/cache/`) is a cached copy that still loads when the
 * clone goes stale.
 *
 * Read-only. The config directory is `CLAUDE_CONFIG_DIR` when set, else
 * `~/.claude`, as Claude Code itself resolves it.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { MARKETPLACE_NAME, MARKETPLACE_SOURCE, MOD_PLUGINS, type MarketplaceEntry, type ModPlugin, type Scope } from './install.js';
import type { Finding } from './probe.js';

/** The two filesystem reads detection needs; injectable for tests. */
export interface ReadFs {
  exists(path: string): boolean;
  readText(path: string): string | undefined;
}

export const nodeReadFs: ReadFs = {
  exists: (p) => existsSync(p),
  readText: (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  },
};

export function claudeConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.CLAUDE_CONFIG_DIR || join(home, '.claude');
}

function readJson(fs: ReadFs, path: string): unknown {
  const text = fs.readText(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const nameOf = (id: string) => id.split('@')[0]!;

export interface MarketplaceState {
  /** Listed in known_marketplaces.json (so `marketplace update ruflo` works). */
  known: boolean;
  /** The local clone (or, for a directory source, the directory), when it exists on disk. */
  location: string | null;
  /** The source Claude Code knows the marketplace by, when known. */
  source?: MarketplaceEntry['source'];
}

/** "github ruvnet/ruflo" or "directory /path" (a working tree: no clone, nothing to go stale). */
export function describeSource(source: unknown): string {
  if (!isRecord(source)) return 'unknown source';
  if (source.source === 'directory') return `directory ${String(source.path)}`;
  if (source.source === 'github') return `github ${String(source.repo)}`;
  return String(source.source ?? 'unknown source');
}

export function sameSource(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b) || a.source !== b.source) return false;
  return a.source === 'directory' ? resolve(String(a.path)) === resolve(String(b.path)) : a.repo === b.repo;
}

export function marketplaceState(configDir: string, fs: ReadFs = nodeReadFs): MarketplaceState {
  const known = readJson(fs, join(configDir, 'plugins', 'known_marketplaces.json'));
  const entry = isRecord(known) ? known[MARKETPLACE_NAME] : undefined;
  const declared = isRecord(entry) && typeof entry.installLocation === 'string' ? entry.installLocation : undefined;
  const candidates = [declared, join(configDir, 'plugins', 'marketplaces', MARKETPLACE_NAME)].filter((p): p is string => !!p);
  const source = isRecord(entry) && isRecord(entry.source) ? (entry.source as MarketplaceEntry['source']) : undefined;
  return { known: isRecord(entry), location: candidates.find((p) => fs.exists(p)) ?? null, source };
}

/** The plugin's manifest inside a clone: its marketplace.json `source`, else plugins/<name>. */
export function pluginManifestIn(clone: string, id: string, fs: ReadFs = nodeReadFs): string {
  const catalog = readJson(fs, join(clone, '.claude-plugin', 'marketplace.json'));
  const listed = isRecord(catalog) && Array.isArray(catalog.plugins)
    ? catalog.plugins.find((p) => isRecord(p) && p.name === nameOf(id))
    : undefined;
  const source = isRecord(listed) && typeof listed.source === 'string' ? listed.source : `./plugins/${nameOf(id)}`;
  return join(clone, source, '.claude-plugin', 'plugin.json');
}

/** The clone carries this plugin. */
export function cloneHas(market: MarketplaceState, id: string, fs: ReadFs = nodeReadFs): boolean {
  return market.location !== null && fs.exists(pluginManifestIn(market.location, id, fs));
}

export interface InstalledState {
  installed: boolean;
  scope?: string;
  installPath?: string;
}

function sameDir(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/** Installed for this project: user scope anywhere, local/project scope for this root; its cache dir present. */
export function installedState(projectRoot: string, configDir: string, id: string, fs: ReadFs = nodeReadFs): InstalledState {
  const record = readJson(fs, join(configDir, 'plugins', 'installed_plugins.json'));
  const plugins = isRecord(record) && isRecord(record.plugins) ? record.plugins : undefined;
  const entries = plugins && Array.isArray(plugins[id]) ? (plugins[id] as unknown[]) : [];
  for (const e of entries) {
    if (!isRecord(e) || typeof e.installPath !== 'string' || !fs.exists(e.installPath)) continue;
    const forHere = e.scope === 'user' || (typeof e.projectPath === 'string' && sameDir(e.projectPath, projectRoot));
    if (forHere) return { installed: true, scope: String(e.scope), installPath: e.installPath };
  }
  return { installed: false };
}

/**
 * The exact commands that refresh the marketplace and install the plugins,
 * for a person to run. `known` is true only when Claude Code already knows
 * the marketplace by the wanted source (then an update suffices). A
 * directory source loads live from the working tree: nothing to install.
 */
export function repairCommands(
  projectRoot: string,
  scope: Scope | 'user',
  known: boolean,
  plugins: readonly ModPlugin[] = MOD_PLUGINS,
  wanted: MarketplaceEntry = MARKETPLACE_SOURCE,
): string[] {
  const dir = wanted.source.source === 'directory' ? wanted.source.path : null;
  return [
    `cd ${JSON.stringify(resolve(projectRoot))}`,
    known
      ? `claude plugin marketplace update ${MARKETPLACE_NAME}`
      : `claude plugin marketplace add ${dir ? JSON.stringify(dir) : 'ruvnet/ruflo'} --scope ${scope}`,
    ...(dir ? [] : plugins.filter((p) => p.required).map((p) => `claude plugin install ${p.id} --scope ${scope}`)),
  ];
}

/**
 * The marketplace finding plus one finding per plugin enabled in settings.
 * A required plugin missing from the clone with no cached install is the
 * failure Claude Code hides; a plugin not yet released is "pending".
 */
export function resolveFindings(
  projectRoot: string,
  scope: Scope | 'user',
  configDir: string,
  fs: ReadFs = nodeReadFs,
  enabled: readonly string[] = MOD_PLUGINS.map((p) => p.id),
  declared?: unknown,
): Finding[] {
  const market = marketplaceState(configDir, fs);
  const wanted = (isRecord(declared) && isRecord(declared.source) ? declared : MARKETPLACE_SOURCE) as MarketplaceEntry;
  const matches = market.known && sameSource(market.source, wanted.source);
  const fix = repairCommands(projectRoot, scope, matches, MOD_PLUGINS.filter((p) => enabled.includes(p.id)), wanted).join(' && ');
  const findings: Finding[] = [];
  const kind = market.source?.source === 'directory' ? 'directory (loads live from the working tree)' : `cloned at ${market.location}`;

  findings.push(market.location && market.known && !sameSource(market.source, wanted.source)
    ? {
      name: 'ruflo marketplace',
      status: 'warn',
      message: `this project declares ${describeSource(wanted.source)}, but Claude Code knows ruflo as ${describeSource(market.source)} (one ruflo marketplace per config dir)`,
      fix,
    }
    : market.location
    ? { name: 'ruflo marketplace', status: 'pass', message: `${describeSource(market.source ?? wanted.source)}: ${kind}` }
    : {
      name: 'ruflo marketplace',
      status: 'warn',
      message: `not cloned under ${join(configDir, 'plugins')}: Claude Code clones it at the next interactive start of a trusted session (headless -p runs do not)`,
      fix,
    });

  for (const plugin of MOD_PLUGINS.filter((p) => enabled.includes(p.id))) {
    const name = `plugin ${plugin.id}`;
    const installed = installedState(projectRoot, configDir, plugin.id, fs);
    const also = installed.installed ? `; also installed (${installed.scope} scope)` : '';
    if (cloneHas(market, plugin.id, fs)) {
      findings.push({ name, status: 'pass', message: `loads from the marketplace clone${also}` });
    } else if (!market.location) {
      findings.push(installed.installed
        ? { name, status: 'pass', message: `installed (${installed.scope} scope, ${installed.installPath})` }
        : plugin.required
          ? { name, status: 'warn', message: 'loads once Claude Code has cloned the marketplace (a headless `claude -p` run on a fresh config does not clone it, so the mod is absent there)', fix }
          : { name, status: 'warn', message: 'pending: not released in the ruflo marketplace yet' });
    } else if (!plugin.required) {
      findings.push({ name, status: 'warn', message: `pending: not in the ruflo marketplace yet (${market.location})${also}` });
    } else if (installed.installed) {
      findings.push({ name, status: 'warn', message: `the clone at ${market.location} is stale (no ${nameOf(plugin.id)}); the cached install still loads`, fix });
    } else {
      findings.push({
        name,
        status: 'fail',
        message: `the clone at ${market.location} is stale: it predates ${nameOf(plugin.id)}, so Claude Code skips the enabled plugin without a word${plugin.id.startsWith('ruflo-mods@') ? ' (/ruflo-mods is an unknown command)' : ''}`,
        fix,
      });
    }
  }
  return findings;
}
