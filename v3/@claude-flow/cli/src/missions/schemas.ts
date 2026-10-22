/**
 * ADR-406 §19.3 — versioned mission schemas.
 *
 * `MissionRecord` is the §19.3 logical schema field for field (strict). The
 * plan body, budget ledger, evidence index and executor observations are kept
 * in a `MissionView` beside it, so the record itself stays exactly the ADR's.
 *
 * Every client input (CLI and MCP alike) is parsed here: strict objects,
 * bounded strings and arrays, integer monetary units. Principal, tenant and
 * workspace are never accepted from input; the service derives them.
 */

import { z } from 'zod';

export const MISSION_SCHEMA_VERSION = 1 as const;
export const MISSION_EVENT_CONTRACT = 'ruflo.mission-event/1' as const;

export const MISSION_LIMITS = Object.freeze({
  objective: 2_000,
  title: 200,
  text: 500,
  id: 64,
  tasks: 100,
  criteria: 50,
  deps: 32,
  capabilities: 32,
  maxMinor: 1_000_000_000_000, // 10^12 minor units: far above any sane ceiling, below 2^53
  requestId: 128,
  eventsPage: 500,
});

export const missionStateSchema = z.enum([
  'draft', 'planned', 'awaitingAuthorization', 'queued',
  'running', 'pauseRequested', 'paused', 'blocked',
  'verifying', 'completed', 'failed',
  'cancelRequested', 'cancelled',
]);
export type MissionState = z.infer<typeof missionStateSchema>;

export const TERMINAL_STATES: ReadonlySet<MissionState> = new Set(['completed', 'failed', 'cancelled']);

export const executionModeSchema = z.enum(['durable-executor', 'session-bound']);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const MISSION_ID = /^msn_[a-f0-9]{24}$/;
const SHORT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DIGEST = /^(?:sha256:[a-f0-9]{64}|none)$/;

const text = (max: number) => z.string().min(1).max(max);
const shortId = z.string().regex(SHORT_ID);
const minor = z.number().int().min(0).max(MISSION_LIMITS.maxMinor);

/** §19.3, exactly. */
export const missionRecordSchema = z.object({
  schemaVersion: z.literal(MISSION_SCHEMA_VERSION),
  missionId: z.string().regex(MISSION_ID),
  tenantId: text(MISSION_LIMITS.id),
  workspaceId: text(MISSION_LIMITS.id),
  ownerPrincipalId: text(MISSION_LIMITS.title),
  revision: z.number().int().min(1),
  objective: text(MISSION_LIMITS.objective),
  plan: z.object({
    revision: z.number().int().min(0),
    digest: z.string().regex(DIGEST),
    taskGraphRef: z.string().max(MISSION_LIMITS.title),
  }).strict(),
  policyRef: text(MISSION_LIMITS.title),
  authorizationRef: text(MISSION_LIMITS.title).optional(),
  budgetRef: text(MISSION_LIMITS.title),
  executionMode: executionModeSchema,
  state: missionStateSchema,
  evidenceRefs: z.array(text(MISSION_LIMITS.title)),
  acceptance: z.object({ revision: z.number().int().min(0), criteriaDigest: z.string().regex(DIGEST) }).strict(),
  lastEventSequence: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type MissionRecord = z.infer<typeof missionRecordSchema>;

// ---------------------------------------------------------------------------
// Plan input
// ---------------------------------------------------------------------------

export const taskSpecSchema = z.object({
  id: shortId,
  title: text(MISSION_LIMITS.title),
  dependsOn: z.array(shortId).max(MISSION_LIMITS.deps).default([]),
  executor: z.object({
    mode: executionModeSchema,
    requirement: text(MISSION_LIMITS.title),
  }).strict(),
  capabilityCeiling: z.array(text(MISSION_LIMITS.title)).max(MISSION_LIMITS.capabilities).default([]),
  estimatedCostMinor: minor.default(0),
  checkpoint: text(MISSION_LIMITS.title).optional(),
  acceptanceEvidence: z.array(shortId).max(MISSION_LIMITS.criteria).default([]),
}).strict();

export const acceptanceCriterionSchema = z.object({
  id: shortId,
  check: text(MISSION_LIMITS.text),
  inputs: z.array(text(MISSION_LIMITS.title)).max(16).default([]),
  baseline: text(MISSION_LIMITS.title).optional(),
  threshold: text(MISSION_LIMITS.title).optional(),
  producer: text(MISSION_LIMITS.title),
  independent: z.boolean().default(false),
  mandatory: z.boolean().default(true),
}).strict();

export const budgetSpecSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  ceilingMinor: minor.refine((v) => v > 0, 'ceilingMinor must be positive'),
  tokens: z.number().int().min(0).optional(),
  wallTimeSeconds: z.number().int().min(0).optional(),
  concurrency: z.number().int().min(1).max(64).optional(),
  retries: z.number().int().min(0).max(100).optional(),
}).strict();

