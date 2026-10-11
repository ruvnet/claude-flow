/** P1 section collectors. Tool-backed ones read only through READ_TOOLS (the scheduler's guarded client); plugin ones read local files via the capability service. */
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { isObj, nat, str, ms, type Collector } from './collect-core.js';
import { readRegular } from './read.js';
import { anatole, flywheel, hiveProposalsFromFile } from './collect-p1c.js';

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const ratio = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);
/** ruflo wraps some tools as {success, data}; a failure payload is an error, never an empty section. */
const payload = (v: unknown): Obj => {
  if (!isObj(v)) throw new Error('unexpected result shape');
  if (v.success === false) throw new Error(str(v.error ?? 'tool failed', 120));
  return isObj(v.data) ? v.data : v;
};
/** "human:u1:Ana" or {type:'agent', agentId, agentType}: both come out as short text plus a kind. */
export function claimantText(v: unknown): { text: string; kind: 'human' | 'agent' | 'unknown' } {
  if (typeof v === 'string') return { text: str(v, 80), kind: v.startsWith('human:') ? 'human' : v.startsWith('agent:') ? 'agent' : 'unknown' };
  if (isObj(v)) return v.type === 'human' ? { text: str(`human:${v.userId ?? ''}:${v.name ?? ''}`, 80), kind: 'human' } : { text: str(`agent:${v.agentId ?? ''}:${v.agentType ?? ''}`, 80), kind: v.type === 'agent' ? 'agent' : 'unknown' };
  return { text: '', kind: 'unknown' };
}

export const claims: Collector = async c => {
  const [list, board, steal, load] = await Promise.all([c.ruflo.mcp('claims_list'), c.ruflo.mcp('claims_board'), c.ruflo.mcp('claims_stealable').catch(() => null), c.ruflo.mcp('claims_load').catch(() => null)]);
  const l = payload(list); const b = payload(board); const sm = isObj(b.summary) ? b.summary : {};
  const stealable = new Set(arr(isObj(steal) ? steal.stealable : []).map(x => String(x.issueId)));
  return {
    summary: { total: nat(sm.total), active: nat(sm.active), blocked: nat(sm.blocked), stealable: Math.max(nat(sm.stealable), stealable.size), humanClaims: nat(sm.humanClaims), agentClaims: nat(sm.agentClaims) },
    claims: arr(l.claims).slice(0, 100).map(x => {
      const cl = claimantText(x.claimant); const at = ms(x.claimedAt); const id = str(x.issueId, 80);
      return { issue: id, claimant: cl.text, kind: cl.kind, status: str(x.status ?? 'active', 24), ...(typeof x.progress === 'number' ? { progress: nat(x.progress) } : {}), ...(at ? { claimedAt: at } : {}), stealable: stealable.has(id) || x.status === 'stealable', ...(x.blockReason ? { note: str(x.blockReason, 160) } : {}) };
    }),
    loads: arr(isObj(load) ? load.loads : []).slice(0, 40).map(x => ({ agent: str(x.agentId ?? x.agent, 80), claims: nat(x.claims ?? x.claimCount ?? x.activeClaims), ...(typeof x.utilization === 'number' ? { utilization: Math.min(10, Math.max(0, x.utilization)) } : {}) })),
  };
};

