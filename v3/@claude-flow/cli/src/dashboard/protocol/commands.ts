import { z } from 'zod';
import { CAPABILITY_ID, PLUGIN_ID, SECTION_NAMES } from './sections.js';

/** Control levels mirror the ruflo console: off < read < write < manage < full. */
export const LEVELS = ['off', 'read', 'write', 'manage', 'full'] as const;
export type Level = (typeof LEVELS)[number];
export const levelRank = (l: Level): number => LEVELS.indexOf(l);

const missionId = z.string().regex(/^msn_[a-f0-9]{24}$/);
const requestId = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
export const MAX_SWARM_AGENTS = 6;
export const AGENT_TYPES = ['coder', 'reviewer', 'tester', 'planner', 'researcher', 'security-auditor', 'performance-engineer'] as const;

export interface CommandSpec { level: Level; summary: string; args: z.ZodType<Record<string, unknown>>; }
/** Optional optimistic-concurrency guard: the revision the human saw; the connector refuses (never acts) when the live revision differs. */
const expectedRevision = z.number().int().safe().min(1).optional();
const empty = z.object({}).strict();
/** Capability arguments: bounded plain values only. The capability's OWN schema (connector-side, built from the installed plugin) validates them a second time. */
export const CAPABILITY_ARG_MAX_TEXT = 8000;
export const CAPABILITY_ARG_MAX_COUNT = 12;
const capabilityArgs = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/), z.union([z.string().max(CAPABILITY_ARG_MAX_TEXT), z.number().safe(), z.boolean()])).refine(o => Object.keys(o).length <= CAPABILITY_ARG_MAX_COUNT, 'too many arguments');
export const AGENT_ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
export const ISSUE_ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:#/@-]{0,79}$/);
/** The claimant exactly as the claims section shows it ("agent:<id>:<type>" or "human:<id>:<name>"): printable ASCII, no control characters. */
export const CLAIMANT_TEXT = z.string().regex(/^(agent|human):[\x20-\x7e]{1,72}$/);
export const TASK_TYPES = ['feature', 'bugfix', 'refactor', 'test', 'research', 'docs'] as const;
const optionKey = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,47}$/);

/** The ONLY commands the hosted dashboard may ask a local ruflo to run. Anything else is refused on both ends. */
export const COMMANDS = {
  'section.refresh': { level: 'read', summary: 'Re-collect and publish one section now', args: z.object({ section: z.enum(SECTION_NAMES) }).strict() },
  'memory.list': { level: 'read', summary: 'List memory keys in a namespace (keys only, no values)', args: z.object({ namespace: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/), limit: z.number().int().min(1).max(100).default(20) }).strict() },
  'swarm.stop': { level: 'manage', summary: 'Shut down the running swarm', args: empty },
  'state.refresh': { level: 'read', summary: 'Publish a fresh state digest', args: empty },
  'memory.search': { level: 'read', summary: 'Semantic memory search (read-only)', args: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).default(5) }).strict() },
  'mission.create': { level: 'write', summary: 'Create a DRAFT mission (executes nothing)', args: z.object({ requestId, objective: z.string().min(3).max(2000) }).strict() },
  'mission.pause': { level: 'write', summary: 'Pause a mission', args: z.object({ missionId, expectedRevision }).strict() },
  'mission.resume': { level: 'write', summary: 'Resume a paused mission', args: z.object({ missionId, expectedRevision }).strict() },
  'mission.stop': { level: 'manage', summary: 'Stop a mission', args: z.object({ missionId, expectedRevision }).strict() },
  'swarm.init': { level: 'manage', summary: 'Initialise a hierarchical swarm (max 6 agents)', args: z.object({ topology: z.enum(['hierarchical', 'mesh']).default('hierarchical'), maxAgents: z.number().int().min(1).max(MAX_SWARM_AGENTS).default(6) }).strict() },
  'plugin.list': { level: 'read', summary: 'Re-publish the installed-plugin list and capability catalog now', args: empty },
  'plugin.enable': { level: 'manage', summary: 'Enable an installed plugin (claude plugin enable <name>@<marketplace> --scope user)', args: z.object({ pluginId: PLUGIN_ID }).strict() },
  'plugin.disable': { level: 'manage', summary: 'Disable an installed plugin (claude plugin disable <name>@<marketplace> --scope user)', args: z.object({ pluginId: PLUGIN_ID }).strict() },
  // The level here is only the floor for the device. The connector replaces it with the level of the capability it finds in its OWN catalog,
  // and anything above read always shows the local approval card, whatever autoApprove says (docs/parity-capability-design.md section 5).
  'capability.run': { level: 'read', summary: 'Run one capability from the locally built catalog (level and approval come from the capability)', args: z.object({ pluginId: PLUGIN_ID, capabilityId: CAPABILITY_ID, args: capabilityArgs }).strict() },
  'mod.option.set': { level: 'write', summary: 'Change one option of an installed plugin (booleans, numbers and enums; spend caps may only be lowered)', args: z.object({ modId: PLUGIN_ID, key: optionKey, value: z.union([z.boolean(), z.number().safe(), z.string().max(64)]) }).strict() },
  // ---- P1-complete safe commands (docs/p1-connector-decisions.md). Every one is exact-argv, regex-bounded, and approval-gated above read. ----
  'agent.logs': { level: 'read', summary: 'Tail one agent\'s log (masked, at most 100 lines; ruflo\'s entries are synthetic today, ruvnet/ruflo#1916)', args: z.object({ agentId: AGENT_ID, lines: z.number().int().min(1).max(100).default(50) }).strict() },
  'agent.stop': { level: 'manage', summary: 'Terminate one agent', args: z.object({ agentId: AGENT_ID }).strict() },
  'task.create': { level: 'manage', summary: 'Put a task on the board (agents may pick it up: manage, always approved)', args: z.object({ type: z.enum(TASK_TYPES), description: z.string().min(3).max(500) }).strict() },
  'claims.release': { level: 'manage', summary: 'Release a claim (only if it is still held by the claimant you saw)', args: z.object({ issue: ISSUE_ID, claimant: CLAIMANT_TEXT }).strict() },
  'claims.pause': { level: 'manage', summary: 'Mark a claim paused', args: z.object({ issue: ISSUE_ID }).strict() },
  'claims.resume': { level: 'manage', summary: 'Mark a paused claim active again', args: z.object({ issue: ISSUE_ID }).strict() },
  'memory.store': { level: 'write', summary: 'Store a short note in the fixed "dashboard" namespace', args: z.object({ key: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/), value: z.string().min(1).max(2048) }).strict() },
  'autopilot.stop': { level: 'manage', summary: 'Stop the console autopilot by creating its KILL file (narrows authority only; never deleted by the dashboard)', args: empty },
  'agent.spawn': { level: 'manage', summary: 'Spawn one agent within the swarm cap', args: z.object({ type: z.enum(AGENT_TYPES), name: z.string().regex(/^[A-Za-z0-9._-]{1,48}$/).optional() }).strict() },
} as const satisfies Record<string, CommandSpec>;
export type CommandName = keyof typeof COMMANDS;
export const isCommandName = (n: unknown): n is CommandName => typeof n === 'string' && Object.prototype.hasOwnProperty.call(COMMANDS, n);

