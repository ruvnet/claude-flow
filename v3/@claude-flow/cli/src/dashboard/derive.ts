/** Sections computed inside the connector from other sections. Read-only: the answering side of approvals stays on the machine. */
import { isObj, ms, str, type Collector } from './collect-core.js';

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

export const alerts: Collector = async c => {
  const out: { level: 'info' | 'warn' | 'error'; key: string; text: string; go?: string }[] = [];
  const h = c.cache.health as Obj | undefined;
  if (h && h.ok === false) out.push({ level: 'error', key: 'health', text: `ruflo health is not OK${arr(h.areas).find(a => a.status !== 'healthy') ? `: ${str(arr(h.areas).find(a => a.status !== 'healthy')!.name, 40)} ${str(arr(h.areas).find(a => a.status !== 'healthy')!.status, 24)}` : ''}`, go: 'health' });
  for (const [sec, msg] of c.errors) out.push({ level: 'warn', key: `collect:${sec}`, text: `${sec} could not be read: ${msg}`.slice(0, 200), go: sec });
  for (const m of arr((c.cache.missions as Obj | undefined)?.missions)) {
    const d = isObj(m.detail) ? m.detail : {};
    if (typeof d.blockedReason === 'string' && d.blockedReason) out.push({ level: 'warn', key: `mission:${str(m.id, 40)}:blocked`, text: `Mission ${str(m.id, 40)} is blocked: ${str(d.blockedReason, 120)}`, go: 'missions' });
    else if (/fail|error/i.test(str(m.state, 24))) out.push({ level: 'error', key: `mission:${str(m.id, 40)}:failed`, text: `Mission ${str(m.id, 40)} is ${str(m.state, 24)}`, go: 'missions' });
  }
  const sw = c.cache.swarm as Obj | undefined;
  if (isObj(sw?.swarm) && sw!.swarm && (sw!.swarm as Obj).health === 'unhealthy') out.push({ level: 'warn', key: 'swarm:unhealthy', text: 'The swarm reports unhealthy', go: 'swarm' });
  const t = c.cache.tasks as Obj | undefined;
  if (t && typeof t.failed === 'number' && t.failed > 0) out.push({ level: 'warn', key: 'tasks:failed', text: `${t.failed} task(s) failed`, go: 'tasks' });
  const cost = c.cache.cost as Obj | undefined; const b = isObj(cost?.budget) ? (cost!.budget as Obj) : undefined;
  if (b && typeof b.limitMinor === 'number' && b.limitMinor > 0 && typeof b.spentMinor === 'number') {
    const f = b.spentMinor / b.limitMinor;
    if (f >= 0.75) out.push({ level: f >= 1 ? 'error' : 'warn', key: 'cost:budget', text: `Spend is ${Math.round(f * 100)}% of the budget`, go: 'cost' });
  }
  const mem = c.cache.memory as Obj | undefined;
  for (const f of Array.isArray(mem?.flags) ? (mem!.flags as unknown[]) : []) out.push({ level: 'info', key: `memory:${str(f, 40)}`, text: `Memory: ${str(f, 100)}`, go: 'memory' });
  const ord = { error: 0, warn: 1, info: 2 } as const;
  return { alerts: out.sort((a, b) => ord[a.level] - ord[b.level]).slice(0, 30) };
};

export const approvals: Collector = async c => {
  const now = c.now(); const items: { kind: string; text: string; ageS: number }[] = [];
  for (const p of c.pending()) items.push({ kind: 'command', text: `${str(p.cmd, 40)} awaiting approval on this machine`, ageS: Math.max(0, Math.round((now - p.since) / 1000)) });
  for (const m of arr((c.cache.missions as Obj | undefined)?.missions)) {
    if (/authoriz|await|pending/i.test(str(m.state, 24))) items.push({ kind: 'mission', text: `Mission ${str(m.id, 40)} (${str(m.state, 24)}): ${str(m.objective, 120)}`, ageS: Math.max(0, Math.round((now - (ms(m.updatedAt) ?? now)) / 1000)) });
  }
  return { items: items.slice(0, 30) };
};

export const notices: Collector = async c => ({ notices: c.notices().slice(0, 30) });
