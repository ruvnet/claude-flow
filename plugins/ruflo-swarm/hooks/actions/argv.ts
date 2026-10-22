import { idOf, plain } from '../reader/parse'
import type { Snapshot } from '../reader/snapshot'

/**
 * One thing a button asks ruflo to do: the argv after the CLI prefix, fixed but for ids that passed `idOf`
 * and one JSON argument built by `JSON.stringify` (an argv element, never a shell string), and how the disk
 * shows that it happened, checked after the CLI exits.
 */
export type ActionSpec = {
  label: string
  args: readonly string[]
  /** Asks the person to press again before it runs: stopping, stealing, handing off. */
  isDestructive: boolean
  /** What the disk shows once it took effect; absent where the CLI writes nothing the pane reads. */
  verify?: (snapshot: Snapshot) => boolean
  /** The words for `verify`, as the outcome line says them. */
  expect: string
}

const exec = (tool: string, params: Record<string, unknown>) => ['mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)] as const

/** `agent:<id>:<type>`, the claimant form the claims tools parse; a type is letters, digits and dashes. */
function claimant(id: string, type: string): string | null {
  const safeType = /^[A-Za-z0-9_-]{1,40}$/.test(type) ? type : null

  return idOf(id) !== null && safeType !== null && !id.includes(':') ? `agent:${id}:${safeType}` : null
}

export function stopAgent(agentId: string): ActionSpec | null {
  const id = idOf(agentId)

  return id === null
    ? null
    : {
        label: `stop agent ${id}`,
        args: ['agent', 'stop', id],
        isDestructive: true,
        verify: snapshot => snapshot.agents.find(agent => agent.id === id)?.status !== 'busy' && snapshot.agents.find(agent => agent.id === id)?.status !== 'idle',
        expect: 'the agent no longer idle or busy in .claude-flow/agents/store.json',
      }
}

export function claimTask(taskId: string, agentId: string, agentType: string): ActionSpec | null {
  const issueId = idOf(taskId)
  const who = claimant(agentId, agentType)

  return issueId === null || who === null
    ? null
    : {
        label: `claim ${issueId} for ${agentType}`,
        args: exec('claims_claim', { issueId, claimant: who }),
        isDestructive: false,
        verify: snapshot => snapshot.claims.some(claim => claim.issueId === issueId && claim.claimant.id === agentId),
        expect: 'the claim in .claude-flow/claims/claims.json',
      }
}

export function markStealable(taskId: string): ActionSpec | null {
  const issueId = idOf(taskId)

  return issueId === null
    ? null
    : {
        label: `offer ${issueId} for stealing`,
        args: exec('claims_mark-stealable', { issueId, reason: 'voluntary' }),
        isDestructive: false,
        verify: snapshot => snapshot.claims.some(claim => claim.issueId === issueId && claim.isStealable),
        expect: 'the claim marked stealable',
      }
}

export function stealTask(taskId: string, agentId: string, agentType: string): ActionSpec | null {
  const issueId = idOf(taskId)
  const stealer = claimant(agentId, agentType)

  return issueId === null || stealer === null
    ? null
    : {
        label: `steal ${issueId} for ${agentType}`,
        args: exec('claims_steal', { issueId, stealer }),
        isDestructive: true,
        verify: snapshot => snapshot.claims.some(claim => claim.issueId === issueId && claim.claimant.id === agentId),
        expect: 'the claim held by the selected agent',
      }
}

export function handoffTask(taskId: string, from: { id: string; type: string }, to: { id: string; type: string }): ActionSpec | null {
  const issueId = idOf(taskId)
  const fromWho = claimant(from.id, from.type)
  const toWho = claimant(to.id, to.type)

  return issueId === null || fromWho === null || toWho === null || from.id === to.id
    ? null
    : {
        label: `hand ${issueId} to ${to.type}`,
        args: exec('claims_handoff', { issueId, from: fromWho, to: toWho }),
        isDestructive: true,
        verify: snapshot => snapshot.claims.some(claim => claim.issueId === issueId && (claim.handoffTo === to.id || claim.claimant.id === to.id)),
        expect: 'a handoff to the selected agent on the claim',
      }
}

/** Pauses or resumes the work an agent claimed: ruflo pauses claims, not agents. */
export function setClaimStatus(taskId: string, status: 'paused' | 'active'): ActionSpec | null {
  const issueId = idOf(taskId)

  return issueId === null
    ? null
    : {
        label: `${status === 'paused' ? 'pause' : 'resume'} the claim on ${issueId}`,
        args: exec('claims_status', { issueId, status }),
        isDestructive: false,
        verify: snapshot => snapshot.claims.some(claim => claim.issueId === issueId && claim.status === status),
        expect: `the claim ${status}`,
      }
}

export function vote(proposalId: string, voterId: string, isFor: boolean): ActionSpec | null {
  const id = idOf(proposalId)
  const voter = idOf(voterId)

  return id === null || voter === null
    ? null
    : {
        label: `vote ${isFor ? 'yes' : 'no'} on ${id} as ${voter}`,
        args: ['hive-mind', 'consensus', '-a', 'vote', '-p', id, '-v', isFor ? 'yes' : 'no', '--voter-id', voter],
        isDestructive: false,
        verify: snapshot => {
          const proposal = snapshot.hive?.pending.find(entry => entry.id === id)
          const decided = snapshot.hive?.history.some(entry => entry.id === id) === true

          return decided || (proposal !== undefined && proposal.votesFor + proposal.votesAgainst > 0)
        },
        expect: 'a vote counted on the proposal in .claude-flow/hive-mind/state.json',
      }
}

/** Asks the router again for a task's description. The text is the task's own, cleaned, one argv element. */
export function reroute(description: string): ActionSpec | null {
  const task = plain(description, 400)

  // A value that starts with a dash would be read by the CLI as a flag of its own.
  return task === '' || task.startsWith('-')
    ? null
    : { label: 'ask the router', args: ['hooks', 'route', '--task', task, '--format', 'json'], isDestructive: false, expect: 'a pick printed by the router' }
}

export function agentLogs(agentId: string): ActionSpec | null {
  const id = idOf(agentId)

  return id === null ? null : { label: `logs of ${id}`, args: ['agent', 'logs', id], isDestructive: false, expect: 'the log lines' }
}

/** The full argv: the configured CLI's fixed prefix, then the action's own. */
export const argvOf = (prefix: readonly string[], spec: ActionSpec): string[] => [...prefix, ...spec.args]
