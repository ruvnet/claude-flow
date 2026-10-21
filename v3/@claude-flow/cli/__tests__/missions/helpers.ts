/** Shared builders for ADR-406 mission tests. */
import { createHash } from 'node:crypto';
import {
  GENESIS_HASH,
  MISSION_EVENT_CONTRACT,
  digestOf,
  eventHash,
  foldEvent,
  isControlEvent,
  type MissionEvent,
  type MissionEventType,
  type MissionView,
  type PlanBody,
} from '../../src/missions/index.js';

export const MISSION_ID = `msn_${'a'.repeat(24)}`;

export function artifact(name: string): string {
  return `sha256:${createHash('sha256').update(name).digest('hex')}`;
}

export function plan(overrides: Partial<PlanBody> = {}): PlanBody {
  return {
    tasks: [
      { id: 'produce', title: 'Produce artifact', dependsOn: [], executor: { mode: 'durable-executor', requirement: 'ruos-job' }, capabilityCeiling: ['fs.write'], estimatedCostMinor: 100, acceptanceEvidence: [] },
      { id: 'evaluate', title: 'Evaluate artifact', dependsOn: ['produce'], executor: { mode: 'durable-executor', requirement: 'metaharness' }, capabilityCeiling: [], estimatedCostMinor: 50, acceptanceEvidence: ['quality'] },
      { id: 'verify', title: 'Verify acceptance', dependsOn: ['evaluate'], executor: { mode: 'durable-executor', requirement: 'ruflo' }, capabilityCeiling: [], estimatedCostMinor: 0, acceptanceEvidence: [] },
    ],
    acceptance: [{ id: 'quality', check: 'score >= baseline', inputs: [], producer: 'metaharness', independent: true, mandatory: true }],
    budget: { currency: 'USD', ceilingMinor: 1_000 },
    scope: { capabilities: ['fs.write'] },
    ...overrides,
  };
}

/** Builds a hash-chained event log by folding as it goes (invalid steps throw). */
export class LogBuilder {
  view: MissionView | null = null;
  readonly events: MissionEvent[] = [];
  private clock = Date.parse('2026-10-01T00:00:00.000Z');

  draft(type: MissionEventType, payload: Record<string, unknown> = {}, opts: { expectedRevision?: number | null; requestId?: string } = {}): MissionEvent {
    const view = this.view;
    const control = isControlEvent(type);
    const body = {
      contract: MISSION_EVENT_CONTRACT,
      seq: view ? view.record.lastEventSequence + 1 : 1,
      missionId: MISSION_ID,
      type,
      expectedRevision: opts.expectedRevision !== undefined ? opts.expectedRevision : control && view ? view.record.revision : null,
      revision: view ? view.record.revision + (control ? 1 : 0) : 1,
      principalId: 'local:test',
      channel: 'internal' as const,
      requestId: opts.requestId ?? null,
      requestDigest: null,
      policyDecisionRef: null,
      at: new Date((this.clock += 1000)).toISOString(),
      payload,
      prevHash: view ? view.lastHash : GENESIS_HASH,
    };
    return { ...body, hash: eventHash(body) };
  }

  push(type: MissionEventType, payload: Record<string, unknown> = {}): this {
    const event = this.draft(type, payload);
    this.view = foldEvent(this.view, event);
    this.events.push(event);
    return this;
  }

  create(): this {
    return this.push('mission.created', {
      objective: 'Ship a verified artifact', tenantId: 'local', workspaceId: 'ws_test', ownerPrincipalId: 'local:test',
      policyRef: 'policy:test', budgetRef: 'budget:test',
    });
  }

  planned(body: PlanBody = plan()): this {
    return this.push('plan.validated', { plan: body, digest: digestOf(body) });
  }

  admitted(reservationMinor = 150): this {
    return this.push('admission.accepted', { planDigest: this.view!.record.plan.digest, authorizationRef: 'auth:1', reservationMinor });
  }

  running(executorId = 'exec-1'): this {
    return this.push('executor.acknowledged', { executorId, leaseEpoch: this.view!.lease.epoch });
  }
}
