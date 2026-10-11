/**
 * Local capability catalog, built from the plugin files Claude Code installed (never fetched). Same walk as the console's plugin catalog: plain names only,
 * confined paths, no links, 120 KB per file. Hashes are computed here from the bytes on disk; no digest a plugin ships is trusted. One unreadable or hostile
 * plugin is listed as `unreadable` and never takes the others down.
 */
import { realpathSync, lstatSync } from 'node:fs';
import { join, sep } from 'node:path';
import { CAPS_ENTRY, PLUGIN_ENTRY } from '../protocol/index.js';
import { sha256Hex } from './hash.js';
import { listDir, readRegular, readRegularBytes } from '../read.js';
import { classifyUnbound, DEFAULT_BINDINGS, type BindingTable } from './bindings.js';
import { classifyOption } from './options.js';
import type { Catalog, CatalogCap, CatalogPlugin, CapKind } from './types.js';

export const MAX_DOC_BYTES = 120_000;
/** Plain words only: no leading '.', '-' or '_' and no '..' anywhere. */
const NAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const PLUGIN = /^([a-z0-9][a-z0-9-]{0,63})@([a-z0-9][a-z0-9-]{0,63})$/;
const VERSION = /^\d+\.\d+\.\d+[-.\w]*$/;
export const MAX_VERSION_LEN = 40;
const OPTION_KEY = /^[A-Za-z][A-Za-z0-9]{0,47}$/;
export const TRUSTED_MARKETPLACE = 'ruflo';
/** The only source a marketplace named `ruflo` may have when known_marketplaces.json records one (more can be allowed in config.json). */
export const DEFAULT_MARKETPLACE_SOURCES: readonly string[] = ['github:ruvnet/ruflo'];
const MAX_PLUGINS = 120;
const MAX_CAPS = 400;
/** Bounds on one build: files read and wall-clock, so a hostile cache cannot hold the connector's thread. */
export const MAX_FILES_PER_BUILD = 6000;
export const BUILD_BUDGET_MS = 3000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export const sha12 = (data: string | Buffer): string => sha256Hex(data).slice(0, 12);

/** Content cache keyed by path, valid while (inode, size, mtime, ctime) are unchanged. ctime cannot be set by `utimes`, so a rewritten file does not hit. */
const statCache = new Map<string, { sig: string; text: string; sha12: string }>();
const CACHE_MAX = 20_000;
interface Pinned { text: string; sha12: string }
/** The file's text and hash (of the BYTES) if it is a regular file of at most MAX_DOC_BYTES; null otherwise. `cached` is for the catalog listing only: a run re-verifies uncached. */
export function readPinned(dir: string, rel: string, cached = false, budget?: { files: number }): Pinned | null {
  if (cached) {
    const key = join(dir, rel);
    const hit = statCache.get(key);
    if (hit) { try { const st = lstatSync(key); if (st.isFile() && hit.sig === `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`) return hit; } catch { statCache.delete(key); } }
  }
  if (budget && ++budget.files > MAX_FILES_PER_BUILD) return null;
  const f = readRegularBytes(dir, rel, MAX_DOC_BYTES);
  if (!f || f.size > MAX_DOC_BYTES || !f.sig) return null;
  const out = { text: f.buf.toString('utf8'), sha12: sha12(f.buf) };
  if (cached) { if (statCache.size >= CACHE_MAX) statCache.clear(); statCache.set(join(dir, rel), { sig: f.sig, ...out }); }
  return out;
}
function parseJson(text: string | undefined): Obj | null { try { const v = text ? (JSON.parse(text) as unknown) : null; return isObj(v) ? v : null; } catch { return null; } }

export interface Roots { configDir: string; cacheDir: string }
/** A home directory (`<home>/.claude`), or explicit roots (CLAUDE_CONFIG_DIR and a relocated plugin cache). */
export function rootsFor(h: string | Roots): Roots { if (typeof h !== 'string') return h; const configDir = join(h, '.claude'); return { configDir, cacheDir: join(configDir, 'plugins', 'cache') }; }
export function pluginCacheRoot(h: string | Roots): string | null { try { return realpathSync(rootsFor(h).cacheDir); } catch { return null; } }

