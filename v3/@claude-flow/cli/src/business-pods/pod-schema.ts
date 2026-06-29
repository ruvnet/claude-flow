/**
 * Pod template schema validator (ADR-164 §3.3 + ADR-164.1 §3.2).
 *
 * Defines the `PodTemplate` type that every business-pod JSON file under
 * `plugins/ruflo-business-pods/templates/` MUST conform to, and a hand-rolled
 * validator that throws structured errors on invalid templates. No external
 * deps (no AJV, no zod) — the schema is small enough to validate by hand and
 * doing so keeps the cli's optional-dep surface unchanged.
 *
 * @module @claude-flow/cli/business-pods/pod-schema
 */

export type PiiPolicy = 'soc2' | 'gdpr' | 'hipaa' | 'permissive';

export interface PodAgent {
  /** Role label inside the pod, e.g. "lead-gen-agent". */
  role: string;
  /** Must resolve to a known ruflo agent type (researcher / coder / ...). */
  agentType: string;
  /** Human-readable description of what the agent does in this pod. */
  description: string;
  /** Routing hint — true = prefer local stdio execution. */
  preferLocal: boolean;
}

export interface PodBench {
  /** Bench identifier, e.g. "sales-pipeline-bench". */
  name: string;
  /** What the bench measures. */
  description: string;
  /** Acceptance criteria — non-empty list of human-readable bullets. */
  successCriteria: string[];
  /** Cadence between bench evaluations (hours, ≥1). */
  scheduleHours: number;
}

export interface PodAuditReadView {
  /** Event types surfaced to the business-owner read view. */
  includedEventTypes: string[];
  /** Retention window for the read view (days, ≥1). */
  retentionDays: number;
}

export interface PodTemplate {
  /** Canonical pod name (matches BBS roomId). */
  name: string;
  /** Display name for the cockpit. */
  displayName: string;
  /** BBS room this pod serves, e.g. "sales". */
  roomId: string;
  /** Ordered list of pod agent compositions. */
  agents: PodAgent[];
  /** Allow-list of MCP tools the pod's agents may invoke. */
  allowedMcpTools: string[];
  /** Bench definition for periodic Darwin /loop scoring. */
  bench: PodBench;
  /** PII compliance mode applied to every envelope in/out of this room. */
  piiPolicy: PiiPolicy;
  /** Monthly USD hard cap (0 = unlimited; not recommended). */
  budgetUsdMonthly: number;
  /** Estimated USD per pod tick — drives reservation amount. */
  budgetUsdPerRun: number;
  /** If true, @metaharness/router routes to local first. */
  preferLocalExecution: boolean;
  /** POSIX cron expression for the perpetual /loop scheduler. */
  cronSchedule: string;
  /** Compliance audit-log projection. */
  auditReadView: PodAuditReadView;
  /**
   * Reservation expiry for the atomic budget tracker — ADR-164.1 §3.2.
   * Bounded to [5000, 300000] ms (5 s – 5 min). Default 60_000 if omitted.
   */
  reservationExpiryMs?: number;
}

/**
 * Structured validation error — carries the JSON pointer that caused it so
 * callers can render a precise message.
 */
export class PodTemplateValidationError extends Error {
  constructor(message: string, public path: string) {
    super(`pod-template at ${path}: ${message}`);
    this.name = 'PodTemplateValidationError';
  }
}

