/**
 * The palette's operations beyond the claims board, each a fixed argv for the ruflo CLI (long flags: the short ones are
 * not accepted everywhere). Ids pass `idOf`; free text from the palette's input passes `textArg` and is always one argv
 * element. Read-only operations run at once; every other one goes through the confirm step.
 */
import { exec, type ActionSpec } from './actions'
import { idOf, plain, type AgentRecord, type ClaimRecord } from './data/parse'
import { ARGV_TEXT_MAX, checkLimit, countOf } from './full-text'

export const AGENT_TYPES = ['coder', 'tester', 'reviewer', 'researcher', 'architect', 'planner', 'security-auditor', 'performance-engineer'] as const
export const WORKERS = ['audit', 'optimize', 'testgaps', 'map', 'consolidate', 'document', 'benchmark', 'deepdive'] as const

/**
 * Free text as one argv element: cleaned (control characters and line breaks become spaces), never one the CLI would read as a flag, and NEVER cut
 * (ADR-481): text over `max` (ARGV_TEXT_MAX by default, the largest one argv element carries on every platform) gives null, and `textRefusal` says by how much.
 */
export function textArg(value: string, max = ARGV_TEXT_MAX): string | null {
  const text = plain(value, Number.MAX_SAFE_INTEGER)

  return text === '' || text.startsWith('-') || countOf(text) > max ? null : text
}

/** The exact refusal for text over `max` ("the text is 9,001 characters; the limit is 8,000 ..."), or null when it fits `max`. */
export function textRefusal(value: string, what = 'the text', max = ARGV_TEXT_MAX): string | null {
  const fit = checkLimit(plain(value, Number.MAX_SAFE_INTEGER), max, what, max === ARGV_TEXT_MAX ? 'one command argument carries at most that much on every platform' : 'the most the record takes')

  return fit.ok ? null : fit.message
}

export function spawnAgent(type: string, nowMs: number): ActionSpec | null {
  if (!(AGENT_TYPES as readonly string[]).includes(type)) return null

  const name = `${type}-${String(nowMs).slice(-5)}`

  return {
    label: `spawn a ${type} agent named ${name}`,
    args: ['agent', 'spawn', '--type', type, '--name', name],
    expect: 'a new agent in .claude-flow/agents/store.json',
    verify: snapshot => snapshot.agents.some(agent => agent.name === name || agent.type === type),
  }
}

export function stopAgent(agent: AgentRecord): ActionSpec | null {
  const id = idOf(agent.id)

  return id === null
    ? null
    : { label: `stop agent ${agent.name ?? agent.type} (${id})`, args: ['agent', 'stop', id], expect: 'the agent no longer idle or busy', verify: snapshot => !snapshot.agents.some(entry => entry.id === id && /idle|busy/.test(entry.status)) }
}

export function agentLogs(agent: AgentRecord): ActionSpec | null {
  const id = idOf(agent.id)

  return id === null ? null : { label: `logs of ${agent.name ?? agent.type}`, args: ['agent', 'logs', '--id', id, '--tail', '20'], expect: 'the log lines', isReadOnly: true }
}

/** ruflo pauses claims, not agents. */
export function setClaimStatus(claim: ClaimRecord, status: 'paused' | 'active'): ActionSpec | null {
  const issueId = idOf(claim.issueId)

  return issueId === null
    ? null
    : {
        label: `${status === 'paused' ? 'pause' : 'resume'} the claim on ${issueId}`,
        args: exec('claims_status', { issueId, status, note: 'from ruflo-console' }),
        expect: `the claim ${status}`,
        verify: snapshot => snapshot.claims.some(entry => entry.issueId === issueId && entry.status === status),
      }
}

/** Asks the router again for a task's words: it answers a pick and changes nothing the console reads. */
export function reroute(description: string): ActionSpec | null {
  const task = textArg(description)

  return task === null ? null : { label: `route "${task.slice(0, 40)}"`, args: ['hooks', 'route', '--task', task, '--format', 'json'], expect: 'a pick printed by the router', isReadOnly: true }
}

export function swarmInit(): ActionSpec {
  return {
    label: 'initialise a hierarchical swarm (max 8, specialized)',
    args: ['swarm', 'init', '--topology', 'hierarchical', '--max-agents', '8', '--strategy', 'specialized'],
    expect: 'a swarm in .claude-flow/swarm/swarm-state.json',
    verify: snapshot => snapshot.swarm !== null,
  }
}

export function swarmStop(): ActionSpec {
  return { label: 'stop the swarm', args: ['swarm', 'stop'], expect: 'the swarm no longer running', verify: snapshot => snapshot.swarm?.status !== 'running' }
}

export function vote(proposalId: string, isFor: boolean): ActionSpec | null {
  const id = idOf(proposalId)

  return id === null
    ? null
    : {
        label: `vote ${isFor ? 'yes' : 'no'} on ${id} as console-operator`,
        args: ['hive-mind', 'consensus', '--action', 'vote', '--proposal-id', id, '--vote', isFor ? 'yes' : 'no', '--voter-id', 'console-operator'],
        expect: 'a vote counted on the proposal',
        verify: snapshot => {
          const proposal = snapshot.hive?.pending.find(entry => entry.id === id)

          return snapshot.hive?.history.some(entry => entry.id === id) === true || (proposal !== undefined && proposal.votesFor + proposal.votesAgainst > 0)
        },
      }
}

export const harnessScore = (): ActionSpec => ({ label: 'score the harness now', args: ['metaharness', 'score', '--format', 'json'], expect: 'the five scores', isReadOnly: true })

export const harnessAudit = (): ActionSpec => ({ label: 'run a MetaHarness OIA audit (stored in memory namespace metaharness-audit)', args: ['metaharness', 'oia-audit'], expect: 'an audit record' })

export function dispatchWorker(worker: string): ActionSpec | null {
  return (WORKERS as readonly string[]).includes(worker) ? { label: `dispatch the ${worker} worker`, args: ['hooks', 'worker', 'dispatch', '--trigger', worker], expect: 'the worker queued' } : null
}

export function memoryStore(value: string, nowMs: number): ActionSpec | null {
  const text = textArg(value)
  const key = `console-${nowMs}`

  return text === null ? null : { label: `store "${text.slice(0, 40)}" as ${key} in namespace console`, args: ['memory', 'store', '--key', key, '--value', text, '--namespace', 'console'], expect: 'one more memory entry' }
}

export function memorySearch(query: string): ActionSpec | null {
  const text = textArg(query)

  return text === null ? null : { label: `search memory for "${text.slice(0, 40)}"`, args: ['memory', 'search', '--query', text, '--limit', '5'], expect: 'the matches', isReadOnly: true }
}

/** The lines a read-only run printed, cleaned, without the CLI's banners, at most `max`. */
export function outputLines(stdout: string, max = 12): string[] {
  return stdout
    .split('\n')
    .map(line => plain(line, 160))
    .filter(line => line !== '' && !/^(Transformers\.js loaded|\[INFO\] Executing tool|\[OK\] Tool executed)/.test(line))
    .slice(0, max)
}