export const planBodySchema = z.object({
  tasks: z.array(taskSpecSchema).min(1).max(MISSION_LIMITS.tasks),
  acceptance: z.array(acceptanceCriterionSchema).min(1).max(MISSION_LIMITS.criteria),
  budget: budgetSpecSchema,
  scope: z.object({
    capabilities: z.array(text(MISSION_LIMITS.title)).max(MISSION_LIMITS.capabilities).default([]),
  }).strict().default({ capabilities: [] }),
}).strict();
export type PlanBody = z.infer<typeof planBodySchema>;
export type TaskSpec = z.infer<typeof taskSpecSchema>;

// ---------------------------------------------------------------------------
// Operation inputs (shared by CLI and MCP)
// ---------------------------------------------------------------------------

const requestId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const missionId = z.string().regex(MISSION_ID);

export const createInputSchema = z.object({
  requestId,
  objective: text(MISSION_LIMITS.objective),
}).strict();

export const planInputSchema = z.object({
  requestId,
  missionId,
  expectedRevision: z.number().int().min(1),
  plan: planBodySchema,
}).strict();

export const getInputSchema = z.object({ missionId: missionId.optional() }).strict();

export const eventsInputSchema = z.object({
  missionId,
  afterSequence: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(MISSION_LIMITS.eventsPage).default(100),
}).strict();

export const requestActionInputSchema = z.object({
  requestId,
  missionId,
  expectedRevision: z.number().int().min(1),
  action: z.enum(['pause', 'resume', 'cancel', 'requestAuthorization', 'admit']),
  reason: text(MISSION_LIMITS.text).optional(),
}).strict();

export type CreateInput = z.infer<typeof createInputSchema>;
export type PlanInput = z.infer<typeof planInputSchema>;
export type GetInput = z.infer<typeof getInputSchema>;
export type EventsInput = z.infer<typeof eventsInputSchema>;
export type RequestActionInput = z.infer<typeof requestActionInputSchema>;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Control events change mission state or authority and bump `revision`. */
export const CONTROL_EVENTS = [
  'mission.created', 'plan.validated', 'plan.revised', 'authorization.missing', 'admission.accepted',
  'executor.acknowledged', 'pause.accepted', 'quiescence.confirmed', 'blocked', 'resume.admitted',
  'tasks.settled', 'acceptance.passed', 'acceptance.failed', 'cancel.admitted', 'cancel.settled',
  'failure.verified',
] as const;

/** Observations record what was seen; they never change state or revision. */
export const OBSERVATION_EVENTS = ['executor.observed', 'evidence.recorded', 'task.observed'] as const;

export type ControlEventType = typeof CONTROL_EVENTS[number];
export type ObservationEventType = typeof OBSERVATION_EVENTS[number];
export type MissionEventType = ControlEventType | ObservationEventType;

export interface MissionEvent {
  readonly contract: typeof MISSION_EVENT_CONTRACT;
  readonly seq: number;
  readonly missionId: string;
  readonly type: MissionEventType;
  /** Revision the requester expected; `null` for observations. */
  readonly expectedRevision: number | null;
  /** Mission revision after this event. */
  readonly revision: number;
  readonly principalId: string;
  readonly channel: 'cli' | 'mcp' | 'executor' | 'internal';
  readonly requestId: string | null;
  readonly requestDigest: string | null;
  readonly policyDecisionRef: string | null;
  readonly at: string;
  readonly payload: Record<string, unknown>;
  readonly prevHash: string;
  readonly hash: string;
}

export const executorConnectionSchema = z.enum(['healthy', 'stale', 'disconnected', 'unknown']);
export type ExecutorConnection = z.infer<typeof executorConnectionSchema>;
