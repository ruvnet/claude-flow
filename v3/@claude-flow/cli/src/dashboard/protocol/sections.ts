/** Sectioned digest (v2): one `SectionFrame` per section, strict zod bodies, per-section budgets/cadence, read-tool allowlist. */
import { z } from 'zod';
import { canonicalize } from './canonical.js';
import { sha256b64u } from './crypto.js';
import { sanitize, type Digest } from './digest.js';

export const SECTION_NAMES = ['meta', 'health', 'alerts', 'control', 'missions', 'mission_events', 'tasks', 'swarm', 'approvals', 'memory', 'cost', 'events', 'notices', 'adrs', 'whatsnew', 'settings',
  // P1 parity tier
  'plugins', 'capabilities', 'capability_runs', 'claims', 'hive', 'workflows', 'learning', 'metaharness', 'security', 'perf', 'automation',
  // P1-complete tier
  'agents', 'autopilot', 'skills', 'timeline'] as const;
export type SectionName = (typeof SECTION_NAMES)[number];
export const isSectionName = (n: unknown): n is SectionName => typeof n === 'string' && (SECTION_NAMES as readonly string[]).includes(n);

/** Hard cap on any serialized section body, whatever its own budget. */
export const MAX_SECTION_BODY_BYTES = 64 * 1024;
const KiB = 1024;
export const SECTION_BUDGET_BYTES: Record<SectionName, number> = {
  meta: 2 * KiB, health: 6 * KiB, alerts: 8 * KiB, control: 1 * KiB, missions: 64 * KiB, mission_events: 24 * KiB, tasks: 16 * KiB, swarm: 24 * KiB,
  approvals: 8 * KiB, memory: 8 * KiB, cost: 16 * KiB, events: 40 * KiB, notices: 8 * KiB, adrs: 48 * KiB, whatsnew: 48 * KiB, settings: 8 * KiB,
  plugins: 16 * KiB, capabilities: 64 * KiB, capability_runs: 40 * KiB, claims: 24 * KiB, hive: 16 * KiB, workflows: 24 * KiB, learning: 12 * KiB, metaharness: 12 * KiB,
  security: 12 * KiB, perf: 4 * KiB, automation: 16 * KiB, agents: 24 * KiB, autopilot: 4 * KiB, skills: 12 * KiB, timeline: 8 * KiB,
};
/** Default collection cadence in seconds (missions is 5 s while a mission is running; the connector decides). */
export const SECTION_CADENCE_S: Record<SectionName, number> = {
  meta: 60, health: 10, alerts: 10, control: 30, missions: 10, mission_events: 10, tasks: 10, swarm: 10, approvals: 10, memory: 60, cost: 300, events: 10, notices: 10, adrs: 120, whatsnew: 600, settings: 120,
  plugins: 120, capabilities: 300, capability_runs: 10, claims: 10, hive: 10, workflows: 15, learning: 30, metaharness: 120, security: 60, perf: 30, automation: 30, agents: 15, autopilot: 15, skills: 300, timeline: 30,
};
/** Heartbeat lifetime: a section is re-sent at half its ttl even if unchanged. */
export const SECTION_TTL_S: Record<SectionName, number> = Object.fromEntries(SECTION_NAMES.map(n => [n, Math.min(3600, Math.max(30, SECTION_CADENCE_S[n] * 3))])) as Record<SectionName, number>;
/** Supported schema version per section (announced in `hello.sections`). Additive changes bump it. */
export const SECTION_VERSIONS: Record<SectionName, number> = { ...(Object.fromEntries(SECTION_NAMES.map(n => [n, 1])) as Record<SectionName, number>),
  /** v2: carries `detail` ('coarse' by default: a spend bucket and nothing else). A v1 reader would show a coarse body as "no spend". */
  cost: 2 };
/**
 * The server silently drops a section frame that arrives sooner than this after the previous one of the same section (server/devices/sections.ts:
 * 2 s, 1 s for capability_runs). A connector must not count such a frame as delivered, so it keeps this gap itself (plus a margin) and retries.
 */
export const SECTION_MIN_SEND_GAP_MS = (n: SectionName): number => (n === 'capability_runs' ? 1_100 : 2_100);
/** Cadence multiplier for sections no browser is watching. */
export const UNWATCHED_CADENCE_FACTOR = 4;
export const MAX_WATCH = 40;

