/** Section collectors that read through ruflo's own read-only MCP tools (`ruflo mcp exec`). Each returns a section body or throws. */
import { arch, platform } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { maskSecrets, type Level, type SectionName } from './protocol/index.js';
import type { Ruflo, RunResult } from './exec.js';
import { projectStoreRedirects } from './capabilities/store.js';

type Obj = Record<string, unknown>;
export interface CollectCtx {
  ruflo: Ruflo; projectDir: string; level: Level; autoApprove: boolean; cliChoice: string; now: () => number;
  /** Latest published body per section, for derived sections. */
  cache: Partial<Record<SectionName, Obj>>;
  /** Last collection error per section (for health/alerts). */
  errors: ReadonlyMap<string, string>;
  /** Locally pending approvals (from the channel). */
  pending: () => { cid: string; cmd: string; since: number }[];
  /** Recent notices ring (scheduler-owned). */
  notices: () => { at: number; level: string; text: string; key: string }[];
  /** Run a fixed-argv child (the cost ledger). Injectable for tests. */
  run: (argv: string[], timeoutMs: number) => Promise<RunResult>;
  home?: string;
  /** Explicit ledger script path chosen by the USER in config.json (never derived from the project). */
  ledgerPath?: string;
  /** From the connector's own config.json only. Default 'coarse'. */
  costDetail?: 'coarse' | 'full';
  /** Local capability catalog + run history (plugins, capabilities, capability_runs sections). */
  caps?: import('./capabilities/service.js').CapabilityService;
}
export type Collector = (c: CollectCtx) => Promise<Obj>;

export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
/** Mask secrets BEFORE truncating: a token cut at the limit would otherwise leave a recognisable prefix. */
export const str = (v: unknown, n: number): string => maskSecrets(typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, n);
export const nat = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER) : 0);
export const ms = (v: unknown): number | undefined => { const t = typeof v === 'number' && v > 0 ? v : typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) && t > 0 ? Math.floor(t) : undefined; };
/** mission_* tools wrap results as {ok, data}. */
export const unwrap = (v: unknown): Obj => { if (!isObj(v)) throw new Error('unexpected result shape'); if (v.ok === false) throw new Error(`tool refused: ${str(v.code, 40)}`); return isObj(v.data) ? v.data : v; };
export const isRufloProject = (dir: string): boolean => ['.claude-flow', '.swarm'].some(d => existsSync(join(dir, d)));

export const meta: Collector = async c => {
  const info = await c.ruflo.mcp('system_info');
  if (!isObj(info)) throw new Error('unexpected result shape');
  const redirects = projectStoreRedirects(c.projectDir);
  const notes = redirects.length ? [`claude-flow.config.json moves ruflo's data outside this project (${redirects.join(', ')}); write-class capabilities are refused. Only link a project you trust.`] : [];
  return { ruflo: { version: str(info.version, 40) || 'unknown', ...(info.nodeVersion ? { node: str(info.nodeVersion, 40) } : {}), os: `${platform()}-${arch()}` }, project: isRufloProject(c.projectDir), cli: c.cliChoice, connector: '1', ...(notes.length ? { notes } : {}) };
};

export const health: Collector = async c => {
  const sys = await c.ruflo.mcp('system_health');
  if (!isObj(sys)) throw new Error('unexpected result shape');
  const checks = (Array.isArray(sys.checks) ? sys.checks : []).filter(isObj);
  const notes = checks.filter(k => k.status !== 'healthy').map(k => `${str(k.name, 40)}: ${str(k.status, 24)}${k.message ? ` - ${str(k.message, 100)}` : ''}`);
  for (const [sec, msg] of c.errors) notes.push(`${sec}: ${msg}`.slice(0, 200));
  if (!isRufloProject(c.projectDir)) notes.push('project dir has no .claude-flow/.swarm; run `ruflo init` there');
  return { ok: sys.overall === 'healthy' && c.errors.size === 0, notes: notes.slice(0, 20), areas: checks.slice(0, 40).map(k => ({ name: str(k.name, 40), status: str(k.status, 24) })) };
};

