/** Section collectors that read bounded local files (events log, ADR folders, changelogs) and the cost-tracker ledger script. */
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { readRegular, listDir, confine } from './read.js';
import { costBucket, maskSecrets } from './protocol/index.js';
import { isObj, ms, nat, str, type CollectCtx, type Collector } from './collect-core.js';

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------------------------- events
export const EVENTS_FILE = '.claude-flow/console/events.jsonl';
export const EVENTS_TAIL_BYTES = 128 * 1024;
/** Newest console events (masked at write; sanitized again before send), merged with recent mission events. */
export const events: Collector = async c => {
  const out: Obj[] = [];
  const f = readRegular(c.projectDir, EVENTS_FILE, EVENTS_TAIL_BYTES, true);
  if (f) {
    const lines = f.text.split('\n'); if (f.size > EVENTS_TAIL_BYTES) lines.shift();
    for (const line of lines) {
      if (line.length < 2 || line.length > 3000 || line[0] !== '{') continue;
      try {
        const r = JSON.parse(line) as Obj;
        if (r.v !== 1 || typeof r.text !== 'string' || typeof r.kind !== 'string') continue;
        const at = ms(r.t); if (!at) continue;
        out.push({ at, kind: str(r.kind, 40), level: str(r.level ?? 'info', 12), src: str(r.src ?? 'console', 40), text: str(r.text, 200) }); // str() masks before it truncates
      } catch { /* skip bad line */ }
    }
  }
  const me = c.cache.mission_events as { events?: Obj[] } | undefined;
  for (const e of me?.events ?? []) out.push({ at: e.at, kind: str(e.type, 40), level: 'info', src: 'mission', text: `${str(e.missionId, 40)} seq ${nat(e.seq)}${e.status ? ` ${str(e.status, 24)}` : ''}` });
  return { events: out.sort((a, b) => (b.at as number) - (a.at as number)).slice(0, 100) };
};

// ---------------------------------------------------------------------------------------------------------------- adrs
export const ADR_DIRS = ['docs/adr', 'docs/adrs', 'docs/decisions', 'docs/architecture/decisions', 'docs/architecture/adr', 'adr', 'adrs', 'decisions', 'v3/docs/adr', 'doc/adr', 'architecture/decisions'] as const;
// Line-oriented on purpose: each pattern runs on one bounded line and has no adjacent overlapping quantifiers (regexes over the
// whole 4 KiB head with \s*\n+\s* backtracked for ~10 s on a hostile file).
const MAX_HEAD_LINES = 200; const MAX_LINE = 300; const MAX_BLANK_RUN = 20;
const STATUS_INLINE = /^[ \t]*(?:[-*][ \t]*)?\**status\**[ \t]*[:=][ \t]*\**[ \t]*([A-Za-z][A-Za-z -]{0,22})/i;
const STATUS_HEADING = /^##[ \t]*status[ \t]*$/i;
const STATUS_WORD = /^[ \t]*([A-Za-z][A-Za-z -]{0,22})/;
const headLines = (head: string): string[] => head.split('\n', MAX_HEAD_LINES).map(l => l.slice(0, MAX_LINE).replace(/\r$/, ''));
const DATE_INLINE = /^[ \t]*(?:[-*][ \t]*)?\**date\**[ \t]*[:=][ \t]*\**[ \t]*(\d{4}-\d{2}-\d{2})/i;
export function adrDate(head: string): string | undefined { for (const l of headLines(head)) { const m = DATE_INLINE.exec(l); if (m) return m[1]; } return undefined; }
export function adrStatus(head: string): string {
  const lines = headLines(head);
  for (const l of lines) { const m = STATUS_INLINE.exec(l); if (m) return m[1]!; }
  for (let i = 0; i < lines.length; i++) {
    if (!STATUS_HEADING.test(lines[i]!)) continue;
    for (let j = i + 1; j < lines.length && j <= i + MAX_BLANK_RUN; j++) { if (lines[j]!.trim() === '') continue; const m = STATUS_WORD.exec(lines[j]!); return m ? m[1]! : ''; }
  }
  return '';
}
const first = (re: RegExp, s: string) => re.exec(s)?.[1];