/** ruflo MCP tools the connector may call to COLLECT state. Anything else is refused by the collection client. */
export const READ_TOOLS: ReadonlySet<string> = new Set([
  'system_info', 'system_health', 'mission_get', 'mission_events', 'task_summary', 'task_list', 'swarm_status', 'swarm_health', 'agent_list',
  'memory_stats', 'memory_detailed-stats', 'memory_list', 'config_get', 'config_list', 'hooks_model-stats', 'policy_status', 'progress_summary',
  // P1 (each run in a temp project against ruflo 3.55.0; see docs/threat-model.md "P1 collection"). Deliberately NOT here: aidefence_stats (auto-installs a
  // package), neural_status / hooks_intelligence_unified-stats (load an ONNX model), claims_status / workflow_status (need an id), federation_* (network).
  'claims_list', 'claims_board', 'claims_stealable', 'claims_load', 'hive-mind_status', 'workflow_list', 'hooks_intelligence_stats', 'metaharness_score',
  'metaharness_genome', 'metaharness_audit_list', 'hooks_worker-list', 'hooks_worker-status', 'session_list', 'performance_metrics', 'agentdb_health', 'agentdb_controllers',
  // P1-complete: agent_health lists every agent in one call (agent_status needs an id). metaharness_flywheel is a read ONLY with {op:'status'} (it also promotes):
  // READ_TOOL_ARG_RULES below pins its parameters, and the guard enforces them.
  'agent_health', 'metaharness_flywheel',
]);
/** Parameter rules for READ_TOOLS entries that are only a read with certain parameters. A tool without a rule takes any parameters. */
export const READ_TOOL_ARG_RULES: Readonly<Record<string, (params: Record<string, unknown>) => boolean>> = {
  metaharness_flywheel: p => Object.keys(p).length === 1 && p.op === 'status',
};
export function readToolArgsAllowed(tool: string, params: Record<string, unknown> | undefined): boolean {
  const rule = Object.prototype.hasOwnProperty.call(READ_TOOL_ARG_RULES, tool) ? READ_TOOL_ARG_RULES[tool] : undefined;
  return rule ? rule(params ?? {}) : true;
}

/** Order-of-magnitude spend over the window (USD). The bucket edges are fixed here so a connector cannot invent finer ones. */
export const COST_BUCKETS = ['none', 'under-1', '1-10', '10-100', '100-1000', 'over-1000'] as const;
export type CostBucket = (typeof COST_BUCKETS)[number];
export function costBucket(usd: number): CostBucket {
  if (!Number.isFinite(usd) || usd <= 0) return 'none';
  return usd < 1 ? 'under-1' : usd < 10 ? '1-10' : usd < 100 ? '10-100' : usd < 1000 ? '100-1000' : 'over-1000';
}
const S = (n: number) => z.string().max(n);
/** Safe integers only: 1e308 is an integer to zod but not a value any counter can hold. */
const nat = z.number().int().safe().nonnegative();
const int = z.number().int().safe();
/** 2100-01-01 in ms: no honest frame is dated beyond it. */
export const MAX_FRAME_AT_MS = 4_102_444_800_000;
export const MAX_FRAME_REV = 1_000_000_000_000;

