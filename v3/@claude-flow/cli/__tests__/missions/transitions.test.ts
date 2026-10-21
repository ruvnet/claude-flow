/**
 * ADR-406 M0 — §19.4 transition table, guards, and property tests over
 * random event sequences (seeded PRNG; fast-check is not a dependency).
 */
import { describe, it, expect } from 'vitest';
import {
  CONTROL_EVENTS,
  TERMINAL_STATES,
  TRANSITIONS,
  TransitionError,
  digestOf,
  foldEvent,
  isControlEvent,
  replay,
  type MissionEventType,
  type MissionView,
} from '../../src/missions/index.js';
import { LogBuilder, artifact, plan } from './helpers.js';

const verifiedEvidence = (b: LogBuilder, id: string, art: string, verified = true) =>
  b.push('evidence.recorded', { evidenceId: id, criterionId: 'quality', producer: 'metaharness', artifactDigest: art, verified });

const settleAll = (b: LogBuilder) => {
  for (const id of ['produce', 'evaluate', 'verify']) b.push('task.observed', { taskId: id, status: 'recorded-done', leaseEpoch: b.view!.lease.epoch });
  return b;
};

describe('§19.4 table', () => {
  it('encodes exactly the ADR rows', () => {
    const rows = TRANSITIONS.map((r) => `${[...r.from].sort().join('|')} --${r.event}--> ${r.to}`).sort();
    const active = ['blocked', 'paused', 'pauseRequested', 'queued', 'running', 'verifying'].sort().join('|');
    const nonterminal = ['awaitingAuthorization', 'blocked', 'draft', 'pauseRequested', 'paused', 'planned', 'queued', 'running', 'verifying'].sort().join('|');
    expect(rows).toEqual([
      `${active} --failure.verified--> failed`,
      `${nonterminal} --cancel.admitted--> cancelRequested`,
      'awaitingAuthorization|blocked|paused|planned --plan.revised--> planned',
      'awaitingAuthorization|planned --admission.accepted--> queued',
      'blocked|paused --resume.admitted--> queued',
      'cancelRequested --cancel.settled--> cancelled',
      'draft --plan.validated--> planned',
      'pauseRequested --quiescence.confirmed--> paused',
      'planned --authorization.missing--> awaitingAuthorization',
      'queued --executor.acknowledged--> running',
      'queued|running --blocked--> blocked',
      'running --pause.accepted--> pauseRequested',
      'running --tasks.settled--> verifying',
      'verifying --acceptance.failed--> failed',
      'verifying --acceptance.passed--> completed',
    ].sort());
  });
});

