/** Shared test fixtures: temp state dir, temp ruflo project, stub ruflo, and a linked device against the fake dashboard. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Approver } from '../../../src/dashboard/approver.js';
import type { Ruflo } from '../../../src/dashboard/exec.js';
import { link } from '../../../src/dashboard/link.js';
import { runConnector, type RunEnd, type RunOptions } from '../../../src/dashboard/run.js';
import { loadConfig, saveConfig, type Config } from '../../../src/dashboard/state.js';
import { FakeDashboard, type FakeServerOpts } from './fake-server.js';
import type { Level } from '../../../src/dashboard/protocol/index.js';

export interface StubRuflo extends Ruflo { calls: { tool: string; params: Record<string, unknown> }[]; fail: Set<string>; overrides: Record<string, unknown> }

/** Canned results shaped like the real `ruflo mcp exec` output captured from @claude-flow/cli 3.55.0. */
export function stubRuflo(): StubRuflo {
  const s: StubRuflo = {
    calls: [], fail: new Set(), overrides: {},
    async mcp(tool, params = {}) {
      s.calls.push({ tool, params });
      if (s.fail.has(tool)) throw new Error(`${tool} failed`);
      if (tool in s.overrides) return s.overrides[tool];
      switch (tool) {
        case 'system_info': return { version: '3.55.0', nodeVersion: 'v22.23.2', platform: 'linux' };
        case 'system_health': return { overall: 'healthy', score: 100, checks: [{ name: 'memory', status: 'healthy' }] };
        case 'mission_get': return { ok: true, data: { missions: [{ missionId: 'msn_' + 'a'.repeat(24), objective: 'Ship the report, key sk-abcdefghijklmnopqrstuv', state: 'draft', revision: 1, updatedAt: '2026-10-08T03:11:19.776Z' }] } };
        case 'mission_events': return { ok: true, data: { events: [{ seq: 1, type: 'mission.created', at: '2026-10-08T03:11:19.776Z' }] } };
        case 'task_summary': return { total: 3, pending: 1, running: 1, completed: 1, failed: 0 };
        case 'swarm_status': return { swarmId: 'swarm-1', status: 'running', topology: 'hierarchical', maxAgents: 6, agentCount: 1 };
        case 'agent_health': return { agents: [{ id: 'agent-1', type: 'coder', health: 'healthy', uptime: 3305, tasks: { active: 0, queued: 0, completed: 1, failed: 0 } }], overall: { healthy: 1, degraded: 0, unhealthy: 0 }, total: 1, healthyCount: 1, unhealthyCount: 0 };
        case 'metaharness_flywheel': return { success: true, data: { state: { servingEpoch: 0, activeChampionRef: null, receiptStates: {} }, ledger: { valid: true, commits: 0 } } };
        case 'agent_list': return { agents: [{ agentId: 'agent-1', agentType: 'coder', status: 'idle' }], total: 1 };
        case 'memory_stats': return { totalEntries: 12, namespaces: { a: 1, b: 2 }, backend: 'sqlite (bridge)' };
        case 'memory_search': return { query: String(params.query), results: [{ key: 'k1', namespace: 'n', similarity: 0.9 }], total: 1 };
        case 'mission_create': return { ok: true, data: { missionId: 'msn_' + 'b'.repeat(24), revision: 1, state: 'draft', deduplicated: false } };
        case 'mission_request_action': return { ok: true, data: { missionId: params.missionId, revision: 2, state: 'paused' } };
        case 'swarm_init': return { success: true, swarmId: 'swarm-2', topology: params.topology, maxAgents: params.maxAgents };
        case 'agent_spawn': return { success: true, agentId: String(params.agentId ?? 'agent-new'), agentType: params.agentType, status: 'registered' };
        case 'swarm_health': return { status: 'running', healthy: true, checks: [] };
        case 'config_list': return { configs: [{ key: 'logging.level', value: 'info', source: 'stored' }, { key: 'api.token', value: 'sk-secretsecretsecret1234', source: 'stored' }] };
        case 'memory_list': return { entries: [{ key: 'k1', namespace: String(params.namespace), size: 5, storedAt: 1 }], total: 1, limit: params.limit, offset: 0 };
        case 'task_list': return { tasks: [{ taskId: 'task-1', type: 'implementation', description: 'probe', status: 'pending', assignedTo: ['agent-1'] }], total: 1 };
        case 'swarm_shutdown': return { success: true, swarmId: params.swarmId, terminated: true, agentsTerminated: 1 };
        // P1 tools, shaped like the real ruflo 3.55.0 output (see the probe notes in docs/threat-model.md)
        case 'claims_list': return { success: true, claims: [{ issueId: 'ISSUE-1', claimant: 'human:u1:Ana', status: 'active', progress: 40, claimedAt: '2026-10-08T03:11:19.776Z' }, { issueId: 'ISSUE-2', claimant: 'agent:a1:coder', status: 'blocked', blockReason: 'waiting for review', claimedAt: '2026-10-08T03:12:00.000Z' }], count: 2, stealableCount: 0 };
        case 'claims_board': return { success: true, board: {}, summary: { total: 2, active: 1, blocked: 1, stealable: 0, humanClaims: 1, agentClaims: 1 } };
        case 'claims_stealable': return { success: true, stealable: [{ issueId: 'ISSUE-2' }], count: 1 };
        case 'claims_load': return { success: true, loads: [{ agentId: 'a1', claims: 1, utilization: 0.5 }], totalAgents: 1, totalClaims: 2, avgUtilization: 0.5 };
        case 'hive-mind_status': return { hiveId: 'hive-1', status: 'active', topology: 'mesh', consensus: 'raft', queen: { id: 'queen-1', status: 'active', load: 0.2, tasksQueued: 1 }, workers: ['w1', 'w2'], metrics: { totalTasks: 4, completedTasks: 1, activeTasks: 2, pendingTasks: 1, failedTasks: 0, consensusRounds: 3 }, health: { overall: 'healthy', queen: 'healthy' }, initialized: true, workerCount: 2, pendingConsensus: 0, sharedMemoryKeys: 5, uptime: 120000 };
        case 'workflow_list': return { workflows: [{ workflowId: 'workflow-1', name: 'release', status: 'ready', stepCount: 3, steps: [{ status: 'completed' }, { status: 'pending' }, { status: 'pending' }] }], total: 1, filters: {} };
        case 'hooks_intelligence_stats': return { sona: { trajectoriesTotal: 4, trajectoriesSuccessful: 3, patternsLearned: 2, patternCategories: { learned: 2 }, successRate: 0.75 }, moe: { expertsTotal: 8, expertsActive: 2, routingDecisions: 9, loadBalance: { expertUsage: { coder: 5, tester: 4 } } }, ewc: { consolidations: 1, totalPatterns: 2 } };
        case 'hooks_model-stats': return { available: true, totalDecisions: 7, modelDistribution: { haiku: 5, sonnet: 2, opus: 0, inherit: 0 }, avgConfidence: 0.8, circuitBreakerTrips: 0, routedByCounts: { heuristic: 7 } };
        case 'metaharness_score': return { success: true, data: { harnessFit: 37, compileConfidence: 12, taskCoverage: 49, toolSafety: 100, memoryUsefulness: 4, estCostPerRunUsd: 0.048, recommendedMode: 'CLI + MCP', archetype: 'ai-agent-framework-harness', scaffoldReady: false }, degraded: false, exitCode: 0 };
        case 'metaharness_genome': return { success: true, data: { repo_type: 'unknown', agent_topology: ['maintainer'], risk_score: 0.72, mcp_surface: 'local_default_deny', test_confidence: 0, publish_readiness: 0.05, verdict: 'blocked' }, degraded: false, exitCode: 0 };
        case 'metaharness_audit_list': return { success: true, data: { totalInNamespace: 1, returned: 1, records: [{ key: 'audit-1', generatedAt: '2026-10-08T03:11:19.776Z', worst: 'low' }] }, degraded: false, exitCode: 0 };
        case 'policy_status': return { version: 1, mode: 'legacy', counts: { rules: 0, budgets: 0, approvals: 0, receipts: 16 }, ledger: { valid: true, length: 16 } };
        case 'hooks_worker-list': return { workers: [{ trigger: 'audit', description: 'Security analysis', priority: 'critical', estimatedDuration: '45s' }] };
        case 'hooks_worker-status': return { success: true, workers: [], summary: { total: 0, running: 0, completed: 0, failed: 0 } };
        case 'session_list': return { sessions: [{ sessionId: 's1', name: 'work', savedAt: '2026-10-08T03:11:19.776Z' }], total: 1, limit: 10 };
        case 'performance_metrics': return { metrics: { cpu: { current: 12, cores: 8, loadAverage: [1, 2, 3], model: 'cpu', _real: true }, memory: { current: 4096, total: 16384, heap: 25, _real: true }, latency: { current: 45 }, throughput: { current: 1250 } } };
        case 'agentdb_health': case 'agentdb_controllers': return { available: true, controllers: [] };
        case 'workflow_pause': case 'workflow_resume': case 'agentdb_consolidate': return { success: true };
        case 'agent_terminate': return { success: true, agentId: params.agentId, terminated: true };
        case 'agent_logs': return { agentId: params.agentId, entries: [{ timestamp: '2026-10-09T00:59:05.694Z', level: 'info', message: 'agent created (type=coder, status=idle)' }], total: 1, note: 'per-agent activity logging is not yet wired; entries are synthetic (ruvnet/ruflo#1916)' };
        case 'task_create': return { taskId: 'task-1-abc', type: params.type, description: params.description, status: 'pending' };
        case 'memory_store': return { success: true, key: params.key, namespace: params.namespace, stored: true };
        case 'claims_release': return { success: true, message: 'released' };
        case 'claims_status': return { success: true, claim: { issueId: params.issueId, status: params.status } };
        default: throw new Error(`unexpected tool ${tool}`);
      }
    },
  };
  return s;
}