/** name@marketplace, exactly as `claude plugin enable` takes it. */
export const PLUGIN_ID = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}@[a-z0-9][a-z0-9-]{0,63}$/);
/** <plugin>/<kind>/<name>@<version>+<fileSha12> (docs/parity-capability-design.md section 4). */
export const CAPABILITY_ID = z.string().regex(/^[a-z0-9-]{1,64}\/(command|skill|tool|view)\/[A-Za-z0-9._-]{1,80}@\d+\.\d+\.\d+[-.\w]*\+[0-9a-f]{12}$/);
/** Why a capability is not runnable: a closed list (docs/parity-capability-design.md section 7). */
export const REFUSE_CODES = ['no-binding', 'no-schema', 'foreign-marketplace', 'risk-network', 'risk-install', 'risk-spend', 'risk-delete', 'free-shell', 'free-text-to-agent', 'path-outside-root', 'secret-option', 'loosens-gate', 'would-raise-cap', 'script-changed', 'project-shadow', 'not-settable', 'unreadable'] as const;
export type RefuseCode = (typeof REFUSE_CODES)[number];
const WHY = z.enum(REFUSE_CODES);
/** One plugin in the `plugins` section. `why: 'unreadable'` lists a plugin the connector could not read, instead of dropping it. */
export const PLUGIN_ENTRY = z.object({ id: PLUGIN_ID, name: S(64), marketplace: S(64), version: S(40), enabled: z.boolean(), mod: z.boolean(), foreign: z.boolean(), manifestSha: S(12), why: WHY.optional() }).strict();
const CAP_KIND = z.enum(['command', 'skill', 'tool', 'view']);
export const CAPABILITY_RISKS = ['read', 'write', 'network', 'install', 'spend', 'delete'] as const;
export type CapabilityRisk = (typeof CAPABILITY_RISKS)[number];
const CAP_RISK = z.enum(CAPABILITY_RISKS);
const RUN_ID = z.string().regex(/^run_[A-Za-z0-9_-]{8,48}$/);
const CAP_ARG = z.object({ name: S(32), type: z.enum(['string', 'int', 'bool', 'enum', 'path']), max: nat.optional(), min: int.optional(), enum: z.array(S(40)).max(24).optional() }).strict();
/** One plugin in the `capabilities` section; validated on its own by the connector so one bad plugin cannot reject the whole frame. */
export const CAPS_ENTRY = z.object({
  id: PLUGIN_ID, version: S(40), manifestSha: S(12), enabled: z.boolean(), mod: z.boolean(), why: WHY.optional(),
  counts: z.object({ commands: nat, skills: nat, agents: nat, options: nat, mcp: nat }).strict(),
  caps: z.array(z.object({
    cid: CAPABILITY_ID, kind: CAP_KIND, name: S(80), risk: CAP_RISK, level: z.enum(['read', 'write', 'manage']).nullable(), mode: z.enum(['run', 'view', 'refused']),
    why: WHY.optional(), args: z.array(CAP_ARG).max(12).optional(),
  }).strict()).max(400),
  options: z.array(z.object({ key: S(48), type: S(16), default: z.union([z.boolean(), z.number().safe(), S(64)]).optional(), choices: z.array(S(64)).max(12).optional(), settable: z.boolean(), why: WHY.optional() }).strict()).max(60),
}).strict();
const level = z.enum(['info', 'warn', 'error']);
const lvl5 = z.enum(['off', 'read', 'write', 'manage', 'full']);

const detail = z.object({
  plan: z.object({ taskCount: nat, tasks: z.array(z.object({ id: S(60), title: S(120), status: S(24) }).strict()).max(40) }).strict().optional(),
  evidence: z.object({ count: nat, verified: nat }).strict().optional(),
  executor: S(80).nullable().optional(), blockedReason: S(200).nullable().optional(),
  budget: z.object({ currency: S(8).optional(), limitMinor: nat.optional(), spentMinor: nat.optional() }).strict().nullable().optional(),
}).strict();