export interface BuildOpts { only?: string; table?: BindingTable; /** Allowed `source` strings for a marketplace named ruflo ("github:owner/repo", "directory:/abs/path"). */ marketplaceSources?: readonly string[]; cached?: boolean }

function installedDirs(home: string | Roots): Array<{ id: string; dir: string; entryVersion: string }> {
  const root = pluginCacheRoot(home); if (!root) return [];
  const rec = readRegular(rootsFor(home).configDir, 'plugins/installed_plugins.json', 512 * 1024);
  const plugins = parseJson(rec?.text)?.plugins; if (!isObj(plugins)) return [];
  const out: Array<{ id: string; dir: string; entryVersion: string }> = [];
  for (const [id, list] of Object.entries(plugins).slice(0, MAX_PLUGINS)) {
    if (!PLUGIN.test(id) || !Array.isArray(list)) continue;
    const e = list.find((x): x is Obj => isObj(x) && x.scope === 'user') ?? list.find(isObj);
    if (!e || typeof e.installPath !== 'string') continue;
    try {
      const real = realpathSync(e.installPath);
      if (!real.startsWith(root + sep) || !lstatSync(real).isDirectory()) continue; // an install path outside the cache is never read
      out.push({ id, dir: real, entryVersion: typeof e.version === 'string' ? e.version : '' });
    } catch { /* gone */ }
  }
  return out;
}
function enabledSet(home: string | Roots): Set<string> {
  const s = parseJson(readRegular(rootsFor(home).configDir, 'settings.json', 512 * 1024)?.text)?.enabledPlugins;
  return new Set(isObj(s) ? Object.entries(s).filter(([, v]) => v === true).map(([k]) => k) : []);
}
/** "github:owner/repo" / "directory:/abs" for the marketplace as RECORDED by Claude Code, or null when it records none. */
export function recordedSource(home: string | Roots, marketplace: string): string | null {
  const m = parseJson(readRegular(rootsFor(home).configDir, 'plugins/known_marketplaces.json', 512 * 1024)?.text)?.[marketplace];
  const src = isObj(m) && isObj(m.source) ? m.source : null;
  if (!src || typeof src.source !== 'string') return null;
  const where = typeof src.repo === 'string' ? src.repo : typeof src.path === 'string' ? src.path : typeof src.url === 'string' ? src.url : '';
  return `${src.source}:${where}`.slice(0, 300);
}
/** A marketplace gets bindings only if it is named `ruflo` AND (when Claude Code records its source) the source is a local directory/file the user registered or an allowed remote repo. */
function trustedMarketplace(home: string | Roots, marketplace: string, allowed: readonly string[]): boolean {
  if (marketplace !== TRUSTED_MARKETPLACE) return false;
  const src = recordedSource(home, marketplace);
  // A directory/file source is a marketplace the user registered from their own disk (a development checkout); a remote one (github, git, url) must be an allowed repo.
  return src === null || src.startsWith('directory:') || src.startsWith('file:') || allowed.includes(src);
}

function unreadable(id: string, dir: string, enabled: boolean): CatalogPlugin {
  const [, name = '', marketplace = ''] = PLUGIN.exec(id) ?? [];
  return { id, name, marketplace, version: 'unknown', manifestSha: '', enabled, mod: false, foreign: marketplace !== TRUSTED_MARKETPLACE, why: 'unreadable', counts: { commands: 0, skills: 0, agents: 0, options: 0, mcp: 0 }, caps: [], options: [], dir };
}

