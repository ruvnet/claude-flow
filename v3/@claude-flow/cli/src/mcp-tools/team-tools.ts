/**
 * Host-agnostic Agent Teams MCP tools (ADR-402).
 *
 * Comms live in Ruflo (filesystem under .claude-flow/teams/), not host
 * SendMessage. team_spawn returns a spawn plan per host: the store builds the
 * Grok spawn_subagent and Claude Task entries, and ./team-hosts/ adds exec
 * hosts (Codex, command hosts from .claude-flow/team-hosts.json).
 *
 * The store itself is templates/grok/scripts/grok-team-bus.mjs — the same file
 * `init --grok` copies into a project as a CLI — so the MCP tools, the CLI and
 * the SubagentStop hook share one implementation (locking, per-team mailboxes,
 * atomic writes). This module validates MCP input and maps errors to results.
 */

import { type MCPTool, getProjectCwd } from './types.js';
import { validateText } from './validate-input.js';
import { loadBus, type BusOp, type TeamBus } from './team-bus.js';
import { normalizeAgentLabel, resolveHost, TeamHostsError } from './team-hosts/index.js';
import { buildExecHostPlans, stringList } from './team-hosts/plan.js';

const SPAWN_KEYS = ['team', 'agent', 'role', 'prompt', 'next', 'hosts', 'model'];
/** Likely mistakes for a known key, so the error can say what was meant. */
const KEY_HINTS: Record<string, string> = { task: 'prompt', body: 'prompt', message: 'prompt', name: 'agent', host: 'hosts' };

/** Error text for keys a handler does not take, or undefined. A typo must not silently drop input. */
function unknownKeys(input: Record<string, unknown>, allowed: string[]): string | undefined {
  // Underscore keys are transport metadata (MCP _meta), not tool input.
  const extra = Object.keys(input).filter((k) => !allowed.includes(k) && !k.startsWith('_'));
  if (!extra.length) return undefined;
  const hints = extra.map((k) => (KEY_HINTS[k] ? `"${k}" (did you mean "${KEY_HINTS[k]}"?)` : `"${k}"`));
  return `Unknown parameter${extra.length > 1 ? 's' : ''} ${hints.join(', ')}. Accepted: ${allowed.join(', ')}`;
}

async function run(
  op: Exclude<keyof TeamBus, 'teamsWithMember' | 'ROLE_DEFAULTS'>,
  opts: Record<string, unknown>,
): Promise<{ success: boolean } & Record<string, unknown>> {
  try {
    const bus = await loadBus();
    // Some ops hold the team lock via an async wait (ADR-402 round-2 review,
    // N3). Always await: updateTeam returns a promise (round-3 review).
    // readInbox is synchronous and has a narrower argument than BusOp, so the
    // indexed call is invoked as BusOp. Await still unwraps its plain result.
    return { success: true, ...(await (bus[op] as BusOp)(getProjectCwd(), opts)) };
  } catch (e) {
    return { success: false, error: (e as Error).message || String(e) };
  }
}

function textError(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  const v = validateText(String(value), field, max);
  return v.valid ? null : v.error || `Invalid ${field}`;
}

const teamProp = { type: 'string', description: 'Team id (alphanumeric, dash, underscore)' };