export const SectionSchemas = {
  meta: z.object({ ruflo: z.object({ version: S(40), node: S(40).optional(), os: S(40).optional() }).strict(), consoleVersion: S(40).optional(), pluginVersion: S(40).optional(),
    project: z.boolean(), cli: S(40).optional(), updateAvailable: S(40).optional(), connector: S(10).optional(), notes: z.array(S(200)).max(5).optional() }).strict(),
  health: z.object({ ok: z.boolean(), notes: z.array(S(200)).max(20), areas: z.array(z.object({ name: S(40), status: S(24) }).strict()).max(40) }).strict(),
  alerts: z.object({ alerts: z.array(z.object({ level, key: S(60), text: S(200), go: S(60).optional() }).strict()).max(30) }).strict(),
  control: z.object({ level: lvl5, autoApprove: z.boolean(), modelControl: S(24).optional(), modelConfirm: S(24).optional(),
    classBudgets: z.array(z.object({ class: S(24), limit: nat }).strict()).max(10).optional() }).strict(),
  missions: z.object({ missions: z.array(z.object({ id: S(40), source: S(24), objective: S(300), state: S(24), revision: nat, executionMode: S(24).optional(), updatedAt: int.optional(), detail: detail.optional() }).strict()).max(100) }).strict(),
  mission_events: z.object({ events: z.array(z.object({ missionId: S(40), seq: nat, type: S(60), status: S(24).optional(), at: int, evidenceKind: S(24).optional() }).strict()).max(100) }).strict(),
  tasks: z.object({ total: nat, pending: nat, running: nat, done: nat, failed: nat, items: z.array(z.object({ id: S(60), title: S(120), status: S(24), agent: S(60).optional() }).strict()).max(50) }).strict(),
  swarm: z.object({ swarm: z.object({ id: S(80), topology: S(32).optional(), maxAgents: nat.optional(), health: S(24).optional(), status: S(24).optional() }).strict().nullable(),
    agents: z.array(z.object({ id: S(80), type: S(40), state: S(24), task: S(120).optional(), lastActiveAt: int.optional() }).strict()).max(100) }).strict(),
  approvals: z.object({ items: z.array(z.object({ kind: S(40), text: S(200), ageS: nat }).strict()).max(30) }).strict(),
  memory: z.object({ entries: nat, namespaceCount: nat.optional(), namespaces: z.array(z.object({ name: S(60), count: nat }).strict()).max(50), backend: S(60).optional(), vectors: nat.optional(), flags: z.array(S(60)).max(10) }).strict(),
  /**
   * `detail` is 'coarse' unless the person set cost.detail=full in the connector's OWN config.json (never settable from the dashboard, ruflo or a plugin option).
   * A coarse body carries `bucket` and nothing else: no totals, no per-model rows, no token counts, no cache ratio, no advice, no per-mission figures.
   */
  cost: z.object({ available: z.boolean(), detail: z.enum(['coarse', 'full']).optional(), bucket: z.enum(COST_BUCKETS).optional(), reason: S(160).optional(), windowDays: nat.optional(),
    totals: z.object({ currency: S(8), totalMinor: nat, todayMinor: nat.optional() }).strict().optional(),
    byModel: z.array(z.object({ provider: S(24), model: S(60), minor: nat, unit: z.enum(['usd', 'credits']).optional(), tokens: nat.optional() }).strict()).max(20),
    creditsTotal: nat.optional(), unpriced: z.array(S(60)).max(20).optional(),
    cacheHitRatio: z.number().min(0).max(1).optional(), budget: z.object({ currency: S(8), limitMinor: nat, spentMinor: nat }).strict().optional(),
    advice: z.array(S(200)).max(10), perMission: z.array(z.object({ missionId: S(40), minor: nat }).strict()).max(20) }).strict()
    .refine(b => b.detail !== 'coarse' || (!b.totals && b.byModel.length === 0 && b.advice.length === 0 && b.perMission.length === 0 && b.creditsTotal === undefined && b.cacheHitRatio === undefined && !b.budget && !b.unpriced?.length), 'a coarse cost body carries a bucket only'),
  events: z.object({ events: z.array(z.object({ at: int, kind: S(40), level: S(12), src: S(40), text: S(200) }).strict()).max(100) }).strict(),
  notices: z.object({ notices: z.array(z.object({ at: int, level: S(12), text: S(200), key: S(60) }).strict()).max(30), toastMode: S(24).optional() }).strict(),
  adrs: z.object({ folder: S(100), convention: S(40).optional(), counts: z.record(S(24), nat).refine(r => Object.keys(r).length <= 16, 'too many statuses'),
    items: z.array(z.object({ id: S(40), title: S(160), status: S(24), date: S(24).optional(), supersedes: S(40).optional(), supersededBy: S(40).optional() }).strict()).max(200), lint: z.array(S(200)).max(40) }).strict(),
  whatsnew: z.object({ plugins: z.array(z.object({ name: S(60), entries: z.array(z.object({ version: S(24), date: S(24).optional(), changes: z.array(S(160)).max(6) }).strict()).max(3) }).strict()).max(10), breaking: z.array(S(160)).max(10) }).strict(),
  settings: z.object({ options: z.array(z.object({ key: S(60), value: S(160) }).strict()).max(60) }).strict(),
  // ---- P1 parity tier -------------------------------------------------------------------------------------------------------------------
  /** Installed plugins: names, versions, enabled. Never an install path. */
  plugins: z.object({ plugins: z.array(PLUGIN_ENTRY).max(120) }).strict(),
  /** Locally built capability catalog (docs/parity-capability-design.md section 3). */
  capabilities: z.object({
    v: z.literal(1), generated: z.object({ treeSha: S(12), plugins: nat }).strict(),
    plugins: z.array(CAPS_ENTRY).max(120),
    refused: z.object({ total: nat, byCode: z.record(WHY, nat).refine(r => Object.keys(r).length <= 24, 'too many codes') }).strict(),
  }).strict(),
  /** capability.run / mod.option.set / plugin.* history: the last runs, newest first, never an argument value that looked secret. */
  capability_runs: z.object({
    active: z.object({ runId: RUN_ID, capabilityId: S(200), startedAt: int, tail: S(8192) }).strict().nullable(),
    history: z.array(z.object({
      runId: RUN_ID, capabilityId: S(200), plugin: PLUGIN_ID.optional(), command: S(24), level: S(12), risk: S(12), by: S(80), startedAt: int, endedAt: int, exit: int.nullable(), bytes: nat, truncated: z.boolean(),
      outcome: z.enum(['succeeded', 'failed', 'denied', 'refused', 'expired', 'changed']), reason: S(60).optional(), tail: S(8192).optional(),
      /** Which binding ran: mcp:<tool>, cli:<program> <subcommand> or script:<file>. */ binding: S(80).optional(),
    }).strict()).max(40),
  }).strict(),
  claims: z.object({
    summary: z.object({ total: nat, active: nat, blocked: nat, stealable: nat, humanClaims: nat, agentClaims: nat }).strict(),
    claims: z.array(z.object({ issue: S(80), claimant: S(80), kind: z.enum(['human', 'agent', 'unknown']), status: S(24), progress: nat.optional(), claimedAt: int.optional(), stealable: z.boolean(), note: S(160).optional() }).strict()).max(100),
    loads: z.array(z.object({ agent: S(80), claims: nat, utilization: z.number().min(0).max(10).optional() }).strict()).max(40),
  }).strict(),
  hive: z.object({
    hive: z.object({ id: S(80), status: S(24), topology: S(24).optional(), consensus: S(24).optional(), queen: z.object({ id: S(80), status: S(24), load: z.number().min(0).max(1000).optional(), tasksQueued: nat.optional() }).strict().nullable(),
      health: z.record(S(24), S(24)).refine(r => Object.keys(r).length <= 12, 'too many health keys').optional(),
      metrics: z.object({ totalTasks: nat, completedTasks: nat, activeTasks: nat, pendingTasks: nat, failedTasks: nat, consensusRounds: nat, sharedMemoryKeys: nat.optional(), uptimeS: nat.optional() }).strict(),
    }).strict().nullable(),
    workers: z.array(z.object({ id: S(80), role: S(24), status: S(24) }).strict()).max(60),
    /** Proposals still open according to ruflo's own count, whether or not the state file listed them. */
    pendingConsensus: nat.optional(),
    proposals: z.array(z.object({ id: S(60), type: S(40), status: S(24), strategy: S(24).optional(), votesFor: nat, votesAgainst: nat }).strict()).max(30),
  }).strict(),
  workflows: z.object({ total: nat, workflows: z.array(z.object({ id: S(80), name: S(120), status: S(24), steps: nat, doneSteps: nat.optional(), updatedAt: int.optional() }).strict()).max(60) }).strict(),
  learning: z.object({
    router: z.object({ totalDecisions: nat, avgConfidence: z.number().min(0).max(1).optional(), circuitBreakerTrips: nat.optional(), distribution: z.array(z.object({ model: S(24), count: nat }).strict()).max(8), routedBy: z.array(z.object({ via: S(40), count: nat }).strict()).max(12) }).strict().nullable(),
    sona: z.object({ trajectories: nat, successful: nat.optional(), patternsLearned: nat, successRate: z.number().min(0).max(1).optional() }).strict().nullable(),
    moe: z.object({ experts: nat, active: nat, decisions: nat, usage: z.array(z.object({ expert: S(24), count: nat }).strict()).max(16) }).strict().nullable(),
    ewc: z.object({ consolidations: nat, patterns: nat }).strict().nullable(),
    patterns: z.array(S(60)).max(20),
  }).strict(),
  metaharness: z.object({
    available: z.boolean(), reason: S(160).optional(),
    score: z.object({ harnessFit: nat, compileConfidence: nat, taskCoverage: nat, toolSafety: nat, memoryUsefulness: nat, estCostPerRunUsd: z.number().min(0).max(1e6).optional(), scaffoldReady: z.boolean().optional(), recommendedMode: S(40).optional(), archetype: S(60).optional() }).strict().nullable(),
    genome: z.object({ repoType: S(40), topology: z.array(S(40)).max(10), riskScore: z.number().min(0).max(1).optional(), mcpSurface: S(40).optional(), testConfidence: z.number().min(0).max(1).optional(), publishReadiness: z.number().min(0).max(1).optional(), verdict: S(24).optional() }).strict().nullable(),
    audits: z.array(z.object({ key: S(80), at: int.optional(), worst: S(24).optional() }).strict()).max(20),
    auditCount: nat,
    /** metaharness_flywheel {op:'status'}: the evaluation ledger. Promotion is never reachable from here. */
    flywheel: z.object({ ledgerValid: z.boolean(), commits: nat, servingEpoch: nat, champion: S(80).nullable(), receipts: nat }).strict().nullable().optional(),
  }).strict(),
  security: z.object({
    policy: z.object({ mode: S(24), rules: nat, budgets: nat, approvals: nat, receipts: nat, ledgerValid: z.boolean(), ledgerLength: nat }).strict().nullable(),
    findings: z.array(z.object({ level, text: S(200) }).strict()).max(20),
    note: S(200).optional(),
    /** Project Anatole's status file, AS REPORTED by the mod: any process can write it, so it is labelled unauthenticated and never a basis for a command. */
    anatole: z.object({ present: z.boolean(), mode: S(12).nullable(), calls: nat, blocked: nat, open: z.object({ critical: nat, high: nat, medium: nat, low: nat, total: nat }).strict(), degraded: S(80).nullable(), updatedAt: int.optional(), unauthenticated: z.literal(true) }).strict().nullable().optional(),
  }).strict(),
  perf: z.object({
    cpu: z.object({ percent: z.number().min(0).max(100), cores: nat, loadAverage: z.array(z.number().min(0).max(1e6)).max(3), model: S(80).optional() }).strict().nullable(),
    memory: z.object({ usedMb: nat, totalMb: nat, heapMb: nat.optional() }).strict().nullable(),
    note: S(160).optional(),
  }).strict(),
  automation: z.object({
    workers: z.array(z.object({ trigger: S(40), priority: S(12), description: S(120), estimatedDuration: S(16).optional() }).strict()).max(24),
    running: z.object({ total: nat, running: nat, completed: nat, failed: nat }).strict(),
    sessions: z.object({ total: nat, recent: z.array(z.object({ id: S(80), name: S(80).optional(), at: int.optional() }).strict()).max(10) }).strict(),
    daemon: z.object({ running: z.boolean(), startedAt: int.optional() }).strict().nullable(),
  }).strict(),
  // ---- P1-complete tier ----------------------------------------------------------------------------------------------------------------
  /** Per-agent detail from agent_health (one call, all agents). Logs are NOT here: they are free text and come on demand through the agent.logs command. */
  agents: z.object({
    summary: z.object({ total: nat, healthy: nat, degraded: nat, unhealthy: nat }).strict(),
    agents: z.array(z.object({ id: S(80), type: S(40), health: S(24), tasksActive: nat, tasksQueued: nat, tasksCompleted: nat, tasksFailed: nat, uptimeS: nat.optional() }).strict()).max(100),
    note: S(160).optional(),
  }).strict(),
  /** The console's autopilot (ADR-466/470) as its files report it. Read-only; the only control is autopilot.stop (the KILL file). Not ruflo's autopilot_* MCP loops. */
  autopilot: z.object({
    present: z.boolean(), killed: z.boolean(), phase: z.enum(['none', 'idle', 'running', 'paused', 'stopped']),
    envelope: z.object({ revision: nat.optional(), hash: S(16).optional() }).strict().nullable(),
    steps: z.object({ started: nat, done: nat, failed: nat, verified: nat, parked: nat }).strict(),
    lastEvent: S(24).optional(), lastAt: int.optional(), journalLines: nat, badLines: nat, unauthenticated: z.literal(true),
  }).strict(),
  /** Installed skill NAMES from .claude/skills, .agents/skills and the user's ~/.claude/skills. No bodies, no paths, no network (npx skills is never run). */
  skills: z.object({
    total: nat,
    skills: z.array(z.object({ name: S(64), source: z.enum(['project', 'agents', 'user']), manifest: z.boolean() }).strict()).max(200),
  }).strict(),
  /** Activity per lane (console event source) in equal buckets ending at `endAt`. It is event activity, NOT agent busy/idle: lanes.jsonl is not read. */
  timeline: z.object({
    endAt: int, bucketS: nat, buckets: nat,
    lanes: z.array(z.object({ lane: S(40), total: nat, counts: z.array(nat).max(24) }).strict()).max(16),
    note: S(160).optional(),
  }).strict(),
} as const satisfies Record<SectionName, z.ZodTypeAny>;
export type SectionBody<N extends SectionName> = z.infer<(typeof SectionSchemas)[N]>;