export class Rig {
  srv!: FakeDashboard; home = ''; project = ''; root = '';
  ruflo = stubRuflo(); cfg!: Config;
  logs: string[] = [];
  static async create(opts: FakeServerOpts = {}, level: Level = 'read'): Promise<Rig> {
    const r = new Rig();
    r.root = mkdtempSync(join(tmpdir(), 'rfdash-'));
    r.home = join(r.root, 'home'); r.project = join(r.root, 'proj');
    mkdirSync(join(r.project, '.claude-flow'), { recursive: true });
    r.srv = await new FakeDashboard(opts).start();
    r.cfg = await link({ home: r.home, baseUrl: r.srv.baseUrl, name: 'test box', level, projectDir: r.project, sleep: async () => undefined });
    return r;
  }
  setConfig(patch: Partial<Config>): void { this.cfg = { ...loadConfig(this.home)!, ...patch }; saveConfig(this.home, this.cfg); }
  start(approver?: Approver, intervalMs = 60_000, extra: Partial<RunOptions> = {}): { done: Promise<RunEnd>; stop: () => void } {
    const ac = new AbortController();
    const done = runConnector({ home: this.home, projectDir: this.project, ruflo: this.ruflo, approver, homeDir: this.root, runCmd: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, truncated: false }), intervalMs, signal: ac.signal, log: l => this.logs.push(l), ...extra, sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 30))) });
    return { done, stop: () => ac.abort() };
  }
  async cleanup(): Promise<void> { await this.srv.stop(); rmSync(this.root, { recursive: true, force: true }); }
}
