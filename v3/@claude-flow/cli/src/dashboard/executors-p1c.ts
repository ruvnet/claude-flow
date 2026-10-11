/** P1-complete command executors. Each maps one allowlisted command to fixed ruflo tool calls (JSON params, never argv text) or, for autopilot.stop, one exclusive file create. */
import { closeSync, constants, lstatSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { maskSecrets, type CommandName } from './protocol/index.js';
import type { ExecContext, ExecResult } from './executors.js';
import { claimantText } from './collect-p1.js';
import { AUTOPILOT_DIR } from './collect-p1c.js';
import { confine } from './read.js';
import { projectStoreRedirects } from './capabilities/store.js';

type Obj = Record<string, unknown>;
type Exec = (args: Obj, ctx: ExecContext) => Promise<ExecResult>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const WRITE_TIMEOUT_MS = 30_000;
const fail = (error: string): ExecResult => ({ ok: false, error: error.slice(0, 200) });
const ok = (result: Obj): ExecResult => ({ ok: true, result });
function data(v: unknown): Obj {
  if (!isObj(v)) throw new Error('unexpected result');
  if (v.success === false) throw new Error(String(v.error ?? 'failed').slice(0, 160));
  return isObj(v.data) ? v.data : v;
}
/** A project whose claude-flow.config.json moves ruflo's store outside the project must not get writes through the dashboard (docs/threat-model.md, Q5). */
function redirected(ctx: ExecContext): boolean { return !!ctx.projectDir && projectStoreRedirects(ctx.projectDir).length > 0; }

async function findClaim(ctx: ExecContext, issue: string): Promise<Obj | null> {
  const l = await ctx.ruflo.mcp('claims_list', {});
  const rows = isObj(l) && Array.isArray(l.claims) ? l.claims.filter(isObj) : [];
  return rows.find(x => x.issueId === issue) ?? null;
}

async function claimStatus(issue: string, from: string, to: 'paused' | 'active', ctx: ExecContext): Promise<ExecResult> {
  if (redirected(ctx)) return fail('project_store_redirected');
  const cl = await findClaim(ctx, issue);
  if (!cl) return fail('claim_not_found');
  if (cl.status !== from) return fail(`claim_is_${String(cl.status ?? 'unknown').replace(/[^a-z_-]/gi, '').slice(0, 16)}`);
  const r = data(await ctx.ruflo.mcp('claims_status', { issueId: issue, status: to }, { timeoutMs: WRITE_TIMEOUT_MS }));
  const c = isObj(r.claim) ? r.claim : {};
  return ok({ issue, status: c.status ?? to });
}

export const EXECUTORS_P1C: Partial<Record<CommandName, Exec>> = {
  async 'agent.logs'(a, ctx) {
    const r = await ctx.ruflo.mcp('agent_logs', { agentId: String(a.agentId), limit: Number(a.lines ?? 50) });
    if (!isObj(r)) return fail('unexpected result');
    if (typeof r.error === 'string') return fail(/not found/i.test(r.error) ? 'agent_not_found' : 'agent_logs_failed');
    // Free text from an agent is untrusted data: masked BEFORE it is cut, bounded in count and size, shown as text only.
    const rows = (Array.isArray(r.entries) ? r.entries.filter(isObj) : []).slice(-Math.min(100, Number(a.lines ?? 50)));
    const entries: Obj[] = []; let size = 200;
    for (const e of rows) {
      const row = { at: typeof e.timestamp === 'string' ? e.timestamp.slice(0, 30) : '', level: String(e.level ?? 'info').slice(0, 8), text: maskSecrets(String(e.message ?? '')).slice(0, 160) };
      size += JSON.stringify(row).length; if (size > 3600) break; entries.push(row);
    }
    return ok({ agentId: String(a.agentId), total: entries.length, entries, synthetic: typeof r.note === 'string' && /synthetic/i.test(r.note) });
  },

  async 'agent.stop'(a, ctx) {
    if (redirected(ctx)) return fail('project_store_redirected');
    const list = data(await ctx.ruflo.mcp('agent_list', {}));
    const known = (Array.isArray(list.agents) ? list.agents.filter(isObj) : []).some(x => x.agentId === a.agentId);
    if (!known) return fail('agent_not_found');
    const r = data(await ctx.ruflo.mcp('agent_terminate', { agentId: String(a.agentId) }, { timeoutMs: WRITE_TIMEOUT_MS }));
    return ok({ agentId: r.agentId, terminated: r.terminated });
  },

  async 'task.create'(a, ctx) {
    if (redirected(ctx)) return fail('project_store_redirected');
    const r = data(await ctx.ruflo.mcp('task_create', { type: String(a.type), description: String(a.description) }, { timeoutMs: WRITE_TIMEOUT_MS }));
    return ok({ taskId: r.taskId, type: r.type, status: r.status });
  },

  async 'claims.release'(a, ctx) {
    if (redirected(ctx)) return fail('project_store_redirected');
    const issue = String(a.issue); const cl = await findClaim(ctx, issue);
    if (!cl) return fail('claim_not_found');
    // The human saw a claimant; release only if the claim is still held by that exact claimant (ruflo itself also checks it).
    const live = claimantText(cl.claimant).text;
    if (live !== a.claimant) return fail('claimant_changed');
    const r = data(await ctx.ruflo.mcp('claims_release', { issueId: issue, claimant: live }, { timeoutMs: WRITE_TIMEOUT_MS }));
    return ok({ issue, released: r.success !== false });
  },
  async 'claims.pause'(a, ctx) { return claimStatus(String(a.issue), 'active', 'paused', ctx); },
  async 'claims.resume'(a, ctx) { return claimStatus(String(a.issue), 'paused', 'active', ctx); },

  async 'memory.store'(a, ctx) {
    if (redirected(ctx)) return fail('project_store_redirected');
    const r = data(await ctx.ruflo.mcp('memory_store', { key: String(a.key), value: String(a.value), namespace: 'dashboard' }, { timeoutMs: WRITE_TIMEOUT_MS }));
    return ok({ key: r.key, namespace: 'dashboard', stored: r.stored === true });
  },

  /**
   * The console stops when `.claude-flow/console/autopilot/KILL` exists. Created exclusively (never overwritten, never removed here), no symlink on the path,
   * the folder must already exist (no autopilot, nothing to stop). It only narrows what autopilot may do.
   */
  async 'autopilot.stop'(_a, ctx) {
    if (!ctx.projectDir) return fail('no_project');
    const dir = confine(ctx.projectDir, AUTOPILOT_DIR);
    try { if (!dir || !lstatSync(dir).isDirectory()) return fail('no_autopilot'); } catch { return fail('no_autopilot'); }
    const target = join(dir, 'KILL');
    let fd: number | undefined;
    try {
      fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      writeSync(fd, 'stopped from the ruflo dashboard\n');
      return ok({ killed: true, alreadyStopped: false });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        // Only a regular file counts as "already stopped"; a symlink or anything else sitting there is not the console's stop contract.
        try { return lstatSync(target).isFile() ? ok({ killed: true, alreadyStopped: true }) : fail('kill_path_not_a_file'); } catch { return fail('kill_file_not_written'); }
      }
      return fail('kill_file_not_written');
    } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ } }
  },
};