export const SectionFrameSchema = z.object({
  v: z.literal(2), section: z.enum(SECTION_NAMES), rev: nat.max(MAX_FRAME_REV), sv: int.min(1).max(1000), at: int.positive().max(MAX_FRAME_AT_MS),
  ttlS: int.min(5).max(3600), truncated: z.boolean(), body: z.record(z.unknown()),
}).strict();
export type SectionFrame = z.infer<typeof SectionFrameSchema>;

/** Largest array(s) per section, dropped from the tail (oldest/lowest priority last) when a body exceeds its budget. */
const TRIM: Record<SectionName, string[]> = {
  meta: [], health: ['areas', 'notes'], alerts: ['alerts'], control: [], missions: ['missions'], mission_events: ['events'], tasks: ['items'], swarm: ['agents'], approvals: ['items'],
  memory: ['namespaces'], cost: ['byModel', 'perMission', 'advice'], events: ['events'], notices: ['notices'], adrs: ['items', 'lint'], whatsnew: ['plugins'], settings: ['options'],
  plugins: ['plugins'], capabilities: ['plugins'], capability_runs: ['history'], claims: ['claims', 'loads'], hive: ['workers', 'proposals'], workflows: ['workflows'], learning: ['patterns'],
  metaharness: ['audits'], security: ['findings'], perf: [], automation: ['workers', 'sessions'],
  agents: ['agents'], autopilot: [], skills: ['skills'], timeline: ['lanes'],
};
const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const budgetOf = (n: SectionName) => Math.min(SECTION_BUDGET_BYTES[n], MAX_SECTION_BODY_BYTES);


