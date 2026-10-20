/**
 * ADR-406 §19.7 — MCP adapter for the mission semantic operations.
 *
 * A thin transport: input goes to the same `MissionService` (and the same zod
 * schemas) the CLI uses, unchanged. Policy authorization of the tool call
 * itself happens in `mcp-client.ts` before any handler runs; nothing here
 * accepts an approval, principal or permission flag from input.
 */

import type { MCPTool } from './types.js';
import { getProjectCwd } from './types.js';
import { MissionService, type MissionResult } from '../missions/service.js';

/** The operations an adapter needs; London-school tests substitute it. */
export interface MissionPort {
  create(raw: unknown): Promise<MissionResult<unknown>>;
  plan(raw: unknown): Promise<MissionResult<unknown>>;
  get(raw: unknown): Promise<MissionResult<unknown>>;
  events(raw: unknown): Promise<MissionResult<unknown>>;
  requestAction(raw: unknown): Promise<MissionResult<unknown>>;
}

export type MissionPortFactory = (projectRoot: string) => MissionPort;

const defaultFactory: MissionPortFactory = (projectRoot) => new MissionService({ projectRoot, channel: 'mcp' });

function rootOf(context?: Record<string, unknown>): string {
  return typeof context?.projectRoot === 'string' ? context.projectRoot : getProjectCwd();
}

const MISSION_ID = { type: 'string', pattern: '^msn_[a-f0-9]{24}$', description: 'Mission id' };
const REQUEST_ID = { type: 'string', maxLength: 128, description: 'Caller-chosen idempotency key; reuse only to retry the same request' };
const EXPECTED_REVISION = { type: 'integer', minimum: 1, description: 'Mission revision the request was prepared against' };

export function createMissionTools(factory: MissionPortFactory = defaultFactory): MCPTool[] {
  const call = (op: keyof MissionPort) => async (input: Record<string, unknown>, context?: Record<string, unknown>) =>
    factory(rootOf(context))[op](input);
  return [
    {
      name: 'mission_create',
      description: 'Create a draft mission (objective only), idempotent per requestId. Use when starting governed multi-step work that several clients (CLI, MCP, the Claude Code workbench) must observe and control through one durable record. task_create is wrong because a task has no plan revision, budget ceiling or acceptance evidence. Recording a mission executes nothing.',
      category: 'mission',
      inputSchema: { type: 'object', properties: { requestId: REQUEST_ID, objective: { type: 'string', maxLength: 2000 } }, required: ['requestId', 'objective'] },
      handler: call('create'),
    },
    {
      name: 'mission_plan',
      description: 'Submit or revise a mission plan: acyclic task graph, acceptance criteria and budget ceiling in integer minor units. Use when a mission needs a reviewable plan before any authorization or admission. Editing plan state through memory_store is wrong because it bypasses revision checks: a stale expectedRevision here returns a conflict with the current revision, and a revision invalidates prior authorization.',
      category: 'mission',
      inputSchema: {
        type: 'object',
        properties: { requestId: REQUEST_ID, missionId: MISSION_ID, expectedRevision: EXPECTED_REVISION, plan: { type: 'object', description: '{ tasks[], acceptance[], budget{currency, ceilingMinor}, scope }' } },
        required: ['requestId', 'missionId', 'expectedRevision', 'plan'],
      },
      handler: call('plan'),
    },
    {
      name: 'mission_get',
      description: 'Read one mission (record, plan, budget, tasks, evidence, executor observation) or list missions; read only. Use when you need the authoritative current state of a mission before acting on it. Inferring state from task_status or a UI badge is wrong because task status is recorded state; only evidence.verified counts as verified, and a disconnected executor is not a failure.',
      category: 'mission',
      inputSchema: { type: 'object', properties: { missionId: MISSION_ID } },
      handler: call('get'),
    },
    {
      name: 'mission_events',
      description: 'Read mission events after a durable cursor (afterSequence). Use when resuming or reconnecting a client and you need exactly what changed since your last sequence. Re-reading mission_get in a loop is wrong because it loses the transition history; delivery here may repeat, so deduplicate by (missionId, seq), and gap=true means reload with mission_get before replaying.',
      category: 'mission',
      inputSchema: {
        type: 'object',
        properties: { missionId: MISSION_ID, afterSequence: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500 } },
        required: ['missionId'],
      },
      handler: call('events'),
    },
    {
      name: 'mission_request_action',
      description: 'Request a scoped mission control action: requestAuthorization, pause or cancel (admit and resume report executor-unavailable until a durable executor is admitted). Use when a person or agent wants a running or planned mission to change course. Calling task_cancel or killing a process is wrong because it skips the revision check and executor acknowledgement; a request is not authorization, the runtime decides.',
      category: 'mission',
      inputSchema: {
        type: 'object',
        properties: {
          requestId: REQUEST_ID, missionId: MISSION_ID, expectedRevision: EXPECTED_REVISION,
          action: { type: 'string', enum: ['requestAuthorization', 'pause', 'cancel', 'admit', 'resume'] },
          reason: { type: 'string', maxLength: 500 },
        },
        required: ['requestId', 'missionId', 'expectedRevision', 'action'],
      },
      handler: call('requestAction'),
    },
  ];
}

export const missionTools: MCPTool[] = createMissionTools();