function buildPlugin(id: string, dir: string, entryVersion: string, enabled: boolean, table: BindingTable, foreign: boolean, cached: boolean, budget: { files: number }): CatalogPlugin | null {
  const [, name = '', marketplace = ''] = PLUGIN.exec(id) ?? [];
  const man = readPinned(dir, '.claude-plugin/plugin.json', cached, budget); if (!man) return null;
  const manifest = parseJson(man.text); if (!manifest) return null;
  const okVersion = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_VERSION_LEN && VERSION.test(v);
  const version = okVersion(manifest.version) ? manifest.version : okVersion(entryVersion) ? entryVersion : '';
  const cmdNames = listDir(dir, 'commands').filter(e => !e.isDir && e.name.endsWith('.md') && NAME.test(e.name.slice(0, -3))).map(e => e.name.slice(0, -3)).sort().slice(0, 200);
  const skillNames = listDir(dir, 'skills').filter(e => e.isDir && NAME.test(e.name)).map(e => e.name).sort().slice(0, 200);
  const agentCount = listDir(dir, 'agents').filter(e => !e.isDir && e.name.endsWith('.md')).length;
  const mcp = parseJson(readRegular(dir, '.mcp.json', MAX_DOC_BYTES)?.text);
  const mcpCount = mcp ? Object.keys(isObj(mcp.mcpServers) ? mcp.mcpServers : mcp).length : 0;
  const uc = isObj(manifest.userConfig) ? manifest.userConfig : {};
  const optionKeys = Object.keys(uc).filter(k => OPTION_KEY.test(k)).slice(0, 60);
  const caps: CatalogCap[] = [];
  const add = (kind: CapKind, capName: string, file: string): void => {
    if (!version || caps.length >= MAX_CAPS) return;
    const pin = readPinned(dir, file, cached, budget); if (!pin) return;
    const cid = `${name}/${kind}/${capName}@${version}+${pin.sha12}`;
    const b = foreign ? undefined : table.find(name, kind, capName);
    if (b) {
      caps.push({ cid, kind, name: capName, risk: b.risk, level: b.level, mode: 'run', binding: b, fileSha12: pin.sha12,
        ...(b.args.length ? { args: b.args.map(a => ({ name: a.name, type: a.type, ...(a.max !== undefined ? { max: a.max } : {}), ...(a.min !== undefined ? { min: a.min } : {}), ...(a.enum ? { enum: [...a.enum] } : {}) })) } : {}) });
      return;
    }
    const why = foreign ? 'foreign-marketplace' as const : classifyUnbound(name, capName);
    const risk = why === 'risk-network' ? 'network' : why === 'risk-install' ? 'install' : why === 'risk-spend' ? 'spend' : why === 'risk-delete' ? 'delete' : 'write';
    caps.push({ cid, kind, name: capName, risk, level: null, mode: 'refused', why, fileSha12: pin.sha12 });
  };
  for (const c of cmdNames) add('command', c, `commands/${c}.md`);
  for (const s of skillNames) add('skill', s, `skills/${s}/SKILL.md`);
  for (const b of table.list) if (b.plugin === name && b.kind === 'view') add('view', b.name, b.pinFile);
  const options = optionKeys.map(k => classifyOption(name, k, isObj(uc[k]) ? (uc[k] as Obj) : {}));
  return {
    id, name, marketplace, version: version || 'unknown', manifestSha: man.sha12, enabled, foreign,
    mod: (() => { try { return lstatSync(join(dir, 'hooks', 'register.ts')).isFile(); } catch { return false; } })(),
    counts: { commands: cmdNames.length, skills: skillNames.length, agents: agentCount, options: optionKeys.length, mcp: mcpCount }, caps, options, dir,
  };
}

function plan(home: string | Roots, o: BuildOpts) {
  const enabled = enabledSet(home); const allowed = o.marketplaceSources ?? DEFAULT_MARKETPLACE_SOURCES;
  return { enabled, items: installedDirs(home).filter(i => !o.only || i.id === o.only), allowed };
}
function one(home: string | Roots, i: { id: string; dir: string; entryVersion: string }, enabled: Set<string>, allowed: readonly string[], o: BuildOpts, budget: { files: number }): CatalogPlugin {
  try {
    const foreign = !trustedMarketplace(home, PLUGIN.exec(i.id)?.[2] ?? '', allowed);
    return buildPlugin(i.id, i.dir, i.entryVersion, enabled.has(i.id), o.table ?? DEFAULT_BINDINGS, foreign, o.cached === true, budget) ?? unreadable(i.id, i.dir, enabled.has(i.id));
  } catch { return unreadable(i.id, i.dir, enabled.has(i.id)); }
}
function finish(plugins: CatalogPlugin[]): Catalog {
  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { plugins, treeSha: sha256Hex(plugins.map(p => `${p.id}:${p.manifestSha}:${p.caps.map(c => c.cid).join(',')}`).join('\n')).slice(0, 12) };
}

