#!/usr/bin/env node
/**
 * pod-tick.mjs — One iteration of a business pod (ADR-164 Phase 2).
 *
 * Dry-run by default; --live is reserved for Phase 3 (Managed-Agent + claude-p
 * wiring) and refuses to engage in this Phase 2 build.
 *
 * Lifecycle for one tick:
 *   1. Load pod template, validate against pod-schema (hand-rolled, no AJV dep).
 *   2. Resolve every agent.agentType against ruflo's agent registry (KNOWN_AGENT_TYPES).
 *      Unknown types are fatal with an actionable message.
 *   3. Reserve budget via the Phase-2 file-based stub ledger
 *      (basePath/budget/<roomId>.json). TODO(adr-164.1): swap to the atomic
 *      SQLite tracker once Phase 3 lands.
 *   4. For each agent: construct a dry-run prompt (kickoff text scoped to the
 *      pod's bench description + domain). Log prompts; skip in dry-run mode.
 *   5. Commit the reservation with actual_usd. In dry-run actual_usd = $0.
 *   6. Append a structured envelope summary to the room's JSONL log (Phase 1
 *      backing store; same path the federation_bbs_publish MCP tool writes).
 *   7. Emit a single JSON line to stdout: {podName, tickId, agentsRan,
 *      totalUsd, envelopeId, status} — /loop ingests this verbatim.
 *
 * CLI:
 *   pod-tick.mjs --pod-template <path> [--base-path <dir>] [--dry-run|--live]
 *                [--budget-cap-usd <amount>] [--tick-id <id>]
 *
 * Exit codes:
 *   0 — tick succeeded (status === 'success')
 *   2 — invalid template / unknown agent type / budget exhausted / arg error
 *   3 — --live mode requested (refused in Phase 2)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, '..');

// ---------- arg parsing ----------------------------------------------------

function parseArgs(argv) {
  const args = {
    podTemplate: null,
    basePath: null,
    dryRun: true,
    live: false,
    budgetCapUsd: null,
    tickId: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pod-template') args.podTemplate = argv[++i];
    else if (a === '--base-path') args.basePath = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--live') { args.live = true; args.dryRun = false; }
    else if (a === '--budget-cap-usd') args.budgetCapUsd = Number(argv[++i]);
    else if (a === '--tick-id') args.tickId = argv[++i];
    else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage() {
  process.stdout.write(`pod-tick.mjs — one tick of a business pod (ADR-164 Phase 2)

Usage:
  pod-tick.mjs [--pod-template <path>] [--base-path <dir>] [--dry-run|--live]
               [--budget-cap-usd <amount>] [--tick-id <id>]

Defaults:
  --pod-template   templates/sales.json (relative to plugin root)
  --base-path      <cwd>/.business-pods
  --dry-run        true (--live is refused in Phase 2)
`);
}

// ---------- minimal pod-schema validator (mirrors cli/src/business-pods) ----

// The validator is duplicated in this script because the script must be
// runnable from a checkout without a pre-built CLI. If pod-schema.ts grows,
// this copy is the one to keep tracking — the smoke contract pins it.

const PII_POLICIES = ['soc2', 'gdpr', 'hipaa', 'permissive'];
const KNOWN_AGENT_TYPES = new Set([
  'coder', 'researcher', 'tester', 'reviewer', 'architect', 'system-architect',
  'coordinator', 'analyst', 'optimizer', 'security-architect', 'security-auditor',
  'memory-specialist', 'swarm-specialist', 'performance-engineer', 'core-architect',
  'test-architect', 'planner', 'task-orchestrator', 'perf-analyzer', 'backend-dev',
  'api-docs', 'cicd-engineer', 'code-analyzer', 'database-specialist',
  // ADR-164 Phase 3 — added for the marketing/hr pods (content drafting +
  // onboarding-template generation). Mirror in pod-schema.ts KNOWN_AGENT_TYPES.
  'base-template-generator',
]);
const CRON_RE = /^([\d*/,\-]+\s+){4,5}[\d*/,\-]+$/;

function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function fail(msg, path) {
  const err = new Error(`pod-template at ${path}: ${msg}`);
  err.path = path;
  throw err;
}
function reqStr(o, k, p) { if (typeof o[k] !== 'string' || !o[k]) fail(`field "${k}" must be non-empty string`, p); return o[k]; }
function reqNum(o, k, p) { if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) fail(`field "${k}" must be finite number`, p); return o[k]; }
function reqBool(o, k, p) { if (typeof o[k] !== 'boolean') fail(`field "${k}" must be boolean`, p); return o[k]; }
function reqArr(o, k, p) { if (!Array.isArray(o[k])) fail(`field "${k}" must be array`, p); return o[k]; }