export const hive: Collector = async c => {
  const h = payload(await c.ruflo.mcp('hive-mind_status'));
  // ruflo answers with a phantom hive (fresh id and timestamps) when none was ever initialised: that is "no hive", not a hive.
  if (h.initialized === false) return { hive: null, workers: [], proposals: [] };
  const q = isObj(h.queen) ? h.queen : null; const m = isObj(h.metrics) ? h.metrics : {}; const health = isObj(h.health) ? h.health : {};
  const workers = (Array.isArray(h.workers) ? h.workers : []).slice(0, 60).map(w => isObj(w) ? { id: str(w.id ?? w.agentId, 80), role: str(w.role ?? w.type ?? 'worker', 24), status: str(w.status ?? 'unknown', 24) } : { id: str(w, 80), role: 'worker', status: 'unknown' });
  const pend = arr(h.proposals ?? h.pendingProposals).slice(0, 30).map(p => {
    const votes = isObj(p.votes) ? Object.values(p.votes) : [];
    return { id: str(p.proposalId ?? p.id, 60), type: str(p.type, 40), status: str(p.status ?? 'pending', 24), ...(p.strategy ? { strategy: str(p.strategy, 24) } : {}), votesFor: votes.filter(v => v === true).length, votesAgainst: votes.filter(v => v === false).length };
  });
  const proposals = pend.length ? pend : hiveProposalsFromFile(c);
  return {
    hive: {
      id: str(h.hiveId ?? h.id, 80), status: str(h.status, 24), ...(h.topology ? { topology: str(h.topology, 24) } : {}), ...(h.consensus ? { consensus: str(h.consensus, 24) } : {}),
      queen: q ? { id: str(q.id, 80), status: str(q.status, 24), ...(typeof q.load === 'number' ? { load: Math.min(1000, Math.max(0, q.load)) } : {}), ...(typeof q.tasksQueued === 'number' ? { tasksQueued: nat(q.tasksQueued) } : {}) } : null,
      health: Object.fromEntries(Object.entries(health).slice(0, 12).map(([k, v]) => [str(k, 24), str(v, 24)])),
      metrics: { totalTasks: nat(m.totalTasks), completedTasks: nat(m.completedTasks), activeTasks: nat(m.activeTasks), pendingTasks: nat(m.pendingTasks), failedTasks: nat(m.failedTasks), consensusRounds: nat(m.consensusRounds), sharedMemoryKeys: nat(h.sharedMemoryKeys), uptimeS: Math.floor(nat(h.uptime) / 1000) },
    },
    workers, pendingConsensus: nat(h.pendingConsensus), proposals,
  };
};

export const workflows: Collector = async c => {
  const w = payload(await c.ruflo.mcp('workflow_list', {}));
  const rows = arr(w.workflows);
  return {
    total: nat(w.total ?? rows.length),
    workflows: rows.slice(0, 60).map(x => {
      const steps = Array.isArray(x.steps) ? x.steps.filter(isObj) : [];
      return { id: str(x.workflowId ?? x.id, 80), name: str(x.name ?? x.workflowId, 120), status: str(x.status, 24), steps: nat(x.stepCount ?? steps.length), ...(steps.length ? { doneSteps: steps.filter(s => s.status === 'completed' || s.status === 'done').length } : {}), ...(ms(x.updatedAt ?? x.createdAt) ? { updatedAt: ms(x.updatedAt ?? x.createdAt) } : {}) };
    }),
  };
};

export const learning: Collector = async c => {
  const [intel, model] = await Promise.all([c.ruflo.mcp('hooks_intelligence_stats').catch(() => null), c.ruflo.mcp('hooks_model-stats').catch(() => null)]);
  if (!isObj(intel) && !isObj(model)) throw new Error('no learning stats available');
  const sona = isObj(intel) && isObj(intel.sona) ? intel.sona : null; const moe = isObj(intel) && isObj(intel.moe) ? intel.moe : null; const ewc = isObj(intel) && isObj(intel.ewc) ? intel.ewc : null;
  const usage = moe && isObj(moe.loadBalance) && isObj(moe.loadBalance.expertUsage) ? Object.entries(moe.loadBalance.expertUsage) : [];
  const cats = sona && isObj(sona.patternCategories) ? Object.keys(sona.patternCategories) : [];
  return {
    router: isObj(model) && model.available !== false ? {
      totalDecisions: nat(model.totalDecisions), ...(ratio(model.avgConfidence) !== undefined ? { avgConfidence: ratio(model.avgConfidence) } : {}), circuitBreakerTrips: nat(model.circuitBreakerTrips),
      distribution: Object.entries(isObj(model.modelDistribution) ? model.modelDistribution : {}).slice(0, 8).map(([k, v]) => ({ model: str(k, 24), count: nat(v) })),
      routedBy: Object.entries(isObj(model.routedByCounts) ? model.routedByCounts : {}).slice(0, 12).map(([k, v]) => ({ via: str(k, 40), count: nat(v) })),
    } : null,
    sona: sona ? { trajectories: nat(sona.trajectoriesTotal), successful: nat(sona.trajectoriesSuccessful), patternsLearned: nat(sona.patternsLearned), ...(ratio(sona.successRate) !== undefined ? { successRate: ratio(sona.successRate) } : {}) } : null,
    moe: moe ? { experts: nat(moe.expertsTotal), active: nat(moe.expertsActive), decisions: nat(moe.routingDecisions), usage: usage.slice(0, 16).map(([k, v]) => ({ expert: str(k, 24), count: nat(v) })) } : null,
    ewc: ewc ? { consolidations: nat(ewc.consolidations), patterns: nat(ewc.totalPatterns) } : null,
    patterns: cats.slice(0, 20).map(k => str(k, 60)),
  };
};

