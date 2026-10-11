/** Maps each allowlisted command to fixed ruflo MCP tool calls. Arguments are passed as JSON values, never interpolated into argv text. */
import { MAX_SWARM_AGENTS, sanitize, type CommandName, type SectionName } from './protocol/index.js';
import type { Ruflo } from './exec.js';
import { EXECUTORS_P1C } from './executors-p1c.js';

export type ExecResult = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };
export interface ExecContext { ruflo: Ruflo; cid: string; projectDir?: string; refreshAll: () => Promise<{ sent: string[]; rateLimited?: boolean }>; refreshSection: (s: SectionName) => Promise<{ sent: boolean; rateLimited?: boolean }> }
/** Tools the command executors may call (collection uses the stricter READ_TOOLS). Fixed list; anything else is refused. */
export const COMMAND_TOOLS: ReadonlySet<string> = new Set(['memory_search', 'memory_list', 'mission_get', 'mission_create', 'mission_request_action', 'swarm_status', 'swarm_init', 'swarm_shutdown', 'agent_list', 'agent_spawn',
  // P1-complete (each verified against ruflo 3.55.0 in a temp project; see docs/p1-connector-decisions.md)
  'agent_terminate', 'agent_logs', 'task_create', 'claims_list', 'claims_release', 'claims_status', 'memory_store']);
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const RESULT_CAP = 4000;

/** Keep results small and masked: sanitize, then drop detail until the JSON fits. */
export function capResult(r: Record<string, unknown>, cap = RESULT_CAP): Record<string, unknown> {
  const s = sanitize(r);
  if (JSON.stringify(s).length <= cap) return s;
  return { truncated: true, preview: JSON.stringify(s).slice(0, cap - 60) };
}
const fail = (error: string): ExecResult => ({ ok: false, error: error.slice(0, 200) });
const done = (result: Record<string, unknown>): ExecResult => ({ ok: true, result: capResult(result) });
function data(v: unknown): Obj {
  if (!isObj(v)) throw new Error('unexpected result');
  if (v.success === false) throw new Error(String(v.error ?? 'failed').slice(0, 160));
  if (v.ok === false) throw new Error(`${String(v.code ?? 'error')}: ${String(v.message ?? '').slice(0, 120)}`);
  return isObj(v.data) ? v.data : v;
}

const MISSION_ACTION = { 'mission.pause': 'pause', 'mission.resume': 'resume', 'mission.stop': 'cancel' } as const;

export type Executor = (args: Obj, ctx: ExecContext) => Promise<ExecResult>;
type ExtraCommands = 'agent.logs' | 'agent.stop' | 'task.create' | 'claims.release' | 'claims.pause' | 'claims.resume' | 'memory.store' | 'autopilot.stop';