type CapsBody = { plugins: Array<{ caps: Array<{ mode: string; why?: string; args?: unknown }> }> };
type RunsBody = { history: Array<{ tail?: string }> };
/** Design section 3 order: refused entries lose why/args, then the refused entries go (byCode counts stay), then args summaries; the generic tail drop is the last resort. */
function trimCapabilities(b: CapsBody, cap: number): boolean {
  const steps: Array<() => void> = [
    () => { for (const p of b.plugins) for (const c of p.caps) if (c.mode === 'refused') { delete c.why; delete c.args; } },
    () => { for (const p of b.plugins) p.caps = p.caps.filter(c => c.mode !== 'refused'); },
    () => { for (const p of b.plugins) for (const c of p.caps) delete c.args; },
  ];
  let cut = false;
  for (const f of steps) { if (size(b) <= cap) break; f(); cut = true; }
  return cut;
}
/** Output tails go first (oldest runs first), so the record of what ran survives longer than its text. */
function trimRuns(b: RunsBody, cap: number): boolean {
  let cut = false;
  for (let i = b.history.length - 1; i >= 0 && size(b) > cap; i--) if (b.history[i]!.tail !== undefined) { delete b.history[i]!.tail; cut = true; }
  return cut;
}

/** Drop tail items until the body fits its budget. Returns the (possibly cut) body and whether anything was dropped. Never splits across frames. */
export function fitToBudget<N extends SectionName>(name: N, body: SectionBody<N>): { body: SectionBody<N>; truncated: boolean } {
  const cap = budgetOf(name);
  const out = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  let truncated = false;
  if (name === 'capabilities' && size(out) > cap) truncated = trimCapabilities(out as CapsBody, cap);
  if (name === 'capability_runs' && size(out) > cap) truncated = trimRuns(out as RunsBody, cap);
  for (const key of TRIM[name]) {
    const arr = out[key];
    if (!Array.isArray(arr)) continue;
    while (size(out) > cap && arr.length > 0) {
      const drop = Math.max(1, Math.floor(arr.length / 10));
      arr.splice(arr.length - drop, drop); truncated = true;
    }
    if (size(out) <= cap) break;
  }
  return { body: out as SectionBody<N>, truncated };
}

