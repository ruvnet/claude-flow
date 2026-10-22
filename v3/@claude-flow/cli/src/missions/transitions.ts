/**
 * ADR-406 §19.4 — mission state transitions as a data table, and the reducer
 * that folds an event log into a `MissionView`.
 *
 * The table is the single authority: `checkTransition` (before an append) and
 * `applyEvent` (during replay) both consult it, so a log that replays is a log
 * whose every control event was a permitted transition. Observations never
 * change state or revision; a disconnected executor is an observation, not a
 * failure.
 */

import { createHash } from 'node:crypto';
import {
  TERMINAL_STATES,
  planBodySchema,
  type ControlEventType,
  type MissionRecord,
  type MissionState,
  type PlanBody,
} from './schemas.js';
import { canonicalJson } from '../mods/command-registry/catalog.js';

export type TaskStatus = 'pending' | 'running' | 'recorded-done' | 'failed' | 'unknown';

export interface EvidenceEntry {
  readonly evidenceId: string;
  readonly criterionId: string;
  readonly taskId: string | null;
  readonly artifactDigest: string;
  readonly producer: string;
  /** True only when the service authenticated the producer; never caller-asserted. */
  readonly verified: boolean;
  readonly planRevision: number;
  readonly criteriaDigest: string;
  readonly at: string;
}

export interface BudgetLedger {
  readonly currency: string;
  readonly ceilingMinor: number;
  readonly estimatedMinor: number;
  readonly reservedMinor: number;
  readonly settledMinor: number;
  readonly unresolvedMinor: number;
}

export interface MissionView {
  readonly record: MissionRecord;
  readonly planBody: PlanBody | null;
  readonly budget: BudgetLedger | null;
  readonly tasks: Readonly<Record<string, { readonly status: TaskStatus; readonly invocationId?: string }>>;
  readonly evidence: readonly EvidenceEntry[];
  readonly executor: { readonly executorId: string; readonly connection: string; readonly observedAt: string; readonly lastAckExecutionId: string | null } | null;
  readonly lease: { readonly executorId: string | null; readonly epoch: number };
  readonly unresolvedOperations: readonly string[];
  readonly blockedReason: string | null;
  readonly lastHash: string;
}

export class TransitionError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'TransitionError';
  }
}

const ACTIVE: readonly MissionState[] = ['queued', 'running', 'pauseRequested', 'paused', 'blocked', 'verifying'];
const NONTERMINAL: readonly MissionState[] = [
  'draft', 'planned', 'awaitingAuthorization', 'queued', 'running', 'pauseRequested', 'paused', 'blocked', 'verifying',
];
// Loss of contact is never proof of failure (§19.3, §19.4 last row).
const CONNECTIVITY_CAUSES = new Set(['disconnected', 'timeout', 'connection-lost', 'unreachable', 'unknown', 'stale']);

type Guard = (view: MissionView, payload: Record<string, unknown>) => string | null;

export interface TransitionRule {
  readonly event: ControlEventType;
  readonly from: readonly MissionState[];
  readonly to: MissionState;
  readonly guard: Guard;
}

