/**
 * ADR-406 §19.3 — fold a mission's append-only event log into a `MissionView`.
 *
 * Replay re-checks every control event against the transition table and every
 * observation against its own rules, and verifies the hash chain, so state is
 * a pure function of the log: snapshot + tail and full replay must agree.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '../mods/command-registry/catalog.js';
import {
  CONTROL_EVENTS,
  MISSION_EVENT_CONTRACT,
  MISSION_SCHEMA_VERSION,
  executorConnectionSchema,
  missionRecordSchema,
  type ControlEventType,
  type MissionEvent,
  type ObservationEventType,
  type PlanBody,
} from './schemas.js';
import { TransitionError, checkTransition, digestOf, type MissionView, type TaskStatus } from './transitions.js';
import { TERMINAL_STATES } from './schemas.js';

export const GENESIS_HASH = `sha256:${'0'.repeat(64)}`;
const TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(['pending', 'running', 'recorded-done', 'failed', 'unknown']);

export function isControlEvent(type: string): type is ControlEventType {
  return (CONTROL_EVENTS as readonly string[]).includes(type);
}

/** Hash over every field except `hash` itself, chained through `prevHash`. */
export function eventHash(event: Omit<MissionEvent, 'hash'>): string {
  return `sha256:${createHash('sha256').update(canonicalJson(event)).digest('hex')}`;
}

/** Observation rules; throws `TransitionError`. Observations never change state. */
export function checkObservation(view: MissionView, type: ObservationEventType, p: Record<string, unknown>): void {
  if (TERMINAL_STATES.has(view.record.state)) throw new TransitionError('terminal', `mission is ${view.record.state}`);
  if (type === 'executor.observed') {
    if (typeof p.executorId !== 'string' || !p.executorId) throw new TransitionError('invalid-observation', 'executorId required');
    if (!executorConnectionSchema.safeParse(p.connection).success) throw new TransitionError('invalid-observation', 'connection must be healthy|stale|disconnected|unknown');
    if (typeof p.observedAt !== 'string') throw new TransitionError('invalid-observation', 'observedAt (source time) required');
    return;
  }
  if (type === 'task.observed') {
    if (!view.planBody?.tasks.some((t) => t.id === p.taskId)) throw new TransitionError('invalid-observation', `unknown task ${String(p.taskId)}`);
    if (!TASK_STATUSES.has(p.status as TaskStatus)) throw new TransitionError('invalid-observation', 'invalid task status');
    if (p.leaseEpoch !== view.lease.epoch) throw new TransitionError('stale-epoch', `lease epoch ${String(p.leaseEpoch)} is not current (${view.lease.epoch})`);
    return;
  }
  // evidence.recorded
  if (!view.planBody?.acceptance.some((c) => c.id === p.criterionId)) throw new TransitionError('invalid-observation', `unknown criterion ${String(p.criterionId)}`);
  if (typeof p.evidenceId !== 'string' || typeof p.producer !== 'string') throw new TransitionError('invalid-observation', 'evidenceId and producer required');
  if (typeof p.artifactDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(p.artifactDigest)) throw new TransitionError('invalid-observation', 'artifactDigest required');
  if (typeof p.verified !== 'boolean') throw new TransitionError('invalid-observation', 'verified flag required');
  if (view.evidence.some((e) => e.evidenceId === p.evidenceId)) throw new TransitionError('invalid-observation', `duplicate evidence ${String(p.evidenceId)}`);
}

function created(event: MissionEvent): MissionView {
  const p = event.payload;
  const record = missionRecordSchema.parse({
    schemaVersion: MISSION_SCHEMA_VERSION,
    missionId: event.missionId,
    tenantId: p.tenantId,
    workspaceId: p.workspaceId,
    ownerPrincipalId: p.ownerPrincipalId,
    revision: 1,
    objective: p.objective,
    plan: { revision: 0, digest: 'none', taskGraphRef: 'none' },
    policyRef: p.policyRef,
    budgetRef: p.budgetRef,
    executionMode: 'session-bound',
    state: 'draft',
    evidenceRefs: [],
    acceptance: { revision: 0, criteriaDigest: 'none' },
    lastEventSequence: event.seq,
    createdAt: event.at,
    updatedAt: event.at,
  });
  return {
    record, planBody: null, budget: null, tasks: {}, evidence: [], executor: null,
    lease: { executorId: null, epoch: 0 }, unresolvedOperations: [], blockedReason: null, lastHash: event.hash,
  };
}

function withPlan(view: MissionView, plan: PlanBody, event: MissionEvent): MissionView {
  const criteriaDigest = digestOf(plan.acceptance);
  const prior = view.record.acceptance;
  const estimated = plan.tasks.reduce((s, t) => s + t.estimatedCostMinor, 0);
  const tasks: Record<string, { status: TaskStatus }> = {};
  for (const t of plan.tasks) tasks[t.id] = { status: view.tasks[t.id]?.status ?? 'pending' };
  return {
    ...view,
    planBody: plan,
    tasks,
    budget: {
      currency: plan.budget.currency,
      ceilingMinor: plan.budget.ceilingMinor,
      estimatedMinor: estimated,
      reservedMinor: view.budget?.reservedMinor ?? 0,
      settledMinor: view.budget?.settledMinor ?? 0,
      unresolvedMinor: view.budget?.unresolvedMinor ?? 0,
    },
    record: {
      ...view.record,
      plan: { revision: view.record.plan.revision + 1, digest: String(event.payload.digest), taskGraphRef: `event:${event.seq}` },
      acceptance: { revision: criteriaDigest === prior.criteriaDigest ? prior.revision : prior.revision + 1, criteriaDigest },
      executionMode: plan.tasks.some((t) => t.executor.mode === 'session-bound') ? 'session-bound' : 'durable-executor',
      // §19.4: a new plan revision invalidates authorization for the old one.
      authorizationRef: undefined,
    },
  };
}