/** Stable content hash used for change detection (key order and undefined do not matter). */
export const sectionHash = (body: unknown): string => sha256b64u(canonicalize(JSON.parse(JSON.stringify(body))));

export interface FrameMeta { rev: number; at: number; ttlS?: number; sv?: number; truncated?: boolean }
/** Validate a body against its schema and wrap it. Throws if the body is invalid or still over budget after trimming. */
export function buildSectionFrame<N extends SectionName>(name: N, body: SectionBody<N>, m: FrameMeta): SectionFrame {
  const fit = fitToBudget(name, SectionSchemas[name].parse(sanitize(body)) as SectionBody<N>);
  if (size(fit.body) > budgetOf(name)) throw new Error(`section ${name} exceeds its budget`);
  return SectionFrameSchema.parse({ v: 2, section: name, rev: m.rev, sv: m.sv ?? SECTION_VERSIONS[name], at: m.at, ttlS: m.ttlS ?? SECTION_TTL_S[name], truncated: m.truncated === true || fit.truncated, body: fit.body });
}

export type SectionParse = { ok: true; frame: SectionFrame & { section: SectionName } } | { ok: false; reason: 'too_large' | 'malformed' | 'unknown_section' | 'invalid_body' | 'over_budget' };
/** Server-side and test-side parse: size cap, sanitize, strict frame, strict per-section body, per-section budget. */
export function parseSectionFrame(raw: unknown): SectionParse {
  let s = 0;
  try { s = Buffer.byteLength(JSON.stringify(raw)); } catch { return { ok: false, reason: 'malformed' }; }
  if (s > MAX_SECTION_BODY_BYTES + 1024) return { ok: false, reason: 'too_large' };
  const clean = sanitize(raw);
  if (clean && typeof clean === 'object' && !Array.isArray(clean) && (clean as { v?: unknown }).v === 2 && !isSectionName((clean as { section?: unknown }).section)) return { ok: false, reason: 'unknown_section' };
  const f = SectionFrameSchema.safeParse(clean);
  if (!f.success) return { ok: false, reason: 'malformed' };
  const name = f.data.section;
  if (size(f.data.body) > MAX_SECTION_BODY_BYTES) return { ok: false, reason: 'too_large' };
  if (size(f.data.body) > SECTION_BUDGET_BYTES[name]) return { ok: false, reason: 'over_budget' };
  const b = SectionSchemas[name].safeParse(f.data.body);
  if (!b.success) return { ok: false, reason: 'invalid_body' };
  return { ok: true, frame: { ...f.data, section: name, body: b.data as Record<string, unknown> } };
}

