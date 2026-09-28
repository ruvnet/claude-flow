/**
 * Exec-host plan entries for team_spawn. The team bus store builds the
 * native entries (grok, claude); this module adds one entry per requested
 * exec host (codex, command hosts) with the shared child protocol plus the
 * adapter's own lines.
 */

import { getProjectCwd } from '../types.js';
import { resolveHost, TeamHostsError } from './index.js';
import type { CommandHostConfig, ExecHostAdapter, ExecSpec, RoleDefaults, SpawnContext } from './types.js';

/** The store's ROLE_DEFAULTS table (coder is the fallback, as in the store). */
export type RoleTable = Record<string, RoleDefaults>;
const defaultsFor = (table: RoleTable, role: string): RoleDefaults => table[role] || table.coder;

interface PlanTeam {
  id: string;
  name: string;
  host?: string;
}

/** Shared, host-neutral protocol text for an exec child plus the adapter's own lines. */
function buildProtocol(ctx: SpawnContext, adapter: ExecHostAdapter): string {
  const target = ctx.next.length ? ctx.next.join(', ') : 'the team lead';
  return [
    `You are "${ctx.agent}" (role: ${ctx.role}) on team "${ctx.team.name}".`,
    ...adapter.protocolLines(ctx),
    `Messages queued for you are included below. If the Ruflo MCP tools are available, team_inbox (team=${ctx.team.name}, agent=${ctx.agent}) shows anything newer.`,
    ctx.next.length ? `Next agent(s): ${ctx.next.join(', ')}` : 'Next: report completion to the team lead.',
    `Your final reply is delivered to ${target} as your handoff. End with a complete summary of what you did and what ${target} needs next.`,
    '',
    'Task:',
    ctx.task || `(No task body — wait for inbox / lead instructions for role ${ctx.role}.)`,
  ].join('\n');
}

/**
 * Plan entries for the exec hosts among `hostLabels`, keyed by label.
 * Native labels are skipped (the store builds them); an unknown label
 * throws TeamHostsError.
 */
export function buildExecHostPlans(
  team: PlanTeam,
  agent: string,
  role: string,
  task: string,
  next: string[],
  hostLabels: string[],
  roles: RoleTable,
  model?: string,
): Record<string, Record<string, unknown>> {
  const host: Record<string, Record<string, unknown>> = {};
  for (const label of hostLabels) {
    const { adapter, hostConfig } = resolveHost(label, getProjectCwd());
    if (adapter.kind !== 'exec') continue;
    const ctx: SpawnContext = {
      team, agent, role, defaults: defaultsFor(roles, role), next, task, label, model, hostConfig,
    };
    host[label] = { ...adapter.plan(ctx), prompt: buildProtocol(ctx, adapter) };
  }
  return host;
}

export interface ResolvedExecPlan {
  exec: ExecSpec;
  events?: string;
  /** Set for a command host from .claude-flow/team-hosts.json. */
  hostConfig?: CommandHostConfig;
  /** Built-in hosts are always trusted; a command host needs `ruflo team trust-host`. */
  trusted: boolean;
}

/**
 * Rebuild a member's exec plan at run time from the host's current
 * definition (the built-in adapter, or the validated team-hosts.json entry).
 * The plan stored in team.json is never executed: anything that can edit
 * the checkout can edit that file. Throws TeamHostsError.
 */
export function resolveExecPlan(
  team: PlanTeam,
  agent: string,
  role: string,
  next: string[],
  label: string,
  roles: RoleTable,
  model?: string,
): ResolvedExecPlan {
  const { adapter, hostConfig, trusted } = resolveHost(label, getProjectCwd());
  if (adapter.kind !== 'exec') {
    throw new TeamHostsError(
      `Host "${label}" spawns its own members; \`ruflo team run\` runs exec hosts only (codex and command hosts)`,
    );
  }
  const ctx: SpawnContext = {
    team, agent, role, defaults: defaultsFor(roles, role), next, task: '', label, model, hostConfig,
  };
  const entry = adapter.plan(ctx) as { exec: ExecSpec; events?: string };
  return {
    exec: entry.exec,
    ...(entry.events ? { events: entry.events } : {}),
    ...(hostConfig ? { hostConfig } : {}),
    trusted: hostConfig ? trusted === true : true,
  };
}

export function stringList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

