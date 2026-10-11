import { describe, expect, it } from 'vitest';
import {
  buildSectionFrame, fitToBudget, isSectionName, legacyDigestToSections, parseSectionFrame, parseWatch, READ_TOOLS, SECTION_BUDGET_BYTES, SECTION_CADENCE_S,
  SECTION_NAMES, SECTION_TTL_S, SECTION_VERSIONS, sectionHash, SectionSchemas, parseDigest, type SectionName,
} from '../../src/dashboard/protocol/index.js';

const SAMPLES: Record<SectionName, Record<string, unknown>> = {
  meta: { ruflo: { version: '3.55.0', node: 'v22', os: 'linux-x64' }, project: true, cli: 'ruflo', connector: '1' },
  health: { ok: true, notes: ['x'], areas: [{ name: 'memory', status: 'healthy' }] },
  alerts: { alerts: [{ level: 'warn', key: 'budget', text: 'near budget', go: 'cost' }] },
  control: { level: 'read', autoApprove: false, classBudgets: [{ class: 'plan', limit: 3 }] },
  missions: { missions: [{ id: 'msn_1', source: 'ruflo', objective: 'o', state: 'draft', revision: 1, detail: { plan: { taskCount: 1, tasks: [{ id: 't', title: 'T', status: 'todo' }] }, evidence: { count: 1, verified: 0 }, executor: null, blockedReason: null, budget: null } }] },
  mission_events: { events: [{ missionId: 'msn_1', seq: 1, type: 'mission.created', at: 1 }] },
  tasks: { total: 1, pending: 1, running: 0, done: 0, failed: 0, items: [{ id: 't1', title: 'x', status: 'pending' }] },
  swarm: { swarm: { id: 's', topology: 'hierarchical', maxAgents: 6 }, agents: [{ id: 'a', type: 'coder', state: 'idle' }] },
  approvals: { items: [{ kind: 'confirm', text: 'Run it?', ageS: 4 }] },
  memory: { entries: 3, namespaceCount: 1, namespaces: [{ name: 'default', count: 3 }], backend: 'sqlite', flags: [] },
  cost: { available: false, reason: 'ledger not installed', byModel: [], advice: [], perMission: [] },
  events: { events: [{ at: 1, kind: 'mission', level: 'info', src: 'ruflo', text: 't' }] },
  notices: { notices: [{ at: 1, level: 'info', text: 'hi', key: 'k' }], toastMode: 'all' },
  adrs: { folder: 'docs/adr', counts: { accepted: 1 }, items: [{ id: 'ADR-1', title: 'T', status: 'accepted', date: '2026-10-08' }], lint: [] },
  whatsnew: { plugins: [{ name: 'p', entries: [{ version: '1.0.0', changes: ['a'] }] }], breaking: [] },
  settings: { options: [{ key: 'k', value: 'v' }] },
  plugins: { plugins: [{ id: 'ruflo-adr@ruflo', name: 'ruflo-adr', marketplace: 'ruflo', version: '0.5.3', enabled: true, mod: false, foreign: false, manifestSha: '1a2b3c4d5e6f' }] },
  capabilities: { v: 1, generated: { treeSha: '1a2b3c4d5e6f', plugins: 1 }, plugins: [{ id: 'ruflo-adr@ruflo', version: '0.5.3', manifestSha: '1a2b3c4d5e6f', enabled: true, mod: false, counts: { commands: 1, skills: 1, agents: 0, options: 1, mcp: 0 },
    caps: [{ cid: 'ruflo-adr/skill/adr-verify@0.5.3+1a2b3c4d5e6f', kind: 'skill', name: 'adr-verify', risk: 'read', level: 'read', mode: 'run', args: [{ name: 'mode', type: 'enum', enum: ['all'] }] }, { cid: 'ruflo-adr/skill/adr-review@0.5.3+1a2b3c4d5e6f', kind: 'skill', name: 'adr-review', risk: 'write', level: null, mode: 'refused', why: 'no-binding' }],
    options: [{ key: 'guard', type: 'string', settable: false, why: 'loosens-gate' }] }], refused: { total: 1, byCode: { 'no-binding': 1 } } },
  capability_runs: { active: null, history: [{ runId: 'run_abcdefgh12', capabilityId: 'ruflo-adr/skill/adr-verify@0.5.3+1a2b3c4d5e6f', command: 'capability.run', level: 'read', risk: 'read', by: 'u', startedAt: 1, endedAt: 2, exit: 0, bytes: 3, truncated: false, outcome: 'succeeded', tail: 'ok' }] },
  claims: { summary: { total: 1, active: 1, blocked: 0, stealable: 0, humanClaims: 1, agentClaims: 0 }, claims: [{ issue: 'ISSUE-1', claimant: 'human:u1:Ana', kind: 'human', status: 'active', stealable: false }], loads: [] },
  hive: { hive: { id: 'hive-1', status: 'active', topology: 'mesh', queen: { id: 'q', status: 'active' }, metrics: { totalTasks: 1, completedTasks: 0, activeTasks: 1, pendingTasks: 0, failedTasks: 0, consensusRounds: 0 } }, workers: [{ id: 'w1', role: 'worker', status: 'idle' }], proposals: [] },
  workflows: { total: 1, workflows: [{ id: 'workflow-1', name: 'wf', status: 'ready', steps: 3 }] },
  learning: { router: { totalDecisions: 2, distribution: [{ model: 'haiku', count: 2 }], routedBy: [{ via: 'heuristic', count: 2 }] }, sona: { trajectories: 0, patternsLearned: 0 }, moe: null, ewc: null, patterns: [] },
  metaharness: { available: true, score: { harnessFit: 37, compileConfidence: 12, taskCoverage: 49, toolSafety: 100, memoryUsefulness: 4, estCostPerRunUsd: 0.048, scaffoldReady: false }, genome: null, audits: [], auditCount: 0 },
  security: { policy: { mode: 'legacy', rules: 0, budgets: 0, approvals: 0, receipts: 16, ledgerValid: true, ledgerLength: 16 }, findings: [] },
  perf: { cpu: { percent: 10, cores: 32, loadAverage: [1, 1, 1] }, memory: { usedMb: 100, totalMb: 1000, heapMb: 25 } },
  automation: { workers: [{ trigger: 'audit', priority: 'critical', description: 'Security analysis' }], running: { total: 0, running: 0, completed: 0, failed: 0 }, sessions: { total: 0, recent: [] }, daemon: null },
  agents: { summary: { total: 1, healthy: 1, degraded: 0, unhealthy: 0 }, agents: [{ id: 'a1', type: 'coder', health: 'healthy', tasksActive: 0, tasksQueued: 0, tasksCompleted: 1, tasksFailed: 0, uptimeS: 3 }] },
  autopilot: { present: true, killed: false, phase: 'running', envelope: { revision: 2, hash: 'abcdef012345' }, steps: { started: 2, done: 1, failed: 0, verified: 1, parked: 0 }, lastEvent: 'step.done', lastAt: 5, journalLines: 4, badLines: 0, unauthenticated: true },
  skills: { total: 1, skills: [{ name: 'my-skill', source: 'project', manifest: true }] },
  timeline: { endAt: 1000, bucketS: 300, buckets: 24, lanes: [{ lane: 'console', total: 1, counts: [0, 1] }] },
};