export const control: Collector = async c => ({ level: c.level, autoApprove: c.autoApprove });

const execStr = (e: unknown): string | null => (e == null ? null : isObj(e) ? str(e.kind ?? e.name ?? e.id ?? 'connected', 80) : str(e, 80));
export const missions: Collector = async c => {
  const d = unwrap(await c.ruflo.mcp('mission_get', {}));
  const list = (Array.isArray(d.missions) ? d.missions : []).filter(isObj);
  const sorted = [...list].sort((a, b) => (ms(b.updatedAt) ?? 0) - (ms(a.updatedAt) ?? 0)).slice(0, 100);
  return {
    missions: sorted.map((m, i) => {
      const row: Obj = { id: str(m.missionId, 40), source: 'ruflo', objective: str(m.objective, 300), state: str(m.state, 24), revision: nat(m.revision), ...(m.executionMode ? { executionMode: str(m.executionMode, 24) } : {}), ...(ms(m.updatedAt) ? { updatedAt: ms(m.updatedAt) } : {}) };
      if (i < 10) {
        const plan = isObj(m.plan) ? m.plan : undefined; const ev = isObj(m.evidence) ? m.evidence : undefined;
        const b = isObj(m.budget) ? m.budget : null;
        row.detail = {
          ...(plan ? { plan: { taskCount: nat(plan.taskCount), tasks: (Array.isArray(plan.tasks) ? plan.tasks : []).filter(isObj).slice(0, 40).map(t => ({ id: str(t.taskId ?? t.id, 60), title: str(t.title ?? t.description ?? t.name, 120), status: str(t.status ?? t.state, 24) })) } } : {}),
          ...(ev ? { evidence: { count: nat(ev.count), verified: nat(ev.verified) } } : {}),
          executor: execStr(m.executor), blockedReason: m.blockedReason == null ? null : str(m.blockedReason, 200),
          budget: b ? { ...(b.currency ? { currency: str(b.currency, 8) } : {}), ...(typeof b.limitMinor === 'number' ? { limitMinor: nat(b.limitMinor) } : {}), ...(typeof b.spentMinor === 'number' ? { spentMinor: nat(b.spentMinor) } : {}) } : null,
        };
      }
      return row;
    }),
  };
};

/** Per-mission fetch state, keyed on the scheduler's cache object: refetch only when a mission changed (or every 5 min). */
const EVENTS_RECHECK_MS = 5 * 60_000;
const fetched = new WeakMap<object, Map<string, { key: string; at: number; rows: Obj[] }>>();
export const mission_events: Collector = async c => {
  const m = c.cache.missions as { missions?: { id: string; updatedAt?: number; revision?: number; state?: string }[] } | undefined;
  const list = (m?.missions ?? []).slice(0, 10);
  const ids = list.map(x => x.id);
  const rows: Obj[] = [];
  const memo = fetched.get(c.cache) ?? new Map(); fetched.set(c.cache, memo);
  for (const k of [...memo.keys()]) if (!ids.includes(k)) memo.delete(k);
  await Promise.all(list.map(async mm => {
    const id = mm.id; const key = `${mm.updatedAt ?? 0}:${mm.revision ?? 0}:${mm.state ?? ''}`; const prev = memo.get(id);
    if (prev && prev.key === key && c.now() - prev.at < EVENTS_RECHECK_MS) { rows.push(...prev.rows); return; }
    const mine: Obj[] = [];
    try {
      const d = unwrap(await c.ruflo.mcp('mission_events', { missionId: id, limit: 10 }));
      for (const e of Array.isArray(d.events) ? d.events.filter(isObj) : []) {
        const p = isObj(e.payload) ? e.payload : {};
        const type = str(e.type, 60);
        mine.push({ missionId: id, seq: nat(e.seq), type, ...(p.state || p.status ? { status: str(p.state ?? p.status, 24) } : {}), at: ms(e.at) ?? c.now(), ...(/evidence/.test(type) && p.kind ? { evidenceKind: str(p.kind, 24) } : {}) });
      }
      memo.set(id, { key, at: c.now(), rows: mine });
    } catch { /* one mission failing must not drop the rest; it is retried next pass */ }
    rows.push(...mine);
  }));
  return { events: rows.sort((a, b) => (b.at as number) - (a.at as number)).slice(0, 100) };
};