export const CommandBodySchema = z.object({
  cid: z.string().regex(/^cmd_[A-Za-z0-9_-]{16,64}$/),
  cmd: z.string().max(40),
  args: z.record(z.unknown()),
  /** Cognitum subject hash of the human who issued it, for the local audit log. */
  by: z.string().max(80),
  expiresAt: z.number().int().safe().positive(),
}).strict();
export type CommandBody = z.infer<typeof CommandBodySchema>;

export type ParsedCommand = { ok: true; cmd: CommandName; args: Record<string, unknown>; level: Level } | { ok: false; reason: string };
export function parseCommand(name: unknown, args: unknown): ParsedCommand {
  if (!isCommandName(name)) return { ok: false, reason: 'command_not_allowlisted' };
  const spec = COMMANDS[name] as CommandSpec;
  const r = spec.args.safeParse(args ?? {});
  if (!r.success) return { ok: false, reason: 'invalid_arguments' };
  return { ok: true, cmd: name, args: r.data, level: spec.level };
}

/** Whether a command may run given the device's local control level; write+ also needs a local approval unless auto. */
/** Commands whose real level comes from a locally resolved target; the connector must never auto-approve these above read. */
export const DYNAMIC_LEVEL_COMMANDS: readonly CommandName[] = ['capability.run'];
/** capability.run: the level is the capability's, anything above read ALWAYS needs the local card (autoApprove is ignored). */
export function authorizeCapability(capLevel: 'read' | 'write' | 'manage' | null, deviceLevel: Level): { allowed: boolean; needsApproval: boolean; reason?: string } {
  if (capLevel === null) return { allowed: false, needsApproval: false, reason: 'capability_refused' };
  if (levelRank(deviceLevel) < levelRank(capLevel)) return { allowed: false, needsApproval: false, reason: `level_${deviceLevel}_below_${capLevel}` };
  return { allowed: true, needsApproval: capLevel !== 'read' };
}

export function authorize(cmd: CommandName, deviceLevel: Level, autoApprove: boolean): { allowed: boolean; needsApproval: boolean; reason?: string } {
  const need = (COMMANDS[cmd] as CommandSpec).level;
  if (levelRank(deviceLevel) < levelRank(need)) return { allowed: false, needsApproval: false, reason: `level_${deviceLevel}_below_${need}` };
  const needsApproval = need !== 'read' && !(autoApprove && levelRank(need) <= levelRank('write'));
  return { allowed: true, needsApproval };
}