function applyControl(view: MissionView, event: MissionEvent & { type: ControlEventType }): MissionView {
  const rule = checkTransition(view, event.type, event.payload);
  if (event.revision !== view.record.revision + 1) {
    throw new TransitionError('revision-mismatch', `control event ${event.seq} must advance revision to ${view.record.revision + 1}`);
  }
  if (event.expectedRevision !== view.record.revision) {
    throw new TransitionError('revision-conflict', `expected ${String(event.expectedRevision)}, current ${view.record.revision}`);
  }
  let next: MissionView = view;
  const p = event.payload;
  switch (event.type) {
    case 'plan.validated':
    case 'plan.revised':
      next = withPlan(view, p.plan as PlanBody, event);
      break;
    case 'admission.accepted':
    case 'resume.admitted':
      next = {
        ...view,
        budget: view.budget && { ...view.budget, reservedMinor: view.budget.reservedMinor + Number(p.reservationMinor) },
        // A new admission fences every executor holding an older epoch.
        lease: { executorId: null, epoch: view.lease.epoch + 1 },
        blockedReason: null,
        record: { ...view.record, authorizationRef: String(p.authorizationRef) },
      };
      break;
    case 'executor.acknowledged':
      next = { ...view, lease: { executorId: String(p.executorId), epoch: view.lease.epoch } };
      break;
    case 'blocked':
      next = { ...view, blockedReason: String(p.reason) };
      break;
    default:
      break;
  }
  const record = { ...next.record };
  if (record.authorizationRef === undefined) delete (record as { authorizationRef?: string }).authorizationRef;
  return {
    ...next,
    record: { ...record, state: rule.to, revision: view.record.revision + 1, lastEventSequence: event.seq, updatedAt: event.at },
    lastHash: event.hash,
  };
}

function applyObservation(view: MissionView, event: MissionEvent): MissionView {
  checkObservation(view, event.type as ObservationEventType, event.payload);
  const p = event.payload;
  let next: MissionView = view;
  if (event.type === 'executor.observed') {
    next = {
      ...view,
      executor: {
        executorId: String(p.executorId),
        connection: String(p.connection),
        observedAt: String(p.observedAt),
        lastAckExecutionId: typeof p.lastAckExecutionId === 'string' ? p.lastAckExecutionId : view.executor?.lastAckExecutionId ?? null,
      },
    };
  } else if (event.type === 'task.observed') {
    const id = String(p.taskId);
    const status = p.status as TaskStatus;
    const op = `task:${id}`;
    const unresolved = view.unresolvedOperations.filter((o) => o !== op);
    next = {
      ...view,
      tasks: { ...view.tasks, [id]: { status, ...(typeof p.invocationId === 'string' ? { invocationId: p.invocationId } : {}) } },
      // An unknown outcome stays unresolved until a later observation settles it.
      unresolvedOperations: status === 'unknown' ? [...unresolved, op] : unresolved,
    };
  } else {
    next = {
      ...view,
      evidence: [...view.evidence, {
        evidenceId: String(p.evidenceId),
        criterionId: String(p.criterionId),
        taskId: typeof p.taskId === 'string' ? p.taskId : null,
        artifactDigest: String(p.artifactDigest),
        producer: String(p.producer),
        verified: p.verified === true,
        planRevision: view.record.plan.revision,
        criteriaDigest: view.record.acceptance.criteriaDigest,
        at: event.at,
      }],
      record: { ...view.record, evidenceRefs: [...view.record.evidenceRefs, String(p.evidenceId)] },
    };
  }
  return {
    ...next,
    record: { ...next.record, lastEventSequence: event.seq, updatedAt: event.at },
    lastHash: event.hash,
  };
}

/** Apply one event; throws `TransitionError` for anything the rules refuse. */
export function foldEvent(view: MissionView | null, event: MissionEvent): MissionView {
  if (event.contract !== MISSION_EVENT_CONTRACT) throw new TransitionError('bad-contract', `unknown event contract ${String(event.contract)}`);
  const expectedPrev = view ? view.lastHash : GENESIS_HASH;
  if (event.prevHash !== expectedPrev) throw new TransitionError('chain-broken', `event ${event.seq} prevHash mismatch`);
  const { hash, ...rest } = event;
  if (eventHash(rest) !== hash) throw new TransitionError('chain-broken', `event ${event.seq} hash mismatch`);
  const expectedSeq = view ? view.record.lastEventSequence + 1 : 1;
  if (event.seq !== expectedSeq) throw new TransitionError('sequence-gap', `event ${event.seq}, expected ${expectedSeq}`);
  if (!view) {
    if (event.type !== 'mission.created') throw new TransitionError('invalid-transition', 'first event must be mission.created');
    return created(event);
  }
  if (event.type === 'mission.created') throw new TransitionError('invalid-transition', 'mission already created');
  if (isControlEvent(event.type)) return applyControl(view, event as MissionEvent & { type: ControlEventType });
  if (event.expectedRevision !== null || event.revision !== view.record.revision) {
    throw new TransitionError('invalid-observation', 'observations carry no expected revision and do not change it');
  }
  return applyObservation(view, event);
}

export function replay(events: readonly MissionEvent[], from: MissionView | null = null): MissionView | null {
  let view = from;
  for (const e of events) view = foldEvent(view, e);
  return view;
}