/**
 * ruflo's metaharness_* tools spawn `node <plugins/ruflo-metaharness/scripts/*.mjs>` and, when the CLI's own copy is missing, fall back to a copy under the
 * PROJECT (cwd/plugins/... or cwd/node_modules/@claude-flow/cli/plugins/...). The connector cannot see which copy ruflo picks, so if the project could supply one
 * it does not call the tool at all: a cloned repository must never get code execution through a collector.
 */
export const METAHARNESS_SHADOWS = ['plugins/ruflo-metaharness/scripts', 'node_modules/@claude-flow/cli/plugins/ruflo-metaharness/scripts'] as const;
export function projectShadowsMetaharness(projectDir: string): boolean {
  for (const rel of METAHARNESS_SHADOWS) { try { lstatSync(join(projectDir, rel)); return true; } catch { /* absent */ } }
  return false;
}
const unavailableMh = (reason: string): Obj => ({ available: false, reason: reason.slice(0, 160), score: null, genome: null, audits: [], auditCount: 0 });
export const metaharness: Collector = async c => {
  if (projectShadowsMetaharness(c.projectDir)) return unavailableMh('this project ships its own metaharness scripts; they are never run by the connector');
  const [sc, gn, au] = await Promise.all([c.ruflo.mcp('metaharness_score'), c.ruflo.mcp('metaharness_genome').catch(() => null), c.ruflo.mcp('metaharness_audit_list', { limit: 20 }).catch(() => null)]);
  if (isObj(sc) && sc.degraded === true) return unavailableMh(`metaharness not available (${str(isObj(sc.data) ? sc.data.reason : 'degraded', 60)})`);
  const s = payload(sc); const g = isObj(gn) && gn.degraded !== true ? payload(gn) : null; const a = isObj(au) && au.degraded !== true ? payload(au) : null;
  const pct = (v: unknown) => Math.min(100, nat(v));
  return {
    available: true,
    score: { harnessFit: pct(s.harnessFit), compileConfidence: pct(s.compileConfidence), taskCoverage: pct(s.taskCoverage), toolSafety: pct(s.toolSafety), memoryUsefulness: pct(s.memoryUsefulness), ...(typeof s.estCostPerRunUsd === 'number' ? { estCostPerRunUsd: Math.min(1e6, Math.max(0, s.estCostPerRunUsd)) } : {}), ...(typeof s.scaffoldReady === 'boolean' ? { scaffoldReady: s.scaffoldReady } : {}), ...(s.recommendedMode ? { recommendedMode: str(s.recommendedMode, 40) } : {}), ...(s.archetype ? { archetype: str(s.archetype, 60) } : {}) },
    genome: g ? { repoType: str(g.repo_type, 40), topology: (Array.isArray(g.agent_topology) ? g.agent_topology : []).slice(0, 10).map(x => str(x, 40)), ...(ratio(g.risk_score) !== undefined ? { riskScore: ratio(g.risk_score) } : {}), ...(g.mcp_surface ? { mcpSurface: str(g.mcp_surface, 40) } : {}), ...(ratio(g.test_confidence) !== undefined ? { testConfidence: ratio(g.test_confidence) } : {}), ...(ratio(g.publish_readiness) !== undefined ? { publishReadiness: ratio(g.publish_readiness) } : {}), ...(g.verdict ? { verdict: str(g.verdict, 24) } : {}) } : null,
    audits: arr(a?.records).slice(0, 20).map(r => ({ key: str(r.key ?? r.id, 80), ...(ms(r.at ?? r.generatedAt) ? { at: ms(r.at ?? r.generatedAt) } : {}), ...(r.worst ? { worst: str(r.worst, 24) } : {}) })),
    auditCount: nat(a?.totalInNamespace),
    flywheel: await flywheel(c),
  };
};

