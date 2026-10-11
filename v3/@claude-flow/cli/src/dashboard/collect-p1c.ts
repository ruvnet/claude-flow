/** P1-complete collectors: agents, autopilot, skills, timeline, plus the file-backed pieces of hive, metaharness (flywheel) and security (Anatole). Tool-backed ones read only through READ_TOOLS. */
import { lstatSync } from 'node:fs';
import { isObj, nat, str, ms, type Collector, type CollectCtx } from './collect-core.js';
import { confine, listDir, readRegular } from './read.js';
import { projectShadowsMetaharness } from './collect-p1.js';

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const parseObj = (text: string | undefined): Obj | null => { if (text === undefined) return null; try { const v = JSON.parse(text) as unknown; return isObj(v) ? v : null; } catch { return null; } };

// ---------------------------------------------------------------------------------------------------------------- agents
export const agents: Collector = async c => {
  const h = await c.ruflo.mcp('agent_health');
  if (!isObj(h)) throw new Error('unexpected result shape');
  const rows = arr(h.agents);
  const ov = isObj(h.overall) ? h.overall : {};
  return {
    summary: { total: nat(h.total ?? rows.length), healthy: nat(h.healthyCount ?? ov.healthy), degraded: nat(ov.degraded), unhealthy: nat(h.unhealthyCount ?? ov.unhealthy) },
    agents: rows.slice(0, 100).map(a => {
      const t = isObj(a.tasks) ? a.tasks : {}; const up = nat(a.uptime);
      return { id: str(a.id ?? a.agentId, 80), type: str(a.type ?? a.agentType, 40), health: str(a.health, 24), tasksActive: nat(t.active), tasksQueued: nat(t.queued), tasksCompleted: nat(t.completed), tasksFailed: nat(t.failed), ...(up ? { uptimeS: Math.floor(up / 1000) } : {}) };
    }),
    note: 'ruflo reports no per-agent CPU or memory, and its agent logs are synthetic (ruvnet/ruflo#1916)',
  };
};

// ---------------------------------------------------------------------------------------------------------------- autopilot
export const AUTOPILOT_DIR = '.claude-flow/console/autopilot';
export const KILL_REL = `${AUTOPILOT_DIR}/KILL`;
const JOURNAL_TAIL = 256 * 1024;
const exists = (root: string, rel: string): boolean => { const p = confine(root, rel); if (!p) return false; try { return lstatSync(p).isFile(); } catch { return false; } };
export const autopilot: Collector = async c => {
  const dir = confine(c.projectDir, AUTOPILOT_DIR);
  let present = false; if (dir) { try { present = lstatSync(dir).isDirectory(); } catch { present = false; } }
  const killed = present && exists(c.projectDir, KILL_REL);
  const env = present ? parseObj(readRegular(c.projectDir, `${AUTOPILOT_DIR}/envelope.json`, 64 * 1024)?.text) : null;
  const envelope = env ? { ...(nat((isObj(env.envelope) ? env.envelope : env).revision) ? { revision: nat((isObj(env.envelope) ? env.envelope : env).revision) } : {}), ...(typeof env.hash === 'string' && /^[0-9a-f]{8,64}$/i.test(env.hash) ? { hash: env.hash.slice(0, 16) } : {}) } : null;
  const steps = { started: 0, done: 0, failed: 0, verified: 0, parked: 0 }; let phase: 'none' | 'idle' | 'running' | 'paused' | 'stopped' = present ? 'idle' : 'none';
  let lines = 0, bad = 0, lastEvent: string | undefined, lastAt: number | undefined;
  const j = present ? readRegular(c.projectDir, `${AUTOPILOT_DIR}/journal.jsonl`, JOURNAL_TAIL, true) : null;
  if (j) {
    const ls = j.text.split('\n'); if (j.size > JOURNAL_TAIL) ls.shift();
    for (const line of ls) {
      if (!line) continue; lines++;
      const e = line.length <= 4000 && line[0] === '{' ? parseObj(line) : null;
      if (!e || typeof e.t !== 'string' || !/^[a-z.]{2,24}$/.test(e.t)) { bad++; continue; }
      lastEvent = e.t; lastAt = ms(e.at) ?? lastAt;
      switch (e.t) {
        case 'start': case 'resume': phase = 'running'; break;
        case 'pause': phase = 'paused'; break;
        case 'stop': phase = 'stopped'; break;
        case 'step.started': steps.started++; break;
        case 'step.done': steps.done++; if (e.verified === true) steps.verified++; break;
        case 'step.failed': steps.failed++; break;
        case 'parked': steps.parked++; break;
        case 'answered': steps.parked = Math.max(0, steps.parked - 1); break;
        default: break;
      }
    }
  }
  if (killed) phase = 'stopped';
  return { present, killed, phase, envelope, steps, ...(lastEvent ? { lastEvent: str(lastEvent, 24) } : {}), ...(lastAt ? { lastAt } : {}), journalLines: lines, badLines: bad, unauthenticated: true };
};