describe('guards', () => {
  it('walks draft → completed only with verified evidence bound to plan, criteria and artifact', () => {
    const art = artifact('report-v1');
    const b = new LogBuilder().create().planned().push('authorization.missing', { reason: 'review' }).admitted().running();
    settleAll(b).push('tasks.settled');
    expect(() => b.push('acceptance.passed', { artifactDigest: art })).toThrow(/lacks verified evidence/);
    verifiedEvidence(b, 'ev-unverified', art, false);
    expect(() => b.push('acceptance.passed', { artifactDigest: art })).toThrow(/lacks verified evidence/);
    verifiedEvidence(b, 'ev-wrong-artifact', artifact('other'));
    expect(() => b.push('acceptance.passed', { artifactDigest: art })).toThrow(/lacks verified evidence/);
    verifiedEvidence(b, 'ev-ok', art);
    b.push('acceptance.passed', { artifactDigest: art });
    expect(b.view!.record.state).toBe('completed');
    expect(() => b.push('cancel.admitted')).toThrow(/immutable/);
    expect(() => b.push('executor.observed', { executorId: 'exec-1', connection: 'healthy', observedAt: 'x' })).toThrow(TransitionError);
  });

  it('rejects evidence recorded against an earlier plan revision', () => {
    const art = artifact('a');
    const b = new LogBuilder().create().planned();
    verifiedEvidence(b, 'ev-old', art);
    const revised = plan({ acceptance: [{ id: 'quality', check: 'score >= baseline + 1', inputs: [], producer: 'metaharness', independent: true, mandatory: true }] });
    b.push('plan.revised', { plan: revised, digest: digestOf(revised) }).admitted().running();
    settleAll(b).push('tasks.settled');
    expect(() => b.push('acceptance.passed', { artifactDigest: art })).toThrow(/lacks verified evidence/);
  });

  it('a disconnected executor is an observation, never a failure', () => {
    const b = new LogBuilder().create().planned().admitted().running();
    const before = b.view!.record;
    b.push('executor.observed', { executorId: 'exec-1', connection: 'disconnected', observedAt: '2026-10-01T00:00:00Z' });
    expect(b.view!.record.state).toBe('running');
    expect(b.view!.record.revision).toBe(before.revision);
    for (const cause of ['disconnected', 'timeout', 'unknown']) {
      expect(() => b.push('failure.verified', { cause, evidenceRef: 'ev' })).toThrow(/not verified failure/);
    }
    b.push('failure.verified', { cause: 'build-failed', evidenceRef: 'ev:log' });
    expect(b.view!.record.state).toBe('failed');
  });

  it('fences stale lease epochs after re-admission', () => {
    const b = new LogBuilder().create().planned().admitted().running();
    const oldEpoch = b.view!.lease.epoch;
    b.push('blocked', { reason: 'dependency unavailable' }).push('resume.admitted', { planDigest: b.view!.record.plan.digest, authorizationRef: 'auth:2', reservationMinor: 0 });
    expect(b.view!.lease.epoch).toBe(oldEpoch + 1);
    expect(() => b.push('task.observed', { taskId: 'produce', status: 'running', leaseEpoch: oldEpoch })).toThrow(/stale|not current/);
    expect(() => b.push('executor.acknowledged', { executorId: 'exec-old', leaseEpoch: oldEpoch })).toThrow(/stale lease epoch/);
    b.running('exec-2');
    expect(b.view!.lease).toEqual({ executorId: 'exec-2', epoch: oldEpoch + 1 });
  });

  it('an unknown task outcome blocks settlement until reconciled', () => {
    const b = new LogBuilder().create().planned().admitted().running();
    settleAll(b);
    b.push('task.observed', { taskId: 'produce', status: 'unknown', leaseEpoch: b.view!.lease.epoch });
    expect(() => b.push('tasks.settled')).toThrow(/unresolved operations: task:produce/);
    b.push('task.observed', { taskId: 'produce', status: 'recorded-done', leaseEpoch: b.view!.lease.epoch });
    b.push('tasks.settled');
    expect(b.view!.record.state).toBe('verifying');
  });

  it('budget reservations are cumulative and cannot exceed the ceiling', () => {
    const b = new LogBuilder().create().planned();
    expect(() => b.admitted(1_001)).toThrow(/exceeds the authorized ceiling/);
    b.admitted(600).running().push('blocked', { reason: 'x' });
    expect(() => b.push('resume.admitted', { planDigest: b.view!.record.plan.digest, authorizationRef: 'a', reservationMinor: 401 })).toThrow(/ceiling/);
    b.push('resume.admitted', { planDigest: b.view!.record.plan.digest, authorizationRef: 'a', reservationMinor: 400 });
    expect(b.view!.budget!.reservedMinor).toBe(1_000);
  });

  it('authorization must cover the exact plan; revising invalidates it', () => {
    const b = new LogBuilder().create().planned();
    expect(() => b.push('admission.accepted', { planDigest: 'sha256:'.padEnd(71, '0'), authorizationRef: 'a', reservationMinor: 0 })).toThrow(/does not cover/);
    b.push('authorization.missing', { reason: 'r' });
    const p2 = plan({ budget: { currency: 'USD', ceilingMinor: 2_000 } });
    b.push('plan.revised', { plan: p2, digest: digestOf(p2) });
    expect(b.view!.record.plan.revision).toBe(2);
    expect(b.view!.record.authorizationRef).toBeUndefined();
  });

  it('cancellation settles only after the leased executor acknowledges', () => {
    const b = new LogBuilder().create().planned().admitted().running('exec-9').push('cancel.admitted');
    expect(() => b.push('cancel.settled', { acknowledgedExecutors: [] })).toThrow(/has not acknowledged/);
    b.push('cancel.settled', { acknowledgedExecutors: ['exec-9'] });
    expect(b.view!.record.state).toBe('cancelled');
  });

  it('rejects revision conflicts, broken chains and cyclic plans during replay', () => {
    const b = new LogBuilder().create();
    const stale = b.draft('plan.validated', { plan: plan(), digest: digestOf(plan()) }, { expectedRevision: 7 });
    expect(() => foldEvent(b.view, stale)).toThrow(/revision-conflict/);
    const tampered = { ...b.draft('plan.validated', { plan: plan(), digest: digestOf(plan()) }), objective: 'x' } as never;
    expect(() => foldEvent(b.view, tampered)).toThrow(/hash mismatch/);
    const cyclic = plan({ tasks: [
      { id: 'a', title: 'a', dependsOn: ['b'], executor: { mode: 'session-bound', requirement: 'x' }, capabilityCeiling: [], estimatedCostMinor: 0, acceptanceEvidence: [] },
      { id: 'b', title: 'b', dependsOn: ['a'], executor: { mode: 'session-bound', requirement: 'x' }, capabilityCeiling: [], estimatedCostMinor: 0, acceptanceEvidence: [] },
    ] });
    expect(() => b.push('plan.validated', { plan: cyclic, digest: digestOf(cyclic) })).toThrow(/cycle/);
  });
});

