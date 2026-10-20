/**
 * `ruflo mission` — ADR-406 §19.7 mission operations from the CLI.
 *
 *   mission create  --objective <text> [--request-id <id>]
 *   mission plan    --mission <id> --expected-revision <n> --plan-file <json> [--request-id <id>]
 *   mission get     [--mission <id>]
 *   mission events  --mission <id> [--after <seq>] [--limit <n>]
 *   mission action  --mission <id> --expected-revision <n> --action <requestAuthorization|pause|cancel|admit|resume> [--reason <text>]
 *
 * Flags map one-to-one onto the raw input the MCP tools receive; the shared
 * `MissionService` validates both. Output is JSON. A missing request id gets a
 * fresh one: a new id is a new intentional request (ADR-406 §9); pass the same
 * id to retry the same request safely.
 */

import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { MissionService } from '../missions/service.js';
import type { MissionPort } from '../mcp-tools/mission-tools.js';

const PLAN_FILE_MAX_BYTES = 256 * 1024;

export type MissionPortFactoryCli = (projectRoot: string) => MissionPort;
let factory: MissionPortFactoryCli = (projectRoot) => new MissionService({ projectRoot, channel: 'cli' });

/** Test seam (London school): substitute the service the command talks to. */
export function setMissionPortFactory(next: MissionPortFactoryCli | null): void {
  factory = next ?? ((projectRoot) => new MissionService({ projectRoot, channel: 'cli' }));
}

function int(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function readPlanFile(path: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new Error('plan-file must be a regular file');
  if (stat.size > PLAN_FILE_MAX_BYTES) throw new Error(`plan-file exceeds ${PLAN_FILE_MAX_BYTES} bytes`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Raw operation input from flags; undefined fields are dropped so defaults apply. */
export function inputFromFlags(op: string, flags: Record<string, unknown>, cwd: string): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) raw[key] = value; };
  const requestId = typeof flags.requestId === 'string' ? flags.requestId : randomUUID();
  if (op === 'create') {
    set('requestId', requestId);
    set('objective', flags.objective);
  } else if (op === 'plan') {
    set('requestId', requestId);
    set('missionId', flags.mission);
    set('expectedRevision', int(flags.expectedRevision));
    if (typeof flags.planFile === 'string') set('plan', readPlanFile(resolve(cwd, flags.planFile)));
  } else if (op === 'get') {
    set('missionId', flags.mission);
  } else if (op === 'events') {
    set('missionId', flags.mission);
    set('afterSequence', int(flags.after));
    set('limit', int(flags.limit));
  } else if (op === 'action') {
    set('requestId', requestId);
    set('missionId', flags.mission);
    set('expectedRevision', int(flags.expectedRevision));
    set('action', flags.action);
    set('reason', flags.reason);
  }
  return raw;
}

export const missionCommand: Command = {
  name: 'mission',
  description: 'ADR-406 mission control: create, plan, get, events, action (shared runtime with the mission_* MCP tools)',
  options: [
    { name: 'objective', type: 'string', description: 'create: mission objective' },
    { name: 'mission', type: 'string', description: 'Mission id (msn_…)' },
    { name: 'request-id', type: 'string', description: 'Idempotency key; reuse only to retry the same request' },
    { name: 'expected-revision', type: 'number', description: 'Revision the request was prepared against' },
    { name: 'plan-file', type: 'string', description: 'plan: JSON file with { tasks, acceptance, budget, scope }' },
    { name: 'after', type: 'number', description: 'events: cursor (last sequence seen)' },
    { name: 'limit', type: 'number', description: 'events: page size (max 500)' },
    { name: 'action', type: 'string', description: 'action: requestAuthorization | pause | cancel | admit | resume' },
    { name: 'reason', type: 'string', description: 'action: reason' },
    { name: 'project-root', type: 'string', description: 'Project root (default: cwd)' },
  ],
  examples: [
    { command: 'ruflo mission create --objective "Ship the report" --request-id r1', description: 'Create a draft mission' },
    { command: 'ruflo mission plan --mission msn_… --expected-revision 1 --plan-file plan.json', description: 'Submit a plan' },
    { command: 'ruflo mission events --mission msn_… --after 0', description: 'Read events from a cursor' },
  ],
  async action(ctx: CommandContext): Promise<CommandResult> {
    const flags = ctx.flags as Record<string, unknown>;
    const op = ctx.args[0] ?? 'get';
    const root = resolve(String(flags.projectRoot ?? ctx.cwd ?? process.cwd()));
    const ops: Record<string, keyof MissionPort> = { create: 'create', plan: 'plan', get: 'get', events: 'events', action: 'requestAction' };
    const method = ops[op];
    if (!method) {
      output.printError(`unknown mission operation: ${op} (create | plan | get | events | action)`);
      return { success: false, exitCode: 1 };
    }
    let result;
    try {
      result = await factory(root)[method](inputFromFlags(op, flags, root));
    } catch (error) {
      result = { ok: false as const, code: 'invalid-input', message: error instanceof Error ? error.message : String(error) };
    }
    output.writeln(JSON.stringify(result, null, 2));
    return { success: result.ok, exitCode: result.ok ? 0 : result.code === 'revision-conflict' ? 3 : 1, data: result };
  },
};

export default missionCommand;