// ---------------------------------------------------------------------------------------------------------------- skills
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const skills: Collector = async c => {
  const out: Obj[] = []; let total = 0;
  const roots: { root: string; rel: string; source: 'project' | 'agents' | 'user' }[] = [
    { root: c.projectDir, rel: '.claude/skills', source: 'project' }, { root: c.projectDir, rel: '.agents/skills', source: 'agents' },
    ...(c.home ? [{ root: c.home, rel: '.claude/skills', source: 'user' as const }] : []),
  ];
  for (const r of roots) {
    for (const e of listDir(r.root, r.rel, 400)) {
      if (!e.isDir || !SKILL_NAME.test(e.name)) continue;
      total++;
      if (out.length < 200) out.push({ name: e.name, source: r.source, manifest: exists(r.root, `${r.rel}/${e.name}/SKILL.md`) });
    }
  }
  return { total, skills: out };
};

// ---------------------------------------------------------------------------------------------------------------- timeline
const BUCKET_CHOICES_S = [300, 900, 1800, 3600, 10800, 21600] as const;
export const timeline: Collector = async c => {
  const evs = ((c.cache.events as { events?: Obj[] } | undefined)?.events ?? []).filter(e => typeof e.at === 'number');
  const end = c.now(); const buckets = 24;
  const oldest = evs.reduce((m, e) => Math.min(m, e.at as number), end);
  const bucketS = BUCKET_CHOICES_S.find(b => b * buckets * 1000 >= end - oldest) ?? BUCKET_CHOICES_S[BUCKET_CHOICES_S.length - 1]!;
  const lanes = new Map<string, number[]>();
  for (const e of evs) {
    const age = end - (e.at as number); if (age < 0 || age >= bucketS * buckets * 1000) continue;
    const lane = str(e.src ?? 'console', 40) || 'console';
    if (!lanes.has(lane) && lanes.size >= 16) continue;
    const counts = lanes.get(lane) ?? new Array<number>(buckets).fill(0); lanes.set(lane, counts);
    counts[buckets - 1 - Math.floor(age / (bucketS * 1000))]!++;
  }
  return { endAt: end, bucketS, buckets, lanes: [...lanes].map(([lane, counts]) => ({ lane, total: counts.reduce((a, b) => a + b, 0), counts })).sort((a, b) => b.total - a.total), note: 'event activity per source, not agent busy/idle: the console lanes file is not read' };
};

// ---------------------------------------------------------------------------------------------------------------- hive proposals (file)
/** ruflo's hive state file lists the open proposals and their votes; hive-mind_status only counts them. The file also holds a hiveToken, which is never read out. */
export function hiveProposalsFromFile(c: Pick<CollectCtx, 'projectDir'>): Obj[] {
  const st = parseObj(readRegular(c.projectDir, '.claude-flow/hive-mind/state.json', 256 * 1024)?.text);
  const cons = st && isObj(st.consensus) ? st.consensus : null;
  if (!cons) return [];
  return [...arr(cons.pending), ...arr(cons.history).slice(-10)].slice(0, 30).map(p => {
    const votes = isObj(p.votes) ? Object.values(p.votes) : [];
    return { id: str(p.proposalId ?? p.id, 60), type: str(p.type, 40), status: str(p.status ?? 'pending', 24), ...(p.strategy ? { strategy: str(p.strategy, 24) } : {}), votesFor: votes.filter(v => v === true).length, votesAgainst: votes.filter(v => v === false).length };
  });
}

// ---------------------------------------------------------------------------------------------------------------- flywheel
const payload = (v: unknown): Obj => { if (!isObj(v)) throw new Error('unexpected result shape'); if (v.success === false) throw new Error(str(v.error ?? 'tool failed', 120)); return isObj(v.data) ? v.data : v; };
/** metaharness_flywheel {op:'status'} only (the guard pins it). Null when metaharness is degraded or the project could shadow its scripts. */
export async function flywheel(c: CollectCtx): Promise<Obj | null> {
  if (projectShadowsMetaharness(c.projectDir)) return null;
  const r = await c.ruflo.mcp('metaharness_flywheel', { op: 'status' }).catch(() => null);
  if (!isObj(r) || r.degraded === true) return null;
  const d = payload(r); const state = isObj(d.state) ? d.state : {}; const led = isObj(d.ledger) ? d.ledger : {};
  return { ledgerValid: led.valid !== false, commits: nat(led.commits), servingEpoch: nat(state.servingEpoch), champion: state.activeChampionRef == null ? null : str(state.activeChampionRef, 80), receipts: Object.keys(isObj(state.receiptStates) ? state.receiptStates : {}).length };
}

// ---------------------------------------------------------------------------------------------------------------- anatole
const MODES = ['off', 'learn', 'notify', 'enforce'];
export function anatole(c: Pick<CollectCtx, 'projectDir'>): Obj | null {
  const f = readRegular(c.projectDir, '.claude-flow/protector-mod/status.json', 65_536);
  const v = parseObj(f?.text);
  if (!v || v.schemaVersion !== 1) return null;
  const a = isObj(v.alerts) ? v.alerts : {};
  const open = { critical: nat(a.critical), high: nat(a.high), medium: nat(a.medium), low: nat(a.low), total: 0 }; open.total = Math.max(nat(a.open), open.critical + open.high + open.medium + open.low);
  const upd = ms(v.updatedAt) ?? ms(v.updatedMs);
  return { present: true, mode: typeof v.mode === 'string' && MODES.includes(v.mode) ? v.mode : null, calls: nat(v.calls), blocked: nat(v.blocked), open,
    degraded: v.degraded === false || v.degraded == null ? null : str(typeof v.degraded === 'string' ? v.degraded : 'degraded', 80) || 'degraded', ...(upd ? { updatedAt: upd } : {}), unauthenticated: true };
}