export function digestOf(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

/** Well-formedness for §19.4 row 1: graph acyclic, deps resolvable, budget fits. */
export function validatePlan(raw: unknown): { plan: PlanBody; error: null } | { plan: null; error: string } {
  const parsed = planBodySchema.safeParse(raw);
  if (!parsed.success) return { plan: null, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const plan = parsed.data;
  const ids = new Set<string>();
  for (const t of plan.tasks) {
    if (ids.has(t.id)) return { plan: null, error: `duplicate task id ${t.id}` };
    ids.add(t.id);
  }
  const criteria = new Set(plan.acceptance.map((c) => c.id));
  if (criteria.size !== plan.acceptance.length) return { plan: null, error: 'duplicate acceptance criterion id' };
  if (!plan.acceptance.some((c) => c.mandatory)) return { plan: null, error: 'at least one mandatory acceptance criterion is required' };
  for (const t of plan.tasks) {
    for (const d of t.dependsOn) if (!ids.has(d)) return { plan: null, error: `task ${t.id} depends on unknown task ${d}` };
    for (const c of t.acceptanceEvidence) if (!criteria.has(c)) return { plan: null, error: `task ${t.id} names unknown criterion ${c}` };
  }
  // Kahn's algorithm: every task must be reachable from a dependency-free task.
  const indegree = new Map(plan.tasks.map((t) => [t.id, t.dependsOn.length]));
  const queue = plan.tasks.filter((t) => t.dependsOn.length === 0).map((t) => t.id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const t of plan.tasks) {
      if (!t.dependsOn.includes(id)) continue;
      const left = (indegree.get(t.id) ?? 0) - 1;
      indegree.set(t.id, left);
      if (left === 0) queue.push(t.id);
    }
  }
  if (visited !== plan.tasks.length) return { plan: null, error: 'task graph has a cycle' };
  const estimated = plan.tasks.reduce((sum, t) => sum + t.estimatedCostMinor, 0);
  if (estimated > plan.budget.ceilingMinor) return { plan: null, error: `estimated cost ${estimated} exceeds ceiling ${plan.budget.ceilingMinor}` };
  return { plan, error: null };
}

const planGuard = (mustDiffer: boolean): Guard => (view, payload) => {
  const result = validatePlan(payload.plan);
  if (result.error !== null) return `plan invalid: ${result.error}`;
  if (payload.digest !== digestOf(result.plan)) return 'plan digest does not match plan body';
  if (mustDiffer && payload.digest === view.record.plan.digest) return 'plan unchanged';
  return null;
};

const admissionGuard: Guard = (view, payload) => {
  if (!view.planBody || !view.budget) return 'no plan to admit';
  if (payload.planDigest !== view.record.plan.digest) return 'authorization does not cover the current plan revision';
  if (typeof payload.authorizationRef !== 'string' || !payload.authorizationRef) return 'authorizationRef required';
  const reservation = payload.reservationMinor;
  if (typeof reservation !== 'number' || !Number.isInteger(reservation) || reservation < 0) return 'reservationMinor must be a non-negative integer';
  const b = view.budget;
  if (b.settledMinor + b.reservedMinor + b.unresolvedMinor + reservation > b.ceilingMinor) return 'budget reservation exceeds the authorized ceiling';
  return null;
};

const epochGuard: Guard = (view, payload) =>
  payload.leaseEpoch === view.lease.epoch ? null : `stale lease epoch ${String(payload.leaseEpoch)} (current ${view.lease.epoch})`;

export const TRANSITIONS: readonly TransitionRule[] = Object.freeze([
  { event: 'plan.validated', from: ['draft'], to: 'planned', guard: planGuard(false) },
  { event: 'plan.revised', from: ['planned', 'awaitingAuthorization', 'paused', 'blocked'], to: 'planned', guard: planGuard(true) },
  { event: 'authorization.missing', from: ['planned'], to: 'awaitingAuthorization', guard: (v) => (v.planBody ? null : 'no concrete plan') },
  { event: 'admission.accepted', from: ['planned', 'awaitingAuthorization'], to: 'queued', guard: admissionGuard },
  {
    event: 'executor.acknowledged', from: ['queued'], to: 'running',
    guard: (v, p) => (typeof p.executorId !== 'string' || !p.executorId ? 'executorId required' : epochGuard(v, p)),
  },
  { event: 'pause.accepted', from: ['running'], to: 'pauseRequested', guard: () => null },
  { event: 'quiescence.confirmed', from: ['pauseRequested'], to: 'paused', guard: epochGuard },
  { event: 'blocked', from: ['running', 'queued'], to: 'blocked', guard: (_v, p) => (typeof p.reason === 'string' && p.reason ? null : 'reason required') },
  { event: 'resume.admitted', from: ['paused', 'blocked'], to: 'queued', guard: admissionGuard },
  {
    event: 'tasks.settled', from: ['running'], to: 'verifying',
    guard: (v) => {
      if (v.unresolvedOperations.length) return `unresolved operations: ${v.unresolvedOperations.join(', ')}`;
      const open = Object.entries(v.tasks).filter(([, t]) => t.status !== 'recorded-done' && t.status !== 'failed');
      return open.length ? `tasks not settled: ${open.map(([id]) => id).join(', ')}` : null;
    },
  },
  {
    event: 'acceptance.passed', from: ['verifying'], to: 'completed',
    guard: (v, p) => {
      const artifact = p.artifactDigest;
      if (typeof artifact !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(artifact)) return 'artifactDigest required';
      for (const c of (v.planBody?.acceptance ?? []).filter((x) => x.mandatory)) {
        const ok = v.evidence.some((e) => e.criterionId === c.id && e.verified
          && e.planRevision === v.record.plan.revision
          && e.criteriaDigest === v.record.acceptance.criteriaDigest
          && e.artifactDigest === artifact);
        if (!ok) return `criterion ${c.id} lacks verified evidence for this plan, criteria and artifact`;
      }
      return null;
    },
  },
  { event: 'acceptance.failed', from: ['verifying'], to: 'failed', guard: (_v, p) => (typeof p.reason === 'string' && p.reason ? null : 'reason required') },
  { event: 'cancel.admitted', from: NONTERMINAL, to: 'cancelRequested', guard: () => null },
  {
    event: 'cancel.settled', from: ['cancelRequested'], to: 'cancelled',
    guard: (v, p) => {
      const acked = Array.isArray(p.acknowledgedExecutors) ? p.acknowledgedExecutors : [];
      return v.lease.executorId && !acked.includes(v.lease.executorId) ? `executor ${v.lease.executorId} has not acknowledged settlement` : null;
    },
  },
  {
    event: 'failure.verified', from: ACTIVE, to: 'failed',
    guard: (_v, p) => {
      if (typeof p.cause !== 'string' || CONNECTIVITY_CAUSES.has(p.cause)) return 'lost connectivity is not verified failure';
      return typeof p.evidenceRef === 'string' && p.evidenceRef ? null : 'evidenceRef required';
    },
  },
]);

export function ruleFor(event: ControlEventType, from: MissionState): TransitionRule | undefined {
  return TRANSITIONS.find((r) => r.event === event && r.from.includes(from));
}

/** Throws `TransitionError` unless `type` is permitted from the view's state. */
export function checkTransition(view: MissionView, type: ControlEventType, payload: Record<string, unknown>): TransitionRule {
  const from = view.record.state;
  if (TERMINAL_STATES.has(from)) throw new TransitionError('terminal', `mission is ${from}; its history is immutable`);
  const rule = ruleFor(type, from);
  if (!rule) throw new TransitionError('invalid-transition', `${type} is not permitted from ${from}`);
  const reason = rule.guard(view, payload);
  if (reason) throw new TransitionError('guard-failed', `${type} from ${from}: ${reason}`);
  return rule;
}

