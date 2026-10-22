/**
 * ADR-406 §19.7 — the mission semantic operations, shared by every client.
 *
 * `mission.create`, `mission.plan`, `mission.get`, `mission.events` and
 * `mission.requestAction` parse raw input with the same zod schemas whether
 * the caller is the CLI or an MCP tool. Principal, tenant and workspace are
 * derived from the trusted local context (the OS user owning this process and
 * the canonical project path); nothing in the input can name them, and no
 * input field is treated as proof of permission.
 *
 * Every mutation carries a request id and the expected mission revision. A
 * stale revision is refused with the current one (refreshable conflict). A
 * repeated request id with the same input returns the original outcome; with
 * different input it is refused.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import type { ZodTypeAny, output } from 'zod';
import {
  MISSION_EVENT_CONTRACT,
  createInputSchema,
  eventsInputSchema,
  getInputSchema,
  planInputSchema,
  requestActionInputSchema,
  type ControlEventType,
  type MissionEvent,
  type MissionEventType,
} from './schemas.js';
import { TransitionError, checkTransition, digestOf, validatePlan, type MissionView } from './transitions.js';
import { eventHash, foldEvent, GENESIS_HASH } from './fold.js';
import { MissionStore, MissionStoreError } from './store.js';
import { OBSERVATION_FILE, buildObservation, observeMission } from './observation.js';

export type Channel = 'cli' | 'mcp';

export interface MissionContext {
  readonly projectRoot: string;
  readonly channel: Channel;
  readonly now?: () => Date;
}

export type MissionResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly currentRevision?: number };

export class RevisionConflict extends Error {
  constructor(readonly currentRevision: number, expected: number) {
    super(`revision-conflict: expected ${expected}, current ${currentRevision}; refresh and retry`);
  }
}

class RequestReuse extends Error {
  constructor(requestId: string) { super(`request-id-reuse: ${requestId} was already used with different input`); }
}

interface Identity { readonly principalId: string; readonly tenantId: string; readonly workspaceId: string }

function identityOf(ctx: MissionContext): Identity {
  let root: string;
  try { root = realpathSync(resolve(ctx.projectRoot)); } catch { root = resolve(ctx.projectRoot); }
  return {
    principalId: `local:${userInfo().username}`,
    tenantId: 'local',
    workspaceId: `ws_${createHash('sha256').update(root).digest('hex').slice(0, 16)}`,
  };
}

function parse<S extends ZodTypeAny>(schema: S, raw: unknown): output<S> {
  const r = schema.safeParse(raw);
  if (!r.success) throw new TransitionError('invalid-input', r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return r.data;
}

function fail(error: unknown): MissionResult<never> {
  if (error instanceof RevisionConflict) return { ok: false, code: 'revision-conflict', message: error.message, currentRevision: error.currentRevision };
  if (error instanceof TransitionError || error instanceof MissionStoreError) return { ok: false, code: error.code, message: error.message };
  if (error instanceof RequestReuse) return { ok: false, code: 'request-id-reuse', message: error.message };
  return { ok: false, code: 'internal', message: error instanceof Error ? error.message : String(error) };
}

export class MissionService {
  private readonly store: MissionStore;
  private readonly identity: Identity;

  constructor(private readonly ctx: MissionContext) {
    this.store = new MissionStore(ctx.projectRoot);
    this.identity = identityOf(ctx);
  }

  private now(): string { return (this.ctx.now ?? (() => new Date()))().toISOString(); }

  private event(
    view: MissionView | null, missionId: string, type: MissionEventType, payload: Record<string, unknown>,
    request: { requestId: string; digest: string; expectedRevision: number | null } | null, control: boolean,
  ): MissionEvent {
    const draft = {
      contract: MISSION_EVENT_CONTRACT,
      seq: view ? view.record.lastEventSequence + 1 : 1,
      missionId,
      type,
      expectedRevision: request?.expectedRevision ?? null,
      revision: view ? view.record.revision + (control ? 1 : 0) : 1,
      principalId: this.identity.principalId,
      channel: this.ctx.channel,
      requestId: request?.requestId ?? null,
      requestDigest: request?.digest ?? null,
      policyDecisionRef: null,
      at: this.now(),
      payload,
      prevHash: view ? view.lastHash : GENESIS_HASH,
    } as const;
    return { ...draft, hash: eventHash(draft) };
  }

  /** Same principal + request id earlier in this mission's log: same input replays, other input is refused. */
  private prior(events: readonly MissionEvent[], requestId: string, digest: string): MissionEvent | null {
    const hit = events.find((e) => e.requestId === requestId && e.principalId === this.identity.principalId);
    if (!hit) return null;
    if (hit.requestDigest !== digest) throw new RequestReuse(requestId);
    return hit;
  }

  private async publishObservation(): Promise<void> {
    await this.store.withWorkspaceLock(() => {
      const views = this.store.listMissionIds().map((id) => this.store.loadView(id)).filter((v): v is MissionView => v !== null);
      this.store.writeWorkspaceFile(OBSERVATION_FILE, `${JSON.stringify(buildObservation(this.identity.workspaceId, views), null, 2)}\n`);
    });
  }

  async create(raw: unknown): Promise<MissionResult<{ missionId: string; revision: number; state: string; deduplicated: boolean }>> {
    try {
      const input = parse(createInputSchema, raw);
      const digest = digestOf({ op: 'mission.create', input });
      const scope = [this.identity.tenantId, this.identity.principalId, this.identity.workspaceId, 'mission.create', input.requestId].join('\u0000');
      const missionId = `msn_${createHash('sha256').update(scope).digest('hex').slice(0, 24)}`;
      this.store.claim(missionId); // atomic; a concurrent duplicate falls through to the dedup check below
      const result = await this.store.withMission(missionId, (view, log) => {
        if (view) {
          this.prior(log.events, input.requestId, digest);
          return { events: [], view, result: { missionId, revision: view.record.revision, state: view.record.state, deduplicated: true } };
        }
        const event = this.event(null, missionId, 'mission.created', {
          objective: input.objective,
          tenantId: this.identity.tenantId,
          workspaceId: this.identity.workspaceId,
          ownerPrincipalId: this.identity.principalId,
          policyRef: 'policy:.claude-flow/policy/state.json',
          budgetRef: `budget:${missionId}`,
        }, { requestId: input.requestId, digest, expectedRevision: null }, true);
        const next = foldEvent(null, event);
        return { events: [event], view: next, result: { missionId, revision: next.record.revision, state: next.record.state, deduplicated: false } };
      });
      if (!result.deduplicated) await this.publishObservation();
      return { ok: true, data: result };
    } catch (error) {
      return fail(error);
    }
  }

  /** Run a control transition with request dedup and an expected-revision check. */
  private async control(
    missionId: string, requestId: string, expectedRevision: number, digest: string,
    decide: (view: MissionView) => { type: ControlEventType; payload: Record<string, unknown>; then?: (next: MissionView) => { type: ControlEventType; payload: Record<string, unknown> } | null },
  ): Promise<MissionResult<{ missionId: string; revision: number; state: string; deduplicated: boolean; sequence: number }>> {
    try {
      if (!this.store.exists(missionId)) throw new MissionStoreError('not-found', missionId);
      const result = await this.store.withMission(missionId, (view, log) => {
        if (!view) throw new MissionStoreError('not-found', missionId);
        const prior = this.prior(log.events, requestId, digest);
        if (prior) {
          return { events: [], view, result: { missionId, revision: prior.revision, state: view.record.state, deduplicated: true, sequence: prior.seq } };
        }
        if (expectedRevision !== view.record.revision) throw new RevisionConflict(view.record.revision, expectedRevision);
        const { type, payload, then } = decide(view);
        checkTransition(view, type, payload);
        const event = this.event(view, missionId, type, payload, { requestId, digest, expectedRevision }, true);
        let next = foldEvent(view, event);
        const events = [event];
        const follow = then?.(next);
        if (follow) {
          // A consequence decided by the runtime in the same transaction, not a client request.
          const second = this.event(next, missionId, follow.type, follow.payload, { requestId: `${requestId}#settle`, digest, expectedRevision: next.record.revision }, true);
          next = foldEvent(next, second);
          events.push(second);
        }
        const lastSeq = events[events.length - 1].seq;
        return { events, view: next, result: { missionId, revision: next.record.revision, state: next.record.state, deduplicated: false, sequence: lastSeq } };
      });
      if (!result.deduplicated) await this.publishObservation();
      return { ok: true, data: result };
    } catch (error) {
      return fail(error);
    }
  }

  async plan(raw: unknown): Promise<MissionResult<{ missionId: string; revision: number; state: string; deduplicated: boolean; sequence: number; planDigest?: string }>> {
    let input;
    try { input = parse(planInputSchema, raw); } catch (error) { return fail(error); }
    const checked = validatePlan(input.plan);
    if (checked.error !== null) return { ok: false, code: 'invalid-plan', message: checked.error };
    const planDigest = digestOf(checked.plan);
    const result = await this.control(input.missionId, input.requestId, input.expectedRevision,
      digestOf({ op: 'mission.plan', missionId: input.missionId, plan: checked.plan }),
      (view) => ({ type: view.record.state === 'draft' ? 'plan.validated' : 'plan.revised', payload: { plan: checked.plan, digest: planDigest } }));
    return result.ok ? { ok: true, data: { ...result.data, planDigest } } : result;
  }

  /**
   * Scoped control requests. Admission and resume need an admitted executor
   * and a policy-authorized budget reservation (M2); until one exists they are
   * refused with an explicit reason rather than recorded as if work started.
   */
  async requestAction(raw: unknown): Promise<MissionResult<{ missionId: string; revision: number; state: string; deduplicated: boolean; sequence: number }>> {
    let input;
    try { input = parse(requestActionInputSchema, raw); } catch (error) { return fail(error); }
    if (input.action === 'admit' || input.action === 'resume') {
      return {
        ok: false,
        code: 'executor-unavailable',
        message: 'no durable executor independent of the Claude process is admitted yet; admission and resume are not available (ADR-406 M2)',
      };
    }
    const digest = digestOf({ op: 'mission.requestAction', input });
    return this.control(input.missionId, input.requestId, input.expectedRevision, digest, (view) => {
      if (input.action === 'requestAuthorization') return { type: 'authorization.missing', payload: { reason: input.reason ?? 'authorization requested for review' } };
      if (input.action === 'pause') return { type: 'pause.accepted', payload: { reason: input.reason ?? null } };
      // Nothing was ever admitted to an executor, so no executor holds work to
      // acknowledge: settlement is immediate. Otherwise the mission stays
      // cancelRequested until the executor confirms (§9, §19.4).
      const neverAdmitted = view.lease.epoch === 0 && view.lease.executorId === null;
      return {
        type: 'cancel.admitted',
        payload: { reason: input.reason ?? null },
        then: neverAdmitted ? () => ({ type: 'cancel.settled', payload: { acknowledgedExecutors: [], settledBy: 'no-executor-admitted' } }) : undefined,
      };
    });
  }

  async get(raw: unknown = {}): Promise<MissionResult<unknown>> {
    try {
      const input = parse(getInputSchema, raw ?? {});
      if (input.missionId) {
        const view = this.store.exists(input.missionId) ? this.store.loadView(input.missionId) : null;
        if (!view) throw new MissionStoreError('not-found', input.missionId);
        return { ok: true, data: { record: view.record, plan: view.planBody, budget: view.budget, tasks: view.tasks, evidence: view.evidence, executor: view.executor, unresolvedOperations: view.unresolvedOperations, blockedReason: view.blockedReason } };
      }
      const missions = this.store.listMissionIds().map((id) => this.store.loadView(id)).filter((v): v is MissionView => v !== null).map(observeMission);
      return { ok: true, data: { workspaceId: this.identity.workspaceId, missions } };
    } catch (error) {
      return fail(error);
    }
  }

  /**
   * Events after a cursor. Delivery may repeat; clients deduplicate by
   * (missionId, seq). `retainedFromSequence` is the oldest event kept; a cursor
   * older than that gets `gap: true` and must reload a snapshot first.
   */
  async events(raw: unknown): Promise<MissionResult<{ events: MissionEvent[]; nextCursor: number; lastEventSequence: number; retainedFromSequence: number; gap: boolean }>> {
    try {
      const input = parse(eventsInputSchema, raw);
      if (!this.store.exists(input.missionId)) throw new MissionStoreError('not-found', input.missionId);
      const log = this.store.readLog(input.missionId);
      // Validate the whole chain before serving any of it.
      let view: MissionView | null = null;
      for (const e of log.events) view = foldEvent(view, e);
      const retainedFromSequence = 1;
      const page = log.events.filter((e) => e.seq > input.afterSequence).slice(0, input.limit);
      const last = log.events.length ? log.events[log.events.length - 1].seq : 0;
      return {
        ok: true,
        data: {
          events: page,
          nextCursor: page.length ? page[page.length - 1].seq : Math.min(input.afterSequence, last),
          lastEventSequence: last,
          retainedFromSequence,
          gap: input.afterSequence + 1 < retainedFromSequence,
        },
      };
    } catch (error) {
      return fail(error);
    }
  }
}