const BASE: Omit<Record<CommandName, Executor>, ExtraCommands> = {
  async 'state.refresh'(_a, ctx) { const r = await ctx.refreshAll(); return done({ published: r.sent.length, rateLimited: r.rateLimited === true }); },

  async 'section.refresh'(a, ctx) { const r = await ctx.refreshSection(a.section as SectionName); return done({ section: a.section, sent: r.sent, rateLimited: r.rateLimited === true }); },

  async 'memory.list'(a, ctx) {
    const r = data(await ctx.ruflo.mcp('memory_list', { namespace: String(a.namespace), limit: Number(a.limit ?? 20) }));
    const rows = (Array.isArray(r.entries) ? r.entries : []).filter(isObj).slice(0, 100).map(x => ({ key: x.key, namespace: x.namespace, size: x.size }));
    return done({ total: Number(r.total ?? rows.length), entries: rows });
  },

  async 'swarm.stop'(_a, ctx) {
    const sw = data(await ctx.ruflo.mcp('swarm_status', {}));
    if (sw.status === 'no_swarm' || sw.status === 'terminated' || typeof sw.swarmId !== 'string') return fail('no_active_swarm');
    const r = data(await ctx.ruflo.mcp('swarm_shutdown', { swarmId: sw.swarmId }));
    return done({ swarmId: r.swarmId, terminated: r.terminated, agentsTerminated: r.agentsTerminated });
  },

  async 'memory.search'(a, ctx) {
    const r = data(await ctx.ruflo.mcp('memory_search', { query: String(a.query), limit: Number(a.limit ?? 5) }));
    const rows = (Array.isArray(r.results) ? r.results : []).filter(isObj).slice(0, 20).map(x => ({ key: x.key, namespace: x.namespace, score: x.similarity ?? x.score }));
    return done({ total: Number(r.total ?? rows.length), results: rows });
  },

  // DRAFT only: mission_create never starts execution; the idempotency key is the dashboard's requestId.
  async 'mission.create'(a, ctx) {
    const r = data(await ctx.ruflo.mcp('mission_create', { objective: String(a.objective), requestId: String(a.requestId) }));
    return done({ missionId: r.missionId, state: r.state, revision: r.revision, deduplicated: r.deduplicated });
  },

  async 'mission.pause'(a, ctx) { return missionAction('mission.pause', a, ctx); },
  async 'mission.resume'(a, ctx) { return missionAction('mission.resume', a, ctx); },
  async 'mission.stop'(a, ctx) { return missionAction('mission.stop', a, ctx); },

  async 'swarm.init'(a, ctx) {
    const maxAgents = Math.min(Number(a.maxAgents ?? MAX_SWARM_AGENTS), MAX_SWARM_AGENTS);
    const r = data(await ctx.ruflo.mcp('swarm_init', { topology: String(a.topology ?? 'hierarchical'), maxAgents }));
    return done({ swarmId: r.swarmId, topology: r.topology, maxAgents: r.maxAgents });
  },

  async 'plugin.list'() { return fail('capabilities_unavailable'); },
  async 'plugin.enable'() { return fail('capabilities_unavailable'); },
  async 'plugin.disable'() { return fail('capabilities_unavailable'); },
  async 'capability.run'() { return fail('capabilities_unavailable'); },
  async 'mod.option.set'() { return fail('capabilities_unavailable'); },

  async 'agent.spawn'(a, ctx) {
    const sw = data(await ctx.ruflo.mcp('swarm_status', {}));
    if (sw.status === 'no_swarm' || typeof sw.swarmId !== 'string') return fail('no_active_swarm');
    const cap = Math.min(Number(sw.maxAgents ?? MAX_SWARM_AGENTS), MAX_SWARM_AGENTS);
    const list = data(await ctx.ruflo.mcp('agent_list', {}));
    if (Number(list.total ?? 0) >= cap) return fail('swarm_agent_cap_reached');
    const params: Obj = { agentType: String(a.type) };
    if (typeof a.name === 'string') params.agentId = a.name;
    const r = data(await ctx.ruflo.mcp('agent_spawn', params));
    return done({ agentId: r.agentId, agentType: r.agentType, status: r.status });
  },
};

export const EXECUTORS = { ...BASE, ...EXECUTORS_P1C } as Record<CommandName, Executor>;

async function missionAction(name: keyof typeof MISSION_ACTION, a: Obj, ctx: ExecContext): Promise<ExecResult> {
  const missionId = String(a.missionId);
  const g = data(await ctx.ruflo.mcp('mission_get', { missionId }));
  const rec = isObj(g.record) ? g.record : null;
  const revision = rec ? Number(rec.revision) : NaN;
  if (!Number.isInteger(revision)) return fail('mission_not_found');
  // The revision the human looked at (when the dashboard sent one) must still be the live one; otherwise act on nothing.
  if (a.expectedRevision !== undefined && a.expectedRevision !== revision) return fail('revision_changed');
  const r = data(await ctx.ruflo.mcp('mission_request_action', { missionId, action: MISSION_ACTION[name], expectedRevision: revision, requestId: ctx.cid, reason: 'requested from ruflo dashboard' }));
  // Report exactly what ruflo answered. A refusal (e.g. executor-unavailable for resume) throws above and is shown as a failure.
  return done({ missionId: r.missionId, requested: MISSION_ACTION[name], state: r.state, revision: r.revision });
}