// --------------------------------------------------------------------------
// Property tests
// --------------------------------------------------------------------------

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const EVENT_TYPES: MissionEventType[] = [...CONTROL_EVENTS.filter((e) => e !== 'mission.created'), 'executor.observed', 'evidence.recorded', 'task.observed'];

function candidatePayload(type: MissionEventType, view: MissionView, rnd: () => number): Record<string, unknown> {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const epoch = rnd() < 0.85 ? view.lease.epoch : view.lease.epoch - 1;
  switch (type) {
    case 'plan.validated': case 'plan.revised': {
      const p = plan({ budget: { currency: 'USD', ceilingMinor: pick([500, 1_000, 5_000]) } });
      return { plan: p, digest: digestOf(p) };
    }
    case 'admission.accepted': case 'resume.admitted':
      return { planDigest: rnd() < 0.9 ? view.record.plan.digest : 'none', authorizationRef: 'auth', reservationMinor: pick([0, 100, 400, 2_000]) };
    case 'executor.acknowledged': return { executorId: pick(['e1', 'e2']), leaseEpoch: epoch };
    case 'quiescence.confirmed': return { leaseEpoch: epoch };
    case 'blocked': case 'acceptance.failed': case 'authorization.missing': return { reason: 'r' };
    case 'acceptance.passed': return { artifactDigest: artifact(pick(['a', 'b'])) };
    case 'cancel.settled': return { acknowledgedExecutors: rnd() < 0.5 ? [view.lease.executorId ?? 'e1'] : [] };
    case 'failure.verified': return { cause: pick(['disconnected', 'timeout', 'crash']), evidenceRef: 'ev' };
    case 'executor.observed': return { executorId: 'e1', connection: pick(['healthy', 'stale', 'disconnected', 'unknown']), observedAt: 't' };
    case 'task.observed': return { taskId: pick(['produce', 'evaluate', 'verify', 'nope']), status: pick(['running', 'recorded-done', 'failed', 'unknown']), leaseEpoch: epoch };
    case 'evidence.recorded': return { evidenceId: `ev${Math.floor(rnd() * 1e9)}`, criterionId: 'quality', producer: 'p', artifactDigest: artifact(pick(['a', 'b'])), verified: rnd() < 0.7 };
    default: return {};
  }
}

describe('properties over random event sequences', () => {
  it('only table transitions are accepted; terminal is absorbing; revisions move only on control events; replay is deterministic', () => {
    let accepted = 0;
    const reachedStates = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = prng(seed);
      const b = new LogBuilder().create();
      for (let step = 0; step < 40; step++) {
        const view = b.view!;
        const type = EVENT_TYPES[Math.floor(rnd() * EVENT_TYPES.length)];
        const event = b.draft(type, candidatePayload(type, view, rnd));
        let next: MissionView;
        try { next = foldEvent(view, event); } catch (e) { expect(e).toBeInstanceOf(TransitionError); continue; }
        accepted++;
        b.view = next;
        b.events.push(event);
        reachedStates.add(next.record.state);
        expect(TERMINAL_STATES.has(view.record.state)).toBe(false);
        if (isControlEvent(type)) {
          expect(TRANSITIONS.some((r) => r.event === type && r.from.includes(view.record.state) && r.to === next.record.state)).toBe(true);
          expect(next.record.revision).toBe(view.record.revision + 1);
        } else {
          expect(next.record.state).toBe(view.record.state);
          expect(next.record.revision).toBe(view.record.revision);
        }
        if (type === 'failure.verified') expect(['disconnected', 'timeout']).not.toContain(event.payload.cause);
      }
      // Full replay and snapshot+tail replay (through JSON, as on disk) agree.
      const full = replay(b.events);
      const k = Math.floor(rnd() * b.events.length) + 1;
      const snapshot = JSON.parse(JSON.stringify(replay(b.events.slice(0, k))));
      expect(replay(b.events.slice(k), snapshot)).toEqual(JSON.parse(JSON.stringify(full)));
      expect(full).toEqual(b.view);
    }
    expect(accepted).toBeGreaterThan(2_000);
    for (const s of ['planned', 'queued', 'running', 'blocked', 'cancelled', 'failed']) expect(reachedStates).toContain(s);
  });
});
