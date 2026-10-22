/**
 * `ruflo mods install|uninstall` (ADR-404): enable the ruflo mods for one
 * project, and take back exactly what was added.
 *
 * Writes three kinds of key in a Claude Code settings file: one
 * `enabledPlugins` entry per plugin in MOD_PLUGINS, the `ruflo` entry of
 * `extraKnownMarketplaces` when absent, and `env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`.
 * `ruflo init` writes them to the committed `.claude/settings.json` (project
 * scope); a standalone `ruflo mods install` defaults to
 * `.claude/settings.local.json`. What was added is recorded per settings file
 * in `.claude-flow/mods/install.json`, so uninstall removes those and nothing
 * a person set themselves. Classic hooks are never touched: they stay the
 * fallback (a mod takes an event over at runtime only).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export const MOD_PLUGIN_ID = 'ruflo-mods@ruflo';
export const MARKETPLACE_NAME = 'ruflo';
export const MARKETPLACE_SOURCE = { source: { source: 'github', repo: 'ruvnet/ruflo' } } as const;

/** An `extraKnownMarketplaces` entry: github ruvnet/ruflo, or a local ruflo checkout (dogfooding). */
export type MarketplaceEntry = { source: { source: 'github'; repo: string } | { source: 'directory'; path: string } };

export function directoryMarketplace(path: string): MarketplaceEntry {
  return { source: { source: 'directory', path: resolve(path) } };
}
export const ENABLE_ENV = 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS';
export const INSTALL_RECORD = join('.claude-flow', 'mods', 'install.json');

export interface ModPlugin {
  id: string;
  /**
   * Missing from a ruflo marketplace clone means the clone is stale (a
   * failure). A plugin not yet released on main is `required: false`: missing
   * is "pending", never a failure. Flip it once the plugin lands.
   */
  required: boolean;
}

/** Every plugin `ruflo mods install` and `ruflo init` enable. The one list to edit. */
export const MOD_PLUGINS: readonly ModPlugin[] = [
  { id: MOD_PLUGIN_ID, required: true },
  { id: 'ruflo-swarm@ruflo', required: true },
  { id: 'ruflo-console@ruflo', required: true },
];
export const MOD_PLUGIN_IDS: readonly string[] = MOD_PLUGINS.map((p) => p.id);

export type Scope = 'local' | 'project';

export interface Added {
  plugins: string[];
  marketplace: boolean;
  env: boolean;
  /**
   * Plugins ruflo itself installed with `claude plugin install` (absent
   * before, enabled by ruflo); uninstall runs `claude plugin uninstall` for
   * exactly these.
   */
  claudeInstalled?: string[];
}

export interface InstallRecord {
  version: 2;
  installedAt: string;
  /** What install added, per settings file it wrote. */
  files: Record<string, Added>;
}

type Settings = Record<string, unknown> & {
  enabledPlugins?: Record<string, unknown>;
  extraKnownMarketplaces?: Record<string, unknown>;
  env?: Record<string, unknown>;
};