export const security: Collector = async c => {
  const p = await c.ruflo.mcp('policy_status');
  if (!isObj(p)) throw new Error('unexpected result shape');
  const counts = isObj(p.counts) ? p.counts : {}; const led = isObj(p.ledger) ? p.ledger : {};
  const findings: { level: 'info' | 'warn' | 'error'; text: string }[] = [];
  if (led.valid === false) findings.push({ level: 'error', text: 'policy ledger failed its integrity check' });
  if (p.mode === 'legacy') findings.push({ level: 'info', text: 'policy runs in legacy mode (no rules or budgets enforced)' });
  return {
    policy: { mode: str(p.mode, 24), rules: nat(counts.rules), budgets: nat(counts.budgets), approvals: nat(counts.approvals), receipts: nat(counts.receipts), ledgerValid: led.valid !== false, ledgerLength: nat(led.length) },
    findings, anatole: anatole(c), note: 'AIDefence statistics are not collected: reading them makes ruflo install a package.',
  };
};

export const perf: Collector = async c => {
  const m = payload(await c.ruflo.mcp('performance_metrics'));
  const mm = isObj(m.metrics) ? m.metrics : {}; const cpu = isObj(mm.cpu) ? mm.cpu : null; const mem = isObj(mm.memory) ? mm.memory : null;
  return {
    // Only the sub-trees ruflo marks as measured (_real). Its latency and throughput series are placeholders and are not shown.
    cpu: cpu && cpu._real === true ? { percent: Math.min(100, Math.max(0, Number(cpu.current) || 0)), cores: nat(cpu.cores), loadAverage: (Array.isArray(cpu.loadAverage) ? cpu.loadAverage : []).slice(0, 3).map(n => Math.min(1e6, Math.max(0, Number(n) || 0))), ...(cpu.model ? { model: str(cpu.model, 80) } : {}) } : null,
    memory: mem && mem._real === true ? { usedMb: nat(mem.current), totalMb: nat(mem.total), heapMb: nat(mem.heap) } : null,
    note: 'latency and throughput are not shown: ruflo reports fixed placeholder values for them',
  };
};

export const automation: Collector = async c => {
  const [wl, ws, ss] = await Promise.all([c.ruflo.mcp('hooks_worker-list'), c.ruflo.mcp('hooks_worker-status').catch(() => null), c.ruflo.mcp('session_list', { limit: 10 }).catch(() => null)]);
  if (!isObj(wl)) throw new Error('unexpected result shape');
  const sm = isObj(ws) && isObj(ws.summary) ? ws.summary : {};
  const sessions = arr(isObj(ss) ? ss.sessions : []);
  const f = readRegular(c.projectDir, '.claude-flow/daemon-state.json', 32 * 1024);
  let daemon: Obj | null = null;
  if (f) { try { const d = JSON.parse(f.text) as unknown; if (isObj(d)) daemon = { running: d.running === true, ...(ms(d.startedAt) ? { startedAt: ms(d.startedAt) } : {}) }; } catch { /* unreadable state is "unknown" */ } }
  return {
    workers: arr(wl.workers).slice(0, 24).map(w => ({ trigger: str(w.trigger, 40), priority: str(w.priority, 12), description: str(w.description, 120), ...(w.estimatedDuration ? { estimatedDuration: str(w.estimatedDuration, 16) } : {}) })),
    running: { total: nat(sm.total), running: nat(sm.running), completed: nat(sm.completed), failed: nat(sm.failed) },
    sessions: { total: nat(isObj(ss) ? ss.total : 0), recent: sessions.slice(0, 10).map(s => ({ id: str(s.sessionId ?? s.id, 80), ...(s.name ? { name: str(s.name, 80) } : {}), ...(ms(s.savedAt ?? s.createdAt) ? { at: ms(s.savedAt ?? s.createdAt) } : {}) })) },
    daemon,
  };
};

export { P1_PLUGIN_COLLECTORS } from './capabilities/collectors.js';