/** Build the whole catalog, or only plugin `only` (used to re-verify a pin at run time: always uncached). */
export function buildCatalog(home: string | Roots, only?: string, table: BindingTable = DEFAULT_BINDINGS, marketplaceSources?: readonly string[]): Catalog {
  const o: BuildOpts = { only, table, marketplaceSources, cached: false };
  const { enabled, items, allowed } = plan(home, o); const budget = { files: 0 };
  return finish(items.map(i => one(home, i, enabled, allowed, o, budget)));
}
/** The listing build: cached by stat signature, yields to the event loop between plugins, bounded by a file count and a wall-clock budget (plugins past it are listed unreadable). */
export async function buildCatalogAsync(home: string | Roots, o: BuildOpts = {}): Promise<Catalog> {
  const { enabled, items, allowed } = plan(home, { ...o, cached: true }); const budget = { files: 0 }; const t0 = Date.now(); const out: CatalogPlugin[] = [];
  for (const i of items) {
    if (Date.now() - t0 > BUILD_BUDGET_MS) { out.push(unreadable(i.id, i.dir, enabled.has(i.id))); continue; }
    out.push(one(home, i, enabled, allowed, { ...o, cached: true }, budget));
    await new Promise<void>(r => setImmediate(r));
  }
  return finish(out);
}

/** The `capabilities` section body. Each plugin is validated on its own: a plugin whose slice does not fit the schema is listed `unreadable`, never the whole frame rejected. */
export function catalogBody(cat: Catalog): Record<string, unknown> {
  const byCode: Record<string, number> = {}; let total = 0;
  const plugins = cat.plugins.map(p => {
    const entry = {
      id: p.id, version: p.version.slice(0, MAX_VERSION_LEN), manifestSha: p.manifestSha, enabled: p.enabled, mod: p.mod, ...(p.why ? { why: p.why } : {}), counts: p.counts,
      caps: p.caps.map(c => ({ cid: c.cid, kind: c.kind, name: c.name, risk: c.risk, level: c.level, mode: c.mode, ...(c.why ? { why: c.why } : {}), ...(c.args ? { args: c.args } : {}) })),
      options: p.options.map(o => ({ key: o.key, type: o.type, ...(o.default !== undefined ? { default: o.default } : {}), ...(o.choices ? { choices: o.choices } : {}), settable: o.settable, ...(o.why ? { why: o.why } : {}) })),
    };
    if (!CAPS_ENTRY.safeParse(JSON.parse(JSON.stringify(entry))).success) return { id: p.id, version: 'unknown', manifestSha: '', enabled: p.enabled, mod: false, why: 'unreadable' as const, counts: { commands: 0, skills: 0, agents: 0, options: 0, mcp: 0 }, caps: [], options: [] };
    for (const c of entry.caps) if (c.mode === 'refused') { total++; byCode[c.why ?? 'no-binding'] = (byCode[c.why ?? 'no-binding'] ?? 0) + 1; }
    return entry;
  });
  return { v: 1, generated: { treeSha: cat.treeSha, plugins: cat.plugins.length }, plugins, refused: { total, byCode } };
}
export function pluginsBody(cat: Catalog): Record<string, unknown> {
  return { plugins: cat.plugins.map(p => {
    const e = { id: p.id, name: p.name, marketplace: p.marketplace, version: p.version.slice(0, MAX_VERSION_LEN), enabled: p.enabled, mod: p.mod, foreign: p.foreign, manifestSha: p.manifestSha, ...(p.why ? { why: p.why } : {}) };
    return PLUGIN_ENTRY.safeParse(e).success ? e : { ...e, version: 'unknown', manifestSha: '', why: 'unreadable' as const };
  }) };
}
