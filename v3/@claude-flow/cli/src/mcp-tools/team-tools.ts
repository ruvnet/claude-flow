/**
 * Host-agnostic Agent Teams MCP tools (ADR-402).
 *
 * Comms live in Ruflo (filesystem under .claude-flow/teams/), not host
 * SendMessage. team_spawn returns a host spawn plan (Grok spawn_subagent /
 * Claude Task adapter).
 *
 * The store itself is templates/grok/scripts/grok-team-bus.mjs — the same file
 * `init --grok` copies into a project as a CLI — so the MCP tools, the CLI and
 * the SubagentStop hook share one implementation (locking, per-team mailboxes,
 * atomic writes). This module validates MCP input and maps errors to results.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type MCPTool, getProjectCwd } from './types.js';
import { validateText } from './validate-input.js';
import { grokTemplatesRoot } from '../init/grok-generator.js';

type BusResult = Record<string, unknown>;
type BusOp = (projectRoot: string, opts: Record<string, unknown>) => BusResult | Promise<BusResult>;

interface TeamBus {
  createTeam: BusOp;
  spawnMember: BusOp;
  sendMessage: BusOp;
  readInbox: BusOp;
  teamStatus: BusOp;
  setPlan: BusOp;
  onStop: BusOp;
  shutdownTeam: BusOp;
}

let busPromise: Promise<TeamBus> | null = null;

function loadBus(): Promise<TeamBus> {
  if (!busPromise) {
    const file = join(grokTemplatesRoot(), 'scripts', 'grok-team-bus.mjs');
    busPromise = import(pathToFileURL(file).href) as Promise<TeamBus>;
    busPromise.catch(() => {
      busPromise = null;
    });
  }
  return busPromise;
}

async function run(
  op: keyof TeamBus,
  opts: Record<string, unknown>,
): Promise<{ success: boolean } & Record<string, unknown>> {
  try {
    const bus = await loadBus();
    // Some ops (create/spawn/send) hold the team lock, which now waits via a
    // non-blocking async poll rather than Atomics.wait (ADR-402 round-2
    // review, N3) — always await, whether or not this particular op returns
    // a promise.
    return { success: true, ...(await bus[op](getProjectCwd(), opts)) };
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
        host: { type: 'string', description: 'Host label (grok, claude, codex)' },
        force: { type: 'boolean', description: 'Overwrite existing team metadata (reopens a shut-down team)' },
      },
      required: ['name'],
    },
    handler: async (input) =>
      run('createTeam', {
        name: input.name,
        topology: input.topology,
        maxAgents: input.maxAgents,
        host: input.host,
        force: input.force === true,
      }),
  },
  {
    name: 'team_spawn',
    description:
      'Register a teammate and return a host spawn plan (Grok spawn_subagent / Claude Task adapter) — does not execute the agent. Use when native Task has no way to register a teammate into the host-agnostic team roster (ADR-402); the host lead still spawns using the returned plan. Refused once the team is shut down or has maxAgents members. Pair with team_create first.',
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
      },
      required: ['team', 'agent'],
    },
    handler: async (input) => {
      const err = textError(input.prompt, 'prompt', 100_000);
      if (err) return { success: false, error: err };
      return run('spawnMember', {
        team: input.team,
        agent: input.agent,
        role: input.role,
        prompt: input.prompt,
        next: input.next,
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
      'Mark agent idle, advance the team_plan pipeline, and return the next assignment hint. Use when native Task has no cross-host equivalent to SubagentStop-driven pipeline advancement; wire this from SubagentStop / post-task hooks instead of polling team_status.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: teamProp,
        agent: { type: 'string', description: 'Agent that stopped' },
      },
      required: ['team', 'agent'],
    },
    handler: async (input) => run('onStop', { team: input.team, agent: input.agent }),
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