export const adrs: Collector = async c => {
  let best: { rel: string; names: string[] } | null = null;
  for (const rel of ADR_DIRS) {
    const names = listDir(c.projectDir, rel).filter(e => !e.isDir && /\.md$/i.test(e.name) && !/^readme|^index/i.test(e.name)).map(e => e.name);
    if (names.length > (best?.names.length ?? 0)) best = { rel, names };
  }
  if (!best) return { folder: 'none', counts: {}, items: [], lint: [] };
  const items: Obj[] = []; const lint: string[] = []; const ids = new Map<string, number>(); const counts: Record<string, number> = {};
  for (const n of best.names.sort().reverse()) {
    const head = readRegular(c.projectDir, `${best.rel}/${n}`, 4096)?.text; if (head === undefined) continue;
    const title = first(/^#\s+(.+)$/m, head) ?? n;
    const status = adrStatus(head).trim().toLowerCase();
    const id = (/^(adr[-_ ]?\d+|\d{3,5})/i.exec(n)?.[1] ?? n.replace(/\.md$/i, '')).toUpperCase().replace(/^ADR[-_ ]?0*/, 'ADR-');
    const date = adrDate(head);
    const sup = first(/supersedes\**\s*[:=]\s*\**\s*(ADR[- ]?\d+|\d{3,5})/i, head); const supBy = first(/superseded[ -]by\**\s*[:=]\s*\**\s*(ADR[- ]?\d+|\d{3,5})/i, head);
    ids.set(id, (ids.get(id) ?? 0) + 1);
    if (!status) lint.push(`${id}: no Status line`);
    const st = status.slice(0, 24) || 'unknown'; counts[st] = (counts[st] ?? 0) + 1;
    if (items.length < 200) items.push({ id: str(id, 40), title: str(title, 160), status: st, ...(date ? { date } : {}), ...(sup ? { supersedes: str(sup, 40) } : {}), ...(supBy ? { supersededBy: str(supBy, 40) } : {}) });
  }
  for (const [id, k] of ids) if (k > 1) lint.push(`${id}: used by ${k} files`);
  const known = new Set(items.map(i => i.id));
  for (const i of items) for (const k of ['supersedes', 'supersededBy'] as const) { const t = i[k]; if (typeof t === 'string' && !known.has(t.toUpperCase().replace(/^ADR[- ]?0*/, 'ADR-'))) lint.push(`${i.id}: ${k} ${t} not found`); }
  const statuses = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 16);
  return { folder: str(best.rel, 100), convention: best.names.some(n => /^\d{3,5}-/.test(n)) ? 'NNNN-title' : 'ADR-N', counts: Object.fromEntries(statuses), items, lint: lint.slice(0, 40).map(l => l.slice(0, 200)) };
};

// ---------------------------------------------------------------------------------------------------------------- whatsnew
const CHANGELOG_READ = 256 * 1024; const CHANGELOG_PARSE = 64 * 1024;
function parseChangelog(text: string): { version: string; date?: string; changes: string[] }[] {
  const out: { version: string; date?: string; changes: string[] }[] = []; let cur: { version: string; date?: string; changes: string[] } | null = null;
  for (const line of text.slice(0, CHANGELOG_PARSE).split('\n')) {
    const h = /^##\s+\[?v?(\d+\.\d+\.\d+[\w.+-]*)\]?\s*(?:[-(–]\s*)?(\d{4}-\d{2}-\d{2})?/.exec(line);
    if (h) { if (out.length >= 3) break; cur = { version: h[1]!, ...(h[2] ? { date: h[2] } : {}), changes: [] }; out.push(cur); continue; }
    const b = /^\s*[-*]\s+(.+)$/.exec(line);
    if (cur && b && cur.changes.length < 6) cur.changes.push(maskSecrets(b[1]!.replace(/\*\*/g, '')).slice(0, 160));
  }
  return out;
}
export const whatsnew: Collector = async c => {
  const plugins: Obj[] = []; const breaking: string[] = [];
  const sources: { name: string; rel: string }[] = [{ name: 'project', rel: 'CHANGELOG.md' }, ...listDir(c.projectDir, 'plugins', 40).filter(e => e.isDir).map(e => ({ name: e.name, rel: `plugins/${e.name}/CHANGELOG.md` }))];
  for (const s of sources) {
    if (plugins.length >= 10) break;
    const f = readRegular(c.projectDir, s.rel, CHANGELOG_READ); if (!f) continue;
    const entries = parseChangelog(f.text); if (!entries.length) continue;
    plugins.push({ name: str(s.name, 60), entries });
    for (const e of entries) for (const ch of e.changes) if (/breaking/i.test(ch) && breaking.length < 10) breaking.push(`${s.name} ${e.version}: ${ch}`.slice(0, 160));
  }
  return { plugins, breaking };
};

// ---------------------------------------------------------------------------------------------------------------- cost
/**
 * Locate the cost-tracker ledger script, which the connector EXECUTES with node. Nothing resolved inside the project is ever run
 * (a cloned repo would otherwise get code execution as the user). Only two sources are trusted: a path the user set in config.json
 * (`ledgerPath`) or the user's own Claude plugin cache (~/.claude/plugins/cache). Either way the real path must be a regular file
 * owned by the current user, not group/world-writable (nor its directories up to the trust root), and outside the project root.
 */