describe('sections', () => {
  it('has the 16 P0 + 15 P1 sections with budget, cadence, ttl and version for each', () => {
    expect(SECTION_NAMES).toHaveLength(31);
    for (const n of SECTION_NAMES) { expect(SECTION_BUDGET_BYTES[n]).toBeGreaterThan(0); expect(SECTION_CADENCE_S[n]).toBeGreaterThan(0); expect(SECTION_TTL_S[n]).toBeGreaterThanOrEqual(30); expect(SECTION_VERSIONS[n]).toBe(n === 'cost' ? 2 : 1); }
    expect(isSectionName('missions')).toBe(true); expect(isSectionName('bogus')).toBe(false);
  });
  it.each(SECTION_NAMES)('%s: sample is valid, unknown field is rejected (strict)', n => {
    expect(SectionSchemas[n].safeParse(SAMPLES[n]).success).toBe(true);
    expect(SectionSchemas[n].safeParse({ ...SAMPLES[n], extra: 1 }).success).toBe(false);
  });
  it.each(SECTION_NAMES)('%s: builds a frame that round-trips through parseSectionFrame', n => {
    const f = buildSectionFrame(n, SAMPLES[n] as never, { rev: 2, at: Date.now() });
    expect(f).toMatchObject({ v: 2, section: n, rev: 2, sv: SECTION_VERSIONS[n], truncated: false });
    const r = parseSectionFrame(JSON.parse(JSON.stringify(f)));
    expect(r.ok).toBe(true);
  });
  it('rejects unknown sections, extra frame fields, wrong version and bad ttl', () => {
    const f = buildSectionFrame('meta', SAMPLES.meta as never, { rev: 0, at: 1 });
    expect(parseSectionFrame({ ...f, section: 'bogus' })).toEqual({ ok: false, reason: 'unknown_section' });
    expect(parseSectionFrame({ ...f, extra: 1 })).toEqual({ ok: false, reason: 'malformed' });
    expect(parseSectionFrame({ ...f, v: 1 })).toEqual({ ok: false, reason: 'malformed' });
    expect(parseSectionFrame({ ...f, ttlS: 1 })).toEqual({ ok: false, reason: 'malformed' });
    expect(parseSectionFrame({ ...f, body: { ...f.body, nope: 1 } })).toEqual({ ok: false, reason: 'invalid_body' });
    expect(parseSectionFrame('garbage')).toEqual({ ok: false, reason: 'malformed' });
  });
  it('enforces the 64 KiB cap and per-section budgets on receipt', () => {
    const f = buildSectionFrame('meta', SAMPLES.meta as never, { rev: 0, at: 1 });
    const big = { ...f, section: 'swarm', body: { swarm: null, agents: Array.from({ length: 100 }, (_, i) => ({ id: 'a' + i, type: 't', state: 's', task: 'x'.repeat(120) })) } };
    expect(JSON.stringify(big.body).length).toBeGreaterThan(SECTION_BUDGET_BYTES.meta);
    expect(parseSectionFrame(big).ok).toBe(true); // within the swarm budget
    expect(parseSectionFrame({ ...f, body: { ...f.body, cli: 'x'.repeat(5000) } })).toMatchObject({ ok: false });
    expect(parseSectionFrame({ ...f, body: { filler: 'x'.repeat(70_000) } })).toEqual({ ok: false, reason: 'too_large' });
    const over = { ...f, section: 'health', body: { ok: true, notes: Array.from({ length: 20 }, () => 'n'.repeat(200)), areas: Array.from({ length: 40 }, () => ({ name: 'x'.repeat(40), status: 's'.repeat(24) })) } };
    expect(parseSectionFrame(over)).toEqual({ ok: false, reason: 'over_budget' });
  });
  it('sanitizes: strips control chars and masks secrets before validation', () => {
    const f = buildSectionFrame('events', { events: [{ at: 1, kind: 'k', level: 'info', src: 's', text: 'a\u001b[31m token=supersecret123 b' }] }, { rev: 0, at: 1 });
    const t = JSON.stringify(f);
    expect(t).not.toContain('\\u001b'); expect(t).not.toContain('supersecret123'); expect(t).toContain('[masked]');
  });
  it('trims over-budget bodies from the tail and flags truncated', () => {
    const events = Array.from({ length: 100 }, (_, i) => ({ at: i, kind: 'k', level: 'info', src: 's', text: 'x'.repeat(200) }));
    const fit = fitToBudget('events', { events });
    expect(fit.truncated).toBe(false); // 100 * ~260 B = 26 KiB < 40 KiB
    const heavy = Array.from({ length: 30 }, (_, i) => ({ at: i, level: 'warn', text: 'y'.repeat(200), key: 'k' + i, go: 'z' }));
    const notices = fitToBudget('alerts', { alerts: heavy.map(h => ({ level: 'warn' as const, key: h.key, text: h.text, go: h.go })) });
    expect(JSON.stringify(notices.body).length).toBeLessThanOrEqual(SECTION_BUDGET_BYTES.alerts);
    const mission = Array.from({ length: 100 }, (_, i) => ({ id: 'm' + i, source: 'ruflo', objective: 'o'.repeat(300), state: 'draft', revision: i, detail: { plan: { taskCount: 40, tasks: Array.from({ length: 40 }, (_, j) => ({ id: 't' + j, title: 'T'.repeat(120), status: 'todo' })) } } }));
    const f = buildSectionFrame('missions', { missions: mission }, { rev: 1, at: 1 });
    expect(f.truncated).toBe(true); expect(JSON.stringify(f.body).length).toBeLessThanOrEqual(SECTION_BUDGET_BYTES.missions);
    expect(parseSectionFrame(f).ok).toBe(true);
  });
  it('hash ignores key order and undefined, changes with content', () => {
    expect(sectionHash({ a: 1, b: [1, 2], c: undefined })).toBe(sectionHash({ b: [1, 2], a: 1 }));
    expect(sectionHash({ a: 1 })).not.toBe(sectionHash({ a: 2 }));
  });
  it('parseWatch keeps known, unique names, capped', () => {
    expect(parseWatch({ watch: ['missions', 'missions', 'bogus', 'swarm'] })).toEqual(['missions', 'swarm']);
    expect(parseWatch({})).toEqual([]); expect(parseWatch(null)).toEqual([]);
  });
  it('READ_TOOLS contains no write tools', () => {
    for (const w of ['mission_create', 'swarm_init', 'agent_spawn', 'memory_store', 'terminal_execute', 'task_create', 'config_set', 'swarm_shutdown']) expect(READ_TOOLS.has(w)).toBe(false);
    expect(READ_TOOLS.has('mission_get')).toBe(true);
  });
  it('maps a legacy v1 Digest onto valid section frames', () => {
    const p = parseDigest({ collectedAt: 5, ruflo: { version: '3.55.0' }, level: 'read', health: { ok: true, notes: [] }, missions: [{ id: 'm', objective: 'o', state: 'draft', revision: 1 }],
      tasks: { total: 1, pending: 1, running: 0, done: 0 }, swarm: { id: 's', agents: [{ id: 'a', type: 'coder', state: 'idle' }] }, memory: { entries: 2, namespaces: 1 }, cost: { currency: 'USD', totalMinor: 5 },
      adrs: [{ id: 'ADR-1', title: 'T', status: 'accepted' }], events: [{ at: 1, kind: 'k', text: 't' }] });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const mapped = legacyDigestToSections(p.digest);
    expect(mapped.map(m => m.section).sort()).toEqual(['adrs', 'cost', 'events', 'health', 'memory', 'meta', 'missions', 'swarm', 'tasks']);
    for (const m of mapped) expect(parseSectionFrame(buildSectionFrame(m.section, m.body as never, { rev: 0, at: 1 })).ok).toBe(true);
  });
});