/** Watch hint carried in a signed server `ping` body: `{watch: [...]}`. Unknown names are dropped, at most MAX_WATCH kept. */
export function parseWatch(body: unknown): SectionName[] {
  const w = body && typeof body === 'object' ? (body as { watch?: unknown }).watch : undefined;
  if (!Array.isArray(w)) return [];
  return [...new Set(w.filter(isSectionName))].slice(0, MAX_WATCH);
}

/** Map a legacy v1 Digest (bare or {digest}) onto section bodies so old connectors keep working. */
export function legacyDigestToSections(d: Digest): Array<{ section: SectionName; body: Record<string, unknown> }> {
  return legacyRaw(d).flatMap(x => {
    const r = SectionSchemas[x.section].safeParse(sanitize(x.body));
    return r.success && size(r.data) <= budgetOf(x.section) ? [{ section: x.section, body: r.data as Record<string, unknown> }] : [];
  });
}
function legacyRaw(d: Digest): Array<{ section: SectionName; body: Record<string, unknown> }> {
  const tally = new Map<string, number>();
  for (const a of d.adrs) tally.set(a.status, (tally.get(a.status) ?? 0) + 1);
  const counts = Object.fromEntries([...tally].sort((x, y) => y[1] - x[1]).slice(0, 16));
  const out: Array<{ section: SectionName; body: Record<string, unknown> }> = [
    { section: 'meta', body: { ruflo: d.ruflo, project: true, cli: 'legacy', connector: '1' } },
    { section: 'health', body: { ok: d.health.ok, notes: d.health.notes, areas: [] } },
    { section: 'missions', body: { missions: d.missions.map(m => ({ id: m.id, source: 'ruflo', objective: m.objective, state: m.state, revision: m.revision, ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}) })) } },
    { section: 'adrs', body: { folder: 'docs/adr', counts, items: d.adrs.slice(0, 200).map(a => ({ id: a.id.slice(0, 40), title: a.title.slice(0, 160), status: a.status.slice(0, 24) })), lint: [] } },
    { section: 'events', body: { events: d.events.map(e => ({ at: e.at, kind: e.kind, level: 'info', src: 'mission', text: e.text })) } },
  ];
  if (d.tasks) out.push({ section: 'tasks', body: { ...d.tasks, failed: 0, items: [] } });
  if (d.swarm) out.push({ section: 'swarm', body: { swarm: d.swarm.id ? { id: d.swarm.id, ...(d.swarm.topology ? { topology: d.swarm.topology } : {}), ...(d.swarm.maxAgents !== undefined ? { maxAgents: d.swarm.maxAgents } : {}) } : null, agents: d.swarm.agents } });
  if (d.memory) out.push({ section: 'memory', body: { entries: d.memory.entries, ...(d.memory.namespaces !== undefined ? { namespaceCount: d.memory.namespaces } : {}), namespaces: [], ...(d.memory.backend ? { backend: d.memory.backend } : {}), flags: [] } });
  out.push({ section: 'cost', body: d.cost ? { available: true, totals: d.cost, byModel: [], advice: [], perMission: [] } : { available: false, reason: 'not reported by this connector', byModel: [], advice: [], perMission: [] } });
  return out;
}
