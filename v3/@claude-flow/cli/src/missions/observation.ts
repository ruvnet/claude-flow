/**
 * ADR-406 M1 / §11 — the bounded mission observation file a workbench reads.
 *
 * `.claude-flow/missions/observation.json` is rewritten atomically after each
 * committed mission event. It carries the source time (`observedAt`, the time
 * of the newest committed event); readers stamp their own fetch time and derive
 * freshness from `observedAt`, never from a redraw. Strings are stripped of
 * control and bidi characters and truncated here, at write time, so a reader
 * never sees unbounded or instruction-shaped text from a mission.
 *
 * It is observation only. Task status is recorded state; only
 * `evidence.verified` counts as verified, and an executor marked disconnected
 * is not a failed mission.
 */

import type { MissionView } from './transitions.js';

export const OBSERVATION_CONTRACT = 'ruflo.mission-observation/1' as const;
export const OBSERVATION_FILE = 'observation.json';
export const OBSERVATION_LIMITS = Object.freeze({ missions: 50, tasks: 50, string: 200, objective: 400 });

export interface MissionObservation {
  readonly schemaVersion: 1;
  readonly contract: typeof OBSERVATION_CONTRACT;
  readonly source: 'ruflo-cli/missions';
  readonly workspaceId: string;
  readonly observedAt: string | null;
  readonly truncated: boolean;
  readonly missions: readonly ObservedMission[];
}

export interface ObservedMission {
  readonly missionId: string;
  readonly objective: string;
  readonly state: string;
  readonly revision: number;
  readonly executionMode: string;
  readonly plan: {
    readonly revision: number;
    readonly digest: string;
    readonly taskCount: number;
    readonly tasks: readonly { readonly id: string; readonly title: string; readonly dependsOn: readonly string[]; readonly status: string }[];
  };
  readonly budget: MissionView['budget'];
  readonly evidence: { readonly count: number; readonly verified: number };
  readonly executor: { readonly connection: string; readonly observedAt: string; readonly lastAckExecutionId: string | null } | null;
  readonly unresolvedOperations: number;
  readonly blockedReason: string | null;
  readonly lastEventSequence: number;
  readonly updatedAt: string;
}

/** Strip C0/C1 controls and bidi overrides, then bound the length. */
export function sanitize(value: string, max: number = OBSERVATION_LIMITS.string): string {
  let out = '';
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) { out += ' '; continue; }
    if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f) continue;
    out += ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

export function observeMission(view: MissionView): ObservedMission {
  const plan = view.planBody;
  return {
    missionId: view.record.missionId,
    objective: sanitize(view.record.objective, OBSERVATION_LIMITS.objective),
    state: view.record.state,
    revision: view.record.revision,
    executionMode: view.record.executionMode,
    plan: {
      revision: view.record.plan.revision,
      digest: view.record.plan.digest,
      taskCount: plan?.tasks.length ?? 0,
      tasks: (plan?.tasks ?? []).slice(0, OBSERVATION_LIMITS.tasks).map((t) => ({
        id: sanitize(t.id, 64),
        title: sanitize(t.title),
        dependsOn: t.dependsOn.slice(0, 16).map((d) => sanitize(d, 64)),
        status: view.tasks[t.id]?.status ?? 'pending',
      })),
    },
    budget: view.budget,
    evidence: { count: view.evidence.length, verified: view.evidence.filter((e) => e.verified).length },
    executor: view.executor
      ? { connection: view.executor.connection, observedAt: view.executor.observedAt, lastAckExecutionId: view.executor.lastAckExecutionId }
      : null,
    unresolvedOperations: view.unresolvedOperations.length,
    blockedReason: view.blockedReason ? sanitize(view.blockedReason) : null,
    lastEventSequence: view.record.lastEventSequence,
    updatedAt: view.record.updatedAt,
  };
}

/** Newest-updated first, capped; `observedAt` is the newest committed event time. */
export function buildObservation(workspaceId: string, views: readonly MissionView[]): MissionObservation {
  const sorted = [...views].sort((a, b) => (a.record.updatedAt < b.record.updatedAt ? 1 : a.record.updatedAt > b.record.updatedAt ? -1 : 0));
  return {
    schemaVersion: 1,
    contract: OBSERVATION_CONTRACT,
    source: 'ruflo-cli/missions',
    workspaceId,
    observedAt: sorted[0]?.record.updatedAt ?? null,
    truncated: sorted.length > OBSERVATION_LIMITS.missions,
    missions: sorted.slice(0, OBSERVATION_LIMITS.missions).map(observeMission),
  };
}