const PII_POLICIES: PiiPolicy[] = ['soc2', 'gdpr', 'hipaa', 'permissive'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(parent: Record<string, unknown>, key: string, path: string): string {
  const v = parent[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new PodTemplateValidationError(`field "${key}" must be a non-empty string`, path);
  }
  return v;
}

function requireNumber(parent: Record<string, unknown>, key: string, path: string): number {
  const v = parent[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new PodTemplateValidationError(`field "${key}" must be a finite number`, path);
  }
  return v;
}

function requireBoolean(parent: Record<string, unknown>, key: string, path: string): boolean {
  const v = parent[key];
  if (typeof v !== 'boolean') {
    throw new PodTemplateValidationError(`field "${key}" must be a boolean`, path);
  }
  return v;
}

function requireArray<T>(parent: Record<string, unknown>, key: string, path: string,
                          itemValidator: (item: unknown, ipath: string) => T): T[] {
  const v = parent[key];
  if (!Array.isArray(v)) {
    throw new PodTemplateValidationError(`field "${key}" must be an array`, path);
  }
  return v.map((item, idx) => itemValidator(item, `${path}/${key}[${idx}]`));
}

function validatePodAgent(item: unknown, path: string): PodAgent {
  if (!isObject(item)) throw new PodTemplateValidationError('agent must be an object', path);
  return {
    role: requireString(item, 'role', path),
    agentType: requireString(item, 'agentType', path),
    description: requireString(item, 'description', path),
    preferLocal: requireBoolean(item, 'preferLocal', path),
  };
}

function validatePodBench(item: unknown, path: string): PodBench {
  if (!isObject(item)) throw new PodTemplateValidationError('bench must be an object', path);
  const name = requireString(item, 'name', path);
  const description = requireString(item, 'description', path);
  const successCriteria = requireArray(item, 'successCriteria', path, (s, sp) => {
    if (typeof s !== 'string' || s.length === 0) {
      throw new PodTemplateValidationError('successCriteria entries must be non-empty strings', sp);
    }
    return s;
  });
  if (successCriteria.length === 0) {
    throw new PodTemplateValidationError('bench.successCriteria must have ≥1 entry', path);
  }
  const scheduleHours = requireNumber(item, 'scheduleHours', path);
  if (scheduleHours < 1) {
    throw new PodTemplateValidationError('bench.scheduleHours must be ≥1', path);
  }
  return { name, description, successCriteria, scheduleHours };
}

function validateAuditReadView(item: unknown, path: string): PodAuditReadView {
  if (!isObject(item)) {
    throw new PodTemplateValidationError('auditReadView must be an object', path);
  }
  const includedEventTypes = requireArray(item, 'includedEventTypes', path, (s, sp) => {
    if (typeof s !== 'string' || s.length === 0) {
      throw new PodTemplateValidationError('includedEventTypes entries must be non-empty strings', sp);
    }
    return s;
  });
  const retentionDays = requireNumber(item, 'retentionDays', path);
  if (retentionDays < 1) {
    throw new PodTemplateValidationError('auditReadView.retentionDays must be ≥1', path);
  }
  return { includedEventTypes, retentionDays };
}

// POSIX cron — five or six space-separated fields. Permissive on field
// contents (digits, *, -, /, ,) — actual cron evaluation happens at schedule
// time. We only catch obviously malformed values here.
const CRON_RE = /^([\d*/,\-]+\s+){4,5}[\d*/,\-]+$/;

/**
 * Validate `json` and return a typed `PodTemplate`. Throws
 * `PodTemplateValidationError` with a JSON-pointer-style path on failure.
 *
 * Used by:
 *   - `business_pod_validate` MCP tool — returns the error verbatim
 *   - `pod-tick.mjs` — pre-flight check before any pod execution
 *   - any external schema-loader that wants typed templates
 */
export function validatePodTemplate(json: unknown): PodTemplate {
  if (!isObject(json)) {
    throw new PodTemplateValidationError('pod-template must be a JSON object', '/');
  }
  const name = requireString(json, 'name', '/');
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new PodTemplateValidationError('name must be lowercase-kebab (e.g. "sales")', '/');
  }
  const displayName = requireString(json, 'displayName', '/');
  const roomId = requireString(json, 'roomId', '/');
  if (!/^[A-Za-z0-9_.\-:/@#]+$/.test(roomId)) {
    throw new PodTemplateValidationError(
      'roomId may only contain [A-Za-z0-9_.\\-:/@#]',
      '/',
    );
  }
  const agents = requireArray(json, 'agents', '/', validatePodAgent);
  if (agents.length === 0) {
    throw new PodTemplateValidationError('agents must have ≥1 entry', '/');
  }
  const allowedMcpTools = requireArray(json, 'allowedMcpTools', '/', (t, tp) => {
    if (typeof t !== 'string' || t.length === 0) {
      throw new PodTemplateValidationError(
        'allowedMcpTools entries must be non-empty strings',
        tp,
      );
    }
    return t;
  });
  if (allowedMcpTools.length === 0) {
    throw new PodTemplateValidationError('allowedMcpTools must have ≥1 entry', '/');
  }
  const bench = validatePodBench(json.bench, '/bench');
  const piiPolicy = requireString(json, 'piiPolicy', '/');
  if (!PII_POLICIES.includes(piiPolicy as PiiPolicy)) {
    throw new PodTemplateValidationError(
      `piiPolicy must be one of: ${PII_POLICIES.join(', ')}`,
      '/',
    );
  }
  const budgetUsdMonthly = requireNumber(json, 'budgetUsdMonthly', '/');
  if (budgetUsdMonthly < 0) {
    throw new PodTemplateValidationError('budgetUsdMonthly must be ≥0', '/');
  }
  const budgetUsdPerRun = requireNumber(json, 'budgetUsdPerRun', '/');
  if (budgetUsdPerRun < 0) {
    throw new PodTemplateValidationError('budgetUsdPerRun must be ≥0', '/');
  }
  if (budgetUsdMonthly > 0 && budgetUsdPerRun > budgetUsdMonthly) {
    throw new PodTemplateValidationError(
      'budgetUsdPerRun must not exceed budgetUsdMonthly',
      '/',
    );
  }
  const preferLocalExecution = requireBoolean(json, 'preferLocalExecution', '/');
  const cronSchedule = requireString(json, 'cronSchedule', '/');
  if (!CRON_RE.test(cronSchedule)) {
    throw new PodTemplateValidationError(
      'cronSchedule must be a POSIX cron expression (5 or 6 fields)',
      '/',
    );
  }
  const auditReadView = validateAuditReadView(json.auditReadView, '/auditReadView');

  let reservationExpiryMs: number | undefined;
  if (json.reservationExpiryMs !== undefined) {
    const v = requireNumber(json, 'reservationExpiryMs', '/');
    // ADR-164.1 §3.2 — bounded to [5_000, 300_000] ms.
    if (v < 5_000 || v > 300_000) {
      throw new PodTemplateValidationError(
        'reservationExpiryMs must be within [5000, 300000] ms (ADR-164.1 §3.2)',
        '/',
      );
    }
    reservationExpiryMs = v;
  }

  return {
    name,
    displayName,
    roomId,
    agents,
    allowedMcpTools,
    bench,
    piiPolicy: piiPolicy as PiiPolicy,
    budgetUsdMonthly,
    budgetUsdPerRun,
    preferLocalExecution,
    cronSchedule,
    auditReadView,
    reservationExpiryMs,
  };
}

/**
 * Known ruflo agent types — kept in sync with src/commands/agent.ts AGENT_TYPES.
 * The list is duplicated here intentionally so pod-tick.mjs can run without
 * importing the entire commands module.
 *
 * If a new agent type is added to AGENT_TYPES, mirror it here.
 */
export const KNOWN_AGENT_TYPES = [
  'coder',
  'researcher',
  'tester',
  'reviewer',
  'architect',
  'system-architect',
  'coordinator',
  'analyst',
  'optimizer',
  'security-architect',
  'security-auditor',
  'memory-specialist',
  'swarm-specialist',
  'performance-engineer',
  'core-architect',
  'test-architect',
  'planner',
  'task-orchestrator',
  'perf-analyzer',
  'backend-dev',
  'api-docs',
  'cicd-engineer',
  'code-analyzer',
  'database-specialist',
  // ADR-164 Phase 3 — added for the marketing/hr pods (content drafting +
  // onboarding-template generation). Mirror this addition in the JS copy
  // inside plugins/ruflo-business-pods/scripts/pod-tick.mjs.
  'base-template-generator',
] as const;