export const tasks: Collector = async c => {
  const [sum, list] = await Promise.all([c.ruflo.mcp('task_summary'), c.ruflo.mcp('task_list', {})]);
  if (!isObj(sum)) throw new Error('unexpected result shape');
  const items = isObj(list) && Array.isArray(list.tasks) ? list.tasks.filter(isObj) : [];
  return {
    total: nat(sum.total), pending: nat(sum.pending), running: nat(sum.running), done: nat(sum.completed), failed: nat(sum.failed),
    items: items.slice(0, 50).map(t => ({ id: str(t.taskId, 60), title: str(t.description ?? t.type, 120), status: str(t.status, 24), ...(Array.isArray(t.assignedTo) && t.assignedTo[0] ? { agent: str(t.assignedTo[0], 60) } : {}) })),
  };
};

export const swarm: Collector = async c => {
  const [sw, hl, ag] = await Promise.all([c.ruflo.mcp('swarm_status'), c.ruflo.mcp('swarm_health').catch(() => null), c.ruflo.mcp('agent_list')]);
  if (!isObj(sw)) throw new Error('unexpected result shape');
  const agents = (isObj(ag) && Array.isArray(ag.agents) ? ag.agents.filter(isObj) : []).slice(0, 100).map(a => ({ id: str(a.agentId, 80), type: str(a.agentType, 40), state: str(a.status, 24) }));
  const active = typeof sw.swarmId === 'string' && sw.status !== 'no_swarm' && sw.status !== 'terminated';
  return { swarm: active ? { id: str(sw.swarmId, 80), ...(sw.topology ? { topology: str(sw.topology, 32) } : {}), ...(sw.maxAgents ? { maxAgents: nat(sw.maxAgents) } : {}), status: str(sw.status, 24), ...(isObj(hl) ? { health: hl.healthy === true ? 'healthy' : 'unhealthy' } : {}) } : null, agents };
};

export const memory: Collector = async c => {
  const m = await c.ruflo.mcp('memory_stats');
  if (!isObj(m)) throw new Error('unexpected result shape');
  const ns = isObj(m.namespaces) ? Object.entries(m.namespaces) : [];
  const flags: string[] = [];
  if (m.initialized === false) flags.push('not initialized');
  if (typeof m.embeddingCoverage === 'string' && !/^100/.test(m.embeddingCoverage) && nat(m.totalEntries) > 0) flags.push(`embedding coverage ${str(m.embeddingCoverage, 12)}`);
  return { entries: nat(m.totalEntries), namespaceCount: ns.length, namespaces: ns.slice(0, 50).map(([name, count]) => ({ name: str(name, 60), count: nat(count) })), ...(m.backend ? { backend: str(m.backend, 60) } : {}), vectors: nat(m.entriesWithEmbeddings), flags };
};

const SECRETISH = /key|token|secret|password|passwd|credential|auth|cookie|bearer|private/i;
export const settings: Collector = async c => {
  const r = await c.ruflo.mcp('config_list', {});
  const rows = isObj(r) && Array.isArray(r.configs) ? r.configs.filter(isObj) : [];
  return { options: rows.filter(k => typeof k.key === 'string' && !SECRETISH.test(k.key)).slice(0, 60).map(k => ({ key: str(k.key, 60), value: str(k.value, 160) })) };
};