export function settingsFileFor(projectRoot: string, scope: Scope): string {
  return join(resolve(projectRoot), '.claude', scope === 'local' ? 'settings.local.json' : 'settings.json');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Reads a settings file; absent is `{}`, anything unparseable throws (never overwritten). */
export function readSettingsFile(path: string): Settings {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed as Settings;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

const nothingAdded = (a: Added) => a.plugins.length === 0 && !a.marketplace && !a.env;

/** The settings after install, and what install added (pure). Existing values are kept. */
export function withModEnabled(settings: Settings, plugins: readonly string[] = MOD_PLUGIN_IDS, marketplace: MarketplaceEntry = MARKETPLACE_SOURCE): { next: Settings; added: Added } {
  const next: Settings = { ...settings };
  const enabled = isRecord(settings.enabledPlugins) ? { ...settings.enabledPlugins } : {};
  const markets = isRecord(settings.extraKnownMarketplaces) ? { ...settings.extraKnownMarketplaces } : {};
  const env = isRecord(settings.env) ? { ...settings.env } : {};
  // A plugin a person set to false is their decision: never flipped.
  const added: Added = {
    plugins: plugins.filter((id) => !(id in enabled)),
    marketplace: !(MARKETPLACE_NAME in markets),
    env: !(ENABLE_ENV in env),
  };
  for (const id of added.plugins) enabled[id] = true;
  if (added.marketplace) markets[MARKETPLACE_NAME] = marketplace;
  if (added.env) env[ENABLE_ENV] = '1';
  next.enabledPlugins = enabled;
  next.extraKnownMarketplaces = markets;
  next.env = env;
  return { next, added };
}

/** The settings after uninstall: only what the record says install added (pure). */
export function withModRemoved(settings: Settings, added: Added): Settings {
  const next: Settings = { ...settings };
  const drop = (key: 'enabledPlugins' | 'extraKnownMarketplaces' | 'env', name: string) => {
    const section = next[key];
    if (!isRecord(section)) return;
    const copy = { ...section };
    delete copy[name];
    if (Object.keys(copy).length === 0) delete next[key];
    else next[key] = copy;
  };
  for (const id of added.plugins) drop('enabledPlugins', id);
  if (added.marketplace) drop('extraKnownMarketplaces', MARKETPLACE_NAME);
  if (added.env) drop('env', ENABLE_ENV);
  return next;
}

export interface InstallResult {
  settingsFile: string;
  backup?: string;
  /** What this run added (empty on a re-run). */
  added: Added;
  dryRun: boolean;
  next: Settings;
}

export function installMod(
  projectRoot: string,
  scope: Scope,
  dryRun = false,
  plugins: readonly string[] = MOD_PLUGIN_IDS,
  marketplace: MarketplaceEntry = MARKETPLACE_SOURCE,
): InstallResult {
  const settingsFile = settingsFileFor(projectRoot, scope);
  const current = readSettingsFile(settingsFile);
  const { next, added } = withModEnabled(current, plugins, marketplace);
  if (dryRun || nothingAdded(added)) return { settingsFile, added, dryRun, next };

  let backup: string | undefined;
  if (existsSync(settingsFile)) {
    backup = `${settingsFile}.bak-ruflo-mods-${Date.now()}`;
    copyFileSync(settingsFile, backup);
  }
  // One operation: the settings and the record that lets uninstall take them back are written together.
  // If the record cannot be written, the settings go back as they were (or the file ruflo created goes
  // away), so nothing is left half-installed with no record to remove it by.
  try {
    writeJson(settingsFile, next);
    // What ruflo added once is still ruflo's to remove: merge into the record.
    const record = readRecord(projectRoot) ?? { version: 2, installedAt: '', files: {} };
    const before = record.files[settingsFile] ?? { plugins: [], marketplace: false, env: false };
    record.files[settingsFile] = {
      plugins: [...new Set([...before.plugins, ...added.plugins])],
      marketplace: before.marketplace || added.marketplace,
      env: before.env || added.env,
      claudeInstalled: before.claudeInstalled ?? [],
    };
    record.installedAt = new Date().toISOString();
    writeJson(join(resolve(projectRoot), INSTALL_RECORD), record);
  } catch (error) {
    try {
      if (backup) {
        copyFileSync(backup, settingsFile);
        unlinkSync(backup);
      } else if (existsSync(settingsFile)) {
        unlinkSync(settingsFile);
      }
    } catch {
      // the restore itself failed: the original error below is the one to report
    }
    throw error;
  }
  return { settingsFile, backup, added, dryRun, next };
}

/** The install record, v1 (3.50.0: one file, ruflo-mods only) read as v2. */
export function readRecord(projectRoot: string): InstallRecord | null {
  const path = join(resolve(projectRoot), INSTALL_RECORD);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (parsed.version === 2 && isRecord(parsed.files)) {
      const files: Record<string, Added> = {};
      for (const [file, a] of Object.entries(parsed.files)) {
        if (!isRecord(a)) continue;
        const strings = (v: unknown) => (Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []);
        files[file] = { plugins: strings(a.plugins), marketplace: a.marketplace === true, env: a.env === true, claudeInstalled: strings(a.claudeInstalled) };
      }
      return { version: 2, installedAt: String(parsed.installedAt ?? ''), files };
    }
    if (parsed.version === 1 && typeof parsed.settingsFile === 'string' && isRecord(parsed.added)) {
      const a = parsed.added;
      return { version: 2, installedAt: String(parsed.installedAt ?? ''), files: { [parsed.settingsFile]: { plugins: a.plugin === true ? [MOD_PLUGIN_ID] : [], marketplace: a.marketplace === true, env: a.env === true } } };
    }
    return null;
  } catch {
    return null;
  }
}

/** Note plugins ruflo installed with `claude plugin install` for one settings file. */
export function recordClaudeInstalled(projectRoot: string, settingsFile: string, ids: readonly string[]): void {
  const record = readRecord(projectRoot);
  const entry = record?.files[settingsFile];
  if (!record || !entry || ids.length === 0) return;
  entry.claudeInstalled = [...new Set([...(entry.claudeInstalled ?? []), ...ids])];
  writeJson(join(resolve(projectRoot), INSTALL_RECORD), record);
}

/** The scope a recorded settings file was written at. */
export function scopeOfSettingsFile(file: string): Scope {
  return file.endsWith('settings.local.json') ? 'local' : 'project';
}

export function uninstallMod(projectRoot: string, dryRun = false): { settingsFiles: string[]; removed: boolean; dryRun: boolean } {
  const record = readRecord(projectRoot);
  if (!record) return { settingsFiles: [], removed: false, dryRun };
  // The record names the files; never follow one outside this project.
  const root = resolve(projectRoot);
  const settingsFiles = Object.keys(record.files);
  for (const file of settingsFiles) {
    if (!resolve(file).startsWith(join(root, '.claude') + sep)) {
      throw new Error(`install record names a settings file outside ${root}/.claude: ${file}`);
    }
  }
  if (dryRun) return { settingsFiles, removed: true, dryRun };
  for (const file of settingsFiles) {
    if (existsSync(file)) writeJson(file, withModRemoved(readSettingsFile(file), record.files[file]!));
  }
  unlinkSync(join(root, INSTALL_RECORD));
  return { settingsFiles, removed: true, dryRun };
}