export function findLedger(projectDir: string, home: string | undefined, explicit?: string): string | null {
  const root = safeReal(projectDir);
  if (explicit) return isAbsolute(explicit) && trustedScript(explicit, root, dirname(explicit)) ? realpathSync(explicit) : null;
  if (!home || !isAbsolute(home)) return null;
  const base = join(home, '.claude', 'plugins', 'cache');
  const vers: { p: string; v: number[] }[] = [];
  for (const mk of listDir(base, '.', 50)) {
    if (!mk.isDir) continue;
    for (const v of listDir(base, `${mk.name}/ruflo-cost-tracker`, 50)) {
      if (!v.isDir || !/^\d+\.\d+\.\d+$/.test(v.name)) continue;
      const p = confine(base, `${mk.name}/ruflo-cost-tracker/${v.name}/scripts/ledger.mjs`);
      if (p && trustedScript(p, root, base)) vers.push({ p, v: v.name.split('.').map(Number) });
    }
  }
  vers.sort((a, b) => b.v[0]! - a.v[0]! || b.v[1]! - a.v[1]! || b.v[2]! - a.v[2]!);
  return vers[0]?.p ?? null;
}
export function safeReal(p: string): string { try { return realpathSync(p); } catch { return resolve(p); } }
const inside = (child: string, root: string): boolean => child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);
/** Regular file, real path outside the project, owned by us, and neither it nor any directory up to `trustRoot` writable by group/others. */
export function trustedScript(p: string, projectRoot: string, trustRoot: string): boolean {
  try {
    const real = realpathSync(p);
    if (inside(real, projectRoot)) return false;
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    const ok = (path: string): boolean => { const st = statSync(path); return (uid === undefined || st.uid === uid) && (process.platform === 'win32' || (st.mode & 0o022) === 0); };
    if (!lstatSync(real).isFile() || !ok(real)) return false;
    const stop = safeReal(trustRoot);
    for (let d = dirname(real); ; d = dirname(d)) { if (!ok(d)) return false; if (d === stop || dirname(d) === d) break; }
    return true;
  } catch { return false; }
}
const unavailable = (reason: string, detail: 'coarse' | 'full' = 'coarse'): Obj => ({ available: false, detail, reason: reason.slice(0, 160), byModel: [], advice: [], perMission: [] });

export const cost: Collector = async c => {
  const detailMode = c.costDetail === 'full' ? 'full' : 'coarse';
  const script = findLedger(c.projectDir, c.home, c.ledgerPath);
  if (!script) return unavailable('cost-tracker ledger not found in a trusted location (project scripts are never run; install ruflo-cost-tracker in your plugin cache or set ledgerPath)', detailMode);
  let r;
  try { r = await c.run([process.execPath, script, '--since', '7d', '--format', 'json', '--advise'], 60_000); } catch (e) { return unavailable(`ledger could not run: ${(e as Error).message}`, detailMode); }
  if (r.timedOut || r.truncated || r.code !== 0) return unavailable(`ledger ${r.timedOut ? 'timed out' : r.truncated ? 'output too large' : `exited ${r.code}`}`, detailMode);
  let d: Obj; try { d = JSON.parse(r.stdout) as Obj; } catch { return unavailable('ledger output is not JSON', detailMode); }
  const totals = isObj(d.totals) ? d.totals : {};
  // Coarse (the default): an order-of-magnitude bucket and nothing else. The detail below is built only when the person set cost.detail=full locally.
  if (detailMode === 'coarse') return { available: true, detail: 'coarse', bucket: costBucket(typeof totals.usd === 'number' ? totals.usd : 0), windowDays: 7, byModel: [], advice: [], perMission: [] };
  const by = isObj(d.byModel) ? d.byModel : {}; const tok = isObj(d.tokens) ? d.tokens : {};
  const today = new Date(c.now()).toISOString().slice(0, 10);
  const day = isObj(d.byDay) && isObj((d.byDay as Obj)[today]) ? ((d.byDay as Obj)[today] as Obj) : {};
  const byModel = Object.entries(by).filter(([, v]) => isObj(v)).map(([k, v]) => {
    const o = v as Obj; const [provider = '', ...rest] = k.split('|'); const unit = typeof o.usd === 'number' ? 'usd' : 'credits'; const t = isObj(tok[k]) ? (tok[k] as Obj) : {};
    return { provider: str(provider, 24), model: str(rest.join('|'), 60), minor: Math.round(Number(unit === 'usd' ? o.usd : o.credits) * (unit === 'usd' ? 100 : 1)) || 0, unit, tokens: nat(t.input) + nat(t.cache_read) + nat(t.cache_write) + nat(t.output) };
  }).sort((a, b) => b.minor - a.minor).slice(0, 20);
  const cache = isObj(d.cache) ? d.cache : {}; const cc = (isObj(cache.claude) ? cache.claude : Object.values(cache).find(isObj)) as Obj | undefined;
  const findings = (Array.isArray(d.findings) ? d.findings.filter(isObj) : []).slice(0, 10).map(f => `${str(f.title, 80)}: ${str(f.evidence, 120)}`.slice(0, 200));
  return {
    available: true, detail: 'full', windowDays: 7,
    ...(typeof totals.usd === 'number' ? { totals: { currency: 'USD', totalMinor: Math.round(totals.usd * 100), ...(typeof day.usd === 'number' ? { todayMinor: Math.round(day.usd * 100) } : {}) } } : {}),
    ...(typeof totals.credits === 'number' ? { creditsTotal: Math.round(totals.credits) } : {}),
    byModel, ...(cc && typeof cc.hitRatio === 'number' ? { cacheHitRatio: Math.min(1, Math.max(0, cc.hitRatio)) } : {}),
    unpriced: Object.keys(isObj(d.unpriced) ? d.unpriced : {}).slice(0, 20).map(k => k.slice(0, 60)), advice: findings, perMission: [],
  };
};
export type { CollectCtx };