export const teamTools: MCPTool[] = [
  {
    name: 'team_create',
    description:
      'Create a host-agnostic Agent Team (ADR-402). State under .claude-flow/teams/<team>/. Use when native SendMessage/Task teammate bus is wrong or unavailable (Grok, Codex, multi-host). Pair with team_spawn for spawn plans and team_send/team_inbox for handoffs.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        name: teamProp,
        topology: {
          type: 'string',
          description: 'Team topology (hierarchical, mesh, star, ring)',
        },
        maxAgents: { type: 'number', description: 'Max members (1-50, default 8); team_spawn refuses beyond it' },
        host: {
          type: 'string',
          description: 'Default host label: grok, claude, codex, or a label from .claude-flow/team-hosts.json',
        },
        force: { type: 'boolean', description: 'Overwrite existing team metadata (reopens a shut-down team)' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      try {
        resolveHost(String(input.host || 'grok'), getProjectCwd());
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
      return run('createTeam', {
        name: input.name,
        topology: input.topology,
        maxAgents: input.maxAgents,
        host: input.host,
        force: input.force === true,
      });
    },
  },
  {
    name: 'team_spawn',
    description:
      'Register a teammate and return a spawn plan per host (Grok spawn_subagent, Claude Task, Codex exec, or a command host from .claude-flow/team-hosts.json) — does not execute the agent; exec hosts run via `ruflo team run`. Use when native Task has no way to register a teammate into the host-agnostic team roster (ADR-402); the host lead still spawns using the returned plan. Refused once the team is shut down or has maxAgents members. Pair with team_create first.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: teamProp,
        agent: { type: 'string', description: 'Agent name' },
        role: { type: 'string', description: 'Role (architect, developer, tester, reviewer, …)' },
        prompt: { type: 'string', description: 'Task body embedded in spawn plan prompt' },
        next: {
          type: 'array',
          description: 'Next agent name(s) for handoff',
          items: { type: 'string' },
        },
        hosts: {
          type: 'array',
          description: 'Host labels to plan for (default: the team host plus claude). Exec hosts (codex, team-hosts.json labels) run via `ruflo team run`',
          items: { type: 'string' },
        },
        model: { type: 'string', description: 'Optional model override for exec hosts that take one (codex -m)' },
      },
      required: ['team', 'agent'],
    },
    handler: async (input) => {
      const unknown = unknownKeys(input, SPAWN_KEYS);
      if (unknown) return { success: false, error: unknown };
      const err = textError(input.prompt, 'prompt', 100_000) || textError(input.model, 'model', 200);
      if (err) return { success: false, error: err };
      const root = getProjectCwd();
      const model = input.model === undefined ? undefined : String(input.model);
      let hostPlans: Record<string, Record<string, unknown>>;
      try {
        const bus = await loadBus();
        const status = await bus.teamStatus(root, { team: input.team });
        const team = (status as { team: { id: string; name: string; host?: string } }).team;
        const requested = stringList(input.hosts);
        const labels = [...new Set(requested.length ? requested : [team.host || 'grok', 'claude'])];
        hostPlans = buildExecHostPlans(
          team, String(input.agent ?? ''), String(input.role || input.agent || ''), String(input.prompt ?? ''),
          stringList(input.next), labels, bus.ROLE_DEFAULTS, model,
        );
      } catch (e) {
        if (e instanceof TeamHostsError) return { success: false, error: e.message };
        return { success: false, error: (e as Error).message || String(e) };
      }
      return run('spawnMember', {
        team: input.team,
        agent: input.agent,
        role: input.role,
        prompt: input.prompt,
        next: input.next,
        hostPlans,
        model,
      });
    },
  },
  {
    name: 'team_send',
    description:
      'Enqueue a message to a named agent mailbox on one team (or broadcast to every member with to="*"). Use when native SendMessage is wrong because the recipient may be on a different host (Grok, Codex) with no SendMessage equivalent — the message persists under .claude-flow/teams/<team>/mailbox/ instead of an in-memory channel. Pair with team_inbox to read it. Refused once the team is shut down.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: teamProp,
        to: { type: 'string', description: 'Recipient agent name, or * to broadcast to current members' },
        message: { type: 'string', description: 'Message body' },
        summary: { type: 'string', description: 'Short summary' },
        from: { type: 'string', description: 'Sender name (default: lead)' },
        type: { type: 'string', description: 'Message type (handoff, status, …)' },
        priority: { type: 'number', description: 'Integer 0-999, lower is read first (default 2)' },
      },
      required: ['team', 'to', 'message'],
    },
    handler: async (input) => {
      const err =
        textError(input.message ?? input.content, 'message', 500_000) ||
        textError(input.summary, 'summary', 1_000) ||
        textError(input.type, 'type', 64);
      if (err) return { success: false, error: err };
      return run('sendMessage', {
        team: input.team,
        to: input.to,
        message: input.message ?? input.content,
        summary: input.summary,
        from: input.from,
        type: input.type,
        priority: input.priority,
      });
    },
  },
  {
    name: 'team_inbox',
    description:
      'Drain (default) or peek one agent\'s mailbox on one team. Drained messages move to mailbox/<agent>/archive; concurrent drains never return the same message twice. Use when native SendMessage is wrong because there is no host-agnostic inbox to read from — this is the Grok/Codex-side counterpart to team_send for hosts without a live message channel.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: teamProp,
        agent: { type: 'string', description: 'Agent name whose inbox to read' },
        peek: { type: 'boolean', description: 'If true, do not archive/drain messages' },
      },
      required: ['team', 'agent'],
    },
    handler: async (input) =>
      run('readInbox', { team: input.team, agent: input.agent, peek: input.peek === true }),
  },
  {
    name: 'team_broadcast',
    description:
      'Fan-out a message to all registered members of one team (alias of team_send with to="*"; refused while the team has no members). Use when native SendMessage is wrong because it can\'t reach every teammate on a non-Claude host in one call; each recipient reads back via team_inbox on its own host.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: teamProp,
        message: { type: 'string', description: 'Message body' },
        summary: { type: 'string', description: 'Short summary' },
        from: { type: 'string', description: 'Sender (default: lead)' },
      },
      required: ['team', 'message'],
    },
    handler: async (input) => {
      const send = teamTools.find((t) => t.name === 'team_send');
      if (!send) return { success: false, error: 'team_send not registered' };
      return send.handler({
        team: input.team,
        to: '*',
        message: input.message,
        summary: input.summary,
        from: input.from,
        type: 'broadcast',
      });
    },
  },
  {
    name: 'team_plan',
    description:
      'Set pipeline steps for a team (ordered agents); the first step becomes ready. Use when native TodoWrite is wrong because it can\'t drive multi-host agent sequencing — this pipeline advances via team_on_stop instead of a single host\'s task list.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: teamProp,
        steps: {
          type: 'array',
          description: 'Ordered agent names or {id,agent} objects',
          items: {},
        },
      },
      required: ['team', 'steps'],
    },
    handler: async (input) => run('setPlan', { team: input.team, steps: input.steps }),
  },
  {
    name: 'team_status',
    description:
      'Team members, plan progress, and pending mailbox counts for this team only. Use when native Task is wrong because it has no cross-host visibility into a team\'s roster or pipeline state — reads the same .claude-flow/teams/ state that team_plan and team_send write.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: teamProp,
      },
      required: ['team'],
    },
    handler: async (input) => run('teamStatus', { team: input.team }),
  },
  {
    name: 'team_on_stop',
    description:
      'Mark an agent stopped (done or failed), advance the team_plan pipeline on done, and return the next assignment hint. Use when native Task has no cross-host equivalent to SubagentStop-driven pipeline advancement; wire this from SubagentStop hooks or `ruflo team run` instead of polling team_status. A repeated runId is a no-op.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: teamProp,
        agent: { type: 'string', description: 'Agent that stopped (a "role:agent@team" spawn description is accepted)' },
        outcome: { type: 'string', description: 'done (default) or failed; failed does not advance the plan' },
        runId: { type: 'string', description: 'Run id; a repeat for the same agent is ignored' },
        reason: { type: 'string', description: 'Why the run failed (recorded on the member)' },
      },
      required: ['team', 'agent'],
    },
    handler: async (input) =>
      run('onStop', {
        team: input.team,
        agent: normalizeAgentLabel(String(input.agent ?? '')),
        outcome: input.outcome,
        runId: input.runId,
        reason: input.reason,
      }),
  },
  {
    name: 'team_shutdown',
    description:
      'Close a team: marks it and its members shutdown, after which team_spawn, team_send, team_plan and team_on_stop refuse (team_inbox and team_status still work, to drain remaining mail). Use when native Task is wrong because it has no host-agnostic team lifecycle to close out.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: teamProp,
      },
      required: ['team'],
    },
    handler: async (input) => run('shutdownTeam', { team: input.team }),
  },
];