function validatePodTemplate(json) {
  if (!isObject(json)) fail('pod-template must be a JSON object', '/');
  const name = reqStr(json, 'name', '/');
  if (!/^[a-z][a-z0-9-]*$/.test(name)) fail('name must be lowercase-kebab', '/');
  const displayName = reqStr(json, 'displayName', '/');
  const roomId = reqStr(json, 'roomId', '/');
  if (!/^[A-Za-z0-9_.\-:/@#]+$/.test(roomId)) {
    fail('roomId may only contain [A-Za-z0-9_.\\-:/@#]', '/');
  }
  const agents = reqArr(json, 'agents', '/').map((a, i) => {
    const p = `/agents[${i}]`;
    if (!isObject(a)) fail('agent must be object', p);
    return {
      role: reqStr(a, 'role', p),
      agentType: reqStr(a, 'agentType', p),
      description: reqStr(a, 'description', p),
      preferLocal: reqBool(a, 'preferLocal', p),
    };
  });
  if (agents.length === 0) fail('agents must have ≥1 entry', '/');
  const allowedMcpTools = reqArr(json, 'allowedMcpTools', '/').map((t, i) => {
    if (typeof t !== 'string' || !t) fail('allowedMcpTools entries must be non-empty strings', `/allowedMcpTools[${i}]`);
    return t;
  });
  if (allowedMcpTools.length === 0) fail('allowedMcpTools must have ≥1 entry', '/');
  const benchRaw = json.bench;
  if (!isObject(benchRaw)) fail('bench must be object', '/bench');
  const bench = {
    name: reqStr(benchRaw, 'name', '/bench'),
    description: reqStr(benchRaw, 'description', '/bench'),
    successCriteria: reqArr(benchRaw, 'successCriteria', '/bench'),
    scheduleHours: reqNum(benchRaw, 'scheduleHours', '/bench'),
  };
  if (bench.successCriteria.length === 0) fail('bench.successCriteria must have ≥1 entry', '/bench');
  if (bench.scheduleHours < 1) fail('bench.scheduleHours must be ≥1', '/bench');
  const piiPolicy = reqStr(json, 'piiPolicy', '/');
  if (!PII_POLICIES.includes(piiPolicy)) fail(`piiPolicy must be one of ${PII_POLICIES.join(', ')}`, '/');
  const budgetUsdMonthly = reqNum(json, 'budgetUsdMonthly', '/');
  if (budgetUsdMonthly < 0) fail('budgetUsdMonthly must be ≥0', '/');
  const budgetUsdPerRun = reqNum(json, 'budgetUsdPerRun', '/');
  if (budgetUsdPerRun < 0) fail('budgetUsdPerRun must be ≥0', '/');
  if (budgetUsdMonthly > 0 && budgetUsdPerRun > budgetUsdMonthly) {
    fail('budgetUsdPerRun must not exceed budgetUsdMonthly', '/');
  }
  const preferLocalExecution = reqBool(json, 'preferLocalExecution', '/');
  const cronSchedule = reqStr(json, 'cronSchedule', '/');
  if (!CRON_RE.test(cronSchedule)) fail('cronSchedule must be POSIX cron (5 or 6 fields)', '/');
  const auditView = json.auditReadView;
  if (!isObject(auditView)) fail('auditReadView must be object', '/auditReadView');
  const auditReadView = {
    includedEventTypes: reqArr(auditView, 'includedEventTypes', '/auditReadView'),
    retentionDays: reqNum(auditView, 'retentionDays', '/auditReadView'),
  };
  if (auditReadView.retentionDays < 1) fail('auditReadView.retentionDays must be ≥1', '/auditReadView');
  let reservationExpiryMs;
  if (json.reservationExpiryMs !== undefined) {
    const v = reqNum(json, 'reservationExpiryMs', '/');
    if (v < 5_000 || v > 300_000) fail('reservationExpiryMs must be within [5000, 300000] ms (ADR-164.1 §3.2)', '/');
    reservationExpiryMs = v;
  }
  return {
    name, displayName, roomId, agents, allowedMcpTools, bench, piiPolicy,
    budgetUsdMonthly, budgetUsdPerRun, preferLocalExecution, cronSchedule,
    auditReadView, reservationExpiryMs,
  };
}

// ---------- Phase-2 file-based budget ledger stub --------------------------
// TODO(adr-164.1): replace with atomic SQLite tracker in Phase 3. The
// reservation/commit/release semantics here are file-write best-effort and
// NOT crash-safe under concurrent writers. This is acceptable for Phase 2
// dry-run; production live-mode (Phase 3) must use the atomic tracker.

function loadLedger(path) {
  if (!existsSync(path)) {
    return { roomId: '', month: '', reserved: 0, spent: 0, reservations: [] };
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveLedger(path, ledger) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2));
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function resetIfNewMonth(ledger, roomId) {
  const month = currentMonthKey();
  if (ledger.month !== month || ledger.roomId !== roomId) {
    return { roomId, month, reserved: 0, spent: 0, reservations: [] };
  }
  return ledger;
}

function pruneExpired(ledger, nowMs) {
  const live = ledger.reservations.filter((r) => r.expiresAtMs > nowMs);
  const pruned = ledger.reservations.length - live.length;
  if (pruned > 0) {
    let releasedAmount = 0;
    for (const r of ledger.reservations) {
      if (r.expiresAtMs <= nowMs) releasedAmount += r.amountUsd;
    }
    ledger.reserved = Math.max(0, ledger.reserved - releasedAmount);
    ledger.reservations = live;
  }
  return ledger;
}

function reserveBudget(ledger, amount, expiryMs) {
  const now = Date.now();
  ledger = pruneExpired(ledger, now);
  const available = Math.max(0, (ledger.monthlyCap ?? Infinity) - ledger.reserved - ledger.spent);
  if (amount > available) {
    return { ok: false, reason: 'BUDGET_EXHAUSTED', available };
  }
  const id = `res-${randomBytes(6).toString('hex')}`;
  ledger.reservations.push({
    id,
    amountUsd: amount,
    createdAtMs: now,
    expiresAtMs: now + expiryMs,
  });
  ledger.reserved += amount;
  return { ok: true, reservationId: id };
}

function commitReservation(ledger, reservationId, actualUsd) {
  const r = ledger.reservations.find((x) => x.id === reservationId);
  if (!r) return { ok: false, reason: 'RESERVATION_NOT_FOUND' };
  ledger.reservations = ledger.reservations.filter((x) => x.id !== reservationId);
  ledger.reserved = Math.max(0, ledger.reserved - r.amountUsd);
  ledger.spent += actualUsd;
  return { ok: true };
}

// ---------- prompt construction (dry-run logged only) ----------------------

function constructPrompt(podTemplate, agent) {
  // The dry-run kickoff prompt the agent would receive. Keep it scoped to
  // the bench description so live-mode wiring (Phase 3) inherits the same
  // shape.
  const criteria = podTemplate.bench.successCriteria.map((s) => `  - ${s}`).join('\n');
  return [
    `You are the ${agent.role} (${agent.agentType}) for the ${podTemplate.displayName} pod.`,
    ``,
    `Pod bench: ${podTemplate.bench.name}`,
    `Bench description: ${podTemplate.bench.description}`,
    `Success criteria:`,
    criteria,
    ``,
    `Your role: ${agent.description}`,
    ``,
    `Kickoff task: Review the past ${podTemplate.bench.scheduleHours}h of #${podTemplate.roomId} activity.`,
    `Identify the 3 highest-priority items relevant to your role, then post a`,
    `summary envelope (msgType=task-result) to room "${podTemplate.roomId}" via`,
    `federation_bbs_publish. Adhere to PII policy: ${podTemplate.piiPolicy}.`,
  ].join('\n');
}

// ---------- envelope publish (Phase 1 backing store) -----------------------

function roomIdFromLabel(label) {
  const norm = String(label).replace(/^#/, '').toLowerCase();
  const h = createHash('sha256').update(`agentbbs:room:${norm}`).digest('hex').slice(0, 8);
  return `${norm}-${h}`;
}

function roomLogPath(basePath, derivedRoomId) {
  return join(basePath, '.agentbbs', `room-${derivedRoomId}.jsonl`);
}

function nextSeq(path) {
  if (!existsSync(path)) return 1;
  const lines = readFileSync(path, 'utf-8').split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return 1;
  try {
    const last = JSON.parse(lines[lines.length - 1]);
    return (last.seq ?? lines.length) + 1;
  } catch {
    return lines.length + 1;
  }
}

function publishEnvelope(basePath, roomLabel, msgType, payload) {
  const roomId = roomIdFromLabel(roomLabel);
  const path = roomLogPath(basePath, roomId);
  mkdirSync(dirname(path), { recursive: true });
  const envelope = {
    envelopeId: randomBytes(12).toString('hex'),
    roomId,
    seq: nextSeq(path),
    msgType,
    payload,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(path, JSON.stringify(envelope) + '\n');
  return envelope;
}

// ---------- main tick ------------------------------------------------------

async function runTick(args) {
  if (args.live) {
    process.stderr.write(
      'ERROR: --live mode is Phase 3 — requires Managed Agent integration and ' +
      'claude-p wiring; do not flip to live in CI. Exiting.\n',
    );
    process.exit(3);
  }

  const templatePath = args.podTemplate
    ? (isAbsolute(args.podTemplate) ? args.podTemplate : resolve(process.cwd(), args.podTemplate))
    : join(PLUGIN_ROOT, 'templates', 'sales.json');

  if (!existsSync(templatePath)) {
    process.stderr.write(`ERROR: pod template not found: ${templatePath}\n`);
    process.exit(2);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(templatePath, 'utf-8'));
  } catch (e) {
    process.stderr.write(`ERROR: failed to parse template JSON: ${e.message}\n`);
    process.exit(2);
  }

  let template;
  try {
    template = validatePodTemplate(raw);
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n`);
    process.exit(2);
  }

  // Resolve agent types against the registry.
  const unknown = template.agents
    .map((a) => a.agentType)
    .filter((t) => !KNOWN_AGENT_TYPES.has(t));
  if (unknown.length > 0) {
    process.stderr.write(
      `ERROR: unknown agent types in pod template: ${unknown.join(', ')}\n` +
      `Known types: ${[...KNOWN_AGENT_TYPES].sort().join(', ')}\n`,
    );
    process.exit(2);
  }

  // Budget reservation.
  const basePath = args.basePath
    ? (isAbsolute(args.basePath) ? args.basePath : resolve(process.cwd(), args.basePath))
    : resolve(process.cwd(), '.business-pods');
  const ledgerPath = join(basePath, 'budget', `${template.roomId}.json`);
  let ledger = resetIfNewMonth(loadLedger(ledgerPath), template.roomId);
  ledger.monthlyCap = template.budgetUsdMonthly === 0 ? Infinity : template.budgetUsdMonthly;
  const capForTick = args.budgetCapUsd !== null && args.budgetCapUsd >= 0
    ? Math.min(template.budgetUsdPerRun, args.budgetCapUsd)
    : template.budgetUsdPerRun;
  const expiryMs = template.reservationExpiryMs ?? 60_000;

  const reserve = reserveBudget(ledger, capForTick, expiryMs);
  if (!reserve.ok) {
    saveLedger(ledgerPath, ledger);
    const out = {
      podName: template.name,
      tickId: args.tickId ?? `tick-${randomBytes(4).toString('hex')}`,
      agentsRan: 0,
      totalUsd: 0,
      envelopeId: null,
      status: 'failed',
      reason: reserve.reason,
    };
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(2);
  }
  saveLedger(ledgerPath, ledger);

  const tickId = args.tickId ?? `tick-${randomBytes(4).toString('hex')}`;

  // Build prompts (dry-run only logs them).
  const prompts = [];
  for (const agent of template.agents) {
    const prompt = constructPrompt(template, agent);
    prompts.push({ role: agent.role, agentType: agent.agentType, prompt });
    if (args.dryRun) {
      process.stderr.write(
        `\n[dry-run] ${agent.role} (${agent.agentType}):\n` +
        prompt.split('\n').map((l) => `  ${l}`).join('\n') + '\n',
      );
    }
  }

  // Commit. Dry-run actual = $0.
  const actualUsd = args.dryRun ? 0 : capForTick; // live path is gated above
  commitReservation(ledger, reserve.reservationId, actualUsd);
  saveLedger(ledgerPath, ledger);

  // Publish summary envelope to the room (federation_bbs_publish backing store).
  const envelope = publishEnvelope(basePath, template.roomId, 'pod-status', {
    podName: template.name,
    tickId,
    agentsRan: template.agents.length,
    totalUsd: actualUsd,
    dryRun: args.dryRun,
    promptShas: prompts.map((p) => ({
      role: p.role,
      sha: createHash('sha256').update(p.prompt).digest('hex').slice(0, 12),
    })),
  });

  const result = {
    podName: template.name,
    tickId,
    agentsRan: template.agents.length,
    totalUsd: actualUsd,
    envelopeId: envelope.envelopeId,
    status: 'success',
    dryRun: args.dryRun,
  };
  process.stdout.write(JSON.stringify(result) + '\n');
  return result;
}

// ---------- entrypoint -----------------------------------------------------

const args = parseArgs(process.argv.slice(2));

// Allow being imported by tests without auto-running the tick.
const isDirectInvocation = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);
if (isDirectInvocation) {
  runTick(args).catch((err) => {
    process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
    process.exit(2);
  });
}

export {
  parseArgs,
  validatePodTemplate,
  KNOWN_AGENT_TYPES,
  reserveBudget,
  commitReservation,
  pruneExpired,
  loadLedger,
  saveLedger,
  resetIfNewMonth,
  constructPrompt,
  publishEnvelope,
  roomIdFromLabel,
  runTick,
};
